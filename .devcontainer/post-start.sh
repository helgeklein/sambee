#!/bin/bash

# Configure git safe directory
git config --global safe.directory /workspace

# Ensure frontend dependencies exist before starting servers
if [ ! -d "/workspace/frontend/node_modules" ]; then
    echo "⚠️  Frontend dependencies not found"
    echo "📦 Installing dependencies..."
    cd /workspace/frontend
    npm install
    echo "✅ Dependencies installed"
fi

# Start development servers using the dev-start script
/workspace/scripts/dev-start.sh
