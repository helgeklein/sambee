#!/usr/bin/env python3
"""Resolve the immutable publication state for a Companion release tag."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, NoReturn

PROVENANCE_ASSET = "companion-release-provenance.json"
COMPLETION_ASSET = "companion-completion-marker.json"


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
            "User-Agent": "sambee-companion-build-workflow",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise GitHubApiError(error.code, error.reason) from error


def request_asset_json(asset: dict[str, Any], token: str) -> dict[str, Any]:
    url = asset.get("url") or asset.get("browser_download_url")
    if not isinstance(url, str):
        fail(f"Release asset {asset.get('name')} has no download URL")
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/octet-stream",
            "Authorization": f"Bearer {token}",
            "User-Agent": "sambee-companion-build-workflow",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"Unable to read release asset {asset.get('name')}: {error}")
    if not isinstance(payload, dict):
        fail(f"Release asset {asset.get('name')} must contain a JSON object")
    return payload


def find_asset(release: dict[str, Any], name: str) -> dict[str, Any] | None:
    for asset in release.get("assets", []):
        if isinstance(asset, dict) and asset.get("name") == name:
            return asset
    return None


@dataclass(frozen=True)
class ReleaseIdentity:
    version: str
    build_tag: str
    source_sha: str
    release_tag: str


def require_matching_identity(
    provenance: dict[str, Any], identity: ReleaseIdentity
) -> None:
    expected = {
        "version": identity.version,
        "build_tag": identity.build_tag,
        "source_sha": identity.source_sha,
        "release_tag": identity.release_tag,
    }
    for key, value in expected.items():
        if provenance.get(key) != value:
            fail(
                f"Existing Companion release provenance {key} does not match the selected "
                "canonical candidate. Increment Z and publish a new candidate."
            )


def resolve_state(
    release: dict[str, Any] | None, identity: ReleaseIdentity, token: str
) -> str:
    if release is None:
        return "build"

    provenance_asset = find_asset(release, PROVENANCE_ASSET)
    if provenance_asset is None:
        fail(
            "Existing Companion release has no provenance asset and cannot be safely resumed. "
            "Increment Z and publish a new candidate."
        )
    provenance = request_asset_json(provenance_asset, token)
    require_matching_identity(provenance, identity)

    completion_asset = find_asset(release, COMPLETION_ASSET)
    if completion_asset is not None:
        return "complete"
    if not release.get("draft", False):
        fail(
            "Published Companion release has no completion marker and is conflicting state. "
            "Increment Z and publish a new candidate."
        )

    workflow_run = provenance.get("workflow_run")
    artifacts = provenance.get("actions_artifacts")
    if (
        not isinstance(workflow_run, dict)
        or not isinstance(artifacts, list)
        or not artifacts
    ):
        fail(
            "Existing Companion draft does not record recovery artifact identities. "
            "Increment Z and publish a new candidate."
        )
    if not isinstance(workflow_run.get("id"), int) or not isinstance(
        workflow_run.get("attempt"), int
    ):
        fail("Existing Companion draft has invalid workflow recovery metadata")
    for artifact in artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("id"), int):
            fail("Existing Companion draft has invalid retained artifact metadata")
    return "recover-finalizer"


def fetch_release(owner: str, repo: str, tag: str, token: str) -> dict[str, Any] | None:
    url = (
        f"https://api.github.com/repos/{owner}/{repo}/releases/tags/"
        f"{urllib.parse.quote(tag, safe='')}"
    )
    try:
        payload = request_json(url, token)
    except GitHubApiError as error:
        if error.status_code == 404:
            return None
        fail(
            f"Unable to fetch Companion release {tag} from {owner}/{repo}: "
            f"HTTP {error.status_code} {error.message}"
        )
    if not isinstance(payload, dict):
        fail("Unexpected API response while resolving Companion release state")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build-tag", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--release-tag", required=True)
    args = parser.parse_args()
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        fail("GITHUB_TOKEN environment variable is required")

    identity = ReleaseIdentity(
        version=args.version,
        build_tag=args.build_tag,
        source_sha=args.source_sha,
        release_tag=args.release_tag,
    )
    release = fetch_release(args.owner, args.repo, args.release_tag, token)
    state = resolve_state(release, identity, token)
    print(f"state={state}")
    if release is not None and isinstance(release.get("id"), int):
        print(f"release_id={release['id']}")


if __name__ == "__main__":
    main()
