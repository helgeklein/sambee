from __future__ import annotations

import json
import os
import platform
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from ipaddress import ip_network
from pathlib import Path
from threading import RLock
from typing import Optional
from urllib.parse import urlparse, urlsplit

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
from app.models.connection import Connection
from app.models.oidc import OidcFlow, OidcProviderConfiguration
from app.models.system_settings import (
    AboutSettingsRead,
    AdvancedSystemSettingsRead,
    AdvancedSystemSettingsUpdate,
    IntegerSystemSettingRead,
    NetworkSettingsRead,
    NetworkSettingsUpdate,
    PreprocessorAdvancedSettingsRead,
    PublicSupportReportRead,
    SmbAdvancedSettingsRead,
    SystemSetting,
)
from app.services.authentication_config import get_effective_authentication_mode
from app.services.oidc_configuration import canonicalize_public_url

logger = get_logger(__name__)
SYSTEM_SETTINGS_TABLE_NAME = "systemsetting"
NETWORK_PUBLIC_URL_KEY = "network.public_url"
NETWORK_TRUSTED_PROXY_CIDRS_KEY = "network.trusted_proxy_cidrs"
APP_ROOT = Path(__file__).resolve().parents[3]
BUILD_TIME_PATH = Path("/BUILD_TIME")
GIT_COMMIT_PATH = Path("/GIT_COMMIT")
PROCESS_STARTED_AT = datetime.now(timezone.utc)
CGROUP_MEMORY_LIMIT_PATHS = (Path("/sys/fs/cgroup/memory.max"), Path("/sys/fs/cgroup/memory/memory.limit_in_bytes"))
UNLIMITED_MEMORY_THRESHOLD_BYTES = 1 << 60
PUBLIC_SUPPORT_REPORT_FORMAT_VERSION = 1
PUBLIC_SUPPORT_REPORT_TITLE = "Sambee public support report"
STANDARD_OIDC_CLAIMS = frozenset({"sub", "name", "email", "groups", "preferred_username"})
STANDARD_OIDC_SCOPES = frozenset({"openid", "profile", "email", "address", "phone", "offline_access"})
CONFIG_FILE_SETTING_FIELDS = (
    ("app.log_level", "log_level"),
    ("app.access_log_level", "access_log_level"),
    ("app.protocol_log_level", "protocol_log_level"),
    ("security.auth_method", "auth_method"),
    ("security.access_token_expire_minutes", "access_token_expire_minutes"),
    ("image_viewer.conv_size_thresh", "image_viewer_conv_size_thresh"),
    ("frontend_logging.logging_enabled", "frontend_logging_enabled"),
    ("frontend_logging.log_level", "frontend_log_level"),
    ("frontend_logging.tracing_enabled", "frontend_tracing_enabled"),
    ("frontend_logging.tracing_retention_hours", "frontend_tracing_retention_hours"),
    ("frontend_logging.tracing_level", "frontend_tracing_level"),
    ("directory_cache.coalesce_interval_seconds", "directory_cache_coalesce_interval_seconds"),
    ("directory_cache.max_staleness_minutes", "directory_cache_max_staleness_minutes"),
)


@dataclass(frozen=True)
class ResolvedIntegerSystemSetting:
    definition: IntegerSystemSettingDefinition
    value: int
    source: SystemSettingSource


class PublicSupportReportAliases:
    def __init__(self) -> None:
        self._aliases: dict[tuple[str, str], str] = {}
        self._next_index_by_kind: Counter[str] = Counter()

    def value(self, kind: str, value: str) -> str:
        key = (kind, value)
        alias = self._aliases.get(key)
        if alias is not None:
            return alias
        self._next_index_by_kind[kind] += 1
        alias = f"{kind}-{self._next_index_by_kind[kind]}"
        self._aliases[key] = alias
        return alias

    def url(self, kind: str, value: str) -> str:
        parsed = urlsplit(value)
        scheme = parsed.scheme if parsed.scheme in {"http", "https"} else "https"
        host = f"{self.value(kind, value)}.invalid"
        path = f"/{self.value(f'{kind}-path', parsed.path)}" if parsed.path and parsed.path != "/" else ""
        return f"{scheme}://{host}{path}"

    def network(self, value: str) -> str:
        try:
            parsed = ip_network(value, strict=False)
        except ValueError:
            return self.value("network", value)
        return f"{self.value(f'{parsed.version == 4 and "ipv4" or "ipv6"}-network', str(parsed))}/{parsed.prefixlen}"


def _read_first_available_text(paths: list[Path], fallback: str = "unknown") -> str:
    for path in paths:
        try:
            value = path.read_text().strip()
        except OSError:
            continue
        if value:
            return value
    return fallback


def _get_memory_bytes() -> Optional[int]:
    for path in CGROUP_MEMORY_LIMIT_PATHS:
        try:
            raw_value = path.read_text().strip()
        except OSError:
            continue

        if raw_value == "max":
            continue

        try:
            memory_limit = int(raw_value)
        except ValueError:
            continue

        if 0 < memory_limit < UNLIMITED_MEMORY_THRESHOLD_BYTES:
            return memory_limit

    try:
        page_size = os.sysconf("SC_PAGE_SIZE")
        page_count = os.sysconf("SC_PHYS_PAGES")
    except (AttributeError, OSError, ValueError):
        return None

    return page_size * page_count if page_size > 0 and page_count > 0 else None


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
        architecture=platform.machine() or "unknown",
        logical_cpu_count=os.cpu_count(),
        memory_bytes=_get_memory_bytes(),
        python_runtime=f"{platform.python_implementation()} {platform.python_version()}",
    )


def _report_value(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ": "))


def _append_report_setting(lines: list[str], key: str, value: object, source: str | None = None) -> None:
    source_suffix = f" # source: {source}" if source is not None else ""
    lines.append(f"{key} = {_report_value(value)}{source_suffix}")


def _config_file_source(config_attr: str) -> str:
    return "config_file" if config_attr in config_module.configured_setting_keys else "default"


def _settings_value(config_attr: str) -> object:
    value = getattr(config_module.settings, config_attr)
    return value.value if hasattr(value, "value") else value


def _decode_string_list(value: str) -> list[str]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        logger.warning("Ignoring invalid JSON list while building public support report")
        return []
    return [item for item in parsed if isinstance(item, str)] if isinstance(parsed, list) else []


def _decode_role_mappings(value: str) -> dict[str, list[str]]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        logger.warning("Ignoring invalid OIDC role mappings while building public support report")
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {
        role: [group for group in groups if isinstance(group, str)]
        for role, groups in parsed.items()
        if isinstance(role, str) and isinstance(groups, list)
    }


def _public_oidc_claim(value: str | None, aliases: PublicSupportReportAliases) -> str | None:
    if value is None or value in STANDARD_OIDC_CLAIMS:
        return value
    return aliases.value("oidc-claim", value)


def _public_oidc_scope(value: str, aliases: PublicSupportReportAliases) -> str:
    return value if value in STANDARD_OIDC_SCOPES else aliases.value("oidc-scope", value)


def _append_config_file_report(lines: list[str], aliases: PublicSupportReportAliases) -> None:
    lines.append("[configuration_file]")
    for key, config_attr in CONFIG_FILE_SETTING_FIELDS:
        _append_report_setting(lines, key, _settings_value(config_attr), _config_file_source(config_attr))

    _append_report_setting(
        lines,
        "admin.username_configured",
        "admin_username" in config_module.configured_setting_keys,
        _config_file_source("admin_username"),
    )
    _append_report_setting(
        lines,
        "frontend_logging.tracing_components_configured",
        bool(config_module.settings.frontend_tracing_components),
        _config_file_source("frontend_tracing_components"),
    )
    _append_report_setting(
        lines,
        "frontend_logging.tracing_username_filter_configured",
        bool(config_module.settings.frontend_tracing_username_regex),
        _config_file_source("frontend_tracing_username_regex"),
    )
    cache_location = config_module.settings.directory_cache_location
    _append_report_setting(
        lines,
        "directory_cache.location",
        aliases.value("directory-cache-path", cache_location) if cache_location else "default",
        _config_file_source("directory_cache_location"),
    )
    metadata_source = _config_file_source("companion_metadata_feed_url")
    _append_report_setting(
        lines, "companion_downloads.metadata_feed", "custom" if metadata_source == "config_file" else "default", metadata_source
    )

    pin_asset_platforms = [
        platform_name
        for platform_name, setting_name in (
            ("windows_x64", "companion_pin_windows_x64_url"),
            ("windows_arm64", "companion_pin_windows_arm64_url"),
            ("macos_arm64", "companion_pin_macos_arm64_url"),
            ("linux_x64", "companion_pin_linux_x64_url"),
        )
        if getattr(config_module.settings, setting_name)
    ]
    pin_configured = bool(config_module.settings.companion_pin_version) or bool(pin_asset_platforms)
    _append_report_setting(lines, "companion_downloads.pin_configured", pin_configured)
    _append_report_setting(lines, "companion_downloads.pin_asset_platforms", pin_asset_platforms)


def _append_advanced_settings_report(lines: list[str]) -> None:
    advanced = build_advanced_system_settings_read()
    lines.append("[ui_configuration.advanced]")
    _append_report_setting(
        lines,
        advanced.smb.read_chunk_size_bytes.key.value,
        advanced.smb.read_chunk_size_bytes.value,
        advanced.smb.read_chunk_size_bytes.source.value,
    )
    imagemagick = advanced.preprocessors["imagemagick"]
    _append_report_setting(
        lines,
        imagemagick.max_file_size_bytes.key.value,
        imagemagick.max_file_size_bytes.value,
        imagemagick.max_file_size_bytes.source.value,
    )
    _append_report_setting(
        lines,
        imagemagick.timeout_seconds.key.value,
        imagemagick.timeout_seconds.value,
        imagemagick.timeout_seconds.source.value,
    )


def _append_network_settings_report(lines: list[str], session: Session, aliases: PublicSupportReportAliases) -> None:
    network = build_network_settings_read(session)
    lines.append("[ui_configuration.network]")
    _append_report_setting(lines, "public_url_configured", bool(network.public_url), "ui")
    if network.public_url:
        _append_report_setting(lines, "public_url", aliases.url("public-endpoint", network.public_url), "ui")
    _append_report_setting(lines, "trusted_proxy_cidrs", [aliases.network(value) for value in network.trusted_proxy_cidrs], "ui")


def _append_authentication_report(lines: list[str], session: Session, aliases: PublicSupportReportAliases) -> None:
    effective_mode = get_effective_authentication_mode(session)
    configuration = session.get(OidcProviderConfiguration, 1)
    lines.append("[ui_configuration.authentication]")
    _append_report_setting(lines, "mode", effective_mode.mode.value, effective_mode.source)
    _append_report_setting(lines, "oidc_provider_configured", configuration is not None, "ui")
    if configuration is None:
        return

    role_mappings = _decode_role_mappings(configuration.role_mappings_json)
    _append_report_setting(lines, "oidc.provider", aliases.value("oidc-provider", configuration.issuer_url), "ui")
    _append_report_setting(lines, "oidc.issuer_url", aliases.url("oidc-provider", configuration.issuer_url), "ui")
    _append_report_setting(lines, "oidc.client_id", aliases.value("oidc-client", configuration.client_id), "ui")
    _append_report_setting(lines, "oidc.client_secret_configured", configuration.encrypted_client_secret is not None, "ui")
    _append_report_setting(
        lines, "oidc.scopes", [_public_oidc_scope(scope, aliases) for scope in _decode_string_list(configuration.scopes_json)], "ui"
    )
    _append_report_setting(lines, "oidc.username_claim", _public_oidc_claim(configuration.username_claim, aliases), "ui")
    _append_report_setting(lines, "oidc.name_claim", _public_oidc_claim(configuration.name_claim, aliases), "ui")
    _append_report_setting(lines, "oidc.email_claim", _public_oidc_claim(configuration.email_claim, aliases), "ui")
    _append_report_setting(lines, "oidc.groups_claim", _public_oidc_claim(configuration.groups_claim, aliases), "ui")
    _append_report_setting(lines, "oidc.sign_in_mode", configuration.sign_in_mode.value, "ui")
    _append_report_setting(lines, "oidc.reauthentication_max_age_days", configuration.interactive_reauthentication_max_age_days, "ui")
    _append_report_setting(lines, "oidc.admission_mode", configuration.admission_mode.value, "ui")
    _append_report_setting(
        lines,
        "oidc.admission_groups",
        [aliases.value("oidc-group", group) for group in _decode_string_list(configuration.admission_groups_json)],
        "ui",
    )
    _append_report_setting(lines, "oidc.role_assignment_mode", configuration.role_assignment_mode.value, "ui")
    _append_report_setting(lines, "oidc.uniform_role", configuration.uniform_role.value, "ui")
    for role in ("admin", "editor", "viewer"):
        _append_report_setting(
            lines,
            f"oidc.role_mappings.{role}",
            [aliases.value("oidc-group", group) for group in role_mappings.get(role, [])],
            "ui",
        )


def _append_connection_summary_report(lines: list[str], session: Session) -> None:
    connections = session.exec(select(Connection)).all()
    lines.append("[ui_configuration.connections]")
    _append_report_setting(lines, "total", len(connections), "ui")
    _append_report_setting(lines, "by_type", dict(sorted(Counter(connection.type for connection in connections).items())), "ui")
    _append_report_setting(lines, "by_scope", dict(sorted(Counter(connection.scope.value for connection in connections).items())), "ui")
    _append_report_setting(
        lines,
        "by_access_mode",
        dict(sorted(Counter(connection.access_mode.value for connection in connections).items())),
        "ui",
    )


def build_public_support_report_read(session: Session) -> PublicSupportReportRead:
    aliases = PublicSupportReportAliases()
    about = build_about_settings_read()
    lines = [
        f"# {PUBLIC_SUPPORT_REPORT_TITLE}",
        "# Safe to post publicly. Identifying values are report-local placeholders.",
        f"format_version = {PUBLIC_SUPPORT_REPORT_FORMAT_VERSION}",
        "",
        "[application]",
    ]
    _append_report_setting(lines, "version", about.version)
    _append_report_setting(lines, "build", about.build_time)
    _append_report_setting(lines, "commit", about.git_commit)
    _append_report_setting(lines, "architecture", about.architecture)
    _append_report_setting(lines, "python", about.python_runtime)
    lines.append("")
    _append_config_file_report(lines, aliases)
    lines.append("")
    _append_advanced_settings_report(lines)
    lines.append("")
    _append_network_settings_report(lines, session, aliases)
    lines.append("")
    _append_authentication_report(lines, session, aliases)
    lines.append("")
    _append_connection_summary_report(lines, session)
    return PublicSupportReportRead(content="\n".join(lines))


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
