#!/bin/bash
# Wrapper script to start frontend only if inside devcontainer

if [ -f "/.dockerenv" ] || [ -n "$REMOTE_CONTAINERS" ] || [ -n "$CODESPACES" ]; then
    # We're inside a container
    cd /workspace/frontend
    
    # Kill any existing vite dev server processes
    echo "🔍 Checking for existing frontend processes..."
    if pgrep -f "vite" > /dev/null || pgrep -f "node.*frontend" > /dev/null; then
        echo "⚠️  Found existing vite process. Stopping it..."
        pkill -TERM -f "vite" 2>/dev/null || true
        pkill -TERM -f "node.*frontend" 2>/dev/null || true
        sleep 2
        # Force kill if still running
        if pgrep -f "vite" > /dev/null || pgrep -f "node.*frontend" > /dev/null; then
            pkill -KILL -f "vite" 2>/dev/null || true
            pkill -KILL -f "node.*frontend" 2>/dev/null || true
            sleep 1
        fi
        echo "✅ Cleaned up existing processes"
    fi
    
    # Check if port 3000 is in use and wait for it to be free
    MAX_WAIT=10
    WAITED=0
    while lsof -i :3000 >/dev/null 2>&1; do
        if [ $WAITED -ge $MAX_WAIT ]; then
            echo "❌ Port 3000 still in use after ${MAX_WAIT}s. Attempting to free it..."
            fuser -k 3000/tcp 2>/dev/null || true
            sleep 1
            break
        fi
        echo "⏳ Waiting for port 3000 to be free... (${WAITED}s)"
        sleep 1
        WAITED=$((WAITED + 1))
    done
    
    npm run dev
else
    echo "⚠️  Not in a devcontainer. Skipping frontend start."
    echo "Please reopen in container: Ctrl+Shift+P → 'Dev Containers: Reopen in Container'"
    exit 0
fi
