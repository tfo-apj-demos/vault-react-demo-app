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

# Build the Docker image
echo "📦 Building Docker image..."
docker build \
    -f "$PROJECT_ROOT/docker/Dockerfile" \
    -t "$FULL_IMAGE_NAME" \
    "$PROJECT_ROOT"

echo "✅ Build completed successfully!"
echo "📋 Image details:"
docker images "$FULL_IMAGE_NAME"

echo
echo "🚀 To push to registry, run:"
echo "   docker push $FULL_IMAGE_NAME"
echo
echo "🧪 To test locally, run:"
echo "   docker run -p 3000:3000 -v /tmp/secrets:/secrets $FULL_IMAGE_NAME"

# Push if requested
if [[ "${PUSH_IMAGE}" == "true" ]]; then
    echo "📤 Pushing image to registry..."
    docker push "$FULL_IMAGE_NAME"
    echo "✅ Image pushed successfully!"
fi

echo "🎉 Build complete!"
