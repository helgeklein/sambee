#!/bin/bash
# Wrapper script to start frontend only if inside devcontainer

if [ -f "/.dockerenv" ] || [ -n "$REMOTE_CONTAINERS" ] || [ -n "$CODESPACES" ]; then
    # We're inside a container
    cd /workspace/frontend
    npm run dev
else
    echo "⚠️  Not in a devcontainer. Skipping frontend start."
    echo "Please reopen in container: Ctrl+Shift+P → 'Dev Containers: Reopen in Container'"
    exit 0
fi
