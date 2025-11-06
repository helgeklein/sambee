import logging
import sys
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from app.api import admin, auth, browser, preview, websocket
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.database import engine, init_db
from app.models.user import User

# Configure logging with more detail
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("/tmp/backend.log", mode="a"),
    ],
)
logger = logging.getLogger(__name__)

# Log startup time
logger.info("=" * 80)
logger.info(f"Sambee Backend Starting - {datetime.now().isoformat()}")
logger.info(f"Python: {sys.version}")
logger.info(f"Working Directory: {Path.cwd()}")
logger.info("=" * 80)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize application on startup"""
    try:
        logger.info("Starting Sambee application...")

        # Initialize database
        logger.info("Initializing database...")
        init_db()
        logger.info("✅ Database initialized")

        # Create default admin user if doesn't exist
        logger.info("Checking for admin user...")
        with Session(engine) as session:
            statement = select(User).where(User.username == settings.admin_username)
            admin = session.exec(statement).first()
            if not admin:
                admin = User(
                    username=settings.admin_username,
                    password_hash=get_password_hash(settings.admin_password),
                    is_admin=True,
                )
                session.add(admin)
                session.commit()
                logger.info(f"✅ Created default admin user: {settings.admin_username}")
            else:
                logger.info(f"✅ Admin user exists: {settings.admin_username}")

        logger.info("🚀 Sambee application startup complete!")
        logger.info("API Documentation: http://localhost:8000/docs")

    except Exception as e:
        logger.error(f"❌ Startup failed: {e}", exc_info=True)
        raise

    yield

    logger.info("Shutting down Sambee application...")

    # Stop all directory monitors and clean up SMB handles
    try:
        from app.services.directory_monitor import shutdown_monitor

        logger.info("Stopping directory monitors...")
        shutdown_monitor()
        logger.info("✅ Directory monitors stopped")
    except Exception as e:
        logger.error(f"Error stopping directory monitors: {e}", exc_info=True)

    logger.info(f"Shutdown complete - {datetime.now().isoformat()}")


app = FastAPI(
    title="Sambee",
    description="Modern SMB share file browser",
    version="0.1.0",
    lifespan=lifespan,
)


# Request logging middleware
@app.middleware("http")
async def log_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Log all HTTP requests"""
    start_time = datetime.now()

    # Log request
    logger.info(f"→ {request.method} {request.url.path}")

    try:
        response = await call_next(request)

        # Log response
        duration = (datetime.now() - start_time).total_seconds() * 1000
        logger.info(
            f"← {request.method} {request.url.path} - {response.status_code} ({duration:.2f}ms)"
        )

        return response
    except Exception as e:
        duration = (datetime.now() - start_time).total_seconds() * 1000
        logger.error(
            f"❌ {request.method} {request.url.path} failed after {duration:.2f}ms: {e}",
            exc_info=True,
        )
        raise


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # React dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(browser.router, prefix="/api/browse", tags=["browse"])
app.include_router(preview.router, prefix="/api/preview", tags=["preview"])
app.include_router(websocket.router, prefix="/api", tags=["websocket"])


# Health check
@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "healthy"}


# Serve static files in production
static_path = Path("/app/static")
if static_path.exists():
    app.mount("/assets", StaticFiles(directory=static_path / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse | None:
        """Serve React SPA for all non-API routes"""
        if not full_path.startswith("api/"):
            return FileResponse(static_path / "index.html")
        return None
