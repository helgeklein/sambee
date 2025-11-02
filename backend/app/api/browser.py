from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session
import uuid
from typing import Optional

from app.core.security import get_current_user, decrypt_password
from app.db.database import get_session
from app.models.user import User
from app.models.connection import Connection
from app.models.file import DirectoryListing, FileInfo
from app.storage.smb import SMBBackend

router = APIRouter()


@router.get("/{connection_id}/list", response_model=DirectoryListing)
async def list_directory(
    connection_id: uuid.UUID,
    path: Optional[str] = Query("", description="Path within the share"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """List contents of a directory"""
    connection = session.get(Connection, connection_id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Connection not found"
        )
    
    try:
        backend = SMBBackend(
            host=connection.host,
            share_name=connection.share_name,
            username=connection.username,
            password=decrypt_password(connection.password_encrypted),
            port=connection.port
        )
        
        await backend.connect()
        listing = await backend.list_directory(path)
        await backend.disconnect()
        
        return listing
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list directory: {str(e)}"
        )


@router.get("/{connection_id}/info", response_model=FileInfo)
async def get_file_info(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file or directory"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get information about a specific file or directory"""
    connection = session.get(Connection, connection_id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Connection not found"
        )
    
    try:
        backend = SMBBackend(
            host=connection.host,
            share_name=connection.share_name,
            username=connection.username,
            password=decrypt_password(connection.password_encrypted),
            port=connection.port
        )
        
        await backend.connect()
        file_info = await backend.get_file_info(path)
        await backend.disconnect()
        
        return file_info
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get file info: {str(e)}"
        )