"""
Mobile logs API endpoints
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session

from app.core.config import settings, static
from app.core.logging import get_logger
from app.core.security import get_current_user_with_auth_check
from app.db.database import get_session
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
    levels: list[str]
    components: list[str]  # Empty list means all components


class UpdateLoggingConfigRequest(BaseModel):
    """Request to update logging configuration"""

    enabled: bool
    levels: list[str]
    components: list[str]


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

    # User preference takes precedence, fallback to global default
    enabled = user.enable_frontend_logging if user.enable_frontend_logging is not None else settings.frontend_logging_enabled

    # Parse comma-separated strings to lists, using system defaults if user has defaults
    levels_str = user.frontend_log_levels if user.frontend_log_levels != "error,warn,info,debug" else settings.frontend_default_log_levels
    components_str = user.frontend_log_components if user.frontend_log_components != "" else settings.frontend_default_log_components

    levels = [lvl.strip() for lvl in levels_str.split(",") if lvl.strip()]
    components = [comp.strip() for comp in components_str.split(",") if comp.strip()]

    return LoggingConfig(
        enabled=enabled,
        levels=levels,
        components=components,
    )


#
# update_logging_config
#
@router.put("/config")
async def update_logging_config(
    request: UpdateLoggingConfigRequest,
    user: Annotated[User, Depends(get_current_user_with_auth_check)],
    session: Session = Depends(get_session),
) -> LoggingConfig:
    """
    Update frontend logging configuration for current user

    Args:
        request: New logging configuration
        user: Authenticated user
        session: Database session

    Returns:
        Updated logging configuration
    """

    try:
        # Validate levels
        valid_levels = {"debug", "info", "warn", "error"}
        for level in request.levels:
            if level.lower() not in valid_levels:
                raise HTTPException(status_code=400, detail=f"Invalid log level: {level}. Must be one of: {', '.join(valid_levels)}")

        # Update user preferences
        user.enable_frontend_logging = request.enabled
        user.frontend_log_levels = ",".join(request.levels)
        user.frontend_log_components = ",".join(request.components)

        session.add(user)
        session.commit()
        session.refresh(user)

        logger.info(
            f"Updated frontend logging config for user {user.username}: "
            f"enabled={request.enabled}, levels={request.levels}, components={request.components}"
        )

        return LoggingConfig(
            enabled=request.enabled,
            levels=request.levels,
            components=request.components,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update logging config: {e}")
        raise HTTPException(status_code=500, detail="Failed to update logging configuration")
