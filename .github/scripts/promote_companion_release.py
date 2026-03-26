#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import NoReturn

TAURI_PLATFORM_PATTERNS = {
    "windows-x86_64": {
        "bundle": [r"x64-setup\.exe$"],
        "signature": [r"x64-setup\.exe\.sig$"],
    },
    "windows-aarch64": {
        "bundle": [r"arm64-setup\.exe$"],
        "signature": [r"arm64-setup\.exe\.sig$"],
    },
    "darwin-aarch64": {
        "bundle": [r"(aarch64|arm64).*\.app\.tar\.gz$", r"\.app\.tar\.gz$"],
        "signature": [
            r"(aarch64|arm64).*\.app\.tar\.gz\.sig$",
            r"\.app\.tar\.gz\.sig$",
        ],
    },
    "linux-x86_64": {
        "bundle": [r"(amd64|x86_64).*\.AppImage$", r"\.AppImage$"],
        "signature": [r"(amd64|x86_64).*\.AppImage\.sig$", r"\.AppImage\.sig$"],
    },
}

SAMBEE_DOWNLOAD_PATTERNS = {
    "windows-x64": [r"x64-setup\.exe$"],
    "windows-arm64": [r"arm64-setup\.exe$"],
    "macos-arm64": [r"(aarch64|arm64).*\.dmg$", r"\.dmg$"],
    "linux-x64": [r"(amd64|x86_64).*\.AppImage$", r"\.AppImage$"],
}


def fail(message: str) -> NoReturn:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(1)


def request_json(url: str, token: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "sambee-promotion-workflow",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def request_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "sambee-promotion-workflow"},
    )
    with urllib.request.urlopen(request) as response:
        return response.read().decode("utf-8").strip()


def normalize_release_tag(release_ref: str) -> str:
    release_ref = release_ref.strip()
    match = re.search(r"/releases/tag/([^/?#]+)", release_ref)
    if match:
        return urllib.parse.unquote(match.group(1))
    return release_ref


def normalize_version(tag_name: str) -> str:
    if tag_name.startswith("companion-v"):
        return tag_name[len("companion-v") :]
    if tag_name.startswith("v"):
        return tag_name[1:]
    return tag_name


def find_asset(assets: list[dict], patterns: list[str]) -> dict | None:
    for pattern in patterns:
        regex = re.compile(pattern, re.IGNORECASE)
        for asset in assets:
            if regex.search(asset["name"]):
                return asset
    return None


def require_asset(assets: list[dict], patterns: list[str], description: str) -> dict:
    asset = find_asset(assets, patterns)
    if asset is None:
        fail(f"Missing asset for {description}. Expected patterns: {patterns}")
    return asset


def build_tauri_feed(release: dict, assets: list[dict]) -> dict:
    feed = {
        "version": normalize_version(release["tag_name"]),
        "notes": release.get("body") or "",
        "pub_date": release.get("published_at") or release.get("created_at"),
        "platforms": {},
    }

    for platform_key, pattern_group in TAURI_PLATFORM_PATTERNS.items():
        bundle_asset = require_asset(
            assets, pattern_group["bundle"], f"{platform_key} updater bundle"
        )
        signature_asset = require_asset(
            assets, pattern_group["signature"], f"{platform_key} updater signature"
        )

        feed["platforms"][platform_key] = {
            "url": bundle_asset["browser_download_url"],
            "signature": request_text(signature_asset["browser_download_url"]),
        }

    return feed


def build_sambee_metadata(release: dict, assets: list[dict]) -> dict:
    asset_map: dict[str, str] = {}
    for platform_key, patterns in SAMBEE_DOWNLOAD_PATTERNS.items():
        asset = find_asset(assets, patterns)
        if asset is not None:
            asset_map[platform_key] = asset["browser_download_url"]

    if not asset_map:
        fail("No downloadable installer assets were discovered for Sambee metadata")

    return {
        "version": normalize_version(release["tag_name"]),
        "published_at": release.get("published_at") or release.get("created_at"),
        "notes": release.get("body") or "",
        "assets": asset_map,
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-ref", required=True)
    parser.add_argument("--release-owner", required=True)
    parser.add_argument("--release-repo", required=True)
    parser.add_argument("--release-repo-path", required=True)
    parser.add_argument("--companion-channel-test", action="store_true")
    parser.add_argument("--companion-channel-beta", action="store_true")
    parser.add_argument("--companion-channel-stable", action="store_true")
    parser.add_argument("--sambee", action="store_true")
    args = parser.parse_args()

    if not any(
        [
            args.companion_channel_test,
            args.companion_channel_beta,
            args.companion_channel_stable,
            args.sambee,
        ]
    ):
        fail("At least one promotion target must be selected")

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        fail("GITHUB_TOKEN environment variable is required")

    tag_name = normalize_release_tag(args.release_ref)
    release_url = (
        f"https://api.github.com/repos/{args.release_owner}/{args.release_repo}/releases/tags/"
        f"{urllib.parse.quote(tag_name, safe='')}"
    )
    release = request_json(release_url, token)

    if release.get("draft"):
        fail(f"Release {tag_name} is still a draft")

    assets = release.get("assets", [])
    if not assets:
        fail(f"Release {tag_name} has no assets")

    output_root = Path(args.release_repo_path) / "docs" / "feeds"

    if any(
        [
            args.companion_channel_test,
            args.companion_channel_beta,
            args.companion_channel_stable,
        ]
    ):
        tauri_feed = build_tauri_feed(release, assets)
        if args.companion_channel_test:
            write_json(
                output_root / "companion" / "tauri" / "test" / "latest.json", tauri_feed
            )
        if args.companion_channel_beta:
            write_json(
                output_root / "companion" / "tauri" / "beta" / "latest.json", tauri_feed
            )
        if args.companion_channel_stable:
            write_json(
                output_root / "companion" / "tauri" / "stable" / "latest.json",
                tauri_feed,
            )

    if args.sambee:
        sambee_metadata = build_sambee_metadata(release, assets)
        write_json(
            output_root / "sambee" / "companion" / "latest.json", sambee_metadata
        )

    print(f"Prepared promotion payloads for {tag_name}")


if __name__ == "__main__":
    main()
