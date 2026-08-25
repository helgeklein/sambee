"""Owner-scoped durable archive-operation lifecycle endpoints."""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api._smb_helpers import build_smb_backend, disconnect_backend_safely
from app.core.logging import get_logger, set_user
from app.core.security import get_current_user_with_auth_check
from app.db.database import get_session
from app.models.archive_operation import ArchiveOperation, ArchiveOperationKind, ArchiveOperationPhase, ArchiveOperationPrepare, ArchiveOperationRead, ArchiveOperationTransition
from app.models.user import User
from app.services.archive.creation import ArchiveCreationCancelled, create_archive_from_files
from app.services.archive.operations import fail_operation, request_operation_cancellation, update_operation_phase
from app.services.connection_access import get_accessible_connection_or_404, require_connection_write_access
from app.services.history_common import LOCAL_DRIVE_PREFIX
from app.storage.smb import SMBBackend

router = APIRouter()
logger = get_logger(__name__)


def _verify_operation_connection_scope(
    session: Session,
    current_user: User,
    *,
    connection_id: str,
    requires_write_access: bool,
) -> None:
    """Authorize an operation endpoint without treating local drive IDs as UUIDs."""

    if connection_id.startswith(LOCAL_DRIVE_PREFIX):
        return
    try:
        connection = get_accessible_connection_or_404(session, current_user, uuid.UUID(connection_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive operation connection ID is invalid") from exc
    if requires_write_access:
        require_connection_write_access(current_user, connection, action="write archive output")


def _get_owned_operation_or_404(session: Session, current_user: User, operation_id: uuid.UUID) -> ArchiveOperation:
    operation = session.get(ArchiveOperation, operation_id)
    if operation is None or operation.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Archive operation was not found")
    return operation


@router.post("/operations", response_model=ArchiveOperationRead, status_code=status.HTTP_201_CREATED)
async def prepare_archive_operation(
    payload: ArchiveOperationPrepare,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Persist a validated archive operation before any direct output begins."""

    set_user(current_user.username)
    _verify_operation_connection_scope(session, current_user, connection_id=payload.source_connection_id, requires_write_access=False)
    _verify_operation_connection_scope(session, current_user, connection_id=payload.destination_connection_id, requires_write_access=True)
    operation = ArchiveOperation(user_id=current_user.id, **payload.model_dump())
    session.add(operation)
    session.commit()
    session.refresh(operation)
    return operation


@router.get("/operations/{operation_id}", response_model=ArchiveOperationRead)
async def get_archive_operation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Return one operation only to its initiating user."""

    return _get_owned_operation_or_404(session, current_user, operation_id)


@router.post("/operations/{operation_id}/phase", response_model=ArchiveOperationRead)
async def transition_archive_operation(
    operation_id: uuid.UUID,
    payload: ArchiveOperationTransition,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Advance one operation through an idempotent permitted transition."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    return update_operation_phase(session, operation, expected_phase=payload.expected_phase, next_phase=payload.next_phase)


def _creation_source_paths(operation: ArchiveOperation) -> list[str]:
    try:
        plan = json.loads(operation.plan_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation plan is invalid") from exc
    source_paths = plan.get("source_paths") if isinstance(plan, dict) else None
    if not isinstance(source_paths, list) or not source_paths or not all(isinstance(path, str) and path for path in source_paths):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation plan has no valid source files")
    return source_paths


@router.post("/operations/{operation_id}/execute-create", response_model=ArchiveOperationRead)
async def execute_archive_creation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Create the operation's direct SMB target from its immutable file-source plan."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    if operation.kind != ArchiveOperationKind.CREATE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not a creation operation")
    if operation.source_connection_id != operation.destination_connection_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Mixed archive creation requires the Companion executor")
    if operation.source_connection_id.startswith(LOCAL_DRIVE_PREFIX):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Local archive creation requires the Companion executor")
    source_paths = _creation_source_paths(operation)
    try:
        connection = get_accessible_connection_or_404(session, current_user, uuid.UUID(operation.source_connection_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation connection ID is invalid") from exc
    require_connection_write_access(current_user, connection, action="create archive", path=operation.destination_path)
    if operation.phase == ArchiveOperationPhase.PREPARED:
        update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.PREPARED, next_phase=ArchiveOperationPhase.ACCEPTED)
    if operation.phase != ArchiveOperationPhase.ACCEPTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation operation is not ready to execute")
    update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.STREAMING)

    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()

        async def is_cancelled() -> bool:
            session.refresh(operation)
            return operation.cancellation_requested

        result = await create_archive_from_files(
            backend,
            source_paths=source_paths,
            target_path=operation.destination_path,
            is_cancelled=is_cancelled,
        )
        operation.checkpoint_json = json.dumps({"files_created": result.files_created, "source_bytes": result.source_bytes})
        update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.VERIFYING)
        return update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.VERIFYING, next_phase=ArchiveOperationPhase.COMPLETED)
    except ArchiveCreationCancelled:
        return update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED)
    except HTTPException:
        raise
    except Exception as exc:
        fail_operation(session, operation, str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive creation failed") from exc
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"archive creation operation {operation.id}")


@router.post("/operations/{operation_id}/cancel", response_model=ArchiveOperationRead)
async def cancel_archive_operation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Request cancellation; the executor checks this between bounded chunks."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    return request_operation_cancellation(session, operation)
