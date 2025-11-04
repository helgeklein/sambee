import asyncio
import logging
import mimetypes
from datetime import datetime
from pathlib import PurePosixPath
from typing import AsyncIterator

import smbclient
from app.models.file import DirectoryListing, FileInfo, FileType
from app.storage.base import StorageBackend

logger = logging.getLogger(__name__)


class SMBBackend(StorageBackend):
    """SMB storage backend using smbprotocol"""

    def __init__(
        self, host: str, share_name: str, username: str, password: str, port: int = 445
    ):
        self.host = host
        self.share_name = share_name
        self.username = username
        self.password = password
        self.port = port
        self._base_path = f"\\\\{host}\\{share_name}"

    async def connect(self) -> None:
        """Establish SMB connection"""
        try:
            # Register the session for smbclient
            smbclient.register_session(
                self.host,
                username=self.username,
                password=self.password,
                port=self.port,
            )
        except Exception as e:
            logger.error(f"Failed to connect to SMB share: {e}")
            raise

    async def disconnect(self) -> None:
        """Close SMB connection"""
        try:
            smbclient.delete_session(self.host, port=self.port)
        except Exception:
            pass

    def _build_smb_path(self, path: str) -> str:
        """Build full SMB path from relative path"""
        # Ensure path uses forward slashes and doesn't start with slash
        path = path.replace("\\", "/").lstrip("/")
        if path:
            return f"{self._base_path}\\{path.replace('/', '\\')}"
        return self._base_path

    def _get_mime_type(self, filename: str) -> str:
        """Guess MIME type from filename"""
        mime_type, _ = mimetypes.guess_type(filename)
        return mime_type or "application/octet-stream"

    async def list_directory(self, path: str = "") -> DirectoryListing:
        """List contents of a directory"""
        smb_path = self._build_smb_path(path)
        items = []

        try:
            # Run in executor to avoid blocking
            loop = asyncio.get_event_loop()

            # Use scandir for better performance - all info from ONE SMB query_directory call
            def _scan_directory() -> list[FileInfo]:
                result = []
                entries = smbclient.scandir(
                    smb_path, username=self.username, password=self.password
                )

                for entry in entries:
                    if entry.name in [".", ".."]:
                        continue

                    item_path = f"{path}/{entry.name}" if path else entry.name

                    try:
                        # Use smb_info which is already populated by scandir - NO extra SMB calls!
                        info = entry.smb_info
                        is_dir = entry.is_dir()  # No SMB call - checks file_attributes

                        # Convert Windows FILETIME (100ns intervals since 1601) to Python datetime
                        # The smb_info already has datetime objects
                        file_info = FileInfo(
                            name=entry.name,
                            path=item_path,
                            type=FileType.DIRECTORY if is_dir else FileType.FILE,
                            size=info.end_of_file if not is_dir else None,
                            mime_type=None
                            if is_dir
                            else self._get_mime_type(entry.name),
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

            # Sort: directories first, then alphabetically
            items.sort(key=lambda x: (x.type != FileType.DIRECTORY, x.name.lower()))

            return DirectoryListing(path=path or "/", items=items, total=len(items))

        except Exception as e:
            logger.error(f"Failed to list directory {path}: {e}")
            raise

    async def get_file_info(self, path: str) -> FileInfo:
        """Get information about a specific file or directory"""
        smb_path = self._build_smb_path(path)

        try:
            loop = asyncio.get_event_loop()
            stat_info = await loop.run_in_executor(
                None,
                lambda: smbclient.stat(
                    smb_path, username=self.username, password=self.password
                ),
            )

            is_dir = smbclient.path.isdir(  # pyright: ignore[reportAttributeAccessIssue]
                smb_path, username=self.username, password=self.password
            )
            filename = PurePosixPath(path).name

            return FileInfo(
                name=filename,
                path=path,
                type=FileType.DIRECTORY if is_dir else FileType.FILE,
                size=stat_info.st_size if not is_dir else None,
                mime_type=None if is_dir else self._get_mime_type(filename),
                modified_at=datetime.fromtimestamp(stat_info.st_mtime),
                created_at=datetime.fromtimestamp(stat_info.st_ctime),
                is_hidden=filename.startswith("."),
            )

        except Exception as e:
            logger.error(f"Failed to get file info for {path}: {e}")
            raise

    async def read_file(  # type: ignore[misc,override]
        self, path: str, chunk_size: int = 8192
    ) -> AsyncIterator[bytes]:
        """Read file contents as chunks"""
        smb_path = self._build_smb_path(path)

        try:
            loop = asyncio.get_event_loop()

            # Open file in executor
            file_handle = await loop.run_in_executor(
                None,
                lambda: smbclient.open_file(
                    smb_path, mode="rb", username=self.username, password=self.password
                ),
            )

            try:
                while True:
                    chunk = await loop.run_in_executor(
                        None, file_handle.read, chunk_size
                    )
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
            loop = asyncio.get_event_loop()
            exists = await loop.run_in_executor(
                None,
                lambda: smbclient.path.exists(  # pyright: ignore[reportAttributeAccessIssue]
                    smb_path, username=self.username, password=self.password
                ),
            )
            return bool(exists)
        except Exception:
            return False
