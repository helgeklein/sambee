from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

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


class SmbAdvancedSettingsRead(SQLModel):
    read_chunk_size_bytes: IntegerSystemSettingRead


class PreprocessorAdvancedSettingsRead(SQLModel):
    max_file_size_bytes: IntegerSystemSettingRead
    timeout_seconds: IntegerSystemSettingRead


class AdvancedSystemSettingsRead(SQLModel):
    smb: SmbAdvancedSettingsRead
    preprocessors: dict[str, PreprocessorAdvancedSettingsRead]


class SmbAdvancedSettingsUpdate(SQLModel):
    read_chunk_size_bytes: Optional[int] = None


class PreprocessorAdvancedSettingsUpdate(SQLModel):
    max_file_size_bytes: Optional[int] = None
    timeout_seconds: Optional[int] = None


class AdvancedSystemSettingsPreprocessorsUpdate(SQLModel):
    imagemagick: Optional[PreprocessorAdvancedSettingsUpdate] = None


class AdvancedSystemSettingsUpdate(SQLModel):
    smb: Optional[SmbAdvancedSettingsUpdate] = None
    preprocessors: Optional[AdvancedSystemSettingsPreprocessorsUpdate] = None
    reset_keys: list[SystemSettingKey] = Field(default_factory=list)
