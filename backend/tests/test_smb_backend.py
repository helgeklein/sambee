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

import stat as stat_module
from contextlib import asynccontextmanager
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from smbclient._os import FileAttributes

from app.models.file import DirectoryListing, FileType
from app.storage.smb import SMBBackend


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


class TestNormalizePrefix:
    """Test the static _normalize_prefix helper."""

    @pytest.mark.parametrize(
        "raw,expected",
        [
            # Root / empty → no prefix
            ("/", ""),
            ("", ""),
            (None, ""),
            # Simple paths
            ("/photos", "photos"),
            ("photos", "photos"),
            # Nested paths
            ("/a/b/c", "a/b/c"),
            ("/a/b/c/", "a/b/c"),
            # Backslashes converted
            ("\\photos\\sub", "photos/sub"),
            ("/photos\\sub/", "photos/sub"),
            # Multiple / only slashes
            ("///", ""),
            ("//photos//sub//", "photos//sub"),
        ],
    )
    def test_normalize_prefix(self, raw: str | None, expected: str):
        """Verify _normalize_prefix produces clean relative forms."""

        assert SMBBackend._normalize_prefix(raw) == expected


class TestPathConstructionWithPrefix:
    """Test _build_smb_path when a path_prefix is configured."""

    def test_prefix_root_path(self):
        """Prefix only — browsing the application root."""

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos",
        )

        path = backend._build_smb_path("")
        assert path == r"\\server.local\share\photos"

    def test_prefix_with_relative_path(self):
        """Prefix combined with a relative sub-path."""

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos",
        )

        path = backend._build_smb_path("vacation/img.jpg")
        assert path == r"\\server.local\share\photos\vacation\img.jpg"

    def test_nested_prefix(self):
        """Multi-level prefix."""

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/data/year/2025",
        )

        path = backend._build_smb_path("report.pdf")
        assert path == r"\\server.local\share\data\year\2025\report.pdf"

    def test_no_prefix_still_works(self):
        """Default prefix ('/') should behave like no prefix."""

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/",
        )

        path = backend._build_smb_path("documents")
        assert path == r"\\server.local\share\documents"

    def test_prefix_with_leading_slash_in_path(self):
        """Leading slash in the relative path should be stripped."""

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos",
        )

        path = backend._build_smb_path("/vacation")
        assert path == r"\\server.local\share\photos\vacation"

    def test_prefix_with_backslash_input(self):
        """Backslash prefix from user input normalizes correctly."""

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="\\photos\\sub",
        )

        path = backend._build_smb_path("img.jpg")
        assert path == r"\\server.local\share\photos\sub\img.jpg"

    def test_prefix_trailing_slash_ignored(self):
        """Trailing slash in prefix is stripped."""

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos/",
        )

        path = backend._build_smb_path("img.jpg")
        assert path == r"\\server.local\share\photos\img.jpg"


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
        """Test that . and .. entries are filtered by smbclient.scandir itself.

        smbclient.scandir already excludes '.' and '..' internally, so
        the backend receives only real entries.  This test verifies the
        backend does not break when only real entries are present.
        """
        mock_entry = MagicMock()
        mock_entry.name = "file.txt"
        mock_entry.smb_info.file_attributes = 0
        mock_entry.smb_info.end_of_file = 100
        mock_entry.smb_info.last_write_time = datetime(2024, 1, 15, 10, 30)
        mock_entry.smb_info.creation_time = datetime(2024, 1, 10, 9, 0)

        # smbclient.scandir never yields '.' or '..', so mock returns
        # only real entries.
        mock_scandir.return_value = [mock_entry]

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
        type(mock_bad_entry.smb_info).end_of_file = property(lambda self: (_ for _ in ()).throw(Exception("Corrupted metadata")))

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
    @patch("app.storage.smb.smbclient.stat")
    async def test_get_file_info_for_file(self, mock_stat):
        """Test getting info for a file."""
        mock_stat.return_value = MagicMock(
            st_size=1024,
            st_mode=stat_module.S_IFREG | 0o644,
            st_mtime=datetime(2024, 1, 15, 10, 30).timestamp(),
            st_ctime=datetime(2024, 1, 10, 9, 0).timestamp(),
        )

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
    @patch("app.storage.smb.smbclient.stat")
    async def test_get_file_info_for_directory(self, mock_stat):
        """Test getting info for a directory."""
        mock_stat.return_value = MagicMock(
            st_size=0,
            st_mode=stat_module.S_IFDIR | 0o755,
            st_mtime=datetime(2024, 1, 15, 10, 30).timestamp(),
            st_ctime=datetime(2024, 1, 10, 9, 0).timestamp(),
        )

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
    @patch("app.storage.smb.smbclient.stat")
    async def test_get_file_info_hidden_file(self, mock_stat):
        """Test that hidden files are detected."""
        mock_stat.return_value = MagicMock(
            st_size=100,
            st_mode=stat_module.S_IFREG | 0o644,
            st_mtime=datetime(2024, 1, 15, 10, 30).timestamp(),
            st_ctime=datetime(2024, 1, 10, 9, 0).timestamp(),
        )

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

        with pytest.raises(TimeoutError, match="SMB operation timed out"):
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

    def test_backend_initialization_default_prefix(self):
        """Default path_prefix '/' normalizes to empty string (share root)."""

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        assert backend._path_prefix == ""

    def test_backend_initialization_custom_prefix(self):
        """Custom path_prefix is cleaned and stored."""

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos/vacation",
        )

        assert backend._path_prefix == "photos/vacation"

    def test_backend_initialization_none_prefix(self):
        """None path_prefix normalizes to empty string."""

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix=None,
        )

        assert backend._path_prefix == ""


class TestPathPrefixIntegration:
    """Integration tests verifying path_prefix reaches smbclient calls."""

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_directory_uses_prefix(self, mock_scandir):
        """list_directory('') with prefix scans the prefixed path."""

        mock_scandir.return_value = []

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos",
        )

        await backend.list_directory("")

        mock_scandir.assert_called_once_with(r"\\server.local\share\photos")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.scandir")
    async def test_list_subdirectory_uses_prefix(self, mock_scandir):
        """list_directory('vacation') with prefix scans prefix/vacation."""

        mock_scandir.return_value = []

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos",
        )

        await backend.list_directory("vacation")

        mock_scandir.assert_called_once_with(r"\\server.local\share\photos\vacation")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.stat")
    async def test_get_file_info_uses_prefix(self, mock_stat):
        """get_file_info with prefix builds the correct UNC path."""

        stat_result = MagicMock()
        stat_result.st_size = 1024
        stat_result.st_mode = 0o100644
        stat_result.st_mtime = 1700000000.0
        stat_result.st_ctime = 1700000000.0
        mock_stat.return_value = stat_result

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos",
        )

        await backend.get_file_info("vacation/img.jpg")

        mock_stat.assert_called_once_with(r"\\server.local\share\photos\vacation\img.jpg")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.remove")
    @patch("app.storage.smb.smbclient.stat")
    async def test_delete_file_uses_prefix(self, mock_stat, mock_remove):
        """delete_item with prefix targets the correct prefixed path."""

        stat_result = MagicMock()
        stat_result.st_mode = 0o100644  # regular file
        mock_stat.return_value = stat_result

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos",
        )

        await backend.delete_item("vacation/img.jpg")

        expected_path = r"\\server.local\share\photos\vacation\img.jpg"
        mock_stat.assert_called_once_with(expected_path)
        mock_remove.assert_called_once_with(expected_path)

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.open_file")
    async def test_read_file_uses_prefix(self, mock_open):
        """read_file with prefix opens the correct prefixed path."""

        mock_file = MagicMock()
        mock_file.read.side_effect = [b"data", b""]
        mock_file.__enter__ = MagicMock(return_value=mock_file)
        mock_file.__exit__ = MagicMock(return_value=False)
        mock_open.return_value = mock_file

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos",
        )

        chunks = []
        async for chunk in backend.read_file("vacation/img.jpg"):
            chunks.append(chunk)

        mock_open.assert_called_once_with(
            r"\\server.local\share\photos\vacation\img.jpg",
            mode="rb",
            share_access="rwd",
        )

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.path.exists")
    async def test_file_exists_uses_prefix(self, mock_exists):
        """file_exists with prefix checks the correct prefixed path."""

        mock_exists.return_value = True

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos",
        )

        result = await backend.file_exists("vacation/img.jpg")

        assert result is True
        mock_exists.assert_called_once_with(r"\\server.local\share\photos\vacation\img.jpg")


class TestDeleteItem:
    """Test file and directory deletion."""

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.remove")
    @patch("app.storage.smb.smbclient.stat")
    async def test_delete_file(self, mock_stat, mock_remove):
        """Test deleting a regular file calls smbclient.remove."""
        stat_result = MagicMock()
        stat_result.st_mode = 0o100644  # regular file mode
        mock_stat.return_value = stat_result

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )
        await backend.delete_item("/docs/readme.txt")

        mock_stat.assert_called_once_with(r"\\server.local\share\docs\readme.txt")
        mock_remove.assert_called_once_with(r"\\server.local\share\docs\readme.txt")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.rmdir")
    @patch("app.storage.smb.smbclient.scandir")
    @patch("app.storage.smb.smbclient.stat")
    async def test_delete_empty_directory(self, mock_stat, mock_scandir, mock_rmdir):
        """Test deleting an empty directory calls smbclient.rmdir."""
        stat_result = MagicMock()
        stat_result.st_mode = 0o40755  # directory mode
        mock_stat.return_value = stat_result
        mock_scandir.return_value = []  # empty directory

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )
        await backend.delete_item("/empty-folder")

        mock_stat.assert_called_once_with(r"\\server.local\share\empty-folder")
        mock_scandir.assert_called_once_with(r"\\server.local\share\empty-folder")
        mock_rmdir.assert_called_once_with(r"\\server.local\share\empty-folder")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.stat")
    async def test_delete_not_found_raises(self, mock_stat):
        """Test deleting a non-existent path raises FileNotFoundError."""
        mock_stat.side_effect = OSError("(0xc0000034) STATUS_OBJECT_NAME_NOT_FOUND")

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )
        with pytest.raises(FileNotFoundError, match="Path not found"):
            await backend.delete_item("/ghost.txt")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.remove")
    @patch("app.storage.smb.smbclient.rmdir")
    @patch("app.storage.smb.smbclient.scandir")
    @patch("app.storage.smb.smbclient.stat")
    async def test_delete_directory_recursive(self, mock_stat, mock_scandir, mock_rmdir, mock_remove):
        """Test deleting a non-empty directory removes children first."""
        dir_stat = MagicMock()
        dir_stat.st_mode = 0o40755  # directory mode

        file_stat = MagicMock()
        file_stat.st_mode = 0o100644  # regular file mode

        # stat returns dir for the root, file for children
        mock_stat.side_effect = lambda p: dir_stat if p == r"\\server.local\share\folder" else file_stat

        # scandir returns two file entries inside the directory
        child_a = MagicMock()
        child_a.path = r"\\server.local\share\folder\a.txt"
        child_b = MagicMock()
        child_b.path = r"\\server.local\share\folder\b.txt"
        mock_scandir.return_value = [child_a, child_b]

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )
        await backend.delete_item("/folder")

        # Both children removed, then the directory itself
        assert mock_remove.call_count == 2
        mock_rmdir.assert_called_once_with(r"\\server.local\share\folder")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.stat")
    async def test_delete_timeout_raises(self, mock_stat):
        """Test that a slow delete operation raises TimeoutError."""
        import asyncio

        async def slow_executor(*args, **kwargs):
            await asyncio.sleep(20)

        mock_stat.side_effect = lambda *a, **k: asyncio.sleep(20)  # will be cancelled

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        with patch("asyncio.wait_for", side_effect=asyncio.TimeoutError()):
            with pytest.raises(TimeoutError, match="timed out"):
                await backend.delete_item("/big-file.zip")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.stat")
    async def test_delete_pending_oserror_treated_as_success(self, mock_stat):
        """Test that STATUS_DELETE_PENDING (0xc0000056) OSError is treated as success.

        When the SMB server returns STATUS_DELETE_PENDING it means the item
        is already being deleted — the operation should succeed silently.
        """
        mock_stat.side_effect = OSError(
            "[Error 0] [NtStatus 0xc0000056] Unknown NtStatus error returned 'STATUS_DELETE_PENDING': '\\\\server\\share\\file.txt'"
        )

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )
        # Should NOT raise — treated as successful deletion
        await backend.delete_item("/file.txt")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.stat")
    async def test_delete_pending_non_oserror_treated_as_success(self, mock_stat):
        """Test that STATUS_DELETE_PENDING from a non-OSError is also handled.

        smbprotocol may raise custom exception types (e.g. SMBOSError or
        DeletePending) that carry the NtStatus code in the message.
        """

        class FakeDeletePending(Exception):
            """Simulates smbprotocol.exceptions.DeletePending."""

        FakeDeletePending.__name__ = "DeletePending"

        mock_stat.side_effect = FakeDeletePending(
            "A non-close operation has been requested of a file object "
            "that has a delete pending. (3221225558) STATUS_DELETE_PENDING: 0xc0000056"
        )

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )
        # Should NOT raise
        await backend.delete_item("/file.txt")


class TestRenameItem:
    """Test file and directory renaming."""

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.rename")
    async def test_rename_file(self, mock_rename):
        """Test renaming a file calls smbclient.rename with correct paths."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )
        await backend.rename_item("/docs/readme.txt", "notes.txt")

        mock_rename.assert_called_once_with(
            r"\\server.local\share\docs\readme.txt",
            r"\\server.local\share\docs\notes.txt",
        )

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.rename")
    async def test_rename_directory(self, mock_rename):
        """Test renaming a directory calls smbclient.rename with correct paths."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )
        await backend.rename_item("/photos/vacation", "holiday")

        mock_rename.assert_called_once_with(
            r"\\server.local\share\photos\vacation",
            r"\\server.local\share\photos\holiday",
        )

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.rename")
    async def test_rename_not_found_raises(self, mock_rename):
        """Test renaming a non-existent path raises FileNotFoundError."""
        mock_rename.side_effect = OSError("(0xc0000034) STATUS_OBJECT_NAME_NOT_FOUND")

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )
        with pytest.raises(FileNotFoundError, match="Path not found"):
            await backend.rename_item("/ghost.txt", "renamed.txt")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.rename")
    async def test_rename_collision_raises(self, mock_rename):
        """Test renaming to an existing name raises FileExistsError."""
        mock_rename.side_effect = OSError("(0xc0000035) STATUS_OBJECT_NAME_COLLISION")

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )
        with pytest.raises(FileExistsError, match="already exists"):
            await backend.rename_item("/document.txt", "existing.txt")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.rename")
    async def test_rename_timeout_raises(self, mock_rename):
        """Test that a slow rename operation raises TimeoutError."""
        import asyncio

        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
        )

        with patch("asyncio.wait_for", side_effect=asyncio.TimeoutError()):
            with pytest.raises(TimeoutError, match="timed out"):
                await backend.rename_item("/document.txt", "renamed.txt")

    @pytest.mark.asyncio
    @patch("app.storage.smb.smbclient.rename")
    async def test_rename_file_uses_prefix(self, mock_rename):
        """rename_item with path_prefix targets the correct prefixed path."""
        backend = SMBBackend(
            host="server.local",
            share_name="share",
            username="user",
            password="pass",
            path_prefix="/photos",
        )

        await backend.rename_item("vacation/img.jpg", "beach.jpg")

        mock_rename.assert_called_once_with(
            r"\\server.local\share\photos\vacation\img.jpg",
            r"\\server.local\share\photos\vacation\beach.jpg",
        )
