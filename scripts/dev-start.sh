#!/bin/bash

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a /tmp/dev-start.log
}

log "=" 
log "🚀 Starting Sambee development servers..."
log "   Script: $0"
log "   PWD: $(pwd)"
log "   User: $(whoami)"
log "="

# Check if backend is already running
if pgrep -f "uvicorn.*app.main:app" > /dev/null; then
    BACKEND_PID=$(pgrep -f "uvicorn.*app.main:app")
    log "⚠️  Backend server is already running (PID: $BACKEND_PID)"
else
    log "Starting backend server..."
    cd /workspace/backend
    nohup uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
    BACKEND_PID=$!
    log "   Backend process started (PID: $BACKEND_PID)"
    
    # Wait for backend to actually start (max 10 seconds)
    for i in {1..20}; do
        if pgrep -f "uvicorn.*app.main:app" > /dev/null; then
            ACTUAL_PID=$(pgrep -f "uvicorn.*app.main:app")
            log "✅ Backend started successfully (PID: $ACTUAL_PID)"
            break
        fi
        if [ $i -eq 20 ]; then
            log "❌ Backend failed to start after 10 seconds"
            log "   Check logs: tail -50 /tmp/backend.log"
            tail -20 /tmp/backend.log | while IFS= read -r line; do
                log "   | $line"
            done
        fi
        sleep 0.5
    done
fi

# Check if frontend is already running
if pgrep -f "vite" > /dev/null; then
    FRONTEND_PID=$(pgrep -f "vite")
    log "⚠️  Frontend server is already running (PID: $FRONTEND_PID)"
else
    log "Starting frontend server..."
    cd /workspace/frontend
    
    # Check node_modules
    if [ ! -d "node_modules" ]; then
        log "❌ node_modules not found! Running npm install..."
        npm install 2>&1 | while IFS= read -r line; do
            log "   | $line"
        done
    fi
    
    nohup npm run dev > /tmp/frontend.log 2>&1 &
    FRONTEND_PID=$!
    log "   Frontend process started (PID: $FRONTEND_PID)"
    
    # Wait for frontend to actually start (max 10 seconds)
    for i in {1..20}; do
        if pgrep -f "vite" > /dev/null; then
            ACTUAL_PID=$(pgrep -f "vite")
            log "✅ Frontend started successfully (PID: $ACTUAL_PID)"
            break
        fi
        if [ $i -eq 20 ]; then
            log "❌ Frontend failed to start after 10 seconds"
            log "   Check logs: tail -50 /tmp/frontend.log"
            tail -20 /tmp/frontend.log | while IFS= read -r line; do
                log "   | $line"
            done
        fi
        sleep 0.5
    done
fi

log ""
log "✅ Development servers are running!"
log ""
log "Access:"
log "  Frontend: http://localhost:3000"
log "  Backend:  http://localhost:8000"
log "  API Docs: http://localhost:8000/docs"
log ""
log "View logs:"
log "  tail -f /tmp/backend.log"
log "  tail -f /tmp/frontend.log"
log "  tail -f /tmp/dev-start.log"
log ""
log "To stop: /workspace/scripts/dev-stop.sh"
