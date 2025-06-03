#!/bin/bash
set -e

# Vault Secrets Web Demo - Run Script
# This script manages running the demo container

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration
CONTAINER_NAME="${CONTAINER_NAME:-vault-demo}"
IMAGE_NAME="${IMAGE_NAME:-quay.io/aaroneautomate/vault-secrets-web-demo:latest}"
PORT="${PORT:-3001}"
SECRETS_DIR="${SECRETS_DIR:-/tmp/secrets}"

echo "🔐 Vault Secrets Web Demo - Container Manager"
echo "Container: $CONTAINER_NAME"
echo "Image: $IMAGE_NAME"
echo "Port: $PORT"
echo "Secrets Directory: $SECRETS_DIR"
echo

# Function to stop and remove existing container
cleanup_container() {
    if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
        echo "🛑 Stopping existing container..."
        docker stop "$CONTAINER_NAME"
    fi
    
    if docker ps -aq -f name="$CONTAINER_NAME" | grep -q .; then
        echo "🗑️  Removing existing container..."
        docker rm "$CONTAINER_NAME"
    fi
}

# Function to start container
start_container() {
    echo "🚀 Starting container..."
    docker run -d \
        -p "$PORT:3000" \
        -v "$SECRETS_DIR:/secrets" \
        --name "$CONTAINER_NAME" \
        "$IMAGE_NAME"
    
    echo "✅ Container started successfully!"
    echo "🌐 Web UI: http://localhost:$PORT"
    echo "📁 Secrets directory: $SECRETS_DIR"
}

# Function to show container logs
show_logs() {
    echo "📋 Container logs:"
    docker logs -f "$CONTAINER_NAME"
}

# Function to create test secrets
create_test_secrets() {
    echo "🧪 Creating test secrets..."
    mkdir -p "$SECRETS_DIR"
    
    # API Key
    echo "sk-test123456789abcdef" > "$SECRETS_DIR/api_key"
    
    # Database config (JSON)
    echo '{"host": "db.example.com", "port": 5432, "database": "myapp", "ssl": true}' > "$SECRETS_DIR/db_config.json"
    
    # Environment variables
    echo -e "DB_HOST=localhost\nDB_PORT=5432\nDB_NAME=myapp\nDB_USER=admin\nDB_PASS=secret123" > "$SECRETS_DIR/app.env"
    
    # YAML config
    echo -e "app:\n  name: MyApp\n  version: 1.0.0\n  features:\n    - auth\n    - logging" > "$SECRETS_DIR/config.yaml"
    
    # JWT Token (fake)
    echo "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c" > "$SECRETS_DIR/jwt_token"
    
    echo "✅ Test secrets created!"
}

# Function to show status
show_status() {
    echo "📊 Container Status:"
    if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
        echo "✅ Container is running"
        docker ps -f name="$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        echo
        echo "🔍 Recent activity:"
        curl -s "http://localhost:$PORT/api/activity" | jq -r '.activity[0:3][] | "  \(.timestamp) - \(.action) \(.file)"' 2>/dev/null || echo "  API not responding"
    else
        echo "❌ Container is not running"
    fi
}

# Main command processing
case "${1:-start}" in
    "start")
        cleanup_container
        start_container
        ;;
    "stop")
        cleanup_container
        echo "✅ Container stopped"
        ;;
    "restart")
        cleanup_container
        start_container
        ;;
    "logs")
        show_logs
        ;;
    "test-secrets")
        create_test_secrets
        ;;
    "status")
        show_status
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [command]"
        echo
        echo "Commands:"
        echo "  start         Start the demo container (default)"
        echo "  stop          Stop and remove the container"
        echo "  restart       Restart the container"
        echo "  logs          Show container logs"
        echo "  test-secrets  Create test secrets"
        echo "  status        Show container status"
        echo "  help          Show this help"
        echo
        echo "Environment variables:"
        echo "  CONTAINER_NAME  Container name (default: vault-demo)"
        echo "  IMAGE_NAME      Docker image (default: quay.io/aaroneautomate/vault-secrets-web-demo:latest)"
        echo "  PORT            Host port (default: 3001)"
        echo "  SECRETS_DIR     Secrets directory (default: /tmp/secrets)"
        ;;
    *)
        echo "❌ Unknown command: $1"
        echo "Run '$0 help' for usage information"
        exit 1
        ;;
esac
