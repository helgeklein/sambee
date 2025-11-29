from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel


class FileType(str, Enum):
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
