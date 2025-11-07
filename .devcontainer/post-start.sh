#!/bin/bash

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] POST-START: $1" | tee -a /tmp/post-start.log
}

log "=" 
log "🔧 Post-Start Command Executing"
log "   Container: $(hostname)"
log "   User: $(whoami)"
log "   PWD: $(pwd)"
log "="

# Configure git safe directory
log "Configuring git safe directory..."
git config --global safe.directory /workspace
log "✅ Git configured"

# Ensure backend dependencies exist
if ! /usr/local/bin/python -c "import uvicorn" 2>/dev/null; then
    log "⚠️  Backend dependencies not found"
    log "📦 Installing Python dependencies..."
    cd /workspace/backend
    pip install -q -r requirements.txt 2>&1 | while IFS= read -r line; do
        log "   | $line"
    done
    log "✅ Backend dependencies installed"
else
    log "✅ Backend dependencies exist"
fi

# Ensure frontend dependencies exist
if [ ! -d "/workspace/frontend/node_modules" ] || [ -z "$(ls -A /workspace/frontend/node_modules 2>/dev/null)" ]; then
    log "⚠️  Frontend dependencies not found or empty"
    
    # Fix node_modules ownership if it exists and has permission issues
    if [ -d "/workspace/frontend/node_modules" ]; then
        NODE_MODULES_OWNER=$(stat -c %U /workspace/frontend/node_modules 2>/dev/null)
        if [ "$NODE_MODULES_OWNER" = "root" ] || [ "$NODE_MODULES_OWNER" != "vscode" ]; then
            log "🔧 Fixing node_modules permissions..."
            sudo chown -R vscode:vscode /workspace/frontend/node_modules 2>/dev/null || true
            sudo rm -rf /workspace/frontend/node_modules
            log "✅ Removed problematic node_modules"
        fi
    fi
    
    log "📦 Installing dependencies..."
    cd /workspace/frontend
    npm install 2>&1 | while IFS= read -r line; do
        log "   | $line"
    done
    log "✅ Dependencies installed"
else
    log "✅ Frontend dependencies exist"
fi

log "=" 
log "✅ Post-Start Command Complete"
log "Note: Servers will be started by VS Code auto-run tasks"
log "="
