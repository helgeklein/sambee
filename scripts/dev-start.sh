#!/bin/bash

echo "🚀 Starting Sambee development servers..."

# Check if backend is already running
if pgrep -f "uvicorn.*app.main:app" > /dev/null; then
    echo "⚠️  Backend server is already running"
else
    echo "Starting backend server..."
    cd /workspace/backend
    nohup uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
    BACKEND_PID=$!
    
    # Wait for backend to actually start (max 10 seconds)
    for i in {1..20}; do
        if pgrep -f "uvicorn.*app.main:app" > /dev/null; then
            echo "✅ Backend started successfully"
            break
        fi
        if [ $i -eq 20 ]; then
            echo "⚠️  Backend failed to start, check /tmp/backend.log"
        fi
        sleep 0.5
    done
fi

# Check if frontend is already running
if pgrep -f "vite" > /dev/null; then
    echo "⚠️  Frontend server is already running"
else
    echo "Starting frontend server..."
    cd /workspace/frontend
    nohup npm run dev > /tmp/frontend.log 2>&1 &
    FRONTEND_PID=$!
    
    # Wait for frontend to actually start (max 10 seconds)
    for i in {1..20}; do
        if pgrep -f "vite" > /dev/null; then
            echo "✅ Frontend started successfully"
            break
        fi
        if [ $i -eq 20 ]; then
            echo "⚠️  Frontend failed to start, check /tmp/frontend.log"
        fi
        sleep 0.5
    done
fi

echo ""
echo "✅ Development servers are running!"
echo ""
echo "Access:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"
echo ""
echo "View logs:"
echo "  tail -f /tmp/backend.log"
echo "  tail -f /tmp/frontend.log"
echo ""
echo "To stop: ./dev-stop.sh"
