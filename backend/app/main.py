import logging
import sys
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from app import __version__
from app.api import admin, auth, browser, viewer, websocket
from app.core.config import settings
from app.core.environment import DEV_CORS_ORIGINS, IS_DEVELOPMENT, IS_PRODUCTION
from app.core.exceptions import ConfigurationError, SambeeError
from app.core.logging import log_error, set_request_id
from app.core.secrets import generate_admin_password
from app.core.security import get_password_hash
from app.db.database import engine, init_db
from app.models.user import User
from app.storage.smb_pool import shutdown_connection_pool

#
# Logging
#

# Log targets:
# Always log to stdout (for Docker/container logging)
handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
if IS_DEVELOPMENT:
    # In development, also log to file for easier debugging
    handlers.append(logging.FileHandler("/tmp/backend.log", mode="a"))

# Configure logging (no timestamp - Docker adds them automatically)
log_format = "%(name)s - %(levelname)s - %(message)s"
logging.basicConfig(level=logging.INFO, format=log_format, handlers=handlers)

# Configure Uvicorn's loggers to use our format and rename uvicorn.error -> uvicorn
uvicorn_formatter = logging.Formatter(log_format)
for logger_name in ["uvicorn", "uvicorn.access", "uvicorn.error"]:
    uvicorn_logger = logging.getLogger(logger_name)
    uvicorn_logger.setLevel(logging.INFO)
    # Replace handlers with our formatted ones
    uvicorn_logger.handlers.clear()
    for handler in handlers:
        new_handler = logging.StreamHandler(handler.stream) if isinstance(handler, logging.StreamHandler) else handler
        # Rename uvicorn.error to just uvicorn for cleaner logs
        if logger_name == "uvicorn.error":
            renamed_formatter = logging.Formatter(log_format.replace("%(name)s", "uvicorn"))
            new_handler.setFormatter(renamed_formatter)
        else:
            new_handler.setFormatter(uvicorn_formatter)
        uvicorn_logger.addHandler(new_handler)
    uvicorn_logger.propagate = False

# Reduce noise from third-party libraries (only show warnings/errors)
logging.getLogger("smbprotocol").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.engine.Engine").setLevel(logging.WARNING)
logging.getLogger("pyvips").setLevel(logging.WARNING)
logging.getLogger("app.storage.smb_pool").setLevel(logging.WARNING)

# Logger for this module
logger = logging.getLogger(__name__)

# Log startup time (skip during tests to reduce noise)
if "pytest" not in sys.modules:
    logger.info("=" * 80)
    logger.info(f"Sambee Backend Starting - {datetime.now().isoformat()}")
    logger.info(f"Environment: {'PRODUCTION' if IS_PRODUCTION else 'DEVELOPMENT'}")
    logger.info(f"Python: {sys.version}")
    logger.info(f"Working Directory: {Path.cwd()}")
    logger.info("=" * 80)


#
# lifespan
#
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize application on startup"""

    try:
        logger.info("Starting Sambee application...")

        # Initialize database
        logger.info("Initializing database...")
        init_db()
        logger.info("Database initialized")

        # Create default admin user if doesn't exist
        logger.info("Checking for admin user...")
        with Session(engine) as session:
            statement = select(User).where(User.username == settings.admin_username)
            admin = session.exec(statement).first()

            if not admin:
                # Generate password based on environment
                admin_password = generate_admin_password(IS_PRODUCTION)

                admin = User(
                    username=settings.admin_username,
                    password_hash=get_password_hash(admin_password),
                    is_admin=True,
                )
                session.add(admin)
                session.commit()

                # Display credentials prominently in production
                if IS_PRODUCTION:
                    logger.warning("=" * 80)
                    logger.warning("FIRST-TIME SETUP - SAVE THESE CREDENTIALS")
                    logger.warning(f"   Username: {settings.admin_username}")
                    logger.warning(f"   Password: {admin_password}")
                    logger.warning("   Change password immediately after first login!")
                    logger.warning("   Credentials will not be displayed again.")
                    logger.warning("=" * 80)
                else:
                    logger.info(f"Created admin user: {settings.admin_username} / {admin_password}")
            else:
                logger.info(f"Admin user exists: {settings.admin_username}")

        logger.info("Sambee application startup complete!")
        logger.info("API Documentation: http://localhost:8000/docs")

    except ConfigurationError as e:
        log_error(logger, f"Configuration error: {e}")
        log_error(logger, "Application startup failed. Exiting.")
        sys.exit(1)
    except Exception as e:
        log_error(logger, f"Startup failed: {e}")
        log_error(logger, "Application startup failed. Exiting.")
        sys.exit(1)

    yield

    # Shutdown
    logger.info("Shutting down Sambee application...")

    # Close all SMB connection pool connections
    logger.info("Closing SMB connection pool...")
    await shutdown_connection_pool()
    logger.info("SMB connection pool closed")

    logger.info("Sambee application shutdown complete")

    # Stop all directory monitors and clean up SMB handles
    try:
        from app.services.directory_monitor import shutdown_monitor

        logger.info("Stopping directory monitors...")
        shutdown_monitor()
        logger.info("Directory monitors stopped")
    except Exception as e:
        log_error(logger, f"Error stopping directory monitors: {e}")

    logger.info(f"Shutdown complete - {datetime.now().isoformat()}")


# FastAPI application instance
app = FastAPI(
    title="Sambee",
    description="Modern SMB share file browser",
    version=__version__,
    lifespan=lifespan,
)


#
# sambee_error_handler
#
@app.exception_handler(SambeeError)
async def sambee_error_handler(request: Request, exc: SambeeError) -> JSONResponse:
    """Handle SambeeError exceptions with clean error messages."""

    log_error(logger, f"Error handling request: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )


#
# log_requests
#
@app.middleware("http")
async def log_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    """Log all HTTP requests with request ID and user context"""

    start_time = datetime.now()

    # Set request ID for this request context
    request_id = set_request_id()

    # Extract filename from query params for viewer/download endpoints
    path_suffix = ""
    if request.url.path.startswith("/api/viewer/") or request.url.path.startswith("/api/browse/"):
        file_path = request.query_params.get("path")
        if file_path:
            from pathlib import PurePosixPath

            filename = PurePosixPath(file_path).name
            path_suffix = f" ({filename})"

    # Log request
    logger.info(f"← {request.method} {request.url.path}{path_suffix}")

    try:
        response = await call_next(request)

        # Add request ID to response headers for client-side correlation
        response.headers["X-Request-ID"] = request_id

        # Log response
        duration = (datetime.now() - start_time).total_seconds() * 1000
        logger.info(f"→ {request.method} {request.url.path} - {response.status_code} ({duration:.0f} ms){path_suffix}")

        return response
    except Exception as e:
        duration = (datetime.now() - start_time).total_seconds() * 1000
        logger.error(
            f"❌ {request.method} {request.url.path} failed after {duration:.0f}ms: {e}{path_suffix}",
            exc_info=True,
        )
        raise


# CORS configuration - only needed in development when frontend runs on separate server
# Production: frontend served from same origin (no CORS needed)
if IS_DEVELOPMENT:
    logger.info(f"CORS enabled for development: {DEV_CORS_ORIGINS}")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=DEV_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    logger.info("CORS disabled (production mode - frontend served from same origin)")

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(browser.router, prefix="/api/browse", tags=["browse"])
app.include_router(viewer.router, prefix="/api/viewer", tags=["viewer"])
app.include_router(websocket.router, prefix="/api", tags=["websocket"])


#
# health_check
#
@app.get("/api/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint"""

    return {"status": "healthy"}


# Serve static files in production
static_path = Path("/app/static")
if static_path.exists():
    app.mount("/assets", StaticFiles(directory=static_path / "assets"), name="assets")

    #
    # serve_spa
    #
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        """Serve React SPA for all non-API routes"""

        # Only serve for non-API routes (API routes are registered with higher priority)
        return FileResponse(static_path / "index.html")
