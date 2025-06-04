const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const SECRETS_DIR = process.env.SECRETS_DIR || '/secrets';

// Kubernetes configuration
const K8S_NAMESPACE = process.env.K8S_NAMESPACE || 'vault-live-secrets-demo';
const K8S_SECRET_NAME = process.env.K8S_SECRET_NAME || 'vault-web-secrets';

// In-memory activity log (survives until server restart)
let activityLog = [];
const MAX_ACTIVITY_ENTRIES = 100;

// Global deduplication for WebSocket emissions and activity updates
let recentEmissions = new Map();
const EMISSION_DEDUP_WINDOW = 1000; // 1 second window to prevent duplicates

// Activity throttling - limit how often we show activity updates
let lastActivityEmission = 0;
const ACTIVITY_THROTTLE_MS = 2000; // Only emit activity updates every 2 seconds max

// Kubectl-based secret monitoring for precise Kubernetes secret change detection
let kubectlWatcher = null;
let lastSecretUpdateTime = null;
let lastKnownSecrets = null; // Track last known secrets to detect actual content changes
let kubectlAvailable = true; // Track if kubectl is available

// Debouncing mechanism for handling rapid successive updates
let updateTimeoutId = null;
let pendingUpdateCount = 0;

// Enhanced reliability mechanisms
let periodicSyncInterval = null;
let connectedClients = new Set();
let lastSuccessfulSync = Date.now();
const PERIODIC_SYNC_INTERVAL = 30000; // Force sync every 30 seconds
const HEARTBEAT_INTERVAL = 10000; // Send heartbeat every 10 seconds
const STALE_DATA_THRESHOLD = 60000; // Consider data stale after 60 seconds

function startKubectlSecretMonitoring() {
  console.log(`🎯 Starting kubectl-based secret monitoring for ${K8S_SECRET_NAME} in namespace ${K8S_NAMESPACE}`);
  
  // Use kubectl --watch to monitor the secret's resourceVersion (changes on ANY modification)
  // This is more reliable than managedFields which might miss updates from different controllers
  kubectlWatcher = spawn('kubectl', [
    'get', 'secret', K8S_SECRET_NAME,
    '-n', K8S_NAMESPACE,
    '-o', 'jsonpath={.metadata.resourceVersion}{\"\\n\"}',
    '--watch'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (kubectlWatcher.stdout) {
    kubectlWatcher.stdout.on('data', (data) => {
      const resourceVersion = data.toString().trim();
      console.log(`🔍 Kubectl output: resourceVersion=${resourceVersion}, last=${lastSecretUpdateTime}`);
      if (resourceVersion && resourceVersion !== lastSecretUpdateTime) {
        console.log(`🚀 Kubectl detected secret update - resourceVersion: ${resourceVersion}`);
        lastSecretUpdateTime = resourceVersion;
        
        // Use debounced update handling to capture rapid successive changes
        handleKubectlUpdate();
      }
    });
  }

  if (kubectlWatcher.stderr) {
    kubectlWatcher.stderr.on('data', (data) => {
      console.log(`kubectl stderr: ${data.toString()}`);
    });
  }

  kubectlWatcher.on('close', (code) => {
    console.log(`kubectl watcher closed with code ${code}`);
    if (code !== 0 && kubectlAvailable) {
      setTimeout(() => {
        console.log('Restarting kubectl secret monitoring...');
        startKubectlSecretMonitoring();
      }, 5000);
    }
  });

  kubectlWatcher.on('error', (err) => {
    console.error('kubectl watcher error:', err);
    if (err.code === 'ENOENT') {
      console.log('❌ kubectl command not found - kubectl is not available in this environment');
      kubectlAvailable = false;
    }
    // Fallback to file system monitoring if kubectl fails
    console.log('Falling back to file system monitoring...');
    startFilesystemMonitoring();
  });
}

function handleSecretUpdate(source) {
  console.log(`📦 Secret update detected via ${source} - reading updated secrets`);
  const newSecrets = readSecretsFromDirectory();
  
  // Enhanced content comparison with detailed logging
  const currentSecretsString = JSON.stringify(lastKnownSecrets || {}, null, 2);
  const newSecretsString = JSON.stringify(newSecrets, null, 2);
  
  // Log detailed comparison for debugging
  console.log(`🔍 Comparing secrets - Current count: ${Object.keys(lastKnownSecrets || {}).length}, New count: ${Object.keys(newSecrets).length}`);
  
  if (lastKnownSecrets) {
    // Check for content changes in existing secrets
    let contentChanged = false;
    const changedSecrets = [];
    
    for (const [key, newValue] of Object.entries(newSecrets)) {
      const oldValue = lastKnownSecrets[key];
      if (!oldValue || oldValue.content !== newValue.content || oldValue.lastModified !== newValue.lastModified) {
        contentChanged = true;
        changedSecrets.push({
          key,
          oldContent: oldValue?.content?.substring(0, 50) || 'N/A',
          newContent: newValue.content?.substring(0, 50) || 'N/A',
          oldModified: oldValue?.lastModified || 'N/A',
          newModified: newValue.lastModified || 'N/A'
        });
      }
    }
    
    // Check for added/removed secrets
    const oldKeys = Object.keys(lastKnownSecrets);
    const newKeys = Object.keys(newSecrets);
    const addedKeys = newKeys.filter(key => !oldKeys.includes(key));
    const removedKeys = oldKeys.filter(key => !newKeys.includes(key));
    
    if (addedKeys.length > 0 || removedKeys.length > 0) {
      contentChanged = true;
    }
    
    if (contentChanged) {
      console.log(`✅ Content changes detected:`);
      if (changedSecrets.length > 0) {
        console.log(`   📝 Modified secrets: ${changedSecrets.map(s => s.key).join(', ')}`);
        changedSecrets.forEach(secret => {
          console.log(`     ${secret.key}: "${secret.oldContent}..." → "${secret.newContent}..." (${secret.oldModified} → ${secret.newModified})`);
        });
      }
      if (addedKeys.length > 0) console.log(`   ➕ Added secrets: ${addedKeys.join(', ')}`);
      if (removedKeys.length > 0) console.log(`   ➖ Removed secrets: ${removedKeys.join(', ')}`);
    } else {
      console.log(`📦 No content changes detected`);
    }
  }
  
  if (currentSecretsString === newSecretsString) {
    console.log(`📦 Secret content unchanged - skipping emission (source: ${source})`);
    return;
  }

  console.log(`📦 Secret content changed - emitting update (source: ${source})`);
  lastKnownSecrets = JSON.parse(JSON.stringify(newSecrets)); // Deep clone to avoid reference issues
  lastSuccessfulSync = Date.now();
  
  // Emit secrets update to all connected clients with force flag
  emitSecretsUpdate(newSecrets, source, true);

  // Add activity entry for the secret update with throttling
  const now = Date.now();
  const shouldEmitActivity = (now - lastActivityEmission) > ACTIVITY_THROTTLE_MS;
  
  if (shouldEmitActivity) {
    const activityEntry = addActivityEntry('updated', 'secrets', newSecrets);
    if (activityEntry) {
      lastActivityEmission = now;
      io.emit('activity-update', {
        timestamp: new Date().toISOString(),
        activity: activityLog.slice(0, 10),
        newEntry: activityEntry
      });
      console.log('📝 Activity update emitted');
    }
  } else {
    console.log(`⏱️ Activity update throttled (${Math.round((ACTIVITY_THROTTLE_MS - (now - lastActivityEmission)) / 1000)}s remaining)`);
  }
}

// Retry mechanism for kubectl-detected changes to handle Kubernetes projected volume delays
function handleSecretUpdateWithRetry(source, retryCount) {
  const maxRetries = 8; // Increased from 5 to 8 retries
  const retryDelay = 500; // 500ms between retries for faster response
  
  console.log(`📦 Secret update detected via ${source} - reading updated secrets (attempt ${retryCount + 1}/${maxRetries + 1})`);
  const newSecrets = readSecretsFromDirectory();
  
  // Enhanced content comparison with detailed logging
  const currentSecretsString = JSON.stringify(lastKnownSecrets || {}, null, 2);
  const newSecretsString = JSON.stringify(newSecrets, null, 2);
  
  // Log detailed comparison for debugging
  console.log(`🔍 Comparing secrets - Current count: ${Object.keys(lastKnownSecrets || {}).length}, New count: ${Object.keys(newSecrets).length}`);
  
  if (lastKnownSecrets) {
    // Check for content changes in existing secrets
    let contentChanged = false;
    const changedSecrets = [];
    
    for (const [key, newValue] of Object.entries(newSecrets)) {
      const oldValue = lastKnownSecrets[key];
      if (!oldValue || oldValue.content !== newValue.content || oldValue.lastModified !== newValue.lastModified) {
        contentChanged = true;
        changedSecrets.push({
          key,
          oldContent: oldValue?.content?.substring(0, 50) || 'N/A',
          newContent: newValue.content?.substring(0, 50) || 'N/A',
          oldModified: oldValue?.lastModified || 'N/A',
          newModified: newValue.lastModified || 'N/A'
        });
      }
    }
    
    // Check for added/removed secrets
    const oldKeys = Object.keys(lastKnownSecrets);
    const newKeys = Object.keys(newSecrets);
    const addedKeys = newKeys.filter(key => !oldKeys.includes(key));
    const removedKeys = oldKeys.filter(key => !newKeys.includes(key));
    
    if (addedKeys.length > 0 || removedKeys.length > 0) {
      contentChanged = true;
    }
    
    if (contentChanged) {
      console.log(`✅ Content changes detected:`);
      if (changedSecrets.length > 0) {
        console.log(`   📝 Modified secrets: ${changedSecrets.map(s => s.key).join(', ')}`);
        changedSecrets.forEach(secret => {
          console.log(`     ${secret.key}: "${secret.oldContent}..." → "${secret.newContent}..." (${secret.oldModified} → ${secret.newModified})`);
        });
      }
      if (addedKeys.length > 0) console.log(`   ➕ Added secrets: ${addedKeys.join(', ')}`);
      if (removedKeys.length > 0) console.log(`   ➖ Removed secrets: ${removedKeys.join(', ')}`);
    } else {
      console.log(`📦 No content changes detected`);
    }
  }
  
  if (currentSecretsString === newSecretsString) {
    if (retryCount < maxRetries) {
      console.log(`📦 Secret content unchanged - retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
      setTimeout(() => {
        handleSecretUpdateWithRetry(source, retryCount + 1);
      }, retryDelay);
      return;
    } else {
      console.log(`📦 Secret content unchanged after ${maxRetries + 1} attempts - giving up (source: ${source})`);
      return;
    }
  }

  console.log(`📦 Secret content changed - emitting update (source: ${source}, attempt ${retryCount + 1})`);
  lastKnownSecrets = JSON.parse(JSON.stringify(newSecrets)); // Deep clone to avoid reference issues
  lastSuccessfulSync = Date.now();
  
  // Emit secrets update to all connected clients with force flag
  emitSecretsUpdate(newSecrets, source, true);

  // Add activity entry for the secret update with throttling
  const now = Date.now();
  const shouldEmitActivity = (now - lastActivityEmission) > ACTIVITY_THROTTLE_MS;
  
  if (shouldEmitActivity) {
    const activityEntry = addActivityEntry('updated', 'secrets', newSecrets);
    if (activityEntry) {
      lastActivityEmission = now;
      io.emit('activity-update', {
        timestamp: new Date().toISOString(),
        activity: activityLog.slice(0, 10),
        newEntry: activityEntry
      });
      console.log('📝 Activity update emitted');
    }
  } else {
    console.log(`⏱️ Activity update throttled (${Math.round((ACTIVITY_THROTTLE_MS - (now - lastActivityEmission)) / 1000)}s remaining)`);
  }
}

// Enhanced emission function with reliability features
function emitSecretsUpdate(secrets, source, forceUpdate = false) {
  const updateData = {
    timestamp: new Date().toISOString(),
    action: 'updated',
    file: 'secrets',
    secrets: secrets,
    source: source,
    forceUpdate: forceUpdate,
    syncId: Date.now() // Unique ID for this sync
  };
  
  io.emit('secrets-update', updateData);
  console.log(`📡 Secrets update emitted to ${connectedClients.size} clients (source: ${source}, force: ${forceUpdate})`);
}

// Periodic sync to ensure clients stay updated with enhanced debugging
function startPeriodicSync() {
  periodicSyncInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceLastSync = now - lastSuccessfulSync;
    
    if (timeSinceLastSync > STALE_DATA_THRESHOLD) {
      console.log(`🔄 Forcing periodic sync - data may be stale (${Math.round(timeSinceLastSync/1000)}s since last sync)`);
      handleSecretUpdate('periodic-sync');
    } else {
      // Send heartbeat to maintain connection and perform lightweight check
      const currentSecrets = readSecretsFromDirectory();
      
      // Quick comparison to detect if we missed any changes
      const currentSecretsString = JSON.stringify(lastKnownSecrets || {});
      const newSecretsString = JSON.stringify(currentSecrets);
      
      if (currentSecretsString !== newSecretsString && connectedClients.size > 0) {
        console.log('🔄 Periodic sync detected missed changes - triggering update');
        handleSecretUpdate('periodic-sync-change-detected');
      } else {
        io.emit('heartbeat', {
          timestamp: new Date().toISOString(),
          connectedClients: connectedClients.size,
          lastSync: lastSuccessfulSync,
          secretCount: Object.keys(currentSecrets).length
        });
        console.log(`💓 Heartbeat sent to ${connectedClients.size} clients (${Object.keys(currentSecrets).length} secrets)`);
      }
    }
  }, HEARTBEAT_INTERVAL);
  
  console.log(`🔄 Periodic sync and heartbeat started (${PERIODIC_SYNC_INTERVAL/1000}s sync, ${HEARTBEAT_INTERVAL/1000}s heartbeat)`);
}

// Function to check if we should emit a secrets-update (deduplication)
function shouldEmitUpdate(action, file) {
  const key = `${action}-${file}`;
  const now = Date.now();
  const lastEmission = recentEmissions.get(key);
  
  if (lastEmission && (now - lastEmission) < EMISSION_DEDUP_WINDOW) {
    console.log(`🚫 Skipping duplicate emission: ${action} ${file} (last emission ${now - lastEmission}ms ago)`);
    return false;
  }
  
  recentEmissions.set(key, now);
  
  // Clean up old entries to prevent memory leaks
  if (recentEmissions.size > 100) {
    const cutoff = now - EMISSION_DEDUP_WINDOW * 2;
    for (const [emissionKey, timestamp] of recentEmissions.entries()) {
      if (timestamp < cutoff) {
        recentEmissions.delete(emissionKey);
      }
    }
  }
  
  return true;
}

// Function to check if file/event should be included in activity feed
function shouldShowInActivityFeed(filename) {
  if (!filename) return false;
  
  // Filter out system/internal files and events - only show real secret file changes
  const excludePatterns = [
    'kubectl-detected',
    'filesystem-fallback',
    'manual-refresh',
    'health-refresh'
  ];
  
  // Filter out files that start with .. (Kubernetes internal directories)
  if (filename.startsWith('..')) return false;
  
  // Filter out any filename that matches system patterns
  if (excludePatterns.some(pattern => filename.includes(pattern))) return false;
  
  // Only show actual secret files - must be a real filename
  return filename === 'secrets' || !filename.includes('-');
}

// Function to add activity entry with smart deduplication and throttling
function addActivityEntry(action, file, secrets) {
  // Only add entries for real secret file changes - skip all system events
  if (!shouldShowInActivityFeed(file)) {
    return null;
  }
  
  // Smart deduplication: Check for recent duplicates (within last 30 seconds for VSO)
  // This handles the 10-second VSO refresh cycle plus some buffer
  const now = Date.now();
  const recentDuplicates = activityLog.filter(entry => {
    const entryTime = new Date(entry.timestamp).getTime();
    return (
      entry.action === action &&
      entry.file === file &&
      (now - entryTime) < 30000 // 30 seconds window for VSO cycles
    );
  });
  
  // If we found recent duplicates, update the timestamp of the most recent one
  if (recentDuplicates.length > 0) {
    const mostRecent = recentDuplicates[0];
    const timeSinceLastUpdate = now - new Date(mostRecent.timestamp).getTime();
    
    // Only update if it's been at least 5 seconds since the last update
    if (timeSinceLastUpdate > 5000) {
      console.log(`🔄 Updating timestamp for existing activity entry: ${action} ${file}`);
      mostRecent.timestamp = new Date().toISOString();
      mostRecent.secretCount = Object.keys(secrets).length;
      return mostRecent;
    } else {
      console.log(`🔄 Skipping duplicate activity entry: ${action} ${file} (last update ${Math.round(timeSinceLastUpdate/1000)}s ago)`);
      return recentDuplicates[0];
    }
  }
  
  // Clean up action names for better user experience
  let displayAction = action;
  if (action === 'add') displayAction = 'created';
  else if (action === 'change') displayAction = 'updated';  
  else if (action === 'remove') displayAction = 'deleted';
  
  const entry = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    action: displayAction,
    file,
    secretCount: Object.keys(secrets).length
  };
  
  console.log(`📝 Adding new activity entry: secret "${file}" was ${displayAction} (${entry.secretCount} secrets)`);
  activityLog.unshift(entry); // Add to beginning
  if (activityLog.length > MAX_ACTIVITY_ENTRIES) {
    activityLog = activityLog.slice(0, MAX_ACTIVITY_ENTRIES);
  }
  
  return entry;
}

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from client build
app.use(express.static(path.join(__dirname, 'client/dist')));

// Function to read all secrets from the directory with enhanced Kubernetes projected volume support
function readSecretsFromDirectory() {
  const secrets = {};
  
  try {
    if (fs.existsSync(SECRETS_DIR)) {
      // Clear Node.js file system cache for the secrets directory to ensure fresh reads
      // This is crucial for Kubernetes projected volumes where symlinks are recreated
      delete require.cache[SECRETS_DIR];
      
      // For Kubernetes projected volumes, sometimes we need to re-read the directory
      // to ensure we get fresh file listings
      const files = fs.readdirSync(SECRETS_DIR);
      console.log(`📂 Found ${files.length} files in secrets directory: ${files.join(', ')}`);
      
      files.forEach(file => {
        const filePath = path.join(SECRETS_DIR, file);
        
        // Use lstat instead of stat to handle symlinks properly (Kubernetes projected volumes use symlinks)
        let stats;
        try {
          stats = fs.lstatSync(filePath);
        } catch (err) {
          console.log(`Skipping ${file}: ${err.message}`);
          return;
        }
        
        // Skip directories (like ..data in Kubernetes projected volumes)
        if (stats.isDirectory()) {
          console.log(`📁 Skipping directory: ${file}`);
          return;
        }
        
        // For symlinks, check if they point to directories (like ..data -> ..2025_06_04_11_28_59.2977315065)
        if (stats.isSymbolicLink()) {
          try {
            const symlinkTarget = fs.readlinkSync(filePath);
            const targetStats = fs.statSync(filePath); // This follows the symlink
            if (targetStats.isDirectory()) {
              console.log(`📁 Skipping symlink to directory: ${file} -> ${symlinkTarget}`);
              return;
            }
          } catch (symlinkErr) {
            console.log(`📁 Skipping broken symlink: ${file} (${symlinkErr.message})`);
            return;
          }
        }
        
        if (stats.isFile() || stats.isSymbolicLink()) {
          try {
            // For projected volumes, we might need to read through symlinks
            // Clear any cached file descriptor for this specific file
            delete require.cache[filePath];
            
            const content = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' });
            
            // Get the actual file stats (following symlinks) for metadata
            const realStats = fs.statSync(filePath);
            
            secrets[file] = {
              content: content.trim(),
              lastModified: realStats.mtime.toISOString(),
              size: realStats.size,
              symlinkTarget: stats.isSymbolicLink() ? fs.readlinkSync(filePath) : null
            };
            
            console.log(`📄 Read ${file}: ${content.length} chars, modified: ${realStats.mtime.toISOString()}, symlink: ${stats.isSymbolicLink()}`);
          } catch (err) {
            console.error(`Error reading file ${file}:`, err.message);
            // Don't try to get stats if we failed to read - it might be a directory we missed
            if (!err.message.includes('EISDIR')) {
              try {
                const realStats = fs.statSync(filePath);
                secrets[file] = {
                  content: `Error reading file: ${err.message}`,
                  lastModified: realStats.mtime.toISOString(),
                  size: realStats.size,
                  error: true
                };
              } catch (statErr) {
                console.error(`Error getting stats for ${file}:`, statErr.message);
              }
            } else {
              console.log(`📁 Detected directory via read error, skipping: ${file}`);
            }
          }
        }
      });
    } else {
      console.log(`Secrets directory ${SECRETS_DIR} does not exist yet`);
    }
  } catch (err) {
    console.error('Error reading secrets directory:', err.message);
  }
  
  return secrets;
}

// API endpoint to get current secrets
app.get('/api/secrets', (req, res) => {
  const secrets = readSecretsFromDirectory();
  res.json({
    timestamp: new Date().toISOString(),
    secretsDir: SECRETS_DIR,
    secrets: secrets
  });
});

// API endpoint to get activity log
app.get('/api/activity', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    activity: activityLog.slice(0, 10) // Return last 10 entries
  });
});

// API endpoint to get metrics
app.get('/api/metrics', (req, res) => {
  const secrets = readSecretsFromDirectory();
  const totalSize = Object.values(secrets).reduce((sum, secret) => sum + (secret.size || 0), 0);
  
  // Calculate activity statistics
  const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentActivity = activityLog.filter(entry => new Date(entry.timestamp) > last24Hours);
  
  res.json({
    timestamp: new Date().toISOString(),
    totalSecrets: Object.keys(secrets).length,
    totalSize,
    avgSecretSize: Object.keys(secrets).length > 0 ? Math.round(totalSize / Object.keys(secrets).length) : 0,
    activityLast24h: recentActivity.length,
    lastActivity: activityLog[0]?.timestamp || null,
    secretTypes: Object.keys(secrets).reduce((types, filename) => {
      const ext = path.extname(filename) || 'no-extension';
      types[ext] = (types[ext] || 0) + 1;
      return types;
    }, {})
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    secretsDir: SECRETS_DIR,
    secretsDirExists: fs.existsSync(SECRETS_DIR)
  });
});

// Health check endpoint that also triggers secret refresh
app.get('/api/health-refresh', (req, res) => {
  const secrets = readSecretsFromDirectory();
  io.emit('secrets-update', {
    timestamp: new Date().toISOString(),
    action: 'health-refresh',
    file: 'manual-refresh',
    secrets: secrets
  });
  
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    secretCount: Object.keys(secrets).length,
    refreshTriggered: true
  });
});

// Catch all handler: send back React's index.html file for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

// Socket.io connection handling with enhanced client tracking
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  connectedClients.add(socket.id);
  
  // Send current secrets immediately upon connection
  const currentSecrets = readSecretsFromDirectory();
  socket.emit('secrets-update', {
    timestamp: new Date().toISOString(),
    secrets: currentSecrets,
    source: 'connection-init',
    forceUpdate: true
  });
  
  // Send current activity log
  socket.emit('activity-update', {
    timestamp: new Date().toISOString(),
    activity: activityLog.slice(0, 10)
  });
  
  // Send welcome heartbeat
  socket.emit('heartbeat', {
    timestamp: new Date().toISOString(),
    connectedClients: connectedClients.size,
    lastSync: lastSuccessfulSync,
    message: 'Connected to vault-secrets-demo'
  });
  
  // Handle ping from client
  socket.on('ping', () => {
    socket.emit('pong', {
      timestamp: new Date().toISOString(),
      connectedClients: connectedClients.size,
      serverTime: Date.now()
    });
  });

  // Handle client requests for force refresh
  socket.on('force-refresh', () => {
    console.log('🔄 Force refresh requested by client:', socket.id);
    // Force refresh for all clients, not just the requester
    handleSecretUpdate('client-force-refresh');
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    connectedClients.delete(socket.id);
  });
});

// Fallback filesystem monitoring (used only if kubectl monitoring fails)
let filesystemWatcher = null;

function startFilesystemMonitoring() {
  console.log(`📁 Starting fallback filesystem monitoring for: ${SECRETS_DIR}`);
  
  // More conservative filesystem watcher as fallback
  filesystemWatcher = chokidar.watch(SECRETS_DIR, {
    ignored: /^\./,
    persistent: true,
    ignoreInitial: false,
    followSymlinks: true,
    usePolling: true,
    interval: 2000, // 2 second polling - more conservative for fallback
    awaitWriteFinish: {
      stabilityThreshold: 500, // Wait 500ms for file to stabilize
      pollInterval: 100
    }
  });

  filesystemWatcher
    .on('add', (filePath) => {
      const filename = path.basename(filePath);
      console.log(`File added via fallback: ${filename}`);
      // Add a small delay to batch multiple file changes
      setTimeout(() => handleSecretUpdate('filesystem-fallback'), 200);
    })
    .on('change', (filePath) => {
      const filename = path.basename(filePath);
      console.log(`File changed via fallback: ${filename}`);
      setTimeout(() => handleSecretUpdate('filesystem-fallback'), 200);
    })
    .on('unlink', (filePath) => {
      const filename = path.basename(filePath);
      console.log(`File removed via fallback: ${filename}`);
      setTimeout(() => handleSecretUpdate('filesystem-fallback'), 200);
    })
    .on('error', (error) => {
      console.error('Filesystem watcher error:', error);
    })
    .on('ready', () => {
      console.log('Fallback filesystem watcher ready (conservative mode)');
    });
}

// Initialize monitoring - kubectl-based approach with intelligent fallback
console.log(`🎯 Initializing smart Kubernetes secret monitoring...`);
console.log(`  - Target: ${K8S_SECRET_NAME} in namespace ${K8S_NAMESPACE}`);
console.log(`  - Secrets directory: ${SECRETS_DIR}`);
console.log(`  - Activity throttling: ${ACTIVITY_THROTTLE_MS}ms`);
console.log(`  - Deduplication window: ${EMISSION_DEDUP_WINDOW}ms`);

// Start kubectl-based monitoring (primary strategy)
startKubectlSecretMonitoring();

// Start periodic sync and heartbeat system
startPeriodicSync();

console.log('🎯 Smart Kubernetes secret monitoring initialized');
console.log('  - Primary: kubectl watch for immediate secret updates');
console.log('  - Fallback: conservative filesystem monitoring (only if kubectl fails)');
console.log('  - Smart throttling: Activity updates limited to prevent spam');
console.log('  - Content detection: Only emit when secret content actually changes');
console.log('  - Fast response: 100ms delay after kubectl detection');
console.log('  - Reliability: Periodic sync every 30s, heartbeat every 10s');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  
  if (kubectlWatcher) {
    kubectlWatcher.kill();
  }
  
  if (filesystemWatcher) {
    filesystemWatcher.close();
  }
  
  if (periodicSyncInterval) {
    clearInterval(periodicSyncInterval);
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Smart server running on port ${PORT}`);
  console.log(`Secrets directory: ${SECRETS_DIR}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Monitoring mode: kubectl-based with intelligent fallback`);
  console.log(`Activity throttling: ${ACTIVITY_THROTTLE_MS}ms between activity updates`);
});

// Debounced kubectl update handler to handle rapid successive Vault updates
function handleKubectlUpdate() {
  pendingUpdateCount++;
  console.log(`📊 Kubectl update #${pendingUpdateCount} detected - debouncing...`);
  
  // Clear any existing timeout to restart the debounce timer
  if (updateTimeoutId) {
    clearTimeout(updateTimeoutId);
  }
  
  // Set a shorter debounce but be more aggressive about capturing changes
  updateTimeoutId = setTimeout(() => {
    console.log(`🎯 Processing kubectl update (${pendingUpdateCount} updates detected)`);
    
    // Try immediately first (some projected volumes update quickly)
    console.log(`⚡ Attempting immediate read...`);
    const immediateSecrets = readSecretsFromDirectory();
    const currentSecretsString = JSON.stringify(lastKnownSecrets || {});
    const immediateSecretsString = JSON.stringify(immediateSecrets);
    
    if (currentSecretsString !== immediateSecretsString) {
      console.log(`🎯 Immediate read successful - content changed!`);
      handleSecretUpdate('kubectl-immediate');
      pendingUpdateCount = 0;
      return;
    }
    
    // If immediate read didn't work, use faster retry mechanism
    console.log(`⏳ Immediate read unchanged - starting fast retry sequence...`);
    setTimeout(() => {
      handleSecretUpdateWithRetry('kubectl-detected', 0);
      pendingUpdateCount = 0; // Reset counter after processing
    }, 200); // Much faster initial delay (200ms instead of 500ms)
    
  }, 150); // Reduced debounce window (150ms instead of 300ms)
}
