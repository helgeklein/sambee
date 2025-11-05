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

# Ensure frontend dependencies exist
if [ ! -d "/workspace/frontend/node_modules" ]; then
    log "⚠️  Frontend dependencies not found"
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
