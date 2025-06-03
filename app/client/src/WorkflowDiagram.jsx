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
      description: 'Node.js app watches files with Chokidar and pushes updates via WebSocket',
      details: 'The Node.js server uses Chokidar to watch the secrets directory for file changes. When changes occur, it reads the updated secrets and broadcasts them to connected React clients via WebSocket.',
      codeTitle: 'File Watching & WebSocket Updates',
      code: `// Server-side file watching (server.js)
const chokidar = require('chokidar');
const watcher = chokidar.watch(SECRETS_DIR, {
  ignored: /^\\./,
  persistent: true,
  ignoreInitial: true
});

watcher
  .on('add', path => {
    const secrets = readSecretsFromDirectory();
    const entry = addActivityEntry('add', path.basename(path), secrets);
    io.emit('secrets-update', {
      secrets,
      timestamp: new Date().toISOString(),
      action: 'add',
      file: path.basename(path)
    });
  })
  .on('change', path => {
    const secrets = readSecretsFromDirectory();
    io.emit('secrets-update', { secrets, action: 'change' });
  });

// Client-side WebSocket handling (App.jsx)
useEffect(() => {
  const socket = io();
  socket.on('secrets-update', (data) => {
    setSecrets(data.secrets);
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          {steps.map((step, index) => (
            <div key={step.id} className="relative">
              {/* Step Card */}
              <div
                className={`relative bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border-2 cursor-pointer transform hover:scale-105 ${
                  selectedStep === step.id ? step.borderColor : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                onClick={() => setSelectedStep(selectedStep === step.id ? null : step.id)}
              >
                {/* Gradient Header */}
                <div className={`h-2 rounded-t-xl bg-gradient-to-r ${step.color}`}></div>
                
                <div className="p-6">
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
                  <p className="text-sm text-gray-600 dark:text-gray-300 text-center">
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
                <div className="hidden lg:block absolute top-1/2 -right-4 transform -translate-y-1/2 z-10">
                  <div className="flex items-center">
                    <div className="w-8 h-0.5 bg-gradient-to-r from-gray-400 to-gray-600 dark:from-gray-500 dark:to-gray-400"></div>
                    <div className="text-gray-600 dark:text-gray-400 text-xl">→</div>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 whitespace-nowrap">
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
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Real-time Updates</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Changes in Vault are reflected in the UI within 2 seconds using file watching and WebSockets.
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

      {/* Technical Details */}
      <div className="mt-8 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          💡 <strong>Pro Tip:</strong> Click on any step above to see the relevant configuration and code.
          The refresh rate is set to 2 seconds for demo purposes - in production, you might use longer intervals.
        </p>
      </div>
    </div>
  );
};

// Remove the old export - using export default function above
