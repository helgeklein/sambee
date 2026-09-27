from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import Field as PydanticField
from sqlmodel import Field, SQLModel
from sqlmodel._compat import SQLModelConfig


class StoredTheme(SQLModel, table=True):
    id: str = Field(primary_key=True)
    owner_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id", index=True)
    definition: str
    version: int = Field(default=1)


class ThemeDefinition(SQLModel):
    model_config = SQLModelConfig(extra="forbid")

    name: str
    description: str = ""
    mode: Literal["light", "dark"]
    primary: dict[str, str]
    background: dict[str, str]
    text: dict[str, str]
    action: dict[str, str]
    components: dict[str, Any]


class ThemeWrite(SQLModel):
    model_config = SQLModelConfig(extra="forbid")

    definition: ThemeDefinition
    scope: Literal["user", "site"]
    version: int | None = PydanticField(default=None, ge=1)


class ThemeRead(SQLModel):
    id: str
    scope: Literal["user", "site"]
    version: int
    definition: ThemeDefinition


class ThemeListRead(SQLModel):
    themes: list[ThemeRead]
    site_default_id: str
