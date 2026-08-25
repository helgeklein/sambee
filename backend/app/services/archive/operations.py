"""Transactional archive-operation lifecycle helpers."""

import json
from datetime import datetime, timezone

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


def await_operation_decision(session: Session, operation: ArchiveOperation, decision: dict[str, object]) -> ArchiveOperation:
    """Persist a structured conflict/error decision and release the active executor."""

    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not streaming")
    now = datetime.now(timezone.utc)
    operation.phase = ArchiveOperationPhase.AWAITING_USER_DECISION
    operation.pending_decision_json = json.dumps(decision)
    operation.updated_at = now
    operation.heartbeat_at = now
    session.add(operation)
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
    if pending.get("kind") != "existing_files" or action not in pending.get("allowed_actions", []):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive operation decision is not allowed")
    is_member_action = action in {"skip", "replace", "rename"}
    if is_member_action:
        conflicts = pending.get("conflicts")
        if not isinstance(member_path, str) or not isinstance(conflicts, list):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member decision requires a pending member"
            )
        if not any(isinstance(conflict, dict) and conflict.get("member_path") == member_path for conflict in conflicts):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member is not awaiting a collision decision"
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
        operation.checkpoint_json = json.dumps(checkpoint)
    elif member_path is not None or target_path is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive all-files decision cannot target a member")
    now = datetime.now(timezone.utc)
    if not is_member_action:
        operation.collision_policy = action
    operation.pending_decision_json = None
    operation.phase = ArchiveOperationPhase.STREAMING
    operation.updated_at = now
    operation.heartbeat_at = now
    session.add(operation)
    session.commit()
    session.refresh(operation)
    return operation


def _is_safe_relative_target_path(target_path: object) -> bool:
    if not isinstance(target_path, str) or not target_path or "\x00" in target_path:
        return False
    normalized = target_path.replace("\\", "/")
    return not normalized.startswith("/") and all(part not in {"", ".", ".."} for part in normalized.split("/"))
