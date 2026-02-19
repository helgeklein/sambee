from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import BinaryIO

from app.models.file import DirectoryListing, FileInfo


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
