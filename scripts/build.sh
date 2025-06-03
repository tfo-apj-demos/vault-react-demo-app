#!/bin/bash
set -e

# Vault Secrets Web Demo - Build Script
# This script builds the Docker image for the demo application

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration
IMAGE_NAME="${IMAGE_NAME:-vault-secrets-web-demo}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
REGISTRY="${REGISTRY:-quay.io/aaroneautomate}"  # Update with your registry
FULL_IMAGE_NAME="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "🏗️  Building Vault Secrets Web Demo"
echo "Project root: $PROJECT_ROOT"
echo "Image: $FULL_IMAGE_NAME"
echo

# Check if buildx is available and create builder if needed
echo "🔧 Setting up multi-platform builder..."
docker buildx create --name multiarch-builder --use --bootstrap 2>/dev/null || docker buildx use multiarch-builder

# Build multi-architecture image and push
echo "📦 Building multi-architecture Docker image (amd64, arm64)..."
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -f "$PROJECT_ROOT/docker/Dockerfile" \
    -t "$FULL_IMAGE_NAME" \
    --push \
    "$PROJECT_ROOT"

echo "✅ Multi-architecture build and push completed successfully!"
echo "📋 Image details:"
echo "   Registry: $REGISTRY"
echo "   Image: $IMAGE_NAME:$IMAGE_TAG"
echo "   Platforms: linux/amd64, linux/arm64"

echo
echo "🧪 To test locally, run:"
echo "   docker run -p 3001:3000 -v /tmp/secrets:/secrets $FULL_IMAGE_NAME"

echo "🎉 Build complete!"
