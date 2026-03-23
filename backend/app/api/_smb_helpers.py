import asyncio
import logging
from typing import Any

from app.core.security import decrypt_password
from app.models.connection import Connection
from app.storage.smb import SMBBackend

BACKEND_DISCONNECT_TIMEOUT_SECONDS = 5.0


def require_share_name(connection: Connection) -> str:
    """Return a validated share name for SMB backend construction."""

    assert connection.share_name is not None
    return connection.share_name


def build_smb_backend(
    connection: Connection,
    *,
    backend_factory: type[SMBBackend] = SMBBackend,
) -> SMBBackend:
    """Build an SMB backend instance from a persisted connection."""

    return backend_factory(
        host=connection.host,
        share_name=require_share_name(connection),
        username=connection.username,
        password=decrypt_password(connection.password_encrypted),
        port=connection.port,
        path_prefix=connection.path_prefix or "/",
    )


def build_smb_backend_from_details(
    *,
    host: str,
    share_name: str,
    username: str,
    password: str,
    port: int,
    path_prefix: str | None,
    backend_factory: type[SMBBackend] = SMBBackend,
) -> SMBBackend:
    """Build an SMB backend instance from raw connection details."""

    return backend_factory(
        host=host,
        share_name=share_name,
        username=username,
        password=password,
        port=port,
        path_prefix=path_prefix or "/",
    )


async def disconnect_backend_safely(
    backend: SMBBackend,
    *,
    logger: logging.Logger | logging.LoggerAdapter[Any],
    context: str,
) -> None:
    """Disconnect the backend without masking the main request outcome."""

    try:
        await asyncio.wait_for(backend.disconnect(), timeout=BACKEND_DISCONNECT_TIMEOUT_SECONDS)
    except Exception:
        logger.warning("Failed to disconnect backend cleanly after %s", context, exc_info=True)
