# Vault Secrets Web Demo

A demonstration application that showcases the integration between HashiCorp Vault, Kubernetes, and a modern web interface. This project demonstrates how secrets stored in Vault can be dynamically synchronized to Kubernetes and consumed by a web application in real-time.

## 🎯 Overview

This demo illustrates the complete flow from Vault secrets to web UI:

1. **Vault** stores secrets in a KV-v2 secrets engine
2. **Vault Secrets Operator (VSO)** syncs secrets to Kubernetes
3. **Web Application** monitors mounted secrets and updates the UI in real-time
4. **Live Updates** via WebSocket connections show secret changes instantly

## 🏗️ Architecture

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Vault     │    │   Kubernetes     │    │  Web App        │
│  (KV Store) │───▶│ (VSO + Secrets)  │───▶│ (Node.js + React)│
└─────────────┘    └──────────────────┘    └─────────────────┘
                             │                        │
                             └────────────────────────┘
                                   File Watching
```

## 🚀 Features

- **Real-time Secret Updates**: WebSocket-based live updates when secrets change
- **Modern UI**: React frontend with Tailwind CSS for a clean interface
- **File System Monitoring**: Automatic detection of Kubernetes secret changes
- **RESTful API**: Express.js backend with endpoints for secret management
- **Containerized**: Multi-stage Docker build for production deployment
- **Kubernetes Ready**: Complete manifests for Kubernetes/OpenShift deployment

## 📋 Prerequisites

- **Kubernetes/OpenShift cluster**
- **HashiCorp Vault** with KV-v2 secrets engine
- **Vault Secrets Operator (VSO)** installed in cluster
- **Vault Kubernetes Auth** method configured
- **Docker** (for local development)
- **Node.js 18+** (for local development)

### Vault Configuration Requirements

Before deploying, ensure Vault is configured with:

1. **KV-v2 secrets engine** mounted at `secret/`
2. **Kubernetes auth method** enabled
3. **Vault role** created for the application:
   ```bash
   vault write auth/kubernetes/role/vault-secrets-web-demo \
     bound_service_account_names=vault-auth \
     bound_service_account_namespaces=vault-secrets-web-demo \
     policies=vault-secrets-web-demo-policy \
     ttl=24h
   ```
4. **Vault policy** with access to secrets:
   ```hcl
   path "secret/data/web/*" {
     capabilities = ["read"]
   }
   ```

## 🛠️ Quick Start

### Local Development

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd vault-secrets-web-demo
   ```

2. **Set up development environment**:
   ```bash
   chmod +x scripts/setup-dev.sh
   ./scripts/setup-dev.sh
   ```

3. **Install dependencies**:
   ```bash
   cd app
   npm run install:all
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

   The application will be available at `http://localhost:3000`

### Docker Deployment

1. **Build the container**:
   ```bash
   chmod +x scripts/build.sh
   ./scripts/build.sh
   ```

2. **Run the container**:
   ```bash
   docker run -p 3000:3000 \
     -v /path/to/secrets:/app/secrets:ro \
     vault-secrets-web-demo:latest
   ```

### Kubernetes Deployment

> **Note**: For production deployments, Kubernetes manifests are maintained in a separate infrastructure repository using GitOps practices.

If you want to deploy this application to Kubernetes/OpenShift, you'll need:

1. **Vault Infrastructure**:
   - VaultConnection (pointing to your Vault server)
   - VaultAuth (Kubernetes authentication method)
   - ServiceAccount with proper RBAC permissions

2. **Secret Synchronization**:
   - VaultStaticSecret (syncs secrets from Vault to Kubernetes)

3. **Application Deployment**:
   - Deployment (with volume mounts for secrets)
   - Service (exposes the application)
   - Route/Ingress (for external access)

For a complete example of these manifests, see the infrastructure repository or contact your platform team.

## 📁 Project Structure

```
vault-secrets-web-demo/
├── app/                    # Application source code
│   ├── server.js          # Express.js backend
│   ├── package.json       # Backend dependencies
│   └── client/            # React frontend
│       ├── src/           # React components
│       └── package.json   # Frontend dependencies
├── docker/
│   └── Dockerfile         # Multi-stage container build
└── scripts/               # Utility scripts
    ├── build.sh          # Docker build script
    └── setup-dev.sh      # Development setup
```

> **Note**: Kubernetes deployment manifests are maintained separately in the infrastructure repository for proper GitOps practices.

## 🔧 Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
- `SECRETS_PATH`: Path to mounted secrets (default: `/app/secrets`)
- `NODE_ENV`: Environment mode (development/production)

### Vault Configuration

The application expects secrets to be mounted at `/app/secrets` with the following structure:
```
/app/secrets/
├── database_password
├── api_key
└── session_secret
```

### Kubernetes Secrets

VSO will create a Kubernetes secret that gets mounted to the pod. The secret configuration is managed in the infrastructure repository with the following structure:

```yaml
# Example VaultStaticSecret configuration
spec:
  vaultConnectionRef: your-vault-connection
  mount: secret              # Your Vault mount point
  type: kv-v2
  path: web                  # Path to your secrets
  destination:
    name: vault-web-secrets
    create: true
  refreshAfter: 30s          # Sync frequency
```

## 🌐 API Endpoints

- `GET /api/secrets` - Retrieve all current secrets
- `GET /api/health` - Health check endpoint
- `WebSocket /` - Real-time secret updates

## 🔍 Monitoring

The application includes built-in monitoring:
- File system watching for secret changes
- WebSocket connections for real-time updates
- Health check endpoint for container orchestration
- Structured logging for debugging

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally with Docker
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Troubleshooting

### Common Issues

**Secrets not updating**:
- Verify VSO is running and configured correctly
- Check vault-static-secret resource status: `kubectl describe vaultstaticsecret vault-web-secrets`
- Ensure proper RBAC permissions for VSO
- Contact your platform team if using managed infrastructure

**WebSocket connection failed**:
- Check if port 3000 is accessible
- Verify network policies allow WebSocket connections
- Check browser console for connection errors

**Container won't start**:
- Verify secrets are properly mounted at `/secrets`
- Check container logs: `kubectl logs deployment/vault-secrets-web-demo`
- Ensure sufficient resources are allocated
- Verify the secrets directory is mounted read-only

### Debug Mode

Enable debug logging by setting:
```bash
DEBUG=vault-secrets-web-demo:*
```

For more detailed troubleshooting, check the application logs and Kubernetes events.