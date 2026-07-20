#!/usr/bin/env python3
"""Resolve the immutable publication state for a Companion release tag."""

from __future__ import annotations

import argparse
import hashlib
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
NEW_CANDIDATE_INSTRUCTIONS = (
    "Increment the third build-sequence component in VERSION, run ./scripts/sync-version, "
    "commit the synchronized changes on main, and rerun."
)


def fail(message: str) -> NoReturn:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(1)


def fail_new_candidate(message: str) -> NoReturn:
    fail(f"{message} {NEW_CANDIDATE_INSTRUCTIONS}")


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


def request_asset_bytes(asset: dict[str, Any], token: str) -> bytes:
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
            return response.read()
    except urllib.error.HTTPError as error:
        fail(f"Unable to read release asset {asset.get('name')}: {error}")


def request_asset_json(asset: dict[str, Any], token: str) -> dict[str, Any]:
    try:
        payload = json.loads(request_asset_bytes(asset, token).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"Unable to read release asset {asset.get('name')}: {error}")
    if not isinstance(payload, dict):
        fail(f"Release asset {asset.get('name')} must contain a JSON object")
    return payload


def find_asset(release: dict[str, Any], name: str) -> dict[str, Any] | None:
    for asset in release.get("assets", []):
        if isinstance(asset, dict) and asset.get("name") == name:
            return asset
    return None


def expected_asset_set_digest(expected_assets: list[dict[str, Any]]) -> str:
    encoded = json.dumps(
        sorted(expected_assets, key=lambda asset: str(asset.get("name"))),
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


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
            fail_new_candidate(
                f"Existing Companion release provenance {key} does not match the selected "
                "canonical candidate."
            )


def resolve_state(
    release: dict[str, Any] | None, identity: ReleaseIdentity, token: str
) -> str:
    if release is None:
        return "build"

    provenance_asset = find_asset(release, PROVENANCE_ASSET)
    if provenance_asset is None:
        fail_new_candidate(
            "Existing Companion release has no provenance asset and cannot be safely resumed. "
        )
    provenance_bytes = request_asset_bytes(provenance_asset, token)
    try:
        provenance = json.loads(provenance_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"Unable to read release asset {provenance_asset.get('name')}: {error}")
    if not isinstance(provenance, dict):
        fail(f"Release asset {provenance_asset.get('name')} must contain a JSON object")
    require_matching_identity(provenance, identity)
    if provenance.get("schema_version") != 1:
        fail("Existing Companion release provenance has an unsupported schema version")

    completion_asset = find_asset(release, COMPLETION_ASSET)
    if completion_asset is not None:
        completion = request_asset_json(completion_asset, token)
        if completion.get("schema_version") != 1:
            fail(
                "Existing Companion completion marker has an unsupported schema version"
            )
        if (
            completion.get("provenance_sha256")
            != hashlib.sha256(provenance_bytes).hexdigest()
        ):
            fail(
                "Existing Companion completion marker does not match release provenance"
            )
        expected_assets = provenance.get("assets")
        if (
            not isinstance(expected_assets, list)
            or completion.get("expected_assets") != expected_assets
        ):
            fail(
                "Existing Companion completion marker does not match release provenance"
            )
        if completion.get("expected_assets_sha256") != expected_asset_set_digest(
            expected_assets
        ):
            fail("Existing Companion completion marker has an invalid asset-set digest")
        return "complete"
    if not release.get("draft", False):
        fail_new_candidate(
            "Published Companion release has no completion marker and is conflicting state. "
        )

    workflow_run = provenance.get("workflow_run")
    artifacts = provenance.get("actions_artifacts")
    platforms = provenance.get("platforms")
    if (
        not isinstance(workflow_run, dict)
        or not isinstance(artifacts, list)
        or not artifacts
        or not isinstance(platforms, list)
        or not platforms
        or not isinstance(provenance.get("artifact_manifest_sha256"), str)
    ):
        fail_new_candidate(
            "Existing Companion draft does not record recovery artifact identities. "
        )
    if not isinstance(workflow_run.get("id"), int) or not isinstance(
        workflow_run.get("attempt"), int
    ):
        fail("Existing Companion draft has invalid workflow recovery metadata")
    for artifact in artifacts:
        if (
            not isinstance(artifact, dict)
            or not isinstance(artifact.get("id"), int)
            or not isinstance(artifact.get("platform"), str)
            or not isinstance(artifact.get("target"), str)
            or not isinstance(artifact.get("name"), str)
            or not isinstance(artifact.get("digest"), str)
            or not artifact["digest"]
        ):
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
