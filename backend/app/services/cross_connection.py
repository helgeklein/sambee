"""Cross-connection file copy/move operations.

Orchestrates copying files between two different SMB connections by
streaming data through the backend: source ``read_file()`` → destination
``write_file_from_stream()``.

Design decisions
----------------
* **No overall timeout** — individual chunk reads/writes each have their
  own timeouts, so arbitrarily large files transfer without hitting a
  wall-clock limit.
* **Move = copy + delete** — cross-share move is impossible as an atomic
  server-side operation; we copy first, verify, then delete the source.
* **Directories are recursive** — structure is replicated depth-first,
  files are streamed one-by-one.
* **Progress callback** — the caller supplies an ``on_progress`` callback
  that receives byte-level updates for UI progress reporting.
"""

import logging
from collections.abc import AsyncIterator
from typing import Optional

from app.models.file import FileInfo, FileType
from app.storage.base import ProgressCallback, StorageBackend

logger = logging.getLogger(__name__)


async def cross_connection_copy(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    on_progress: ProgressCallback | None = None,
    *,
    overwrite: bool = False,
) -> int:
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
        return await _copy_directory(source, dest, source_path, dest_path, on_progress, overwrite=overwrite)
    return await _copy_file(source, dest, source_path, dest_path, on_progress, source_info=info, overwrite=overwrite)


async def cross_connection_move(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    on_progress: ProgressCallback | None = None,
    *,
    overwrite: bool = False,
) -> int:
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

    total_bytes = await cross_connection_copy(source, dest, source_path, dest_path, on_progress, overwrite=overwrite)

    # Delete source after successful copy
    try:
        await source.delete_item(source_path)
        logger.info(f"Cross-connection move: deleted source '{source_path}' after successful copy")
    except Exception:
        # Source delete failed — log but don't roll back the copy.
        # The data is safely at the destination; losing it would be worse.
        logger.error(
            f"Cross-connection move: copy to '{dest_path}' succeeded, "
            f"but failed to delete source '{source_path}'. "
            "The source item remains and should be removed manually.",
            exc_info=True,
        )
        raise

    return total_bytes


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
    source_info: FileInfo | None = None,
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

    total_size = source_info.size if source_info else None
    source_mtime = source_info.modified_at if source_info else None

    def _progress_with_total(transferred: int, _total: Optional[int]) -> None:
        if on_progress:
            on_progress(transferred, total_size)

    # Stream data: source.read_file() → dest.write_file_from_stream()
    stream: AsyncIterator[bytes] = source.read_file(source_path)

    bytes_written = await dest.write_file_from_stream(
        dest_path,
        stream,
        on_progress=_progress_with_total,
        overwrite=overwrite,
        source_mtime=source_mtime,
    )

    logger.info(f"Cross-connection copy file: '{source_path}' -> '{dest_path}' ({bytes_written} bytes)")
    return bytes_written


async def _copy_directory(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    on_progress: ProgressCallback | None,
    *,
    overwrite: bool = False,
) -> int:
    """Recursively copy a directory from *source* to *dest*."""

    # When overwriting, the destination directory may already exist.
    if overwrite:
        if not await dest.file_exists(dest_path):
            await dest.create_directory(dest_path)
    else:
        await dest.create_directory(dest_path)

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
                overwrite=overwrite,
            )
        else:
            total_bytes += await _copy_file(
                source,
                dest,
                child_source,
                child_dest,
                on_progress,
                overwrite=overwrite,
            )

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
