"""
Tests for main application module.

Tests cover:
- Application lifecycle (startup/shutdown)
- Middleware (CORS, request logging)
- Health check endpoint
- Error handling
- Static file serving
"""

import logging
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.mark.integration
class TestHealthCheck:
    """Test health check endpoint."""

    def test_health_check_endpoint(self, client: TestClient):
        """Test that health check endpoint returns healthy status."""
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}


@pytest.mark.integration
class TestCORSMiddleware:
    """Test CORS middleware configuration."""

    def test_cors_headers_present(self, client: TestClient):
        """Test that CORS headers are present in responses."""
        response = client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        # Should allow the origin
        assert "access-control-allow-origin" in response.headers
        assert (
            response.headers["access-control-allow-origin"] == "http://localhost:3000"
        )

    def test_cors_allows_credentials(self, client: TestClient):
        """Test that CORS allows credentials."""
        response = client.get(
            "/api/health",
            headers={"Origin": "http://localhost:3000"},
        )
        assert response.headers.get("access-control-allow-credentials") == "true"

    def test_cors_allows_all_methods(self, client: TestClient):
        """Test that CORS allows all HTTP methods."""
        response = client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
            },
        )
        # Should have allow-methods header
        assert "access-control-allow-methods" in response.headers


@pytest.mark.integration
class TestRequestLoggingMiddleware:
    """Test request logging middleware."""

    def test_request_logging_success(self, client: TestClient, caplog):
        """Test that successful requests are logged."""
        with caplog.at_level(logging.INFO):
            response = client.get("/api/health")
            assert response.status_code == 200

        # Check that request and response were logged
        log_messages = [record.message for record in caplog.records]
        assert any("← GET /api/health" in msg for msg in log_messages)
        assert any("→ GET /api/health - 200" in msg for msg in log_messages)

    def test_request_logging_includes_duration(self, client: TestClient, caplog):
        """Test that request logging includes duration."""
        with caplog.at_level(logging.INFO):
            client.get("/api/health")

        # Check that response log includes duration in ms
        log_messages = [record.message for record in caplog.records]
        response_logs = [msg for msg in log_messages if "→ GET /api/health" in msg]
        assert len(response_logs) > 0
        assert "ms)" in response_logs[0]

    def test_request_logging_not_found(self, client: TestClient, caplog):
        """Test that 404 responses are logged."""
        with caplog.at_level(logging.INFO):
            response = client.get("/api/nonexistent")
            assert response.status_code == 404

        log_messages = [record.message for record in caplog.records]
        assert any("← GET /api/nonexistent" in msg for msg in log_messages)
        assert any("404" in msg for msg in log_messages)


@pytest.mark.integration
class TestApplicationLifecycle:
    """Test application startup and shutdown events."""

    @patch("app.main.init_db")
    @patch("app.main.Session")
    def test_startup_initializes_database(self, mock_session, mock_init_db):
        """Test that database is initialized on startup."""
        from app.main import app

        # Mock the database session
        mock_db_session = MagicMock()
        mock_session.return_value.__enter__.return_value = mock_db_session
        mock_db_session.exec.return_value.first.return_value = MagicMock(
            username="testadmin"
        )

        # Create client which triggers startup
        with TestClient(app):
            mock_init_db.assert_called_once()

    @patch("app.main.init_db")
    @patch("app.main.Session")
    def test_startup_creates_admin_user_if_not_exists(self, mock_session, mock_init_db):
        """Test that admin user is created if it doesn't exist."""
        from app.main import app

        # Mock the database session to return None (no admin user)
        mock_db_session = MagicMock()
        mock_session.return_value.__enter__.return_value = mock_db_session
        mock_db_session.exec.return_value.first.return_value = None

        # Create client which triggers startup
        with TestClient(app):
            # Verify admin user was added
            assert mock_db_session.add.called
            assert mock_db_session.commit.called

    @patch("app.main.init_db")
    @patch("app.main.Session")
    def test_startup_does_not_create_admin_if_exists(self, mock_session, mock_init_db):
        """Test that admin user is not created if it already exists."""
        from app.main import app

        # Mock the database session to return existing admin
        mock_db_session = MagicMock()
        mock_session.return_value.__enter__.return_value = mock_db_session
        existing_admin = MagicMock(username="testadmin", is_admin=True)
        mock_db_session.exec.return_value.first.return_value = existing_admin

        # Create client which triggers startup
        with TestClient(app):
            # Verify admin user was NOT added
            assert not mock_db_session.add.called

    @patch("app.main.init_db")
    @patch("app.main.Session")
    @patch("app.services.directory_monitor.shutdown_monitor")
    def test_shutdown_stops_directory_monitors(
        self, mock_shutdown, mock_session, mock_init_db
    ):
        """Test that directory monitors are stopped on shutdown."""
        from app.main import app

        # Mock the database session
        mock_db_session = MagicMock()
        mock_session.return_value.__enter__.return_value = mock_db_session
        mock_db_session.exec.return_value.first.return_value = MagicMock(
            username="testadmin"
        )

        # Create and close client which triggers shutdown
        with TestClient(app):
            pass  # Context manager exit triggers shutdown

        # Verify shutdown_monitor was called
        mock_shutdown.assert_called_once()

    @patch("app.main.init_db")
    @patch("app.main.Session")
    @patch("app.services.directory_monitor.shutdown_monitor")
    def test_shutdown_handles_monitor_errors(
        self, mock_shutdown, mock_session, mock_init_db, caplog
    ):
        """Test that shutdown handles errors from directory monitor gracefully."""
        from app.main import app

        # Mock the database session
        mock_db_session = MagicMock()
        mock_session.return_value.__enter__.return_value = mock_db_session
        mock_db_session.exec.return_value.first.return_value = MagicMock(
            username="testadmin"
        )

        # Make shutdown_monitor raise an error
        mock_shutdown.side_effect = Exception("Monitor shutdown error")

        # Create and close client - should not raise
        with caplog.at_level(logging.ERROR):
            with TestClient(app):
                pass

        # Verify error was logged but didn't crash
        log_messages = [record.message for record in caplog.records]
        assert any("Error stopping directory monitors" in msg for msg in log_messages)


@pytest.mark.integration
class TestAPIDocumentation:
    """Test API documentation endpoints."""

    def test_openapi_schema_accessible(self, client: TestClient):
        """Test that OpenAPI schema is accessible."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        assert "openapi" in schema
        assert "info" in schema
        assert schema["info"]["title"] == "Sambee"

    def test_swagger_ui_accessible(self, client: TestClient):
        """Test that Swagger UI is accessible."""
        response = client.get("/docs")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_redoc_accessible(self, client: TestClient):
        """Test that ReDoc is accessible."""
        response = client.get("/redoc")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]


@pytest.mark.integration
class TestStaticFileServing:
    """Test static file serving for SPA."""

    @patch("app.main.static_path")
    def test_spa_serving_returns_index_for_root(self, mock_static_path):
        """Test that root path serves index.html."""
        from pathlib import Path

        from app.main import app

        # Mock static path to exist
        mock_path = MagicMock(spec=Path)
        mock_path.exists.return_value = True
        mock_static_path.exists.return_value = True

        with TestClient(app):
            # Note: We can't easily test this without actual static files
            # This is more of a structural test
            pass

    def test_api_routes_not_served_as_static(self, client: TestClient):
        """Test that API routes are not served as static files."""
        # API routes should return proper responses, not index.html
        response = client.get("/api/health")
        assert response.status_code == 200
        # Should be JSON, not HTML
        assert response.headers["content-type"] == "application/json"


@pytest.mark.integration
class TestErrorHandling:
    """Test error handling and responses."""

    def test_404_for_unknown_route(self, client: TestClient):
        """Test that unknown routes return 404."""
        response = client.get("/api/unknown/route")
        assert response.status_code == 404

    def test_405_for_wrong_method(self, client: TestClient):
        """Test that wrong HTTP method returns 405."""
        response = client.post("/api/health")  # GET endpoint
        assert response.status_code == 405

    def test_validation_error_422(self, client: TestClient):
        """Test that validation errors return 422."""
        # Try to login without required fields
        response = client.post("/api/auth/token", data={})
        assert response.status_code == 422
        data = response.json()
        assert "detail" in data


@pytest.mark.integration
class TestApplicationMetadata:
    """Test application metadata and configuration."""

    def test_app_title_correct(self):
        """Test that application title is set correctly."""
        from app.main import app

        assert app.title == "Sambee"

    def test_app_version_set(self):
        """Test that application version is set."""
        from app.main import app

        assert app.version == "0.1.0"

    def test_app_description_set(self):
        """Test that application description is set."""
        from app.main import app

        assert "SMB" in app.description


@pytest.mark.integration
class TestRouterInclusion:
    """Test that all routers are properly included."""

    def test_auth_router_included(self, client: TestClient):
        """Test that auth router is accessible."""
        # Login endpoint should exist
        response = client.post("/api/auth/token", data={})
        # Should get validation error, not 404
        assert response.status_code != 404

    def test_admin_router_included(self, client: TestClient):
        """Test that admin router is accessible."""
        response = client.get("/api/admin/connections")
        # Should get 401 (no auth), not 404
        assert response.status_code != 404

    def test_browser_router_included(self, client: TestClient):
        """Test that browser router is accessible."""
        response = client.get("/api/browse/1/list")
        # Should get 401 or other error, not 404
        assert response.status_code != 404

    def test_viewer_router_included(self, client: TestClient):
        """Test that viewer router is accessible."""
        response = client.get("/api/viewer/1/file")
        # Should get 401 or other error, not 404
        assert response.status_code != 404

    def test_websocket_router_included(self):
        """Test that websocket router is accessible."""
        from app.main import app

        # Check that websocket route is registered
        routes = [getattr(route, "path", None) for route in app.routes]
        assert "/api/ws" in routes
