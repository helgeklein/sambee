"""Same-executor direct ZIP creation without source staging."""

import unicodedata
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from app.models.file import DirectoryListing, FileInfo, FileType
from app.services.archive.zip_reader import ArchiveFormatError
from app.services.archive.zip_writer import PortableZipWriter
from app.storage.base import ExclusiveWriter


class ArchiveCreationBackend(Protocol):
    async def get_file_info(self, path: str) -> FileInfo: ...

    async def list_directory(self, path: str = "") -> DirectoryListing: ...

    def read_file(self, path: str) -> AsyncIterator[bytes]: ...

    async def open_exclusive_writer(self, path: str) -> ExclusiveWriter: ...


@dataclass(frozen=True)
class ArchiveCreationResult:
    files_created: int
    source_bytes: int
    directories_created: int = 0


@dataclass(frozen=True)
class ArchiveCreationEntry:
    source_path: str
    archive_path: str
    info: FileInfo


class ArchiveCreationCancelled(Exception):
    """Raised when a direct archive operation is cancelled between source chunks."""


def _source_entry_name(path: str) -> str:
    normalized = path.replace("\\", "/").rstrip("/")
    return normalized.rsplit("/", 1)[-1]


def _path_key(path: str) -> str:
    return unicodedata.normalize("NFC", path.rstrip("/")).casefold()


def _is_within_directory(path: str, directory: str) -> bool:
    normalized_path = path.replace("\\", "/").strip("/")
    normalized_directory = directory.replace("\\", "/").strip("/")
    return normalized_path.startswith(f"{normalized_directory}/")


async def _build_creation_manifest(
    backend: ArchiveCreationBackend,
    source_paths: list[str],
    target_path: str,
) -> list[ArchiveCreationEntry]:
    if not source_paths:
        raise ArchiveFormatError("Archive creation requires at least one source")
    normalized_target = target_path.replace("\\", "/").strip("/")
    manifest: list[ArchiveCreationEntry] = []
    seen_archive_paths: set[str] = set()

    def add_entry(source_path: str, archive_path: str, info: FileInfo) -> None:
        key = _path_key(archive_path)
        if key in seen_archive_paths:
            raise ArchiveFormatError("Archive creation sources produce duplicate normalized entry names")
        seen_archive_paths.add(key)
        manifest.append(ArchiveCreationEntry(source_path=source_path, archive_path=archive_path, info=info))

    async def visit(source_path: str, archive_path: str, info: FileInfo) -> None:
        if info.type == FileType.FILE:
            add_entry(source_path, archive_path, info)
            return
        if info.type != FileType.DIRECTORY:
            raise ArchiveFormatError("Archive creation supports regular files and directories only")
        if _is_within_directory(normalized_target, source_path):
            raise ArchiveFormatError("Archive target cannot be inside a selected source directory")
        add_entry(source_path, archive_path, info)
        listing = await backend.list_directory(source_path)
        for item in sorted(listing.items, key=lambda candidate: _path_key(candidate.path)):
            item_path = item.path.replace("\\", "/").strip("/")
            child_archive_path = f"{archive_path}/{item.name}"
            await visit(item_path, child_archive_path, item)

    for source_path in source_paths:
        normalized_source = source_path.replace("\\", "/").strip("/")
        if not normalized_source:
            raise ArchiveFormatError("Archive creation source path is invalid")
        if normalized_source == normalized_target:
            raise ArchiveFormatError("Archive target cannot also be a selected source")
        info = await backend.get_file_info(normalized_source)
        await visit(normalized_source, _source_entry_name(normalized_source), info)
    return manifest


async def create_archive_from_files(
    backend: ArchiveCreationBackend,
    *,
    source_paths: list[str],
    target_path: str,
    is_cancelled: Callable[[], Awaitable[bool]] | None = None,
) -> ArchiveCreationResult:
    """Create a portable ZIP directly at *target_path* from a validated source manifest."""

    try:
        await backend.get_file_info(target_path)
    except FileNotFoundError:
        pass
    else:
        raise ArchiveFormatError("Archive creation target already exists")
    sources = await _build_creation_manifest(backend, source_paths, target_path)

    writer_handle = await backend.open_exclusive_writer(target_path)
    archive_writer = PortableZipWriter(writer_handle)
    completed = False
    try:
        for source in sources:
            if source.info.type == FileType.DIRECTORY:
                await archive_writer.add_directory(source.archive_path, source.info.modified_at)
            else:
                await archive_writer.add_file(
                    source.archive_path,
                    _cancellable_chunks(backend.read_file(source.source_path), is_cancelled),
                    source.info.modified_at,
                )
        await archive_writer.close()
        completed = True
        return ArchiveCreationResult(
            files_created=sum(source.info.type == FileType.FILE for source in sources),
            source_bytes=sum(source.info.size or 0 for source in sources if source.info.type == FileType.FILE),
            directories_created=sum(source.info.type == FileType.DIRECTORY for source in sources),
        )
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
