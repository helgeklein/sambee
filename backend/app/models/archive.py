"""Read-only ZIP archive DTOs shared by archive browse endpoints."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.file import FileType


class ArchiveIdentity(BaseModel):
    """Best-effort identity for an archive revision."""

    path: str
    size: int
    modified_at: datetime | None = None


class ArchiveEntryInfo(BaseModel):
    """Safe display metadata for one virtual ZIP entry."""

    name: str
    path: str
    type: FileType
    size: int | None = None
    compressed_size: int | None = None
    compression_method: int | None = None
    crc32: int | None = None
    modified_at: datetime | None = None
    state: Literal["readable", "blocked", "unavailable"] = "unavailable"
    is_hidden: bool = False


class ArchiveDirectoryListing(BaseModel):
    """One bounded record-order page from an archive central directory."""

    archive: ArchiveIdentity
    path: str
    items: list[ArchiveEntryInfo]
    next_cursor: str | None = None
    page_size: int = Field(ge=1, le=500)
