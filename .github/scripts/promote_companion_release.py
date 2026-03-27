#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, NoReturn

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


class GitHubApiError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def request_json(url: str, token: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "sambee-promotion-workflow",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        message = error.reason
        if error_body:
            try:
                payload = json.loads(error_body)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict) and payload.get("message"):
                message = str(payload["message"])
        raise GitHubApiError(error.code, message) from error


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


def parse_release_id(release_ref: str) -> int | None:
    release_ref = release_ref.strip()
    match = re.search(r"/releases/(\d+)(?:[/?#]|$)", release_ref)
    if match:
        return int(match.group(1))
    if release_ref.isdigit():
        return int(release_ref)
    return None


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
        bundle_asset = find_asset(assets, pattern_group["bundle"])
        signature_asset = find_asset(assets, pattern_group["signature"])

        if bundle_asset is None and signature_asset is None:
            continue
        if bundle_asset is None:
            fail(
                f"Missing asset for {platform_key} updater bundle. Expected patterns: "
                f"{pattern_group['bundle']}"
            )
        if signature_asset is None:
            fail(
                f"Missing asset for {platform_key} updater signature. Expected patterns: "
                f"{pattern_group['signature']}"
            )

        feed["platforms"][platform_key] = {
            "url": bundle_asset["browser_download_url"],
            "signature": request_text(signature_asset["browser_download_url"]),
        }

    if not feed["platforms"]:
        fail("No complete updater asset pairs were discovered for the Tauri feed")

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


def fetch_release(release_ref: str, owner: str, repo: str, token: str) -> dict:
    release_id = parse_release_id(release_ref)
    if release_id is not None:
        release_url = (
            f"https://api.github.com/repos/{owner}/{repo}/releases/{release_id}"
        )
        try:
            release = request_json(release_url, token)
        except GitHubApiError as error:
            fail(
                f"Unable to fetch release ID {release_id} from {owner}/{repo}: "
                f"HTTP {error.status_code} {error.message}"
            )
        if not isinstance(release, dict):
            fail(f"Unexpected API response while fetching release ID {release_id}")
        return release

    tag_name = normalize_release_tag(release_ref)
    release_url = (
        f"https://api.github.com/repos/{owner}/{repo}/releases/tags/"
        f"{urllib.parse.quote(tag_name, safe='')}"
    )
    try:
        release = request_json(release_url, token)
    except GitHubApiError as error:
        if error.status_code != 404:
            fail(
                f"Unable to fetch release {tag_name} from {owner}/{repo}: "
                f"HTTP {error.status_code} {error.message}"
            )

        releases_url = (
            f"https://api.github.com/repos/{owner}/{repo}/releases?per_page=100"
        )
        try:
            releases = request_json(releases_url, token)
        except GitHubApiError as list_error:
            fail(
                f"Unable to list releases in {owner}/{repo} while resolving {tag_name}: "
                f"HTTP {list_error.status_code} {list_error.message}"
            )
        if not isinstance(releases, list):
            fail(f"Unexpected API response while listing releases for {owner}/{repo}")
        for release_candidate in releases:
            if release_candidate.get("tag_name") == tag_name:
                return release_candidate
        fail(
            f"Release {tag_name} was not found in {owner}/{repo}. "
            "If it is a draft, ensure the workflow token has push access to that repository."
        )

    if not isinstance(release, dict):
        fail(f"Unexpected API response while fetching release {tag_name}")
    return release


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

    release = fetch_release(
        args.release_ref,
        args.release_owner,
        args.release_repo,
        token,
    )
    tag_name = str(release.get("tag_name") or normalize_release_tag(args.release_ref))

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
