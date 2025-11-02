# Sambee

A friendly modern SMB share file browser with excellent preview capabilities.

## Features

- 🌐 Browser-based SMB share viewer
- 📄 Rich file preview capabilities (starting with Markdown)
- 🔒 Secure credential management
- 🎨 Modern, responsive UI
- 🐳 Easy deployment with Docker

## Quick Start

### Development with VS Code Dev Container

1. Clone the repository:
```bash
git clone https://github.com/helgeklein/sambee.git
cd sambee
```

2. Open in VS Code:
```bash
code .
```

3. Reopen in Container when prompted (or use Command Palette: `Remote-Containers: Reopen in Container`)

4. Start development servers:
```bash
# Backend (FastAPI)
cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (React)
cd frontend && npm start
```

Or use VS Code tasks: `Ctrl+Shift+P` → `Tasks: Run Task`

### Production Deployment

```bash
docker compose up -d
```

Access the application at http://localhost

## Architecture

- **Backend**: FastAPI (Python 3.11)
- **Frontend**: React with TypeScript
- **Database**: SQLite
- **SMB Library**: smbprotocol
- **Reverse Proxy**: Caddy

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed development setup instructions.

## License

MIT