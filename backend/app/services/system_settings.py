from __future__ import annotations

import os
import platform
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from ipaddress import ip_network
from pathlib import Path
from threading import RLock
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, select

import app.core.config as config_module
import app.db.database as database_module
from app import __version__
from app.core.logging import get_logger
from app.core.system_setting_definitions import (
    SYSTEM_SETTING_DEFINITIONS,
    IntegerSystemSettingDefinition,
    SystemSettingKey,
    SystemSettingSource,
)
from app.models.oidc import OidcFlow
from app.models.system_settings import (
    AboutSettingsRead,
    AdvancedSystemSettingsRead,
    AdvancedSystemSettingsUpdate,
    IntegerSystemSettingRead,
    NetworkSettingsRead,
    NetworkSettingsUpdate,
    PreprocessorAdvancedSettingsRead,
    SmbAdvancedSettingsRead,
    SystemSetting,
)
from app.services.oidc_configuration import canonicalize_public_url

logger = get_logger(__name__)
SYSTEM_SETTINGS_TABLE_NAME = "systemsetting"
NETWORK_PUBLIC_URL_KEY = "network.public_url"
NETWORK_TRUSTED_PROXY_CIDRS_KEY = "network.trusted_proxy_cidrs"
APP_ROOT = Path(__file__).resolve().parents[3]
BUILD_TIME_PATH = Path("/BUILD_TIME")
GIT_COMMIT_PATH = Path("/GIT_COMMIT")
PROCESS_STARTED_AT = datetime.now(timezone.utc)


@dataclass(frozen=True)
class ResolvedIntegerSystemSetting:
    definition: IntegerSystemSettingDefinition
    value: int
    source: SystemSettingSource


def _read_first_available_text(paths: list[Path], fallback: str = "unknown") -> str:
    for path in paths:
        try:
            value = path.read_text().strip()
        except OSError:
            continue
        if value:
            return value
    return fallback


def _is_containerized() -> bool:
    if Path("/.dockerenv").exists():
        return True

    try:
        cgroup_content = Path("/proc/1/cgroup").read_text()
    except OSError:
        return False

    return any(marker in cgroup_content for marker in ("docker", "containerd", "kubepods", "podman"))


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
        },
    )


def build_about_settings_read() -> AboutSettingsRead:
    return AboutSettingsRead(
        version=__version__,
        build_time=_read_first_available_text([BUILD_TIME_PATH]),
        git_commit=_read_first_available_text([GIT_COMMIT_PATH, APP_ROOT / "GIT_COMMIT"]),
        started_at=PROCESS_STARTED_AT,
        operating_system=platform.system() or "unknown",
        architecture=platform.machine() or "unknown",
        python_version=platform.python_version(),
        containerized=_is_containerized(),
        logical_cpu_count=os.cpu_count(),
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


def _normalized_trusted_proxy_cidrs(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        for item in value.split(","):
            candidate = item.strip()
            if not candidate:
                continue
            canonical = str(ip_network(candidate, strict=False))
            if canonical not in seen:
                seen.add(canonical)
                normalized.append(canonical)
    return normalized


def _network_setting_value(session: Session, key: str) -> str:
    setting = session.get(SystemSetting, key)
    return setting.value if setting is not None else ""


def build_network_settings_read(session: Session) -> NetworkSettingsRead:
    public_url = _network_setting_value(session, NETWORK_PUBLIC_URL_KEY)
    trusted_proxy_cidrs = _normalized_trusted_proxy_cidrs([_network_setting_value(session, NETWORK_TRUSTED_PROXY_CIDRS_KEY)])
    return NetworkSettingsRead(public_url=public_url, trusted_proxy_cidrs=trusted_proxy_cidrs)


def update_network_settings(
    payload: NetworkSettingsUpdate, *, updated_by_user_id: Optional[uuid.UUID], session: Session
) -> NetworkSettingsRead:
    public_url = canonicalize_public_url(payload.public_url)
    if urlparse(public_url).path:
        raise ValueError("Public URL must not include a path")
    trusted_proxy_cidrs = _normalized_trusted_proxy_cidrs(payload.trusted_proxy_cidrs)
    current_public_url = _network_setting_value(session, NETWORK_PUBLIC_URL_KEY)
    now = datetime.now(timezone.utc)

    for key, value in (
        (NETWORK_PUBLIC_URL_KEY, public_url),
        (NETWORK_TRUSTED_PROXY_CIDRS_KEY, ",".join(trusted_proxy_cidrs)),
    ):
        setting = session.get(SystemSetting, key)
        if setting is None:
            session.add(SystemSetting(key=key, value=value, updated_by_user_id=updated_by_user_id))
        else:
            setting.value = value
            setting.updated_at = now
            setting.updated_by_user_id = updated_by_user_id
            session.add(setting)

    if current_public_url and current_public_url != public_url:
        for flow in session.exec(select(OidcFlow)).all():
            session.delete(flow)

    session.commit()
    return build_network_settings_read(session)
