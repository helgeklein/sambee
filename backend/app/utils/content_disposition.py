"""HTTP Content-Disposition helpers."""

from typing import Literal
from urllib.parse import quote

ContentDispositionType = Literal["attachment", "inline"]
RFC8187_ATTR_CHARACTERS = "!#$&+-.^_`|~"


def build_content_disposition(disposition_type: ContentDispositionType, filename: str) -> str:
    """Build a modern RFC 8187 Content-Disposition header for a UTF-8 filename."""

    encoded_filename = quote(filename, safe=RFC8187_ATTR_CHARACTERS)
    return f"{disposition_type}; filename*=UTF-8''{encoded_filename}"
