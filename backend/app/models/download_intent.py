import uuid
from datetime import datetime
from typing import ClassVar

from sqlmodel import Field, SQLModel


class DownloadIntent(SQLModel, table=True):
    """Short-lived, single-use authorization for a native browser download."""

    __tablename__: ClassVar[str] = "download_intent"

    token_hash: str = Field(primary_key=True)
    user_id: uuid.UUID = Field(index=True)
    token_version: int
    connection_id: uuid.UUID
    path: str
    member_path: str | None = None
    expires_at: datetime = Field(index=True)
