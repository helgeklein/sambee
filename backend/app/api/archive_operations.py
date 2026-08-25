"""Owner-scoped durable archive-operation lifecycle endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.core.logging import set_user
from app.core.security import get_current_user_with_auth_check
from app.db.database import get_session
from app.models.archive_operation import ArchiveOperation, ArchiveOperationPrepare, ArchiveOperationRead
from app.models.user import User
from app.services.archive.operations import request_operation_cancellation
from app.services.connection_access import get_accessible_connection_or_404, require_connection_write_access
from app.services.history_common import LOCAL_DRIVE_PREFIX

router = APIRouter()


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


@router.post("/operations/{operation_id}/cancel", response_model=ArchiveOperationRead)
async def cancel_archive_operation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Request cancellation; the executor checks this between bounded chunks."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    return request_operation_cancellation(session, operation)
