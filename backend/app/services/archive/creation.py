"""Same-executor direct ZIP creation without source staging."""

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from app.models.file import FileInfo, FileType
from app.services.archive.zip_reader import ArchiveFormatError
from app.services.archive.zip_writer import PortableZipWriter
from app.storage.base import ExclusiveWriter


class ArchiveCreationBackend(Protocol):
    async def get_file_info(self, path: str) -> FileInfo: ...

    def read_file(self, path: str) -> AsyncIterator[bytes]: ...

    async def open_exclusive_writer(self, path: str) -> ExclusiveWriter: ...


@dataclass(frozen=True)
class ArchiveCreationResult:
    files_created: int
    source_bytes: int


class ArchiveCreationCancelled(Exception):
    """Raised when a direct archive operation is cancelled between source chunks."""


def _source_entry_name(path: str) -> str:
    normalized = path.replace("\\", "/").rstrip("/")
    return normalized.rsplit("/", 1)[-1]


async def create_archive_from_files(
    backend: ArchiveCreationBackend,
    *,
    source_paths: list[str],
    target_path: str,
    is_cancelled: Callable[[], Awaitable[bool]] | None = None,
) -> ArchiveCreationResult:
    """Create a portable ZIP directly at *target_path* from regular-file sources."""

    if not source_paths:
        raise ArchiveFormatError("Archive creation requires at least one source file")
    if target_path in source_paths:
        raise ArchiveFormatError("Archive target cannot also be a selected source")

    sources: list[tuple[str, FileInfo]] = []
    for source_path in source_paths:
        info = await backend.get_file_info(source_path)
        if info.type != FileType.FILE:
            raise ArchiveFormatError("Archive creation currently accepts regular files only")
        sources.append((source_path, info))

    writer_handle = await backend.open_exclusive_writer(target_path)
    archive_writer = PortableZipWriter(writer_handle)
    completed = False
    try:
        for source_path, info in sources:
            await archive_writer.add_file(
                _source_entry_name(source_path),
                _cancellable_chunks(backend.read_file(source_path), is_cancelled),
                info.modified_at,
            )
        await archive_writer.close()
        completed = True
        return ArchiveCreationResult(files_created=len(sources), source_bytes=sum(info.size or 0 for _, info in sources))
    finally:
        if not completed:
            await writer_handle.abort_and_delete_if_owned()


async def _cancellable_chunks(
    source: AsyncIterator[bytes],
    is_cancelled: Callable[[], Awaitable[bool]] | None,
) -> AsyncIterator[bytes]:
    async for chunk in source:
        if is_cancelled is not None and await is_cancelled():
            raise ArchiveCreationCancelled("Archive creation was cancelled")
        yield chunk