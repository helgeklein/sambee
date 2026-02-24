from datetime import datetime
from enum import StrEnum
from typing import List, Optional

from pydantic import BaseModel


class FileType(StrEnum):
    FILE = "file"
    DIRECTORY = "directory"


class FileInfo(BaseModel):
    name: str
    path: str
    type: FileType
    size: Optional[int] = None
    mime_type: Optional[str] = None
    created_at: Optional[datetime] = None
    modified_at: Optional[datetime] = None
    is_readable: bool = True
    is_hidden: bool = False


class DirectoryListing(BaseModel):
    path: str
    items: List[FileInfo]
    total: int


class RenameRequest(BaseModel):
    """Request model for renaming a file or directory."""

    path: str
    new_name: str


class CreateItemRequest(BaseModel):
    """Request model for creating a new file or directory."""

    parent_path: str
    name: str
    type: FileType


class CopyMoveRequest(BaseModel):
    """Request model for copying or moving a file or directory.

    ``source_path`` is relative to the source connection's share.
    ``dest_path`` is relative to the destination connection's share
    (or the same connection when ``dest_connection_id`` is omitted).
    """

    source_path: str
    dest_path: str
    dest_connection_id: Optional[str] = None


class DirectorySearchResult(BaseModel):
    """Response model for directory search (quick navigate)."""

    results: List[str]
    total_matches: int
    cache_state: str
    directory_count: int
