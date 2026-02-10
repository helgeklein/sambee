import asyncio
import logging
import stat
from datetime import datetime
from pathlib import PurePosixPath
from typing import AsyncIterator, BinaryIO

import smbclient
from smbclient._os import FileAttributes

from app.models.file import DirectoryListing, FileInfo, FileType
from app.storage.base import StorageBackend
from app.storage.smb_pool import get_connection_pool
from app.utils.file_type_registry import get_mime_type

logger = logging.getLogger(__name__)


class SMBBackend(StorageBackend):
    """SMB storage backend using smbprotocol"""

    #
    # __init__
    #
    def __init__(self, host: str, share_name: str, username: str, password: str, port: int = 445):
        self.host = host
        self.share_name = share_name
        self.username = username
        self.password = password
        self.port = port
        self._base_path = f"\\\\{host}\\{share_name}"
        self._pool_connection = None  # Track current pool connection context

    #
    # connect
    #
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

    #
    # disconnect
    #
    async def disconnect(self) -> None:
        """
        Release SMB connection back to pool.

        The connection is not actually closed - it's returned to the pool
        for reuse by other requests. The pool will clean up idle connections
        automatically.
        """

        logger.debug(f"SMB backend released (connection remains in pool): //{self.host}/{self.share_name}")

    #
    # _build_smb_path
    #
    def _build_smb_path(self, path: str) -> str:
        """Build full SMB path from relative path"""

        # Ensure path uses forward slashes and doesn't start with slash
        path = path.replace("\\", "/").lstrip("/")
        if path:
            return f"{self._base_path}\\{path.replace('/', '\\')}"
        return self._base_path

    #
    # list_directory
    #
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

                # Add timeout to prevent indefinite hangs (30 seconds for directory listing)
                items = await asyncio.wait_for(loop.run_in_executor(None, _scan_directory), timeout=30.0)

                # NOTE: No sorting here - frontend handles sorting based on user preference
                # Avoiding unnecessary work on the backend for large directories

                return DirectoryListing(path=path or "/", items=items, total=len(items))

        except asyncio.TimeoutError:
            logger.error(f"Timeout listing directory '{path}' (smb_path='{smb_path}') after 30 seconds")
            raise TimeoutError(f"SMB operation timed out while listing directory: {path}")
        except Exception as e:
            logger.error(
                f"Failed to list directory '{path}' (smb_path='{smb_path}'): {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise

    #
    # get_file_info
    #
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
                # Get file stats with a timeout to avoid blocking
                loop = asyncio.get_event_loop()
                stat_info = await asyncio.wait_for(loop.run_in_executor(None, lambda: smbclient.stat(smb_path)), timeout=10.0)

                # Derive directory status from stat_info.st_mode (already fetched above)
                # instead of calling smbclient.path.isdir() which would make a redundant
                # blocking SMB round-trip on the event loop.
                is_dir = stat.S_ISDIR(stat_info.st_mode)
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

    #
    # read_file
    #
    async def read_file(self, path: str) -> AsyncIterator[bytes]:
        """Read file contents as chunks"""

        # Set the SMB chunk size
        # Larger chunk sizes can improve throughput but use more memory (on both client and server)
        # Larger chunks also use more SMB credits
        chunk_size: int = 4 * 1024 * 1024

        # Build full SMB path
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

                # Open file with retry logic for file locking issues
                # SMB can throw "file in use" errors when multiple requests access the same file
                max_retries = 3
                retry_delay = 0.1  # Start with 100ms
                file_handle = None

                for attempt in range(max_retries):
                    try:
                        file_handle = await asyncio.wait_for(
                            loop.run_in_executor(None, lambda: smbclient.open_file(smb_path, mode="rb", share_access="rwd")),
                            timeout=15.0,
                        )
                        if attempt > 0:
                            logger.info(f"Successfully opened file after {attempt + 1} attempts: {path}")
                        break  # Success
                    except Exception as e:
                        # Check for retryable errors
                        error_str = str(e)
                        is_lock_error = "0xc0000043" in error_str or "being used by another process" in error_str
                        is_credit_error = "credits" in error_str.lower() and "available" in error_str.lower()

                        if (is_lock_error or is_credit_error) and attempt < max_retries - 1:
                            # Wait with exponential backoff and retry
                            error_type = "credits exhausted" if is_credit_error else "file locked"
                            logger.warning(f"SMB {error_type}, retrying in {retry_delay}s (attempt {attempt + 1}/{max_retries}): {path}")
                            await asyncio.sleep(retry_delay)
                            retry_delay *= 2  # Double the delay each time
                        else:
                            # Not a retryable error or out of retries
                            raise

                if not file_handle:
                    raise RuntimeError(f"Failed to open file after {max_retries} attempts")

                try:
                    while True:
                        try:
                            # Add timeout to prevent indefinite hangs (30 seconds per chunk)
                            chunk = await asyncio.wait_for(loop.run_in_executor(None, file_handle.read, chunk_size), timeout=30.0)
                            if not chunk:
                                break
                            yield chunk
                        except Exception as read_error:
                            # Check for file deletion/modification errors
                            error_str = str(read_error)
                            # NtStatus 0xc0000034 = FILE_NOT_FOUND (file deleted during read)
                            # NtStatus 0xc0000043 = SHARING_VIOLATION (file locked during read)
                            # Credit exhaustion = "Request requires X credits but only Y credits are available"
                            if "0xc0000034" in error_str or "does not exist" in error_str.lower():
                                logger.warning(f"File was deleted during read: {path}")
                                raise FileNotFoundError(f"File was deleted: {path}")
                            elif "0xc0000043" in error_str or "sharing violation" in error_str.lower():
                                logger.warning(f"File sharing violation during read (possibly being modified): {path}")
                                raise IOError(f"File access conflict: {path}")
                            elif "credits" in error_str.lower() and "available" in error_str.lower():
                                logger.error(f"SMB credit exhaustion during read: {path} - {read_error}")
                                raise IOError(f"SMB server out of credits (too many concurrent requests): {path}")
                            else:
                                # Unknown error during read
                                logger.error(f"Error reading chunk from {path}: {read_error}")
                                raise
                finally:
                    try:
                        await asyncio.wait_for(loop.run_in_executor(None, file_handle.close), timeout=5.0)
                    except Exception as close_error:
                        # Log but don't raise - we're already in cleanup
                        logger.warning(f"Error closing file handle for {path}: {close_error}")

        except Exception as e:
            logger.error(f"Failed to read file {path}: {e}")
            raise

    #
    # write_file
    #
    async def write_file(self, path: str, data: BinaryIO) -> int:
        """Write a file to the SMB share, overwriting if it exists.

        Reads from *data* in chunks and writes them to the remote path.
        Parent directories must already exist.

        Args:
            path: Relative path within the share.
            data: File-like object to read content from.

        Returns:
            Number of bytes written.

        Raises:
            TimeoutError: If the operation takes longer than 120 seconds.
            OSError: If the SMB write operation fails.
        """

        # Write chunk size — 4 MB matches read_file for consistency
        write_chunk_size: int = 4 * 1024 * 1024
        smb_path = self._build_smb_path(path)
        logger.info(f"Writing file: path='{path}' -> smb_path='{smb_path}'")

        try:
            pool = await get_connection_pool()

            async with pool.get_connection(
                host=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                share_name=self.share_name,
            ):
                loop = asyncio.get_event_loop()

                def _write() -> int:
                    bytes_written = 0
                    with smbclient.open_file(smb_path, mode="wb", share_access="r") as f:
                        while True:
                            chunk = data.read(write_chunk_size)
                            if not chunk:
                                break
                            f.write(chunk)
                            bytes_written += len(chunk)
                    return bytes_written

                bytes_written = await asyncio.wait_for(
                    loop.run_in_executor(None, _write),
                    timeout=120.0,
                )

                logger.info(f"Successfully wrote {bytes_written} bytes: path='{path}'")
                return bytes_written

        except asyncio.TimeoutError:
            logger.error(f"Timeout writing '{path}' after 120 seconds")
            raise TimeoutError(f"SMB operation timed out while writing: {path}")
        except OSError as e:
            error_str = str(e)
            if "0xc0000043" in error_str or "being used by another process" in error_str:
                logger.warning(f"File locked during write: path='{path}'")
                raise IOError(f"File is locked and cannot be written: {path}") from e
            logger.error(f"Failed to write '{path}': {type(e).__name__}: {e}", exc_info=True)
            raise
        except Exception as e:
            logger.error(f"Failed to write '{path}': {type(e).__name__}: {e}", exc_info=True)
            raise

    #
    # file_exists
    #
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
                # Add timeout to prevent indefinite hangs (10 seconds for exists check)
                exists = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: smbclient.path.exists(  # pyright: ignore[reportAttributeAccessIssue]
                            smb_path
                        ),
                    ),
                    timeout=10.0,
                )
                return bool(exists)
        except Exception:
            return False

    #
    # delete_item
    #
    async def delete_item(self, path: str) -> None:
        """Delete a file or directory via SMB.

        Directories are deleted recursively — every file and sub-directory
        is removed depth-first before the directory itself is deleted.

        Args:
            path: Relative path within the share.

        Raises:
            FileNotFoundError: If the path does not exist.
            OSError: If the operation fails.
        """

        smb_path = self._build_smb_path(path)
        logger.info(f"Deleting item: path='{path}' -> smb_path='{smb_path}'")

        try:
            pool = await get_connection_pool()

            async with pool.get_connection(
                host=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                share_name=self.share_name,
            ):
                loop = asyncio.get_event_loop()

                def _delete_recursive(target: str) -> None:
                    """Depth-first removal of *target* (file or directory)."""

                    stat_info = smbclient.stat(target)
                    if stat.S_ISDIR(stat_info.st_mode):
                        for entry in smbclient.scandir(target):
                            _delete_recursive(entry.path)
                        smbclient.rmdir(target)
                    else:
                        smbclient.remove(target)

                await asyncio.wait_for(
                    loop.run_in_executor(None, _delete_recursive, smb_path),
                    timeout=120.0,
                )

                logger.info(f"Successfully deleted: path='{path}'")

        except asyncio.TimeoutError:
            logger.error(f"Timeout deleting '{path}' after 15 seconds")
            raise TimeoutError(f"SMB operation timed out while deleting: {path}")
        except OSError as e:
            error_str = str(e)
            # 0xc0000034 = STATUS_OBJECT_NAME_NOT_FOUND
            if "0xc0000034" in error_str or "No such file" in error_str:
                raise FileNotFoundError(f"Path not found: {path}") from e
            logger.error(
                f"Failed to delete '{path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise
        except Exception as e:
            logger.error(
                f"Failed to delete '{path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise
