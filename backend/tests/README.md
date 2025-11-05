# Sambee Backend Tests

Comprehensive test suite for the Sambee backend API.

## Test Results

**Status**: ✅ All tests passing  
**Total Tests**: 48  
**Code Coverage**: 49%

## Test Suites

### Authentication Tests (`test_auth.py`)
- ✅ Password hashing and verification (Argon2)
- ✅ Password encryption/decryption (Fernet)
- ✅ JWT token generation and validation
- ✅ Login endpoint (success, failures, edge cases)
- ✅ Authentication middleware
- ✅ Admin authorization checks

**Coverage**: 19 tests

### Connection Management Tests (`test_connections.py`)
- ✅ List connections (auth, permissions)
- ✅ Create connections (validation, SMB test mocking)
- ✅ Update connections (partial updates, permissions)
- ✅ Delete connections (cascade, permissions)
- ✅ Test connection endpoint

**Coverage**: 19 tests

### File Browsing Tests (`test_browser.py`)
- ✅ List directory (with mocked SMB backend)
- ✅ Get file info
- ✅ Authentication checks
- ✅ FileInfo model validation

**Coverage**: 10 tests

## Running Tests

```bash
# All tests with coverage
pytest

# Specific test file
pytest tests/test_auth.py

# Specific test
pytest tests/test_auth.py::TestLoginEndpoint::test_login_success

# With verbose output
pytest -v

# Coverage report
pytest --cov=app --cov-report=html
open htmlcov/index.html
```

## Test Fixtures

Shared fixtures in `conftest.py`:

- **Database**: `engine`, `session`, `test_db_path`
- **Users**: `admin_user`, `regular_user`
- **Tokens**: `admin_token`, `user_token`
- **Headers**: `auth_headers_admin`, `auth_headers_user`
- **Connections**: `test_connection`, `multiple_connections`
- **Client**: `client` (TestClient with db override)

## Mocking Strategy

- **SMB Backend**: Mocked in browser tests to avoid dependency on real SMB server
- **Database**: In-memory SQLite for speed
- **Authentication**: Real JWT tokens for integration tests

## Coverage by Module

| Module | Coverage | Notes |
|--------|----------|-------|
| `app/models/` | 100% | All models fully tested |
| `app/core/config.py` | 100% | Configuration tested |
| `app/core/security.py` | 96% | High coverage on crypto/auth |
| `app/api/admin.py` | 89% | Admin endpoints well tested |
| `app/api/browser.py` | 85% | File browsing covered |
| `app/api/auth.py` | 77% | Auth endpoints covered |
| `app/db/database.py` | 70% | DB initialization tested |

**Areas for future testing**:
- WebSocket endpoints (16% coverage)
- Directory monitoring service (12% coverage)
- Preview endpoints (27% coverage)
- SMB storage backend (34% coverage)

## Writing New Tests

Example test structure:

```python
import pytest
from fastapi.testclient import TestClient

@pytest.mark.integration
class TestMyFeature:
    """Test description."""
    
    def test_something(
        self,
        client: TestClient,
        auth_headers_admin: dict
    ):
        """Test a specific behavior."""
        response = client.post(
            "/api/endpoint",
            headers=auth_headers_admin,
            json={"data": "value"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["field"] == "expected"
```

### Test Markers

- `@pytest.mark.unit` - Unit tests (no external dependencies)
- `@pytest.mark.integration` - Integration tests (API endpoints)
- `@pytest.mark.slow` - Slow tests (optional exclusion)
- `@pytest.mark.websocket` - WebSocket tests

## CI/CD Integration

Tests are configured for CI with:
- Coverage reporting (HTML, XML, terminal)
- JUnit XML output for CI systems
- Configurable via `pytest.ini`

```bash
# CI-friendly run
pytest --cov=app --cov-report=xml --cov-report=term --junitxml=junit.xml
```
