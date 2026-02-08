import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.core.logging import get_logger, set_user
from app.core.security import decrypt_password, get_current_user_with_auth_check
from app.db.database import get_session
from app.models.connection import Connection
from app.models.file import DirectoryListing, DirectorySearchResult, FileInfo
from app.models.user import User
from app.storage.smb import SMBBackend

router = APIRouter()
logger = get_logger(__name__)


#
# list_directory
#
@router.get("/{connection_id}/list", response_model=DirectoryListing)
async def list_directory(
    connection_id: uuid.UUID,
    path: Optional[str] = Query("", description="Path within the share"),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> DirectoryListing:
    """List contents of a directory"""

    # Set user context for logging
    set_user(current_user.username)

    connection = session.get(Connection, connection_id)
    if not connection:
        logger.warning(f"Connection not found: connection_id={connection_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    if not connection.share_name:
        logger.warning(f"Connection has no share name: connection_id={connection_id}")
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

        # Feed discovered directories into the directory cache (if active)
        _update_directory_cache_from_listing(str(connection_id), listing)

        logger.info(f"Successfully listed directory: connection_id={connection_id}, path='{path}', items={len(listing.items)}")
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


#
# get_file_info
#
@router.get("/{connection_id}/info", response_model=FileInfo)
async def get_file_info(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file or directory"),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> FileInfo:
    """Get information about a specific file or directory"""

    # Set user context for logging
    set_user(current_user.username)

    logger.info(f"Getting file info: connection_id={connection_id}, path='{path}'")

    connection = session.get(Connection, connection_id)
    if not connection:
        logger.warning(f"Connection not found: connection_id={connection_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    if not connection.share_name:
        logger.warning(f"Connection has no share name: connection_id={connection_id}")
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

        logger.info(f"Successfully retrieved file info: connection_id={connection_id}, path='{path}', type={file_info.type}")
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


#
# search_directories
#
@router.get("/{connection_id}/directories", response_model=DirectorySearchResult)
async def search_directories(
    connection_id: uuid.UUID,
    q: str = Query("", description="Search query for directory names"),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> DirectorySearchResult:
    """Search for directories across the entire connection.

    Returns matching directory paths from the in-memory cache.
    If the cache is not yet built, triggers an initial scan and returns
    partial results. The cache_state field indicates indexing status.
    """

    # Set user context for logging
    set_user(current_user.username)

    connection = session.get(Connection, connection_id)
    if not connection:
        logger.warning(f"Connection not found: connection_id={connection_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    if not connection.share_name:
        logger.warning(f"Connection has no share name: connection_id={connection_id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Connection has no share name configured",
        )

    try:
        from app.services.directory_cache import get_directory_cache_manager

        cache_manager = get_directory_cache_manager()
        cache = await cache_manager.get_or_create_cache(
            connection_id=str(connection_id),
            host=connection.host,
            share_name=connection.share_name,
            username=connection.username,
            password=decrypt_password(connection.password_encrypted),
            port=connection.port or 445,
        )

        results, total_matches = cache.search(q) if q else ([], 0)

        return DirectorySearchResult(
            results=results,
            total_matches=total_matches,
            cache_state=cache.state.value,
            directory_count=cache.directory_count,
        )

    except Exception as e:
        logger.error(
            f"Failed to search directories: connection_id={connection_id}, query='{q}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to search directories: {str(e)}",
        )


# ============================================================================
# Helper: feed directory cache from existing operations
# ============================================================================


#
# _update_directory_cache_from_listing
#
def _update_directory_cache_from_listing(connection_id: str, listing: DirectoryListing) -> None:
    """Feed discovered directories from a list_directory call into the cache.

    This implements the plan requirement: "Use any update mechanism we already
    have (watching the currently displayed directory, user presses F5, ...) to
    also update the cache."

    Only updates the cache if it already exists for this connection (i.e.,
    the user has triggered a directory search at least once). Does not create
    a new cache — that's done on first search request.
    """

    from app.models.file import FileType
    from app.services.directory_cache import get_directory_cache_manager

    try:
        cache_manager = get_directory_cache_manager()
        cache = cache_manager.get_cache(connection_id)
        if cache is None:
            return  # No active cache for this connection

        # Extract directory paths from the listing
        dir_paths = [item.path for item in listing.items if item.type == FileType.DIRECTORY]
        if dir_paths:
            cache.add_directories(dir_paths)
    except Exception:
        # Never let cache updates break the main flow
        pass
