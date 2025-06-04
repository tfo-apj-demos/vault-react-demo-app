import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import WorkflowDiagram from './WorkflowDiagram';

function App() {
  const [secrets, setSecrets] = useState({});
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });
  
  // New state for modern features
  const [metrics, setMetrics] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [selectedSecret, setSelectedSecret] = useState(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [filteredSecrets, setFilteredSecrets] = useState({});
  const [secretFormat, setSecretFormat] = useState({});
  const [showExportModal, setShowExportModal] = useState(false);
  const [activeTab, setActiveTab] = useState('secrets'); // New tab state

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Filter secrets based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredSecrets(secrets);
    } else {
      const filtered = {};
      const query = searchQuery.toLowerCase();
      
      Object.entries(secrets).forEach(([filename, data]) => {
        if (filename.toLowerCase().includes(query) || 
            data.content.toLowerCase().includes(query)) {
          filtered[filename] = data;
        }
      });
      
      setFilteredSecrets(filtered);
    }
  }, [secrets, searchQuery]);

  // Fetch metrics periodically
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await fetch('/api/metrics');
        const data = await response.json();
        setMetrics(data);
      } catch (err) {
        console.error('Failed to fetch metrics:', err);
      }
    };

    fetchMetrics(); // Initial fetch
    const interval = setInterval(fetchMetrics, 30000); // Every 30s
    return () => clearInterval(interval);
  }, []);

  // Auto-remove notifications - only set timeout for new notifications
  useEffect(() => {
    const newNotifications = notifications.filter(n => !n.timeoutSet);
    newNotifications.forEach(notification => {
      if (notification.id) {
        // Mark this notification as having a timeout set
        notification.timeoutSet = true;
        setTimeout(() => {
          setNotifications(prev => prev.filter(n => n.id !== notification.id));
        }, 8000); // Increased to 8 seconds for better visibility
      }
    });
  }, [notifications]);

  useEffect(() => {
    const socket = io();
    
    // Store socket instance globally for refresh button access
    window.socketInstance = socket;

    socket.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);
      setError(null);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    socket.on('secrets-update', (data) => {
      console.log('🔄 Secrets update received:', {
        source: data.source,
        forceUpdate: data.forceUpdate,
        secretCount: Object.keys(data.secrets || {}).length,
        syncId: data.syncId,
        timestamp: data.timestamp
      });
      
      // Force state update with completely new object references
      const newSecrets = JSON.parse(JSON.stringify(data.secrets || {}));
      setSecrets(newSecrets);
      setLastUpdate(data.timestamp);
      
      // Always force filtered secrets update to trigger re-render
      setFilteredSecrets(prev => {
        const filtered = searchQuery.trim() ? 
          Object.fromEntries(
            Object.entries(newSecrets).filter(([filename, data]) => 
              filename.toLowerCase().includes(searchQuery.toLowerCase()) || 
              data.content.toLowerCase().includes(searchQuery.toLowerCase())
            )
          ) : newSecrets;
        return JSON.parse(JSON.stringify(filtered));
      });
      
      // Force re-render by triggering state updates
      if (data.forceUpdate) {
        console.log('🔄 Force update applied - UI should refresh now');
        // Force component re-render by updating multiple states with fresh references
        setSecretFormat(prev => ({ ...prev }));
        setError(null); // Clear any previous errors
      }
      
      // Add notification for secret changes
      if (data.action && data.file) {
        addNotification({
          type: data.action === 'add' ? 'success' : data.action === 'change' ? 'info' : 'warning',
          message: `Secret "${data.file}" was ${data.action === 'add' ? 'added' : data.action === 'change' ? 'updated' : 'removed'}`,
          timestamp: data.timestamp
        });
      }
      
      // Skip adding to activity log - the server now handles this properly
      // Only server-side activity-update events will update the activity feed
      // This eliminates duplicate and system noise from the client side
    });

    socket.on('secrets-error', (data) => {
      console.error('Secrets error:', data);
      setError(data.error);
    });

    // Handle dedicated activity updates from server
    socket.on('activity-update', (data) => {
      console.log('Activity update received:', data);
      if (data.activity) {
        setActivity(data.activity);
      } else if (data.newEntry) {
        // Add new activity entry from server
        setActivity(prev => [data.newEntry, ...prev.slice(0, 9)]);
      }
    });

    // Handle heartbeat for connection health
    socket.on('heartbeat', (data) => {
      console.log(`💓 Heartbeat received: ${data.connectedClients} clients, ${data.secretCount} secrets`);
      // Update connection health
      setConnected(true);
      setError(null);
    });

    // Handle pong responses
    socket.on('pong', (data) => {
      console.log('🏓 Pong received from server - connection healthy', {
        connectedClients: data.connectedClients,
        timestamp: data.timestamp
      });
    });

    // Send periodic ping to maintain connection
    const pingInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('ping');
      }
    }, 30000); // Ping every 30 seconds

    // Fetch initial data
    fetch('/api/secrets')
      .then(res => res.json())
      .then(data => {
        setSecrets(data.secrets);
        setLastUpdate(data.timestamp);
      })
      .catch(err => {
        console.error('Failed to fetch initial secrets:', err);
        setError(err.message);
      });

    // Fetch initial activity history
    fetch('/api/activity')
      .then(res => res.json())
      .then(data => {
        if (data.activity) {
          setActivity(data.activity);
        }
      })
      .catch(err => {
        console.error('Failed to fetch initial activity:', err);
      });

    return () => {
      clearInterval(pingInterval);
      if (window.socketInstance) {
        delete window.socketInstance;
      }
      socket.disconnect();
    };
  }, []);

  // Helper functions
  const addNotification = (notification) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { ...notification, id }]);
  };

  const validateSecretFormat = (content, filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    // If filename has no extension or extension equals filename, try content-based detection
    const hasExtension = filename.includes('.') && ext !== filename;
    
    try {
      switch (ext) {
        case 'json':
          JSON.parse(content);
          return { valid: true, format: 'JSON', icon: '📋' };
        case 'yaml':
        case 'yml':
          // Basic YAML validation
          if (content.includes('---') || content.includes(':')) {
            return { valid: true, format: 'YAML', icon: '📄' };
          }
          return { valid: false, format: 'YAML', icon: '⚠️' };
        case 'env':
          // ENV file validation
          const lines = content.split('\n').filter(line => line.trim());
          const validEnv = lines.every(line => 
            line.startsWith('#') || line.includes('=') || line.trim() === ''
          );
          return { valid: validEnv, format: 'ENV', icon: '🔧' };
        case 'txt':
          return { valid: true, format: 'Text', icon: '📝' };
        case 'pem':
        case 'key':
        case 'crt':
          return { valid: true, format: 'Certificate/Key', icon: '🔐' };
        default:
          // Content-based detection when no file extension
          if (!hasExtension) {
            // JWT token detection
            if (content.startsWith('eyJ') && content.split('.').length === 3) {
              return { valid: true, format: 'JWT Token', icon: '🎫' };
            }
            
            // JSON detection
            try {
              JSON.parse(content);
              return { valid: true, format: 'JSON', icon: '📋' };
            } catch (e) {
              // Not JSON, continue checking
            }
            
            // YAML detection
            if (content.includes('---') || (content.includes(':') && content.includes('\n'))) {
              return { valid: true, format: 'YAML', icon: '📄' };
            }
            
            // ENV format detection
            const lines = content.split('\n').filter(line => line.trim());
            if (lines.length > 0 && lines.every(line => 
              line.startsWith('#') || line.includes('=') || line.trim() === ''
            )) {
              return { valid: true, format: 'ENV', icon: '🔧' };
            }
            
            // Certificate/Key detection
            if (content.includes('-----BEGIN') && content.includes('-----END')) {
              return { valid: true, format: 'Certificate/Key', icon: '🔐' };
            }
            
            // Database URL detection
            if (content.match(/^(postgresql|mysql|mongodb|redis):\/\//)) {
              return { valid: true, format: 'Database URL', icon: '🗄️' };
            }
            
            // API Key detection (alphanumeric strings)
            if (content.match(/^[a-zA-Z0-9_-]{16,}$/) && !content.includes(' ')) {
              return { valid: true, format: 'API Key', icon: '🔑' };
            }
            
            // Default to plain text for files without extensions
            return { valid: true, format: 'Text', icon: '📝' };
          }
          
          // JWT token detection for files with unknown extensions
          if (content.startsWith('eyJ') && content.split('.').length === 3) {
            return { valid: true, format: 'JWT Token', icon: '🎫' };
          }
          
          console.log(`Unknown format for file: "${filename}", content starts with: "${content.substring(0, 50)}"`); // Debug logging
          return { valid: true, format: 'Unknown', icon: '📄' };
      }
    } catch (e) {
      console.error(`Error validating format for file: "${filename}":`, e.message); // Debug logging
      return { valid: false, format: ext?.toUpperCase() || 'Unknown', icon: '⚠️' };
    }
  };

  const exportSecrets = (format = 'json') => {
    const timestamp = new Date().toISOString().split('T')[0];
    let content, filename, mimeType;

    switch (format) {
      case 'json':
        content = JSON.stringify(secrets, null, 2);
        filename = `vault-secrets-${timestamp}.json`;
        mimeType = 'application/json';
        break;
      case 'yaml':
        // Simple YAML export
        content = Object.entries(secrets).map(([name, data]) => 
          `# ${name}\n${name}:\n  content: |\n    ${data.content.split('\n').join('\n    ')}\n  size: ${data.size}\n  lastModified: ${data.lastModified}\n`
        ).join('\n');
        filename = `vault-secrets-${timestamp}.yaml`;
        mimeType = 'text/yaml';
        break;
      case 'csv':
        const csvRows = [
          ['Filename', 'Size', 'Last Modified', 'Content Preview'],
          ...Object.entries(secrets).map(([name, data]) => [
            name,
            data.size,
            formatTimestamp(data.lastModified),
            data.content.substring(0, 100) + (data.content.length > 100 ? '...' : '')
          ])
        ];
        content = csvRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
        filename = `vault-secrets-${timestamp}.csv`;
        mimeType = 'text/csv';
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    addNotification({
      type: 'success',
      message: `Exported ${Object.keys(secrets).length} secrets as ${format.toUpperCase()}`,
      timestamp: new Date().toISOString()
    });
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', { 
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  };

  const getActionColor = (action) => {
    switch (action) {
      case 'add':
      case 'created': 
        return 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900';
      case 'change':
      case 'updated':
        return 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900';
      case 'remove':
      case 'deleted':
        return 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900';
      default: 
        return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-700';
    }
  };

  const getActionIcon = (action) => {
    switch (action) {
      case 'add':
      case 'created': 
        return '+';
      case 'change':
      case 'updated':
        return '~';
      case 'remove':
      case 'deleted':
        return '-';
      default: 
        return '•';
    }
  };

  const getActionDescription = (action) => {
    switch (action) {
      case 'add': return 'was created';
      case 'created': return 'was created';
      case 'change': return 'was updated';
      case 'updated': return 'was updated';
      case 'remove': return 'was deleted';
      case 'deleted': return 'was deleted';
      default: return 'was changed';
    }
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-vault-yellow rounded flex items-center justify-center">
                  <span className="text-vault-dark font-bold text-sm">V</span>
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Vault Secrets Demo
                </h1>
              </div>
              
              {/* Tab Navigation */}
              <div className="hidden md:flex space-x-1 ml-8">
                <button
                  onClick={() => setActiveTab('secrets')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                    activeTab === 'secrets'
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  🔐 Live Secrets
                </button>
                <button
                  onClick={() => setActiveTab('workflow')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                    activeTab === 'workflow'
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  🔄 How It Works
                </button>
              </div>
              
              {/* Search Bar - only show on secrets tab */}
              {activeTab === 'secrets' && (
                <div className="hidden md:block">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-400">🔍</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Search secrets..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="block w-64 pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md leading-5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex items-center space-x-4">
              {/* Tab-specific buttons */}
              {activeTab === 'secrets' && (
                <>
                  {/* Metrics Toggle */}
                  <button
                    onClick={() => setShowMetrics(!showMetrics)}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                      showMetrics 
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' 
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    📊 Metrics
                  </button>

                  {/* Refresh Button */}
                  <button
                    onClick={() => {
                      console.log('🔄 Manual refresh triggered');
                      // Use WebSocket for force refresh if connected
                      if (connected && window.socketInstance) {
                        window.socketInstance.emit('force-refresh');
                        addNotification({
                          type: 'info',
                          message: 'Force refresh requested...',
                          timestamp: new Date().toISOString()
                        });
                      } else {
                        // Fallback to HTTP API
                        fetch('/api/secrets')
                          .then(res => res.json())
                          .then(data => {
                            const newSecrets = { ...data.secrets };
                            setSecrets(newSecrets);
                            setFilteredSecrets(newSecrets);
                            setLastUpdate(data.timestamp);
                            addNotification({
                              type: 'success',
                              message: 'Secrets refreshed successfully',
                              timestamp: new Date().toISOString()
                            });
                          })
                          .catch(err => {
                            console.error('Failed to refresh secrets:', err);
                            addNotification({
                              type: 'error',
                              message: 'Failed to refresh secrets',
                              timestamp: new Date().toISOString()
                            });
                          });
                      }
                    }}
                    className="px-3 py-2 rounded-md text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors duration-200"
                  >
                    🔄 Refresh
                  </button>

                  {/* Export Button */}
                  <button
                    onClick={() => setShowExportModal(true)}
                    className="px-3 py-2 rounded-md text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors duration-200"
                  >
                    📤 Export
                  </button>
                </>
              )}

              {/* Theme Toggle Button */}
              <button
                onClick={toggleDarkMode}
                className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 hover:scale-105"
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <span className="text-lg transition-transform duration-300 inline-block hover:rotate-12">
                  {darkMode ? '☀️' : '🌙'}
                </span>
              </button>
              
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}>
                  {connected && <div className="w-3 h-3 rounded-full bg-green-500 pulse-ring"></div>}
                </div>
                <span className={`text-sm font-medium ${connected ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>

          {/* Mobile Tab Navigation */}
          <div className="md:hidden mt-4">
            <div className="flex space-x-1">
              <button
                onClick={() => setActiveTab('secrets')}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                  activeTab === 'secrets'
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                🔐 Secrets
              </button>
              <button
                onClick={() => setActiveTab('workflow')}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                  activeTab === 'workflow'
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                🔄 How It Works
              </button>
            </div>
          </div>

          {/* Mobile Search Bar - only show on secrets tab */}
          {activeTab === 'secrets' && (
            <div className="md:hidden mt-4">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-400">🔍</span>
                </div>
                <input
                  type="text"
                  placeholder="Search secrets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md leading-5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                />
              </div>
            </div>
          )}

          {/* Metrics Dashboard - only show on secrets tab */}
          {activeTab === 'secrets' && showMetrics && metrics.totalSecrets !== undefined && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <div className="text-sm font-medium text-blue-600 dark:text-blue-400">Total Secrets</div>
                <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{metrics.totalSecrets}</div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                <div className="text-sm font-medium text-green-600 dark:text-green-400">Total Size</div>
                <div className="text-2xl font-bold text-green-900 dark:text-green-100">{(metrics.totalSize / 1024).toFixed(1)}KB</div>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
                <div className="text-sm font-medium text-purple-600 dark:text-purple-400">Avg Size</div>
                <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">{metrics.avgSecretSize}B</div>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4">
                <div className="text-sm font-medium text-orange-600 dark:text-orange-400">Activity 24h</div>
                <div className="text-2xl font-bold text-orange-900 dark:text-orange-100">{metrics.activityLast24h || 0}</div>
              </div>
            </div>
          )}

          {/* Search Results Info - only show on secrets tab */}
          {activeTab === 'secrets' && searchQuery && (
            <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              Found {Object.keys(filteredSecrets).length} of {Object.keys(secrets).length} secrets matching "{searchQuery}"
            </div>
          )}

          {activeTab === 'secrets' && lastUpdate && (
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Last update: {formatTimestamp(lastUpdate)}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'secrets' ? (
          // SECRETS TAB CONTENT
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Secrets Panel */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow transition-colors duration-200">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Live Secrets ({Object.keys(filteredSecrets).length}{searchQuery && ` of ${Object.keys(secrets).length}`})
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Secrets are automatically synced from Vault via Vault Secrets Operator
                </p>
              </div>
              
              <div className="p-6">
                {error && (
                  <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                    <div className="flex">
                      <div className="text-red-400">⚠</div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error</h3>
                        <div className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</div>
                      </div>
                    </div>
                  </div>
                )}
                
                {Object.keys(filteredSecrets).length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-gray-400 dark:text-gray-500 text-6xl mb-4">
                      {searchQuery ? '🔍' : '📁'}
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                      {searchQuery ? 'No matching secrets found' : 'No secrets found'}
                    </h3>
                    <p className="text-gray-500 dark:text-gray-400">
                      {searchQuery 
                        ? `Try adjusting your search term "${searchQuery}"`
                        : 'Waiting for Vault Secrets Operator to sync secrets to /secrets directory...'
                      }
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(filteredSecrets)
                      .sort(([, a], [, b]) => new Date(b.lastModified) - new Date(a.lastModified))
                      .map(([filename, data]) => {
                      const formatInfo = validateSecretFormat(data.content, filename);
                      return (
                        <div key={filename} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 fade-in bg-white dark:bg-gray-750 hover:shadow-md transition-shadow duration-200">
                          <div className="flex justify-between items-start mb-2">
                            <h3 className="font-medium text-gray-900 dark:text-white flex items-center flex-1 min-w-0 mr-4">
                              <span className="mr-2 flex-shrink-0">{formatInfo.icon}</span>
                              <span className="break-words">{filename}</span>
                              <span className={`ml-2 px-2 py-1 text-xs rounded-full flex-shrink-0 ${
                                formatInfo.valid 
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                  : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                              }`}>
                                {formatInfo.format}
                              </span>
                            </h3>
                            <div className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                              {data.size} bytes
                            </div>
                          </div>
                          
                          <div className="bg-gray-50 dark:bg-gray-800 rounded p-3 mt-2 overflow-hidden">
                            <code className={`text-sm block whitespace-pre-wrap break-words overflow-x-auto max-w-full ${data.error ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>
                              {data.content}
                            </code>
                          </div>
                          
                          <div className="flex justify-between items-center text-xs text-gray-400 dark:text-gray-500 mt-2">
                            <span>Last modified: {formatTimestamp(data.lastModified)}</span>
                            {selectedSecret === filename && (
                              <button
                                onClick={() => setSelectedSecret(null)}
                                className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                              >
                                Hide details
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Activity Panel */}
          <div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow transition-colors duration-200">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Activity Feed</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Real-time file system changes
                </p>
              </div>
              
              <div className="p-6">
                {activity.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-gray-400 dark:text-gray-500 text-4xl mb-2">📊</div>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">No activity yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activity.map((entry) => (
                      <div key={entry.id} className="flex items-start space-x-3 fade-in">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${getActionColor(entry.action)}`}>
                          {getActionIcon(entry.action)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-900 dark:text-white">
                            <span className="font-medium break-words">{entry.file}</span>{' '}
                            <span className={`${getActionColor(entry.action).split(' ')[0]} font-medium`}>
                              {getActionDescription(entry.action)}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {formatTimestamp(entry.timestamp)} • {entry.secretCount} total secret{entry.secretCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            {/* Info Panel */}
            <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 transition-colors duration-200">
              <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3 flex items-center">
                <span className="mr-2">🔄</span>
                How secret propagation works
              </h3>
              <div className="space-y-2 text-xs text-blue-800 dark:text-blue-200">
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400 font-mono text-xs">1.</span>
                  <span>VSO polls Vault for changes (configurable interval)</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400 font-mono text-xs">2.</span>
                  <span>Updates Kubernetes Secret via K8s API</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400 font-mono text-xs">3.</span>
                  <span>kubelet syncs projected volume files (async)</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400 font-mono text-xs">4.</span>
                  <span>kubectl monitoring detects resourceVersion change</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400 font-mono text-xs">5.</span>
                  <span>App reads files & broadcasts via WebSocket</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400 font-mono text-xs">6.</span>
                  <span>React UI updates automatically—no refresh!</span>
                </div>
              </div>
              
              {/* Timing Details */}
              <div className="mt-4 pt-3 border-t border-blue-200 dark:border-blue-700">
                <h4 className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-2 flex items-center">
                  <span className="mr-1">⏰</span>
                  Typical timing in Kubernetes
                </h4>
                <div className="space-y-1 text-xs text-blue-700 dark:text-blue-300">
                  <div className="flex justify-between">
                    <span>End-to-end propagation:</span>
                    <span className="font-mono text-amber-600 dark:text-amber-400">30-90s</span>
                  </div>
                  <div className="flex justify-between">
                    <span>VSO sync cycle:</span>
                    <span className="font-mono text-blue-600 dark:text-blue-400">10-30s</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Projected volume sync:</span>
                    <span className="font-mono text-orange-600 dark:text-orange-400">10-60s</span>
                  </div>
                  <div className="flex justify-between">
                    <span>App detection & update:</span>
                    <span className="font-mono text-green-600 dark:text-green-400">&lt;5s</span>
                  </div>
                </div>
                
                {/* Educational Note */}
                <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-700">
                  <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                    <span className="font-semibold">⚠️ Important:</span> These delays are <em>normal and expected</em> in production Kubernetes environments. 
                    The projected volume synchronization involves multiple layers:
                  </p>
                  <ul className="text-xs text-amber-700 dark:text-amber-300 mt-2 space-y-1 ml-4">
                    <li>• kubelet polling intervals for secret updates</li>
                    <li>• Node filesystem cache clearing and symlink updates</li>
                    <li>• Container runtime volume mount propagation</li>
                  </ul>
                  <p className="text-xs text-amber-800 dark:text-amber-200 mt-2">
                    Design your applications to handle these timing windows gracefully. In this demo, VSO uses a 2s refresh 
                    for demonstration—production should use 30s+ intervals.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
        ) : (
          // WORKFLOW TAB CONTENT
          <WorkflowDiagram />
        )}
      </main>

      {/* Toast Notifications */}
      <div className="fixed inset-x-0 top-0 flex justify-end p-4 z-50 pointer-events-none" style={{ paddingTop: '140px' }}>
        <div className="space-y-2 max-w-sm pointer-events-auto">
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className={`w-full bg-white dark:bg-gray-800 shadow-xl rounded-lg pointer-events-auto ring-1 ring-black ring-opacity-5 overflow-hidden transform transition-all duration-500 ease-in-out slide-in-right ${
              notification.type === 'success' ? 'border-l-4 border-green-500' :
              notification.type === 'warning' ? 'border-l-4 border-orange-500' :
              notification.type === 'error' ? 'border-l-4 border-red-500' :
              'border-l-4 border-blue-500'
            }`}
            style={{
              animation: 'slideInRight 0.3s ease-out, fadeIn 0.3s ease-out'
            }}
          >
            <div className="p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <span className="text-xl">
                    {notification.type === 'success' ? '✅' :
                     notification.type === 'warning' ? '⚠️' :
                     notification.type === 'error' ? '❌' : 'ℹ️'}
                  </span>
                </div>
                <div className="ml-3 w-0 flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white break-words overflow-wrap-anywhere">
                    {notification.message}
                  </p>
                  {notification.timestamp && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 break-words">
                      {formatTimestamp(notification.timestamp)}
                    </p>
                  )}
                </div>
                <div className="ml-4 flex-shrink-0 flex">
                  <button
                    className="rounded-md inline-flex text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 focus:outline-none transition-colors duration-200"
                    onClick={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
                  >
                    <span className="sr-only">Close</span>
                    <span className="text-lg font-bold">×</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity modal-backdrop" onClick={() => setShowExportModal(false)}></div>
            
            {/* This element is to trick the browser into centering the modal contents. */}
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            
            <div className="relative inline-block align-bottom bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white dark:bg-gray-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900 sm:mx-0 sm:h-10 sm:w-10">
                    <span className="text-blue-600 dark:text-blue-400 text-xl">📤</span>
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">
                      Export Secrets
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Choose a format to export all {Object.keys(secrets).length} secrets.
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="mt-5 sm:mt-6">
                  <div className="space-y-3">
                    <button
                      onClick={() => { exportSecrets('json'); setShowExportModal(false); }}
                      className="w-full flex items-center px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
                    >
                      <span className="mr-3 text-lg flex-shrink-0">📋</span>
                      <div className="text-left flex-1">
                        <div className="font-medium text-gray-900 dark:text-white">JSON Format</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">Complete data with metadata</div>
                      </div>
                    </button>
                    
                    <button
                      onClick={() => { exportSecrets('yaml'); setShowExportModal(false); }}
                      className="w-full flex items-center px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
                    >
                      <span className="mr-3 text-lg flex-shrink-0">📄</span>
                      <div className="text-left flex-1">
                        <div className="font-medium text-gray-900 dark:text-white">YAML Format</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">Human-readable format</div>
                      </div>
                    </button>
                    
                    <button
                      onClick={() => { exportSecrets('csv'); setShowExportModal(false); }}
                      className="w-full flex items-center px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
                    >
                      <span className="mr-3 text-lg flex-shrink-0">📊</span>
                      <div className="text-left flex-1">
                        <div className="font-medium text-gray-900 dark:text-white">CSV Format</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">Spreadsheet compatible</div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 shadow-sm px-4 py-2 bg-white dark:bg-gray-800 text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm transition-colors duration-200"
                  onClick={() => setShowExportModal(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
