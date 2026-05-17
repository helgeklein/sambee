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
SHA_TAG_RE = re.compile(r"^sha-[0-9a-f]{40}$")
ARCH_PREVIEW_TAG_RE = re.compile(r"^sha-[0-9a-f]{40}-(?:amd64|arm64)$")
SIGNATURE_ARTIFACT_TAG_RE = re.compile(
    r"^sha256-([0-9a-f]{64})(?:\.(?:att|meta|sig))?"
    r"$"
)


@dataclass
class PackageVersion:
    version_id: int
    created_at: str
    digest: str
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
    if not isinstance(payload, dict):
        raise RuntimeError(f"Could not resolve owner type for {owner!r}")
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
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected versions payload for {package_name!r}")
        for item in payload:
            container = item.get("metadata", {}).get("container", {})
            tags = container.get("tags", []) or []
            digest = item.get("name") or container.get("digest", "")
            versions.append(
                PackageVersion(
                    version_id=item["id"],
                    created_at=item["created_at"],
                    digest=digest,
                    tags=tags,
                )
            )
        if len(payload) < 100:
            break
        page += 1
    return versions


def is_protected_image_tag(tag: str) -> bool:
    if tag in {"stable", "beta", "test"}:
        return True

    if MINOR_RE.match(tag):
        return True

    if SEMVER_RE.match(tag):
        return "-" not in tag

    return False


def is_test_only_image_tag(tag: str) -> bool:
    return bool(SHA_TAG_RE.match(tag) or ARCH_PREVIEW_TAG_RE.match(tag))


def classify_image_version(version: PackageVersion) -> str:
    if not version.tags:
        return "untagged"
    if any(is_protected_image_tag(tag) for tag in version.tags):
        return "protected"
    if all(is_test_only_image_tag(tag) for tag in version.tags):
        return "preview"
    return "protected"


def retained_image_digests(image_versions: list[PackageVersion]) -> set[str]:
    retained: set[str] = set()
    for version in image_versions:
        classification = classify_image_version(version)
        if classification == "protected":
            if version.digest.startswith("sha256:"):
                retained.add(version.digest)

    return retained


def signature_artifact_image_digests(tags: list[str]) -> set[str] | None:
    image_digests: set[str] = set()
    for tag in tags:
        match = SIGNATURE_ARTIFACT_TAG_RE.match(tag)
        if not match:
            return None
        image_digests.add(f"sha256:{match.group(1)}")
    return image_digests


def classify_signature_version(
    version: PackageVersion, retained_digests: set[str]
) -> str:
    if not version.tags:
        return "untagged"

    image_digests = signature_artifact_image_digests(version.tags)
    if image_digests is None:
        return "protected"
    if image_digests & retained_digests:
        return "protected"
    return "stale-artifact"


def emit_log(version: PackageVersion, classification: str, action: str) -> None:
    print(
        json.dumps(
            {
                "version_id": version.version_id,
                "created_at": version.created_at,
                "digest": version.digest,
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
    parser.add_argument("--image-package-name", required=True)
    parser.add_argument("--signature-package-name", required=True)
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN is required")

    owner_type = get_owner_type(args.owner, token)
    image_versions = load_versions(
        args.owner, owner_type, args.image_package_name, token
    )
    signature_versions = load_versions(
        args.owner, owner_type, args.signature_package_name, token
    )
    retained_digests = retained_image_digests(image_versions)
    if not retained_digests:
        raise RuntimeError(
            "No retained image digests found; refusing to delete signatures"
        )

    for version in signature_versions:
        classification = classify_signature_version(version, retained_digests)
        if classification == "stale-artifact":
            emit_log(version, classification, "delete")
            try:
                delete_version(
                    args.owner,
                    owner_type,
                    args.signature_package_name,
                    version.version_id,
                    token,
                )
            except urllib.error.HTTPError as exc:
                raise RuntimeError(
                    f"Failed to delete package version {version.version_id}: {exc}"
                ) from exc
        else:
            emit_log(version, classification, "protect")

    return 0


if __name__ == "__main__":
    sys.exit(main())
