import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

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

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    const socket = io();

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
      console.log('Secrets update received:', data);
      setSecrets(data.secrets);
      setLastUpdate(data.timestamp);
      
      // Add to activity log
      const activityEntry = {
        id: Date.now(),
        timestamp: data.timestamp,
        action: data.action || 'update',
        file: data.file || 'multiple files',
        secretCount: Object.keys(data.secrets).length
      };
      
      setActivity(prev => [activityEntry, ...prev.slice(0, 9)]); // Keep last 10 entries
    });

    socket.on('secrets-error', (data) => {
      console.error('Secrets error:', data);
      setError(data.error);
    });

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

    return () => {
      socket.disconnect();
    };
  }, []);

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getActionColor = (action) => {
    switch (action) {
      case 'add': return 'text-green-600 bg-green-100';
      case 'change': return 'text-blue-600 bg-blue-100';
      case 'remove': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getActionIcon = (action) => {
    switch (action) {
      case 'add': return '+';
      case 'change': return '~';
      case 'remove': return '-';
      default: return '•';
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
              <div className="hidden sm:block text-sm text-gray-500 dark:text-gray-400">
                Vault → VSO → Kubernetes → Web UI
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
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
              
              {lastUpdate && (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Last update: {formatTimestamp(lastUpdate)}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Secrets Panel */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow transition-colors duration-200">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Live Secrets ({Object.keys(secrets).length})
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
                
                {Object.keys(secrets).length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-gray-400 dark:text-gray-500 text-6xl mb-4">📁</div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No secrets found</h3>
                    <p className="text-gray-500 dark:text-gray-400">
                      Waiting for Vault Secrets Operator to sync secrets to /secrets directory...
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(secrets).map(([filename, data]) => (
                      <div key={filename} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 fade-in bg-white dark:bg-gray-750">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-medium text-gray-900 dark:text-white flex items-center flex-1 min-w-0 mr-4">
                            <span className="text-blue-500 mr-2 flex-shrink-0">📄</span>
                            <span className="break-words">{filename}</span>
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
                        
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                          Last modified: {new Date(data.lastModified).toLocaleString()}
                        </div>
                      </div>
                    ))}
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
                            <span className="font-medium break-words">{entry.file}</span> was{' '}
                            <span className={getActionColor(entry.action).split(' ')[0]}>
                              {entry.action === 'change' ? 'modified' : entry.action === 'add' ? 'added' : 'removed'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {formatTimestamp(entry.timestamp)} • {entry.secretCount} total secrets
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
              <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">How it works</h3>
              <div className="space-y-2 text-xs text-blue-800 dark:text-blue-200">
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400">1.</span>
                  <span>VSO pulls from Vault every 30s</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400">2.</span>
                  <span>Updates Kubernetes Secret</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400">3.</span>
                  <span>Projected as files in /secrets</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400">4.</span>
                  <span>Chokidar watches & pushes via WebSocket</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-500 dark:text-blue-400">5.</span>
                  <span>React updates live—no refresh!</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
