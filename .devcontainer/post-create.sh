#!/bin/bash

echo "🚀 Setting up Sambee development environment..."

# Backend setup
echo "📦 Installing Python dependencies..."
cd /workspace/backend
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Frontend setup
echo "📦 Installing Node dependencies..."
cd /workspace/frontend
npm install

# Create local data directory
echo "📁 Creating local data directory..."
mkdir -p /workspace/data

# Initialize database
echo "🗄️ Initializing SQLite database..."
cd /workspace/backend
python -c "from app.db.database import init_db; init_db()"

# Create .env file if it doesn't exist
if [ ! -f /workspace/.env ]; then
    echo "🔐 Creating .env file..."
    cp /workspace/.env.example /workspace/.env
    # Generate keys
    python -c "from cryptography.fernet import Fernet; print(f'ENCRYPTION_KEY={Fernet.generate_key().decode()}')" >> /workspace/.env
    python -c "import secrets; print(f'SECRET_KEY={secrets.token_urlsafe(32)}')" >> /workspace/.env
fi

echo "✅ Development environment ready!"
echo ""
echo "To start development:"
echo "  Backend:  cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
echo "  Frontend: cd frontend && npm start"
echo ""
echo "Or use VS Code tasks (Ctrl+Shift+P -> 'Tasks: Run Task')"