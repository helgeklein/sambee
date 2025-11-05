"""
Tests for SMB connection management (admin API).
Tests CRUD operations on connections with proper authorization.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from app.core.security import decrypt_password
from app.models.connection import Connection
from fastapi.testclient import TestClient
from sqlmodel import Session


@pytest.mark.integration
class TestListConnections:
    """Test listing SMB connections."""

    def test_list_connections_as_admin(
        self, client: TestClient, auth_headers_admin: dict, multiple_connections: list
    ):
        """Test that admin can list all connections."""
        response = client.get("/api/admin/connections", headers=auth_headers_admin)

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 3
        # Check structure
        assert "name" in data[0]
        assert "host" in data[0]
        assert "share_name" in data[0]

    def test_list_connections_empty(self, client: TestClient, auth_headers_admin: dict):
        """Test listing connections when database is empty."""
        response = client.get("/api/admin/connections", headers=auth_headers_admin)

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_list_connections_without_auth(self, client: TestClient):
        """Test that listing connections requires authentication."""
        response = client.get("/api/admin/connections")
        assert response.status_code == 401

    def test_list_connections_as_regular_user(
        self, client: TestClient, auth_headers_user: dict, multiple_connections: list
    ):
        """Test that regular users cannot list connections."""
        response = client.get("/api/admin/connections", headers=auth_headers_user)
        assert response.status_code == 403


@pytest.mark.integration
class TestCreateConnection:
    """Test creating SMB connections."""

    def test_create_connection_success(
        self, client: TestClient, auth_headers_admin: dict, session: Session
    ):
        """Test creating a new connection with valid data."""
        connection_data = {
            "name": "New Test Server",
            "host": "newserver.local",
            "share_name": "newshare",
            "username": "newuser",
            "password": "newpass123",
            "port": 445,
        }

        with patch("app.api.admin.SMBBackend") as mock_backend:
            # Mock the SMB backend test connection
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_backend.return_value = mock_instance

            response = client.post(
                "/api/admin/connections",
                headers=auth_headers_admin,
                json=connection_data,
            )

            assert response.status_code == 200  # Default FastAPI status code
            data = response.json()
            assert data["name"] == connection_data["name"]
            assert data["host"] == connection_data["host"]
            assert data["share_name"] == connection_data["share_name"]
            assert data["username"] == connection_data["username"]
            assert "id" in data
            assert "password" not in data  # Password should not be returned
            assert "password_encrypted" not in data

            # Verify in database
            conn_id = uuid.UUID(data["id"])
            db_conn = session.get(Connection, conn_id)
            assert db_conn is not None
            assert db_conn.name == connection_data["name"]
            # Verify password is encrypted in DB
            decrypted = decrypt_password(db_conn.password_encrypted)
            assert decrypted == connection_data["password"]

    def test_create_connection_custom_port(
        self, client: TestClient, auth_headers_admin: dict
    ):
        """Test creating connection with custom port."""
        connection_data = {
            "name": "Custom Port Server",
            "host": "server.local",
            "share_name": "share",
            "username": "user",
            "password": "pass",
            "port": 8445,
        }

        with patch("app.api.admin.SMBBackend") as mock_backend:
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_backend.return_value = mock_instance

            response = client.post(
                "/api/admin/connections",
                headers=auth_headers_admin,
                json=connection_data,
            )

            assert response.status_code == 200  # Default FastAPI status code
            data = response.json()
            assert data["port"] == 8445

    def test_create_connection_missing_required_fields(
        self, client: TestClient, auth_headers_admin: dict
    ):
        """Test that creating connection without required fields fails."""
        incomplete_data = {
            "name": "Incomplete Server",
            "host": "server.local",
            # Missing share_name, username, password
        }

        response = client.post(
            "/api/admin/connections",
            headers=auth_headers_admin,
            json=incomplete_data,
        )

        assert response.status_code == 422  # Validation error

    def test_create_connection_as_regular_user(
        self, client: TestClient, auth_headers_user: dict
    ):
        """Test that regular users cannot create connections."""
        connection_data = {
            "name": "Unauthorized Server",
            "host": "server.local",
            "share_name": "share",
            "username": "user",
            "password": "pass",
        }

        response = client.post(
            "/api/admin/connections",
            headers=auth_headers_user,
            json=connection_data,
        )

        assert response.status_code == 403

    def test_create_connection_without_auth(self, client: TestClient):
        """Test that creating connection requires authentication."""
        connection_data = {
            "name": "No Auth Server",
            "host": "server.local",
            "share_name": "share",
            "username": "user",
            "password": "pass",
        }

        response = client.post("/api/admin/connections", json=connection_data)
        assert response.status_code == 401


@pytest.mark.integration
class TestUpdateConnection:
    """Test updating SMB connections."""

    def test_update_connection_success(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        session: Session,
    ):
        """Test updating a connection with valid data."""
        update_data = {
            "name": "Updated Server Name",
            "host": "updated-server.local",
            "share_name": "updatedshare",
            "username": "updateduser",
            "password": "updatedpass123",
            "port": 8445,
        }

        with patch("app.api.admin.SMBBackend") as mock_backend:
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_backend.return_value = mock_instance

            response = client.put(
                f"/api/admin/connections/{test_connection.id}",
                headers=auth_headers_admin,
                json=update_data,
            )

            assert response.status_code == 200
            data = response.json()
            assert data["name"] == update_data["name"]
            assert data["host"] == update_data["host"]
            assert data["port"] == 8445

            # Verify in database
            session.refresh(test_connection)
            assert test_connection.name == update_data["name"]
            assert (
                decrypt_password(test_connection.password_encrypted)
                == update_data["password"]
            )

    def test_update_connection_partial(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        session: Session,
    ):
        """Test updating only some fields of a connection."""
        original_host = test_connection.host
        update_data = {
            "name": "Partially Updated Server",
        }

        response = client.put(
            f"/api/admin/connections/{test_connection.id}",
            headers=auth_headers_admin,
            json=update_data,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == update_data["name"]
        # Host should remain unchanged
        assert data["host"] == original_host

    def test_update_nonexistent_connection(
        self, client: TestClient, auth_headers_admin: dict
    ):
        """Test updating a connection that doesn't exist."""
        fake_id = uuid.uuid4()
        update_data = {"name": "Non-existent Server"}

        response = client.put(
            f"/api/admin/connections/{fake_id}",
            headers=auth_headers_admin,
            json=update_data,
        )

        assert response.status_code == 404

    def test_update_connection_as_regular_user(
        self, client: TestClient, auth_headers_user: dict, test_connection: Connection
    ):
        """Test that regular users cannot update connections."""
        update_data = {"name": "Unauthorized Update"}

        response = client.put(
            f"/api/admin/connections/{test_connection.id}",
            headers=auth_headers_user,
            json=update_data,
        )

        assert response.status_code == 403


@pytest.mark.integration
class TestDeleteConnection:
    """Test deleting SMB connections."""

    def test_delete_connection_success(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        session: Session,
    ):
        """Test deleting a connection successfully."""
        conn_id = test_connection.id

        response = client.delete(
            f"/api/admin/connections/{conn_id}",
            headers=auth_headers_admin,
        )

        assert response.status_code == 200
        assert "deleted" in response.json()["message"].lower()

        # Verify deletion in database
        deleted_conn = session.get(Connection, conn_id)
        assert deleted_conn is None

    def test_delete_nonexistent_connection(
        self, client: TestClient, auth_headers_admin: dict
    ):
        """Test deleting a connection that doesn't exist."""
        fake_id = uuid.uuid4()

        response = client.delete(
            f"/api/admin/connections/{fake_id}",
            headers=auth_headers_admin,
        )

        assert response.status_code == 404

    def test_delete_connection_as_regular_user(
        self, client: TestClient, auth_headers_user: dict, test_connection: Connection
    ):
        """Test that regular users cannot delete connections."""
        response = client.delete(
            f"/api/admin/connections/{test_connection.id}",
            headers=auth_headers_user,
        )

        assert response.status_code == 403

    def test_delete_connection_without_auth(
        self, client: TestClient, test_connection: Connection
    ):
        """Test that deleting connection requires authentication."""
        response = client.delete(f"/api/admin/connections/{test_connection.id}")
        assert response.status_code == 401


@pytest.mark.integration
class TestTestConnection:
    """Test the connection test endpoint."""

    def test_test_connection_endpoint_exists(
        self, client: TestClient, auth_headers_admin: dict, test_connection: Connection
    ):
        """Test that the test connection endpoint is accessible."""
        response = client.post(
            f"/api/admin/connections/{test_connection.id}/test",
            headers=auth_headers_admin,
        )

        # Will likely fail to connect to test server, but endpoint should exist
        # Should not be 404 or 405
        assert response.status_code != 404
        assert response.status_code != 405

    def test_test_nonexistent_connection(
        self, client: TestClient, auth_headers_admin: dict
    ):
        """Test testing a connection that doesn't exist."""
        fake_id = uuid.uuid4()

        response = client.post(
            f"/api/admin/connections/{fake_id}/test",
            headers=auth_headers_admin,
        )

        assert response.status_code == 404
