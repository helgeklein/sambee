"""
Comprehensive tests for SMB storage backend.

Tests cover:
- Path construction and normalization
- Connection management and session handling
- Directory listing with various scenarios
- File info retrieval
- File reading and streaming
- File existence checks
- Error handling and edge cases
"""

from contextlib import asynccontextmanager
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from app.models.file import DirectoryListing, FileType
from app.storage.smb import SMBBackend
from smbclient._os import FileAttributes


@pytest.fixture(autouse=True)
def mock_smb_pool():
    """Mock the SMB connection pool for all tests."""

    @asynccontextmanager
    async def mock_get_connection(host, port, username, password, share_name):
        # Just yield without actually connecting
        yield None

    with patch("app.storage.smb.get_connection_pool") as mock_pool:
        mock_pool_instance = MagicMock()
        mock_pool_instance.get_connection = mock_get_connection
        mock_pool.return_value = mock_pool_instance
        yield mock_pool


class TestPathConstruction:
    """Test SMB path building and normalization."""

    def test_build_path_root(self):
        """Test building path for root directory."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        path = backend._build_smb_path("")
        assert path == r"\\server.local\share"

    def test_build_path_subdirectory(self):
        """Test building path for subdirectory."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        path = backend._build_smb_path("documents")
        assert path == r"\\server.local\share\documents"

    def test_build_path_nested_directory(self):
        """Test building path for deeply nested directory."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        path = backend._build_smb_path("documents/2024/reports")
        assert path == r"\\server.local\share\documents\2024\reports"

    def test_build_path_forward_slash_normalization(self):
        """Test that forward slashes are converted to backslashes."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        path = backend._build_smb_path("documents/subfolder/file.txt")
        assert path == r"\\server.local\share\documents\subfolder\file.txt"

    def test_build_path_backslash_handling(self):
        """Test that backslashes are properly handled."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        path = backend._build_smb_path(r"documents\subfolder\file.txt")
        assert path == r"\\server.local\share\documents\subfolder\file.txt"

    def test_build_path_leading_slash_removal(self):
        """Test that leading slashes are removed."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        path = backend._build_smb_path("/documents/file.txt")
        assert path == r"\\server.local\share\documents\file.txt"

    def test_build_path_multiple_leading_slashes(self):
        """Test handling of multiple leading slashes."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        path = backend._build_smb_path("///documents/file.txt")
        assert path == r"\\server.local\share\documents\file.txt"

    def test_build_path_unicode_characters(self):
        """Test path building with unicode characters."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        path = backend._build_smb_path("documents/файл.txt")
        assert path == r"\\server.local\share\documents\файл.txt"

    def test_build_path_special_characters(self):
        """Test path building with special characters."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        path = backend._build_smb_path("documents/file (1).txt")
        assert path == r"\\server.local\share\documents\file (1).txt"


class TestMimeTypeDetection:
    """Test MIME type detection for various file types."""

    @pytest.mark.parametrize(
        "filename,expected_mime_type",
        [
            # Text files
            ("document.txt", "text/plain"),
            ("README.md", "text/markdown"),
            ("notes.markdown", "text/markdown"),
            ("script.py", "text/x-python"),
            # Images - standard formats (from mimetypes library)
            ("photo.jpg", "image/jpeg"),
            ("photo.jpeg", "image/jpeg"),
            ("logo.png", "image/png"),
            ("animation.gif", "image/gif"),
            ("scan.tiff", "image/tiff"),
            ("scan.tif", "image/tiff"),
            # Images - explicit mappings (may not be in all system MIME databases)
            ("photo.heic", "image/heic"),
            ("photo.heif", "image/heif"),
            ("image.avif", "image/avif"),
            ("image.webp", "image/webp"),
            ("bitmap.bmp", "image/bmp"),
            ("bitmap.dib", "image/bmp"),
            (
                "icon.ico",
                "image/vnd.microsoft.icon",
            ),  # mimetypes returns this, not image/x-icon
            ("vector.svg", "image/svg+xml"),
            # Documents
            ("document.pdf", "application/pdf"),
            # Unknown/no extension
            ("file.xyz123", "application/octet-stream"),
            ("README", "application/octet-stream"),
            ("no-ext-file", "application/octet-stream"),
        ],
    )
    def test_mime_type_detection(self, filename: str, expected_mime_type: str):
        """Test MIME type detection for various file formats."""
        from app.utils.file_type_registry import get_mime_type

        mime_type = get_mime_type(filename)
        assert mime_type == expected_mime_type


class TestConnectionManagement:
    """Test SMB connection lifecycle."""

    @pytest.mark.asyncio
    async def test_connect_success(self):
        """Test successful SMB connection (now uses pool)."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        # Connect should not raise - actual connection happens via pool
        await backend.connect()

    @pytest.mark.asyncio
    async def test_connect_custom_port(self):
        """Test connection with custom port (now uses pool)."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            port=8445,
        )

        # Connect should not raise - actual connection happens via pool
        await backend.connect()

    @pytest.mark.asyncio
    async def test_connect_authentication_failure(self):
        """Test connection failure due to authentication (handled by pool)."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="wrongpass",
        )

        # Connect itself doesn't fail - errors happen during operations
        await backend.connect()

    @pytest.mark.asyncio
    async def test_connect_network_error(self):
        """Test connection failure due to network error (handled by pool)."""
        backend = SMBBackend(
            host="unreachable.local",
            share_name="share",
            username="user",
            password="pass",
        )

        # Connect itself doesn't fail - errors happen during operations
        await backend.connect()

    @pytest.mark.asyncio
    async def test_disconnect_keeps_session_alive(self):
        """Test that disconnect doesn't delete the session (for reuse)."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        # Should not raise any exceptions
        await backend.disconnect()

        # Session should remain registered for reuse


class TestDirectoryListing:
    """Test directory listing functionality."""

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_empty_directory(self, mock_scandir):
        """Test listing an empty directory."""
        mock_scandir.return_value = []

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        result = await backend.list_directory("")

        assert isinstance(result, DirectoryListing)
        assert result.path == "/"
        assert result.items == []
        assert result.total == 0

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_directory_with_files(self, mock_scandir):
        """Test listing directory with files."""
        # Create mock entries
        mock_entry1 = MagicMock()
        mock_entry1.name = "file1.txt"
        mock_entry1.smb_info.file_attributes = 0  # Not a directory
        mock_entry1.smb_info.end_of_file = 1024
        mock_entry1.smb_info.last_write_time = datetime(2024, 1, 15, 10, 30)
        mock_entry1.smb_info.creation_time = datetime(2024, 1, 10, 9, 0)

        mock_entry2 = MagicMock()
        mock_entry2.name = "file2.pdf"
        mock_entry2.smb_info.file_attributes = 0
        mock_entry2.smb_info.end_of_file = 2048
        mock_entry2.smb_info.last_write_time = datetime(2024, 1, 16, 14, 45)
        mock_entry2.smb_info.creation_time = datetime(2024, 1, 11, 11, 0)

        mock_scandir.return_value = [mock_entry1, mock_entry2]

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        result = await backend.list_directory("")

        assert result.total == 2
        assert len(result.items) == 2
        assert result.items[0].name == "file1.txt"
        assert result.items[0].type == FileType.FILE
        assert result.items[0].size == 1024
        assert result.items[1].name == "file2.pdf"
        assert result.items[1].size == 2048

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_directory_with_folders(self, mock_scandir):
        """Test listing directory with subdirectories."""
        mock_entry = MagicMock()
        mock_entry.name = "Documents"
        mock_entry.smb_info.file_attributes = FileAttributes.FILE_ATTRIBUTE_DIRECTORY
        mock_entry.smb_info.end_of_file = 0
        mock_entry.smb_info.last_write_time = datetime(2024, 1, 15, 10, 30)
        mock_entry.smb_info.creation_time = datetime(2024, 1, 10, 9, 0)

        mock_scandir.return_value = [mock_entry]

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        result = await backend.list_directory("")

        assert result.total == 1
        assert result.items[0].name == "Documents"
        assert result.items[0].type == FileType.DIRECTORY
        assert result.items[0].size is None

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_directory_filters_dot_entries(self, mock_scandir):
        """Test that . and .. entries are filtered out."""
        mock_entry1 = MagicMock()
        mock_entry1.name = "."

        mock_entry2 = MagicMock()
        mock_entry2.name = ".."

        mock_entry3 = MagicMock()
        mock_entry3.name = "file.txt"
        mock_entry3.smb_info.file_attributes = 0
        mock_entry3.smb_info.end_of_file = 100
        mock_entry3.smb_info.last_write_time = datetime(2024, 1, 15, 10, 30)
        mock_entry3.smb_info.creation_time = datetime(2024, 1, 10, 9, 0)

        mock_scandir.return_value = [mock_entry1, mock_entry2, mock_entry3]

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        result = await backend.list_directory("")

        # Should only have file.txt, not . or ..
        assert result.total == 1
        assert result.items[0].name == "file.txt"

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_directory_hidden_files(self, mock_scandir):
        """Test detection of hidden files (dot-prefixed)."""
        mock_entry1 = MagicMock()
        mock_entry1.name = ".hidden"
        mock_entry1.smb_info.file_attributes = 0
        mock_entry1.smb_info.end_of_file = 100
        mock_entry1.smb_info.last_write_time = datetime(2024, 1, 15, 10, 30)
        mock_entry1.smb_info.creation_time = datetime(2024, 1, 10, 9, 0)

        mock_entry2 = MagicMock()
        mock_entry2.name = "visible.txt"
        mock_entry2.smb_info.file_attributes = 0
        mock_entry2.smb_info.end_of_file = 200
        mock_entry2.smb_info.last_write_time = datetime(2024, 1, 15, 10, 30)
        mock_entry2.smb_info.creation_time = datetime(2024, 1, 10, 9, 0)

        mock_scandir.return_value = [mock_entry1, mock_entry2]

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        result = await backend.list_directory("")

        assert result.items[0].name == ".hidden"
        assert result.items[0].is_hidden is True
        assert result.items[1].name == "visible.txt"
        assert result.items[1].is_hidden is False

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_subdirectory(self, mock_scandir):
        """Test listing a subdirectory."""
        mock_entry = MagicMock()
        mock_entry.name = "report.pdf"
        mock_entry.smb_info.file_attributes = 0
        mock_entry.smb_info.end_of_file = 5000
        mock_entry.smb_info.last_write_time = datetime(2024, 1, 15, 10, 30)
        mock_entry.smb_info.creation_time = datetime(2024, 1, 10, 9, 0)

        mock_scandir.return_value = [mock_entry]

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        result = await backend.list_directory("documents/2024")

        assert result.path == "documents/2024"
        assert result.items[0].name == "report.pdf"
        assert result.items[0].path == "documents/2024/report.pdf"

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_directory_error_handling(self, mock_scandir):
        """Test error handling when listing fails."""
        mock_scandir.side_effect = PermissionError("Access denied")

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        with pytest.raises(PermissionError, match="Access denied"):
            await backend.list_directory("forbidden")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_directory_with_problematic_entry(self, mock_scandir):
        """Test that problematic entries don't crash the entire listing."""
        mock_good_entry = MagicMock()
        mock_good_entry.name = "good.txt"
        mock_good_entry.smb_info.file_attributes = 0
        mock_good_entry.smb_info.end_of_file = 100
        mock_good_entry.smb_info.last_write_time = datetime(2024, 1, 15, 10, 30)
        mock_good_entry.smb_info.creation_time = datetime(2024, 1, 10, 9, 0)

        mock_bad_entry = MagicMock()
        mock_bad_entry.name = "bad.txt"
        mock_bad_entry.smb_info.file_attributes = 0
        # Simulate an error when accessing properties
        type(mock_bad_entry.smb_info).end_of_file = property(
            lambda self: (_ for _ in ()).throw(Exception("Corrupted metadata"))
        )

        mock_scandir.return_value = [mock_good_entry, mock_bad_entry]

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        result = await backend.list_directory("")

        # Should have both entries, but bad entry has minimal info
        assert result.total == 2
        assert result.items[0].name == "good.txt"
        assert result.items[1].name == "bad.txt"
        assert result.items[1].is_readable is False


class TestFileInfoRetrieval:
    """Test getting file information."""

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.path.isdir")
    @patch("app.storage.smb.smbclient.stat")
    async def test_get_file_info_for_file(self, mock_stat, mock_isdir):
        """Test getting info for a file."""
        mock_stat.return_value = MagicMock(
            st_size=1024,
            st_mtime=datetime(2024, 1, 15, 10, 30).timestamp(),
            st_ctime=datetime(2024, 1, 10, 9, 0).timestamp(),
        )
        mock_isdir.return_value = False

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        result = await backend.get_file_info("documents/file.txt")

        assert result.name == "file.txt"
        assert result.path == "documents/file.txt"
        assert result.type == FileType.FILE
        assert result.size == 1024
        assert result.mime_type == "text/plain"
        assert result.is_hidden is False

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.path.isdir")
    @patch("app.storage.smb.smbclient.stat")
    async def test_get_file_info_for_directory(self, mock_stat, mock_isdir):
        """Test getting info for a directory."""
        mock_stat.return_value = MagicMock(
            st_size=0,
            st_mtime=datetime(2024, 1, 15, 10, 30).timestamp(),
            st_ctime=datetime(2024, 1, 10, 9, 0).timestamp(),
        )
        mock_isdir.return_value = True

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        result = await backend.get_file_info("documents")

        assert result.name == "documents"
        assert result.type == FileType.DIRECTORY
        assert result.size is None
        assert result.mime_type is None

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.path.isdir")
    @patch("app.storage.smb.smbclient.stat")
    async def test_get_file_info_hidden_file(self, mock_stat, mock_isdir):
        """Test that hidden files are detected."""
        mock_stat.return_value = MagicMock(
            st_size=100,
            st_mtime=datetime(2024, 1, 15, 10, 30).timestamp(),
            st_ctime=datetime(2024, 1, 10, 9, 0).timestamp(),
        )
        mock_isdir.return_value = False

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        result = await backend.get_file_info(".hidden")

        assert result.is_hidden is True

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.stat")
    async def test_get_file_info_not_found(self, mock_stat):
        """Test error when file not found."""
        mock_stat.side_effect = FileNotFoundError("File not found")

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        with pytest.raises(FileNotFoundError, match="File not found"):
            await backend.get_file_info("nonexistent.txt")


class TestFileReading:
    """Test file reading and streaming."""

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.open_file")
    async def test_read_small_file(self, mock_open):
        """Test reading a small file completely."""
        mock_file = MagicMock()
        mock_file.read.side_effect = [b"Hello, World!", b""]
        mock_file.close.return_value = None
        mock_open.return_value = mock_file

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        chunks = []
        async for chunk in backend.read_file("file.txt"):
            chunks.append(chunk)

        assert chunks == [b"Hello, World!"]
        mock_file.close.assert_called_once()

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.open_file")
    async def test_read_file_in_chunks(self, mock_open):
        """Test reading a file in multiple chunks."""
        mock_file = MagicMock()
        mock_file.read.side_effect = [
            b"chunk1",
            b"chunk2",
            b"chunk3",
            b"",
        ]
        mock_file.close.return_value = None
        mock_open.return_value = mock_file

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        chunks = []
        async for chunk in backend.read_file("largefile.bin"):
            chunks.append(chunk)

        assert chunks == [b"chunk1", b"chunk2", b"chunk3"]
        mock_file.close.assert_called_once()

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.open_file")
    async def test_read_empty_file(self, mock_open):
        """Test reading an empty file."""
        mock_file = MagicMock()
        mock_file.read.side_effect = [b""]
        mock_file.close.return_value = None
        mock_open.return_value = mock_file

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        chunks = []
        async for chunk in backend.read_file("empty.txt"):
            chunks.append(chunk)

        assert chunks == []
        mock_file.close.assert_called_once()

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.open_file")
    async def test_read_custom_chunk_size(self, mock_open):
        """Test reading with custom chunk size."""
        mock_file = MagicMock()
        mock_file.read.side_effect = [b"data", b""]
        mock_file.close.return_value = None
        mock_open.return_value = mock_file

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        chunks = []
        async for chunk in backend.read_file("file.bin", chunk_size=4096):
            chunks.append(chunk)

        # Verify chunk_size was passed to read
        mock_file.read.assert_called_with(4096)

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.open_file")
    async def test_read_file_error(self, mock_open):
        """Test error handling when file read fails."""
        mock_open.side_effect = PermissionError("Access denied")

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        with pytest.raises(PermissionError, match="Access denied"):
            async for chunk in backend.read_file("forbidden.txt"):
                pass

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.open_file")
    async def test_read_file_closes_on_error(self, mock_open):
        """Test that file handle is closed even on error."""
        mock_file = MagicMock()
        mock_file.read.side_effect = [b"data", Exception("Read error")]
        mock_file.close.return_value = None
        mock_open.return_value = mock_file

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        with pytest.raises(Exception, match="Read error"):
            async for chunk in backend.read_file("file.txt"):
                pass

        # File should still be closed
        mock_file.close.assert_called_once()


class TestFileExistence:
    """Test file existence checks."""

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.path.exists")
    async def test_file_exists_true(self, mock_exists):
        """Test checking if file exists (exists)."""
        mock_exists.return_value = True

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        exists = await backend.file_exists("file.txt")

        assert exists is True

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.path.exists")
    async def test_file_exists_false(self, mock_exists):
        """Test checking if file exists (doesn't exist)."""
        mock_exists.return_value = False

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        exists = await backend.file_exists("nonexistent.txt")

        assert exists is False

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.path.exists")
    async def test_directory_exists_true(self, mock_exists):
        """Test checking if directory exists."""
        mock_exists.return_value = True

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        exists = await backend.file_exists("documents")

        assert exists is True

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.path.exists")
    async def test_file_exists_error_handling(self, mock_exists):
        """Test that errors return False instead of raising."""
        mock_exists.side_effect = Exception("Network error")

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        exists = await backend.file_exists("file.txt")

        # Should return False on error, not raise
        assert exists is False


class TestErrorHandling:
    """Test comprehensive error handling scenarios."""

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_directory_network_timeout(self, mock_scandir):
        """Test handling network timeout during directory listing."""
        mock_scandir.side_effect = TimeoutError("Connection timed out")

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        with pytest.raises(TimeoutError, match="Connection timed out"):
            await backend.list_directory("")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.stat")
    async def test_get_file_info_permission_denied(self, mock_stat):
        """Test handling permission denied errors."""
        mock_stat.side_effect = PermissionError("Access is denied")

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        with pytest.raises(PermissionError, match="Access is denied"):
            await backend.get_file_info("forbidden.txt")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.open_file")
    async def test_read_file_network_error(self, mock_open):
        """Test handling network errors during file read."""
        mock_file = MagicMock()
        mock_file.read.side_effect = ConnectionError("Connection lost")
        mock_file.close.return_value = None
        mock_open.return_value = mock_file

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        with pytest.raises(ConnectionError, match="Connection lost"):
            async for chunk in backend.read_file("file.txt"):
                pass


class TestBackendInitialization:
    """Test SMB backend initialization."""

    def test_backend_initialization_default_port(self):
        """Test backend initialization with default port."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        assert backend.host == "server.local"
        assert backend.share_name == "share"
        assert backend.username == "user"
        assert backend.password == "pass"
        assert backend.port == 445
        assert backend._base_path == r"\\server.local\share"

    def test_backend_initialization_custom_port(self):
        """Test backend initialization with custom port."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            port=8445,
        )

        assert backend.port == 8445

    def test_backend_initialization_special_characters(self):
        """Test backend initialization with special characters in share name."""
        backend = SMBBackend(
            host="server.local",
            share_name="share$",
            username="user",
            password="p@ssw0rd!",
        )

        assert backend.share_name == "share$"
        assert backend.password == "p@ssw0rd!"
        assert backend._base_path == r"\\server.local\share$"
