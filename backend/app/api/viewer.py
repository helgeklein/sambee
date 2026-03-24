import asyncio
import uuid
from collections.abc import AsyncIterator
from functools import partial

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response, StreamingResponse
from sqlmodel import Session

from app.api._smb_helpers import build_smb_backend, disconnect_backend_safely
from app.core.logging import get_logger, set_user
from app.core.security import get_current_user_with_auth_check
from app.db.database import get_session
from app.models.connection import Connection
from app.models.file import FileType
from app.models.user import User
from app.services.connection_access import get_accessible_connection_or_404
from app.services.image_converter import convert_image_for_viewer
from app.services.pdf_normalizer import (
    is_pdf_normalization_available,
    needs_pdf_normalization,
    normalize_pdf,
)
from app.storage.smb import SMBBackend
from app.utils.file_type_registry import needs_processing

router = APIRouter()
logger = get_logger(__name__)


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
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
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
# read_and_normalize_pdf
#
async def read_and_normalize_pdf(
    backend: SMBBackend,
    path: str,
    filename: str,
    connection_id: uuid.UUID,
) -> Response:
    """Read a PDF file from SMB backend and normalize it for browser compatibility.

    Some PDF files fail to load in PDF.js with "Invalid PDF structure" errors
    due to non-standard or malformed PDF structures. This function uses
    Ghostscript to rewrite the PDF in a clean, compatible format.

    Args:
        backend: Connected SMB backend
        path: Path to the PDF file
        filename: Original filename
        connection_id: Connection UUID for logging

    Returns:
        Response with normalized PDF bytes
    """

    try:
        # Read file into memory
        chunks = []
        try:
            async for chunk in backend.read_file(path):
                chunks.append(chunk)
        finally:
            await disconnect_backend_safely(backend, logger=logger, context=f"pdf normalization read for '{path}'")
        pdf_bytes = b"".join(chunks)

        # Run Ghostscript PDF normalization in a thread pool to avoid
        # blocking the async event loop (which would stall all other requests).
        loop = asyncio.get_event_loop()
        normalized_bytes, was_modified, duration_ms = await loop.run_in_executor(
            None,
            partial(normalize_pdf, pdf_bytes, filename=filename),
        )

        if was_modified:
            logger.info(
                f"PDF normalized: {filename} ({len(pdf_bytes) / 1024:.0f} → {len(normalized_bytes) / 1024:.0f} KB) in {duration_ms:.0f} ms"
            )
        else:
            logger.debug(f"PDF served without normalization: {filename}")

        return Response(
            content=normalized_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    except TimeoutError as e:
        logger.error(
            f"Timeout reading PDF: connection_id={connection_id}, path='{path}', error={e}",
        )
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Timeout reading file from network share",
        )
    except Exception as e:
        logger.error(
            f"PDF normalization failed: connection_id={connection_id}, path='{path}', error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process PDF",
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
            logger.info(f"Image requires processing: connection_id={connection_id}, path='{path}', size={size_string}")
            return await read_and_convert_image(
                backend=backend,
                path=path,
                filename=file_info.name,
                connection_id=connection_id,
                max_width=viewport_width,
                max_height=viewport_height,
                no_resizing=no_resizing,
            )

        # Check if PDF needs normalization for browser compatibility
        if needs_pdf_normalization(file_info.name) and is_pdf_normalization_available():
            size_string = f"{file_info.size / 1024:.0f} KB" if file_info.size else "unknown"
            logger.info(f"PDF normalization: connection_id={connection_id}, path='{path}', size={size_string}")
            return await read_and_normalize_pdf(
                backend=backend,
                path=path,
                filename=file_info.name,
                connection_id=connection_id,
            )

        # Stream the file (browser-native format or non-image/non-PDF)
        logger.info(f"Streaming file for viewing: connection_id={connection_id}, path='{path}', mime_type={file_info.mime_type}")
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
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Download a file"""

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
