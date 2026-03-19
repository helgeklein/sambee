from __future__ import annotations

from enum import StrEnum


class UserSettingKey(StrEnum):
    APPEARANCE_THEME_ID = "appearance.theme_id"
    APPEARANCE_CUSTOM_THEMES = "appearance.custom_themes"
    BROWSER_QUICK_NAV_INCLUDE_DOT_DIRECTORIES = "browser.quick_nav_include_dot_directories"
    BROWSER_FILE_BROWSER_VIEW_MODE = "browser.file_browser_view_mode"
    BROWSER_PANE_MODE = "browser.pane_mode"
    BROWSER_SELECTED_CONNECTION_ID = "browser.selected_connection_id"


DEFAULT_THEME_ID = "sambee-light"
DEFAULT_QUICK_NAV_INCLUDE_DOT_DIRECTORIES = False
DEFAULT_FILE_BROWSER_VIEW_MODE = "list"
DEFAULT_PANE_MODE = "single"
