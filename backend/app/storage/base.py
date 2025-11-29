from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from app.models.file import DirectoryListing, FileInfo


class StorageBackend(ABC):
    """Abstract base class for storage backends"""

    @abstractmethod
    async def connect(self) -> None:
        """Establish connection to the storage backend"""
        pass

    @abstractmethod
    async def disconnect(self) -> None:
        """Close connection to the storage backend"""
        pass

    @abstractmethod
    async def list_directory(self, path: str) -> DirectoryListing:
        """List contents of a directory"""
        pass

    @abstractmethod
    async def get_file_info(self, path: str) -> FileInfo:
        """Get information about a specific file or directory"""
        pass

    @abstractmethod
    async def read_file(self, path: str, chunk_size: int = 8192) -> AsyncIterator[bytes]:
        """Read file contents as chunks"""
        pass

    @abstractmethod
    async def file_exists(self, path: str) -> bool:
        """Check if a file or directory exists"""
        pass
