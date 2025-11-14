import uuid
from collections.abc import AsyncIterator

from app.core.logging import get_logger, set_user
from app.core.security import decrypt_password, get_current_user
from app.db.database import get_session
from app.models.connection import Connection
from app.models.user import User
from app.services.image_converter import convert_image_to_jpeg, needs_conversion
from app.storage.smb import SMBBackend
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response, StreamingResponse
from sqlmodel import Session

router = APIRouter()
logger = get_logger(__name__)


def validate_connection(connection: Connection) -> None:
    """Validate connection has required fields"""
    if not connection.share_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Connection has no share name configured",
        )


@router.get("/{connection_id}/file", response_model=None)
async def preview_file(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response | StreamingResponse:
    """Stream file contents for preview"""
    set_user(current_user.username)
    logger.info(f"Preview file: connection_id={connection_id}, path='{path}'")

    connection = session.get(Connection, connection_id)
    if not connection:
        logger.warning(f"Connection not found: connection_id={connection_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found"
        )

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

        # Check if path is a file (not a directory)
        try:
            file_info = await backend.get_file_info(path)
            if file_info.type.value == "directory":
                await backend.disconnect()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot preview a directory",
                )
        except HTTPException:
            raise
        except Exception as e:
            await backend.disconnect()
            logger.error(
                f"Failed to get file info: connection_id={connection_id}, path='{path}', "
                f"error={type(e).__name__}: {e}"
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {path}",
            )

        # Determine MIME type from filename to avoid guessing wrong types
        import mimetypes
        from pathlib import PurePosixPath

        filename = PurePosixPath(path).name
        mime_type, _ = mimetypes.guess_type(filename)
        # Only use guessed type if it's not a strange default
        # For unknown extensions, use application/octet-stream
        if not mime_type or mime_type.startswith("chemical/"):
            mime_type = "application/octet-stream"

        # Check if image needs conversion for browser compatibility
        if needs_conversion(filename):
            logger.info(
                f"Image requires conversion: connection_id={connection_id}, path='{path}'"
            )

            try:
                # Read file in large chunks for optimal SMB performance
                chunks = []
                async for chunk in backend.read_file(path, chunk_size=8 * 1024 * 1024):
                    chunks.append(chunk)
                image_bytes = b"".join(chunks)

                await backend.disconnect()

                # Convert to JPEG (libvips handles large images efficiently via streaming)
                converted_bytes, converted_mime = convert_image_to_jpeg(
                    image_bytes,
                    filename,
                    quality=80,  # Optimized for fast encoding with good visual quality
                )

                logger.info(
                    f"Image converted: {filename} → {converted_mime} "
                    f"({len(image_bytes) / 1024:.0f} → {len(converted_bytes) / 1024:.0f} KB)"
                )

                return Response(
                    content=converted_bytes,
                    media_type=converted_mime,
                    headers={"Content-Disposition": f'inline; filename="{filename}"'},
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
                logger.error(
                    f"Image conversion failed: connection_id={connection_id}, "
                    f"path='{path}', error={e}",
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Failed to convert image: {str(e)}",
                )
            except Exception as e:
                logger.error(
                    f"Unexpected error during image conversion: connection_id={connection_id}, "
                    f"path='{path}', error={type(e).__name__}: {e}",
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to process image",
                )

        # Stream the file (browser-native format or non-image)
        async def file_streamer() -> AsyncIterator[bytes]:
            try:
                # Use large chunks for optimal SMB performance
                async for chunk in backend.read_file(path, chunk_size=8 * 1024 * 1024):
                    yield chunk
            finally:
                await backend.disconnect()

        logger.info(
            f"Streaming file for preview: connection_id={connection_id}, path='{path}', mime_type={mime_type}"
        )
        return StreamingResponse(
            file_streamer(),
            media_type=mime_type,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to preview file: connection_id={connection_id}, path='{path}', "
            f"host={connection.host}, share={connection.share_name}, "
            f"error={type(e).__name__}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(e)}",
        )


@router.get("/{connection_id}/download")
async def download_file(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Download a file"""
    set_user(current_user.username)
    logger.info(f"Download file: connection_id={connection_id}, path='{path}'")

    connection = session.get(Connection, connection_id)
    if not connection:
        logger.warning(f"Connection not found: connection_id={connection_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found"
        )

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

        # Get file info
        file_info = await backend.get_file_info(path)

        if file_info.type != "file":
            logger.warning(
                f"Path is not a file: connection_id={connection_id}, path='{path}', type={file_info.type}"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Path is not a file"
            )

        # Stream the file
        async def file_streamer() -> AsyncIterator[bytes]:
            try:
                # Read file in large chunks for optimal SMB performance
                async for chunk in backend.read_file(path, chunk_size=8 * 1024 * 1024):
                    yield chunk
            finally:
                await backend.disconnect()

        headers = {"Content-Disposition": f'attachment; filename="{file_info.name}"'}
        if file_info.size:
            headers["Content-Length"] = str(file_info.size)

        logger.info(
            f"Streaming file for download: connection_id={connection_id}, path='{path}', size={file_info.size}"
        )
        return StreamingResponse(
            file_streamer(),
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
