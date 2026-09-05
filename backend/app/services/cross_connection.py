"""Cross-connection file copy/move operations.

Orchestrates copying files between two different SMB connections by
streaming data through the backend: source ``read_file()`` → destination
``write_file_from_stream()``.

Design decisions
----------------
* **No overall timeout** — individual chunk reads/writes each have their
  own timeouts, so arbitrarily large files transfer without hitting a
  wall-clock limit.
* **Move source safety** — a target is committed before a move source is
    considered for deletion; source deletion remains unavailable without an
    identity-guarded primitive.
* **Directories are recursive** — structure is replicated depth-first,
  files are streamed one-by-one.
* **Progress callback** — the caller supplies an ``on_progress`` callback
  that receives byte-level updates for UI progress reporting.
"""

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Optional

from app.models.file import FileInfo, FileType
from app.services.content_transfer import (
    RegularFileSourceSnapshot,
    SourceChangedError,
    SourceDeleteError,
    SourceDeletionOutcomeUnknown,
    TargetCollisionError,
    resolve_regular_file_transfer,
)
from app.services.target_resolution import TargetResolutionDisposition, TargetResolutionPolicy
from app.storage.base import MoveSourceReader, ProgressCallback, StorageBackend

logger = logging.getLogger(__name__)


class DirectoryTransferError(OSError):
    """A recursive directory transfer failed after a known target mutation."""

    def __init__(self, message: str, *, destination_mutated: bool) -> None:
        super().__init__(message)
        self.destination_mutated = destination_mutated


async def cross_connection_copy(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    on_progress: ProgressCallback | None = None,
    before_destination_commit: Callable[[], Awaitable[None]] | None = None,
    *,
    overwrite: bool = False,
    target_resolution_policy: TargetResolutionPolicy | None = None,
) -> tuple[int | None, FileInfo]:
    """Copy a file or directory from one connection to another.

    For files, data is streamed chunk-by-chunk through the backend so
    memory usage stays constant regardless of file size.

    For directories, the tree is walked depth-first.  Each child file
    is streamed individually; directories are created on the destination
    before their contents are copied.

    Args:
        source: The storage backend to read from.
        dest: The storage backend to write to.
        source_path: Relative path on the source share.
        dest_path: Relative path on the destination share
            (full path including the final name).
        on_progress: Optional callback invoked after every chunk write
            with ``(bytes_transferred_so_far, total_bytes_or_none)``.
        overwrite: When ``True``, replace existing destinations.

    Returns:
        Total number of bytes transferred.

    Raises:
        FileNotFoundError: If the source path does not exist.
        FileExistsError: If the destination path already exists
            and *overwrite* is ``False``.
        OSError: On any I/O failure during the transfer.
    """

    info = await source.get_file_info(source_path)

    if info.type == FileType.DIRECTORY:
        if target_resolution_policy is not None:
            try:
                await dest.get_file_info(dest_path)
            except FileNotFoundError:
                pass
            else:
                if target_resolution_policy == TargetResolutionPolicy.SKIP:
                    return None, info
                raise TargetCollisionError(source=info, target=await dest.get_file_info(dest_path))
        return await _copy_directory(source, dest, source_path, dest_path, on_progress, overwrite=overwrite), info

    source_snapshot = RegularFileSourceSnapshot.from_file_info(info)
    if target_resolution_policy is not None:
        resolution = await resolve_regular_file_transfer(
            source=info,
            target_path=dest_path,
            policy=target_resolution_policy,
            observe_target=lambda: dest.get_file_info(dest_path),
            attempt_create=lambda: _copy_file(
                source,
                dest,
                source_path,
                dest_path,
                on_progress,
                before_destination_commit=before_destination_commit,
                source_info=info,
                source_snapshot=source_snapshot,
                overwrite=False,
            ),
            replacement_supported=False,
        )
        if resolution.disposition == TargetResolutionDisposition.SKIP:
            return None, info
        if resolution.disposition == TargetResolutionDisposition.AWAIT_COLLISION:
            raise TargetCollisionError(source=info, target=resolution.target)
        if not isinstance(resolution.mutation_result, int):
            raise RuntimeError("Regular-file transfer committed without reporting bytes written")
        bytes_written = resolution.mutation_result
    else:
        bytes_written = await _copy_file(
            source,
            dest,
            source_path,
            dest_path,
            on_progress,
            before_destination_commit=before_destination_commit,
            source_info=info,
            source_snapshot=source_snapshot,
            overwrite=overwrite,
        )

    current_source = await source.get_file_info(source_path)
    if not source_snapshot.matches(current_source):
        raise SourceChangedError(f"Source changed while copying: {source_path}", destination_mutated=True)
    return bytes_written, info


async def copy_regular_file_to_missing_target(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    source_info: FileInfo,
    on_progress: ProgressCallback | None = None,
) -> int:
    """Copy one already-observed regular source through a staged missing-target commit."""

    source_snapshot = RegularFileSourceSnapshot.from_file_info(source_info)
    bytes_written = await _copy_file(
        source,
        dest,
        source_path,
        dest_path,
        on_progress,
        source_info=source_info,
        source_snapshot=source_snapshot,
    )
    current_source = await source.get_file_info(source_path)
    if not source_snapshot.matches(current_source):
        raise SourceChangedError(f"Source changed while copying: {source_path}", destination_mutated=True)
    return bytes_written


async def cross_connection_move(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    on_progress: ProgressCallback | None = None,
    before_destination_commit: Callable[[], Awaitable[None]] | None = None,
    *,
    overwrite: bool = False,
    target_resolution_policy: TargetResolutionPolicy | None = None,
) -> tuple[int | None, FileInfo]:
    """Move a file or directory across connections (copy + delete).

    Copies the item to the destination first, then deletes the source.
    If the copy succeeds but the delete fails, an error is logged but
    the successfully-copied data is *not* rolled back (safer than data
    loss).

    Args:
        source: The storage backend to read from (and delete after).
        dest: The storage backend to write to.
        source_path: Relative path on the source share.
        dest_path: Relative path on the destination share.
        on_progress: Optional progress callback (see ``cross_connection_copy``).
        overwrite: When ``True``, replace existing destinations.

    Returns:
        Total number of bytes transferred.

    Raises:
        FileNotFoundError: If the source path does not exist.
        FileExistsError: If the destination already exists
            and *overwrite* is ``False``.
        OSError: On transfer failure.
    """

    source_info = await source.get_file_info(source_path)
    if source_info.type == FileType.DIRECTORY:
        await cross_connection_copy(
            source,
            dest,
            source_path,
            dest_path,
            on_progress,
            overwrite=overwrite,
            target_resolution_policy=target_resolution_policy,
        )
        raise SourceDeleteError(
            f"Destination was created but guarded directory deletion is unavailable: {source_path}",
            destination_mutated=True,
        )
    source_snapshot = RegularFileSourceSnapshot.from_file_info(source_info)
    try:
        source_reader = await source.open_move_source_reader(source_path)
    except NotImplementedError as error:
        await cross_connection_copy(
            source,
            dest,
            source_path,
            dest_path,
            on_progress,
            overwrite=overwrite,
            target_resolution_policy=target_resolution_policy,
        )
        raise SourceDeleteError(
            f"Destination was created but guarded source deletion is unavailable: {source_path}",
            destination_mutated=True,
        ) from error

    try:
        if target_resolution_policy is not None:
            resolution = await resolve_regular_file_transfer(
                source=source_info,
                target_path=dest_path,
                policy=target_resolution_policy,
                observe_target=lambda: dest.get_file_info(dest_path),
                attempt_create=lambda: _copy_file(
                    source,
                    dest,
                    source_path,
                    dest_path,
                    on_progress,
                    before_destination_commit=before_destination_commit,
                    source_info=source_info,
                    source_snapshot=source_snapshot,
                    source_reader=source_reader,
                    overwrite=False,
                ),
                replacement_supported=False,
            )
            if resolution.disposition == TargetResolutionDisposition.SKIP:
                return None, source_info
            if resolution.disposition == TargetResolutionDisposition.AWAIT_COLLISION:
                raise TargetCollisionError(source=source_info, target=resolution.target)
            if not isinstance(resolution.mutation_result, int):
                raise RuntimeError("Regular-file move committed without reporting bytes written")
            total_bytes = resolution.mutation_result
        else:
            total_bytes = await _copy_file(
                source,
                dest,
                source_path,
                dest_path,
                on_progress,
                before_destination_commit=before_destination_commit,
                source_info=source_info,
                source_snapshot=source_snapshot,
                source_reader=source_reader,
                overwrite=overwrite,
            )
        try:
            await source_reader.commit_delete()
        except Exception as error:
            raise SourceDeletionOutcomeUnknown(
                f"Guarded source deletion may have completed before its result was observed: {source_path}"
            ) from error
        return total_bytes, source_info
    finally:
        await source_reader.close()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _copy_file(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    on_progress: ProgressCallback | None,
    *,
    before_destination_commit: Callable[[], Awaitable[None]] | None = None,
    source_info: FileInfo | None = None,
    source_snapshot: RegularFileSourceSnapshot | None = None,
    source_reader: MoveSourceReader | None = None,
    overwrite: bool = False,
) -> int:
    """Stream a single file from *source* to *dest*.

    When *source_info* is supplied (e.g. from an earlier ``get_file_info``
    call), its ``size`` and ``modified_at`` fields are reused — avoiding
    extra round-trips to the source share.
    """

    # Reuse source_info when available; fall back to a dedicated call.
    if source_info is None:
        try:
            source_info = await source.get_file_info(source_path)
        except Exception:
            pass  # Non-critical; progress + mtime will degrade gracefully

    if source_snapshot is not None:
        if source_snapshot.stable_id is None:
            raise SourceChangedError(f"Source has no stable identity for transfer: {source_path}")
        current_source = await source.get_file_info(source_path)
        if not source_snapshot.matches(current_source):
            raise SourceChangedError(f"Source changed before reading: {source_path}")

    total_size = source_info.size if source_info else None
    source_mtime = source_info.modified_at if source_info else None

    def _progress_with_total(transferred: int, _total: Optional[int]) -> None:
        if on_progress:
            on_progress(transferred, total_size)

    async def verify_source_before_commit() -> None:
        if source_snapshot is None:
            return
        try:
            current_source = await source.get_file_info(source_path)
        except FileNotFoundError as error:
            raise SourceChangedError(f"Source disappeared before commit: {source_path}") from error
        if not source_snapshot.matches(current_source):
            raise SourceChangedError(f"Source changed before commit: {source_path}")
        if before_destination_commit is not None:
            await before_destination_commit()

    # A fresh reader is created only after target policy has authorized this
    # attempt. The destination owns and discards its private stage on failure.
    if source_reader is None:
        stream: AsyncIterator[bytes] = source.read_file(source_path)
    else:
        stream = _read_retained_move_source(source_reader, total_size)
    bytes_written = await dest.stage_and_commit_new_file_from_stream(
        dest_path,
        stream,
        before_commit=verify_source_before_commit,
        on_progress=_progress_with_total,
        source_mtime=source_mtime,
    )

    logger.info(f"Cross-connection copy file: '{source_path}' -> '{dest_path}' ({bytes_written} bytes)")
    return bytes_written


async def _read_retained_move_source(source_reader: MoveSourceReader, total_size: int | None) -> AsyncIterator[bytes]:
    """Stream a retained source handle so its delete capability stays bound to copied bytes."""

    if total_size is None:
        raise SourceChangedError("Move source has no stable length")
    chunk_size = 1024 * 1024
    offset = 0
    while offset < total_size:
        chunk = await source_reader.read_at(offset, min(chunk_size, total_size - offset))
        if not chunk:
            raise SourceChangedError("Move source ended before its captured length")
        offset += len(chunk)
        yield chunk


async def _copy_directory(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    on_progress: ProgressCallback | None,
    *,
    overwrite: bool = False,
    root: bool = True,
) -> int:
    """Recursively copy a directory from *source* to *dest*."""

    root_created = False
    try:
        # The root is the only directory collision considered by directory
        # policy. Descendant collisions are transfer failures, never merges.
        if overwrite:
            if not await dest.file_exists(dest_path):
                await dest.create_directory(dest_path)
        else:
            await dest.create_directory(dest_path)
            root_created = True

        listing = await source.list_directory(source_path)
        total_bytes = 0

        for item in listing.items:
            child_source = f"{source_path}/{item.name}" if source_path else item.name
            child_dest = f"{dest_path}/{item.name}" if dest_path else item.name

            if item.type == FileType.DIRECTORY:
                total_bytes += await _copy_directory(
                    source,
                    dest,
                    child_source,
                    child_dest,
                    on_progress,
                    overwrite=False,
                    root=False,
                )
            else:
                total_bytes += await _copy_file(
                    source,
                    dest,
                    child_source,
                    child_dest,
                    on_progress,
                    overwrite=False,
                )
    except FileExistsError as error:
        if root and not root_created:
            raise
        raise DirectoryTransferError(
            f"Directory child target already exists while copying '{source_path}'",
            destination_mutated=True,
        ) from error
    except DirectoryTransferError:
        raise
    except Exception as error:
        raise DirectoryTransferError(
            f"Directory copy failed after creating '{dest_path}': {error}",
            destination_mutated=True,
        ) from error

    # Preserve the original directory modification timestamp.
    # Done after children are copied (adding children updates the mtime).
    try:
        dir_info = await source.get_file_info(source_path)
        if dir_info.modified_at:
            await dest.set_file_times(dest_path, dir_info.modified_at)
    except Exception:
        logger.warning(f"Could not preserve modification time for directory '{dest_path}'", exc_info=True)

    logger.info(f"Cross-connection copy directory: '{source_path}' -> '{dest_path}' ({total_bytes} bytes, {listing.total} items)")
    return total_bytes
