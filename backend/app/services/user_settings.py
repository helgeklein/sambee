from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from json import JSONDecodeError
from typing import Any, cast

from sqlmodel import Session, select

from app.core.logging import get_logger
from app.core.user_setting_definitions import (
    DEFAULT_FILE_BROWSER_VIEW_MODE,
    DEFAULT_PANE_MODE,
    DEFAULT_QUICK_NAV_INCLUDE_DOT_DIRECTORIES,
    DEFAULT_THEME_ID,
    UserSettingKey,
)
from app.models.user_settings import (
    AppearanceUserSettingsRead,
    BrowserUserSettingsRead,
    CurrentUserSettingsRead,
    CurrentUserSettingsUpdate,
    UserSetting,
)

logger = get_logger(__name__)

TRUE_VALUES = {"1", "true", "yes", "on"}
FALSE_VALUES = {"0", "false", "no", "off"}
VALID_FILE_BROWSER_VIEW_MODES = {"list", "details"}
VALID_PANE_MODES = {"single", "dual"}
VALID_THEME_MODES = {"light", "dark"}


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


def build_current_user_settings_read(*, user_id: uuid.UUID, session: Session) -> CurrentUserSettingsRead:
    values = _load_user_setting_map(user_id, session)
    return CurrentUserSettingsRead(
        appearance=AppearanceUserSettingsRead(
            theme_id=_parse_theme_id(values.get(UserSettingKey.APPEARANCE_THEME_ID.value)),
            custom_themes=_parse_custom_themes(values.get(UserSettingKey.APPEARANCE_CUSTOM_THEMES.value)),
        ),
        browser=BrowserUserSettingsRead(
            quick_nav_include_dot_directories=_parse_bool(
                values.get(UserSettingKey.BROWSER_QUICK_NAV_INCLUDE_DOT_DIRECTORIES.value),
                key=UserSettingKey.BROWSER_QUICK_NAV_INCLUDE_DOT_DIRECTORIES,
                default=DEFAULT_QUICK_NAV_INCLUDE_DOT_DIRECTORIES,
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


def update_current_user_settings(*, user_id: uuid.UUID, payload: CurrentUserSettingsUpdate, session: Session) -> None:
    has_updates = False

    if payload.appearance and payload.appearance.theme_id is not None:
        theme_id = payload.appearance.theme_id.strip()
        if not theme_id:
            raise ValueError("Theme ID cannot be empty")

        _upsert_user_setting(user_id=user_id, key=UserSettingKey.APPEARANCE_THEME_ID, value=theme_id, session=session)
        has_updates = True

    if payload.appearance and "custom_themes" in payload.appearance.model_fields_set:
        custom_themes = payload.appearance.custom_themes or []
        if any(not _is_valid_theme_config(theme) for theme in custom_themes):
            raise ValueError("Custom themes payload contains an invalid theme definition")

        if custom_themes:
            _upsert_user_setting(
                user_id=user_id,
                key=UserSettingKey.APPEARANCE_CUSTOM_THEMES,
                value=json.dumps(custom_themes, separators=(",", ":"), sort_keys=True),
                session=session,
            )
        else:
            _delete_user_setting(
                user_id=user_id,
                key=UserSettingKey.APPEARANCE_CUSTOM_THEMES,
                session=session,
            )

        has_updates = True

    if payload.browser and payload.browser.quick_nav_include_dot_directories is not None:
        _upsert_user_setting(
            user_id=user_id,
            key=UserSettingKey.BROWSER_QUICK_NAV_INCLUDE_DOT_DIRECTORIES,
            value="true" if payload.browser.quick_nav_include_dot_directories else "false",
            session=session,
        )
        has_updates = True

    if payload.browser and payload.browser.file_browser_view_mode is not None:
        view_mode = payload.browser.file_browser_view_mode.strip().lower()
        if view_mode not in VALID_FILE_BROWSER_VIEW_MODES:
            raise ValueError("File browser view mode must be one of: list, details")

        _upsert_user_setting(
            user_id=user_id,
            key=UserSettingKey.BROWSER_FILE_BROWSER_VIEW_MODE,
            value=view_mode,
            session=session,
        )
        has_updates = True

    if payload.browser and payload.browser.pane_mode is not None:
        pane_mode = payload.browser.pane_mode.strip().lower()
        if pane_mode not in VALID_PANE_MODES:
            raise ValueError("Pane mode must be one of: single, dual")

        _upsert_user_setting(
            user_id=user_id,
            key=UserSettingKey.BROWSER_PANE_MODE,
            value=pane_mode,
            session=session,
        )
        has_updates = True

    if payload.browser and "selected_connection_id" in payload.browser.model_fields_set:
        selected_connection_id = payload.browser.selected_connection_id
        normalized_connection_id = selected_connection_id.strip() if selected_connection_id is not None else ""

        if normalized_connection_id:
            _upsert_user_setting(
                user_id=user_id,
                key=UserSettingKey.BROWSER_SELECTED_CONNECTION_ID,
                value=normalized_connection_id,
                session=session,
            )
        else:
            _delete_user_setting(
                user_id=user_id,
                key=UserSettingKey.BROWSER_SELECTED_CONNECTION_ID,
                session=session,
            )

        has_updates = True

    if not has_updates:
        return

    session.commit()
