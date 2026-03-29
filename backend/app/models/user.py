import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from pydantic import model_validator
from sqlalchemy import Column
from sqlalchemy import Enum as SqlEnum
from sqlmodel import Field, SQLModel


class UserRole(StrEnum):
    REGULAR = "regular"
    ADMIN = "admin"


class User(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str
    role: UserRole = Field(
        default=UserRole.REGULAR,
        sa_column=Column(
            SqlEnum(
                UserRole,
                values_callable=lambda enum_cls: [member.value for member in enum_cls],
                native_enum=False,
                validate_strings=True,
            ),
            nullable=False,
            default=UserRole.REGULAR,
        ),
    )
    is_active: bool = Field(default=True, index=True)
    must_change_password: bool = Field(default=False)
    token_version: int = Field(default=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def __init__(self, **data: Any) -> None:
        legacy_is_admin = data.pop("is_admin", None)
        if "role" not in data and legacy_is_admin is not None:
            data["role"] = UserRole.ADMIN if legacy_is_admin else UserRole.REGULAR
        super().__init__(**data)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_admin_flag(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)
        if "username" in normalized and isinstance(normalized["username"], str):
            normalized["username"] = normalized["username"].strip()

        if "role" not in normalized and "is_admin" in normalized:
            normalized["role"] = UserRole.ADMIN if normalized.pop("is_admin") else UserRole.REGULAR

        return normalized

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.ADMIN


class CurrentUserRead(SQLModel):
    id: uuid.UUID
    username: str
    role: UserRole
    is_admin: bool
    is_active: bool
    must_change_password: bool
    created_at: datetime


class AdminUserRead(CurrentUserRead):
    updated_at: datetime


class AdminUserCreate(SQLModel):
    username: str
    role: UserRole = UserRole.REGULAR
    password: str | None = None
    must_change_password: bool = True


class AdminUserUpdate(SQLModel):
    username: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None


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


def build_current_user_read(user: User) -> CurrentUserRead:
    return CurrentUserRead(
        id=user.id,
        username=user.username,
        role=user.role,
        is_admin=user.is_admin,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        created_at=user.created_at,
    )


def build_admin_user_read(user: User) -> AdminUserRead:
    return AdminUserRead(
        id=user.id,
        username=user.username,
        role=user.role,
        is_admin=user.is_admin,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )
