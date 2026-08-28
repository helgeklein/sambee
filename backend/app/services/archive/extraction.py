"""Same-executor direct ZIP extraction without archive or member staging."""

import unicodedata
from collections.abc import AsyncIterator, Awaitable, Callable, Collection, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol, cast

from app.models.file import FileInfo, FileType
from app.services.archive.zip_reader import ArchiveFormatError, ZipEntry, ZipReader
from app.storage.base import RandomAccessReader


class ArchiveExtractionSource(Protocol):
    """Supply validated archive metadata and random-access ZIP bytes."""

    async def get_file_info(self, path: str) -> FileInfo: ...

    async def open_random_access_reader(self, path: str) -> RandomAccessReader: ...


class ArchiveExtractionDestination(Protocol):
    """Inspect and write direct extraction output paths."""

    async def get_file_info(self, path: str) -> FileInfo: ...

    async def create_directory(self, path: str) -> None: ...

    async def write_file_from_stream(
        self,
        path: str,
        stream: AsyncIterator[bytes],
        *,
        overwrite: bool = False,
        source_mtime: datetime | None = None,
    ) -> int: ...


class ArchiveExtractionBackend(ArchiveExtractionSource, ArchiveExtractionDestination, Protocol):
    """Compatibility protocol for a same-executor extraction binding."""


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
class ArchiveExtractionMemberError(Exception):
    """A direct output failure that can be retried or ignored for one member."""

    member_path: str
    target_path: str
    message: str


@dataclass(frozen=True)
class ArchiveExtractionDestinationResult:
    """One normalized terminal result returned by an extraction destination."""

    member_path: str
    status: Literal["directory", "extracted", "skipped", "ignored"]
    target_path: str
    extracted_bytes: int = 0
    directories_created: int = 0
    replaced: bool = False
    renamed: bool = False


ArchiveExtractionMemberOutcome = ArchiveExtractionDestinationResult


@dataclass
class ArchiveExtractionProgress:
    """Mutable extraction counters that can be loaded from and written to a checkpoint."""

    files_extracted: int = 0
    directories_created: int = 0
    extracted_bytes: int = 0
    files_skipped: int = 0
    files_replaced: int = 0

    @classmethod
    def from_checkpoint(cls, checkpoint: Mapping[str, object]) -> "ArchiveExtractionProgress":
        values: dict[str, int] = {}
        for key in ("files_extracted", "directories_created", "extracted_bytes", "files_skipped", "files_replaced"):
            value = checkpoint.get(key, 0)
            if type(value) is not int or value < 0:
                raise ValueError("Archive extraction checkpoint counters are invalid")
            values[key] = value
        return cls(**values)

    def record(self, result: ArchiveExtractionDestinationResult) -> None:
        self.directories_created += result.directories_created
        self.extracted_bytes += result.extracted_bytes
        if result.status == "extracted":
            self.files_extracted += 1
            self.files_replaced += int(result.replaced)
        elif result.status in {"skipped", "ignored"}:
            self.files_skipped += 1

    def write_to(self, checkpoint: dict[str, object], *, preserve_absent_zero: bool = False) -> None:
        values = {
            "files_extracted": self.files_extracted,
            "directories_created": self.directories_created,
            "extracted_bytes": self.extracted_bytes,
            "files_skipped": self.files_skipped,
            "files_replaced": self.files_replaced,
        }
        for key, value in values.items():
            if not preserve_absent_zero or key in checkpoint or value:
                checkpoint[key] = value


@dataclass(frozen=True)
class ArchiveExtractionConflict:
    member_path: str
    target_path: str
    is_directory: bool = False
    source_size: int | None = None
    source_modified_at: datetime | str | None = None
    target_size: int | None = None
    target_modified_at: datetime | None = None


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


def validate_archive_rename_targets(entries: list[ZipEntry], member_rename_targets: Mapping[str, str] | None) -> dict[str, str]:
    """Validate member output remaps with the same portable rules as extraction."""

    return _validated_rename_targets(entries, member_rename_targets)


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
    source: ArchiveExtractionSource,
    *,
    destination: ArchiveExtractionDestination | None = None,
    archive_path: str,
    destination_root: str,
    existing_file_policy: str | None = None,
    member_collision_actions: Mapping[str, str] | None = None,
    member_rename_targets: Mapping[str, str] | None = None,
    ignored_members: Collection[str] = (),
    completed_members: Collection[str] = (),
    on_member_completed: Callable[[ArchiveExtractionMemberOutcome], Awaitable[None]] | None = None,
    is_cancelled: Callable[[], Awaitable[bool]] | None = None,
) -> ArchiveExtractionResult:
    """Extract safe, readable ZIP members through independent source and destination adapters."""

    if destination is None:
        destination = cast(ArchiveExtractionDestination, source)
    archive_info = await source.get_file_info(archive_path)
    if archive_info.type != FileType.FILE or archive_info.size is None:
        raise ArchiveFormatError("Archive extraction source must be a regular file")
    random_reader = await source.open_random_access_reader(archive_path)
    try:
        zip_reader = ZipReader(random_reader, archive_info.size)
        entries = await zip_reader.entries()
        if any(not entry.is_safe for entry in entries):
            raise ArchiveFormatError("Archive extraction contains an unsafe member path")
        if any(not entry.has_supported_file_type for entry in entries):
            raise ArchiveFormatError("Archive extraction contains a symbolic link or unsupported special member")
        rename_targets = _validated_rename_targets(entries, member_rename_targets)
        conflicts = await _preflight_file_conflicts(
            destination,
            entries,
            destination_root,
            existing_file_policy,
            member_collision_actions,
            rename_targets,
            ignored_members,
            completed_members,
        )
        if conflicts:
            raise ArchiveExtractionConflicts(conflicts)
        created_directories: set[str] = set()
        progress = ArchiveExtractionProgress()
        skipped_members: list[str] = []
        replaced_members: list[str] = []
        renamed_members: list[str] = []
        for entry in entries:
            if is_cancelled is not None and await is_cancelled():
                raise ArchiveExtractionCancelled("Archive extraction was cancelled")
            if entry.path in completed_members:
                continue
            if entry.is_directory:
                target_path = _target_path(destination_root, entry.path, rename_targets)
                directories_before = len(created_directories)
                await _ensure_directory(destination, target_path, created_directories)
                result = ArchiveExtractionDestinationResult(
                    member_path=entry.path,
                    status="directory",
                    target_path=target_path,
                    directories_created=len(created_directories) - directories_before,
                )
                _record_extraction_destination_result(progress, result, skipped_members, replaced_members, renamed_members)
                await _notify_member_completed(on_member_completed, result)
                continue
            if entry.encrypted or entry.compression_method not in {0, 8, 12}:
                continue
            if entry.path in ignored_members:
                result = ArchiveExtractionDestinationResult(
                    entry.path, "ignored", _target_path(destination_root, entry.path, rename_targets)
                )
                _record_extraction_destination_result(progress, result, skipped_members, replaced_members, renamed_members)
                await _notify_member_completed(on_member_completed, result)
                continue
            target_path = _target_path(destination_root, entry.path, rename_targets)
            directories_before = len(created_directories)
            parent = target_path.rpartition("/")[0]
            if parent:
                await _ensure_directory(destination, parent, created_directories)
            overwrite = await _should_overwrite_existing(
                destination,
                entry,
                target_path,
                existing_file_policy,
                member_collision_actions,
            )
            if overwrite is None:
                result = ArchiveExtractionDestinationResult(
                    entry.path,
                    "skipped",
                    target_path,
                    directories_created=len(created_directories) - directories_before,
                )
                _record_extraction_destination_result(progress, result, skipped_members, replaced_members, renamed_members)
                await _notify_member_completed(on_member_completed, result)
                continue
            try:
                written = await destination.write_file_from_stream(
                    target_path,
                    _cancellable_chunks(zip_reader.stream_member(entry.path), is_cancelled),
                    overwrite=overwrite,
                    source_mtime=entry.modified_at,
                )
                if written != entry.uncompressed_size:
                    raise ArchiveFormatError("Archive extraction output size does not match member metadata")
            except ArchiveExtractionCancelled:
                raise
            except ArchiveExtractionConflicts:
                raise
            except Exception as exc:
                raise ArchiveExtractionMemberError(entry.path, target_path, str(exc)) from exc
            result = ArchiveExtractionDestinationResult(
                entry.path,
                "extracted",
                target_path,
                extracted_bytes=written,
                directories_created=len(created_directories) - directories_before,
                replaced=overwrite,
                renamed=_remapped_member_path(entry.path, rename_targets) != entry.path,
            )
            _record_extraction_destination_result(progress, result, skipped_members, replaced_members, renamed_members)
            await _notify_member_completed(on_member_completed, result)
        return ArchiveExtractionResult(
            files_extracted=progress.files_extracted,
            directories_created=progress.directories_created,
            extracted_bytes=progress.extracted_bytes,
            files_skipped=progress.files_skipped,
            files_replaced=progress.files_replaced,
            skipped_members=tuple(skipped_members),
            replaced_members=tuple(replaced_members),
            renamed_members=tuple(renamed_members),
        )
    finally:
        await random_reader.close()


async def _preflight_file_conflicts(
    destination: ArchiveExtractionDestination,
    entries: list[ZipEntry],
    destination_root: str,
    existing_file_policy: str | None,
    member_collision_actions: Mapping[str, str] | None,
    member_rename_targets: Mapping[str, str],
    ignored_members: Collection[str],
    completed_members: Collection[str],
) -> list[ArchiveExtractionConflict]:
    conflicts: list[ArchiveExtractionConflict] = []
    for directory_path in _archive_directory_paths(entries):
        target_path = _target_path(destination_root, directory_path, member_rename_targets)
        try:
            existing = await destination.get_file_info(target_path)
        except FileNotFoundError:
            continue
        if existing.type != FileType.DIRECTORY:
            conflicts.append(ArchiveExtractionConflict(member_path=directory_path, target_path=target_path, is_directory=True))
    for entry in entries:
        if entry.is_directory or entry.encrypted or entry.compression_method not in {0, 8, 12}:
            continue
        if entry.path in ignored_members or entry.path in completed_members:
            continue
        target_path = _target_path(destination_root, entry.path, member_rename_targets)
        try:
            existing = await destination.get_file_info(target_path)
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
            conflicts.append(
                ArchiveExtractionConflict(
                    member_path=entry.path,
                    target_path=target_path,
                    source_size=entry.uncompressed_size,
                    source_modified_at=entry.modified_at,
                    target_size=existing.size,
                    target_modified_at=existing.modified_at,
                )
            )
    return conflicts


async def _notify_member_completed(
    callback: Callable[[ArchiveExtractionMemberOutcome], Awaitable[None]] | None,
    outcome: ArchiveExtractionMemberOutcome,
) -> None:
    if callback is not None:
        await callback(outcome)


def _record_extraction_destination_result(
    progress: ArchiveExtractionProgress,
    result: ArchiveExtractionDestinationResult,
    skipped_members: list[str],
    replaced_members: list[str],
    renamed_members: list[str],
) -> None:
    """Accumulate the common extraction summary from one destination result."""

    progress.record(result)
    if result.status in {"skipped", "ignored"}:
        skipped_members.append(result.member_path)
    if result.replaced:
        replaced_members.append(result.member_path)
    if result.renamed:
        renamed_members.append(result.member_path)


async def _should_overwrite_existing(
    destination: ArchiveExtractionDestination,
    entry: ZipEntry,
    target_path: str,
    existing_file_policy: str | None,
    member_collision_actions: Mapping[str, str] | None,
) -> bool | None:
    try:
        existing = await destination.get_file_info(target_path)
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
    destination: ArchiveExtractionDestination,
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
            await destination.create_directory(current)
        except FileExistsError:
            info = await destination.get_file_info(current)
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
