from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Final, Literal, TypeAlias
from urllib.parse import urlparse, urlunparse

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

CompanionDownloadMetadataSource: TypeAlias = Literal["feed", "pin"]

COMPANION_DOWNLOADS_SOURCE_FEED: Final[Literal["feed"]] = "feed"
COMPANION_DOWNLOADS_SOURCE_PIN: Final[Literal["pin"]] = "pin"
COMPANION_METADATA_REQUEST_TIMEOUT_SECONDS: Final[int] = 10
SUPPORTED_COMPANION_DOWNLOAD_PLATFORMS: Final[frozenset[str]] = frozenset(
    {"windows-x64", "windows-arm64", "macos-arm64", "linux-x64"}
)


class CompanionDownloadResolutionError(RuntimeError):
    """Raised when Companion download metadata cannot be resolved safely."""


@dataclass(frozen=True)
class ResolvedCompanionDownloadMetadata:
    """Normalized Companion download metadata exposed to the frontend."""

    source: CompanionDownloadMetadataSource
    version: str
    published_at: str | None
    notes: str
    assets: dict[str, str]


def resolve_companion_download_metadata() -> ResolvedCompanionDownloadMetadata:
    """Resolve Companion download metadata from a pin override or the hosted feed."""

    if settings.companion_pin_version:
        return _build_pinned_metadata()
    return _fetch_feed_metadata(settings.companion_metadata_feed_url)


def _build_pinned_metadata() -> ResolvedCompanionDownloadMetadata:
    pin_version = settings.companion_pin_version
    if pin_version is None:
        raise CompanionDownloadResolutionError("Companion pin override is missing a version.")

    asset_candidates = {
        "windows-x64": settings.companion_pin_windows_x64_url,
        "windows-arm64": settings.companion_pin_windows_arm64_url,
        "macos-arm64": settings.companion_pin_macos_arm64_url,
        "linux-x64": settings.companion_pin_linux_x64_url,
    }
    assets = {
        platform_key: _normalize_asset_url(str(url_value), f"pinned asset URL for {platform_key}")
        for platform_key, url_value in asset_candidates.items()
        if url_value
    }

    if not assets:
        raise CompanionDownloadResolutionError(
            "Companion pin override is configured without any usable installer URLs."
        )

    return ResolvedCompanionDownloadMetadata(
        source=COMPANION_DOWNLOADS_SOURCE_PIN,
        version=pin_version,
        published_at=settings.companion_pin_published_at,
        notes=settings.companion_pin_notes,
        assets=assets,
    )


def _fetch_feed_metadata(feed_url: str) -> ResolvedCompanionDownloadMetadata:
    payload = _request_json(feed_url)
    if not isinstance(payload, dict):
        raise CompanionDownloadResolutionError("Companion download metadata feed returned an invalid JSON document.")

    version = _require_non_empty_string(payload.get("version"), "Companion download metadata feed is missing a version.")
    published_at = _optional_string(payload.get("published_at"), "published_at")
    notes = _string_with_default(payload.get("notes"), "notes")
    assets_payload = payload.get("assets")
    if not isinstance(assets_payload, dict):
        raise CompanionDownloadResolutionError("Companion download metadata feed is missing the assets map.")

    assets = _normalize_asset_map(assets_payload)
    if not assets:
        raise CompanionDownloadResolutionError(
            "Companion download metadata feed did not include any supported installer assets."
        )

    return ResolvedCompanionDownloadMetadata(
        source=COMPANION_DOWNLOADS_SOURCE_FEED,
        version=version,
        published_at=published_at,
        notes=notes,
        assets=assets,
    )


def _request_json(url: str) -> object:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "sambee-backend/companion-downloads",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=COMPANION_METADATA_REQUEST_TIMEOUT_SECONDS) as response:
            charset = response.headers.get_content_charset("utf-8")
            return json.loads(response.read().decode(charset))
    except urllib.error.HTTPError as error:
        raise CompanionDownloadResolutionError(
            f"Companion download metadata feed request failed with HTTP {error.code}."
        ) from error
    except urllib.error.URLError as error:
        raise CompanionDownloadResolutionError(
            f"Companion download metadata feed is unreachable: {error.reason}."
        ) from error
    except socket.timeout as error:
        raise CompanionDownloadResolutionError("Companion download metadata feed request timed out.") from error
    except json.JSONDecodeError as error:
        raise CompanionDownloadResolutionError("Companion download metadata feed returned invalid JSON.") from error


def _normalize_asset_map(assets_payload: dict[object, object]) -> dict[str, str]:
    normalized_assets: dict[str, str] = {}

    for platform_key, raw_url in assets_payload.items():
        if not isinstance(platform_key, str) or platform_key not in SUPPORTED_COMPANION_DOWNLOAD_PLATFORMS:
            continue
        if not isinstance(raw_url, str):
            raise CompanionDownloadResolutionError(
                f"Companion download metadata feed contains a non-string asset URL for {platform_key}."
            )
        normalized_assets[platform_key] = _normalize_asset_url(raw_url, f"asset URL for {platform_key}")

    return normalized_assets


def _normalize_asset_url(raw_url: str, description: str) -> str:
    normalized = raw_url.strip()
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise CompanionDownloadResolutionError(f"Companion {description} must be an absolute http or https URL.")
    if parsed.username or parsed.password:
        raise CompanionDownloadResolutionError(f"Companion {description} must not include embedded credentials.")
    if not parsed.path:
        raise CompanionDownloadResolutionError(f"Companion {description} must include a download path.")

    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, parsed.query, ""))


def _require_non_empty_string(value: object, error_message: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CompanionDownloadResolutionError(error_message)
    return value.strip()


def _optional_string(value: object, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise CompanionDownloadResolutionError(f"Companion download metadata field '{field_name}' must be a string.")
    normalized = value.strip()
    return normalized or None


def _string_with_default(value: object, field_name: str) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise CompanionDownloadResolutionError(f"Companion download metadata field '{field_name}' must be a string.")
    return value.strip()