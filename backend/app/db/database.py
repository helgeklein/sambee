from sqlmodel import SQLModel, create_engine, Session
from pathlib import Path

from app.core.config import settings

# Database URL
DATABASE_URL = f"sqlite:///{settings.data_dir}/sambee.db"

# Create engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # Needed for SQLite
    echo=settings.debug
)


def init_db():
    """Initialize database tables"""
    SQLModel.metadata.create_all(engine)


def get_session():
    """Dependency to get database session"""
    with Session(engine) as session:
        yield session