import uuid
from datetime import datetime, timezone
from typing import List

from app.core.security import decrypt_password, encrypt_password, get_current_admin_user
from app.db.database import get_session
from app.models.connection import (
    Connection,
    ConnectionCreate,
    ConnectionRead,
    ConnectionUpdate,
)
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


@router.put("/connections/{connection_id}", response_model=ConnectionRead)
async def update_connection(
    connection_id: uuid.UUID,
    connection_data: ConnectionUpdate,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> Connection:
    """Update an existing connection"""
    connection = session.get(Connection, connection_id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found"
        )

    # Update fields if provided
    update_dict = connection_data.model_dump(exclude_unset=True)

    # Handle password separately (encrypt if provided)
    if "password" in update_dict and update_dict["password"]:
        connection.password_encrypted = encrypt_password(update_dict["password"])
        del update_dict["password"]

    # Test connection if credentials changed
    test_host = update_dict.get("host", connection.host)
    test_share = update_dict.get("share_name", connection.share_name)
    test_username = update_dict.get("username", connection.username)
    test_password = update_dict.get("password")
    test_port = update_dict.get("port", connection.port)

    if any(
        k in update_dict for k in ["host", "share_name", "username", "password", "port"]
    ):
        if not test_share:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Share name is required",
            )

        try:
            # Use new password if provided, otherwise decrypt existing
            password_to_test = (
                test_password
                if test_password
                else decrypt_password(connection.password_encrypted)
            )

            backend = SMBBackend(
                host=test_host,
                share_name=test_share,
                username=test_username,
                password=password_to_test,
                port=test_port,
            )
            await backend.connect()
            await backend.disconnect()
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to connect to SMB share: {str(e)}",
            )

    # Apply updates
    for key, value in update_dict.items():
        setattr(connection, key, value)

    connection.updated_at = datetime.now(timezone.utc)
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
