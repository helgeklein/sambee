import re
import unicodedata
import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Optional

from pydantic import field_validator, model_validator
from sqlalchemy import Column, event, text
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.engine import Connection as SQLAlchemyConnection
from sqlmodel import Field, SQLModel


def slugify_connection_name(name: str) -> str:
    """Convert a connection name into a URL-safe slug."""

    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug or "connection"


def generate_unique_connection_slug(name: str, existing_slugs: set[str]) -> str:
    """Generate a unique immutable slug for a connection name."""

    base_slug = slugify_connection_name(name)
    candidate = base_slug
    suffix = 2

    while candidate in existing_slugs:
        candidate = f"{base_slug}-{suffix}"
        suffix += 1

    return candidate


def ensure_connection_slug(target: "Connection", existing_slugs: set[str] | None = None) -> str:
    """Populate a connection slug when one was not provided explicitly."""

    if target.slug:
        return target.slug

    target.slug = generate_unique_connection_slug(target.name, existing_slugs or set())
    return target.slug


class ConnectionScope(StrEnum):
    SHARED = "shared"
    PRIVATE = "private"


class ConnectionAccessMode(StrEnum):
    READ_WRITE = "read_write"
    READ_ONLY = "read_only"


class Connection(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(index=True)
    slug: str = Field(index=True, unique=True)
    type: str = Field(default="smb")  # 'smb', 'sftp' in future
    host: str
    port: int = Field(default=445)
    share_name: Optional[str] = None
    username: str
    password_encrypted: str  # Encrypted with Fernet
    path_prefix: Optional[str] = Field(default="/")  # Base path within share
    scope: ConnectionScope = Field(
        default=ConnectionScope.PRIVATE,
        sa_column=Column(
            SqlEnum(
                ConnectionScope,
                values_callable=lambda enum_cls: [member.value for member in enum_cls],
                native_enum=False,
                validate_strings=True,
            ),
            nullable=False,
            default=ConnectionScope.PRIVATE,
            index=True,
        ),
    )
    access_mode: ConnectionAccessMode = Field(
        default=ConnectionAccessMode.READ_WRITE,
        sa_column=Column(
            SqlEnum(
                ConnectionAccessMode,
                values_callable=lambda enum_cls: [member.value for member in enum_cls],
                native_enum=False,
                validate_strings=True,
            ),
            nullable=False,
            default=ConnectionAccessMode.READ_WRITE,
            index=True,
        ),
    )
    owner_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def __init__(self, **data: object) -> None:
        if not data.get("slug") and isinstance(data.get("name"), str):
            data["slug"] = slugify_connection_name(str(data["name"]))
        super().__init__(**data)

    @model_validator(mode="before")
    @classmethod
    def ensure_slug(cls, data: object) -> object:
        """Populate a basic slug for direct model construction when absent."""

        if not isinstance(data, dict):
            return data

        slug = data.get("slug")
        name = data.get("name")
        if slug or not isinstance(name, str):
            return data

        return {
            **data,
            "slug": slugify_connection_name(name),
        }


@event.listens_for(Connection, "before_insert")
def assign_connection_slug_before_insert(
    mapper: object,
    connection: SQLAlchemyConnection,
    target: Connection,
) -> None:
    """Assign a unique slug for ORM-created connections that omitted one."""

    del mapper

    if target.slug:
        return

    existing_slugs = {str(slug) for slug in connection.execute(text("SELECT slug FROM connection WHERE slug IS NOT NULL")).scalars()}
    ensure_connection_slug(target, existing_slugs)


class ConnectionCreate(SQLModel):
    name: str
    type: str = "smb"
    host: str
    port: int = 445
    share_name: str
    username: str
    password: str
    path_prefix: Optional[str] = "/"
    scope: ConnectionScope = ConnectionScope.PRIVATE
    access_mode: ConnectionAccessMode = ConnectionAccessMode.READ_WRITE

    #
    # validate_not_empty
    #
    @field_validator("name", "host", "share_name", "username")
    @classmethod
    def validate_not_empty(cls, v: str) -> str:
        """Validate that required string fields are not empty."""

        if not v or not v.strip():
            raise ValueError("Field cannot be empty")
        return v


class ConnectionUpdate(SQLModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    share_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None  # Only update if provided
    path_prefix: Optional[str] = None
    scope: Optional[ConnectionScope] = None
    access_mode: Optional[ConnectionAccessMode] = None


class ConnectionRead(SQLModel):
    id: uuid.UUID
    name: str
    slug: str
    type: str
    host: str
    port: int
    share_name: Optional[str]
    username: str
    path_prefix: Optional[str]
    scope: ConnectionScope
    access_mode: ConnectionAccessMode
    can_manage: bool
    created_at: datetime
    updated_at: datetime


class ConnectionVisibilityOptionRead(SQLModel):
    value: ConnectionScope
    label: str
    description: str
    available: bool
    unavailable_reason: Optional[str] = None
