from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import RLock
from typing import Optional

from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, select

import app.core.config as config_module
import app.db.database as database_module
from app.core.logging import get_logger
from app.core.system_setting_definitions import (
    SYSTEM_SETTING_DEFINITIONS,
    IntegerSystemSettingDefinition,
    SystemSettingKey,
    SystemSettingSource,
)
from app.models.system_settings import (
    AdvancedSystemSettingsRead,
    AdvancedSystemSettingsUpdate,
    IntegerSystemSettingRead,
    PreprocessorAdvancedSettingsRead,
    SmbAdvancedSettingsRead,
    SystemSetting,
)

logger = get_logger(__name__)
SYSTEM_SETTINGS_TABLE_NAME = "systemsetting"


@dataclass(frozen=True)
class ResolvedIntegerSystemSetting:
    definition: IntegerSystemSettingDefinition
    value: int
    source: SystemSettingSource


class SystemSettingsStore:
    def __init__(self) -> None:
        self._cache: dict[str, str] = {}
        self._loaded = False
        self._lock = RLock()

    def warm_cache(self) -> None:
        with self._lock:
            self._cache, self._loaded = self._read_all_overrides()

    def get_override(self, key: SystemSettingKey) -> Optional[str]:
        if not self._loaded:
            self.warm_cache()
        return self._cache.get(key.value)

    def refresh_from_session(self, session: Session) -> None:
        with self._lock:
            self._cache, self._loaded = _read_overrides_from_session(session)

    def _read_all_overrides(self) -> tuple[dict[str, str], bool]:
        with Session(database_module.engine) as session:
            return _read_overrides_from_session(session)


store = SystemSettingsStore()


def _system_settings_table_exists(session: Session) -> bool:
    bind = session.get_bind()
    if bind is None:
        return False

    return bool(inspect(bind).has_table(SYSTEM_SETTINGS_TABLE_NAME))


def _read_overrides_from_session(session: Session) -> tuple[dict[str, str], bool]:
    if not _system_settings_table_exists(session):
        return {}, False

    try:
        rows = session.exec(select(SystemSetting)).all()
    except OperationalError as exc:
        if f"no such table: {SYSTEM_SETTINGS_TABLE_NAME}" in str(exc).lower():
            return {}, False
        raise

    return {row.key: row.value for row in rows}, True


def _validate_integer_value(definition: IntegerSystemSettingDefinition, value: int) -> int:
    if value < definition.min_value or value > definition.max_value:
        raise ValueError(f"{definition.label} must be between {definition.min_value} and {definition.max_value}")
    return value


def _parse_override_value(definition: IntegerSystemSettingDefinition, raw_value: str) -> int:
    try:
        parsed = int(raw_value)
    except ValueError as exc:
        raise ValueError(f"Stored override for {definition.key.value} is not a valid integer") from exc

    return _validate_integer_value(definition, parsed)


def _resolve_integer_setting(definition: IntegerSystemSettingDefinition) -> ResolvedIntegerSystemSetting:
    override_value = store.get_override(definition.key)
    if override_value is not None:
        try:
            return ResolvedIntegerSystemSetting(
                definition=definition,
                value=_parse_override_value(definition, override_value),
                source=SystemSettingSource.DATABASE,
            )
        except ValueError as exc:
            logger.error(f"Invalid database override for {definition.key.value}: {exc}")

    configured_value = _validate_integer_value(definition, int(getattr(config_module.settings, definition.config_attr)))
    source = (
        SystemSettingSource.CONFIG_FILE if definition.config_attr in config_module.configured_setting_keys else SystemSettingSource.DEFAULT
    )
    return ResolvedIntegerSystemSetting(definition=definition, value=configured_value, source=source)


def _build_integer_read(definition: IntegerSystemSettingDefinition) -> IntegerSystemSettingRead:
    resolved = _resolve_integer_setting(definition)
    return IntegerSystemSettingRead(
        key=definition.key,
        label=definition.label,
        description=definition.description,
        value=resolved.value,
        source=resolved.source,
        default_value=definition.default_value,
        min_value=definition.min_value,
        max_value=definition.max_value,
        step=definition.step,
    )


def get_integer_setting_value(key: SystemSettingKey) -> int:
    return _resolve_integer_setting(SYSTEM_SETTING_DEFINITIONS[key]).value


def build_advanced_system_settings_read() -> AdvancedSystemSettingsRead:
    return AdvancedSystemSettingsRead(
        smb=SmbAdvancedSettingsRead(
            read_chunk_size_bytes=_build_integer_read(SYSTEM_SETTING_DEFINITIONS[SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES])
        ),
        preprocessors={
            "imagemagick": PreprocessorAdvancedSettingsRead(
                max_file_size_bytes=_build_integer_read(
                    SYSTEM_SETTING_DEFINITIONS[SystemSettingKey.PREPROCESSOR_IMAGEMAGICK_MAX_FILE_SIZE_BYTES]
                ),
                timeout_seconds=_build_integer_read(SYSTEM_SETTING_DEFINITIONS[SystemSettingKey.PREPROCESSOR_IMAGEMAGICK_TIMEOUT_SECONDS]),
            ),
            "graphicsmagick": PreprocessorAdvancedSettingsRead(
                max_file_size_bytes=_build_integer_read(
                    SYSTEM_SETTING_DEFINITIONS[SystemSettingKey.PREPROCESSOR_GRAPHICSMAGICK_MAX_FILE_SIZE_BYTES]
                ),
                timeout_seconds=_build_integer_read(
                    SYSTEM_SETTING_DEFINITIONS[SystemSettingKey.PREPROCESSOR_GRAPHICSMAGICK_TIMEOUT_SECONDS]
                ),
            ),
        },
    )


def _extract_updates(payload: AdvancedSystemSettingsUpdate) -> dict[SystemSettingKey, int]:
    updates: dict[SystemSettingKey, int] = {}

    if payload.smb and payload.smb.read_chunk_size_bytes is not None:
        updates[SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES] = payload.smb.read_chunk_size_bytes

    preprocessors = payload.preprocessors
    if preprocessors and preprocessors.imagemagick:
        imagemagick = preprocessors.imagemagick
        if imagemagick.max_file_size_bytes is not None:
            updates[SystemSettingKey.PREPROCESSOR_IMAGEMAGICK_MAX_FILE_SIZE_BYTES] = imagemagick.max_file_size_bytes
        if imagemagick.timeout_seconds is not None:
            updates[SystemSettingKey.PREPROCESSOR_IMAGEMAGICK_TIMEOUT_SECONDS] = imagemagick.timeout_seconds

    if preprocessors and preprocessors.graphicsmagick:
        graphicsmagick = preprocessors.graphicsmagick
        if graphicsmagick.max_file_size_bytes is not None:
            updates[SystemSettingKey.PREPROCESSOR_GRAPHICSMAGICK_MAX_FILE_SIZE_BYTES] = graphicsmagick.max_file_size_bytes
        if graphicsmagick.timeout_seconds is not None:
            updates[SystemSettingKey.PREPROCESSOR_GRAPHICSMAGICK_TIMEOUT_SECONDS] = graphicsmagick.timeout_seconds

    return updates


def _extract_reset_keys(payload: AdvancedSystemSettingsUpdate) -> set[SystemSettingKey]:
    return set(payload.reset_keys)


def update_advanced_system_settings(
    payload: AdvancedSystemSettingsUpdate, *, updated_by_user_id: Optional[uuid.UUID], session: Session
) -> None:
    updates = _extract_updates(payload)
    reset_keys = _extract_reset_keys(payload)

    conflicting_keys = reset_keys.intersection(updates.keys())
    if conflicting_keys:
        conflicts = ", ".join(sorted(key.value for key in conflicting_keys))
        raise ValueError(f"Cannot update and reset the same setting in one request: {conflicts}")

    if not updates and not reset_keys:
        return

    for key in reset_keys:
        setting = session.get(SystemSetting, key.value)
        if setting is not None:
            session.delete(setting)

    for key, value in updates.items():
        definition = SYSTEM_SETTING_DEFINITIONS[key]
        validated_value = _validate_integer_value(definition, int(value))
        setting = session.get(SystemSetting, key.value)

        if setting is None:
            setting = SystemSetting(key=key.value, value=str(validated_value), updated_by_user_id=updated_by_user_id)
        else:
            setting.value = str(validated_value)
            setting.updated_at = datetime.now(timezone.utc)
            setting.updated_by_user_id = updated_by_user_id

        session.add(setting)

    session.commit()
    store.refresh_from_session(session)
