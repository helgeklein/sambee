from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Optional

from pydantic import model_validator
from sqlmodel import Field, SQLModel

from app.core.system_setting_definitions import SystemSettingKey, SystemSettingSource


class SystemSetting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="user.id", index=True)


class IntegerSystemSettingRead(SQLModel):
    key: SystemSettingKey
    label: str
    description: str
    value: int
    source: SystemSettingSource
    default_value: int
    min_value: int
    max_value: int
    step: int


class PreprocessorAdvancedSettingsRead(SQLModel):
    max_file_size_bytes: IntegerSystemSettingRead
    timeout_seconds: IntegerSystemSettingRead


class AdvancedSystemSettingsRead(SQLModel):
    preprocessors: dict[str, PreprocessorAdvancedSettingsRead]


class SmbAuthenticationMode(StrEnum):
    NEGOTIATE = "negotiate"
    KERBEROS_REQUIRED = "kerberos_required"


class SmbEncryptionMode(StrEnum):
    SIGNING_ONLY = "signing_only"
    ENCRYPTION_REQUIRED = "encryption_required"


class SmbPolicySettings(SQLModel):
    """Validated, administrator-managed policy for all SMB backends."""

    authentication_mode: SmbAuthenticationMode = SmbAuthenticationMode.NEGOTIATE
    encryption_mode: SmbEncryptionMode = SmbEncryptionMode.SIGNING_ONLY
    connection_timeout_seconds: int = Field(default=30, ge=5, le=120)


class SmbSettingsRead(SQLModel):
    read_chunk_size_bytes: IntegerSystemSettingRead
    policy: SmbPolicySettings
    policy_source: SystemSettingSource
    require_signing: bool = True
    require_encryption: bool = False


class SmbSettingsUpdate(SQLModel):
    read_chunk_size_bytes: Optional[int] = None
    policy: Optional[SmbPolicySettings] = None
    reset_read_chunk_size_bytes: bool = False
    reset_policy: bool = False

    @model_validator(mode="after")
    def prevent_conflicting_resets(self) -> "SmbSettingsUpdate":
        if self.read_chunk_size_bytes is not None and self.reset_read_chunk_size_bytes:
            raise ValueError("Cannot update and reset the SMB read chunk size in one request")
        if self.policy is not None and self.reset_policy:
            raise ValueError("Cannot update and reset the SMB policy in one request")
        return self


class PreprocessorAdvancedSettingsUpdate(SQLModel):
    max_file_size_bytes: Optional[int] = None
    timeout_seconds: Optional[int] = None


class AdvancedSystemSettingsPreprocessorsUpdate(SQLModel):
    imagemagick: Optional[PreprocessorAdvancedSettingsUpdate] = None


class AdvancedSystemSettingsUpdate(SQLModel):
    preprocessors: Optional[AdvancedSystemSettingsPreprocessorsUpdate] = None
    reset_keys: list[SystemSettingKey] = Field(default_factory=list)


class NetworkSettingsRead(SQLModel):
    public_url: str
    trusted_proxy_cidrs: list[str]


class NetworkSettingsUpdate(SQLModel):
    public_url: str = Field(max_length=2048)
    trusted_proxy_cidrs: list[str] = Field(default_factory=list, max_length=100)


class AboutSettingsRead(SQLModel):
    version: str
    build_time: str
    git_commit: str
    started_at: datetime
    architecture: str
    logical_cpu_count: Optional[int] = None
    memory_bytes: Optional[int] = None
    python_runtime: str


class PublicSupportReportRead(SQLModel):
    content: str
