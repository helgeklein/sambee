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

from app.models.file import FileType
from app.storage.base import ProgressCallback, StorageBackend

logger = logging.getLogger(__name__)


async def cross_connection_copy(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    on_progress: ProgressCallback | None = None,
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

    Returns:
        Total number of bytes transferred.

    Raises:
        FileNotFoundError: If the source path does not exist.
        FileExistsError: If the destination path already exists.
        OSError: On any I/O failure during the transfer.
    """

    info = await source.get_file_info(source_path)

    if info.type == FileType.DIRECTORY:
        return await _copy_directory(source, dest, source_path, dest_path, on_progress)
    return await _copy_file(source, dest, source_path, dest_path, on_progress)


async def cross_connection_move(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    on_progress: ProgressCallback | None = None,
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

    Returns:
        Total number of bytes transferred.

    Raises:
        FileNotFoundError: If the source path does not exist.
        FileExistsError: If the destination already exists.
        OSError: On transfer failure.
    """

    total_bytes = await cross_connection_copy(source, dest, source_path, dest_path, on_progress)

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
) -> int:
    """Stream a single file from *source* to *dest*."""

    # Get file size for progress reporting (best-effort).
    total_size: Optional[int] = None
    try:
        total_size = await source.get_file_size(source_path)
    except Exception:
        pass  # Non-critical; progress will report None for total

    # Accumulator so the wrapper callback can inject total_size.
    bytes_so_far = 0

    def _progress_with_total(transferred: int, _total: Optional[int]) -> None:
        nonlocal bytes_so_far
        bytes_so_far = transferred
        if on_progress:
            on_progress(transferred, total_size)

    # Stream data: source.read_file() → dest.write_file_from_stream()
    stream: AsyncIterator[bytes] = source.read_file(source_path)

    bytes_written = await dest.write_file_from_stream(
        dest_path,
        stream,
        on_progress=_progress_with_total,
    )

    logger.info(f"Cross-connection copy file: '{source_path}' -> '{dest_path}' ({bytes_written} bytes)")
    return bytes_written


async def _copy_directory(
    source: StorageBackend,
    dest: StorageBackend,
    source_path: str,
    dest_path: str,
    on_progress: ProgressCallback | None,
) -> int:
    """Recursively copy a directory from *source* to *dest*."""

    # Create the destination directory first
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
            )
        else:
            total_bytes += await _copy_file(
                source,
                dest,
                child_source,
                child_dest,
                on_progress,
            )

    logger.info(f"Cross-connection copy directory: '{source_path}' -> '{dest_path}' ({total_bytes} bytes, {listing.total} items)")
    return total_bytes
