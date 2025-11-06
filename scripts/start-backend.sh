#!/bin/bash
# Wrapper script to start backend only if inside devcontainer

if [ -f "/.dockerenv" ] || [ -n "$REMOTE_CONTAINERS" ] || [ -n "$CODESPACES" ]; then
    # We're inside a container
    cd /workspace/backend
    
    # Check if uvicorn is installed, install dependencies if not
    if ! command -v uvicorn &> /dev/null; then
        echo "⚠️  Backend dependencies not installed. Installing..."
        pip install -q -r requirements.txt
        echo "✅ Backend dependencies installed"
    fi
    
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
else
    echo "⚠️  Not in a devcontainer. Skipping backend start."
    echo "Please reopen in container: Ctrl+Shift+P → 'Dev Containers: Reopen in Container'"
    exit 0
fi
