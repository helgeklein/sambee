"""Transactional archive-operation lifecycle helpers."""

from datetime import datetime, timezone
import json

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.archive_operation import TERMINAL_ARCHIVE_OPERATION_PHASES, ArchiveOperation, ArchiveOperationPhase

_ALLOWED_TRANSITIONS: dict[ArchiveOperationPhase, frozenset[ArchiveOperationPhase]] = {
    ArchiveOperationPhase.PREPARED: frozenset({ArchiveOperationPhase.ACCEPTED, ArchiveOperationPhase.CANCELLED}),
    ArchiveOperationPhase.ACCEPTED: frozenset({ArchiveOperationPhase.STREAMING, ArchiveOperationPhase.CANCELLED}),
    ArchiveOperationPhase.STREAMING: frozenset(
        {
            ArchiveOperationPhase.AWAITING_USER_DECISION,
            ArchiveOperationPhase.VERIFYING,
            ArchiveOperationPhase.CANCELLED,
            ArchiveOperationPhase.FAILED,
        }
    ),
    ArchiveOperationPhase.AWAITING_USER_DECISION: frozenset({ArchiveOperationPhase.STREAMING, ArchiveOperationPhase.CANCELLED}),
    ArchiveOperationPhase.VERIFYING: frozenset(
        {ArchiveOperationPhase.COMPLETED, ArchiveOperationPhase.FAILED, ArchiveOperationPhase.CANCELLED}
    ),
    ArchiveOperationPhase.COMPLETED: frozenset(),
    ArchiveOperationPhase.CANCELLED: frozenset(),
    ArchiveOperationPhase.FAILED: frozenset(),
}


def update_operation_phase(
    session: Session,
    operation: ArchiveOperation,
    *,
    expected_phase: ArchiveOperationPhase,
    next_phase: ArchiveOperationPhase,
) -> ArchiveOperation:
    """Perform an idempotent, allowed phase transition for one operation."""

    if operation.phase == next_phase:
        return operation
    if operation.phase != expected_phase:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation phase does not match the requested transition")
    if next_phase not in _ALLOWED_TRANSITIONS[operation.phase]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation transition is not allowed")
    now = datetime.now(timezone.utc)
    operation.phase = next_phase
    operation.updated_at = now
    operation.heartbeat_at = now
    session.add(operation)
    session.commit()
    session.refresh(operation)
    return operation


def request_operation_cancellation(session: Session, operation: ArchiveOperation) -> ArchiveOperation:
    """Persist a cancellation request without interrupting an active writer."""

    if operation.phase in TERMINAL_ARCHIVE_OPERATION_PHASES:
        return operation
    if not operation.cancellation_requested:
        now = datetime.now(timezone.utc)
        operation.cancellation_requested = True
        operation.updated_at = now
        operation.heartbeat_at = now
        session.add(operation)
        session.commit()
        session.refresh(operation)
    return operation


def fail_operation(session: Session, operation: ArchiveOperation, message: str) -> ArchiveOperation:
    """Record an executor failure without masking the original request error."""

    if operation.phase in TERMINAL_ARCHIVE_OPERATION_PHASES:
        return operation
    now = datetime.now(timezone.utc)
    operation.phase = ArchiveOperationPhase.FAILED
    operation.last_error_json = json.dumps({"code": "archive_creation_failed", "message": message})
    operation.updated_at = now
    operation.heartbeat_at = now
    session.add(operation)
    session.commit()
    session.refresh(operation)
    return operation
