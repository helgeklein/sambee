"""
Tests for file browsing functionality.
Uses mocked SMB backend to avoid dependency on real SMB server.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from app.models.connection import Connection
from app.models.file import DirectoryListing, FileInfo, FileType
from fastapi.testclient import TestClient


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

    def test_list_directory_without_auth(
        self, client: TestClient, test_connection: Connection
    ):
        """Test that listing directory requires authentication."""
        response = client.get(
            f"/api/browse/{test_connection.id}/list",
            params={"path": ""},
        )
        assert response.status_code == 401

    def test_list_nonexistent_connection(
        self, client: TestClient, auth_headers_user: dict
    ):
        """Test listing directory for non-existent connection."""
        import uuid

        fake_id = uuid.uuid4()
        response = client.get(
            f"/api/browse/{fake_id}/list",
            headers=auth_headers_user,
            params={"path": ""},
        )
        assert response.status_code == 404

    def test_list_connection_without_share(
        self, client: TestClient, auth_headers_user: dict, session
    ):
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

    def test_get_file_info_without_auth(
        self, client: TestClient, test_connection: Connection
    ):
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
