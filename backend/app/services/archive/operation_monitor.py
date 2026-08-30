"""Expiry monitor for non-resumable archive operations."""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.logging import get_logger
from app.db import database
from app.models.archive_operation import (
    ARCHIVE_OPERATION_HEARTBEAT_TIMEOUT_SECONDS,
    ARCHIVE_OPERATION_ORPHAN_CHECK_INTERVAL_SECONDS,
    TERMINAL_ARCHIVE_OPERATION_PHASES,
    ArchiveOperation,
    ArchiveOperationErrorCode,
)
from app.services.archive.lifecycle_cleanup import archive_operation_cleanup_registry
from app.services.archive.operations import fail_operation

logger = get_logger(__name__)

_archive_operation_monitor_task: asyncio.Task[None] | None = None


def start_archive_operation_monitor() -> None:
    """Start the single background monitor that expires abandoned archive work."""

    global _archive_operation_monitor_task
    if _archive_operation_monitor_task is None or _archive_operation_monitor_task.done():
        _archive_operation_monitor_task = asyncio.create_task(_archive_operation_monitor_loop())


def stop_archive_operation_monitor() -> None:
    """Stop archive-operation expiry during application shutdown."""

    global _archive_operation_monitor_task
    if _archive_operation_monitor_task is not None and not _archive_operation_monitor_task.done():
        _archive_operation_monitor_task.cancel()
    _archive_operation_monitor_task = None


async def _archive_operation_monitor_loop() -> None:
    """Mark foreground archive work interrupted after its executor disappears."""

    while True:
        try:
            await asyncio.sleep(ARCHIVE_OPERATION_ORPHAN_CHECK_INTERVAL_SECONDS)
            expired = await expire_stale_archive_operations_and_cleanup()
            if expired:
                logger.warning("Expired %s abandoned archive operations", expired)
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("Archive operation expiry check failed")


def expire_stale_archive_operations(now: datetime | None = None, session: Session | None = None) -> int:
    """Fail nonterminal operations whose foreground executor stopped heartbeating."""

    current_time = now or datetime.now(timezone.utc)
    cutoff = current_time - timedelta(seconds=ARCHIVE_OPERATION_HEARTBEAT_TIMEOUT_SECONDS)
    if session is not None:
        return len(_expire_stale_archive_operations(session, cutoff=cutoff, current_time=current_time))
    with Session(database.engine) as managed_session:
        return len(_expire_stale_archive_operations(managed_session, cutoff=cutoff, current_time=current_time))


async def expire_stale_archive_operations_and_cleanup(
    now: datetime | None = None,
    session: Session | None = None,
) -> int:
    """Expire durable work, then release matching process-local resources."""

    current_time = now or datetime.now(timezone.utc)
    cutoff = current_time - timedelta(seconds=ARCHIVE_OPERATION_HEARTBEAT_TIMEOUT_SECONDS)
    if session is None:
        with Session(database.engine) as managed_session:
            expired_operation_ids = _expire_stale_archive_operations(managed_session, cutoff=cutoff, current_time=current_time)
    else:
        expired_operation_ids = _expire_stale_archive_operations(session, cutoff=cutoff, current_time=current_time)
    for operation_id in expired_operation_ids:
        await archive_operation_cleanup_registry.cleanup(operation_id)
    return len(expired_operation_ids)


def _expire_stale_archive_operations(session: Session, *, cutoff: datetime, current_time: datetime) -> list[uuid.UUID]:
    candidates = session.exec(select(ArchiveOperation).where(ArchiveOperation.heartbeat_at < cutoff)).all()
    expired = [operation for operation in candidates if operation.phase not in TERMINAL_ARCHIVE_OPERATION_PHASES]
    expired_operation_ids = []
    for operation in expired:
        try:
            fail_operation(
                session,
                operation,
                "Archive work was interrupted before completion",
                error_code=ArchiveOperationErrorCode.TRANSPORT_FAILURE,
            )
        except HTTPException as exc:
            if exc.status_code == status.HTTP_409_CONFLICT and exc.detail == "Archive operation revision is stale":
                continue
            logger.warning("Skipped stale archive operation expiry: operation_id=%s, detail=%s", operation.id, exc.detail)
        else:
            expired_operation_ids.append(operation.id)
    return expired_operation_ids
