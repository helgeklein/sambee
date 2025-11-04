import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Connection(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(index=True)
    type: str = Field(default="smb")  # 'smb', 'sftp' in future
    host: str
    port: int = Field(default=445)
    share_name: Optional[str] = None
    username: str
    password_encrypted: str  # Encrypted with Fernet
    path_prefix: Optional[str] = Field(default="/")  # Base path within share
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ConnectionCreate(SQLModel):
    name: str
    type: str = "smb"
    host: str
    port: int = 445
    share_name: str
    username: str
    password: str
    path_prefix: Optional[str] = "/"


class ConnectionUpdate(SQLModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    share_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None  # Only update if provided
    path_prefix: Optional[str] = None


class ConnectionRead(SQLModel):
    id: uuid.UUID
    name: str
    type: str
    host: str
    port: int
    share_name: Optional[str]
    username: str
    path_prefix: Optional[str]
    created_at: datetime
    updated_at: datetime
