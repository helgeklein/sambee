"""Unit tests for Companion download metadata resolution."""

from __future__ import annotations

import pytest

from app.services import companion_downloads


@pytest.fixture
def reset_companion_download_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(companion_downloads.settings, "companion_pin_version", None)
    monkeypatch.setattr(companion_downloads.settings, "companion_pin_published_at", None)
    monkeypatch.setattr(companion_downloads.settings, "companion_pin_notes", "")
    monkeypatch.setattr(companion_downloads.settings, "companion_pin_windows_x64_url", None)
    monkeypatch.setattr(companion_downloads.settings, "companion_pin_windows_arm64_url", None)
    monkeypatch.setattr(companion_downloads.settings, "companion_pin_macos_arm64_url", None)
    monkeypatch.setattr(companion_downloads.settings, "companion_pin_linux_x64_url", None)
    monkeypatch.setattr(
        companion_downloads.settings,
        "companion_metadata_feed_url",
        "https://release-feeds.sambee.net/feeds/sambee/companion/latest.json",
    )


class TestResolveCompanionDownloadMetadata:
    def test_uses_pin_override_when_configured(self, monkeypatch: pytest.MonkeyPatch, reset_companion_download_settings: None) -> None:
        monkeypatch.setattr(companion_downloads.settings, "companion_pin_version", "0.6.0")
        monkeypatch.setattr(companion_downloads.settings, "companion_pin_notes", "Pinned release")
        monkeypatch.setattr(
            companion_downloads.settings,
            "companion_pin_windows_x64_url",
            "https://downloads.example.test/Sambee-Companion_0.6.0_windows_x64-setup.exe",
        )

        resolved = companion_downloads.resolve_companion_download_metadata()

        assert resolved.source == companion_downloads.COMPANION_DOWNLOADS_SOURCE_PIN
        assert resolved.version == "0.6.0"
        assert resolved.notes == "Pinned release"
        assert resolved.assets == {"windows-x64": "https://downloads.example.test/Sambee-Companion_0.6.0_windows_x64-setup.exe"}

    def test_uses_feed_when_no_pin_is_configured(self, monkeypatch: pytest.MonkeyPatch, reset_companion_download_settings: None) -> None:
        monkeypatch.setattr(
            companion_downloads,
            "_request_json",
            lambda _url: {
                "version": "0.5.0",
                "published_at": "2026-03-27T12:00:00Z",
                "notes": "Release notes",
                "assets": {
                    "windows-x64": "https://downloads.example.test/Sambee-Companion.exe",
                    "unknown-platform": "https://downloads.example.test/ignore-me.exe",
                },
            },
        )

        resolved = companion_downloads.resolve_companion_download_metadata()

        assert resolved.source == companion_downloads.COMPANION_DOWNLOADS_SOURCE_FEED
        assert resolved.version == "0.5.0"
        assert resolved.assets == {"windows-x64": "https://downloads.example.test/Sambee-Companion.exe"}

    def test_rejects_relative_asset_urls(self, monkeypatch: pytest.MonkeyPatch, reset_companion_download_settings: None) -> None:
        monkeypatch.setattr(
            companion_downloads,
            "_request_json",
            lambda _url: {
                "version": "0.5.0",
                "published_at": "2026-03-27T12:00:00Z",
                "notes": "Release notes",
                "assets": {"windows-x64": "/downloads/Sambee-Companion.exe"},
            },
        )

        with pytest.raises(companion_downloads.CompanionDownloadResolutionError, match="absolute http or https URL"):
            companion_downloads.resolve_companion_download_metadata()
