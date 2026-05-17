#!/usr/bin/env python3

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
MINOR_RE = re.compile(r"^\d+\.\d+$")
PRERELEASE_SERIES_RE = re.compile(r"^\d+\.\d+-beta$")
SHA_TAG_RE = re.compile(r"^sha-[0-9a-f]{40}$")
ARCH_PREVIEW_TAG_RE = re.compile(r"^sha-[0-9a-f]{40}-(?:amd64|arm64)$")


@dataclass
class PackageVersion:
    version_id: int
    created_at: str
    tags: list[str]


def api_request(url: str, token: str, method: str = "GET") -> object | None:
    request = urllib.request.Request(url, method=method)
    request.add_header("Accept", "application/vnd.github+json")
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("X-GitHub-Api-Version", "2022-11-28")
    with urllib.request.urlopen(request) as response:
        if response.status == 204:
            return None

        payload = response.read()
        if not payload:
            return None

        return json.load(io.BytesIO(payload))


def get_owner_type(owner: str, token: str) -> str:
    payload = api_request(f"https://api.github.com/users/{owner}", token)
    owner_type = payload.get("type", "")
    if owner_type not in {"Organization", "User"}:
        raise RuntimeError(f"Unsupported owner type for {owner!r}: {owner_type!r}")
    return owner_type


def build_versions_endpoint(
    owner: str, owner_type: str, package_name: str, page: int
) -> str:
    encoded_package = urllib.parse.quote(package_name, safe="")
    if owner_type == "Organization":
        base = f"https://api.github.com/orgs/{owner}/packages/container/{encoded_package}/versions"
    else:
        base = f"https://api.github.com/users/{owner}/packages/container/{encoded_package}/versions"
    return f"{base}?page={page}&per_page=100"


def build_delete_endpoint(
    owner: str, owner_type: str, package_name: str, version_id: int
) -> str:
    encoded_package = urllib.parse.quote(package_name, safe="")
    if owner_type == "Organization":
        return f"https://api.github.com/orgs/{owner}/packages/container/{encoded_package}/versions/{version_id}"
    return f"https://api.github.com/users/{owner}/packages/container/{encoded_package}/versions/{version_id}"


def load_versions(
    owner: str, owner_type: str, package_name: str, token: str
) -> list[PackageVersion]:
    versions: list[PackageVersion] = []
    page = 1
    while True:
        payload = api_request(
            build_versions_endpoint(owner, owner_type, package_name, page), token
        )
        if not payload:
            break
        for item in payload:
            tags = item.get("metadata", {}).get("container", {}).get("tags", []) or []
            versions.append(
                PackageVersion(
                    version_id=item["id"],
                    created_at=item["created_at"],
                    tags=tags,
                )
            )
        if len(payload) < 100:
            break
        page += 1
    return versions


def is_protected_tag(tag: str) -> bool:
    return tag in {"stable", "beta", "test"} or bool(
        SEMVER_RE.match(tag) or MINOR_RE.match(tag) or PRERELEASE_SERIES_RE.match(tag)
    )


def is_test_only_tag(tag: str) -> bool:
    return bool(SHA_TAG_RE.match(tag) or ARCH_PREVIEW_TAG_RE.match(tag))


def classify(version: PackageVersion) -> str:
    if not version.tags:
        return "protected"
    if any(is_protected_tag(tag) for tag in version.tags):
        return "protected"
    if all(is_test_only_tag(tag) for tag in version.tags):
        return "deletable"
    return "protected"


def emit_log(version: PackageVersion, classification: str, action: str) -> None:
    print(
        json.dumps(
            {
                "version_id": version.version_id,
                "created_at": version.created_at,
                "tags": version.tags,
                "classification": classification,
                "action": action,
            }
        )
    )


def delete_version(
    owner: str, owner_type: str, package_name: str, version_id: int, token: str
) -> None:
    endpoint = build_delete_endpoint(owner, owner_type, package_name, version_id)
    api_request(endpoint, token, method="DELETE")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner", required=True)
    parser.add_argument("--package-name", required=True)
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN is required")

    owner_type = get_owner_type(args.owner, token)
    versions = load_versions(args.owner, owner_type, args.package_name, token)

    deletable: list[PackageVersion] = []
    for version in versions:
        classification = classify(version)
        if classification == "deletable":
            deletable.append(version)
            emit_log(version, classification, "delete-candidate")
        else:
            emit_log(version, classification, "protect")

    deletable.sort(key=lambda version: version.created_at, reverse=True)
    for version in deletable:
        emit_log(version, "deletable", "delete")
        try:
            delete_version(
                args.owner, owner_type, args.package_name, version.version_id, token
            )
        except urllib.error.HTTPError as exc:
            raise RuntimeError(
                f"Failed to delete package version {version.version_id}: {exc}"
            ) from exc

    return 0


if __name__ == "__main__":
    sys.exit(main())
