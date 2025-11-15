"""
Tests for the preview API endpoints.

This module tests file preview and download functionality including:
- File preview with various MIME types
- File download with proper headers
- Authentication and authorization
- Error handling for various edge cases
- Connection validation
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from app.models.file import FileInfo, FileType


class AsyncIteratorMock:
    """Helper class to mock async iterators for file streaming."""

    def __init__(self, items):
        self.items = items
        self.index = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.index >= len(self.items):
            raise StopAsyncIteration
        item = self.items[self.index]
        self.index += 1
        return item


@pytest.fixture
def mock_text_file():
    """Create a mock text file info."""
    return FileInfo(
        name="document.txt",
        path="/document.txt",
        type=FileType.FILE,
        size=1024,
        modified_at=datetime(2024, 1, 1, 12, 0, 0),
        mime_type="text/plain",
    )


@pytest.fixture
def mock_markdown_file():
    """Create a mock markdown file info."""
    return FileInfo(
        name="README.md",
        path="/README.md",
        type=FileType.FILE,
        size=512,
        modified_at=datetime(2024, 1, 1, 12, 0, 0),
        mime_type="text/markdown",
    )


@pytest.fixture
def mock_binary_file():
    """Create a mock binary file info (image)."""
    return FileInfo(
        name="image.png",
        path="/images/image.png",
        type=FileType.FILE,
        size=51200,  # 50KB
        modified_at=datetime(2024, 1, 1, 12, 0, 0),
        mime_type="image/png",
    )


@pytest.fixture
def mock_directory():
    """Create a mock directory info."""
    return FileInfo(
        name="folder",
        path="/folder",
        type=FileType.DIRECTORY,
        size=None,
        modified_at=datetime(2024, 1, 1, 12, 0, 0),
        mime_type=None,
    )


@pytest.fixture
def mock_smb_preview_backend(mock_text_file):
    """Create a mock SMB backend for preview tests."""
    with patch("app.api.preview.SMBBackend") as mock:
        backend_instance = AsyncMock()

        # Mock file info retrieval
        backend_instance.get_file_info.return_value = mock_text_file

        # Mock file reading - use a plain function (not AsyncMock)
        # because AsyncMock wraps the result in a coroutine
        content = b"Hello, this is test file content!\n" * 30
        chunks = [content[i : i + 8192] for i in range(0, len(content), 8192)]

        def mock_read_file(path, **kwargs):
            return AsyncIteratorMock(chunks)

        backend_instance.read_file = mock_read_file

        backend_instance.connect.return_value = None
        backend_instance.disconnect.return_value = None

        mock.return_value = backend_instance
        yield mock, backend_instance


class TestPreviewFile:
    """Test cases for the file preview endpoint."""

    def test_preview_text_file_success(
        self, client, auth_headers_user, test_connection, mock_smb_preview_backend
    ):
        """Test successful text file preview."""
        mock, mock_instance = mock_smb_preview_backend

        response = client.get(
            f"/api/preview/{test_connection.id}/file",
            headers=auth_headers_user,
            params={"path": "/document.txt"},
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "text/plain; charset=utf-8"

        # Verify content
        content = response.content
        assert b"Hello, this is test file content!" in content

        # Verify SMB backend was called correctly
        mock_instance.connect.assert_called_once()
        mock_instance.get_file_info.assert_called_once_with("/document.txt")
        # Note: read_file is a lambda function, so we can't assert on it

    def test_preview_markdown_file(
        self, client, auth_headers_user, test_connection, mock_markdown_file
    ):
        """Test previewing a markdown file with correct MIME type."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = mock_markdown_file
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [b"# Markdown Content\n\nThis is **bold** text."]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/file",
                headers=auth_headers_user,
                params={"path": "/README.md"},
            )

            assert response.status_code == 200
            assert response.headers["content-type"] == "text/markdown; charset=utf-8"
            assert b"# Markdown Content" in response.content

    def test_preview_binary_file(
        self, client, auth_headers_user, test_connection, mock_binary_file
    ):
        """Test previewing a binary file (image)."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = mock_binary_file
            # Simulate PNG header
            png_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [png_data]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/file",
                headers=auth_headers_user,
                params={"path": "/images/image.png"},
            )

            assert response.status_code == 200
            assert response.headers["content-type"] == "image/png"
            assert response.content.startswith(b"\x89PNG")

    def test_preview_file_without_auth(self, client, test_connection):
        """Test that preview requires authentication."""
        response = client.get(
            f"/api/preview/{test_connection.id}/file",
            params={"path": "/document.txt"},
        )

        assert response.status_code == 401

    def test_preview_nonexistent_connection(self, client, auth_headers_user):
        """Test preview with non-existent connection ID."""
        import uuid

        fake_id = uuid.uuid4()

        response = client.get(
            f"/api/preview/{fake_id}/file",
            headers=auth_headers_user,
            params={"path": "/document.txt"},
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_preview_connection_without_share(self, client, auth_headers_user, session):
        """Test preview when connection doesn't have a share name."""
        from app.models.connection import Connection

        # Create connection without share - use correct Connection model fields
        connection = Connection(
            name="No Share Connection",
            host="192.168.1.100",
            share_name=None,  # No share
            username="testuser",
            password_encrypted="encrypted_password",
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        response = client.get(
            f"/api/preview/{connection.id}/file",
            headers=auth_headers_user,
            params={"path": "/document.txt"},
        )

        assert response.status_code == 400
        assert "share" in response.json()["detail"].lower()

    def test_preview_directory_instead_of_file(
        self, client, auth_headers_user, test_connection, mock_directory
    ):
        """Test attempting to preview a directory."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = mock_directory
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock([b""])
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/file",
                headers=auth_headers_user,
                params={"path": "/folder"},
            )

            # Returns 400 Bad Request when path is a directory, not a file
            assert response.status_code == 400

    def test_preview_file_no_mime_type(
        self, client, auth_headers_user, test_connection
    ):
        """Test previewing a file with no MIME type detected."""
        unknown_file = FileInfo(
            name="unknown.xyz",
            path="/unknown.xyz",
            type=FileType.FILE,
            size=100,
            modified_at=datetime(2024, 1, 1, 12, 0, 0),
            mime_type=None,
        )

        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = unknown_file
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [b"unknown content"]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/file",
                headers=auth_headers_user,
                params={"path": "/unknown.xyz"},
            )

            assert response.status_code == 200
            # Should default to octet-stream
            assert "application/octet-stream" in response.headers["content-type"]

    def test_preview_file_with_special_chars_in_name(
        self, client, auth_headers_user, test_connection
    ):
        """Test previewing a file with special characters in the filename."""
        special_file = FileInfo(
            name="document (copy) #1.txt",
            path="/folder/document (copy) #1.txt",
            type=FileType.FILE,
            size=100,
            modified_at=datetime(2024, 1, 1, 12, 0, 0),
            mime_type="text/plain",
        )

        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = special_file
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [b"content"]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/file",
                headers=auth_headers_user,
                params={"path": "/folder/document (copy) #1.txt"},
            )

            assert response.status_code == 200
            assert response.headers["content-type"] == "text/plain; charset=utf-8"

    def test_preview_smb_connection_failure(
        self, client, auth_headers_user, test_connection
    ):
        """Test handling of SMB connection failures."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.connect.side_effect = Exception("Connection failed")
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/file",
                headers=auth_headers_user,
                params={"path": "/document.txt"},
            )

            assert response.status_code == 500
            assert "connection failed" in response.json()["detail"].lower()

    def test_preview_file_not_found_on_smb(
        self, client, auth_headers_user, test_connection
    ):
        """Test handling when file doesn't exist on SMB share."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.connect.return_value = None
            backend_instance.get_file_info.side_effect = FileNotFoundError(
                "File not found"
            )
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/file",
                headers=auth_headers_user,
                params={"path": "/nonexistent.txt"},
            )

            assert response.status_code == 404


class TestDownloadFile:
    """Test cases for the file download endpoint."""

    def test_download_file_success(
        self, client, auth_headers_user, test_connection, mock_text_file
    ):
        """Test successful file download."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = mock_text_file
            content = b"Download content"
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [content]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/download",
                headers=auth_headers_user,
                params={"path": "/document.txt"},
            )

            assert response.status_code == 200
            assert (
                response.headers["content-disposition"]
                == 'attachment; filename="document.txt"'
            )
            assert response.headers["content-type"] == "application/octet-stream"
            assert response.content == content

    def test_download_binary_file(
        self, client, auth_headers_user, test_connection, mock_binary_file
    ):
        """Test downloading a binary file."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = mock_binary_file
            png_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [png_data]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/download",
                headers=auth_headers_user,
                params={"path": "/images/image.png"},
            )

            assert response.status_code == 200
            assert (
                response.headers["content-disposition"]
                == 'attachment; filename="image.png"'
            )
            assert response.content == png_data

    def test_download_large_file_chunks(
        self, client, auth_headers_user, test_connection
    ):
        """Test downloading a large file that comes in multiple chunks."""
        large_file = FileInfo(
            name="large.bin",
            path="/large.bin",
            type=FileType.FILE,
            size=1024 * 1024,  # 1MB
            modified_at=datetime(2024, 1, 1, 12, 0, 0),
            mime_type="application/octet-stream",
        )

        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = large_file
            # Simulate large file in chunks
            chunk_size = 8192
            chunks = [b"X" * chunk_size for _ in range(10)]
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                chunks
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/download",
                headers=auth_headers_user,
                params={"path": "/large.bin"},
            )

            assert response.status_code == 200
            assert len(response.content) == chunk_size * 10

    def test_download_without_auth(self, client, test_connection):
        """Test that download requires authentication."""
        response = client.get(
            f"/api/preview/{test_connection.id}/download",
            params={"path": "/document.txt"},
        )

        assert response.status_code == 401

    def test_download_directory_instead_of_file(
        self, client, auth_headers_user, test_connection, mock_directory
    ):
        """Test attempting to download a directory."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = mock_directory
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/download",
                headers=auth_headers_user,
                params={"path": "/folder"},
            )

            # Returns 400 Bad Request when path is a directory, not a file
            assert response.status_code == 400

    def test_download_nonexistent_connection(self, client, auth_headers_user):
        """Test download with non-existent connection ID."""
        import uuid

        fake_id = uuid.uuid4()

        response = client.get(
            f"/api/preview/{fake_id}/download",
            headers=auth_headers_user,
            params={"path": "/document.txt"},
        )

        assert response.status_code == 404

    def test_download_file_without_size(
        self, client, auth_headers_user, test_connection
    ):
        """Test downloading a file without size information."""
        file_no_size = FileInfo(
            name="nosize.txt",
            path="/nosize.txt",
            type=FileType.FILE,
            size=None,
            modified_at=datetime(2024, 1, 1, 12, 0, 0),
            mime_type="text/plain",
        )

        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = file_no_size
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [b"content"]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/download",
                headers=auth_headers_user,
                params={"path": "/nosize.txt"},
            )

            assert response.status_code == 200
            # Content-Length header should not be set
            assert "content-length" not in response.headers


class TestPreviewAuthentication:
    """Test authentication and authorization for preview endpoints."""

    def test_preview_with_valid_token(
        self, client, auth_headers_user, test_connection, mock_text_file
    ):
        """Test preview with a valid user token."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = mock_text_file
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [b"content"]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/file",
                headers=auth_headers_user,
                params={"path": "/document.txt"},
            )

            assert response.status_code == 200

    def test_preview_with_invalid_token(self, client, test_connection):
        """Test preview with an invalid token."""
        response = client.get(
            f"/api/preview/{test_connection.id}/file",
            headers={"Authorization": "Bearer invalid_token"},
            params={"path": "/document.txt"},
        )

        assert response.status_code == 401

    def test_preview_with_admin_token(
        self, client, auth_headers_admin, test_connection, mock_text_file
    ):
        """Test that admin users can preview files."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = mock_text_file
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [b"content"]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/file",
                headers=auth_headers_admin,
                params={"path": "/document.txt"},
            )

            assert response.status_code == 200

    def test_download_with_valid_token(
        self, client, auth_headers_user, test_connection, mock_text_file
    ):
        """Test download with a valid user token."""
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = mock_text_file
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [b"content"]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/download",
                headers=auth_headers_user,
                params={"path": "/document.txt"},
            )

            assert response.status_code == 200


class TestValidateConnection:
    """Test the validate_connection helper function."""

    def test_validate_connection_with_share_name(
        self, client, auth_headers_user, test_connection
    ):
        """Test that connections with share names are valid."""
        # This is implicitly tested by other tests, but we verify behavior
        with patch("app.api.preview.SMBBackend") as mock:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = FileInfo(
                name="test.txt",
                path="/test.txt",
                type=FileType.FILE,
                size=100,
                modified_at=datetime(2024, 1, 1, 12, 0, 0),
                mime_type="text/plain",
            )
            backend_instance.read_file = lambda path, **kwargs: AsyncIteratorMock(
                [b"content"]
            )
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock.return_value = backend_instance

            response = client.get(
                f"/api/preview/{test_connection.id}/file",
                headers=auth_headers_user,
                params={"path": "/test.txt"},
            )

            assert response.status_code == 200

    def test_validate_connection_without_share_name(
        self, client, auth_headers_user, session
    ):
        """Test that connections without share names return 400."""
        from app.models.connection import Connection

        connection = Connection(
            name="No Share",
            host="server.local",
            share_name=None,
            username="user",
            password_encrypted="pass",
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        response = client.get(
            f"/api/preview/{connection.id}/file",
            headers=auth_headers_user,
            params={"path": "/test.txt"},
        )

        assert response.status_code == 400
        assert "share" in response.json()["detail"].lower()
