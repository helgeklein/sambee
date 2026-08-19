import asyncio
import hashlib
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from functools import partial
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response, StreamingResponse
from sqlmodel import Session, select

from app.api._smb_helpers import build_smb_backend, disconnect_backend_safely
from app.api.companion import (
    COMPANION_ERROR_LOCK_LOST,
    _get_current_companion_operation_user,
    _raise_companion_operation_error,
    _validate_operation_lock_scope,
)
from app.core.logging import get_logger, set_user
from app.core.security import get_current_user_for_token, get_current_user_with_auth_check, oauth2_scheme_optional
from app.core.system_setting_definitions import SystemSettingKey
from app.db.database import get_session
from app.models.connection import Connection
from app.models.edit_lock import HEARTBEAT_TIMEOUT_SECONDS, EditLock
from app.models.file import FileType
from app.models.user import User
from app.services.connection_access import get_accessible_connection_or_404
from app.services.image_converter import convert_image_for_viewer
from app.services.pdf_derivative_cache import PDFDerivativeCachePolicy, PDFSourceRevision, pdf_derivative_cache
from app.services.pdf_inspector import PDFScreenProfile, analyze_pdf_for_screen
from app.services.pdf_normalizer import (
    PDFNormalizationError,
    PDFNormalizationLimits,
    is_pdf_normalization_available,
    needs_pdf_normalization,
    normalize_pdf_with_queue,
)
from app.services.system_settings import get_integer_setting_value
from app.storage.smb import SMBBackend
from app.utils.file_type_registry import needs_processing

router = APIRouter()
logger = get_logger(__name__)


def _get_active_lock(connection_id: uuid.UUID, path: str, session: Session) -> EditLock | None:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS)
    statement = (
        select(EditLock)
        .where(EditLock.connection_id == connection_id)
        .where(EditLock.file_path == path)
        .where(EditLock.last_heartbeat >= cutoff)
    )
    return session.exec(statement).first()


#
# create_file_streamer
#
def create_file_streamer(backend: SMBBackend, path: str) -> AsyncIterator[bytes]:
    """Create an async generator that streams file contents from SMB backend

    Handles error cases during streaming and ensures backend disconnection.
    """

    async def file_streamer() -> AsyncIterator[bytes]:
        try:
            async for chunk in backend.read_file(path):
                yield chunk
        except TimeoutError as e:
            logger.error(f"Timeout reading file during streaming: {path} - {e}")
            # Can't raise HTTPException mid-stream, connection will be closed
            # Client will see incomplete response
            raise
        except FileNotFoundError as e:
            logger.warning(f"File not found during streaming: {path} - {e}")
            # Can't raise HTTPException mid-stream, connection will be closed
            # Client will see incomplete response
            raise
        except IOError as e:
            logger.warning(f"File access error during streaming: {path} - {e}")
            # Can't raise HTTPException mid-stream, connection will be closed
            raise
        finally:
            await disconnect_backend_safely(backend, logger=logger, context=f"streaming '{path}'")

    return file_streamer()


async def read_pdf_derivative_source(
    backend: SMBBackend,
    path: str,
    initial_size: int | None,
    initial_modified_at: datetime | None,
    initial_created_at: datetime | None,
    initial_stable_id: str | None,
) -> tuple[bytes, PDFSourceRevision]:
    """Read one PDF snapshot and reject it when SMB metadata changes mid-read."""

    try:
        chunks: list[bytes] = []
        async for chunk in backend.read_file(path):
            chunks.append(chunk)
        refreshed_info = await backend.get_file_info(path)
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"PDF derivative read for '{path}'")

    if (
        refreshed_info.size != initial_size
        or refreshed_info.modified_at != initial_modified_at
        or refreshed_info.created_at != initial_created_at
        or refreshed_info.stable_id != initial_stable_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The PDF changed while compatibility processing was being prepared. Try again.",
        )
    pdf_bytes = b"".join(chunks)
    return pdf_bytes, PDFSourceRevision(
        path=path,
        size=initial_size,
        modified_at=initial_modified_at.isoformat() if initial_modified_at else None,
        created_at=initial_created_at.isoformat() if initial_created_at else None,
        stable_id=initial_stable_id,
        content_digest=hashlib.sha256(pdf_bytes).hexdigest(),
    )


async def create_normalized_pdf_response(
    *,
    backend: SMBBackend,
    path: str,
    filename: str,
    initial_size: int | None,
    initial_modified_at: datetime | None,
    initial_created_at: datetime | None,
    initial_stable_id: str | None,
    connection_id: uuid.UUID,
    user_id: uuid.UUID,
    screen_profile: PDFScreenProfile | None,
) -> Response:
    """Return an explicitly requested cached compatibility derivative."""

    if not is_pdf_normalization_available():
        await disconnect_backend_safely(backend, logger=logger, context=f"unavailable PDF derivative for '{path}'")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="PDF compatibility processing is unavailable")

    max_source_size = get_integer_setting_value(SystemSettingKey.PDF_NORMALIZER_MAX_SOURCE_SIZE_BYTES)
    if initial_size is not None and initial_size > max_source_size:
        await disconnect_backend_safely(backend, logger=logger, context=f"oversized PDF derivative for '{path}'")
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="This PDF exceeds the configured compatibility-processing size limit.",
        )

    policy = PDFDerivativeCachePolicy(
        quota_bytes=get_integer_setting_value(SystemSettingKey.PDF_VIEWER_CACHE_QUOTA_BYTES),
        inactivity_ttl_seconds=get_integer_setting_value(SystemSettingKey.PDF_VIEWER_CACHE_INACTIVITY_TTL_SECONDS),
    )
    limits = PDFNormalizationLimits(
        timeout_seconds=get_integer_setting_value(SystemSettingKey.PDF_NORMALIZER_TIMEOUT_SECONDS),
        cpu_time_seconds=get_integer_setting_value(SystemSettingKey.PDF_NORMALIZER_CPU_TIME_SECONDS),
        address_space_bytes=get_integer_setting_value(SystemSettingKey.PDF_NORMALIZER_ADDRESS_SPACE_BYTES),
        output_size_bytes=get_integer_setting_value(SystemSettingKey.PDF_NORMALIZER_MAX_OUTPUT_SIZE_BYTES),
        temporary_disk_bytes=get_integer_setting_value(SystemSettingKey.PDF_NORMALIZER_TEMPORARY_DISK_BYTES),
    )
    loop = asyncio.get_running_loop()
    metadata_revision = PDFSourceRevision(
        path=path,
        size=initial_size,
        modified_at=initial_modified_at.isoformat() if initial_modified_at else None,
        created_at=initial_created_at.isoformat() if initial_created_at else None,
        stable_id=initial_stable_id,
    )
    screen_enabled = get_integer_setting_value(SystemSettingKey.PDF_SCREEN_DERIVATIVE_ENABLED) == 1
    screen_variant = f"screen-{screen_profile.cache_suffix()}" if screen_enabled and screen_profile else None
    # With a screen profile, a normalized cache entry cannot establish the
    # variant selection. Inspect after a screen-cache miss so oversized PDFs
    # always use their profile-specific derivative.
    cached_variants = (screen_variant,) if screen_variant else ("normalized",)
    for cached_variant in cached_variants:
        cached_derivative = await loop.run_in_executor(
            None,
            partial(
                pdf_derivative_cache.get,
                user_id=str(user_id),
                connection_id=str(connection_id),
                revision=metadata_revision,
                variant=cached_variant,
                policy=policy,
            ),
        )
        if cached_derivative is None:
            continue
        logger.info(
            "pdf_derivative outcome=cache_hit connection_id=%s path=%r variant=%s derivative_bytes=%d",
            connection_id,
            path,
            cached_variant,
            len(cached_derivative),
        )
        await disconnect_backend_safely(backend, logger=logger, context=f"PDF derivative cache hit for '{path}'")
        return Response(
            content=cached_derivative,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "X-PDF-Variant": cached_variant,
                "X-PDF-Derivative-Cache": "hit",
                "Cache-Control": "private, no-store",
            },
        )

    pdf_bytes, revision = await read_pdf_derivative_source(
        backend, path, initial_size, initial_modified_at, initial_created_at, initial_stable_id
    )
    if len(pdf_bytes) > max_source_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="This PDF exceeds the configured compatibility-processing size limit.",
        )

    selected_variant = "normalized"
    screen_resolution_dpi: int | None = None
    if screen_variant and screen_profile:
        analysis = await loop.run_in_executor(
            None,
            partial(
                analyze_pdf_for_screen,
                pdf_bytes,
                screen_profile,
                get_integer_setting_value(SystemSettingKey.PDF_SCREEN_MAX_DECODED_PIXELS),
            ),
        )
        logger.info(
            "pdf_derivative outcome=screen_analysis connection_id=%s path=%r oversized=%s max_image_pixels=%d max_required_pixels=%d",
            connection_id,
            path,
            analysis.is_oversized,
            analysis.maximum_image_pixels,
            analysis.maximum_required_pixels,
        )
        if analysis.is_oversized and analysis.screen_resolution_dpi > 0:
            selected_variant = screen_variant
            screen_resolution_dpi = analysis.screen_resolution_dpi

    try:
        derivative, cache_hit = await loop.run_in_executor(
            None,
            partial(
                pdf_derivative_cache.get_or_create,
                user_id=str(user_id),
                connection_id=str(connection_id),
                revision=revision,
                variant=selected_variant,
                policy=policy,
                create=lambda: normalize_pdf_with_queue(
                    pdf_bytes,
                    filename,
                    limits,
                    maximum_concurrent=get_integer_setting_value(SystemSettingKey.PDF_NORMALIZER_MAX_CONCURRENT),
                    queue_wait_seconds=get_integer_setting_value(SystemSettingKey.PDF_NORMALIZER_QUEUE_WAIT_SECONDS),
                    screen_resolution_dpi=screen_resolution_dpi,
                ),
            ),
        )
    except PDFNormalizationError as exc:
        logger.warning(
            "pdf_derivative outcome=failed connection_id=%s path=%r variant=%s code=%s",
            connection_id,
            path,
            selected_variant,
            exc.code,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="PDF compatibility processing could not make this file viewable.",
        ) from exc

    logger.info(
        "pdf_derivative outcome=%s connection_id=%s path=%r variant=%s derivative_bytes=%d",
        "cache_hit" if cache_hit else "created",
        connection_id,
        path,
        selected_variant,
        len(derivative),
    )
    return Response(
        content=derivative,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "X-PDF-Variant": selected_variant,
            "X-PDF-Derivative-Cache": "hit" if cache_hit else "miss",
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("/{connection_id}/pdf-derivative", status_code=status.HTTP_204_NO_CONTENT)
async def invalidate_pdf_derivative(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the PDF source"),
    screen_width: int | None = Query(None, ge=320, le=16384),
    screen_height: int | None = Query(None, ge=320, le=16384),
    screen_zoom_percent: int = Query(200, ge=100, le=400),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> Response:
    """Discard the current user's compatibility derivative after PDF.js rejects it."""

    connection = get_accessible_connection_or_404(session, current_user, connection_id)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        file_info = await backend.get_file_info(path)
        if file_info.type == FileType.DIRECTORY or not needs_pdf_normalization(file_info.name):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF derivative invalidation requires a PDF file")
        revision = PDFSourceRevision(
            path=path,
            size=file_info.size,
            modified_at=file_info.modified_at.isoformat() if file_info.modified_at else None,
            created_at=file_info.created_at.isoformat() if file_info.created_at else None,
            stable_id=file_info.stable_id,
        )
        variants = ["normalized"]
        if screen_width is not None and screen_height is not None:
            variants.append(f"screen-{PDFScreenProfile(screen_width, screen_height, screen_zoom_percent).cache_suffix()}")
        loop = asyncio.get_running_loop()
        for variant in variants:
            await loop.run_in_executor(
                None,
                partial(
                    pdf_derivative_cache.invalidate,
                    user_id=str(current_user.id),
                    connection_id=str(connection_id),
                    revision=revision,
                    variant=variant,
                ),
            )
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"PDF derivative invalidation for '{path}'")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


#
# read_and_convert_image
#
async def read_and_convert_image(
    backend: SMBBackend,
    path: str,
    filename: str,
    connection_id: uuid.UUID,
    max_width: int | None = None,
    max_height: int | None = None,
    no_resizing: bool = False,
) -> Response:
    """Read an image file from SMB backend and convert it to browser-compatible format

    Handles the complete workflow of:
    - Reading file chunks from SMB
    - Converting to browser-ready format (WebP/PNG/JPEG)
    - Optionally resizing based on viewport dimensions
    - Error handling for conversion failures
    """

    try:
        # Read file into memory
        chunks = []
        try:
            async for chunk in backend.read_file(path):
                chunks.append(chunk)
        finally:
            await disconnect_backend_safely(backend, logger=logger, context=f"image conversion read for '{path}'")
        image_bytes = b"".join(chunks)

        # Convert to browser-ready format with optional resizing
        # If no_resizing=True, don't resize
        max_width = None if no_resizing else max_width
        max_height = None if no_resizing else max_height

        # Run CPU-intensive image conversion in a thread pool to avoid
        # blocking the async event loop (which would stall all other requests).
        loop = asyncio.get_event_loop()
        converted_bytes, converted_mime, converter_name, duration_ms = await loop.run_in_executor(
            None,
            partial(
                convert_image_for_viewer,
                image_bytes,
                filename,
                max_width=max_width,
                max_height=max_height,
                output_format="auto",  # Auto-select WebP/PNG/JPEG
            ),
        )

        logger.info(
            f"Image converted: {filename} → {converted_mime} "
            f"({len(image_bytes) / 1024:.0f} → {len(converted_bytes) / 1024:.0f} KB) "
            f"via {converter_name} in {duration_ms:.0f} ms"
        )

        return Response(
            content=converted_bytes,
            media_type=converted_mime,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    except TimeoutError as e:
        logger.error(
            f"Timeout reading file: connection_id={connection_id}, path='{path}', error={e}",
        )
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Timeout reading file from network share",
        )
    except ImportError as e:
        logger.error(
            f"Image conversion failed - missing dependency: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Image format not supported: HEIC/HEIF requires additional system libraries",
        )
    except ValueError as e:
        # Clean error message: replace newlines with ". " and normalize spaces
        import re

        # Replace Windows (\r\n) and Unix (\n) newlines with ". "
        error_msg = re.sub(r"\r?\n", ". ", str(e))
        # Collapse multiple spaces/tabs into single space
        error_msg = re.sub(r"[ \t]+", " ", error_msg)
        # Clean up multiple periods (e.g., ".. " -> ". ")
        error_msg = re.sub(r"\.(\s*\.)+", ".", error_msg).strip()

        logger.error(
            f"Image conversion failed: connection_id={connection_id}, path='{path}', error={error_msg}",
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=error_msg,
        )
    except Exception as e:
        logger.error(
            f"Unexpected error during image conversion: connection_id={connection_id}, path='{path}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process image",
        )


#
# validate_connection
#
def validate_connection(connection: Connection) -> None:
    """Validate connection has required fields"""

    if not connection.share_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Connection has no share name configured",
        )


#
# view_file
#
@router.get("/{connection_id}/file", response_model=None)
async def view_file(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file"),
    pdf_variant: Literal["original", "normalized"] = Query("original", description="PDF viewer source variant"),
    screen_width: int | None = Query(None, ge=320, le=16384, description="Physical display width in pixels"),
    screen_height: int | None = Query(None, ge=320, le=16384, description="Physical display height in pixels"),
    screen_zoom_percent: int = Query(200, ge=100, le=400, description="Maximum requested viewing zoom"),
    viewport_width: int | None = Query(None, description="Viewport width in pixels (including DPR)"),
    viewport_height: int | None = Query(None, description="Viewport height in pixels (including DPR)"),
    no_resizing: bool = Query(False, description="Return original image without resizing"),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> Response | StreamingResponse:
    """Stream file contents for viewing"""

    # Set the user for logging
    set_user(current_user.username)

    # Get the storage connection
    connection = get_accessible_connection_or_404(session, current_user, connection_id)

    # Verify the connection configuration
    if not connection.share_name:
        logger.warning(f"Connection has no share name: connection_id={connection_id}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connection has no share name configured")

    try:
        # Create SMB backend...
        backend = build_smb_backend(connection, backend_factory=SMBBackend)
        # ...and connect
        await backend.connect()

        # Get file info and ensure path points to a file (not a directory)
        try:
            file_info = await backend.get_file_info(path)
            if file_info.type == FileType.DIRECTORY:
                await disconnect_backend_safely(backend, logger=logger, context=f"view file directory check for '{path}'")
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot view a directory")
        except HTTPException:
            raise
        except TimeoutError as e:
            await disconnect_backend_safely(backend, logger=logger, context=f"view file info timeout for '{path}'")
            logger.error(f"Timeout getting file info: connection_id={connection_id}, path='{path}', error={e}")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Timeout reading file from network share",
            )
        except FileNotFoundError:
            await disconnect_backend_safely(backend, logger=logger, context=f"view file missing path '{path}'")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"File not found: {path}")
        except Exception as e:
            await disconnect_backend_safely(backend, logger=logger, context=f"view file info failure for '{path}'")
            logger.error(f"Failed to get file info: connection_id={connection_id}, path='{path}', error={type(e).__name__}: {e}")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"File not found: {path}")

        # Check if image needs processing for browser compatibility and viewing speed
        if needs_processing(file_info.name, file_info.size):
            size_string = f"{file_info.size / 1024:.0f} KB" if file_info.size else "unknown"
            logger.debug(f"Image requires processing: connection_id={connection_id}, path='{path}', size={size_string}")
            return await read_and_convert_image(
                backend=backend,
                path=path,
                filename=file_info.name,
                connection_id=connection_id,
                max_width=viewport_width,
                max_height=viewport_height,
                no_resizing=no_resizing,
            )

        if pdf_variant == "normalized":
            if not needs_pdf_normalization(file_info.name):
                await disconnect_backend_safely(backend, logger=logger, context=f"non-PDF derivative request for '{path}'")
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF compatibility processing requires a PDF file")
            return await create_normalized_pdf_response(
                backend=backend,
                path=path,
                filename=file_info.name,
                initial_size=file_info.size,
                initial_modified_at=file_info.modified_at,
                initial_created_at=file_info.created_at,
                initial_stable_id=file_info.stable_id,
                connection_id=connection_id,
                user_id=current_user.id,
                screen_profile=(
                    PDFScreenProfile(screen_width, screen_height, screen_zoom_percent)
                    if screen_width is not None and screen_height is not None
                    else None
                ),
            )

        # Stream the file (browser-native format or non-image/non-PDF)
        logger.debug(f"Streaming file for viewing: connection_id={connection_id}, path='{path}', mime_type={file_info.mime_type}")
        return StreamingResponse(
            create_file_streamer(backend, path),
            media_type=file_info.mime_type,
            headers={"Content-Disposition": f'inline; filename="{file_info.name}"'},
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to view file: connection_id={connection_id}, path='{path}', "
            f"host={connection.host}, share={connection.share_name}, "
            f"error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(e)}",
        )


#
# download_file
#
@router.get("/{connection_id}/download")
async def download_file(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file"),
    operation_id: Optional[str] = Query(None, description="Active companion operation ID"),
    lock_id: Optional[str] = Query(None, description="Active companion lock ID"),
    lock_capability: Optional[str] = Query(None, description="Active companion lock capability"),
    token: Optional[str] = Depends(oauth2_scheme_optional),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Download a file"""

    if operation_id or lock_id or lock_capability:
        if not operation_id or not lock_id or not lock_capability or not token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing companion operation context",
            )

        current_user = _get_current_companion_operation_user(
            token,
            connection_id=connection_id,
            path=path,
            operation_id=operation_id,
            lock_id=lock_id,
            session=session,
        )

        lock = _get_active_lock(connection_id, path, session)
        if not lock:
            _raise_companion_operation_error(
                status_code=status.HTTP_404_NOT_FOUND,
                code=COMPANION_ERROR_LOCK_LOST,
                message="The edit lock is no longer active for this file. Reopen the file from Sambee and try again.",
            )

        _validate_operation_lock_scope(
            lock,
            operation_id=operation_id,
            lock_id=lock_id,
            lock_capability=lock_capability,
        )
    else:
        current_user = await get_current_user_for_token(token, session)

    set_user(current_user.username)
    logger.info(f"Download file: connection_id={connection_id}, path='{path}'")

    connection = get_accessible_connection_or_404(session, current_user, connection_id)

    if not connection.share_name:
        logger.warning(f"Connection has no share name: connection_id={connection_id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Connection has no share name configured",
        )

    try:
        backend = build_smb_backend(connection, backend_factory=SMBBackend)

        await backend.connect()

        # Get file info
        try:
            file_info = await backend.get_file_info(path)
        except TimeoutError as e:
            await disconnect_backend_safely(backend, logger=logger, context=f"download file info timeout for '{path}'")
            logger.error(f"Timeout getting download file info: connection_id={connection_id}, path='{path}', error={e}")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Timeout reading file from network share",
            )
        except FileNotFoundError:
            await disconnect_backend_safely(backend, logger=logger, context=f"download missing path '{path}'")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"File not found: {path}")

        if file_info.type != "file":
            logger.warning(f"Path is not a file: connection_id={connection_id}, path='{path}', type={file_info.type}")
            await disconnect_backend_safely(backend, logger=logger, context=f"download directory check for '{path}'")
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path is not a file")

        # Stream the file
        headers = {"Content-Disposition": f'attachment; filename="{file_info.name}"'}
        if file_info.size:
            headers["Content-Length"] = str(file_info.size)

        logger.info(f"Streaming file for download: connection_id={connection_id}, path='{path}', size={file_info.size}")
        return StreamingResponse(
            create_file_streamer(backend, path),
            media_type="application/octet-stream",
            headers=headers,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to download file: connection_id={connection_id}, path='{path}', "
            f"host={connection.host}, share={connection.share_name}, "
            f"error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to download file: {str(e)}",
        )
