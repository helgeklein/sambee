from __future__ import annotations

import unicodedata
import uuid
from pathlib import PurePosixPath

from sqlmodel import Session

from app.models.user import User
from app.services.connection_access import get_accessible_connection_or_404

LOCAL_DRIVE_PREFIX = "local-drive:"


def normalize_history_search_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(character for character in decomposed if not unicodedata.combining(character)).casefold()


def normalize_recent_history_path(path: str) -> str:
    """Return a canonical safe relative path for a recent-history record."""

    normalized = path.replace("\\", "/").strip()
    if not normalized or normalized.startswith("/"):
        raise ValueError("History path must be a non-empty relative path")

    parts = normalized.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("History path must not contain empty, current-directory, or parent-directory segments")

    canonical = str(PurePosixPath(*parts))
    if canonical in {"", "."}:
        raise ValueError("History path must identify an item")
    return canonical


def validate_history_connection_access(*, connection_id: str, current_user: User, session: Session) -> None:
    if connection_id.startswith(LOCAL_DRIVE_PREFIX):
        if len(connection_id) == len(LOCAL_DRIVE_PREFIX):
            raise ValueError("Local drive ID cannot be empty")
        return

    try:
        parsed_connection_id = uuid.UUID(connection_id)
    except ValueError as exc:
        raise ValueError("Connection ID must be a connection UUID or local-drive ID") from exc
    get_accessible_connection_or_404(session, current_user, parsed_connection_id)
