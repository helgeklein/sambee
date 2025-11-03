#!/bin/bash

echo "🚀 Setting up Sambee development environment..."

# Fix pip cache directory ownership if it exists and is owned by root
if [ -d /home/vscode/.cache/pip ] && [ "$(stat -c %U /home/vscode/.cache/pip)" = "root" ]; then
    echo "🔧 Fixing pip cache permissions..."
    sudo chown -R vscode:vscode /home/vscode/.cache
fi

# Backend setup
echo "📦 Installing Python dependencies..."
cd /workspace/backend
pip install --upgrade pip
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Create .env file if it doesn't exist (MUST happen before database init)
if [ ! -f /workspace/backend/.env ]; then
    echo "🔐 Creating .env file..."
    cd /workspace/backend
    
    # Generate secure keys
    ENCRYPTION_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
    SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(32))")
    
    # Create .env file with actual values (not appending to example)
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
    
    echo "✅ Generated .env file with secure keys"
fi

# Create local data directory
echo "📁 Creating local data directory..."
mkdir -p /workspace/data

# Initialize database (now that .env exists)
echo "🗄️ Initializing SQLite database..."
cd /workspace/backend
python -c "from app.db.database import init_db; init_db()"

# Frontend setup
echo "📦 Installing Node dependencies..."
cd /workspace/frontend
npm install

echo "✅ Development environment setup complete!"
echo ""