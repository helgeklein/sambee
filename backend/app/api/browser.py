import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlmodel import Session

from app.core.logging import get_logger, set_user
from app.core.security import decrypt_password, get_current_user_with_auth_check
from app.db.database import get_session
from app.models.connection import Connection
from app.models.file import DirectoryListing, DirectorySearchResult, FileInfo, RenameRequest
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
            path_prefix=connection.path_prefix or "/",
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
            path_prefix=connection.path_prefix or "/",
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
            path_prefix=connection.path_prefix or "/",
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
# Upload file
# ============================================================================


class UploadResponse(BaseModel):
    """Response for successful file upload."""

    status: str
    path: str
    size: int
    last_modified: str | None


#
# upload_file
#
@router.post("/{connection_id}/upload", response_model=UploadResponse)
async def upload_file(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Destination path on the share"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> UploadResponse:
    """Upload a file to the SMB share.

    Accepts a multipart file upload and writes it to the specified path,
    overwriting the existing file.  Used by both the companion app (writing
    back edited files) and the web UI (future upload feature).
    """

    set_user(current_user.username)
    logger.info(f"Upload file: connection_id={connection_id}, path='{path}'")

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
            path_prefix=connection.path_prefix or "/",
        )

        await backend.connect()
        bytes_written = await backend.write_file(path, file.file)

        # Re-read metadata after write for the response
        updated_info = await backend.get_file_info(path)
        await backend.disconnect()

        logger.info(f"Upload complete: connection_id={connection_id}, path='{path}', size={bytes_written}")
        return UploadResponse(
            status="ok",
            path=path,
            size=bytes_written,
            last_modified=updated_info.modified_at.isoformat() if updated_info.modified_at else None,
        )
    except IOError as e:
        logger.warning(f"Upload blocked (file locked): connection_id={connection_id}, path='{path}'")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )
    except Exception as e:
        logger.error(
            f"Failed to upload file: connection_id={connection_id}, path='{path}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload file: {e}",
        )


# ============================================================================
# Delete file or empty directory
# ============================================================================


#
# delete_item
#
@router.delete("/{connection_id}/item", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file or directory to delete"),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> None:
    """Delete a file or directory.

    Directories are deleted recursively — all contents are removed first.
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

    if not path or path.strip("/") == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the share root",
        )

    try:
        backend = SMBBackend(
            host=connection.host,
            share_name=connection.share_name,
            username=connection.username,
            password=decrypt_password(connection.password_encrypted),
            port=connection.port,
            path_prefix=connection.path_prefix or "/",
        )

        await backend.connect()
        await backend.delete_item(path)
        await backend.disconnect()

        # Remove from directory cache if it was a directory
        _remove_from_directory_cache(str(connection_id), path)

        logger.info(f"Deleted item: connection_id={connection_id}, path='{path}', user={current_user.username}")

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item not found: {path}",
        )
    except OSError as e:
        logger.error(
            f"Failed to delete item: connection_id={connection_id}, path='{path}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete item: {str(e)}",
        )
    except Exception as e:
        logger.error(
            f"Failed to delete item: connection_id={connection_id}, path='{path}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete item: {str(e)}",
        )


# ============================================================================
# Rename file or directory
# ============================================================================

# Characters forbidden in SMB/NTFS file names
_INVALID_NAME_CHARS = frozenset('\\/:*?"<>|')


#
# rename_item
#
@router.post("/{connection_id}/rename", response_model=FileInfo)
async def rename_item(
    connection_id: uuid.UUID,
    body: RenameRequest,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> FileInfo:
    """Rename a file or directory.

    The item stays in its current parent directory — only the name changes.
    Returns the updated FileInfo for the renamed item.
    """

    set_user(current_user.username)

    # --- Validate new_name ------------------------------------------------
    new_name = body.new_name.strip()
    if not new_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New name must not be empty",
        )
    if new_name in (".", ".."):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New name must not be '.' or '..'",
        )
    if any(ch in _INVALID_NAME_CHARS for ch in new_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New name contains invalid characters",
        )
    if new_name.endswith(" ") or new_name.endswith("."):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New name must not end with a space or period",
        )

    # --- Validate path ----------------------------------------------------
    path = body.path
    if not path or path.strip("/") == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot rename the share root",
        )

    # --- Look up connection -----------------------------------------------
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
            path_prefix=connection.path_prefix or "/",
        )

        await backend.connect()
        await backend.rename_item(path, new_name)

        # Build the new path (same parent, different leaf)
        parent = path.rsplit("/", 1)[0] if "/" in path else ""
        new_path = f"{parent}/{new_name}" if parent else new_name

        # Fetch updated file info for the response
        file_info = await backend.get_file_info(new_path)
        await backend.disconnect()

        # Update directory cache if renamed item was a directory
        _rename_in_directory_cache(str(connection_id), path, new_path)

        logger.info(f"Renamed item: connection_id={connection_id}, '{path}' -> '{new_name}', user={current_user.username}")
        return file_info

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item not found: {path}",
        )
    except FileExistsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except OSError as e:
        logger.error(
            f"Failed to rename item: connection_id={connection_id}, path='{path}', new_name='{new_name}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to rename item: {str(e)}",
        )
    except Exception as e:
        logger.error(
            f"Failed to rename item: connection_id={connection_id}, path='{path}', new_name='{new_name}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to rename item: {str(e)}",
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


#
# _remove_from_directory_cache
#
def _remove_from_directory_cache(connection_id: str, path: str) -> None:
    """Remove a deleted directory from the directory cache, if it exists.

    Silently ignores errors — cache updates must never break the main flow.
    """

    from app.services.directory_cache import get_directory_cache_manager

    try:
        cache_manager = get_directory_cache_manager()
        cache = cache_manager.get_cache(connection_id)
        if cache is None:
            return

        cache.remove_directory(path)
    except Exception:
        pass


#
# _rename_in_directory_cache
#
def _rename_in_directory_cache(connection_id: str, old_path: str, new_path: str) -> None:
    """Update a renamed directory in the directory cache, if it exists.

    Silently ignores errors — cache updates must never break the main flow.
    """

    from app.services.directory_cache import get_directory_cache_manager

    try:
        cache_manager = get_directory_cache_manager()
        cache = cache_manager.get_cache(connection_id)
        if cache is None:
            return

        cache.rename_directory(old_path, new_path)
    except Exception:
        pass
