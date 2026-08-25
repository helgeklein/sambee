"""Same-executor direct ZIP extraction without archive or member staging."""

import unicodedata
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from app.models.file import FileInfo, FileType
from app.services.archive.zip_reader import ArchiveFormatError, ZipEntry, ZipReader
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
    files_skipped: int = 0
    files_replaced: int = 0
    skipped_members: tuple[str, ...] = ()
    replaced_members: tuple[str, ...] = ()
    renamed_members: tuple[str, ...] = ()


class ArchiveExtractionCancelled(Exception):
    """Raised when extraction is cancelled between bounded member chunks."""


@dataclass(frozen=True)
class ArchiveExtractionConflict:
    member_path: str
    target_path: str
    is_directory: bool = False


class ArchiveExtractionConflicts(Exception):
    """Raised before direct writes when regular-file target collisions exist."""

    def __init__(self, conflicts: list[ArchiveExtractionConflict]) -> None:
        self.conflicts = conflicts
        super().__init__("Archive extraction requires a decision for existing destination files")


def _target_path(destination_root: str, member_path: str, member_rename_targets: Mapping[str, str] | None = None) -> str:
    root = destination_root.replace("\\", "/").strip("/")
    output_path = _remapped_member_path(member_path, member_rename_targets)
    return f"{root}/{output_path}" if root else output_path


def _normalized_relative_path(path: str) -> str:
    normalized = path.replace("\\", "/")
    if not normalized or normalized.startswith("/") or "\x00" in normalized:
        raise ArchiveFormatError("Archive extraction rename target must be a safe relative path")
    segments = normalized.split("/")
    if any(segment in {"", ".", ".."} for segment in segments):
        raise ArchiveFormatError("Archive extraction rename target must be a safe relative path")
    return normalized


def _validated_rename_targets(entries: list[ZipEntry], member_rename_targets: Mapping[str, str] | None) -> dict[str, str]:
    if member_rename_targets is None:
        return {}
    file_paths = {entry.path for entry in entries if not entry.is_directory}
    directory_paths = _archive_directory_paths(entries)
    targets: dict[str, str] = {}
    for member_path, target_path in member_rename_targets.items():
        if member_path not in file_paths | directory_paths or not isinstance(target_path, str):
            raise ArchiveFormatError("Archive extraction rename state is invalid")
        targets[member_path] = _normalized_relative_path(target_path)
    output_file_keys: set[str] = set()
    required_directory_keys: set[str] = set()
    for directory_path in directory_paths:
        required_directory_keys.update(_parent_path_keys(_remapped_member_path(directory_path, targets), include_path=True))
    for entry in entries:
        if entry.is_directory:
            continue
        output_path = _remapped_member_path(entry.path, targets)
        output_key = unicodedata.normalize("NFC", output_path).casefold()
        if output_key in output_file_keys:
            raise ArchiveFormatError("Archive extraction output paths collide after normalization")
        output_file_keys.add(output_key)
        required_directory_keys.update(_parent_path_keys(output_path, include_path=False))
    if output_file_keys & required_directory_keys:
        raise ArchiveFormatError("Archive extraction output paths create a file/directory collision")
    return targets


def _archive_directory_paths(entries: list[ZipEntry]) -> set[str]:
    directories = {entry.path for entry in entries if entry.is_directory}
    for entry in entries:
        parts = entry.path.split("/")
        for index in range(1, len(parts)):
            directories.add("/".join(parts[:index]))
    return directories


def _remapped_member_path(member_path: str, member_rename_targets: Mapping[str, str] | None) -> str:
    if not member_rename_targets:
        return member_path
    matching_source = max(
        (source for source in member_rename_targets if member_path == source or member_path.startswith(f"{source}/")),
        key=len,
        default=None,
    )
    if matching_source is None:
        return member_path
    target = member_rename_targets[matching_source]
    suffix = member_path[len(matching_source) :].lstrip("/")
    return f"{target}/{suffix}" if suffix else target


def _parent_path_keys(path: str, *, include_path: bool) -> set[str]:
    """Return portable collision keys for all output-directory ancestors of *path*."""

    parts = path.split("/")
    last_index = len(parts) if include_path else len(parts) - 1
    return {unicodedata.normalize("NFC", "/".join(parts[:index])).casefold() for index in range(1, last_index + 1)}


async def extract_archive_to_new_paths(
    backend: ArchiveExtractionBackend,
    *,
    archive_path: str,
    destination_root: str,
    existing_file_policy: str | None = None,
    member_collision_actions: Mapping[str, str] | None = None,
    member_rename_targets: Mapping[str, str] | None = None,
    is_cancelled: Callable[[], Awaitable[bool]] | None = None,
) -> ArchiveExtractionResult:
    """Extract safe, readable ZIP members without replacing existing files."""

    archive_info = await backend.get_file_info(archive_path)
    if archive_info.type != FileType.FILE or archive_info.size is None:
        raise ArchiveFormatError("Archive extraction source must be a regular file")
    random_reader = await backend.open_random_access_reader(archive_path)
    try:
        zip_reader = ZipReader(random_reader, archive_info.size)
        entries = await zip_reader.entries()
        if any(not entry.is_safe for entry in entries):
            raise ArchiveFormatError("Archive extraction contains an unsafe member path")
        if any(not entry.has_supported_file_type for entry in entries):
            raise ArchiveFormatError("Archive extraction contains a symbolic link or unsupported special member")
        rename_targets = _validated_rename_targets(entries, member_rename_targets)
        conflicts = await _preflight_file_conflicts(
            backend, entries, destination_root, existing_file_policy, member_collision_actions, rename_targets
        )
        if conflicts:
            raise ArchiveExtractionConflicts(conflicts)
        created_directories: set[str] = set()
        files_extracted = 0
        extracted_bytes = 0
        files_skipped = 0
        files_replaced = 0
        skipped_members: list[str] = []
        replaced_members: list[str] = []
        renamed_members: list[str] = []
        for entry in entries:
            if is_cancelled is not None and await is_cancelled():
                raise ArchiveExtractionCancelled("Archive extraction was cancelled")
            if entry.is_directory:
                await _ensure_directory(backend, _target_path(destination_root, entry.path, rename_targets), created_directories)
                continue
            if entry.encrypted or entry.compression_method not in {0, 8, 12}:
                continue
            target_path = _target_path(destination_root, entry.path, rename_targets)
            parent = target_path.rpartition("/")[0]
            if parent:
                await _ensure_directory(backend, parent, created_directories)
            overwrite = await _should_overwrite_existing(backend, entry, target_path, existing_file_policy, member_collision_actions)
            if overwrite is None:
                files_skipped += 1
                skipped_members.append(entry.path)
                continue
            written = await backend.write_file_from_stream(
                target_path,
                _cancellable_chunks(zip_reader.stream_member(entry.path), is_cancelled),
                overwrite=overwrite,
                source_mtime=entry.modified_at,
            )
            if written != entry.uncompressed_size:
                raise ArchiveFormatError("Archive extraction output size does not match member metadata")
            files_extracted += 1
            extracted_bytes += written
            if overwrite:
                files_replaced += 1
                replaced_members.append(entry.path)
            if _remapped_member_path(entry.path, rename_targets) != entry.path:
                renamed_members.append(entry.path)
        return ArchiveExtractionResult(
            files_extracted=files_extracted,
            directories_created=len(created_directories),
            extracted_bytes=extracted_bytes,
            files_skipped=files_skipped,
            files_replaced=files_replaced,
            skipped_members=tuple(skipped_members),
            replaced_members=tuple(replaced_members),
            renamed_members=tuple(renamed_members),
        )
    finally:
        await random_reader.close()


async def _preflight_file_conflicts(
    backend: ArchiveExtractionBackend,
    entries: list[ZipEntry],
    destination_root: str,
    existing_file_policy: str | None,
    member_collision_actions: Mapping[str, str] | None,
    member_rename_targets: Mapping[str, str],
) -> list[ArchiveExtractionConflict]:
    conflicts: list[ArchiveExtractionConflict] = []
    for directory_path in _archive_directory_paths(entries):
        target_path = _target_path(destination_root, directory_path, member_rename_targets)
        try:
            existing = await backend.get_file_info(target_path)
        except FileNotFoundError:
            continue
        if existing.type != FileType.DIRECTORY:
            conflicts.append(ArchiveExtractionConflict(member_path=directory_path, target_path=target_path, is_directory=True))
    for entry in entries:
        if entry.is_directory or entry.encrypted or entry.compression_method not in {0, 8, 12}:
            continue
        target_path = _target_path(destination_root, entry.path, member_rename_targets)
        try:
            existing = await backend.get_file_info(target_path)
        except FileNotFoundError:
            continue
        if existing.type != FileType.FILE:
            raise ArchiveFormatError("Archive extraction destination has a file/directory conflict")
        member_action = member_collision_actions.get(entry.path) if member_collision_actions is not None else None
        if member_action not in {"skip", "replace"} and existing_file_policy not in {
            "skip_all",
            "replace_all",
            "replace_older",
        }:
            conflicts.append(ArchiveExtractionConflict(member_path=entry.path, target_path=target_path))
    return conflicts


async def _should_overwrite_existing(
    backend: ArchiveExtractionBackend,
    entry: ZipEntry,
    target_path: str,
    existing_file_policy: str | None,
    member_collision_actions: Mapping[str, str] | None,
) -> bool | None:
    try:
        existing = await backend.get_file_info(target_path)
    except FileNotFoundError:
        return False
    if existing.type != FileType.FILE:
        raise ArchiveFormatError("Archive extraction destination has a file/directory conflict")
    member_action = member_collision_actions.get(entry.path) if member_collision_actions is not None else None
    if member_action == "skip":
        return None
    if member_action == "replace":
        return True
    if existing_file_policy == "skip_all":
        return None
    if existing_file_policy == "replace_all":
        return True
    if existing_file_policy == "replace_older":
        return _is_strictly_newer(entry.modified_at, existing.modified_at)
    raise ArchiveExtractionConflicts([ArchiveExtractionConflict(member_path=entry.path, target_path=target_path)])


def _is_strictly_newer(member_modified_at: object | None, destination_modified_at: object | None) -> bool | None:
    """Compare only matching datetime kinds; unknown or mixed-zone times are incomparable."""

    if not isinstance(member_modified_at, datetime) or not isinstance(destination_modified_at, datetime):
        return None
    if (member_modified_at.tzinfo is None) != (destination_modified_at.tzinfo is None):
        return None
    try:
        return member_modified_at > destination_modified_at
    except ValueError:
        return None


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
