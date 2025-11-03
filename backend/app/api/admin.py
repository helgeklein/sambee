import uuid
from typing import List

from app.core.security import decrypt_password, encrypt_password, get_current_admin_user
from app.db.database import get_session
from app.models.connection import Connection, ConnectionCreate, ConnectionRead
from app.models.user import User
from app.storage.smb import SMBBackend
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

router = APIRouter()


@router.get("/connections", response_model=List[ConnectionRead])
async def list_connections(
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> list[Connection]:
    """List all configured connections"""
    connections = session.exec(select(Connection)).all()
    return list(connections)


@router.post("/connections", response_model=ConnectionRead)
async def create_connection(
    connection_data: ConnectionCreate,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> Connection:
    """Create a new SMB connection"""
    # Test connection before saving
    try:
        backend = SMBBackend(
            host=connection_data.host,
            share_name=connection_data.share_name,
            username=connection_data.username,
            password=connection_data.password,
            port=connection_data.port,
        )
        await backend.connect()
        await backend.disconnect()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to connect to SMB share: {str(e)}",
        )

    # Encrypt password and save connection
    connection = Connection(
        name=connection_data.name,
        type=connection_data.type,
        host=connection_data.host,
        port=connection_data.port,
        share_name=connection_data.share_name,
        username=connection_data.username,
        password_encrypted=encrypt_password(connection_data.password),
        path_prefix=connection_data.path_prefix,
    )

    session.add(connection)
    session.commit()
    session.refresh(connection)

    return connection


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: uuid.UUID,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    """Delete a connection"""
    connection = session.get(Connection, connection_id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found"
        )

    session.delete(connection)
    session.commit()

    return {"message": "Connection deleted successfully"}


@router.post("/connections/{connection_id}/test")
async def test_connection(
    connection_id: uuid.UUID,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    """Test a connection"""
    connection = session.get(Connection, connection_id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found"
        )

    if not connection.share_name:
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
        # Try to list root directory
        listing = await backend.list_directory("")
        await backend.disconnect()

        return {
            "status": "success",
            "message": f"Successfully connected. Found {listing.total} items in root directory.",
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
