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
# Backend tests
cd backend && pytest

# Frontend tests
cd frontend && npm test
```

## Running Tests

### Backend Tests

Sambee includes comprehensive backend tests using pytest. Tests cover authentication, connection management, file browsing, and more.

```bash
# Run all tests
cd backend && pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/test_auth.py

# Run specific test class or function
pytest tests/test_auth.py::TestLoginEndpoint
pytest tests/test_auth.py::TestLoginEndpoint::test_login_success

# Run with coverage report
pytest --cov=app --cov-report=html

# View coverage report
open htmlcov/index.html  # or browse to file:///.../htmlcov/index.html
```

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

## Adding New File Preview Types

1. Create preview component in `frontend/src/components/Preview/`
2. Register in `PreviewContainer.tsx`
3. Add MIME type mapping in `preview.service.ts`