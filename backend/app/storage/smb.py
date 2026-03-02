import asyncio
import logging
import stat
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import PurePosixPath
from typing import BinaryIO

import smbclient
from smbclient._os import FileAttributes

from app.models.file import DirectoryListing, FileInfo, FileType
from app.storage.base import ProgressCallback, StorageBackend
from app.storage.smb_pool import get_connection_pool
from app.utils.file_type_registry import get_mime_type

logger = logging.getLogger(__name__)


class SMBBackend(StorageBackend):
    """SMB storage backend using smbprotocol"""

    # Sentinel for no prefix (share root)
    _NO_PREFIX = ""

    #
    # __init__
    #
    def __init__(self, host: str, share_name: str, username: str, password: str, port: int = 445, path_prefix: str = "/"):
        """Initialize SMB storage backend.

        Args:
            host: SMB server hostname or IP.
            share_name: Name of the SMB share.
            username: SMB authentication username.
            password: SMB authentication password.
            port: SMB port (default 445).
            path_prefix: Base path within the share. When set to a
                non-root value (e.g. "/photos"), all operations are
                scoped to that sub-directory — the frontend never
                sees the prefix in returned paths.
        """

        self.host = host
        self.share_name = share_name
        self.username = username
        self.password = password
        self.port = port
        self._base_path = f"\\\\{host}\\{share_name}"
        self._pool_connection = None  # Track current pool connection context

        # Normalize path_prefix: strip slashes, collapse to empty string for root
        self._path_prefix = self._normalize_prefix(path_prefix)

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
    # _normalize_prefix
    #
    @staticmethod
    def _normalize_prefix(prefix: str | None) -> str:
        """Normalize a path prefix to a clean relative form.

        "/"  -> ""  (share root)
        None -> ""  (share root)
        ""   -> ""  (share root)
        "/photos"  -> "photos"
        "/a/b/c/"  -> "a/b/c"
        """

        if not prefix:
            return SMBBackend._NO_PREFIX
        cleaned = prefix.replace("\\", "/").strip("/")
        return cleaned if cleaned else SMBBackend._NO_PREFIX

    #
    # _build_smb_path
    #
    def _build_smb_path(self, path: str) -> str:
        """Build full SMB path from relative path.

        The path_prefix is prepended automatically so the caller only
        needs to supply paths relative to the application root.
        """

        # Ensure path uses forward slashes and doesn't start with slash
        path = path.replace("\\", "/").lstrip("/")

        # Combine prefix and path
        if self._path_prefix and path:
            full_rel = f"{self._path_prefix}/{path}"
        elif self._path_prefix:
            full_rel = self._path_prefix
        else:
            full_rel = path

        if full_rel:
            return f"{self._base_path}\\{full_rel.replace('/', '\\')}"
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
                    # scandir internally manages its SMBDirectoryIO handle
                    # and already filters out "." and ".." entries.
                    for entry in smbclient.scandir(smb_path):
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
                    """Depth-first removal of *target* (file or directory).

                    Children are collected into a list before recursing
                    so the scandir generator is fully consumed — this
                    releases the underlying SMB directory handle before
                    we attempt rmdir on the parent.
                    """

                    stat_info = smbclient.stat(target)
                    if stat.S_ISDIR(stat_info.st_mode):
                        # Collect all children before recursing so the
                        # scandir generator (and its underlying SMB
                        # directory handle) is fully consumed and closed
                        # before we call rmdir.
                        children = [entry.path for entry in smbclient.scandir(target)]
                        for child_path in children:
                            _delete_recursive(child_path)
                        smbclient.rmdir(target)
                    else:
                        smbclient.remove(target)

                await asyncio.wait_for(
                    loop.run_in_executor(None, _delete_recursive, smb_path),
                    timeout=120.0,
                )

                logger.info(f"Successfully deleted: path='{path}'")

        except asyncio.TimeoutError:
            logger.error(f"Timeout deleting '{path}' after 120 seconds")
            raise TimeoutError(f"SMB operation timed out while deleting: {path}")
        except OSError as e:
            error_str = str(e)
            # 0xc0000034 = STATUS_OBJECT_NAME_NOT_FOUND
            if "0xc0000034" in error_str or "No such file" in error_str:
                raise FileNotFoundError(f"Path not found: {path}") from e
            # 0xc0000056 = STATUS_DELETE_PENDING — item is already being
            # deleted by the server.  Treat as success.
            if "0xc0000056" in error_str:
                logger.info(f"Item already being deleted (STATUS_DELETE_PENDING): path='{path}'")
                return
            logger.error(
                f"Failed to delete '{path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise
        except Exception as e:
            error_str = str(e)
            # smbprotocol may raise non-OSError exceptions that still
            # carry the NTSTATUS code in their message.
            if "0xc0000056" in error_str or "DeletePending" in type(e).__name__:
                logger.info(f"Item already being deleted (STATUS_DELETE_PENDING): path='{path}'")
                return
            logger.error(
                f"Failed to delete '{path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise

    #
    # rename_item
    #
    async def rename_item(self, path: str, new_name: str) -> None:
        """Rename a file or directory via SMB.

        The item stays in its current parent directory — only the final
        path component is changed.

        Args:
            path: Relative path within the share.
            new_name: New name for the item (filename only).

        Raises:
            FileNotFoundError: If the source path does not exist.
            FileExistsError: If an item with *new_name* already exists
                in the same directory.
            OSError: If the operation fails.
        """

        smb_src = self._build_smb_path(path)

        # Derive destination: same parent directory, different leaf name.
        parent = smb_src.rsplit("\\", 1)[0]
        smb_dst = f"{parent}\\{new_name}"

        logger.info(f"Renaming item: path='{path}' -> new_name='{new_name}' (smb: '{smb_src}' -> '{smb_dst}')")

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
                await asyncio.wait_for(
                    loop.run_in_executor(None, smbclient.rename, smb_src, smb_dst),
                    timeout=30.0,
                )

                logger.info(f"Successfully renamed: '{path}' -> '{new_name}'")

        except asyncio.TimeoutError:
            logger.error(f"Timeout renaming '{path}' after 30 seconds")
            raise TimeoutError(f"SMB operation timed out while renaming: {path}")
        except OSError as e:
            error_str = str(e)
            # 0xc0000034 = STATUS_OBJECT_NAME_NOT_FOUND
            if "0xc0000034" in error_str or "No such file" in error_str:
                raise FileNotFoundError(f"Path not found: {path}") from e
            # 0xc0000035 = STATUS_OBJECT_NAME_COLLISION (target already exists)
            if "0xc0000035" in error_str:
                raise FileExistsError(f"An item named '{new_name}' already exists") from e
            logger.error(
                f"Failed to rename '{path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise
        except Exception as e:
            logger.error(
                f"Failed to rename '{path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise

    #
    # create_directory
    #
    async def create_directory(self, path: str) -> None:
        """Create a new directory via SMB.

        Args:
            path: Relative path for the new directory.

        Raises:
            FileExistsError: If an item with this name already exists.
            FileNotFoundError: If the parent directory does not exist.
            OSError: If the operation fails.
        """

        smb_path = self._build_smb_path(path)
        logger.info(f"Creating directory: path='{path}' -> smb_path='{smb_path}'")

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
                await asyncio.wait_for(
                    loop.run_in_executor(None, smbclient.mkdir, smb_path),
                    timeout=30.0,
                )

                logger.info(f"Successfully created directory: '{path}'")

        except asyncio.TimeoutError:
            logger.error(f"Timeout creating directory '{path}' after 30 seconds")
            raise TimeoutError(f"SMB operation timed out while creating directory: {path}")
        except OSError as e:
            error_str = str(e)
            # 0xc0000035 = STATUS_OBJECT_NAME_COLLISION (already exists)
            if "0xc0000035" in error_str:
                raise FileExistsError(f"An item named '{path.rsplit('/', 1)[-1]}' already exists") from e
            # 0xc0000034 = STATUS_OBJECT_NAME_NOT_FOUND (parent missing)
            if "0xc0000034" in error_str or "No such file" in error_str:
                raise FileNotFoundError(f"Parent directory not found for: {path}") from e
            logger.error(
                f"Failed to create directory '{path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise
        except Exception as e:
            logger.error(
                f"Failed to create directory '{path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise

    #
    # create_file
    #
    async def create_file(self, path: str) -> None:
        """Create a new empty file via SMB.

        Uses exclusive-create mode ('x') to fail if the file already exists.

        Args:
            path: Relative path for the new file.

        Raises:
            FileExistsError: If an item with this name already exists.
            FileNotFoundError: If the parent directory does not exist.
            OSError: If the operation fails.
        """

        smb_path = self._build_smb_path(path)
        logger.info(f"Creating file: path='{path}' -> smb_path='{smb_path}'")

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

                def _create_empty_file() -> None:
                    with smbclient.open_file(smb_path, mode="xb"):
                        pass  # Create empty file and close immediately

                await asyncio.wait_for(
                    loop.run_in_executor(None, _create_empty_file),
                    timeout=30.0,
                )

                logger.info(f"Successfully created file: '{path}'")

        except asyncio.TimeoutError:
            logger.error(f"Timeout creating file '{path}' after 30 seconds")
            raise TimeoutError(f"SMB operation timed out while creating file: {path}")
        except OSError as e:
            error_str = str(e)
            # 0xc0000035 = STATUS_OBJECT_NAME_COLLISION (already exists)
            if "0xc0000035" in error_str:
                raise FileExistsError(f"An item named '{path.rsplit('/', 1)[-1]}' already exists") from e
            # 0xc0000034 = STATUS_OBJECT_NAME_NOT_FOUND (parent missing)
            if "0xc0000034" in error_str or "No such file" in error_str:
                raise FileNotFoundError(f"Parent directory not found for: {path}") from e
            logger.error(
                f"Failed to create file '{path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise
        except Exception as e:
            logger.error(
                f"Failed to create file '{path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise

    #
    # get_file_size
    #
    async def get_file_size(self, path: str) -> int | None:
        """Return the file size in bytes, or ``None`` for directories."""

        smb_path = self._build_smb_path(path)

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
                stat_result = await asyncio.wait_for(
                    loop.run_in_executor(None, smbclient.stat, smb_path),
                    timeout=10.0,
                )
                if stat.S_ISDIR(stat_result.st_mode):
                    return None
                return stat_result.st_size  # type: ignore  # smbclient untyped
        except Exception as e:
            error_str = str(e)
            if "0xc0000034" in error_str or "No such file" in error_str:
                raise FileNotFoundError(f"Path not found: {path}") from e
            logger.error(f"Failed to get file size for '{path}': {e}")
            raise

    #
    # copy_item
    #
    async def copy_item(self, source_path: str, dest_path: str) -> None:
        """Copy a file or directory to a new location via SMB.

        Files are copied using ``smbclient.copyfile`` which performs a
        server-side copy (``FSCTL_SRV_COPYCHUNK``).  Directories are
        copied recursively — structure is replicated depth-first.

        Args:
            source_path: Relative path of the item to copy.
            dest_path: Relative destination path (full path including name).

        Raises:
            FileNotFoundError: If the source path does not exist.
            FileExistsError: If the destination path already exists.
            OSError: If the operation fails.
        """

        smb_src = self._build_smb_path(source_path)
        smb_dst = self._build_smb_path(dest_path)
        logger.info(f"Copying item: '{source_path}' -> '{dest_path}' (smb: '{smb_src}' -> '{smb_dst}')")

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

                def _copy_recursive(src: str, dst: str) -> None:
                    """Copy *src* to *dst*, creating directories as needed.

                    Preserves the original modification time on both files
                    and directories.
                    """

                    stat_info = smbclient.stat(src)
                    # Convert float seconds to integer nanoseconds —
                    # smbclient.utime() requires int via the ns= parameter.
                    atime_ns = int(stat_info.st_atime * 1_000_000_000)
                    mtime_ns = int(stat_info.st_mtime * 1_000_000_000)

                    if stat.S_ISDIR(stat_info.st_mode):
                        smbclient.mkdir(dst)
                        # Collect children before recursing so the scandir
                        # generator is fully consumed before deeper calls.
                        children = [(entry.name, entry.path) for entry in smbclient.scandir(src)]
                        for child_name, child_path in children:
                            _copy_recursive(child_path, f"{dst}\\{child_name}")
                        # Restore directory timestamps after all children are
                        # copied (adding children updates the directory mtime).
                        smbclient.utime(dst, ns=(atime_ns, mtime_ns))
                    else:
                        smbclient.copyfile(src, dst)
                        smbclient.utime(dst, ns=(atime_ns, mtime_ns))

                await asyncio.wait_for(
                    loop.run_in_executor(None, _copy_recursive, smb_src, smb_dst),
                    timeout=300.0,  # Large copies may take time
                )

                logger.info(f"Successfully copied: '{source_path}' -> '{dest_path}'")

        except asyncio.TimeoutError:
            logger.error(f"Timeout copying '{source_path}' after 300 seconds")
            raise TimeoutError(f"SMB operation timed out while copying: {source_path}")
        except OSError as e:
            error_str = str(e)
            # 0xc0000034 = STATUS_OBJECT_NAME_NOT_FOUND
            if "0xc0000034" in error_str or "No such file" in error_str:
                raise FileNotFoundError(f"Source not found: {source_path}") from e
            # 0xc0000035 = STATUS_OBJECT_NAME_COLLISION (destination already exists)
            if "0xc0000035" in error_str:
                raise FileExistsError(f"Destination already exists: {dest_path}") from e
            logger.error(
                f"Failed to copy '{source_path}' -> '{dest_path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise
        except Exception as e:
            logger.error(
                f"Failed to copy '{source_path}' -> '{dest_path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise

    #
    # move_item
    #
    async def move_item(self, source_path: str, dest_path: str) -> None:
        """Move a file or directory to a new location via SMB.

        Uses ``smbclient.rename`` which performs a server-side rename
        (instant, no data copy) — this works across directories within
        the same share.

        Args:
            source_path: Relative path of the item to move.
            dest_path: Relative destination path (full path including name).

        Raises:
            FileNotFoundError: If the source path does not exist.
            FileExistsError: If the destination path already exists.
            OSError: If the operation fails.
        """

        smb_src = self._build_smb_path(source_path)
        smb_dst = self._build_smb_path(dest_path)
        logger.info(f"Moving item: '{source_path}' -> '{dest_path}' (smb: '{smb_src}' -> '{smb_dst}')")

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
                await asyncio.wait_for(
                    loop.run_in_executor(None, smbclient.rename, smb_src, smb_dst),
                    timeout=30.0,
                )

                logger.info(f"Successfully moved: '{source_path}' -> '{dest_path}'")

        except asyncio.TimeoutError:
            logger.error(f"Timeout moving '{source_path}' after 30 seconds")
            raise TimeoutError(f"SMB operation timed out while moving: {source_path}")
        except OSError as e:
            error_str = str(e)
            # 0xc0000034 = STATUS_OBJECT_NAME_NOT_FOUND
            if "0xc0000034" in error_str or "No such file" in error_str:
                raise FileNotFoundError(f"Source not found: {source_path}") from e
            # 0xc0000035 = STATUS_OBJECT_NAME_COLLISION (destination already exists)
            if "0xc0000035" in error_str:
                raise FileExistsError(f"Destination already exists: {dest_path}") from e
            logger.error(
                f"Failed to move '{source_path}' -> '{dest_path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise
        except Exception as e:
            logger.error(
                f"Failed to move '{source_path}' -> '{dest_path}': {type(e).__name__}: {e}",
                exc_info=True,
            )
            raise

    #
    # write_file_from_stream
    #
    async def write_file_from_stream(
        self,
        path: str,
        stream: AsyncIterator[bytes],
        on_progress: ProgressCallback | None = None,
    ) -> int:
        """Write a file from an async byte stream (for cross-connection transfers).

        Opens the destination file and writes chunks as they arrive from
        the async iterator.  Each individual chunk write is guarded by a
        per-chunk timeout (60 s) instead of a total timeout, so
        arbitrarily large files can be transferred without hitting a
        wall-clock limit.

        Args:
            path: Relative path within the share (parent must exist).
            stream: Async iterator yielding file content in chunks.
            on_progress: Optional callback invoked after each chunk with
                ``(bytes_written_so_far, None)``.

        Returns:
            Total number of bytes written.
        """

        # Per-chunk timeout — generous to handle slow network segments
        # without capping total transfer time.
        chunk_write_timeout_s: float = 60.0

        smb_path = self._build_smb_path(path)
        logger.info(f"write_file_from_stream: path='{path}' -> smb_path='{smb_path}'")

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

                # Open the file handle once — we keep it open while streaming.
                file_handle = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: smbclient.open_file(smb_path, mode="wb", share_access="r"),
                    ),
                    timeout=15.0,
                )

                bytes_written = 0
                try:
                    async for chunk in stream:
                        await asyncio.wait_for(
                            loop.run_in_executor(None, file_handle.write, chunk),
                            timeout=chunk_write_timeout_s,
                        )
                        bytes_written += len(chunk)
                        if on_progress:
                            on_progress(bytes_written, None)
                finally:
                    try:
                        await asyncio.wait_for(
                            loop.run_in_executor(None, file_handle.close),
                            timeout=5.0,
                        )
                    except Exception as close_err:
                        logger.warning(f"Error closing file handle for '{path}': {close_err}")

                logger.info(f"write_file_from_stream: wrote {bytes_written} bytes to '{path}'")
                return bytes_written

        except asyncio.TimeoutError:
            logger.error(f"Timeout during write_file_from_stream for '{path}'")
            raise TimeoutError(f"SMB operation timed out while writing: {path}")
        except OSError as e:
            error_str = str(e)
            if "0xc0000035" in error_str:
                raise FileExistsError(f"Destination already exists: {path}") from e
            if "0xc0000043" in error_str or "being used by another process" in error_str:
                raise IOError(f"File is locked and cannot be written: {path}") from e
            logger.error(f"Failed write_file_from_stream '{path}': {type(e).__name__}: {e}", exc_info=True)
            raise
        except Exception as e:
            logger.error(f"Failed write_file_from_stream '{path}': {type(e).__name__}: {e}", exc_info=True)
            raise
