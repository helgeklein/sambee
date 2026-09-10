from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Literal, Optional

from sqlmodel import Field, SQLModel
from sqlmodel._compat import SQLModelConfig


class UserSetting(SQLModel, table=True):
    user_id: uuid.UUID = Field(foreign_key="user.id", primary_key=True, index=True)
    key: str = Field(primary_key=True)
    value: str
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AppearanceUserSettingsRead(SQLModel):
    theme_id: str
    custom_themes: list[dict[str, Any]] = Field(default_factory=list)


LanguagePreference = Literal["browser", "en", "en-XA"]
QuickBarShortcutHintVisibility = Literal["auto", "always", "never"]


class LocalizationUserSettingsRead(SQLModel):
    language: LanguagePreference = "browser"
    regional_locale: str = "browser"


class BrowserUserSettingsRead(SQLModel):
    quick_nav_include_dot_directories: bool
    quick_bar_shortcut_hint_visibility: QuickBarShortcutHintVisibility
    file_browser_view_mode: str
    pane_mode: str
    selected_connection_id: Optional[str] = None
    viewer_associations: dict[str, str] = Field(default_factory=dict)


class TextEditorUserSettingsRead(SQLModel):
    max_file_size_bytes: int
    word_wrap_enabled: Optional[bool] = None


class CurrentUserSettingsRead(SQLModel):
    appearance: AppearanceUserSettingsRead
    localization: LocalizationUserSettingsRead
    browser: BrowserUserSettingsRead
    text_editor: TextEditorUserSettingsRead


class StrictCurrentUserSettingUpdate(SQLModel):
    model_config = SQLModelConfig(extra="forbid")


class ThemeIdUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["appearance.theme_id"]
    value: str


class CustomThemesUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["appearance.custom_themes"]
    value: list[dict[str, Any]]


class LanguageUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["localization.language"]
    value: LanguagePreference


class RegionalLocaleUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["localization.regional_locale"]
    value: str


class QuickNavUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["browser.quick_nav_include_dot_directories"]
    value: bool


class QuickBarShortcutHintUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["browser.quick_bar_shortcut_hint_visibility"]
    value: QuickBarShortcutHintVisibility


class FileBrowserViewModeUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["browser.file_browser_view_mode"]
    value: Literal["list", "details"]


class PaneModeUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["browser.pane_mode"]
    value: Literal["single", "dual"]


class SelectedConnectionUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["browser.selected_connection_id"]
    value: str | None


class ViewerAssociationsUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["browser.viewer_associations"]
    value: dict[str, str]


class TextEditorMaxFileSizeUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["text_editor.max_file_size_bytes"]
    value: int


class TextEditorWordWrapUserSettingUpdate(StrictCurrentUserSettingUpdate):
    field: Literal["text_editor.word_wrap_enabled"]
    value: bool | None


CurrentUserSettingsUpdate = Annotated[
    ThemeIdUserSettingUpdate
    | CustomThemesUserSettingUpdate
    | LanguageUserSettingUpdate
    | RegionalLocaleUserSettingUpdate
    | QuickNavUserSettingUpdate
    | QuickBarShortcutHintUserSettingUpdate
    | FileBrowserViewModeUserSettingUpdate
    | PaneModeUserSettingUpdate
    | SelectedConnectionUserSettingUpdate
    | ViewerAssociationsUserSettingUpdate
    | TextEditorMaxFileSizeUserSettingUpdate
    | TextEditorWordWrapUserSettingUpdate,
    Field(discriminator="field"),
]
CurrentUserSettingsUpdateResult = CurrentUserSettingsUpdate
