#!/usr/bin/env python3
"""Verify that all development and CI environments use one Node.js major."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

_DEVCONTAINER_NODE_MAJOR_PATTERN = re.compile(
    r"^ARG NODE_MAJOR=(?P<major>\d+)$", re.MULTILINE
)
_FRONTEND_BUILDER_PATTERN = re.compile(
    r"^FROM\s+--platform=\$BUILDPLATFORM\s+"
    r"node:(?P<major>\d+)\.\d+\.\d+-alpine@sha256:[0-9a-f]{64}\s+"
    r"AS\s+frontend-builder\s*$",
    re.MULTILINE,
)
_WORKFLOW_NODE_VERSION_PATTERN = re.compile(
    r"^\s*node-version:\s*['\"]?(?P<major>\d+)(?:\.\d+\.\d+)?['\"]?\s*$",
    re.MULTILINE,
)


def _single_match(pattern: re.Pattern[str], content: str, description: str) -> str:
    matches = pattern.findall(content)
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {description}, found {len(matches)}.")
    return matches[0]


def _workflow_node_majors(workflows_directory: Path) -> dict[Path, list[str]]:
    workflow_majors: dict[Path, list[str]] = {}
    for workflow_path in sorted(workflows_directory.glob("*.y*ml")):
        majors = _WORKFLOW_NODE_VERSION_PATTERN.findall(
            workflow_path.read_text(encoding="utf-8")
        )
        if majors:
            workflow_majors[workflow_path] = majors
    if not workflow_majors:
        raise ValueError("No Node.js workflow versions were found.")
    return workflow_majors


def verify_node_runtime(dockerfile: Path, workflows_directory: Path) -> None:
    dockerfile_content = dockerfile.read_text(encoding="utf-8")
    expected_major = _single_match(
        _DEVCONTAINER_NODE_MAJOR_PATTERN,
        dockerfile_content,
        "devcontainer NODE_MAJOR declaration",
    )
    builder_major = _single_match(
        _FRONTEND_BUILDER_PATTERN,
        dockerfile_content,
        "digest-pinned frontend-builder Node image",
    )
    if builder_major != expected_major:
        raise ValueError(
            "Dockerfile Node major mismatch: "
            f"NODE_MAJOR={expected_major}, frontend-builder={builder_major}."
        )

    mismatches: list[str] = []
    for workflow_path, majors in _workflow_node_majors(workflows_directory).items():
        for major in majors:
            if major != expected_major:
                mismatches.append(f"{workflow_path}: node-version {major}")
    if mismatches:
        details = "\n  ".join(mismatches)
        raise ValueError(
            f"Node major {expected_major} is required by Dockerfile; mismatches:\n  {details}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify the coordinated Node.js runtime major."
    )
    parser.add_argument("dockerfile", nargs="?", type=Path, default=Path("Dockerfile"))
    parser.add_argument(
        "workflows_directory",
        nargs="?",
        type=Path,
        default=Path(".github/workflows"),
    )
    args = parser.parse_args()
    try:
        verify_node_runtime(args.dockerfile, args.workflows_directory)
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
