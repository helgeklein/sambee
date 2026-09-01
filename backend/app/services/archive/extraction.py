"""Same-executor direct ZIP extraction without archive or member staging."""

import time
import unicodedata
from collections.abc import AsyncIterator, Awaitable, Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol, cast, runtime_checkable

from app.models.file import DirectoryListing, FileInfo, FileType
from app.services.archive.target_write import (
    ResolvedCollisionPolicy,
    TargetWriteDisposition,
    TargetWriteFailure,
    collision_policy_from_action,
    resolve_target_write_attempt,
    resolved_collision_policy,
)
from app.services.archive.telemetry import log_archive_operation_metrics
from app.services.archive.zip_reader import ArchiveFormatError, EffectiveDirectory, ZipEntry, ZipReader
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


@runtime_checkable
class ArchiveExtractionDirectoryInspector(Protocol):
    """Optionally enumerate complete direct children for extraction preflight."""

    async def list_directory(self, path: str = "") -> DirectoryListing: ...


class ArchiveExtractionBackend(ArchiveExtractionSource, ArchiveExtractionDestination, Protocol):
    """Compatibility protocol for a same-executor extraction binding."""


class ArchiveExtractionExecutionPlan(Protocol):
    """Immutable persisted extraction decisions consumed by a direct executor."""

    @property
    def existing_file_policy(self) -> str | None: ...

    def collision_actions(self) -> Mapping[str, str]: ...

    def rename_targets(self) -> Mapping[str, str]: ...

    def ignored_member_paths(self) -> Collection[str]: ...

    def completed_member_paths(self) -> Collection[str]: ...


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
    partial_output: bool = False


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


MAX_LATE_EXISTENCE_RETRIES = 1


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


def _validated_rename_targets(
    entries: Sequence[ZipEntry], directories: Sequence[EffectiveDirectory], member_rename_targets: Mapping[str, str] | None
) -> dict[str, str]:
    if member_rename_targets is None:
        return {}
    file_paths = {entry.path for entry in entries if not entry.is_directory}
    directory_paths = {directory.path for directory in directories}
    targets: dict[str, str] = {}
    for member_path, target_path in member_rename_targets.items():
        if member_path not in file_paths | directory_paths or not isinstance(target_path, str):
            raise ArchiveFormatError("Archive extraction rename state is invalid")
        targets[member_path] = _normalized_relative_path(target_path)
    output_file_paths: set[str] = set()
    output_file_keys: set[str] = set()
    portable_file_groups: dict[str, list[tuple[str, str]]] = {}
    portable_directory_groups: dict[str, list[tuple[str, str]]] = {}
    required_directory_keys: set[str] = set()
    for directory_path in directory_paths:
        output_path = _remapped_member_path(directory_path, targets)
        portable_directory_groups.setdefault(_path_key(output_path), []).append((directory_path, output_path))
        required_directory_keys.update(_parent_path_keys(output_path, include_path=True))
    for entry in entries:
        if entry.is_directory:
            continue
        output_path = _remapped_member_path(entry.path, targets)
        if output_path in output_file_paths:
            raise ArchiveFormatError("Archive extraction output paths collide")
        output_file_paths.add(output_path)
        output_key = _path_key(output_path)
        output_file_keys.add(output_key)
        portable_file_groups.setdefault(output_key, []).append((entry.path, output_path))
        required_directory_keys.update(_parent_path_keys(output_path, include_path=False))
    if output_file_keys & required_directory_keys:
        raise ArchiveFormatError("Archive extraction output paths create a file/directory collision")
    if any(
        len(group) > 1 and any(source_path != output_path for source_path, output_path in group) for group in portable_file_groups.values()
    ):
        raise ArchiveFormatError("Archive extraction output paths collide after normalization")
    if any(
        len(group) > 1 and any(source_path != output_path for source_path, output_path in group)
        for group in portable_directory_groups.values()
    ):
        raise ArchiveFormatError("Archive extraction output directories collide after normalization")
    return targets


def validate_archive_rename_targets(entries: Sequence[ZipEntry], member_rename_targets: Mapping[str, str] | None) -> dict[str, str]:
    """Validate member output remaps with the same portable rules as extraction."""

    directories = tuple(EffectiveDirectory(path, None, path) for path in _archive_directory_paths(entries))
    return _validated_rename_targets(entries, directories, member_rename_targets)


def _archive_directory_paths(entries: Sequence[ZipEntry]) -> set[str]:
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


def _path_key(path: str) -> str:
    return unicodedata.normalize("NFC", path).casefold()


def _is_directly_extractable(entry: ZipEntry) -> bool:
    return not entry.encrypted and entry.compression_method in {0, 8, 12}


def _materialized_directories(
    directories: Sequence[EffectiveDirectory], regular_entries: Sequence[ZipEntry]
) -> tuple[EffectiveDirectory, ...]:
    """Return directories that direct extraction will create or traverse."""

    readable_paths = {entry.path for entry in regular_entries if _is_directly_extractable(entry)}
    return tuple(
        directory
        for directory in directories
        if directory.explicit_entry is not None or any(entry_path.startswith(f"{directory.path}/") for entry_path in readable_paths)
    )


async def extract_archive_to_new_paths(
    source: ArchiveExtractionSource,
    *,
    destination: ArchiveExtractionDestination | None = None,
    archive_path: str,
    destination_root: str,
    execution_plan: ArchiveExtractionExecutionPlan | None = None,
    existing_file_policy: str | None = None,
    member_collision_actions: Mapping[str, str] | None = None,
    member_rename_targets: Mapping[str, str] | None = None,
    ignored_members: Collection[str] = (),
    completed_members: Collection[str] = (),
    on_member_completed: Callable[[ArchiveExtractionMemberOutcome], Awaitable[None]] | None = None,
    is_cancelled: Callable[[], Awaitable[bool]] | None = None,
) -> ArchiveExtractionResult:
    """Extract safe, readable ZIP members through independent source and destination adapters."""

    if execution_plan is not None:
        if (
            existing_file_policy is not None
            or member_collision_actions is not None
            or member_rename_targets is not None
            or ignored_members
            or completed_members
        ):
            raise ValueError("Execution plan cannot be combined with individual extraction decisions")
        existing_file_policy = execution_plan.existing_file_policy
        member_collision_actions = execution_plan.collision_actions()
        member_rename_targets = execution_plan.rename_targets()
        ignored_members = execution_plan.ignored_member_paths()
        completed_members = execution_plan.completed_member_paths()
    if destination is None:
        destination = cast(ArchiveExtractionDestination, source)
    archive_info = await source.get_file_info(archive_path)
    if archive_info.type != FileType.FILE or archive_info.size is None:
        raise ArchiveFormatError("Archive extraction source must be a regular file")
    random_reader = await source.open_random_access_reader(archive_path)
    try:
        zip_reader = ZipReader(random_reader, archive_info.size)
        projection = await zip_reader.effective_entries()
        if projection.has_unsafe_raw_entry:
            raise ArchiveFormatError("Archive extraction contains an unsafe member path")
        if projection.has_unsupported_special_raw_entry:
            raise ArchiveFormatError("Archive extraction contains a symbolic link or unsupported special member")
        entries = projection.entries
        rename_targets = _validated_rename_targets(entries, projection.directories, member_rename_targets)
        materialized_directories = _materialized_directories(projection.directories, projection.regular_entries)
        try:
            typed_existing_file_policy = collision_policy_from_action(existing_file_policy)
            typed_member_collision_actions = {
                member_path: collision_policy_from_action(action) for member_path, action in (member_collision_actions or {}).items()
            }
        except ValueError as exc:
            raise ArchiveFormatError("Archive extraction collision policy is invalid") from exc
        conflicts = await _preflight_file_conflicts(
            destination,
            projection.regular_entries,
            materialized_directories,
            destination_root,
            typed_existing_file_policy,
            typed_member_collision_actions,
            rename_targets,
            ignored_members,
            completed_members,
        )
        if conflicts:
            raise ArchiveExtractionConflicts(conflicts)
        created_directories: set[str] = set()
        directory_sources = {
            _target_path(destination_root, directory.path, rename_targets): directory.source_member_path
            for directory in materialized_directories
        }
        progress = ArchiveExtractionProgress()
        skipped_members: list[str] = []
        replaced_members: list[str] = []
        renamed_members: list[str] = []
        for directory in materialized_directories:
            entry = directory.explicit_entry
            if entry is None:
                continue
            if is_cancelled is not None and await is_cancelled():
                raise ArchiveExtractionCancelled("Archive extraction was cancelled")
            if directory.path in completed_members:
                continue
            target_path = _target_path(destination_root, directory.path, rename_targets)
            directories_before = len(created_directories)
            await _ensure_directory(destination, target_path, created_directories, entry, directory_sources)
            result = ArchiveExtractionDestinationResult(
                member_path=directory.path,
                status="directory",
                target_path=target_path,
                directories_created=len(created_directories) - directories_before,
            )
            _record_extraction_destination_result(progress, result, skipped_members, replaced_members, renamed_members)
            await _notify_member_completed(on_member_completed, result)
        for entry in projection.regular_entries:
            if is_cancelled is not None and await is_cancelled():
                raise ArchiveExtractionCancelled("Archive extraction was cancelled")
            if entry.path in completed_members:
                continue
            if not _is_directly_extractable(entry):
                result = ArchiveExtractionDestinationResult(
                    entry.path,
                    "skipped",
                    _target_path(destination_root, entry.path, rename_targets),
                )
                _record_extraction_destination_result(progress, result, skipped_members, replaced_members, renamed_members)
                await _notify_member_completed(on_member_completed, result)
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
                await _ensure_directory(destination, parent, created_directories, entry, directory_sources)
            try:
                target_write = await resolve_target_write_attempt(
                    target_path=target_path,
                    policy=resolved_collision_policy(entry.path, typed_existing_file_policy, typed_member_collision_actions),
                    source_modified_at=entry.modified_at,
                    observe_target=destination.get_file_info,
                    stream_factory=lambda: _cancellable_chunks(zip_reader.stream_entry(entry), is_cancelled),
                    write_target=lambda path, stream, overwrite, mtime: destination.write_file_from_stream(
                        path, stream, overwrite=overwrite, source_mtime=mtime
                    ),
                )
            except Exception as exc:
                if isinstance(exc, ArchiveExtractionCancelled):
                    raise
                raise ArchiveExtractionMemberError(
                    entry.path,
                    target_path,
                    str(exc),
                    partial_output=isinstance(exc, TargetWriteFailure) and exc.bytes_written > 0,
                ) from exc
            if target_write.disposition == TargetWriteDisposition.SKIP:
                result = ArchiveExtractionDestinationResult(
                    entry.path,
                    "skipped",
                    target_path,
                    directories_created=len(created_directories) - directories_before,
                )
                _record_extraction_destination_result(progress, result, skipped_members, replaced_members, renamed_members)
                await _notify_member_completed(on_member_completed, result)
                continue
            if target_write.disposition == TargetWriteDisposition.AWAIT_COLLISION:
                if target_write.target is None:
                    raise ArchiveExtractionConflicts([_missing_file_conflict(entry, target_path)])
                raise ArchiveExtractionConflicts([_file_conflict(entry, target_path, target_write.target)])
            written = target_write.bytes_written
            if written != entry.uncompressed_size:
                raise ArchiveFormatError("Archive extraction output size does not match member metadata")
            result = ArchiveExtractionDestinationResult(
                entry.path,
                "extracted",
                target_path,
                extracted_bytes=written,
                directories_created=len(created_directories) - directories_before,
                replaced=target_write.replaced,
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
    regular_entries: Sequence[ZipEntry],
    directories: Sequence[EffectiveDirectory],
    destination_root: str,
    existing_file_policy: ResolvedCollisionPolicy,
    member_collision_actions: Mapping[str, ResolvedCollisionPolicy],
    member_rename_targets: Mapping[str, str],
    ignored_members: Collection[str],
    completed_members: Collection[str],
) -> list[ArchiveExtractionConflict]:
    started_at = time.perf_counter()
    file_info_operations = 0
    directory_listing_operations = 0
    conflicts: list[ArchiveExtractionConflict] = []
    targets_by_parent: dict[str, list[tuple[ZipEntry, str]]] = {}
    for entry in regular_entries:
        if not _is_directly_extractable(entry):
            continue
        if entry.path in ignored_members or entry.path in completed_members:
            continue
        target_path = _target_path(destination_root, entry.path, member_rename_targets)
        parent_path = target_path.rpartition("/")[0]
        targets_by_parent.setdefault(parent_path, []).append((entry, target_path))

    directory_sources: dict[str, str] = {}
    for directory in directories:
        target_path = _target_path(destination_root, directory.path, member_rename_targets)
        target_ancestor = ""
        for segment in target_path.split("/"):
            target_ancestor = f"{target_ancestor}/{segment}" if target_ancestor else segment
            directory_sources.setdefault(target_ancestor, directory.source_member_path)

    for parent_path, targets in targets_by_parent.items():
        if not parent_path:
            continue
        target_ancestor = ""
        for segment in parent_path.split("/"):
            target_ancestor = f"{target_ancestor}/{segment}" if target_ancestor else segment
            directory_sources.setdefault(target_ancestor, targets[0][0].path)

    directory_states: dict[str, Literal["directory", "missing", "blocked", "unavailable"]] = {}
    for target_path, directory_path in sorted(directory_sources.items(), key=lambda item: (item[0].count("/"), item[0])):
        parent_path = target_path.rpartition("/")[0]
        if parent_path and directory_states[parent_path] != "directory":
            directory_states[target_path] = "unavailable"
            continue
        try:
            file_info_operations += 1
            existing = await destination.get_file_info(target_path)
        except FileNotFoundError:
            directory_states[target_path] = "missing"
            continue
        if existing.type == FileType.DIRECTORY:
            directory_states[target_path] = "directory"
            continue
        directory_states[target_path] = "blocked"
        conflicts.append(
            ArchiveExtractionConflict(
                member_path=directory_path,
                target_path=target_path,
                is_directory=True,
                target_size=existing.size,
                target_modified_at=existing.modified_at,
            )
        )
    for parent_path, targets in targets_by_parent.items():
        if parent_path not in directory_states:
            try:
                file_info_operations += 1
                parent = await destination.get_file_info(parent_path)
            except FileNotFoundError:
                directory_states[parent_path] = "missing"
            else:
                directory_states[parent_path] = "directory" if parent.type == FileType.DIRECTORY else "blocked"
        if directory_states[parent_path] != "directory":
            if directory_states[parent_path] == "blocked" and parent_path not in directory_sources:
                conflicts.append(
                    ArchiveExtractionConflict(
                        member_path=targets[0][0].path,
                        target_path=parent_path,
                        is_directory=True,
                    )
                )
            continue
        if isinstance(destination, ArchiveExtractionDirectoryInspector):
            directory_listing_operations += 1
            listing = await destination.list_directory(parent_path)
            if listing.total != len(listing.items):
                raise OSError("Archive extraction directory listing is incomplete")
            existing_by_key: dict[str, list[FileInfo]] = {}
            for item in listing.items:
                existing_by_key.setdefault(_path_key(item.name), []).append(item)
            for entry, target_path in targets:
                child_name = target_path.rsplit("/", 1)[-1]
                listed_items = existing_by_key.get(_path_key(child_name))
                if listed_items is not None:
                    listed_item = next((item for item in listed_items if item.name == child_name), None)
                    if listed_item is None:
                        try:
                            file_info_operations += 1
                            listed_item = await destination.get_file_info(target_path)
                        except FileNotFoundError:
                            continue
                    _append_file_conflict_if_required(
                        conflicts, entry, target_path, listed_item, existing_file_policy, member_collision_actions
                    )
            continue
        for entry, target_path in targets:
            try:
                file_info_operations += 1
                existing = await destination.get_file_info(target_path)
            except FileNotFoundError:
                continue
            _append_file_conflict_if_required(conflicts, entry, target_path, existing, existing_file_policy, member_collision_actions)
    log_archive_operation_metrics(
        "extraction_preflight",
        (time.perf_counter() - started_at) * 1000,
        {
            "conflict_count": len(conflicts),
            "directory_listing_operations": directory_listing_operations,
            "file_info_operations": file_info_operations,
            "planned_directory_count": len(directory_sources),
            "planned_file_count": sum(len(targets) for targets in targets_by_parent.values()),
        },
    )
    return conflicts


def _append_file_conflict_if_required(
    conflicts: list[ArchiveExtractionConflict],
    entry: ZipEntry,
    target_path: str,
    existing: FileInfo,
    existing_file_policy: ResolvedCollisionPolicy,
    member_collision_actions: Mapping[str, ResolvedCollisionPolicy],
) -> None:
    if (
        existing.type != FileType.FILE
        or resolved_collision_policy(entry.path, existing_file_policy, member_collision_actions) == ResolvedCollisionPolicy.ASK
    ):
        conflicts.append(_file_conflict(entry, target_path, existing))


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


def _file_conflict(entry: ZipEntry, target_path: str, existing: FileInfo) -> ArchiveExtractionConflict:
    return ArchiveExtractionConflict(
        member_path=entry.path,
        target_path=target_path,
        source_size=entry.uncompressed_size,
        source_modified_at=entry.modified_at,
        target_size=existing.size,
        target_modified_at=existing.modified_at,
    )


def _missing_file_conflict(entry: ZipEntry, target_path: str) -> ArchiveExtractionConflict:
    return ArchiveExtractionConflict(
        member_path=entry.path,
        target_path=target_path,
        source_size=entry.uncompressed_size,
        source_modified_at=entry.modified_at,
    )


async def _ensure_directory(
    destination: ArchiveExtractionDestination,
    path: str,
    created_directories: set[str],
    entry: ZipEntry,
    directory_sources: Mapping[str, str],
) -> None:
    if path in created_directories:
        return
    current = ""
    for segment in path.split("/"):
        current = f"{current}/{segment}" if current else segment
        if current in created_directories:
            continue
        for attempt in range(2):
            try:
                await destination.create_directory(current)
                break
            except FileExistsError as exc:
                try:
                    info = await destination.get_file_info(current)
                except FileNotFoundError:
                    if attempt == 0:
                        continue
                    raise ArchiveExtractionConflicts(
                        [_missing_directory_conflict(entry, _source_directory_member_path(entry, current, directory_sources), current)]
                    ) from exc
                if info.type == FileType.DIRECTORY:
                    break
                raise ArchiveExtractionConflicts(
                    [
                        ArchiveExtractionConflict(
                            member_path=_source_directory_member_path(entry, current, directory_sources),
                            target_path=current,
                            is_directory=True,
                            target_size=info.size,
                            target_modified_at=info.modified_at,
                        )
                    ]
                )
        created_directories.add(current)


def _source_directory_member_path(
    entry: ZipEntry,
    target_path: str,
    directory_sources: Mapping[str, str],
) -> str:
    """Map one materialized output directory back to its archive directory ancestor."""

    return directory_sources.get(target_path, entry.path)


def _missing_directory_conflict(entry: ZipEntry, member_path: str, target_path: str) -> ArchiveExtractionConflict:
    return ArchiveExtractionConflict(
        member_path=member_path,
        target_path=target_path,
        is_directory=True,
    )


async def _cancellable_chunks(
    source: AsyncIterator[bytes],
    is_cancelled: Callable[[], Awaitable[bool]] | None,
) -> AsyncIterator[bytes]:
    async for chunk in source:
        if is_cancelled is not None and await is_cancelled():
            raise ArchiveExtractionCancelled("Archive extraction was cancelled")
        yield chunk
