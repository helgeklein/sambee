#!/bin/bash
# Wrapper script to start backend only if inside devcontainer

if [ -f "/.dockerenv" ] || [ -n "$REMOTE_CONTAINERS" ] || [ -n "$CODESPACES" ]; then
    # We're inside a container
    cd /workspace/backend
    
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
