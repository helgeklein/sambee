"""Tests for SMB connection visibility and ownership-aware management."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.security import decrypt_password
from app.models.connection import Connection, ConnectionScope
from app.models.user import User


@pytest.mark.integration
class TestListConnections:
    """Connection listing returns shared connections plus the caller's private ones."""

    def test_admin_lists_shared_and_own_private_only(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        multiple_connections: list[Connection],
        other_private_connection: Connection,
    ) -> None:
        response = client.get("/api/connections", headers=auth_headers_admin)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == len(multiple_connections)
        assert all(connection["scope"] == "shared" for connection in data)
        assert all(connection["can_manage"] is True for connection in data)
        assert all(connection["id"] != str(other_private_connection.id) for connection in data)

    def test_regular_user_lists_shared_and_owned_private(
        self,
        client: TestClient,
        auth_headers_user: dict,
        multiple_connections: list[Connection],
        user_private_connection: Connection,
        other_private_connection: Connection,
    ) -> None:
        response = client.get("/api/connections", headers=auth_headers_user)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == len(multiple_connections) + 1

        own_private = next(connection for connection in data if connection["id"] == str(user_private_connection.id))
        assert own_private["scope"] == "private"
        assert own_private["can_manage"] is True

        shared_connections = [connection for connection in data if connection["scope"] == "shared"]
        assert len(shared_connections) == len(multiple_connections)
        assert all(connection["can_manage"] is False for connection in shared_connections)
        assert all(connection["id"] != str(other_private_connection.id) for connection in data)

    def test_list_connections_without_auth(self, client: TestClient) -> None:
        response = client.get("/api/connections")
        assert response.status_code == 401

    def test_admin_alias_route_removed(
        self,
        client: TestClient,
        auth_headers_user: dict,
    ) -> None:
        response = client.get("/api/admin/connections", headers=auth_headers_user)

        assert response.status_code == 404

    def test_admin_gets_shared_visibility_option(
        self,
        client: TestClient,
        auth_headers_admin: dict,
    ) -> None:
        response = client.get("/api/connections/visibility-options", headers=auth_headers_admin)

        assert response.status_code == 200
        data = response.json()
        assert [option["value"] for option in data] == ["shared", "private"] or [option["value"] for option in data] == [
            "private",
            "shared",
        ]
        shared_option = next(option for option in data if option["value"] == "shared")
        assert shared_option["available"] is True
        assert shared_option["unavailable_reason"] is None

    def test_regular_user_gets_shared_visibility_option_disabled(
        self,
        client: TestClient,
        auth_headers_user: dict,
    ) -> None:
        response = client.get("/api/connections/visibility-options", headers=auth_headers_user)

        assert response.status_code == 200
        data = response.json()
        shared_option = next(option for option in data if option["value"] == "shared")
        private_option = next(option for option in data if option["value"] == "private")

        assert private_option["available"] is True
        assert shared_option["available"] is False
        assert shared_option["unavailable_reason"] == "Shared connections can only be created or updated by admins."


@pytest.mark.integration
class TestCreateConnection:
    """Connection creation resolves scope according to the caller's permissions."""

    def test_admin_can_create_shared_connection(self, client: TestClient, auth_headers_admin: dict, session: Session) -> None:
        connection_data = {
            "name": "Shared Server",
            "host": "shared.local",
            "share_name": "sharedshare",
            "username": "shareduser",
            "password": "sharedpass123",
            "port": 445,
            "scope": "shared",
        }

        with patch("app.api.connections.SMBBackend") as mock_backend:
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_instance.list_directory.return_value = []
            mock_backend.return_value = mock_instance

            response = client.post("/api/connections", headers=auth_headers_admin, json=connection_data)

        assert response.status_code == 200
        data = response.json()
        assert data["scope"] == "shared"
        assert data["can_manage"] is True

        db_connection = session.get(Connection, uuid.UUID(data["id"]))
        assert db_connection is not None
        assert db_connection.scope == ConnectionScope.SHARED
        assert db_connection.owner_user_id is None
        assert decrypt_password(db_connection.password_encrypted) == connection_data["password"]

    def test_regular_user_create_request_is_private(
        self,
        client: TestClient,
        auth_headers_user: dict,
        session: Session,
        regular_user: User,
    ) -> None:
        connection_data = {
            "name": "Requested Shared Server",
            "host": "user.local",
            "share_name": "usershare",
            "username": "user1",
            "password": "userpass123",
            "port": 445,
            "scope": "shared",
        }

        with patch("app.api.connections.SMBBackend") as mock_backend:
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_instance.list_directory.return_value = []
            mock_backend.return_value = mock_instance

            response = client.post("/api/connections", headers=auth_headers_user, json=connection_data)

        assert response.status_code == 200
        data = response.json()
        assert data["scope"] == "private"
        assert data["can_manage"] is True

        db_connection = session.get(Connection, uuid.UUID(data["id"]))
        assert db_connection is not None
        assert db_connection.scope == ConnectionScope.PRIVATE
        assert db_connection.owner_user_id == regular_user.id


@pytest.mark.integration
class TestUpdateConnection:
    """Only manageable connections can be updated."""

    def test_regular_user_can_update_owned_private_connection(
        self,
        client: TestClient,
        auth_headers_user: dict,
        user_private_connection: Connection,
        session: Session,
    ) -> None:
        update_data = {
            "name": "Updated Private Server",
            "password": "updatedpass123",
        }

        with patch("app.api.connections.SMBBackend") as mock_backend:
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_instance.list_directory.return_value = []
            mock_backend.return_value = mock_instance

            response = client.put(
                f"/api/connections/{user_private_connection.id}",
                headers=auth_headers_user,
                json=update_data,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == update_data["name"]
        assert data["scope"] == "private"
        assert data["can_manage"] is True

        session.refresh(user_private_connection)
        assert user_private_connection.name == update_data["name"]
        assert decrypt_password(user_private_connection.password_encrypted) == update_data["password"]

    def test_regular_user_cannot_update_shared_connection(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
    ) -> None:
        response = client.put(
            f"/api/connections/{test_connection.id}",
            headers=auth_headers_user,
            json={"name": "Forbidden Update"},
        )

        assert response.status_code == 403

    def test_regular_user_cannot_update_other_private_connection(
        self,
        client: TestClient,
        auth_headers_user: dict,
        other_private_connection: Connection,
    ) -> None:
        response = client.put(
            f"/api/connections/{other_private_connection.id}",
            headers=auth_headers_user,
            json={"name": "Invisible Update"},
        )

        assert response.status_code == 404


@pytest.mark.integration
class TestDeleteConnection:
    """Deletion follows the same visibility and management rules."""

    def test_regular_user_can_delete_owned_private_connection(
        self,
        client: TestClient,
        auth_headers_user: dict,
        user_private_connection: Connection,
        session: Session,
    ) -> None:
        response = client.delete(f"/api/connections/{user_private_connection.id}", headers=auth_headers_user)

        assert response.status_code == 200
        assert session.get(Connection, user_private_connection.id) is None

    def test_regular_user_cannot_delete_shared_connection(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
    ) -> None:
        response = client.delete(f"/api/connections/{test_connection.id}", headers=auth_headers_user)
        assert response.status_code == 403


@pytest.mark.integration
class TestTestConnection:
    """Testing a connection requires management rights on that connection."""

    def test_regular_user_can_test_owned_private_connection(
        self,
        client: TestClient,
        auth_headers_user: dict,
        user_private_connection: Connection,
    ) -> None:
        with patch("app.api.connections.SMBBackend") as mock_backend:
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_instance.list_directory.return_value = type("Listing", (), {"total": 3})()
            mock_backend.return_value = mock_instance

            response = client.post(
                f"/api/connections/{user_private_connection.id}/test",
                headers=auth_headers_user,
            )

        assert response.status_code == 200
        assert response.json()["status"] == "success"

    def test_regular_user_cannot_test_shared_connection(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
    ) -> None:
        response = client.post(f"/api/connections/{test_connection.id}/test", headers=auth_headers_user)
        assert response.status_code == 403

    def test_test_config_endpoint_validates_without_persisting(
        self,
        client: TestClient,
        auth_headers_user: dict,
        session: Session,
    ) -> None:
        with patch("app.api.connections.SMBBackend") as mock_backend:
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_instance.list_directory.return_value = []
            mock_backend.return_value = mock_instance

            response = client.post(
                "/api/connections/test-config",
                headers=auth_headers_user,
                json={
                    "name": "Preview Only",
                    "host": "preview.local",
                    "share_name": "preview-share",
                    "username": "preview-user",
                    "password": "previewpass123",
                    "port": 445,
                    "scope": "shared",
                },
            )

        assert response.status_code == 200
        stored = session.exec(select(Connection).where(Connection.name == "Preview Only")).first()
        assert stored is None

    def test_test_config_neutral_route_alias(
        self,
        client: TestClient,
        auth_headers_user: dict,
    ) -> None:
        with patch("app.api.connections.SMBBackend") as mock_backend:
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_instance.list_directory.return_value = []
            mock_backend.return_value = mock_instance

            response = client.post(
                "/api/connections/test-config",
                headers=auth_headers_user,
                json={
                    "name": "Neutral Preview",
                    "host": "preview.local",
                    "share_name": "preview-share",
                    "username": "preview-user",
                    "password": "previewpass123",
                    "port": 445,
                    "scope": "private",
                },
            )

        assert response.status_code == 200
        assert response.json()["status"] == "success"

    def test_test_config_timeout_returns_gateway_timeout(
        self,
        client: TestClient,
        auth_headers_user: dict,
    ) -> None:
        with patch("app.api.connections.SMBBackend") as mock_backend:
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_instance.list_directory.side_effect = TimeoutError("SMB operation timed out during list_directory")
            mock_backend.return_value = mock_instance

            response = client.post(
                "/api/connections/test-config",
                headers=auth_headers_user,
                json={
                    "name": "Slow Preview",
                    "host": "preview.local",
                    "share_name": "preview-share",
                    "username": "preview-user",
                    "password": "previewpass123",
                    "port": 445,
                    "scope": "private",
                },
            )

        assert response.status_code == 504
        assert response.json()["detail"] == "Connection test timed out. The remote share did not respond in time."

    def test_persisted_test_timeout_returns_gateway_timeout(
        self,
        client: TestClient,
        auth_headers_user: dict,
        user_private_connection: Connection,
    ) -> None:
        with patch("app.api.connections.SMBBackend") as mock_backend:
            mock_instance = AsyncMock()
            mock_instance.connect.return_value = None
            mock_instance.disconnect.return_value = None
            mock_instance.list_directory.side_effect = TimeoutError("SMB operation timed out during list_directory")
            mock_backend.return_value = mock_instance

            response = client.post(
                f"/api/connections/{user_private_connection.id}/test",
                headers=auth_headers_user,
            )

        assert response.status_code == 504
        assert response.json()["detail"] == "Connection test timed out. The remote share did not respond in time."
