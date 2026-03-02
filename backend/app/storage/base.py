from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import BinaryIO, Callable, Optional

from app.models.file import DirectoryListing, FileInfo

# Type alias for progress callbacks.
# Called with (bytes_transferred, total_bytes_or_none) after each chunk.
ProgressCallback = Callable[[int, Optional[int]], None]


class StorageBackend(ABC):
    """Abstract base class for storage backends"""

    #
    # connect
    #
    @abstractmethod
    async def connect(self) -> None:
        """Establish connection to the storage backend"""

        pass

    #
    # disconnect
    #
    @abstractmethod
    async def disconnect(self) -> None:
        """Close connection to the storage backend"""

        pass

    #
    # list_directory
    #
    @abstractmethod
    async def list_directory(self, path: str) -> DirectoryListing:
        """List contents of a directory"""

        pass

    #
    # get_file_info
    #
    @abstractmethod
    async def get_file_info(self, path: str) -> FileInfo:
        """Get information about a specific file or directory"""

        pass

    #
    # read_file
    #
    @abstractmethod
    def read_file(self, path: str) -> AsyncIterator[bytes]:
        """Read file contents as chunks"""

        pass

    #
    # write_file
    #
    @abstractmethod
    async def write_file(self, path: str, data: BinaryIO) -> int:
        """Write a file to storage, overwriting if it exists.

        Args:
            path: Relative path within the share.
            data: File-like object to read content from.

        Returns:
            Number of bytes written.
        """

        pass

    #
    # file_exists
    #
    @abstractmethod
    async def file_exists(self, path: str) -> bool:
        """Check if a file or directory exists"""

        pass

    #
    # delete_item
    #
    @abstractmethod
    async def delete_item(self, path: str) -> None:
        """Delete a file or directory.

        Directories are deleted recursively — all contents are removed first.

        Args:
            path: Relative path to the file or directory.

        Raises:
            FileNotFoundError: If the path does not exist.
            OSError: If the operation fails.
        """

        pass

    #
    # rename_item
    #
    @abstractmethod
    async def rename_item(self, path: str, new_name: str) -> None:
        """Rename a file or directory in place (same parent directory).

        Args:
            path: Relative path to the file or directory.
            new_name: New name for the item (filename only, no path separators).

        Raises:
            FileNotFoundError: If the path does not exist.
            FileExistsError: If an item with the new name already exists.
            OSError: If the operation fails.
        """

        pass

    #
    # create_directory
    #
    @abstractmethod
    async def create_directory(self, path: str) -> None:
        """Create a new directory.

        Args:
            path: Relative path for the new directory.

        Raises:
            FileExistsError: If an item with this name already exists.
            FileNotFoundError: If the parent directory does not exist.
            OSError: If the operation fails.
        """

        pass

    #
    # create_file
    #
    @abstractmethod
    async def create_file(self, path: str) -> None:
        """Create a new empty file.

        Args:
            path: Relative path for the new file.

        Raises:
            FileExistsError: If an item with this name already exists.
            FileNotFoundError: If the parent directory does not exist.
            OSError: If the operation fails.
        """

        pass

    #
    # get_file_size
    #
    @abstractmethod
    async def get_file_size(self, path: str) -> int | None:
        """Return the size in bytes of a file, or ``None`` if unknown.

        Used by cross-connection transfers to report total progress.

        Args:
            path: Relative path within the share.

        Raises:
            FileNotFoundError: If the path does not exist.
        """

        pass

    #
    # copy_item
    #
    @abstractmethod
    async def copy_item(self, source_path: str, dest_path: str) -> None:
        """Copy a file or directory to a new location within the same share.

        Directories are copied recursively — all contents are replicated
        at the destination.

        Args:
            source_path: Relative path of the item to copy.
            dest_path: Relative path for the copy destination (full path
                including the final name, not just the parent directory).

        Raises:
            FileNotFoundError: If the source path does not exist.
            FileExistsError: If the destination path already exists.
            OSError: If the operation fails.
        """

        pass

    #
    # move_item
    #
    @abstractmethod
    async def move_item(self, source_path: str, dest_path: str) -> None:
        """Move (rename) a file or directory to a new location within the same share.

        This is effectively a cross-directory rename. For SMB backends
        this is typically a server-side operation (instant, no data copy).

        Args:
            source_path: Relative path of the item to move.
            dest_path: Relative path for the move destination (full path
                including the final name, not just the parent directory).

        Raises:
            FileNotFoundError: If the source path does not exist.
            FileExistsError: If the destination path already exists.
            OSError: If the operation fails.
        """

        pass

    #
    # write_file_from_stream
    #
    @abstractmethod
    async def write_file_from_stream(
        self,
        path: str,
        stream: AsyncIterator[bytes],
        on_progress: ProgressCallback | None = None,
    ) -> int:
        """Write a file by consuming an async byte stream.

        Designed for cross-connection transfers: the caller reads chunks
        from a source backend via ``read_file()`` and pipes them here.
        No overall timeout is applied — instead, each chunk write has
        its own per-operation timeout so arbitrarily large files can be
        transferred without hitting a wall-clock limit.

        Args:
            path: Relative path within the share (parent must exist).
            stream: Async iterator yielding file content chunks.
            on_progress: Optional callback invoked after each chunk is
                written.  Receives ``(bytes_written_so_far, None)``.

        Returns:
            Total number of bytes written.

        Raises:
            FileExistsError: If the destination already exists.
            OSError: If the write operation fails.
        """

        pass
