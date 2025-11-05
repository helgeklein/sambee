#!/bin/bash
# Wrapper script to start backend only if inside devcontainer

if [ -f "/.dockerenv" ] || [ -n "$REMOTE_CONTAINERS" ] || [ -n "$CODESPACES" ]; then
    # We're inside a container
    cd /workspace/backend
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
else
    echo "⚠️  Not in a devcontainer. Skipping backend start."
    echo "Please reopen in container: Ctrl+Shift+P → 'Dev Containers: Reopen in Container'"
    exit 0
fi
