import uuid
from typing import Optional

from app.core.logging import get_logger, set_user
from app.core.security import decrypt_password, get_current_user
from app.db.database import get_session
from app.models.connection import Connection
from app.models.file import DirectoryListing, FileInfo
from app.models.user import User
from app.storage.smb import SMBBackend
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

router = APIRouter()
logger = get_logger(__name__)


@router.get("/{connection_id}/list", response_model=DirectoryListing)
async def list_directory(
    connection_id: uuid.UUID,
    path: Optional[str] = Query("", description="Path within the share"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> DirectoryListing:
    """List contents of a directory"""
    # Set user context for logging
    set_user(current_user.username)

    logger.info(
        f"Listing directory: connection_id={connection_id}, path='{path}', user={current_user.username}"
    )

    connection = session.get(Connection, connection_id)
    if not connection:
        logger.warning(
            f"Connection not found: connection_id={connection_id}, user={current_user.username}"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found"
        )

    if not connection.share_name:
        logger.warning(
            f"Connection has no share name: connection_id={connection_id}, user={current_user.username}"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Connection has no share name configured",
        )

    try:
        backend = SMBBackend(
            host=connection.host,
            share_name=connection.share_name,
            username=connection.username,
            password=decrypt_password(connection.password_encrypted),
            port=connection.port,
        )

        await backend.connect()
        listing = await backend.list_directory(path or "")
        await backend.disconnect()

        logger.info(
            f"Successfully listed directory: connection_id={connection_id}, path='{path}', items={len(listing.items)}"
        )
        return listing

    except Exception as e:
        logger.error(
            f"Failed to list directory: connection_id={connection_id}, path='{path}', "
            f"host={connection.host}, share={connection.share_name}, "
            f"error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list directory: {str(e)}",
        )


@router.get("/{connection_id}/info", response_model=FileInfo)
async def get_file_info(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file or directory"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileInfo:
    """Get information about a specific file or directory"""
    # Set user context for logging
    set_user(current_user.username)

    logger.info(
        f"Getting file info: connection_id={connection_id}, path='{path}', user={current_user.username}"
    )

    connection = session.get(Connection, connection_id)
    if not connection:
        logger.warning(
            f"Connection not found: connection_id={connection_id}, user={current_user.username}"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found"
        )

    if not connection.share_name:
        logger.warning(
            f"Connection has no share name: connection_id={connection_id}, user={current_user.username}"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Connection has no share name configured",
        )

    try:
        backend = SMBBackend(
            host=connection.host,
            share_name=connection.share_name,
            username=connection.username,
            password=decrypt_password(connection.password_encrypted),
            port=connection.port,
        )

        await backend.connect()
        file_info = await backend.get_file_info(path)
        await backend.disconnect()

        logger.info(
            f"Successfully retrieved file info: connection_id={connection_id}, path='{path}', type={file_info.type}"
        )
        return file_info

    except Exception as e:
        logger.error(
            f"Failed to get file info: connection_id={connection_id}, path='{path}', "
            f"host={connection.host}, share={connection.share_name}, "
            f"error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get file info: {str(e)}",
        )
