from typing import Generator

from app.core.config import settings
from sqlmodel import Session, SQLModel, create_engine

# Database URL
DATABASE_URL = f"sqlite:///{settings.data_dir}/sambee.db"

# Create engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # Needed for SQLite
    echo=settings.debug,
)


def init_db() -> None:
    """Initialize database tables"""
    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    """Dependency to get database session"""
    with Session(engine) as session:
        yield session
