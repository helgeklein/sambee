import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from app.api import admin, auth, browser, preview
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.database import engine, init_db
from app.models.user import User

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize application on startup"""
    logger.info("Starting Sambee application...")

    # Initialize database
    init_db()

    # Create default admin user if doesn't exist
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
            logger.info(f"Created default admin user: {settings.admin_username}")

    yield

    logger.info("Shutting down Sambee application...")


app = FastAPI(
    title="Sambee",
    description="Modern SMB share file browser",
    version="0.1.0",
    lifespan=lifespan,
)

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
