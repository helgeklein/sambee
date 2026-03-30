import uuid
from datetime import datetime, timezone
from enum import StrEnum

from pydantic import model_validator
from sqlalchemy import Column
from sqlalchemy import Enum as SqlEnum
from sqlmodel import Field, SQLModel


class UserRole(StrEnum):
    EDITOR = "editor"
    VIEWER = "viewer"
    ADMIN = "admin"


class User(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    username: str = Field(unique=True, index=True)
    name: str | None = Field(default=None)
    email: str | None = Field(default=None, index=True)
    password_hash: str
    role: UserRole = Field(
        default=UserRole.EDITOR,
        sa_column=Column(
            SqlEnum(
                UserRole,
                values_callable=lambda enum_cls: [member.value for member in enum_cls],
                native_enum=False,
                validate_strings=True,
            ),
            nullable=False,
            default=UserRole.EDITOR,
        ),
    )
    is_active: bool = Field(default=True, index=True)
    must_change_password: bool = Field(default=False)
    token_version: int = Field(default=0)
    expires_at: datetime | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="before")
    @classmethod
    def normalize_user_fields(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)
        if "username" in normalized and isinstance(normalized["username"], str):
            normalized["username"] = normalized["username"].strip()
        if "name" in normalized and isinstance(normalized["name"], str):
            normalized["name"] = normalized["name"].strip() or None
        if "email" in normalized and isinstance(normalized["email"], str):
            normalized["email"] = normalized["email"].strip().lower() or None

        return normalized


class CurrentUserRead(SQLModel):
    id: uuid.UUID
    username: str
    name: str | None
    email: str | None
    role: UserRole
    is_active: bool
    must_change_password: bool
    expires_at: datetime | None
    created_at: datetime


class AdminUserRead(CurrentUserRead):
    updated_at: datetime


class AdminUserCreate(SQLModel):
    username: str
    name: str | None = None
    email: str | None = None
    role: UserRole = UserRole.EDITOR
    password: str | None = None
    must_change_password: bool = True
    expires_at: datetime | None = None


class AdminUserUpdate(SQLModel):
    username: str | None = None
    name: str | None = None
    email: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    expires_at: datetime | None = None


class AdminUserPasswordReset(SQLModel):
    new_password: str
    must_change_password: bool = True


class AdminUserCreateResult(AdminUserRead):
    temporary_password: str | None = None


class AdminUserPasswordResetResult(SQLModel):
    message: str


class PasswordChangeRequest(SQLModel):
    current_password: str
    new_password: str


def normalize_utc_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def build_current_user_read(user: User) -> CurrentUserRead:
    return CurrentUserRead(
        id=user.id,
        username=user.username,
        name=user.name,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        expires_at=normalize_utc_datetime(user.expires_at),
        created_at=normalize_utc_datetime(user.created_at),
    )


def build_admin_user_read(user: User) -> AdminUserRead:
    return AdminUserRead(
        id=user.id,
        username=user.username,
        name=user.name,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        expires_at=normalize_utc_datetime(user.expires_at),
        created_at=normalize_utc_datetime(user.created_at),
        updated_at=normalize_utc_datetime(user.updated_at),
    )
