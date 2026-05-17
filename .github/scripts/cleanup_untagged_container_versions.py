#!/usr/bin/env python3

from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
MINOR_RE = re.compile(r"^\d+\.\d+$")
PRERELEASE_SERIES_RE = re.compile(r"^\d+\.\d+-beta$")
SHA_TAG_RE = re.compile(r"^sha-[0-9a-f]{40}$")
RUNNABLE_INDEX_MEDIA_TYPES = {
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
}


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
        raise RuntimeError(f"Unable to resolve owner type for {owner!r}")
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
            raise RuntimeError("Package versions API returned an unexpected payload")
        for item in payload:
            container_metadata = item.get("metadata", {}).get("container", {})
            tags = container_metadata.get("tags", []) or []
            digest = item.get("name") or container_metadata.get("digest", "")
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


def is_retained_tag(tag: str) -> bool:
    return tag in {"stable", "beta", "test"} or bool(
        SEMVER_RE.match(tag)
        or MINOR_RE.match(tag)
        or PRERELEASE_SERIES_RE.match(tag)
        or SHA_TAG_RE.match(tag)
    )


def crane_manifest(image_ref: str) -> dict[str, object] | None:
    result = subprocess.run(
        ["crane", "manifest", image_ref],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(
            json.dumps(
                {
                    "image_ref": image_ref,
                    "classification": "manifest-unavailable",
                    "stderr": result.stderr.strip(),
                }
            ),
            file=sys.stderr,
        )
        return None
    return json.loads(result.stdout)


def referenced_child_digests(
    image_name: str, versions: list[PackageVersion]
) -> set[str]:
    protected_digests: set[str] = set()
    for version in versions:
        if not any(is_retained_tag(tag) for tag in version.tags):
            continue
        if not version.digest.startswith("sha256:"):
            continue
        manifest = crane_manifest(f"{image_name}@{version.digest}")
        if not manifest:
            continue
        if manifest.get("mediaType") not in RUNNABLE_INDEX_MEDIA_TYPES:
            continue
        for descriptor in manifest.get("manifests", []):
            if not isinstance(descriptor, dict):
                continue
            platform = descriptor.get("platform", {})
            if not isinstance(platform, dict):
                continue
            if (
                platform.get("os") == "unknown"
                or platform.get("architecture") == "unknown"
            ):
                continue
            digest = descriptor.get("digest")
            if isinstance(digest, str) and digest.startswith("sha256:"):
                protected_digests.add(digest)
    return protected_digests


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
    parser.add_argument("--package-name", required=True)
    parser.add_argument("--image-name", required=True)
    parser.add_argument("--keep-count", type=int, default=10)
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN is required")

    owner_type = get_owner_type(args.owner, token)
    versions = load_versions(args.owner, owner_type, args.package_name, token)
    protected_children = referenced_child_digests(args.image_name, versions)

    deletable: list[PackageVersion] = []
    for version in versions:
        if version.tags:
            emit_log(version, "tagged", "protect")
        elif version.digest in protected_children:
            emit_log(version, "referenced-child", "protect")
        else:
            deletable.append(version)
            emit_log(version, "untagged", "retain-candidate")

    deletable.sort(key=lambda version: version.created_at, reverse=True)
    for version in deletable[: args.keep_count]:
        emit_log(version, "untagged", "retain")

    for version in deletable[args.keep_count :]:
        emit_log(version, "untagged", "delete")
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
