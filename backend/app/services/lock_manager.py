"""
Lock manager service for heartbeat-based orphan detection.

Runs a periodic background task that checks all active edit locks and
releases any whose companion has stopped sending heartbeats (i.e., the
companion crashed, the network disconnected, or the machine shut down).

The check runs every ORPHAN_CHECK_INTERVAL_SECONDS (default 30s). A lock is
considered orphaned when its last_heartbeat is older than
HEARTBEAT_TIMEOUT_SECONDS (default 120s). Orphaned locks are deleted from the
database and a warning is logged with the lock details.

Started during application lifespan (main.py) and cancelled on shutdown.
"""

import asyncio
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.core.logging import format_audit_fields, get_logger
from app.db.database import engine
from app.models.edit_lock import (
    HEARTBEAT_TIMEOUT_SECONDS,
    ORPHAN_CHECK_INTERVAL_SECONDS,
    EditLock,
)

logger = get_logger(__name__)

_orphan_task: asyncio.Task[None] | None = None


#
# start_lock_monitor
#
def start_lock_monitor() -> None:
    """Start the background task that cleans up orphaned locks.

    Safe to call multiple times — only starts one task.
    """

    global _orphan_task
    if _orphan_task is not None and not _orphan_task.done():
        return

    _orphan_task = asyncio.create_task(_orphan_check_loop())
    logger.info(f"Lock monitor started (check interval: {ORPHAN_CHECK_INTERVAL_SECONDS}s, timeout: {HEARTBEAT_TIMEOUT_SECONDS}s)")


#
# stop_lock_monitor
#
def stop_lock_monitor() -> None:
    """Cancel the background orphan-check task."""

    global _orphan_task
    if _orphan_task is not None and not _orphan_task.done():
        _orphan_task.cancel()
        logger.info("Lock monitor stopped")
    _orphan_task = None


#
# _orphan_check_loop
#
async def _orphan_check_loop() -> None:
    """Periodically scan for and release orphaned locks."""

    while True:
        try:
            await asyncio.sleep(ORPHAN_CHECK_INTERVAL_SECONDS)
            released = _release_orphaned_locks()
            if released > 0:
                logger.info(f"Released orphaned edit locks: {format_audit_fields(released_count=released)}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in lock orphan check: {e}", exc_info=True)
            # Keep running even after errors
            await asyncio.sleep(ORPHAN_CHECK_INTERVAL_SECONDS)


#
# _release_orphaned_locks
#
def _release_orphaned_locks() -> int:
    """Find and delete all locks whose heartbeat has expired.

    Returns the number of locks released.
    """

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS)

    with Session(engine) as session:
        statement = select(EditLock).where(EditLock.last_heartbeat < cutoff)
        orphaned = session.exec(statement).all()

        for lock in orphaned:
            logger.warning(
                f"Releasing orphaned lock: {format_audit_fields(connection_id=lock.connection_id, path=lock.file_path, lock_id=lock.id, operation_id=lock.operation_id, locked_by=lock.locked_by, last_heartbeat=lock.last_heartbeat.isoformat())}"
            )
            session.delete(lock)

        if orphaned:
            session.commit()

        return len(orphaned)
