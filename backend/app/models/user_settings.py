from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from sqlmodel import Field, SQLModel


class UserSetting(SQLModel, table=True):
    user_id: uuid.UUID = Field(foreign_key="user.id", primary_key=True, index=True)
    key: str = Field(primary_key=True)
    value: str
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AppearanceUserSettingsRead(SQLModel):
    theme_id: str
    custom_themes: list[dict[str, Any]] = Field(default_factory=list)


LanguagePreference = Literal["browser", "en", "en-XA"]


class LocalizationUserSettingsRead(SQLModel):
    language: LanguagePreference = "browser"
    regional_locale: str = "browser"


class BrowserUserSettingsRead(SQLModel):
    quick_nav_include_dot_directories: bool
    file_browser_view_mode: str
    pane_mode: str
    selected_connection_id: Optional[str] = None
    viewer_associations: dict[str, str] = Field(default_factory=dict)


class TextEditorUserSettingsRead(SQLModel):
    max_file_size_bytes: int


class CurrentUserSettingsRead(SQLModel):
    appearance: AppearanceUserSettingsRead
    localization: LocalizationUserSettingsRead
    browser: BrowserUserSettingsRead
    text_editor: TextEditorUserSettingsRead


class AppearanceUserSettingsUpdate(SQLModel):
    theme_id: Optional[str] = None
    custom_themes: Optional[list[dict[str, Any]]] = None


class LocalizationUserSettingsUpdate(SQLModel):
    language: Optional[LanguagePreference] = None
    regional_locale: Optional[str] = None


class BrowserUserSettingsUpdate(SQLModel):
    quick_nav_include_dot_directories: Optional[bool] = None
    file_browser_view_mode: Optional[str] = None
    pane_mode: Optional[str] = None
    selected_connection_id: Optional[str] = None
    viewer_associations: Optional[dict[str, str]] = None


class TextEditorUserSettingsUpdate(SQLModel):
    max_file_size_bytes: Optional[int] = None


class CurrentUserSettingsUpdate(SQLModel):
    appearance: Optional[AppearanceUserSettingsUpdate] = None
    localization: Optional[LocalizationUserSettingsUpdate] = None
    browser: Optional[BrowserUserSettingsUpdate] = None
    text_editor: Optional[TextEditorUserSettingsUpdate] = None
