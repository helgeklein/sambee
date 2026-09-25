"""HTTP Content-Disposition helpers."""

from typing import Literal
from urllib.parse import quote

ContentDispositionType = Literal["attachment", "inline"]
RFC8187_ATTR_CHARACTERS = "!#$&+-.^_`|~"
ACTIVE_DOCUMENT_MIME_TYPES = frozenset({"text/html", "application/xhtml+xml", "image/svg+xml"})


def is_active_document_mime_type(mime_type: str | None) -> bool:
    return mime_type is not None and mime_type.split(";", 1)[0].strip().lower() in ACTIVE_DOCUMENT_MIME_TYPES


def build_content_disposition(disposition_type: ContentDispositionType, filename: str) -> str:
    """Build a modern RFC 8187 Content-Disposition header for a UTF-8 filename."""

    encoded_filename = quote(filename, safe=RFC8187_ATTR_CHARACTERS)
    return f"{disposition_type}; filename*=UTF-8''{encoded_filename}"
