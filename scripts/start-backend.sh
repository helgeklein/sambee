#!/bin/bash
# Wrapper script to start backend only if inside devcontainer

if [ -f "/.dockerenv" ] || [ -n "$REMOTE_CONTAINERS" ] || [ -n "$CODESPACES" ]; then
    # We're inside a container
    cd /workspace/backend
    
    # Kill any existing uvicorn processes and clean up port
    echo "🔍 Checking for existing backend processes..."
    if pgrep -f "uvicorn app.main:app" > /dev/null; then
        echo "⚠️  Found existing uvicorn process. Stopping it..."
        pkill -TERM -f "uvicorn app.main:app"
        sleep 2
        # Force kill if still running
        if pgrep -f "uvicorn app.main:app" > /dev/null; then
            pkill -KILL -f "uvicorn app.main:app"
            sleep 1
        fi
        echo "✅ Cleaned up existing processes"
    fi
    
    # Check if port 8000 is in use and wait for it to be free
    MAX_WAIT=10
    WAITED=0
    while lsof -i :8000 >/dev/null 2>&1; do
        if [ $WAITED -ge $MAX_WAIT ]; then
            echo "❌ Port 8000 still in use after ${MAX_WAIT}s. Attempting to free it..."
            fuser -k 8000/tcp 2>/dev/null || true
            sleep 1
            break
        fi
        echo "⏳ Waiting for port 8000 to be free... (${WAITED}s)"
        sleep 1
        WAITED=$((WAITED + 1))
    done
    
    # Check if .env file exists, if not create it from example
    if [ ! -f .env ]; then
        echo "⚠️  .env file not found. Creating from example..."
        if [ -f /workspace/.env.example ]; then
            # Generate secure keys
            ENCRYPTION_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
            SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(32))")
            
            # Create .env file with actual values
            cat > .env <<EOF
# App Configuration
DEBUG=true
LOG_LEVEL=DEBUG
DATA_DIR=/workspace/data

# Security
SECRET_KEY=${SECRET_KEY}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# Initial Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin

# Optional: Test SMB Share
TEST_SMB_HOST=
TEST_SMB_SHARE=
TEST_SMB_USERNAME=
TEST_SMB_PASSWORD=
EOF
            echo "✅ Created .env file with secure keys"
        else
            echo "❌ Error: .env.example not found!"
            exit 1
        fi
    fi
    
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
