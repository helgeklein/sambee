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
   - Configure Git hooks for automatic commit tracking
    - Install Python dependencies from the hashed lockfiles
    - Install Node modules from the committed lockfiles
   - Initialize the database
   - Create default `config.toml` file with secure keys

**Note on Git Hooks:** The dev container automatically configures Git to use hooks from `.githooks/`. These hooks update the `GIT_COMMIT` file after commits and checkouts, ensuring Docker builds always have the current commit hash.

If you're developing **outside the dev container**, run once:
```bash
./scripts/setup-git-hooks
```

### Dependency Trust Rules

- Use `npm ci` in `frontend/`, `companion/`, and `website/` for routine installs. Only use a dependency update PR to change `package.json` and `package-lock.json` together.
- Keep high-risk frontend ecosystem packages pinned to exact reviewed versions in `package.json`. Treat major upgrades for `@mui/material`, `@mui/icons-material`, `react`, `react-dom`, `react-router-dom`, `react-markdown`, `i18next`, `react-i18next`, `typescript`, `jsdom`, `vite`, `@vitejs/plugin-react`, and `@preact/preset-vite` as coordinated manual changes rather than routine Dependabot updates.
- Keep Python pinned to the reviewed `3.13.12` baseline across production Docker, the devcontainer image, and GitHub Actions. Treat Python runtime upgrades as coordinated manual changes rather than routine Dependabot updates.
- Use `pip install --require-hashes -r requirements-dev.lock.txt` for backend installs. Treat `requirements*.txt` changes as reviewed source, not setup noise.
- Prefer committed scripts and lockfiles over ad hoc installers or one-off `npx` downloads.

### Backend Dependency Security Updates

When a backend dependency audit fails, update the direct requirement files first and regenerate the lockfiles from those reviewed sources.

- Change the top-level pins in `requirements.txt` and `requirements-dev.txt`, not just the generated `requirements.lock.txt` files.
- Regenerate `requirements.lock.txt` and `requirements-dev.lock.txt` with `pip-compile --allow-unsafe --generate-hashes ...` so hashes and transitive dependencies stay consistent.
- If the resolver reports a conflict, treat that as a real compatibility constraint and update the companion package explicitly. Example: upgrading `pytest` to `9.0.3` also required upgrading `pytest-asyncio` because `pytest-asyncio==1.2.0` required `pytest<9`.
- After regenerating lockfiles, validate with the relevant backend checks, at minimum `pytest -v` and `mypy app`.
- Do not hand-edit lockfile hashes except as a last resort. Prefer reproducible regeneration from the direct requirement files.

### Troubleshooting Initial Setup

If you encounter startup issues after opening the dev container:

**Backend: Missing `config.toml` file**
- The backend startup script will automatically create a `config.toml` file with secure keys if missing
- The file is created at `/workspace/config.toml`

**Frontend: `vite: not found` or permission errors**
- The frontend startup script will automatically:
  - Fix permission issues with `node_modules`
  - Reinstall dependencies if needed
- If issues persist, manually run: `cd /workspace/frontend && sudo rm -rf node_modules && npm ci`

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

### Website Development

Use the repo-level wrapper so the Hugo workflow behaves like the other development services:

```bash
./scripts/start-website
```

This script:

- verifies the dev container environment
- checks `node`, `npm`, and `hugo`
- installs `website/` dependencies if `node_modules` is missing
- stops an existing Sambee website dev server on port `1313`
- prebuilds the Pagefind search index
- starts the Hugo dev server from `website/`
- keeps the Pagefind index refreshed while Hugo updates generated HTML on disk

The website dev server runs at: http://localhost:1313

Search should be available during normal development without running a separate indexing command.

To stop it directly:

```bash
./scripts/stop-website
```

You can also start it from the VS Code task named `Website: Start Dev Server`.

### Running Tests

```bash
# Run all tests (backend + frontend) - fast, no coverage
./scripts/test

# Run all tests with coverage (CI mode)
COVERAGE=1 ./scripts/test

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

## Localization

For translation system conventions, key-safety rules, and pseudo-locale guidance, see [LOCALIZATION.md](./LOCALIZATION.md).

## CI/CD and GitHub Actions

The project uses GitHub Actions for continuous integration. Tests run automatically on pushes and pull requests to the `main` branch.

### Performance Optimizations

**Dependency Caching:**
- Python virtual environment is cached (`.venv/`)
- Node modules are cached (`node_modules/`)
- mypy cache is cached (`.mypy_cache/`)
- On cache hit: installation skipped, saving ~30-40 seconds
- Cache invalidates when the reviewed dependency inputs change: `requirements*.txt` or `package-lock.json`

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

### Dependency Security Checks

Dependency security audits run in a dedicated GitHub Actions workflow on a weekly schedule and can also be started manually with `workflow_dispatch`. They do not run on normal pushes or pull requests.

The workflow covers:

- Backend: `pip-audit -r backend/requirements-dev.lock.txt`
- Frontend and Companion: `npm audit --package-lock-only --omit=dev --audit-level=high`
- Companion Rust dependencies: `cargo audit`

Run the relevant audit locally before merging dependency updates, especially when changing lockfiles or pinned versions.

### Local Development with Virtual Environment

To use the same setup as CI locally:

```bash
# Create virtual environment
cd backend
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install --require-hashes -r requirements-dev.lock.txt

# Run tests (venv will be auto-detected)
cd ..
./scripts/test
```

## Configuration

The `config.toml` file is **automatically created** during dev container setup with secure generated keys.

To customize settings, edit `/workspace/config.toml`:
- `[app]` section - Debug mode, log level
- `[security]` section - JWT signing key, Fernet encryption key, token expiration
- `[admin]` section - Initial admin credentials
- `[paths]` section - Data directory location

**Configuration Priority** (highest to lowest):
1. `config.toml` file (recommended)
2. Code defaults

**Note:** For production deployment, mount `config.toml` as a read-only volume. See `DEPLOYMENT.md` for details.

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
