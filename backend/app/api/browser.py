import asyncio
import uuid
from pathlib import PurePosixPath
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlmodel import Session

from app.core.logging import get_logger, set_user
from app.core.security import decrypt_password, get_current_user_with_auth_check
from app.db.database import get_session
from app.models.connection import Connection
from app.models.file import (
    ConflictInfo,
    CopyMoveRequest,
    CreateItemRequest,
    DirectoryListing,
    DirectorySearchResult,
    FileInfo,
    FileType,
    RenameRequest,
)
from app.models.user import User
from app.services.connection_access import get_accessible_connection_or_404
from app.services.cross_connection import cross_connection_copy, cross_connection_move
from app.storage.smb import SMBBackend

router = APIRouter()
logger = get_logger(__name__)


def _require_share_name(connection: Connection) -> str:
    """Return a validated share name for typed SMB backend construction."""

    assert connection.share_name is not None
    return connection.share_name


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

    connection = _get_connection_or_404(session, current_user, connection_id)

    try:
        backend = SMBBackend(
            host=connection.host,
            share_name=_require_share_name(connection),
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

    connection = _get_connection_or_404(session, current_user, connection_id)

    try:
        backend = SMBBackend(
            host=connection.host,
            share_name=_require_share_name(connection),
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

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Path not found: {path}",
        )
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
    include_dot_directories: bool = Query(False, description="Whether to include directories whose path contains dot-prefixed segments"),
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

    connection = _get_connection_or_404(session, current_user, connection_id)

    try:
        from app.services.directory_cache import get_directory_cache_manager

        cache_manager = get_directory_cache_manager()
        cache = await cache_manager.get_or_create_cache(
            connection_id=str(connection_id),
            host=connection.host,
            share_name=_require_share_name(connection),
            username=connection.username,
            password=decrypt_password(connection.password_encrypted),
            port=connection.port or 445,
            path_prefix=connection.path_prefix or "/",
        )

        results, total_matches = cache.search(q, include_dot_directories=include_dot_directories) if q else ([], 0)

        return DirectorySearchResult(
            results=results,
            total_matches=total_matches,
            cache_state=cache.state.value,
            directory_count=cache.directory_count,
        )

    except Exception as e:
        logger.error(
            f"Failed to search directories: connection_id={connection_id}, query='{q}', include_dot_directories={include_dot_directories}, error={type(e).__name__}: {e}",
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

    connection = _get_connection_or_404(session, current_user, connection_id)

    try:
        backend = SMBBackend(
            host=connection.host,
            share_name=_require_share_name(connection),
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

    connection = _get_connection_or_404(session, current_user, connection_id)

    if not path or path.strip("/") == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the share root",
        )

    try:
        # Stop any active directory monitor for this path (and its
        # children) before deleting.  The monitor holds a persistent
        # SMB directory handle; if it's still open when rmdir runs,
        # the server can only mark the directory as "delete pending"
        # instead of removing it immediately.
        _stop_monitors_for_path(str(connection_id), path)

        backend = SMBBackend(
            host=connection.host,
            share_name=_require_share_name(connection),
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


def _validate_item_name(raw_name: str) -> str:
    """Validate and return stripped item name, or raise HTTPException.

    Checks for empty names, reserved names (`.`, `..`), invalid NTFS
    characters, and trailing spaces/periods.

    Args:
        raw_name: The raw name string to validate.

    Returns:
        The stripped, validated name.

    Raises:
        HTTPException: 400 if the name is invalid.
    """

    name = raw_name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name must not be empty",
        )
    if name in (".", ".."):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name must not be '.' or '..'",
        )
    if any(ch in _INVALID_NAME_CHARS for ch in name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name contains invalid characters",
        )
    if name.endswith(" ") or name.endswith("."):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name must not end with a space or period",
        )
    return name


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
    new_name = _validate_item_name(body.new_name)

    # --- Validate path ----------------------------------------------------
    path = body.path
    if not path or path.strip("/") == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot rename the share root",
        )

    # --- Look up connection -----------------------------------------------
    connection = _get_connection_or_404(session, current_user, connection_id)

    try:
        backend = SMBBackend(
            host=connection.host,
            share_name=_require_share_name(connection),
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
# Create new file or directory
# ============================================================================


#
# create_item
#
@router.post("/{connection_id}/create", response_model=FileInfo)
async def create_item(
    connection_id: uuid.UUID,
    body: CreateItemRequest,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> FileInfo:
    """Create a new file or directory.

    Creates the item inside the specified parent directory.
    Returns the FileInfo for the newly created item.
    """

    set_user(current_user.username)

    # --- Validate name ----------------------------------------------------
    name = _validate_item_name(body.name)

    # --- Build the full path for the new item -----------------------------
    parent_path = body.parent_path.strip("/") if body.parent_path else ""
    new_item_path = f"{parent_path}/{name}" if parent_path else name

    # --- Look up connection -----------------------------------------------
    connection = _get_connection_or_404(session, current_user, connection_id)

    try:
        backend = SMBBackend(
            host=connection.host,
            share_name=_require_share_name(connection),
            username=connection.username,
            password=decrypt_password(connection.password_encrypted),
            port=connection.port,
            path_prefix=connection.path_prefix or "/",
        )

        await backend.connect()

        if body.type == FileType.DIRECTORY:
            await backend.create_directory(new_item_path)
        else:
            await backend.create_file(new_item_path)

        # Fetch file info for the response
        file_info = await backend.get_file_info(new_item_path)
        await backend.disconnect()

        # Update directory cache if a new directory was created
        if body.type == FileType.DIRECTORY:
            _add_to_directory_cache(str(connection_id), new_item_path)

        logger.info(f"Created {body.type}: connection_id={connection_id}, path='{new_item_path}', user={current_user.username}")
        return file_info

    except FileExistsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except OSError as e:
        logger.error(
            f"Failed to create item: connection_id={connection_id}, path='{new_item_path}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create item: {str(e)}",
        )
    except Exception as e:
        logger.error(
            f"Failed to create item: connection_id={connection_id}, path='{new_item_path}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create item: {str(e)}",
        )


# ============================================================================
# Copy file or directory
# ============================================================================


def _build_backend(connection: Connection) -> SMBBackend:
    """Create an SMBBackend instance from a Connection model.

    Assumes connection.share_name has already been validated
    (e.g. by _get_connection_or_404).
    """
    return SMBBackend(
        host=connection.host,
        share_name=_require_share_name(connection),
        username=connection.username,
        password=decrypt_password(connection.password_encrypted),
        port=connection.port,
        path_prefix=connection.path_prefix or "/",
    )


def _validate_copy_move_paths(source_path: str, dest_path: str) -> tuple[str, str]:
    """Validate and normalize source and dest paths for copy/move.

    Raises HTTPException on invalid input. Returns (source, dest) with
    leading/trailing slashes stripped.
    """

    source = source_path.strip("/") if source_path else ""
    dest = dest_path.strip("/") if dest_path else ""

    if not source:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source path must not be empty",
        )
    if not dest:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Destination path must not be empty",
        )
    if source == dest:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source and destination paths must be different",
        )
    # Prevent copying/moving a directory into itself
    if dest.startswith(source + "/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot copy or move a directory into itself",
        )
    return source, dest


async def _conflict_response(
    connection: Connection,
    body: CopyMoveRequest,
    connection_id: uuid.UUID,
    source: str,
    dest: str,
    current_user: User,
    session: Session,
) -> HTTPException:
    """Build a 409 response with ``ConflictInfo`` for overwrite prompts.

    Fetches metadata for both the existing destination and the incoming
    source so the frontend can display a meaningful comparison dialog.
    Falls back to a plain 409 if metadata retrieval fails.
    """

    try:
        # Determine which backend to use for each path
        source_backend = _build_backend(connection)
        await source_backend.connect()

        is_cross = bool(body.dest_connection_id and str(body.dest_connection_id) != str(connection_id))
        if is_cross:
            dest_connection = _get_connection_or_404(session, current_user, uuid.UUID(str(body.dest_connection_id)))
            dest_backend = _build_backend(dest_connection)
            await dest_backend.connect()
        else:
            dest_backend = source_backend

        try:
            source_info = await source_backend.get_file_info(source)
            existing_info = await dest_backend.get_file_info(dest)

            conflict = ConflictInfo(
                existing_file=existing_info,
                incoming_file=source_info,
            )

            return HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=conflict.model_dump(mode="json"),
            )
        finally:
            await source_backend.disconnect()
            if is_cross:
                await dest_backend.disconnect()

    except Exception as info_err:
        # If we can't fetch metadata, fall back to a plain 409
        logger.warning(f"Could not fetch conflict metadata: {info_err}")
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Destination already exists: {dest}",
        )


def _get_connection_or_404(session: Session, current_user: User, connection_id: uuid.UUID) -> Connection:
    """Look up a connection by ID, raising 404 if not found or misconfigured."""

    connection = get_accessible_connection_or_404(session, current_user, connection_id)

    if not connection.share_name:
        logger.warning(f"Connection has no share name: connection_id={connection_id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Connection has no share name configured",
        )
    return connection


#
# copy_item
#
@router.post("/{connection_id}/copy", status_code=status.HTTP_204_NO_CONTENT)
async def copy_item(
    connection_id: uuid.UUID,
    body: CopyMoveRequest,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> None:
    """Copy a file or directory.

    Copies the source item to the destination path.  When
    ``dest_connection_id`` differs from the source connection, a
    cross-connection copy is performed by streaming data through the
    backend.  Byte-level progress is broadcast over WebSocket as
    ``transfer_progress`` events.

    When ``overwrite`` is ``True``, the destination is replaced if it
    exists.  Otherwise a 409 response is returned with ``ConflictInfo``
    containing metadata for both the existing and incoming items.
    """

    set_user(current_user.username)

    source, dest = _validate_copy_move_paths(body.source_path, body.dest_path)

    is_cross_connection = bool(body.dest_connection_id and str(body.dest_connection_id) != str(connection_id))

    connection = _get_connection_or_404(session, current_user, connection_id)

    try:
        if is_cross_connection:
            dest_connection = _get_connection_or_404(
                session,
                current_user,
                uuid.UUID(str(body.dest_connection_id)),
            )
            await _cross_connection_copy(
                connection,
                dest_connection,
                source,
                dest,
                str(connection_id),
                str(body.dest_connection_id),
                overwrite=body.overwrite,
            )
        else:
            backend = _build_backend(connection)
            await backend.connect()
            await backend.copy_item(source, dest, overwrite=body.overwrite)
            await backend.disconnect()

            # If a directory was copied, add it to the cache
            _add_to_directory_cache(str(connection_id), dest)

        logger.info(f"Copied item: connection_id={connection_id}, '{source}' -> '{dest}', user={current_user.username}")

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source not found: {source}",
        )
    except FileExistsError:
        raise await _conflict_response(connection, body, connection_id, source, dest, current_user, session)
    except HTTPException:
        raise
    except OSError as e:
        logger.error(
            f"Failed to copy item: connection_id={connection_id}, '{source}' -> '{dest}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to copy item: {str(e)}",
        )
    except Exception as e:
        logger.error(
            f"Failed to copy item: connection_id={connection_id}, '{source}' -> '{dest}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to copy item: {str(e)}",
        )


# ============================================================================
# Move file or directory
# ============================================================================


#
# move_item
#
@router.post("/{connection_id}/move", status_code=status.HTTP_204_NO_CONTENT)
async def move_item(
    connection_id: uuid.UUID,
    body: CopyMoveRequest,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> None:
    """Move (rename across directories) a file or directory.

    Moves the source item to the destination path.  When
    ``dest_connection_id`` differs from the source connection, a
    cross-connection move is performed (copy + delete source).
    Byte-level progress is broadcast over WebSocket as
    ``transfer_progress`` events.

    When ``overwrite`` is ``True``, the destination is replaced if it
    exists.  Otherwise a 409 response is returned with ``ConflictInfo``
    containing metadata for both the existing and incoming items.
    """

    set_user(current_user.username)

    source, dest = _validate_copy_move_paths(body.source_path, body.dest_path)

    is_cross_connection = bool(body.dest_connection_id and str(body.dest_connection_id) != str(connection_id))

    connection = _get_connection_or_404(session, current_user, connection_id)

    try:
        if is_cross_connection:
            dest_connection = _get_connection_or_404(
                session,
                current_user,
                uuid.UUID(str(body.dest_connection_id)),
            )
            await _cross_connection_move(
                connection,
                dest_connection,
                source,
                dest,
                str(connection_id),
                str(body.dest_connection_id),
                overwrite=body.overwrite,
            )
        else:
            backend = _build_backend(connection)
            await backend.connect()
            await backend.move_item(source, dest, overwrite=body.overwrite)
            await backend.disconnect()

            # Update directory cache: remove old path, add new path
            _remove_from_directory_cache(str(connection_id), source)
            _add_to_directory_cache(str(connection_id), dest)

        logger.info(f"Moved item: connection_id={connection_id}, '{source}' -> '{dest}', user={current_user.username}")

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source not found: {source}",
        )
    except FileExistsError:
        raise await _conflict_response(connection, body, connection_id, source, dest, current_user, session)
    except HTTPException:
        raise
    except OSError as e:
        logger.error(
            f"Failed to move item: connection_id={connection_id}, '{source}' -> '{dest}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to move item: {str(e)}",
        )
    except Exception as e:
        logger.error(
            f"Failed to move item: connection_id={connection_id}, '{source}' -> '{dest}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to move item: {str(e)}",
        )


# ============================================================================
# Cross-connection copy/move helpers
# ============================================================================


async def _cross_connection_copy(
    src_conn: Connection,
    dst_conn: Connection,
    source_path: str,
    dest_path: str,
    src_conn_id: str,
    dst_conn_id: str,
    *,
    overwrite: bool = False,
) -> None:
    """Perform a cross-connection copy with WebSocket progress reporting.

    Builds two separate SMB backends, streams data from source to
    destination, and broadcasts byte-level progress via WebSocket.
    """

    from app.api.websocket import notify_transfer_progress

    source_backend = _build_backend(src_conn)
    dest_backend = _build_backend(dst_conn)

    await source_backend.connect()
    await dest_backend.connect()

    # Determine the destination parent directory for progress events.
    dest_parent = str(PurePosixPath(dest_path).parent)
    if dest_parent == ".":
        dest_parent = ""
    # Item name for progress display
    item_name = PurePosixPath(dest_path).name

    # Throttle progress broadcasts to avoid flooding the WebSocket
    # (~4 updates/s is plenty for a smooth progress bar).
    _last_broadcast: list[float] = [0.0]
    _min_broadcast_interval_s: float = 0.25

    def on_progress(bytes_transferred: int, total_bytes: int | None) -> None:
        """Schedule a WS broadcast (non-blocking from sync context)."""
        import time

        now = time.monotonic()
        if now - _last_broadcast[0] < _min_broadcast_interval_s:
            return
        _last_broadcast[0] = now

        try:
            loop = asyncio.get_event_loop()
            loop.create_task(
                notify_transfer_progress(
                    dst_conn_id,
                    dest_parent,
                    bytes_transferred,
                    total_bytes,
                    item_name,
                )
            )
        except RuntimeError:
            pass  # No running event loop — skip this broadcast

    try:
        await cross_connection_copy(
            source_backend,
            dest_backend,
            source_path,
            dest_path,
            on_progress=on_progress,
            overwrite=overwrite,
        )
        # Send a final 100 % broadcast
        try:
            await notify_transfer_progress(
                dst_conn_id,
                dest_parent,
                -1,
                -1,
                item_name,
            )
        except Exception:
            pass

        # Update directory cache for the destination connection
        _add_to_directory_cache(dst_conn_id, dest_path)

    finally:
        await source_backend.disconnect()
        await dest_backend.disconnect()


async def _cross_connection_move(
    src_conn: Connection,
    dst_conn: Connection,
    source_path: str,
    dest_path: str,
    src_conn_id: str,
    dst_conn_id: str,
    *,
    overwrite: bool = False,
) -> None:
    """Perform a cross-connection move (copy + delete) with progress reporting."""

    from app.api.websocket import notify_transfer_progress

    source_backend = _build_backend(src_conn)
    dest_backend = _build_backend(dst_conn)

    await source_backend.connect()
    await dest_backend.connect()

    dest_parent = str(PurePosixPath(dest_path).parent)
    if dest_parent == ".":
        dest_parent = ""
    item_name = PurePosixPath(dest_path).name

    _last_broadcast: list[float] = [0.0]
    _min_broadcast_interval_s: float = 0.25

    def on_progress(bytes_transferred: int, total_bytes: int | None) -> None:
        import time

        now = time.monotonic()
        if now - _last_broadcast[0] < _min_broadcast_interval_s:
            return
        _last_broadcast[0] = now

        try:
            loop = asyncio.get_event_loop()
            loop.create_task(
                notify_transfer_progress(
                    dst_conn_id,
                    dest_parent,
                    bytes_transferred,
                    total_bytes,
                    item_name,
                )
            )
        except RuntimeError:
            pass

    try:
        await cross_connection_move(
            source_backend,
            dest_backend,
            source_path,
            dest_path,
            on_progress=on_progress,
            overwrite=overwrite,
        )
        try:
            await notify_transfer_progress(
                dst_conn_id,
                dest_parent,
                -1,
                -1,
                item_name,
            )
        except Exception:
            pass

        # Update both caches
        _remove_from_directory_cache(src_conn_id, source_path)
        _add_to_directory_cache(dst_conn_id, dest_path)

    finally:
        await source_backend.disconnect()
        await dest_backend.disconnect()


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
# _stop_monitors_for_path
#
def _stop_monitors_for_path(connection_id: str, path: str) -> None:
    """Stop directory monitors for *path* and any of its children.

    Before deleting a directory we must release the SMB handles held by
    the directory monitor.  Without this, ``rmdir`` marks the directory
    as "delete pending" instead of removing it immediately, because
    the server sees an outstanding open handle.

    Silently ignores errors — monitor cleanup must never break the
    delete flow.
    """

    from app.api.websocket import manager
    from app.services.directory_monitor import get_monitor

    try:
        monitor = get_monitor()
        prefix = f"{connection_id}:{path}"

        # Snapshot keys to avoid mutating while iterating
        keys_to_stop = [key for key in list(manager.active_connections.keys()) if key == prefix or key.startswith(f"{prefix}/")]

        for key in keys_to_stop:
            try:
                conn_id, sub_path = key.split(":", 1)
                resolved = manager._resolved_paths.pop(key, sub_path)
                monitor.stop_monitoring(conn_id, resolved)

                # Also clean up the subscription bookkeeping so the
                # manager doesn't try to stop it again on disconnect.
                manager.active_connections.pop(key, None)
                for ws_subs in manager.subscriptions.values():
                    ws_subs.discard(key)

                logger.info(f"Stopped monitor before delete: {key}")
            except Exception as e:
                logger.warning(f"Failed to stop monitor {key} before delete: {e}")
    except Exception:
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


#
# _add_to_directory_cache
#
def _add_to_directory_cache(connection_id: str, path: str) -> None:
    """Add a newly created directory to the directory cache, if it exists.

    Silently ignores errors — cache updates must never break the main flow.
    """

    from app.services.directory_cache import get_directory_cache_manager

    try:
        cache_manager = get_directory_cache_manager()
        cache = cache_manager.get_cache(connection_id)
        if cache is None:
            return

        cache.add_directories([path])
    except Exception:
        pass
