"""Transactional archive-operation lifecycle helpers."""

import json
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.archive_operation import TERMINAL_ARCHIVE_OPERATION_PHASES, ArchiveOperation, ArchiveOperationPhase
from app.services.archive.state_store import ArchiveOperationStateStore, ArchiveStateStore
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


def fail_operation(session: Session, operation: ArchiveOperation, message: str) -> ArchiveOperation:
    """Record an executor failure without masking the original request error."""

    if operation.phase in TERMINAL_ARCHIVE_OPERATION_PHASES:
        return operation
    now = datetime.now(timezone.utc)
    previous_phase = operation.phase
    error_code = "archive_extraction_failed" if operation.kind.value == "extract" else "archive_creation_failed"
    _state_store.compare_and_swap(
        session,
        operation,
        expected_revision=operation.revision,
        changes={
            "phase": ArchiveOperationPhase.FAILED,
            "last_error_json": json.dumps({"code": error_code, "message": message}),
            "updated_at": now,
            "heartbeat_at": now,
        },
    )
    _write_archive_lifecycle_audit(session, operation, previous_phase=previous_phase)
    session.commit()
    session.refresh(operation)
    return operation


def await_operation_decision(session: Session, operation: ArchiveOperation, decision: dict[str, object]) -> ArchiveOperation:
    """Persist a structured conflict/error decision and release the active executor."""

    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not streaming")
    now = datetime.now(timezone.utc)
    previous_phase = operation.phase
    _state_store.compare_and_swap(
        session,
        operation,
        expected_revision=operation.revision,
        changes={
            "phase": ArchiveOperationPhase.AWAITING_USER_DECISION,
            "pending_decision_json": json.dumps(decision),
            "updated_at": now,
            "heartbeat_at": now,
        },
    )
    _write_archive_lifecycle_audit(
        session,
        operation,
        previous_phase=previous_phase,
        decision=str(decision.get("kind", "awaiting_user_decision")),
    )
    session.commit()
    session.refresh(operation)
    return operation


def apply_existing_file_decision(
    session: Session,
    operation: ArchiveOperation,
    action: str,
    member_path: str | None = None,
    target_path: str | None = None,
) -> ArchiveOperation:
    """Store a validated collision choice and return a paused extraction to streaming."""

    if operation.phase != ArchiveOperationPhase.AWAITING_USER_DECISION:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not awaiting a decision")
    try:
        pending = json.loads(operation.pending_decision_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation decision state is invalid") from exc
    if not isinstance(pending, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation decision state is invalid")
    if pending.get("kind") == "member_error":
        return _apply_member_error_decision(session, operation, pending, action, member_path, target_path)
    if pending.get("kind") != "existing_files" or action not in pending.get("allowed_actions", []):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive operation decision is not allowed")
    is_member_action = action in {"skip", "replace", "rename"}
    if is_member_action:
        conflicts = pending.get("conflicts")
        if not isinstance(member_path, str) or not isinstance(conflicts, list):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member decision requires a pending member"
            )
        conflict = next(
            (
                pending_conflict
                for pending_conflict in conflicts
                if isinstance(pending_conflict, dict) and pending_conflict.get("member_path") == member_path
            ),
            None,
        )
        if conflict is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member is not awaiting a collision decision"
            )
        if conflict.get("is_directory") is True and action != "rename":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Archive directory collisions can only be renamed or cancelled",
            )
        try:
            checkpoint = json.loads(operation.checkpoint_json or "{}")
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
        if not isinstance(checkpoint, dict):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        if action == "rename":
            if not _is_safe_relative_target_path(target_path):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive rename target path is invalid")
            rename_targets = checkpoint.setdefault("member_rename_targets", {})
            if not isinstance(rename_targets, dict):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
            rename_targets[member_path] = target_path
        else:
            member_actions = checkpoint.setdefault("member_collision_actions", {})
            if not isinstance(member_actions, dict):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
            member_actions[member_path] = action
        checkpoint_json = json.dumps(checkpoint)
    elif member_path is not None or target_path is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive all-files decision cannot target a member")
    else:
        checkpoint_json = operation.checkpoint_json
    now = datetime.now(timezone.utc)
    previous_phase = operation.phase
    _state_store.compare_and_swap(
        session,
        operation,
        expected_revision=operation.revision,
        changes={
            "checkpoint_json": checkpoint_json,
            "collision_policy": operation.collision_policy if is_member_action else action,
            "pending_decision_json": None,
            "phase": ArchiveOperationPhase.STREAMING,
            "updated_at": now,
            "heartbeat_at": now,
        },
    )
    _write_archive_lifecycle_audit(session, operation, previous_phase=previous_phase, decision=action)
    session.commit()
    session.refresh(operation)
    return operation


def _is_safe_relative_target_path(target_path: object) -> bool:
    if not isinstance(target_path, str) or not target_path or "\x00" in target_path:
        return False
    normalized = target_path.replace("\\", "/")
    return not normalized.startswith("/") and all(part not in {"", ".", ".."} for part in normalized.split("/"))


def _apply_member_error_decision(
    session: Session,
    operation: ArchiveOperation,
    pending: dict[str, object],
    action: str,
    member_path: str | None,
    target_path: str | None,
) -> ArchiveOperation:
    """Resume a failed member only after a retry or explicit ignore decision."""

    pending_member_path = pending.get("member_path")
    allowed_actions = pending.get("allowed_actions")
    if (
        action not in {"retry", "ignore"}
        or not isinstance(allowed_actions, list)
        or action not in allowed_actions
        or member_path != pending_member_path
        or target_path is not None
    ):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member error decision is not allowed")
    try:
        checkpoint = json.loads(operation.checkpoint_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
    if not isinstance(checkpoint, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    if action == "ignore":
        ignored_members = checkpoint.setdefault("ignored_members", [])
        if not isinstance(ignored_members, list) or not all(isinstance(path, str) for path in ignored_members):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        if member_path not in ignored_members:
            ignored_members.append(member_path)
        checkpoint_json = json.dumps(checkpoint)
    elif pending.get("partial_output") is True:
        retry_members = checkpoint.setdefault("retry_members", [])
        if not isinstance(retry_members, list) or not all(isinstance(path, str) for path in retry_members):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        if member_path not in retry_members:
            retry_members.append(member_path)
        checkpoint_json = json.dumps(checkpoint)
    else:
        checkpoint_json = operation.checkpoint_json
    now = datetime.now(timezone.utc)
    previous_phase = operation.phase
    _state_store.compare_and_swap(
        session,
        operation,
        expected_revision=operation.revision,
        changes={
            "checkpoint_json": checkpoint_json,
            "pending_decision_json": None,
            "phase": ArchiveOperationPhase.STREAMING,
            "updated_at": now,
            "heartbeat_at": now,
        },
    )
    _write_archive_lifecycle_audit(session, operation, previous_phase=previous_phase, decision=action)
    session.commit()
    session.refresh(operation)
    return operation
