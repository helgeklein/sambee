import asyncio
import logging
from datetime import datetime
from pathlib import PurePosixPath
from typing import AsyncIterator

import smbclient
from smbclient._os import FileAttributes

from app.models.file import DirectoryListing, FileInfo, FileType
from app.storage.base import StorageBackend
from app.storage.smb_pool import get_connection_pool
from app.utils.file_type_registry import get_mime_type

logger = logging.getLogger(__name__)


class SMBBackend(StorageBackend):
    """SMB storage backend using smbprotocol"""

    def __init__(self, host: str, share_name: str, username: str, password: str, port: int = 445):
        self.host = host
        self.share_name = share_name
        self.username = username
        self.password = password
        self.port = port
        self._base_path = f"\\\\{host}\\{share_name}"
        self._pool_connection = None  # Track current pool connection context

    async def connect(self) -> None:
        """
        Establish SMB connection using connection pool.

        This acquires a connection from the global pool. If a connection
        to this server already exists, it will be reused. Otherwise, a new
        connection is created.

        The connection is NOT immediately established here - it's acquired
        through the pool's context manager when operations are performed.
        """
        # Connection pooling is handled transparently in operations
        # No explicit connection establishment needed
        logger.debug(f"SMB backend ready (will use pooled connection): //{self.host}:{self.port}/{self.share_name}")

    async def disconnect(self) -> None:
        """
        Release SMB connection back to pool.

        The connection is not actually closed - it's returned to the pool
        for reuse by other requests. The pool will clean up idle connections
        automatically.
        """
        logger.debug(f"SMB backend released (connection remains in pool): //{self.host}/{self.share_name}")

    def _build_smb_path(self, path: str) -> str:
        """Build full SMB path from relative path"""
        # Ensure path uses forward slashes and doesn't start with slash
        path = path.replace("\\", "/").lstrip("/")
        if path:
            return f"{self._base_path}\\{path.replace('/', '\\')}"
        return self._base_path

    async def list_directory(self, path: str = "") -> DirectoryListing:
        """List contents of a directory"""
        smb_path = self._build_smb_path(path)
        logger.info(f"Listing directory: path='{path}' -> smb_path='{smb_path}'")

        try:
            # Acquire connection from pool
            pool = await get_connection_pool()

            async with pool.get_connection(
                host=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                share_name=self.share_name,
            ):
                # Run in executor to avoid blocking
                loop = asyncio.get_event_loop()

                # Use scandir for better performance - all info from ONE SMB query_directory call
                def _scan_directory() -> list[FileInfo]:
                    result = []
                    # Don't pass username/password - use the registered session from pool
                    entries = smbclient.scandir(smb_path)

                    for entry in entries:
                        if entry.name in [".", ".."]:
                            continue

                        item_path = f"{path}/{entry.name}" if path else entry.name

                        try:
                            # Use smb_info which is already populated by scandir - NO extra SMB calls!
                            info = entry.smb_info

                            # OPTIMIZATION: Check directory flag directly from file_attributes
                            # to avoid calling is_dir() which might call is_symlink() which might
                            # call stat() for reparse points (symlinks/junctions)
                            is_dir = bool(info.file_attributes & FileAttributes.FILE_ATTRIBUTE_DIRECTORY)

                            # Convert Windows FILETIME (100ns intervals since 1601) to Python datetime
                            # The smb_info already has datetime objects
                            file_info = FileInfo(
                                name=entry.name,
                                path=item_path,
                                type=FileType.DIRECTORY if is_dir else FileType.FILE,
                                size=info.end_of_file if not is_dir else None,
                                mime_type=None if is_dir else get_mime_type(entry.name),
                                modified_at=info.last_write_time,
                                created_at=info.creation_time,
                                is_hidden=entry.name.startswith("."),
                            )
                            result.append(file_info)
                        except Exception as e:
                            logger.warning(f"Failed to process {entry.name}: {e}")
                            # Add basic entry even if processing fails
                            result.append(
                                FileInfo(
                                    name=entry.name,
                                    path=item_path,
                                    type=FileType.FILE,
                                    is_readable=False,
                                    is_hidden=entry.name.startswith("."),
                                )
                            )
                    return result

                items = await loop.run_in_executor(None, _scan_directory)

                # NOTE: No sorting here - frontend handles sorting based on user preference
                # Avoiding unnecessary work on the backend for large directories

                return DirectoryListing(path=path or "/", items=items, total=len(items))

        except Exception as e:
            logger.error(
                f"Failed to list directory '{path}' (smb_path='{smb_path}'): {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise

    async def get_file_info(self, path: str) -> FileInfo:
        """Get information about a specific file or directory"""
        smb_path = self._build_smb_path(path)

        try:
            # Acquire connection from pool
            pool = await get_connection_pool()

            async with pool.get_connection(
                host=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                share_name=self.share_name,
            ):
                loop = asyncio.get_event_loop()
                # Don't pass username/password - use the registered session from pool
                stat_info = await loop.run_in_executor(None, lambda: smbclient.stat(smb_path))

                is_dir = smbclient.path.isdir(  # pyright: ignore[reportAttributeAccessIssue]
                    smb_path
                )
                filename = PurePosixPath(path).name

                return FileInfo(
                    name=filename,
                    path=path,
                    type=FileType.DIRECTORY if is_dir else FileType.FILE,
                    size=stat_info.st_size if not is_dir else None,
                    mime_type=None if is_dir else get_mime_type(filename),
                    modified_at=datetime.fromtimestamp(stat_info.st_mtime),
                    created_at=datetime.fromtimestamp(stat_info.st_ctime),
                    is_hidden=filename.startswith("."),
                )

        except Exception as e:
            logger.error(f"Failed to get file info for {path}: {e}")
            raise

    async def read_file(  # type: ignore[override, misc]
        self, path: str, chunk_size: int = 1024 * 1024
    ) -> AsyncIterator[bytes]:
        """Read file contents as chunks"""
        smb_path = self._build_smb_path(path)

        try:
            # Acquire connection from pool
            pool = await get_connection_pool()

            async with pool.get_connection(
                host=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                share_name=self.share_name,
            ):
                loop = asyncio.get_event_loop()

                # Open file in executor
                # Don't pass username/password - use the registered session from pool
                file_handle = await loop.run_in_executor(None, lambda: smbclient.open_file(smb_path, mode="rb"))

                try:
                    while True:
                        chunk = await loop.run_in_executor(None, file_handle.read, chunk_size)
                        if not chunk:
                            break
                        yield chunk
                finally:
                    await loop.run_in_executor(None, file_handle.close)

        except Exception as e:
            logger.error(f"Failed to read file {path}: {e}")
            raise

    async def file_exists(self, path: str) -> bool:
        """Check if a file or directory exists"""
        smb_path = self._build_smb_path(path)

        try:
            # Acquire connection from pool
            pool = await get_connection_pool()

            async with pool.get_connection(
                host=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                share_name=self.share_name,
            ):
                loop = asyncio.get_event_loop()
                # Don't pass username/password - use the registered session from pool
                exists = await loop.run_in_executor(
                    None,
                    lambda: smbclient.path.exists(  # pyright: ignore[reportAttributeAccessIssue]
                        smb_path
                    ),
                )
                return bool(exists)
        except Exception:
            return False
