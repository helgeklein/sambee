"""
Tests for file browsing functionality.
Uses mocked SMB backend to avoid dependency on real SMB server.
"""

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.models.connection import Connection
from app.models.file import DirectoryListing, FileInfo, FileType


@pytest.fixture
def mock_smb_backend():
    """Create a mock SMB backend."""
    with patch("app.api.browser.SMBBackend") as mock:
        backend_instance = AsyncMock()

        # Mock file listing
        mock_files = [
            FileInfo(
                name="document.txt",
                path="/document.txt",
                type=FileType.FILE,
                size=1024,
                modified_at=datetime(2024, 1, 1, 12, 0, 0),
                mime_type="text/plain",
            ),
            FileInfo(
                name="folder",
                path="/folder",
                type=FileType.DIRECTORY,
                size=None,
                modified_at=datetime(2024, 1, 2, 12, 0, 0),
                mime_type=None,
            ),
            FileInfo(
                name="readme.md",
                path="/readme.md",
                type=FileType.FILE,
                size=2048,
                modified_at=datetime(2024, 1, 3, 12, 0, 0),
                mime_type="text/markdown",
            ),
        ]

        # Return DirectoryListing object as the API expects
        backend_instance.list_directory.return_value = DirectoryListing(
            path="",
            items=mock_files,
            total=len(mock_files),
        )
        backend_instance.get_file_info.return_value = mock_files[0]
        backend_instance.connect.return_value = None
        backend_instance.disconnect.return_value = None

        # Mock constructor to return our instance
        mock.return_value = backend_instance

        yield mock, backend_instance


@pytest.mark.integration
class TestListDirectory:
    """Test directory listing endpoint."""

    def test_list_root_directory(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test listing root directory."""
        mock_class, mock_instance = mock_smb_backend

        response = client.get(
            f"/api/browse/{test_connection.id}/list",
            headers=auth_headers_user,
            params={"path": ""},
        )

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert len(data["items"]) == 3

        # Verify first file
        first_file = data["items"][0]
        assert first_file["name"] == "document.txt"
        assert first_file["type"] == "file"
        assert first_file["size"] == 1024

        # Verify directory
        folder = data["items"][1]
        assert folder["name"] == "folder"
        assert folder["type"] == "directory"
        assert folder["size"] is None

        # Verify SMB backend was called correctly
        mock_instance.connect.assert_called_once()
        mock_instance.list_directory.assert_called_once_with("")
        mock_instance.disconnect.assert_called_once()

    def test_list_subdirectory(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test listing a subdirectory."""
        mock_class, mock_instance = mock_smb_backend

        response = client.get(
            f"/api/browse/{test_connection.id}/list",
            headers=auth_headers_admin,
            params={"path": "/folder/subfolder"},
        )

        assert response.status_code == 200
        mock_instance.list_directory.assert_called_once_with("/folder/subfolder")

    def test_list_directory_without_auth(self, client: TestClient, test_connection: Connection):
        """Test that listing directory requires authentication."""
        response = client.get(
            f"/api/browse/{test_connection.id}/list",
            params={"path": ""},
        )
        assert response.status_code == 401

    def test_list_nonexistent_connection(self, client: TestClient, auth_headers_user: dict):
        """Test listing directory for non-existent connection."""
        import uuid

        fake_id = uuid.uuid4()
        response = client.get(
            f"/api/browse/{fake_id}/list",
            headers=auth_headers_user,
            params={"path": ""},
        )
        assert response.status_code == 404

    def test_list_connection_without_share(self, client: TestClient, auth_headers_user: dict, session):
        """Test listing directory for connection without share name."""
        import uuid

        from app.core.security import encrypt_password

        # Create connection without share_name
        incomplete_conn = Connection(
            id=uuid.uuid4(),
            name="Incomplete Connection",
            host="server.local",
            share_name=None,  # Missing share name
            username="user",
            password_encrypted=encrypt_password("pass"),
        )
        session.add(incomplete_conn)
        session.commit()

        response = client.get(
            f"/api/browse/{incomplete_conn.id}/list",
            headers=auth_headers_user,
            params={"path": ""},
        )
        assert response.status_code == 400


@pytest.mark.integration
class TestGetFileInfo:
    """Test get file info endpoint."""

    def test_get_file_info_success(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test getting file info successfully."""
        mock_class, mock_instance = mock_smb_backend

        response = client.get(
            f"/api/browse/{test_connection.id}/info",
            headers=auth_headers_user,
            params={"path": "/document.txt"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "document.txt"
        assert data["type"] == "file"
        assert data["size"] == 1024

        mock_instance.get_file_info.assert_called_once_with("/document.txt")

    def test_get_file_info_without_auth(self, client: TestClient, test_connection: Connection):
        """Test that getting file info requires authentication."""
        response = client.get(
            f"/api/browse/{test_connection.id}/info",
            params={"path": "/document.txt"},
        )
        assert response.status_code == 401


@pytest.mark.unit
class TestFileInfoModel:
    """Test FileInfo model validation."""

    def test_file_info_creation(self):
        """Test creating a FileInfo instance."""
        entry = FileInfo(
            name="test.txt",
            path="/test.txt",
            type=FileType.FILE,
            size=100,
            modified_at=datetime.now(),
            mime_type="text/plain",
        )

        assert entry.name == "test.txt"
        assert entry.type == FileType.FILE
        assert entry.size == 100

    def test_directory_info_creation(self):
        """Test creating a directory FileInfo."""
        entry = FileInfo(
            name="folder",
            path="/folder",
            type=FileType.DIRECTORY,
            size=None,
            modified_at=datetime.now(),
            mime_type=None,
        )

        assert entry.name == "folder"
        assert entry.type == FileType.DIRECTORY
        assert entry.size is None
        assert entry.mime_type is None

    def test_file_info_serialization(self):
        """Test that FileInfo can be serialized to dict."""
        entry = FileInfo(
            name="test.txt",
            path="/test.txt",
            type=FileType.FILE,
            size=100,
            modified_at=datetime(2024, 1, 1, 12, 0, 0),
            mime_type="text/plain",
        )

        data = entry.model_dump()
        assert data["name"] == "test.txt"
        assert data["type"] == "file"
        assert data["size"] == 100


@pytest.mark.integration
class TestDeleteItem:
    """Test delete item endpoint."""

    def test_delete_file_success(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test deleting a file returns 204."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.delete_item.return_value = None

        response = client.delete(
            f"/api/browse/{test_connection.id}/item",
            headers=auth_headers_user,
            params={"path": "/document.txt"},
        )

        assert response.status_code == 204
        mock_instance.connect.assert_called_once()
        mock_instance.delete_item.assert_called_once_with("/document.txt")
        mock_instance.disconnect.assert_called_once()

    def test_delete_empty_directory_success(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test deleting an empty directory returns 204."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.delete_item.return_value = None

        response = client.delete(
            f"/api/browse/{test_connection.id}/item",
            headers=auth_headers_admin,
            params={"path": "/empty-folder"},
        )

        assert response.status_code == 204
        mock_instance.delete_item.assert_called_once_with("/empty-folder")

    def test_delete_without_auth(self, client: TestClient, test_connection: Connection):
        """Test that deletion requires authentication."""
        response = client.delete(
            f"/api/browse/{test_connection.id}/item",
            params={"path": "/document.txt"},
        )
        assert response.status_code == 401

    def test_delete_nonexistent_connection(self, client: TestClient, auth_headers_user: dict):
        """Test deletion for a non-existent connection returns 404."""
        import uuid

        fake_id = uuid.uuid4()
        response = client.delete(
            f"/api/browse/{fake_id}/item",
            headers=auth_headers_user,
            params={"path": "/document.txt"},
        )
        assert response.status_code == 404

    def test_delete_share_root_rejected(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that deleting the share root is rejected with 400."""
        response = client.delete(
            f"/api/browse/{test_connection.id}/item",
            headers=auth_headers_user,
            params={"path": "/"},
        )
        assert response.status_code == 400
        assert "share root" in response.json()["detail"].lower()

    def test_delete_empty_path_rejected(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that an empty path is rejected with 422 (missing required param)."""
        response = client.delete(
            f"/api/browse/{test_connection.id}/item",
            headers=auth_headers_user,
        )
        # path is a required query param – FastAPI returns 422 when omitted
        assert response.status_code == 422

    def test_delete_not_found(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test deleting a non-existent item returns 404."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.delete_item.side_effect = FileNotFoundError("Path not found")

        response = client.delete(
            f"/api/browse/{test_connection.id}/item",
            headers=auth_headers_user,
            params={"path": "/ghost.txt"},
        )
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_delete_directory_recursive_success(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test deleting a non-empty directory succeeds (recursive)."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.delete_item.return_value = None

        response = client.delete(
            f"/api/browse/{test_connection.id}/item",
            headers=auth_headers_user,
            params={"path": "/non-empty-folder"},
        )
        assert response.status_code == 204
        mock_instance.delete_item.assert_called_once_with("/non-empty-folder")

    def test_delete_server_error(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test generic SMB error returns 500."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.delete_item.side_effect = Exception("Connection lost")

        response = client.delete(
            f"/api/browse/{test_connection.id}/item",
            headers=auth_headers_user,
            params={"path": "/document.txt"},
        )
        assert response.status_code == 500


# ──────────────────────────────────────────────────────────────────────────────
# Rename file or directory
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.integration
class TestRenameItem:
    """Test rename item endpoint."""

    def test_rename_file_success(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test renaming a file returns 200 with updated FileInfo."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.rename_item.return_value = None
        mock_instance.get_file_info.return_value = FileInfo(
            name="renamed.txt",
            path="/renamed.txt",
            type=FileType.FILE,
            size=1024,
        )

        response = client.post(
            f"/api/browse/{test_connection.id}/rename",
            headers=auth_headers_user,
            json={"path": "/document.txt", "new_name": "renamed.txt"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "renamed.txt"
        mock_instance.connect.assert_called_once()
        mock_instance.rename_item.assert_called_once_with("/document.txt", "renamed.txt")
        mock_instance.disconnect.assert_called_once()

    def test_rename_directory_success(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test renaming a directory returns 200 with updated FileInfo."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.rename_item.return_value = None
        mock_instance.get_file_info.return_value = FileInfo(
            name="new-folder",
            path="/new-folder",
            type=FileType.DIRECTORY,
        )

        response = client.post(
            f"/api/browse/{test_connection.id}/rename",
            headers=auth_headers_admin,
            json={"path": "/folder", "new_name": "new-folder"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "new-folder"
        assert data["type"] == "directory"

    def test_rename_without_auth(self, client: TestClient, test_connection: Connection):
        """Test that renaming requires authentication."""
        response = client.post(
            f"/api/browse/{test_connection.id}/rename",
            json={"path": "/document.txt", "new_name": "renamed.txt"},
        )
        assert response.status_code == 401

    def test_rename_nonexistent_connection(self, client: TestClient, auth_headers_user: dict):
        """Test renaming for a non-existent connection returns 404."""
        fake_id = uuid.uuid4()
        response = client.post(
            f"/api/browse/{fake_id}/rename",
            headers=auth_headers_user,
            json={"path": "/document.txt", "new_name": "renamed.txt"},
        )
        assert response.status_code == 404

    def test_rename_share_root_rejected(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that renaming the share root is rejected with 400."""
        response = client.post(
            f"/api/browse/{test_connection.id}/rename",
            headers=auth_headers_user,
            json={"path": "/", "new_name": "something"},
        )
        assert response.status_code == 400
        assert "share root" in response.json()["detail"].lower()

    def test_rename_empty_new_name_rejected(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that an empty new name is rejected with 400."""
        response = client.post(
            f"/api/browse/{test_connection.id}/rename",
            headers=auth_headers_user,
            json={"path": "/document.txt", "new_name": "   "},
        )
        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()

    def test_rename_invalid_chars_rejected(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that invalid characters in new name are rejected with 400."""
        response = client.post(
            f"/api/browse/{test_connection.id}/rename",
            headers=auth_headers_user,
            json={"path": "/document.txt", "new_name": "file/name.txt"},
        )
        assert response.status_code == 400
        assert "invalid characters" in response.json()["detail"].lower()

    def test_rename_dot_name_rejected(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that '.' and '..' are rejected as new names."""
        response = client.post(
            f"/api/browse/{test_connection.id}/rename",
            headers=auth_headers_user,
            json={"path": "/document.txt", "new_name": ".."},
        )
        assert response.status_code == 400

    def test_rename_not_found(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test renaming a non-existent item returns 404."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.rename_item.side_effect = FileNotFoundError("Path not found")

        response = client.post(
            f"/api/browse/{test_connection.id}/rename",
            headers=auth_headers_user,
            json={"path": "/ghost.txt", "new_name": "renamed.txt"},
        )
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_rename_name_collision(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test renaming to an existing name returns 409."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.rename_item.side_effect = FileExistsError("An item named 'existing.txt' already exists")

        response = client.post(
            f"/api/browse/{test_connection.id}/rename",
            headers=auth_headers_user,
            json={"path": "/document.txt", "new_name": "existing.txt"},
        )
        assert response.status_code == 409
        assert "already exists" in response.json()["detail"].lower()

    def test_rename_server_error(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test generic SMB error returns 500."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.rename_item.side_effect = Exception("Connection lost")

        response = client.post(
            f"/api/browse/{test_connection.id}/rename",
            headers=auth_headers_user,
            json={"path": "/document.txt", "new_name": "renamed.txt"},
        )
        assert response.status_code == 500


# ──────────────────────────────────────────────────────────────────────────────
# Create file or directory
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.integration
class TestCreateItem:
    """Test create item endpoint."""

    def test_create_directory_success(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test creating a directory returns 200 with FileInfo."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.create_directory.return_value = None
        mock_instance.get_file_info.return_value = FileInfo(
            name="new-folder",
            path="/new-folder",
            type=FileType.DIRECTORY,
        )

        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/", "name": "new-folder", "type": "directory"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "new-folder"
        assert data["type"] == "directory"
        mock_instance.connect.assert_called_once()
        mock_instance.create_directory.assert_called_once_with("new-folder")
        mock_instance.disconnect.assert_called_once()

    def test_create_file_success(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test creating a file returns 200 with FileInfo."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.create_file.return_value = None
        mock_instance.get_file_info.return_value = FileInfo(
            name="notes.txt",
            path="/notes.txt",
            type=FileType.FILE,
            size=0,
        )

        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/", "name": "notes.txt", "type": "file"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "notes.txt"
        assert data["type"] == "file"
        assert data["size"] == 0
        mock_instance.create_file.assert_called_once_with("notes.txt")

    def test_create_in_subdirectory(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test creating inside a subdirectory builds the correct path."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.create_directory.return_value = None
        mock_instance.get_file_info.return_value = FileInfo(
            name="sub",
            path="/docs/sub",
            type=FileType.DIRECTORY,
        )

        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/docs", "name": "sub", "type": "directory"},
        )

        assert response.status_code == 200
        mock_instance.create_directory.assert_called_once_with("docs/sub")

    def test_create_without_auth(self, client: TestClient, test_connection: Connection):
        """Test that create requires authentication."""
        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            json={"parent_path": "/", "name": "folder", "type": "directory"},
        )
        assert response.status_code == 401

    def test_create_nonexistent_connection(self, client: TestClient, auth_headers_user: dict):
        """Test create for a non-existent connection returns 404."""
        fake_id = uuid.uuid4()
        response = client.post(
            f"/api/browse/{fake_id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/", "name": "folder", "type": "directory"},
        )
        assert response.status_code == 404

    def test_create_empty_name_rejected(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that an empty name is rejected with 400."""
        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/", "name": "   ", "type": "directory"},
        )
        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()

    def test_create_invalid_chars_rejected(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that invalid characters in name are rejected with 400."""
        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/", "name": "bad:name", "type": "directory"},
        )
        assert response.status_code == 400
        assert "invalid characters" in response.json()["detail"].lower()

    def test_create_dot_name_rejected(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that '.' and '..' are rejected as names."""
        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/", "name": "..", "type": "file"},
        )
        assert response.status_code == 400

    def test_create_trailing_period_rejected(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that trailing period in name is rejected with 400."""
        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/", "name": "folder.", "type": "directory"},
        )
        assert response.status_code == 400
        assert "space or period" in response.json()["detail"].lower()

    def test_create_name_collision(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test creating an item that already exists returns 409."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.create_directory.side_effect = FileExistsError("An item named 'folder' already exists")

        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/", "name": "folder", "type": "directory"},
        )
        assert response.status_code == 409
        assert "already exists" in response.json()["detail"].lower()

    def test_create_parent_not_found(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test creating in a non-existent parent returns 404."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.create_file.side_effect = FileNotFoundError("Parent directory not found")

        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/nonexistent", "name": "file.txt", "type": "file"},
        )
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_create_server_error(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test generic SMB error returns 500."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.create_directory.side_effect = Exception("Connection lost")

        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/", "name": "folder", "type": "directory"},
        )
        assert response.status_code == 500

    def test_create_strips_whitespace_from_name(
        self,
        client: TestClient,
        auth_headers_user: dict,
        test_connection: Connection,
        mock_smb_backend,
    ):
        """Test that leading/trailing whitespace is stripped from the name."""
        mock_class, mock_instance = mock_smb_backend
        mock_instance.create_directory.return_value = None
        mock_instance.get_file_info.return_value = FileInfo(
            name="clean-name",
            path="/clean-name",
            type=FileType.DIRECTORY,
        )

        response = client.post(
            f"/api/browse/{test_connection.id}/create",
            headers=auth_headers_user,
            json={"parent_path": "/", "name": "  clean-name  ", "type": "directory"},
        )

        assert response.status_code == 200
        mock_instance.create_directory.assert_called_once_with("clean-name")


# ──────────────────────────────────────────────────────────────────────────────
# _validate_item_name unit tests
# ──────────────────────────────────────────────────────────────────────────────


class TestValidateItemName:
    """Unit tests for the _validate_item_name helper.

    These test the function directly without going through HTTP,
    verifying that it raises the correct HTTPException for each
    validation rule.
    """

    def test_valid_name_returned_stripped(self):
        """Valid names are returned after stripping whitespace."""
        from app.api.browser import _validate_item_name

        assert _validate_item_name("  hello.txt  ") == "hello.txt"

    def test_simple_valid_name(self):
        """Simple valid name is returned as-is."""
        from app.api.browser import _validate_item_name

        assert _validate_item_name("readme.md") == "readme.md"

    def test_empty_name_raises(self):
        """Empty or whitespace-only name raises 400."""
        from fastapi import HTTPException

        from app.api.browser import _validate_item_name

        with pytest.raises(HTTPException) as exc_info:
            _validate_item_name("   ")
        assert exc_info.value.status_code == 400
        assert "empty" in exc_info.value.detail.lower()

    def test_dot_name_raises(self):
        """'.' raises 400."""
        from fastapi import HTTPException

        from app.api.browser import _validate_item_name

        with pytest.raises(HTTPException) as exc_info:
            _validate_item_name(".")
        assert exc_info.value.status_code == 400

    def test_dotdot_name_raises(self):
        """'..' raises 400."""
        from fastapi import HTTPException

        from app.api.browser import _validate_item_name

        with pytest.raises(HTTPException) as exc_info:
            _validate_item_name("..")
        assert exc_info.value.status_code == 400

    @pytest.mark.parametrize("char", list('\\/:*?"<>|'))
    def test_invalid_char_raises(self, char):
        """Each NTFS-forbidden character triggers 400."""
        from fastapi import HTTPException

        from app.api.browser import _validate_item_name

        with pytest.raises(HTTPException) as exc_info:
            _validate_item_name(f"file{char}name")
        assert exc_info.value.status_code == 400
        assert "invalid characters" in exc_info.value.detail.lower()

    def test_trailing_space_stripped_by_strip(self):
        """Trailing spaces are removed by strip(), so they don't reach the trailing check.

        This means a raw value like "name " is actually valid:
        strip("name ") → "name", which passes all checks.
        """
        from app.api.browser import _validate_item_name

        # "name " gets stripped to "name" — which is valid
        assert _validate_item_name("name ") == "name"

    def test_trailing_period_raises(self):
        """Name ending with a period raises 400."""
        from fastapi import HTTPException

        from app.api.browser import _validate_item_name

        with pytest.raises(HTTPException) as exc_info:
            _validate_item_name("myfile.")
        assert exc_info.value.status_code == 400
        assert "space or period" in exc_info.value.detail.lower()

    def test_dotfile_valid(self):
        """Dotfiles like .gitignore are valid."""
        from app.api.browser import _validate_item_name

        assert _validate_item_name(".gitignore") == ".gitignore"

    def test_name_with_spaces_in_middle_valid(self):
        """Names with spaces in the middle are valid."""
        from app.api.browser import _validate_item_name

        assert _validate_item_name("my document.txt") == "my document.txt"


# ──────────────────────────────────────────────────────────────────────────────
# Upload file
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.integration
class TestUploadFile:
    """Tests for POST /api/browse/{connection_id}/upload"""

    #
    # test_upload_success
    #
    def test_upload_success(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
    ):
        """Upload writes file to SMB share and returns metadata."""

        mock_info = FileInfo(
            name="report.docx",
            path="/docs/report.docx",
            type=FileType.FILE,
            size=100,
            modified_at=datetime(2026, 2, 9, 14, 0, 0),
        )

        with patch("app.api.browser.SMBBackend") as MockBackend:
            instance = AsyncMock()
            instance.write_file = AsyncMock(return_value=100)
            instance.get_file_info = AsyncMock(return_value=mock_info)
            MockBackend.return_value = instance

            response = client.post(
                f"/api/browse/{test_connection.id}/upload",
                params={"path": "/docs/report.docx"},
                files={"file": ("report.docx", b"file content here", "application/octet-stream")},
                headers=auth_headers_admin,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["path"] == "/docs/report.docx"
        assert data["size"] == 100

    #
    # test_upload_file_locked
    #
    def test_upload_file_locked(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
    ):
        """Upload returns 409 when the target file is locked on the SMB share."""

        with patch("app.api.browser.SMBBackend") as MockBackend:
            instance = AsyncMock()
            instance.write_file = AsyncMock(side_effect=IOError("File is locked and cannot be written"))
            MockBackend.return_value = instance

            response = client.post(
                f"/api/browse/{test_connection.id}/upload",
                params={"path": "/docs/report.docx"},
                files={"file": ("report.docx", b"content", "application/octet-stream")},
                headers=auth_headers_admin,
            )

        assert response.status_code == 409

    #
    # test_upload_connection_not_found
    #
    def test_upload_connection_not_found(
        self,
        client: TestClient,
        auth_headers_admin: dict,
    ):
        """Upload returns 404 for nonexistent connection."""

        response = client.post(
            f"/api/browse/{uuid.uuid4()}/upload",
            params={"path": "/docs/report.docx"},
            files={"file": ("report.docx", b"content", "application/octet-stream")},
            headers=auth_headers_admin,
        )
        assert response.status_code == 404

    #
    # test_upload_requires_auth
    #
    def test_upload_requires_auth(
        self,
        client: TestClient,
        test_connection: Connection,
    ):
        """Upload endpoint requires authentication."""

        response = client.post(
            f"/api/browse/{test_connection.id}/upload",
            params={"path": "/docs/report.docx"},
            files={"file": ("report.docx", b"content", "application/octet-stream")},
        )
        assert response.status_code == 401

    #
    # test_upload_server_error
    #
    def test_upload_server_error(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
    ):
        """Upload returns 500 on unexpected SMB errors."""

        with patch("app.api.browser.SMBBackend") as MockBackend:
            instance = AsyncMock()
            instance.write_file = AsyncMock(side_effect=Exception("Connection lost"))
            MockBackend.return_value = instance

            response = client.post(
                f"/api/browse/{test_connection.id}/upload",
                params={"path": "/docs/report.docx"},
                files={"file": ("report.docx", b"content", "application/octet-stream")},
                headers=auth_headers_admin,
            )

        assert response.status_code == 500
