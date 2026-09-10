from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from json import JSONDecodeError
from pathlib import Path
from typing import Any, cast

from sqlmodel import Session, select

from app.core.logging import get_logger
from app.core.user_setting_definitions import (
    DEFAULT_FILE_BROWSER_VIEW_MODE,
    DEFAULT_LANGUAGE_PREFERENCE,
    DEFAULT_PANE_MODE,
    DEFAULT_QUICK_BAR_SHORTCUT_HINT_VISIBILITY,
    DEFAULT_QUICK_NAV_INCLUDE_DOT_DIRECTORIES,
    DEFAULT_REGIONAL_LOCALE_PREFERENCE,
    DEFAULT_TEXT_EDITOR_MAX_FILE_SIZE_BYTES,
    DEFAULT_THEME_ID,
    UserSettingKey,
)
from app.models.user_settings import (
    AppearanceUserSettingsRead,
    BrowserUserSettingsRead,
    CurrentUserSettingsRead,
    CurrentUserSettingsUpdate,
    CurrentUserSettingsUpdateResult,
    LocalizationUserSettingsRead,
    TextEditorUserSettingsRead,
    UserSetting,
)

logger = get_logger(__name__)

TRUE_VALUES = {"1", "true", "yes", "on"}
FALSE_VALUES = {"0", "false", "no", "off"}
VALID_FILE_BROWSER_VIEW_MODES = {"list", "details"}
VALID_PANE_MODES = {"single", "dual"}
VALID_QUICK_BAR_SHORTCUT_HINT_VISIBILITIES = {"auto", "always", "never"}
MIN_TEXT_EDITOR_MAX_FILE_SIZE_BYTES = 65_536
MAX_TEXT_EDITOR_MAX_FILE_SIZE_BYTES = 104_857_600
VALID_THEME_MODES = {"light", "dark"}
VALID_LANGUAGE_PREFERENCES = {DEFAULT_LANGUAGE_PREFERENCE, "en", "en-XA"}
REGIONAL_LOCALE_PATTERN = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
BUILT_IN_THEME_IDS_PATH = Path(__file__).resolve().parents[3] / "shared" / "built_in_theme_ids.json"


def _load_user_setting_map(user_id: uuid.UUID, session: Session) -> dict[str, str]:
    rows = session.exec(select(UserSetting).where(UserSetting.user_id == user_id)).all()
    return {row.key: row.value for row in rows}


def _parse_theme_id(raw_value: str | None) -> str:
    if raw_value is None:
        return DEFAULT_THEME_ID

    theme_id = raw_value.strip()
    if not theme_id:
        logger.error("Invalid stored theme ID for user settings: empty value")
        return DEFAULT_THEME_ID

    return theme_id


def _parse_language_preference(raw_value: str | None) -> str:
    if raw_value is None:
        return DEFAULT_LANGUAGE_PREFERENCE

    normalized = raw_value.strip()
    if normalized in VALID_LANGUAGE_PREFERENCES:
        return normalized

    logger.error(f"Invalid stored language preference for user settings: {raw_value}")
    return DEFAULT_LANGUAGE_PREFERENCE


def _normalize_regional_locale(raw_value: str | None) -> str:
    if raw_value is None:
        return DEFAULT_REGIONAL_LOCALE_PREFERENCE

    normalized = raw_value.strip()
    if not normalized:
        return DEFAULT_REGIONAL_LOCALE_PREFERENCE

    if normalized == DEFAULT_REGIONAL_LOCALE_PREFERENCE:
        return DEFAULT_REGIONAL_LOCALE_PREFERENCE

    if REGIONAL_LOCALE_PATTERN.fullmatch(normalized):
        return normalized

    raise ValueError("Regional locale must be a valid locale identifier like en-US")


def _parse_regional_locale_preference(raw_value: str | None) -> str:
    try:
        return _normalize_regional_locale(raw_value)
    except ValueError:
        logger.error(f"Invalid stored regional locale preference for user settings: {raw_value}")
        return DEFAULT_REGIONAL_LOCALE_PREFERENCE


def _parse_bool(raw_value: str | None, *, key: UserSettingKey, default: bool) -> bool:
    if raw_value is None:
        return default

    normalized = raw_value.strip().lower()
    if normalized in TRUE_VALUES:
        return True
    if normalized in FALSE_VALUES:
        return False

    logger.error(f"Invalid stored boolean for {key.value}: {raw_value}")
    return default


def _parse_optional_bool(raw_value: str | None, *, key: UserSettingKey) -> bool | None:
    if raw_value is None:
        return None

    normalized = raw_value.strip().lower()
    if normalized in TRUE_VALUES:
        return True
    if normalized in FALSE_VALUES:
        return False

    logger.error(f"Invalid stored boolean for {key.value}: {raw_value}")
    return None


def _parse_choice(raw_value: str | None, *, key: UserSettingKey, valid_values: set[str], default: str) -> str:
    if raw_value is None:
        return default

    normalized = raw_value.strip().lower()
    if normalized in valid_values:
        return normalized

    logger.error(f"Invalid stored value for {key.value}: {raw_value}")
    return default


def _parse_optional_string(raw_value: str | None) -> str | None:
    if raw_value is None:
        return None

    normalized = raw_value.strip()
    return normalized or None


def _parse_int(raw_value: str | None, *, key: UserSettingKey, default: int) -> int:
    if raw_value is None:
        return default

    try:
        return int(raw_value)
    except (TypeError, ValueError):
        logger.error(f"Invalid stored integer value for user settings: {key.value}")
        return default


def _is_valid_theme_config(theme: Any) -> bool:
    if not isinstance(theme, dict):
        return False

    theme_id = theme.get("id")
    name = theme.get("name")
    mode = theme.get("mode")
    primary = theme.get("primary")

    if not isinstance(theme_id, str) or not theme_id.strip():
        return False
    if not isinstance(name, str) or not name.strip():
        return False
    if mode not in VALID_THEME_MODES:
        return False
    if not isinstance(primary, dict):
        return False

    primary_main = primary.get("main")
    return isinstance(primary_main, str) and bool(primary_main.strip())


def _parse_custom_themes(raw_value: str | None) -> list[dict[str, Any]]:
    if raw_value is None:
        return []

    try:
        parsed = json.loads(raw_value)
    except JSONDecodeError:
        logger.error("Invalid stored custom themes JSON for user settings")
        return []

    if not isinstance(parsed, list):
        logger.error("Invalid stored custom themes value for user settings: expected list")
        return []

    valid_themes: list[dict[str, Any]] = []
    for theme in parsed:
        if _is_valid_theme_config(theme):
            valid_themes.append(cast(dict[str, Any], theme))
        else:
            logger.error("Invalid stored custom theme definition encountered in user settings")

    return valid_themes


def _parse_viewer_associations(raw_value: str | None) -> dict[str, str]:
    if raw_value is None:
        return {}

    try:
        parsed = json.loads(raw_value)
    except JSONDecodeError:
        logger.error("Invalid stored viewer associations JSON for user settings")
        return {}

    if not isinstance(parsed, dict):
        logger.error("Invalid stored viewer associations value for user settings: expected object")
        return {}

    valid_associations: dict[str, str] = {}
    for raw_key, raw_value in parsed.items():
        if not isinstance(raw_key, str) or not isinstance(raw_value, str):
            logger.error("Invalid stored viewer association encountered in user settings")
            continue

        normalized_key = raw_key.strip().lower()
        normalized_value = raw_value.strip()
        if not normalized_key or not normalized_value:
            logger.error("Invalid stored viewer association encountered in user settings")
            continue

        valid_associations[normalized_key] = normalized_value

    return valid_associations


def build_current_user_settings_read(*, user_id: uuid.UUID, session: Session) -> CurrentUserSettingsRead:
    values = _load_user_setting_map(user_id, session)
    return CurrentUserSettingsRead(
        appearance=AppearanceUserSettingsRead(
            theme_id=_parse_theme_id(values.get(UserSettingKey.APPEARANCE_THEME_ID.value)),
            custom_themes=_parse_custom_themes(values.get(UserSettingKey.APPEARANCE_CUSTOM_THEMES.value)),
        ),
        localization=LocalizationUserSettingsRead(
            language=_parse_language_preference(values.get(UserSettingKey.LOCALIZATION_LANGUAGE.value)),
            regional_locale=_parse_regional_locale_preference(values.get(UserSettingKey.LOCALIZATION_REGIONAL_LOCALE.value)),
        ),
        browser=BrowserUserSettingsRead(
            quick_nav_include_dot_directories=_parse_bool(
                values.get(UserSettingKey.BROWSER_QUICK_NAV_INCLUDE_DOT_DIRECTORIES.value),
                key=UserSettingKey.BROWSER_QUICK_NAV_INCLUDE_DOT_DIRECTORIES,
                default=DEFAULT_QUICK_NAV_INCLUDE_DOT_DIRECTORIES,
            ),
            quick_bar_shortcut_hint_visibility=_parse_choice(
                values.get(UserSettingKey.BROWSER_QUICK_BAR_SHORTCUT_HINT_VISIBILITY.value),
                key=UserSettingKey.BROWSER_QUICK_BAR_SHORTCUT_HINT_VISIBILITY,
                valid_values=VALID_QUICK_BAR_SHORTCUT_HINT_VISIBILITIES,
                default=DEFAULT_QUICK_BAR_SHORTCUT_HINT_VISIBILITY,
            ),
            file_browser_view_mode=_parse_choice(
                values.get(UserSettingKey.BROWSER_FILE_BROWSER_VIEW_MODE.value),
                key=UserSettingKey.BROWSER_FILE_BROWSER_VIEW_MODE,
                valid_values=VALID_FILE_BROWSER_VIEW_MODES,
                default=DEFAULT_FILE_BROWSER_VIEW_MODE,
            ),
            pane_mode=_parse_choice(
                values.get(UserSettingKey.BROWSER_PANE_MODE.value),
                key=UserSettingKey.BROWSER_PANE_MODE,
                valid_values=VALID_PANE_MODES,
                default=DEFAULT_PANE_MODE,
            ),
            selected_connection_id=_parse_optional_string(values.get(UserSettingKey.BROWSER_SELECTED_CONNECTION_ID.value)),
            viewer_associations=_parse_viewer_associations(values.get(UserSettingKey.BROWSER_VIEWER_ASSOCIATIONS.value)),
        ),
        text_editor=TextEditorUserSettingsRead(
            max_file_size_bytes=_parse_int(
                values.get(UserSettingKey.TEXT_EDITOR_MAX_FILE_SIZE_BYTES.value),
                key=UserSettingKey.TEXT_EDITOR_MAX_FILE_SIZE_BYTES,
                default=DEFAULT_TEXT_EDITOR_MAX_FILE_SIZE_BYTES,
            ),
            word_wrap_enabled=_parse_optional_bool(
                values.get(UserSettingKey.TEXT_EDITOR_WORD_WRAP_ENABLED.value),
                key=UserSettingKey.TEXT_EDITOR_WORD_WRAP_ENABLED,
            ),
        ),
    )


def _upsert_user_setting(*, user_id: uuid.UUID, key: UserSettingKey, value: str, session: Session) -> None:
    setting = session.get(UserSetting, (user_id, key.value))
    if setting is None:
        setting = UserSetting(user_id=user_id, key=key.value, value=value)
    else:
        setting.value = value
        setting.updated_at = datetime.now(timezone.utc)

    session.add(setting)


def _delete_user_setting(*, user_id: uuid.UUID, key: UserSettingKey, session: Session) -> None:
    setting = session.get(UserSetting, (user_id, key.value))
    if setting is not None:
        session.delete(setting)


def _built_in_theme_ids() -> set[str]:
    try:
        values = json.loads(BUILT_IN_THEME_IDS_PATH.read_text())
    except (OSError, JSONDecodeError) as exc:
        raise RuntimeError("The built-in theme manifest is unavailable or invalid") from exc
    if not isinstance(values, list) or any(not isinstance(value, str) or not value for value in values):
        raise RuntimeError("The built-in theme manifest is invalid")
    return set(values)


def _validate_custom_themes(custom_themes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if any(not _is_valid_theme_config(theme) for theme in custom_themes):
        raise ValueError("Custom themes payload contains an invalid theme definition")
    built_in_ids = _built_in_theme_ids()
    custom_ids = [str(theme["id"]).strip() for theme in custom_themes]
    if len(custom_ids) != len(set(custom_ids)):
        raise ValueError("Custom theme IDs must be unique")
    if built_in_ids.intersection(custom_ids):
        raise ValueError("Custom theme IDs cannot match built-in theme IDs")
    return custom_themes


def _begin_immediate_transaction(session: Session) -> None:
    if session.get_bind().dialect.name == "sqlite" and not session.in_transaction():
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")


def update_current_user_settings(
    *, user_id: uuid.UUID, payload: CurrentUserSettingsUpdate, session: Session
) -> CurrentUserSettingsUpdateResult:
    key = UserSettingKey(payload.field)
    value: object = payload.value

    if key in {UserSettingKey.APPEARANCE_THEME_ID, UserSettingKey.APPEARANCE_CUSTOM_THEMES}:
        _begin_immediate_transaction(session)

    if key is UserSettingKey.APPEARANCE_THEME_ID:
        value = str(value).strip()
        if not value:
            raise ValueError("Theme ID cannot be empty")
        current = build_current_user_settings_read(user_id=user_id, session=session)
        allowed_ids = _built_in_theme_ids().union(theme["id"] for theme in current.appearance.custom_themes)
        if value not in allowed_ids:
            raise ValueError("Theme ID must identify a built-in or current custom theme")
    elif key is UserSettingKey.APPEARANCE_CUSTOM_THEMES:
        value = _validate_custom_themes(cast(list[dict[str, Any]], value))
        current_theme_id = build_current_user_settings_read(user_id=user_id, session=session).appearance.theme_id
        allowed_ids = _built_in_theme_ids().union(theme["id"] for theme in value)
        if current_theme_id not in allowed_ids:
            raise ValueError("Cannot remove the active custom theme before selecting another theme")
    elif key is UserSettingKey.LOCALIZATION_LANGUAGE:
        value = _parse_language_preference(cast(str, value))
    elif key is UserSettingKey.LOCALIZATION_REGIONAL_LOCALE:
        value = _normalize_regional_locale(cast(str, value))
    elif key is UserSettingKey.BROWSER_QUICK_BAR_SHORTCUT_HINT_VISIBILITY:
        value = cast(str, value).strip().lower()
        if value not in VALID_QUICK_BAR_SHORTCUT_HINT_VISIBILITIES:
            raise ValueError("Quick Bar shortcut hint visibility must be one of: auto, always, never")
    elif key is UserSettingKey.BROWSER_FILE_BROWSER_VIEW_MODE:
        value = cast(str, value).strip().lower()
        if value not in VALID_FILE_BROWSER_VIEW_MODES:
            raise ValueError("File browser view mode must be one of: list, details")
    elif key is UserSettingKey.BROWSER_PANE_MODE:
        value = cast(str, value).strip().lower()
        if value not in VALID_PANE_MODES:
            raise ValueError("Pane mode must be one of: single, dual")
    elif key is UserSettingKey.BROWSER_SELECTED_CONNECTION_ID:
        value = cast(str | None, value)
        value = value.strip() if value is not None else None
    elif key is UserSettingKey.BROWSER_VIEWER_ASSOCIATIONS:
        normalized_associations: dict[str, str] = {}
        for raw_key, raw_value in cast(dict[str, str], value).items():
            normalized_key = raw_key.strip().lower()
            normalized_value = raw_value.strip()
            if not normalized_key or not normalized_value:
                raise ValueError("Viewer associations must use non-empty file keys and viewer IDs")
            normalized_associations[normalized_key] = normalized_value
        value = normalized_associations
    elif key is UserSettingKey.TEXT_EDITOR_MAX_FILE_SIZE_BYTES:
        normalized_max_file_size = int(cast(int, value))
        if normalized_max_file_size < MIN_TEXT_EDITOR_MAX_FILE_SIZE_BYTES or normalized_max_file_size > MAX_TEXT_EDITOR_MAX_FILE_SIZE_BYTES:
            raise ValueError("Text editor max file size must be between 65536 and 104857600 bytes")
        value = normalized_max_file_size

    if value in (None, "", {}):
        _delete_user_setting(user_id=user_id, key=key, session=session)
    else:
        serialized = (
            json.dumps(value, separators=(",", ":"), sort_keys=True)
            if isinstance(value, (dict, list))
            else "true"
            if value is True
            else "false"
            if value is False
            else str(value)
        )
        _upsert_user_setting(user_id=user_id, key=key, value=serialized, session=session)

    session.commit()
    return payload.model_copy(update={"value": value})
