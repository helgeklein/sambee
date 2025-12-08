"""
Mobile logs API endpoints
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.config import settings, static
from app.core.logging import get_logger
from app.core.security import get_current_user_with_auth_check
from app.models.logs import MobileLogBatch
from app.models.user import User
from app.services.log_manager import MobileLogManager

router = APIRouter()
logger = get_logger(__name__)

# Initialize log manager
LOG_DIR = static.data_dir / "mobile_logs"
log_manager = MobileLogManager(LOG_DIR)


#
# receive_mobile_logs
#
@router.post("/mobile")
async def receive_mobile_logs(
    batch: MobileLogBatch,
    request: Request,
    _user: Annotated[User, Depends(get_current_user_with_auth_check)],
) -> dict[str, Any]:
    """
    Receive and store mobile log entries

    Args:
        batch: Batch of log entries from mobile device
        request: FastAPI request object
        _user: Authenticated user (from dependency)

    Returns:
        Acknowledgment with filename
    """

    try:
        # Validate batch size
        if len(batch.logs) > 100:
            raise HTTPException(status_code=400, detail="Too many logs in batch (max 100)")

        # Add server-side metadata
        metadata = {
            "client_ip": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
        }

        # Write to file
        filename = log_manager.write_log_batch(batch, metadata)

        # Cleanup old logs using configured retention period
        log_manager.cleanup_old_logs(hours=settings.frontend_log_retention_hours)

        logger.info(f"Received mobile log batch: session_id={batch.session_id}, log_count={len(batch.logs)}")

        return {
            "status": "success",
            "filename": filename,
            "logs_received": len(batch.logs),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to process mobile logs: {e}")
        raise HTTPException(status_code=500, detail="Failed to process logs")


#
# list_mobile_logs
#
@router.get("/list")
async def list_log_files(
    _user: Annotated[User, Depends(get_current_user_with_auth_check)],
) -> dict[str, Any]:
    """
    List available mobile log files

    Args:
        _user: Authenticated user (from dependency)

    Returns:
        List of log files with metadata
    """

    try:
        log_files = log_manager.list_log_files()
        return {
            "status": "success",
            "files": log_files,
            "count": len(log_files),
        }
    except Exception as e:
        logger.error(f"Failed to list mobile logs: {e}")
        raise HTTPException(status_code=500, detail="Failed to list log files")


#
# download_mobile_log
#
@router.get("/download/{filename}")
async def download_log_file(
    filename: str,
    _user: Annotated[User, Depends(get_current_user_with_auth_check)],
) -> FileResponse:
    """
    Download a specific mobile log file

    Args:
        filename: Name of the log file to download
        _user: Authenticated user (from dependency)

    Returns:
        File download response
    """

    try:
        # Validate filename to prevent path traversal
        if ".." in filename or "/" in filename or "\\" in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        filepath = LOG_DIR / filename

        if not filepath.exists():
            raise HTTPException(status_code=404, detail="Log file not found")

        return FileResponse(
            path=filepath,
            filename=filename,
            media_type="application/x-ndjson",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download mobile log {filename}: {e}")
        raise HTTPException(status_code=500, detail="Failed to download log file")


#
# Logging configuration models
#
class LoggingConfig(BaseModel):
    """Frontend logging configuration"""

    enabled: bool
    log_level: str  # Log level: DEBUG, INFO, WARNING, ERROR
    components: list[str]  # Empty list means all components


#
# get_logging_config
#
@router.get("/config")
async def get_logging_config(
    user: Annotated[User, Depends(get_current_user_with_auth_check)],
) -> LoggingConfig:
    """
    Get frontend logging configuration for current user

    Args:
        user: Authenticated user

    Returns:
        Logging configuration
    """

    import re

    # Check if logging is enabled globally
    enabled = settings.frontend_logging_enabled

    # If username regex is configured, check if user matches
    if enabled and settings.frontend_logging_username_regex:
        try:
            pattern = re.compile(settings.frontend_logging_username_regex)
            enabled = bool(pattern.match(user.username))
        except re.error as e:
            logger.error(f"Invalid frontend_logging_username_regex: {e}")
            enabled = False

    # Get log level from settings (already validated and normalized to uppercase)
    log_level = settings.frontend_log_level

    components = [comp.strip() for comp in settings.frontend_log_components.split(",") if comp.strip()]

    return LoggingConfig(
        enabled=enabled,
        log_level=log_level,
        components=components,
    )
