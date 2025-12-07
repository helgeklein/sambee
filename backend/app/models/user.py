import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str
    is_admin: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Frontend logging preferences (per-user)
    enable_frontend_logging: bool = Field(default=False)
    frontend_log_levels: str = Field(default="error,warn,info,debug")  # Comma-separated
    frontend_log_components: str = Field(default="")  # Empty = all, comma-separated otherwise
