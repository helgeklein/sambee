"""Transactional archive-operation lifecycle helpers."""

import json
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.archive_operation import (
    TERMINAL_ARCHIVE_OPERATION_PHASES,
    ArchiveContractVersion,
    ArchiveOperation,
    ArchiveOperationError,
    ArchiveOperationErrorCode,
    ArchiveOperationPhase,
)
from app.services.archive.state_store import ArchiveOperationStateStore, ArchiveStateStore
from app.services.archive.v2_checkpoint import validate_v2_operation_checkpoint
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event

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

_state_store: ArchiveStateStore = ArchiveOperationStateStore()
_CHECKPOINTED_ARCHIVE_OPERATION_PHASES = frozenset(
    {
        ArchiveOperationPhase.STREAMING,
        ArchiveOperationPhase.AWAITING_USER_DECISION,
        ArchiveOperationPhase.VERIFYING,
        ArchiveOperationPhase.COMPLETED,
    }
)


def _validated_checkpoint_for_execution_transition(
    operation: ArchiveOperation,
    additional_changes: dict[str, object] | None,
) -> str:
    """Return the strict checkpoint required before an operation enters or leaves execution."""

    checkpoint_json = (
        additional_changes.get("checkpoint_json", operation.checkpoint_json) if additional_changes else operation.checkpoint_json
    )
    if not isinstance(checkpoint_json, str) or operation.contract_version != ArchiveContractVersion.V2:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    try:
        checkpoint = json.loads(checkpoint_json)
        return json.dumps(validate_v2_operation_checkpoint(operation.kind, checkpoint))
    except (json.JSONDecodeError, HTTPException) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc


def _write_archive_lifecycle_audit(
    session: Session,
    operation: ArchiveOperation,
    *,
    previous_phase: ArchiveOperationPhase | None,
    decision: str | None = None,
) -> None:
    event_name = AuditEventName.ARCHIVE_OPERATION_DECISION if decision is not None else AuditEventName.ARCHIVE_OPERATION_LIFECYCLE
    result = AuditResult.FAILED if operation.phase == ArchiveOperationPhase.FAILED else AuditResult.SUCCEEDED
    write_audit_event(
        session,
        event_name=event_name,
        result=result,
        acting_user_id=operation.user_id,
        correlation_id=str(operation.id),
        details=AuditDetails(
            archive_operation_kind=operation.kind.value,
            archive_phase=operation.phase.value,
            archive_previous_phase=previous_phase.value if previous_phase is not None else None,
            archive_decision=decision,
        ),
    )


def update_operation_phase(
    session: Session,
    operation: ArchiveOperation,
    *,
    expected_phase: ArchiveOperationPhase,
    next_phase: ArchiveOperationPhase,
    additional_changes: dict[str, object] | None = None,
) -> ArchiveOperation:
    """Perform an idempotent, allowed phase transition for one operation."""

    if operation.phase == next_phase:
        return operation
    if operation.phase != expected_phase:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation phase does not match the requested transition")
    if next_phase not in _ALLOWED_TRANSITIONS[operation.phase]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation transition is not allowed")
    now = datetime.now(timezone.utc)
    previous_phase = operation.phase
    changes: dict[str, object] = {"phase": next_phase, "updated_at": now, "heartbeat_at": now}
    if additional_changes is not None:
        changes.update(additional_changes)
    if operation.phase in _CHECKPOINTED_ARCHIVE_OPERATION_PHASES or next_phase in _CHECKPOINTED_ARCHIVE_OPERATION_PHASES:
        changes["checkpoint_json"] = _validated_checkpoint_for_execution_transition(operation, additional_changes)
    _state_store.compare_and_swap(
        session,
        operation,
        expected_revision=operation.revision,
        changes=changes,
    )
    _write_archive_lifecycle_audit(session, operation, previous_phase=previous_phase)
    session.commit()
    session.refresh(operation)
    return operation


def request_operation_cancellation(session: Session, operation: ArchiveOperation) -> ArchiveOperation:
    """Persist a cancellation request without interrupting an active writer."""

    if operation.phase in TERMINAL_ARCHIVE_OPERATION_PHASES:
        return operation
    if not operation.cancellation_requested:
        now = datetime.now(timezone.utc)
        _state_store.compare_and_swap(
            session,
            operation,
            expected_revision=operation.revision,
            changes={"cancellation_requested": True, "updated_at": now, "heartbeat_at": now},
        )
        _write_archive_lifecycle_audit(session, operation, previous_phase=None, decision="cancellation_requested")
        session.commit()
        session.refresh(operation)
    return operation


def heartbeat_operation(session: Session, operation: ArchiveOperation) -> None:
    """Refresh a foreground operation lease while a bounded transfer is making progress."""

    if operation.phase in TERMINAL_ARCHIVE_OPERATION_PHASES:
        return
    now = datetime.now(timezone.utc)
    _state_store.compare_and_swap(
        session,
        operation,
        expected_revision=operation.revision,
        changes={"heartbeat_at": now, "updated_at": now},
    )
    session.commit()


def update_operation_checkpoint(session: Session, operation: ArchiveOperation, checkpoint_json: str) -> ArchiveOperation:
    """Persist a checkpoint through the common revisioned archive state store."""

    now = datetime.now(timezone.utc)
    _state_store.compare_and_swap(
        session,
        operation,
        expected_revision=operation.revision,
        changes={"checkpoint_json": checkpoint_json, "updated_at": now, "heartbeat_at": now},
    )
    session.commit()
    return operation


def fail_operation(
    session: Session,
    operation: ArchiveOperation,
    message: str,
    *,
    error_code: ArchiveOperationErrorCode | None = None,
) -> ArchiveOperation:
    """Record an executor failure without masking the original request error."""

    if operation.phase in TERMINAL_ARCHIVE_OPERATION_PHASES:
        return operation
    changes: dict[str, object] = {
        "phase": ArchiveOperationPhase.FAILED,
        "last_error_json": ArchiveOperationError(
            code=error_code or ArchiveOperationErrorCode.TRANSPORT_FAILURE,
            message=message[:500] or "Archive operation failed",
        ).model_dump_json(),
    }
    if operation.phase in _CHECKPOINTED_ARCHIVE_OPERATION_PHASES:
        changes["checkpoint_json"] = _validated_checkpoint_for_execution_transition(operation, None)
    now = datetime.now(timezone.utc)
    previous_phase = operation.phase
    _state_store.compare_and_swap(
        session,
        operation,
        expected_revision=operation.revision,
        changes={
            **changes,
            "updated_at": now,
            "heartbeat_at": now,
        },
    )
    _write_archive_lifecycle_audit(session, operation, previous_phase=previous_phase)
    session.commit()
    session.refresh(operation)
    return operation
