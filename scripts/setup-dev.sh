#!/bin/bash
set -e

# Vault Secrets Web Demo - Development Setup
echo "🚀 Setting up Vault Secrets Web Demo development environment..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "📦 Installing backend dependencies..."
cd app
npm install

echo "📦 Installing frontend dependencies..."
cd client
npm install

echo "✅ Development environment setup complete!"
echo
echo "🏃 To start development:"
echo "  cd app && npm run dev"
echo
echo "🏗️ To build for production:"
echo "  ./scripts/build.sh"
