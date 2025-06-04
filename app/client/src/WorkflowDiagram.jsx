import React, { useState } from 'react';

export default function WorkflowDiagram() {
  const [selectedStep, setSelectedStep] = useState(null);
  const [showCode, setShowCode] = useState({});

  const toggleCode = (stepId) => {
    setShowCode(prev => ({
      ...prev,
      [stepId]: !prev[stepId]
    }));
  };

  const steps = [
    {
      id: 'vault',
      title: 'HashiCorp Vault',
      subtitle: 'Secrets Storage',
      icon: '🔐',
      description: 'Vault stores secrets in KV-v2 engine at path secrets/dev',
      details: 'Vault securely stores and manages secrets with encryption at rest and in transit. The KV-v2 engine provides versioning and metadata for secrets.',
      codeTitle: 'Vault KV Store Structure',
      code: `# Vault KV-v2 secrets stored at:
# vault kv put secrets/dev <key>=<value>

vault kv put secrets/dev \\
  api_key="sk-1234567890abcdef" \\
  database_password="super_secure_password" \\
  jwt_token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \\
  ssl_certificate="-----BEGIN CERTIFICATE-----..." \\
  vault_endpoint_url="https://vault.example.com:8200"`,
      color: 'from-yellow-400 to-orange-500',
      borderColor: 'border-orange-500'
    },
    {
      id: 'vso',
      title: 'Vault Secrets Operator',
      subtitle: 'K8s Controller',
      icon: '⚙️',
      description: 'VSO watches VaultStaticSecret CRDs and syncs secrets to Kubernetes',
      details: 'The Vault Secrets Operator continuously monitors VaultStaticSecret custom resources and automatically pulls secrets from Vault, creating or updating corresponding Kubernetes secrets.',
      codeTitle: 'VaultStaticSecret CRD Configuration',
      code: `apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultStaticSecret
metadata:
  name: vault-web-secrets
  namespace: vault-live-secrets-demo
spec:
  vaultAuthRef: vaultauth-vault-live-secrets-demo
  mount: secrets           # Vault KV mount
  type: kv-v2             # Secret engine type
  path: dev               # Path within mount
  destination:
    name: vault-web-secrets  # K8s secret name
    create: true            # Auto-create secret
  refreshAfter: 2s          # Sync frequency`,
      color: 'from-blue-400 to-blue-600',
      borderColor: 'border-blue-500'
    },
    {
      id: 'k8s-secret',
      title: 'Kubernetes Secret',
      subtitle: 'Projected Volume',
      icon: '📦',
      description: 'K8s secret is mounted as files in the pod filesystem',
      details: 'Kubernetes secrets are projected as individual files in the container filesystem. Each secret key becomes a separate file containing the secret value.',
      codeTitle: 'Deployment Volume Mount Configuration',
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: vault-live-secrets-demo
spec:
  template:
    spec:
      containers:
      - name: vault-secrets-web-demo
        volumeMounts:
        - name: vault-secrets
          mountPath: /secrets    # Mount point in container
          readOnly: true
        env:
        - name: SECRETS_DIR
          value: "/secrets"      # App reads from here
      volumes:
      - name: vault-secrets
        projected:
          sources:
          - secret:
              name: vault-web-secrets  # VSO-created secret`,
      color: 'from-green-400 to-green-600',
      borderColor: 'border-green-500'
    },
    {
      id: 'app',
      title: 'React App',
      subtitle: 'Live Updates',
      icon: '⚛️',
      description: 'Node.js app uses kubectl monitoring + Chokidar fallback and pushes updates via WebSocket',
      details: 'The Node.js server primarily uses kubectl to monitor Kubernetes secret changes in real-time, with Chokidar filesystem watching as an intelligent fallback. When changes occur, it reads secrets from the mounted directory (handling Kubernetes projected volumes and symlinks) and broadcasts updates to connected React clients via WebSocket.',
      codeTitle: 'Smart Secret Monitoring & WebSocket Updates',
      code: `// Primary: kubectl-based Kubernetes secret monitoring (server.js)
function startKubectlSecretMonitoring() {
  # Monitor secret resourceVersion changes in real-time
  kubectlWatcher = spawn('kubectl', [
    'get', 'secret', K8S_SECRET_NAME, '-n', K8S_NAMESPACE,
    '-o', 'jsonpath={.metadata.resourceVersion}{\"\\n\"}', '--watch'
  ]);
  
  kubectlWatcher.stdout.on('data', (data) => {
    const resourceVersion = data.toString().trim();
    if (resourceVersion !== lastSecretUpdateTime) {
      # Kubernetes secret changed - trigger debounced update
      handleKubectlUpdate();
    }
  });
}

# Fallback: Chokidar filesystem monitoring (when kubectl unavailable)
function startFilesystemMonitoring() {
  const watcher = chokidar.watch(SECRETS_DIR, {
    followSymlinks: true,    # Handle K8s projected volume symlinks
    usePolling: true,        # More reliable for mounted volumes
    interval: 2000           # Conservative polling for fallback
  });
  
  watcher.on('change', () => {
    handleSecretUpdate('filesystem-fallback');
  });
}

# Read secrets from /secrets directory (handles K8s projected volumes)
function readSecretsFromDirectory() {
  const secrets = {};
  const files = fs.readdirSync(SECRETS_DIR);
  
  files.forEach(file => {
    const filePath = path.join(SECRETS_DIR, file);
    const stats = fs.lstatSync(filePath);  # Handle symlinks properly
    
    if (stats.isFile() || stats.isSymbolicLink()) {
      # Clear Node.js file cache for fresh reads (important for K8s volumes)
      delete require.cache[filePath];
      const content = fs.readFileSync(filePath, 'utf8');
      
      secrets[file] = {
        content: content.trim(),
        lastModified: stats.mtime.toISOString(),
        size: stats.size,
        symlinkTarget: stats.isSymbolicLink() ? fs.readlinkSync(filePath) : null
      };
    }
  });
  
  return secrets;
}

# Debounced update handling for rapid K8s changes
function handleKubectlUpdate() {
  pendingUpdateCount++;
  clearTimeout(updateTimeoutId);
  
  updateTimeoutId = setTimeout(() => {
    # Try immediate read first (some volumes update quickly)
    const secrets = readSecretsFromDirectory();
    if (contentChanged(secrets)) {
      emitSecretsUpdate(secrets, 'kubectl-immediate');
    } else {
      # Use retry mechanism for K8s projected volume delays
      handleSecretUpdateWithRetry('kubectl-detected', 0);
    }
  }, 150); # Short debounce window
}

// Client-side WebSocket handling (App.jsx)
useEffect(() => {
  const socket = io();
  socket.on('secrets-update', (data) => {
    # Force UI re-render with deep cloning for reliable updates
    setSecrets(prevSecrets => ({ 
      ...JSON.parse(JSON.stringify(data.secrets))
    }));
    setLastUpdate(data.timestamp);
  });
}, []);`,
      color: 'from-purple-400 to-pink-500',
      borderColor: 'border-purple-500'
    }
  ];

  const connections = [
    { from: 'vault', to: 'vso', label: 'Vault API' },
    { from: 'vso', to: 'k8s-secret', label: 'K8s API' },
    { from: 'k8s-secret', to: 'app', label: 'File System' }
  ];

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
          🔄 Vault to App Workflow
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
          Interactive diagram showing how secrets flow from HashiCorp Vault through the Vault Secrets Operator 
          to Kubernetes secrets and finally to your React application with live updates.
        </p>
      </div>

      {/* Main Workflow Diagram */}
      <div className="relative">
        {/* Steps Container */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12 items-center">
          {steps.map((step, index) => (
            <div key={step.id} className="relative flex flex-col h-full">
              {/* Step Card */}
              <div
                className={`relative bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border-2 cursor-pointer transform hover:scale-105 flex-1 ${
                  selectedStep === step.id ? step.borderColor : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                onClick={() => setSelectedStep(selectedStep === step.id ? null : step.id)}
              >
                {/* Gradient Header */}
                <div className={`h-2 rounded-t-xl bg-gradient-to-r ${step.color}`}></div>
                
                <div className="p-6 flex flex-col h-full">
                  {/* Icon and Title */}
                  <div className="text-center mb-4">
                    <div className="text-4xl mb-2">{step.icon}</div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {step.title}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {step.subtitle}
                    </p>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-gray-600 dark:text-gray-300 text-center flex-1">
                    {step.description}
                  </p>

                  {/* Step Number */}
                  <div className="absolute -top-3 -left-3 w-8 h-8 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-full flex items-center justify-center text-sm font-bold">
                    {index + 1}
                  </div>
                </div>
              </div>

              {/* Connection Arrow (not for last item) */}
              {index < steps.length - 1 && (
                <div className="hidden lg:flex absolute top-1/2 -right-6 transform -translate-y-1/2 z-10 items-center">
                  <div className="flex items-center">
                    <div className="w-10 h-0.5 bg-gradient-to-r from-gray-400 to-gray-600 dark:from-gray-500 dark:to-gray-400"></div>
                    <div className="text-gray-600 dark:text-gray-400 text-xl ml-1">→</div>
                  </div>
                  <div className="absolute top-6 left-0 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap text-center w-full">
                    {connections[index]?.label}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Mobile Connection Indicators */}
        <div className="lg:hidden flex justify-center items-center space-x-4 mb-8">
          {connections.map((conn, index) => (
            <div key={index} className="flex items-center space-x-2">
              <div className="text-gray-600 dark:text-gray-400 text-2xl">↓</div>
              <span className="text-xs text-gray-500 dark:text-gray-400">{conn.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Step Information */}
      {selectedStep && (
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 border border-gray-200 dark:border-gray-700">
          {(() => {
            const step = steps.find(s => s.id === selectedStep);
            return (
              <div>
                <div className="flex items-center mb-6">
                  <div className="text-3xl mr-4">{step.icon}</div>
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                      {step.title}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400">{step.subtitle}</p>
                  </div>
                </div>

                <p className="text-gray-700 dark:text-gray-300 mb-6 leading-relaxed">
                  {step.details}
                </p>

                {/* Code Section */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleCode(step.id)}
                    className="w-full px-6 py-4 bg-gray-50 dark:bg-gray-700 text-left flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors duration-200"
                  >
                    <span className="font-medium text-gray-900 dark:text-white">
                      📝 {step.codeTitle}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {showCode[step.id] ? '▼' : '▶'}
                    </span>
                  </button>
                  
                  {showCode[step.id] && (
                    <div className="p-6 bg-gray-900 dark:bg-gray-800">
                      <pre className="text-sm text-gray-100 dark:text-gray-200 overflow-x-auto">
                        <code>{step.code}</code>
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Key Features Section */}
      <div className="mt-12 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-700 rounded-xl p-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">
          🚀 Key Features of This Demo
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
            <div className="text-2xl mb-3">⚡</div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Live Updates</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Changes in Vault propagate to the UI in 30-90 seconds through the complete Kubernetes secret management pipeline.
            </p>
          </div>
          
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
            <div className="text-2xl mb-3">🔄</div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">GitOps Ready</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              VSO configuration is managed as code, enabling GitOps workflows for secret management.
            </p>
          </div>
          
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
            <div className="text-2xl mb-3">🔒</div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Zero Trust Security</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Secrets never leave the Kubernetes cluster and are mounted as read-only volumes.
            </p>
          </div>
        </div>
      </div>

      {/* Timing & Delays Education Section */}
      <div className="mt-12 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl p-8 border border-amber-200 dark:border-amber-700">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center flex items-center justify-center">
          ⏰ Understanding Timing & Delays
        </h2>
        
        <div className="max-w-4xl mx-auto">
          <p className="text-gray-700 dark:text-gray-300 mb-6 text-center leading-relaxed">
            <strong>Important:</strong> Delays are normal and expected in Kubernetes environments. Understanding these timing windows 
            helps set proper expectations for secret propagation in production environments.
          </p>
          
          {/* Timing Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md border border-amber-200 dark:border-amber-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                📊 Typical Timing Breakdown
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-600">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">VSO sync cycle:</span>
                  <span className="text-sm font-mono bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded text-blue-800 dark:text-blue-200">10-30s</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-600">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">K8s secret update:</span>
                  <span className="text-sm font-mono bg-green-100 dark:bg-green-900 px-2 py-1 rounded text-green-800 dark:text-green-200">&lt;1s</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-600">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Projected volume sync:</span>
                  <span className="text-sm font-mono bg-orange-100 dark:bg-orange-900 px-2 py-1 rounded text-orange-800 dark:text-orange-200">10-60s</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">App detection:</span>
                  <span className="text-sm font-mono bg-purple-100 dark:bg-purple-900 px-2 py-1 rounded text-purple-800 dark:text-purple-200">&lt;5s</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">Total end-to-end:</span>
                  <span className="text-sm font-mono font-bold bg-amber-100 dark:bg-amber-900 px-2 py-1 rounded text-amber-800 dark:text-amber-200">30-90s</span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md border border-amber-200 dark:border-amber-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                🔍 What Causes Delays?
              </h3>
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs text-blue-600 dark:text-blue-300 font-bold">1</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">VSO Polling</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">VSO checks Vault at configured intervals (refreshAfter)</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-orange-100 dark:bg-orange-900 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs text-orange-600 dark:text-orange-300 font-bold">2</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Projected Volumes</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Kubernetes kubelet updates mounted files asynchronously</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs text-purple-600 dark:text-purple-300 font-bold">3</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">File System Sync</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Node filesystem cache clearing and symlink updates</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Best Practices */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md border border-amber-200 dark:border-amber-700 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              💡 Production Best Practices
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Timing Configuration:</h4>
                <ul className="text-xs space-y-2 text-gray-600 dark:text-gray-400">
                  <li className="flex items-start space-x-2">
                    <span className="text-green-500 dark:text-green-400 font-bold">✓</span>
                    <span>Set VSO <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">refreshAfter</code> to 30s+ for production</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="text-green-500 dark:text-green-400 font-bold">✓</span>
                    <span>Plan for 60-120s end-to-end propagation times</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="text-green-500 dark:text-green-400 font-bold">✓</span>
                    <span>Use health checks with appropriate grace periods</span>
                  </li>
                </ul>
              </div>
              
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Application Design:</h4>
                <ul className="text-xs space-y-2 text-gray-600 dark:text-gray-400">
                  <li className="flex items-start space-x-2">
                    <span className="text-green-500 dark:text-green-400 font-bold">✓</span>
                    <span>Implement graceful secret rotation handling</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="text-green-500 dark:text-green-400 font-bold">✓</span>
                    <span>Cache secrets appropriately to handle delays</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="text-green-500 dark:text-green-400 font-bold">✓</span>
                    <span>Monitor secret age and freshness</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Demo vs Production */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg p-6 border border-blue-200 dark:border-blue-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              🎯 Demo vs Production Configuration
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-semibold text-orange-600 dark:text-orange-400 mb-2">This Demo (Fast):</h4>
                <ul className="text-xs space-y-1 text-gray-600 dark:text-gray-400">
                  <li>• VSO refreshAfter: <code className="bg-orange-100 dark:bg-orange-900 px-1 rounded">2s</code></li>
                  <li>• Fast refresh for demonstration</li>
                  <li>• Optimized for immediate feedback</li>
                  <li>• Not suitable for production load</li>
                </ul>
              </div>
              
              <div>
                <h4 className="text-sm font-semibold text-green-600 dark:text-green-400 mb-2">Production (Stable):</h4>
                <ul className="text-xs space-y-1 text-gray-600 dark:text-gray-400">
                  <li>• VSO refreshAfter: <code className="bg-green-100 dark:bg-green-900 px-1 rounded">30s-300s</code></li>
                  <li>• Balanced performance and freshness</li>
                  <li>• Reduced API load on Vault</li>
                  <li>• Suitable for production workloads</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Technical Details */}
      <div className="mt-8 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          💡 <strong>Pro Tip:</strong> Click on any step above to see the relevant configuration and code.
          Understanding these timing patterns helps you design resilient applications that work well with Kubernetes secret management.
        </p>
      </div>
    </div>
  );
};

// Remove the old export - using export default function above
