const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

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

// In-memory activity log (survives until server restart)
let activityLog = [];
const MAX_ACTIVITY_ENTRIES = 100; // Keep last 100 entries

// Function to add activity entry
function addActivityEntry(action, file, secrets) {
  const entry = {
    id: Date.now() + Math.random(), // Ensure uniqueness
    timestamp: new Date().toISOString(),
    action,
    file,
    secretCount: Object.keys(secrets).length
  };
  
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

// Function to read all secrets from the directory
function readSecretsFromDirectory() {
  const secrets = {};
  
  try {
    if (fs.existsSync(SECRETS_DIR)) {
      const files = fs.readdirSync(SECRETS_DIR);
      
      files.forEach(file => {
        const filePath = path.join(SECRETS_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isFile()) {
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const hasExtension = file.includes('.');
            const extension = hasExtension ? path.extname(file) : 'none';
            
            secrets[file] = {
              content: content.trim(),
              lastModified: stats.mtime,
              size: stats.size
            };
          } catch (err) {
            console.error(`Error reading file ${file}:`, err.message);
            secrets[file] = {
              content: `Error reading file: ${err.message}`,
              lastModified: stats.mtime,
              size: stats.size,
              error: true
            };
          }
        } else {
          // Skip non-files (directories, symlinks, etc.)
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

// Catch all handler: send back React's index.html file for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current secrets immediately upon connection
  const currentSecrets = readSecretsFromDirectory();
  socket.emit('secrets-update', {
    timestamp: new Date().toISOString(),
    secrets: currentSecrets
  });
  
  // Send current activity log
  socket.emit('activity-update', {
    timestamp: new Date().toISOString(),
    activity: activityLog.slice(0, 10)
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Watch the secrets directory for changes
console.log(`Watching secrets directory: ${SECRETS_DIR}`);

// Kubernetes-optimized chokidar configuration with aggressive polling
const watcher = chokidar.watch(SECRETS_DIR, {
  ignored: /^\./,
  persistent: true,
  ignoreInitial: false,
  // Kubernetes secret mounts use symlinks that get swapped atomically
  followSymlinks: true,
  // Always enable polling in Kubernetes environments for reliability
  usePolling: true,
  interval: 500, // Poll every 500ms for faster detection
  binaryInterval: 300, // Even faster for binary files
  // Watch for directory changes too (Kubernetes creates new dirs)
  depth: 2, // Increased depth for Kubernetes mount structure
  // Reduced wait times for faster detection
  awaitWriteFinish: {
    stabilityThreshold: 50,
    pollInterval: 50
  },
  // Additional Kubernetes-specific options
  alwaysStat: true, // Always check file stats
  atomic: true // Handle atomic moves (Kubernetes secret updates)
});

// Additional watcher for parent directory to catch Kubernetes mount behavior
const parentWatcher = chokidar.watch(path.dirname(SECRETS_DIR), {
  ignored: /^\./,
  persistent: true,
  ignoreInitial: true,
  followSymlinks: true,
  usePolling: true,
  interval: 500,
  depth: 1,
  awaitWriteFinish: {
    stabilityThreshold: 50,
    pollInterval: 50
  }
});

parentWatcher
  .on('addDir', (dirPath) => {
    if (dirPath.includes('..data') || path.basename(dirPath) === path.basename(SECRETS_DIR)) {
      console.log(`Parent directory change detected (Kubernetes mount): ${dirPath}`);
      setTimeout(() => {
        const secrets = readSecretsFromDirectory();
        io.emit('secrets-update', {
          timestamp: new Date().toISOString(),
          action: 'mount-refresh',
          file: 'kubernetes-mount',
          secrets: secrets
        });
      }, 200);
    }
  })
  .on('unlinkDir', (dirPath) => {
    if (dirPath.includes('..data') || path.basename(dirPath) === path.basename(SECRETS_DIR)) {
      console.log(`Parent directory removal detected (Kubernetes unmount): ${dirPath}`);
    }
  });

console.log(`Also watching parent directory: ${path.dirname(SECRETS_DIR)} for Kubernetes mount changes`);

watcher
  .on('add', (filePath) => {
    console.log(`File added: ${filePath}`);
    const secrets = readSecretsFromDirectory();
    const activityEntry = addActivityEntry('add', path.basename(filePath), secrets);
    
    io.emit('secrets-update', {
      timestamp: new Date().toISOString(),
      action: 'add',
      file: path.basename(filePath),
      secrets: secrets
    });
    
    io.emit('activity-update', {
      timestamp: new Date().toISOString(),
      activity: activityLog.slice(0, 10),
      newEntry: activityEntry
    });
  })
  .on('change', (filePath) => {
    console.log(`File changed: ${filePath}`);
    const secrets = readSecretsFromDirectory();
    const activityEntry = addActivityEntry('change', path.basename(filePath), secrets);
    
    io.emit('secrets-update', {
      timestamp: new Date().toISOString(),
      action: 'change',
      file: path.basename(filePath),
      secrets: secrets
    });
    
    io.emit('activity-update', {
      timestamp: new Date().toISOString(),
      activity: activityLog.slice(0, 10),
      newEntry: activityEntry
    });
  })
  .on('unlink', (filePath) => {
    console.log(`File removed: ${filePath}`);
    const secrets = readSecretsFromDirectory();
    const activityEntry = addActivityEntry('remove', path.basename(filePath), secrets);
    
    io.emit('secrets-update', {
      timestamp: new Date().toISOString(),
      action: 'remove',
      file: path.basename(filePath),
      secrets: secrets
    });
    
    io.emit('activity-update', {
      timestamp: new Date().toISOString(),
      activity: activityLog.slice(0, 10),
      newEntry: activityEntry
    });
  })
  .on('addDir', (dirPath) => {
    console.log(`Directory added (Kubernetes secret update?): ${dirPath}`);
    // In Kubernetes, secret updates create new directories
    // Trigger immediate refresh - reduced delay for faster response
    setTimeout(() => {
      const secrets = readSecretsFromDirectory();
      console.log('Triggered refresh due to directory change');
      io.emit('secrets-update', {
        timestamp: new Date().toISOString(),
        action: 'refresh',
        file: 'directory-change',
        secrets: secrets
      });
    }, 100); // Reduced from 500ms to 100ms
  })
  .on('unlinkDir', (dirPath) => {
    console.log(`Directory removed (Kubernetes secret cleanup?): ${dirPath}`);
    // Also trigger refresh when directories are removed
    setTimeout(() => {
      const secrets = readSecretsFromDirectory();
      console.log('Triggered refresh due to directory removal');
      io.emit('secrets-update', {
        timestamp: new Date().toISOString(),
        action: 'refresh',
        file: 'directory-removal',
        secrets: secrets
      });
    }, 100);
  })
  .on('error', (error) => {
    console.error('Watcher error:', error);
    io.emit('secrets-error', {
      timestamp: new Date().toISOString(),
      error: error.message
    });
  })
  .on('ready', () => {
    console.log('File watcher ready. Watching for changes...');
  });

// Additional fallback: aggressive polling for Kubernetes environments
// This ensures we catch changes even if file events are missed
let lastSecretHash = '';

const pollSecrets = () => {
  const secrets = readSecretsFromDirectory();
  // Create a more comprehensive hash that includes content and metadata
  const secretData = Object.entries(secrets).map(([filename, data]) => ({
    filename,
    content: data.content,
    lastModified: data.lastModified?.getTime() || 0,
    size: data.size || 0
  }));
  const currentHash = JSON.stringify(secretData);
  
  if (currentHash !== lastSecretHash && lastSecretHash !== '') {
    console.log('Fallback polling detected secret changes');
    const activityEntry = addActivityEntry('poll-refresh', 'fallback-detection', secrets);
    
    io.emit('secrets-update', {
      timestamp: new Date().toISOString(),
      action: 'poll-refresh',
      file: 'fallback-detection',
      secrets: secrets
    });
    
    io.emit('activity-update', {
      timestamp: new Date().toISOString(),
      activity: activityLog.slice(0, 10),
      newEntry: activityEntry
    });
  }
  
  lastSecretHash = currentHash;
};

// Aggressive polling every 1 second (reduced from 5 seconds)
setInterval(pollSecrets, 1000);
console.log('Aggressive fallback polling enabled (every 1 second)');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  watcher.close();
  parentWatcher.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Secrets directory: ${SECRETS_DIR}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
