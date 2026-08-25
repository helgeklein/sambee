"""Same-executor direct ZIP extraction without archive or member staging."""

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from app.models.file import FileInfo, FileType
from app.services.archive.zip_reader import ArchiveFormatError, ZipReader
from app.storage.base import RandomAccessReader


class ArchiveExtractionBackend(Protocol):
    async def get_file_info(self, path: str) -> FileInfo: ...

    async def open_random_access_reader(self, path: str) -> RandomAccessReader: ...

    async def create_directory(self, path: str) -> None: ...

    async def write_file_from_stream(
        self,
        path: str,
        stream: AsyncIterator[bytes],
        *,
        overwrite: bool = False,
        source_mtime: object | None = None,
    ) -> int: ...


@dataclass(frozen=True)
class ArchiveExtractionResult:
    files_extracted: int
    directories_created: int
    extracted_bytes: int


class ArchiveExtractionCancelled(Exception):
    """Raised when extraction is cancelled between bounded member chunks."""


def _target_path(destination_root: str, member_path: str) -> str:
    root = destination_root.replace("\\", "/").strip("/")
    return f"{root}/{member_path}" if root else member_path


async def extract_archive_to_new_paths(
    backend: ArchiveExtractionBackend,
    *,
    archive_path: str,
    destination_root: str,
    is_cancelled: Callable[[], Awaitable[bool]] | None = None,
) -> ArchiveExtractionResult:
    """Extract safe, readable ZIP members without replacing existing files."""

    archive_info = await backend.get_file_info(archive_path)
    if archive_info.type != FileType.FILE or archive_info.size is None:
        raise ArchiveFormatError("Archive extraction source must be a regular file")
    random_reader = await backend.open_random_access_reader(archive_path)
    try:
        zip_reader = ZipReader(random_reader, archive_info.size)
        entries = [entry for entry in await zip_reader.entries() if entry.is_safe]
        created_directories: set[str] = set()
        files_extracted = 0
        extracted_bytes = 0
        for entry in entries:
            if is_cancelled is not None and await is_cancelled():
                raise ArchiveExtractionCancelled("Archive extraction was cancelled")
            if entry.is_directory:
                await _ensure_directory(backend, _target_path(destination_root, entry.path), created_directories)
                continue
            if entry.encrypted or entry.compression_method not in {0, 8, 12}:
                continue
            target_path = _target_path(destination_root, entry.path)
            parent = target_path.rpartition("/")[0]
            if parent:
                await _ensure_directory(backend, parent, created_directories)
            written = await backend.write_file_from_stream(
                target_path,
                _cancellable_chunks(zip_reader.stream_member(entry.path), is_cancelled),
                overwrite=False,
                source_mtime=entry.modified_at,
            )
            if written != entry.uncompressed_size:
                raise ArchiveFormatError("Archive extraction output size does not match member metadata")
            files_extracted += 1
            extracted_bytes += written
        return ArchiveExtractionResult(files_extracted, len(created_directories), extracted_bytes)
    finally:
        await random_reader.close()


async def _ensure_directory(
    backend: ArchiveExtractionBackend,
    path: str,
    created_directories: set[str],
) -> None:
    if path in created_directories:
        return
    current = ""
    for segment in path.split("/"):
        current = f"{current}/{segment}" if current else segment
        if current in created_directories:
            continue
        try:
            await backend.create_directory(current)
        except FileExistsError:
            info = await backend.get_file_info(current)
            if info.type != FileType.DIRECTORY:
                raise ArchiveFormatError("Archive extraction destination has a file/directory conflict")
        created_directories.add(current)


async def _cancellable_chunks(
    source: AsyncIterator[bytes],
    is_cancelled: Callable[[], Awaitable[bool]] | None,
) -> AsyncIterator[bytes]:
    async for chunk in source:
        if is_cancelled is not None and await is_cancelled():
            raise ArchiveExtractionCancelled("Archive extraction was cancelled")
        yield chunk