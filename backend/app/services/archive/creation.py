"""Same-executor direct ZIP creation without source staging."""

import unicodedata
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, Protocol, cast

from app.models.file import DirectoryListing, FileInfo, FileType
from app.services.archive.zip_reader import ArchiveFormatError
from app.services.archive.zip_writer import PortableZipWriter
from app.storage.base import ExclusiveWriter


class ArchiveCreationSource(Protocol):
    """Enumerate archive inputs and supply bounded source file chunks."""

    async def get_file_info(self, path: str) -> FileInfo: ...

    async def list_directory(self, path: str = "") -> DirectoryListing: ...

    def read_file(self, path: str) -> AsyncIterator[bytes]: ...


class ArchiveCreationDestination(Protocol):
    """Inspect and exclusively open the final archive target."""

    async def get_file_info(self, path: str) -> FileInfo: ...

    async def open_exclusive_writer(self, path: str) -> ExclusiveWriter: ...


class ArchiveCreationBackend(ArchiveCreationSource, ArchiveCreationDestination, Protocol):
    """Compatibility protocol for a same-executor creation binding."""


@dataclass(frozen=True)
class ArchiveCreationResult:
    files_created: int
    source_bytes: int
    directories_created: int = 0


@dataclass(frozen=True)
class ArchiveCreationMemberOutcome:
    """A committed ZIP member result reported by a creation destination."""

    archive_path: str
    status: Literal["directory", "created"]
    source_bytes: int = 0


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


async def build_archive_creation_manifest(
    source: ArchiveCreationSource,
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
        listing = await source.list_directory(source_path)
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
        info = await source.get_file_info(normalized_source)
        await visit(normalized_source, _source_entry_name(normalized_source), info)
    return manifest


async def create_archive_from_files(
    source: ArchiveCreationSource,
    *,
    destination: ArchiveCreationDestination | None = None,
    source_paths: list[str],
    target_path: str,
    is_cancelled: Callable[[], Awaitable[bool]] | None = None,
    on_member_completed: Callable[[ArchiveCreationMemberOutcome], Awaitable[None]] | None = None,
    preflight_entries: list[ArchiveCreationEntry] | None = None,
) -> ArchiveCreationResult:
    """Create a portable ZIP through independent source and destination adapters."""

    if destination is None:
        destination = cast(ArchiveCreationDestination, source)
    try:
        await destination.get_file_info(target_path)
    except FileNotFoundError:
        pass
    else:
        raise ArchiveFormatError("Archive creation target already exists")
    sources = preflight_entries or await build_archive_creation_manifest(source, source_paths, target_path)

    writer_handle = await destination.open_exclusive_writer(target_path)
    archive_writer = PortableZipWriter(writer_handle)
    completed = False
    try:
        for source_entry in sources:
            if source_entry.info.type == FileType.DIRECTORY:
                await archive_writer.add_directory(source_entry.archive_path, source_entry.info.modified_at)
                outcome = ArchiveCreationMemberOutcome(source_entry.archive_path, "directory")
            else:
                await archive_writer.add_file(
                    source_entry.archive_path,
                    _cancellable_chunks(source.read_file(source_entry.source_path), is_cancelled),
                    source_entry.info.modified_at,
                    expected_uncompressed_size=source_entry.info.size,
                )
                outcome = ArchiveCreationMemberOutcome(source_entry.archive_path, "created", source_entry.info.size or 0)
            if on_member_completed is not None:
                await on_member_completed(outcome)
        await archive_writer.close()
        completed = True
        return ArchiveCreationResult(
            files_created=sum(source_entry.info.type == FileType.FILE for source_entry in sources),
            source_bytes=sum(source_entry.info.size or 0 for source_entry in sources if source_entry.info.type == FileType.FILE),
            directories_created=sum(source_entry.info.type == FileType.DIRECTORY for source_entry in sources),
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
