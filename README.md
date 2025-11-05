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

# Frontend (React + Vite)
cd frontend && npm run dev
```

Or use VS Code tasks: `Ctrl+Shift+P` → `Tasks: Run Task`

### Production Deployment

```bash
docker compose up -d
```

Access the application at http://localhost

## Architecture

- **Backend**: FastAPI (Python 3.13)
- **Frontend**: React 18 with TypeScript + Vite
- **Database**: SQLite
- **SMB Library**: smbprotocol
- **Reverse Proxy**: Caddy

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed development setup instructions.

### Logging & Debugging

Sambee includes comprehensive logging to help diagnose issues:

#### View Logs

```bash
# View all logs with status
/workspace/scripts/logs.sh

# Show more lines
/workspace/scripts/logs.sh -n 100

# Follow logs in real-time
/workspace/scripts/logs.sh -f

# Or view individual logs
tail -f /tmp/backend.log
tail -f /tmp/frontend.log
tail -f /tmp/dev-start.log
tail -f /tmp/post-start.log
```

#### Log Files

- `/tmp/backend.log` - FastAPI backend logs (includes startup, requests, errors)
- `/tmp/frontend.log` - Vite frontend logs (includes build output, HMR)
- `/tmp/dev-start.log` - Dev server startup logs
- `/tmp/post-start.log` - Container post-start hook logs

#### Rotate Logs

If logs get too large:

```bash
/workspace/scripts/rotate-logs.sh
```

This archives current logs and starts fresh files.

#### What's Logged

**Backend:**
- Application startup/shutdown with timestamps
- Database initialization
- All HTTP requests with duration (e.g., `→ GET /api/browse - 200 (45.2ms)`)
- SMB connection attempts and failures
- Errors with full stack traces

**Frontend:**
- Vite server startup
- Build progress
- Hot module replacement (HMR) updates
- Build errors

**Startup Scripts:**
- Post-start command execution
- Dev server launch attempts
- Process IDs and verification
- Failure diagnostics with log tails

## License

MIT