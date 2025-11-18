# Development Guide

## Prerequisites

- Windows with WSL2
- VS Code with Dev Containers extension

## Dev Container Setup

The project includes a complete dev container configuration for consistent development environment.

### Features

- Python with FastAPI
- Node.js for React development
- SMB testing utilities
- SQLite tools
- Pre-configured VS Code extensions

### Getting Started

1. Open the project in VS Code
2. Reopen in Container when prompted
3. The post-create script will automatically:
   - Install Python dependencies
   - Install Node modules
   - Initialize the database
   - Create default `.env` file

### Troubleshooting Initial Setup

If you encounter startup issues after opening the dev container:

**Backend: Missing `.env` file**
- The backend startup script will automatically create a `.env` file with secure keys if missing
- The file is created at `/workspace/backend/.env`

**Frontend: `vite: not found` or permission errors**
- The frontend startup script will automatically:
  - Fix permission issues with `node_modules`
  - Reinstall dependencies if needed
- If issues persist, manually run: `cd /workspace/frontend && sudo rm -rf node_modules && npm install`

**Both services auto-start**
- Backend runs on `http://localhost:8000` (API docs: `/docs`)
- Frontend runs on `http://localhost:3000`
- Services are configured to start automatically via VS Code tasks

## Project Structure

```
sambee/
├── .devcontainer/       # Dev container configuration
├── .vscode/            # VS Code settings and tasks
├── backend/            # FastAPI backend
│   ├── app/
│   │   ├── api/       # API endpoints
│   │   ├── core/      # Core utilities
│   │   ├── db/        # Database models
│   │   ├── models/    # Pydantic models
│   │   └── storage/   # Storage backends
│   └── tests/
├── frontend/           # React frontend
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   └── types/
│   └── public/
└── data/              # SQLite database (git-ignored)
```

## Development Workflow

### Backend Development

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API documentation available at: http://localhost:8000/docs

### Frontend Development

```bash
cd frontend
npm run dev
```

Development server runs at: http://localhost:3000 (powered by Vite ⚡)

### Running Tests

```bash
# Run all tests (backend + frontend) - fast, no coverage
./scripts/test.sh

# Run all tests with coverage (CI mode)
COVERAGE=1 ./scripts/test.sh

# Backend tests only
cd backend && pytest

# Frontend tests only
cd frontend && npm test
```

## Running Tests

### Backend Tests

Sambee includes comprehensive backend tests using pytest. Tests cover authentication, connection management, file browsing, and more.

```bash
# Run all tests (parallel execution for speed)
cd backend && pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/test_auth.py

# Run specific test class or function
pytest tests/test_auth.py::TestLoginEndpoint
pytest tests/test_auth.py::TestLoginEndpoint::test_login_success

# Run with coverage report (slower, generates HTML/XML reports)
COVERAGE=1 pytest --cov=app --cov-report=html --cov-report=xml

# Control parallel workers (default: auto-detect CPU cores)
pytest -n 4  # Use 4 workers
pytest -n auto  # Auto-detect (recommended)
pytest -n 0  # Disable parallel execution

# View coverage report
open htmlcov/index.html  # or browse to file:///.../htmlcov/index.html
```

**Performance:** Tests run with **parallel execution** by default using `pytest-xdist`. On a 4-core machine, this provides ~30-35% speedup (310 tests in ~20s vs ~31s sequential). Coverage collection adds ~2-3 seconds overhead.

**Note:** By default, tests run **without** coverage collection for faster execution during development. Set `COVERAGE=1` environment variable to generate coverage reports. CI/CD automatically runs with coverage enabled.

### Test Organization

Tests are organized in `backend/tests/`:

- `conftest.py` - Shared fixtures (database, users, auth tokens, test connections)
- `test_auth.py` - Authentication and authorization tests
- `test_connections.py` - SMB connection management tests  
- `test_browser.py` - File browsing tests with mocked SMB backend

### Writing New Tests

Use the provided fixtures for consistency:

```python
import pytest
from fastapi.testclient import TestClient

@pytest.mark.integration
class TestMyFeature:
    """Test my new feature."""
    
    def test_admin_can_access(
        self, 
        client: TestClient, 
        auth_headers_admin: dict
    ):
        """Test that admin can access the endpoint."""
        response = client.get(
            "/api/my-endpoint",
            headers=auth_headers_admin
        )
        assert response.status_code == 200
```

Available fixtures:
- `client` - TestClient with database override
- `session` - Database session
- `admin_user`, `regular_user` - Test users
- `admin_token`, `user_token` - JWT tokens
- `auth_headers_admin`, `auth_headers_user` - Authorization headers
- `test_connection` - Single test SMB connection
- `multiple_connections` - List of 3 test connections
- `mock_smb_backend` - Mocked SMB backend for browser tests

### Frontend Tests

```bash
cd frontend && npm test
```

## CI/CD and GitHub Actions

The project uses GitHub Actions for continuous integration. Tests run automatically on pushes and pull requests to the `main` branch.

### Performance Optimizations

**Dependency Caching:**
- Python virtual environment is cached (`.venv/`)
- Node modules are cached (`node_modules/`)
- mypy cache is cached (`.mypy_cache/`)
- On cache hit: installation skipped, saving ~30-40 seconds
- Cache invalidates when `requirements*.txt` or `package-lock.json` changes

**Parallel Test Execution:**
- Backend tests run with `pytest-xdist` (4 workers)
- Provides ~35% speedup (~20s vs ~31s)
- Compatible with coverage collection

**Incremental Type Checking:**
- mypy uses cache for faster incremental checks
- Only analyzes changed Python files on subsequent runs

**Optimized Artifacts:**
- Only coverage.xml uploaded (not HTML reports)
- 7-day retention (reduced from 30 days)
- Faster upload, lower storage costs

**Test Scope:**
- Backend: Type checking (mypy), unit tests with coverage
- Frontend: Type checking (TypeScript), unit tests
- Production build validation is handled separately (not in test workflow)

**Current CI Runtime:**
- Baseline (no optimizations): ~120s
- First run (cache miss): ~90s
- Subsequent runs (cache hit): ~45-50s (60% improvement from baseline)
- Backend tests: ~16s (with coverage, parallel with 4 workers)
- Frontend tests: ~10-15s (type check + unit tests)

### Local Development with Virtual Environment

To use the same setup as CI locally:

```bash
# Create virtual environment
cd backend
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Run tests (venv will be auto-detected)
cd ..
./scripts/test.sh
```

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

## Database Management

SQLite database is stored in `data/sambee.db`

Reset database:
```bash
rm -f data/sambee.db
cd backend
python -c "from app.db.database import init_db; init_db()"
```

## Adding New File Viewer Types

1. Create preview component in `frontend/src/components/Viewer/`
2. Register in `ViewerContainer.tsx`
3. Add MIME type mapping in `viewer.service.ts`