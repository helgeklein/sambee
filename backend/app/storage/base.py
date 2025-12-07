from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

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
    # file_exists
    #
    @abstractmethod
    async def file_exists(self, path: str) -> bool:
        """Check if a file or directory exists"""

        pass
