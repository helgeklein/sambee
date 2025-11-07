import os
from typing import Generator

from app.core.config import settings
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

# Database URL
DATABASE_URL = f"sqlite:///{settings.data_dir}/sambee.db"

# Detect if we're in a testing/CI environment
# In these environments, use StaticPool or NullPool to avoid threading issues
is_testing = (
    os.getenv("PYTEST_CURRENT_TEST") is not None
    or os.getenv("GITHUB_ACTIONS") is not None
)

# Create engine with appropriate pooling strategy
if is_testing:
    # Use StaticPool for testing - single connection shared across all threads
    # This avoids SQLite threading issues in pytest
    engine = create_engine(
        DATABASE_URL,
        connect_args={
            "check_same_thread": False,
        },
        poolclass=StaticPool,
        echo=settings.debug,
    )
else:
    # Use connection pooling for production/development
    engine = create_engine(
        DATABASE_URL,
        connect_args={
            "check_same_thread": False,  # Required for FastAPI async/threading
            "timeout": 30.0,  # Wait up to 30 seconds for database locks
        },
        pool_size=20,  # Maintain 20 connections in pool
        max_overflow=40,  # Allow up to 60 total connections (20 + 40)
        pool_pre_ping=True,  # Verify connections are alive before using
        pool_recycle=3600,  # Recycle connections after 1 hour
        echo=settings.debug,
    )


# Enable WAL mode and other performance optimizations for SQLite
# Only in non-testing environments to avoid threading issues
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    """Configure SQLite connection for better concurrency and performance."""
    cursor = dbapi_conn.cursor()

    if not is_testing:
        # WAL mode: Allows concurrent reads while writing, and writes while reading
        # This is the single most important setting for concurrent applications
        # Disabled in testing to avoid threading issues with StaticPool
        cursor.execute("PRAGMA journal_mode=WAL")

        # NORMAL synchronous mode is safe with WAL and much faster than FULL
        cursor.execute("PRAGMA synchronous=NORMAL")

        # Busy timeout: Wait up to 30 seconds when database is locked
        # Prevents immediate SQLITE_BUSY errors during concurrent writes
        cursor.execute("PRAGMA busy_timeout=30000")

        # Cache size: ~40MB cache for better performance
        # Negative value means KB (10000 * 4KB = ~40MB)
        cursor.execute("PRAGMA cache_size=-40000")

    # Foreign keys: Always enabled for referential integrity
    cursor.execute("PRAGMA foreign_keys=ON")

    cursor.close()


def init_db() -> None:
    """Initialize database tables"""
    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    """Dependency to get database session"""
    with Session(engine) as session:
        yield session
