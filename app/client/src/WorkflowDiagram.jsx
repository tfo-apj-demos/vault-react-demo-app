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

  // Enhanced syntax highlighting function
  const highlightLine = (line, stepId) => {
    if (!line.trim()) return <span>&nbsp;</span>;
    
    // Track if we've already highlighted this line
    let highlightedLine = line;
    const tokens = [];
    let currentPos = 0;
    
    // Define patterns for different types of content
    const patterns = [
      // Comments (highest priority)
      { regex: /(#[^\n]*)/g, className: 'text-green-400 italic' },
      // YAML/JSON keys (improved pattern for nested keys)
      { regex: /^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/g, className: 'text-blue-300 font-medium', keepIndent: true },
      // YAML values after colon
      { regex: /:\s+([^\s#]+)/g, className: 'text-yellow-300', group: 1 },
      // Strings in quotes
      { regex: /("[^"]*")/g, className: 'text-yellow-300' },
      // Shell commands and YAML keywords
      { regex: /\b(vault|kubectl|apiVersion|kind|metadata|spec|mount|type|name|namespace|vaultAuthRef|path|destination|create|refreshAfter|kv-v2|sources|secret|projected|volumeMounts|mountPath|readOnly|containers|template)\b/g, className: 'text-purple-400 font-semibold' },
      // JavaScript keywords
      { regex: /\b(function|const|let|var|if|else|return|spawn|setTimeout|useEffect|forEach|require|module|exports)\b/g, className: 'text-pink-400 font-medium' },
      // Numbers and time values
      { regex: /\b(\d+[a-zA-Z]*|true|false)\b/g, className: 'text-orange-400' },
      // Operators
      { regex: /([=<>!&|+\-*\/])/g, className: 'text-cyan-400' }
    ];
    
    // Find all matches
    const matches = [];
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        // Handle special cases for YAML keys with indentation
        if (pattern.keepIndent) {
          matches.push({
            start: match.index + match[1].length, // Skip indentation
            end: match.index + match[1].length + match[2].length,
            text: match[2],
            className: pattern.className,
            fullMatch: match[0]
          });
        } else {
          matches.push({
            start: match.index,
            end: match.index + match[0].length,
            text: pattern.group ? match[pattern.group] : match[1] || match[0],
            className: pattern.className,
            fullMatch: match[0]
          });
        }
      }
    });
    
    // Sort matches by position
    matches.sort((a, b) => a.start - b.start);
    
    // Remove overlapping matches (keep the first one)
    const filteredMatches = [];
    let lastEnd = 0;
    matches.forEach(match => {
      if (match.start >= lastEnd) {
        filteredMatches.push(match);
        lastEnd = match.end;
      }
    });
    
    // Build the JSX elements
    const elements = [];
    let currentIndex = 0;
    
    filteredMatches.forEach((match, i) => {
      // Add text before the match
      if (match.start > currentIndex) {
        elements.push(
          <span key={`text-${i}`} className="text-gray-100">
            {line.substring(currentIndex, match.start)}
          </span>
        );
      }
      
      // Add the highlighted match
      elements.push(
        <span key={`match-${i}`} className={match.className}>
          {match.text}
        </span>
      );
      
      currentIndex = match.end;
    });
    
    // Add remaining text
    if (currentIndex < line.length) {
      elements.push(
        <span key="text-end" className="text-gray-100">
          {line.substring(currentIndex)}
        </span>
      );
    }
    
    return elements.length > 0 ? <>{elements}</> : <span className="text-gray-100">{line}</span>;
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

      {/* Modern Timeline Workflow */}
      <div className="max-w-6xl mx-auto">
        {/* Desktop Timeline Layout */}
        <div className="hidden lg:block">
          {/* Timeline Container */}
          <div className="relative">
            {/* Main Timeline Line */}
            <div className="absolute top-16 left-16 right-16 h-1 bg-gradient-to-r from-yellow-400 via-blue-500 via-green-500 to-purple-500 rounded-full shadow-lg"></div>
            
            {/* Timeline Steps */}
            <div className="grid grid-cols-4 gap-0 relative">
              {steps.map((step, index) => (
                <div key={step.id} className="relative flex flex-col items-center">
                  {/* Timeline Node - Larger with bigger numbers */}
                  <div className={`w-12 h-12 rounded-full bg-gradient-to-r ${step.color} shadow-lg border-4 border-white dark:border-gray-900 mb-6 z-10 relative`}>
                    <div className="absolute inset-0 rounded-full bg-white dark:bg-gray-900 scale-75 flex items-center justify-center">
                      <div className="text-lg font-bold text-gray-900 dark:text-white">{index + 1}</div>
                    </div>
                  </div>
                  
                  {/* Connection Labels */}
                  {index < steps.length - 1 && (
                    <div className="absolute top-8 left-full transform translate-x-4 -translate-y-1/2 z-20">
                      <div className={`px-3 py-1 rounded-full text-xs font-medium shadow-md border ${
                        index === 0 ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700' :
                        index === 1 ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700' :
                        'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700'
                      }`}>
                        {connections[index].label}
                      </div>
                    </div>
                  )}
                  
                  {/* Step Card - Fixed consistent height */}
                  <div
                    className={`bg-white dark:bg-gray-800 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 border-2 cursor-pointer transform hover:scale-105 w-full max-w-xs min-h-[280px] flex flex-col ${
                      selectedStep === step.id ? step.borderColor : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                    onClick={() => setSelectedStep(selectedStep === step.id ? null : step.id)}
                  >
                    {/* Gradient Header */}
                    <div className={`h-3 rounded-t-2xl bg-gradient-to-r ${step.color}`}></div>
                    
                    <div className="p-6 flex flex-col flex-1">
                      {/* Icon and Title */}
                      <div className="text-center mb-4">
                        <div className="text-5xl mb-3">{step.icon}</div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                          {step.title}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                          {step.subtitle}
                        </p>
                      </div>

                      {/* Description - Flex grow to fill remaining space */}
                      <p className="text-sm text-gray-600 dark:text-gray-300 text-center leading-relaxed flex-1 flex items-center justify-center">
                        {step.description}
                      </p>
                    </div>

                    {/* Click Indicator */}
                    <div className="absolute bottom-4 right-4 text-gray-400 dark:text-gray-500">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile/Tablet Vertical Layout */}
        <div className="lg:hidden space-y-8">
          {steps.map((step, index) => (
            <div key={step.id} className="relative">
              {/* Step Card - Consistent height for mobile too */}
              <div
                className={`bg-white dark:bg-gray-800 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 border-2 cursor-pointer min-h-[280px] flex flex-col ${
                  selectedStep === step.id ? step.borderColor : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                onClick={() => setSelectedStep(selectedStep === step.id ? null : step.id)}
              >
                {/* Gradient Header */}
                <div className={`h-3 rounded-t-2xl bg-gradient-to-r ${step.color}`}></div>
                
                <div className="p-6 flex flex-col flex-1">
                  {/* Step Number Badge - Larger for better visibility */}
                  <div className="absolute -top-5 -left-5 w-12 h-12 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-full flex items-center justify-center text-xl font-bold shadow-lg">
                    {index + 1}
                  </div>
                  
                  {/* Icon and Title */}
                  <div className="text-center mb-4">
                    <div className="text-5xl mb-3">{step.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                      {step.title}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                      {step.subtitle}
                    </p>
                  </div>

                  {/* Description - Flex grow to fill remaining space */}
                  <p className="text-sm text-gray-600 dark:text-gray-300 text-center leading-relaxed flex-1 flex items-center justify-center">
                    {step.description}
                  </p>
                </div>

                {/* Click Indicator */}
                <div className="absolute bottom-4 right-4 text-gray-400 dark:text-gray-500">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Mobile Connection Arrow */}
              {index < steps.length - 1 && (
                <div className="flex justify-center items-center py-4">
                  <div className="flex flex-col items-center space-y-2">
                    <div className={`w-12 h-0.5 ${
                      index === 0 ? 'bg-blue-500 dark:bg-blue-400' :
                      index === 1 ? 'bg-green-500 dark:bg-green-400' :
                      'bg-purple-500 dark:bg-purple-400'
                    } transform rotate-90`}></div>
                    <div className={`w-0 h-0 border-t-[8px] border-x-[4px] border-x-transparent ${
                      index === 0 ? 'border-t-blue-500 dark:border-t-blue-400' :
                      index === 1 ? 'border-t-green-500 dark:border-t-green-400' :
                      'border-t-purple-500 dark:border-t-purple-400'
                    }`}></div>
                    <div className={`px-3 py-1 rounded-full text-xs font-medium shadow-md border ${
                      index === 0 ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700' :
                      index === 1 ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700' :
                      'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700'
                    }`}>
                      {connections[index].label}
                    </div>
                  </div>
                </div>
              )}
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

                {/* Modern Code Section with Syntax Highlighting */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-lg">
                  <button
                    onClick={() => toggleCode(step.id)}
                    className="w-full px-6 py-4 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-600 text-left flex items-center justify-between hover:from-gray-100 hover:to-gray-200 dark:hover:from-gray-600 dark:hover:to-gray-500 transition-all duration-300 group"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm group-hover:shadow-md transition-shadow duration-300">
                        <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                      </div>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {step.codeTitle}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
                        {showCode[step.id] ? 'Hide Code' : 'View Code'}
                      </span>
                      <div className={`transform transition-transform duration-300 ${showCode[step.id] ? 'rotate-180' : ''}`}>
                        <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </button>
                  
                  {showCode[step.id] && (
                    <div className="relative">
                      {/* Code Header */}
                      <div className="bg-gray-800 dark:bg-gray-900 px-6 py-3 border-t border-gray-300 dark:border-gray-600">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <div className="flex space-x-1">
                              <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                              <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                              <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                            </div>
                            <span className="text-gray-400 text-sm font-mono ml-4">
                              {step.id === 'vault' ? 'vault-commands.sh' :
                               step.id === 'vso' ? 'vault-static-secret.yaml' :
                               step.id === 'k8s-secret' ? 'deployment.yaml' :
                               'server.js'}
                            </span>
                          </div>
                          <button
                            onClick={() => navigator.clipboard.writeText(step.code)}
                            className="flex items-center space-x-1 text-gray-400 hover:text-white transition-colors duration-200 text-sm"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span>Copy</span>
                          </button>
                        </div>
                      </div>
                      
                      {/* Enhanced Code Block with Syntax Highlighting */}
                      <div className="bg-gray-900 dark:bg-black p-6 overflow-x-auto">
                        <pre className="text-sm leading-relaxed text-gray-100">
                          <code className="language-text">
                            {step.code.split('\n').map((line, index) => (
                              <div key={index} className="block">
                                {highlightLine(line, step.id)}
                              </div>
                            ))}
                          </code>
                        </pre>
                      </div>
                      
                      {/* Code Footer */}
                      <div className="bg-gray-800 dark:bg-gray-900 px-6 py-2 border-t border-gray-700">
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <span>
                            {step.code.split('\n').length} lines
                          </span>
                          <span>
                            {step.id === 'vault' ? 'Shell Script' :
                             step.id === 'vso' ? 'Kubernetes YAML' :
                             step.id === 'k8s-secret' ? 'Kubernetes YAML' :
                             'JavaScript/Node.js'}
                          </span>
                        </div>
                      </div>
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
