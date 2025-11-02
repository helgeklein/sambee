from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session
import uuid
from typing import Optional

from app.core.security import get_current_user, decrypt_password
from app.db.database import get_session
from app.models.user import User
from app.models.connection import Connection
from app.storage.smb import SMBBackend

router = APIRouter()


@router.get("/{connection_id}/file")
async def preview_file(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Stream file contents for preview"""
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
        
        # Get file info for MIME type
        file_info = await backend.get_file_info(path)
        
        if file_info.type != "file":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path is not a file"
            )
        
        # Stream the file
        async def file_streamer():
            try:
                async for chunk in backend.read_file(path):
                    yield chunk
            finally:
                await backend.disconnect()
        
        return StreamingResponse(
            file_streamer(),
            media_type=file_info.mime_type or "application/octet-stream",
            headers={
                "Content-Disposition": f'inline; filename="{file_info.name}"'
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(e)}"
        )


@router.get("/{connection_id}/download")
async def download_file(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Download a file"""
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
        
        # Get file info
        file_info = await backend.get_file_info(path)
        
        if file_info.type != "file":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path is not a file"
            )
        
        # Stream the file
        async def file_streamer():
            try:
                async for chunk in backend.read_file(path):
                    yield chunk
            finally:
                await backend.disconnect()
        
        return StreamingResponse(
            file_streamer(),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{file_info.name}"',
                "Content-Length": str(file_info.size) if file_info.size else None
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to download file: {str(e)}"
        )