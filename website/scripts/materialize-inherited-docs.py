#!/usr/bin/env python3
"""Generate Hugo routing anchors for inherited and stable current docs routes."""

from __future__ import annotations

import shutil
from pathlib import Path

import tomllib

WEBSITE_DIR = Path(__file__).resolve().parent.parent
DOCS_CONTENT_DIR = WEBSITE_DIR / "content" / "docs"
GENERATED_CONTENT_DIR = WEBSITE_DIR / ".generated" / "content" / "docs"
DOCS_VERSIONS_FILE = WEBSITE_DIR / "data" / "docs-versions.toml"

BRANCH_MARKER = "_inherit.md"
BRANCH_ANCHOR = "_index.md"
PAGE_MARKER = "inherit.md"
PAGE_ANCHOR = "index.md"
BRANCH_SOURCE = "_index.md"
PAGE_SOURCE = "index.md"

ANCHOR_CONTENT = """+++
title = "Inherited Documentation"
inherit = true
+++
"""

CURRENT_ROUTE_ANCHOR_TEMPLATE = """+++
title = "Current Documentation"
current_route = true
source_docs_path = "{source_docs_path}"
+++
"""


def reset_generated_docs() -> None:
    """Remove stale generated docs anchors before rebuilding them."""
    if GENERATED_CONTENT_DIR.exists():
        shutil.rmtree(GENERATED_CONTENT_DIR)
    GENERATED_CONTENT_DIR.mkdir(parents=True, exist_ok=True)


def load_current_version() -> str:
    """Return the current docs version slug declared in docs metadata."""
    with DOCS_VERSIONS_FILE.open("rb") as file:
        data = tomllib.load(file)

    current_version = data.get("current", "")
    return current_version if isinstance(current_version, str) else ""


def write_anchor(source_marker: Path, anchor_name: str) -> None:
    """Write a generated Hugo page anchor for one inheritance marker."""
    relative_parent = source_marker.parent.relative_to(DOCS_CONTENT_DIR)
    anchor_path = GENERATED_CONTENT_DIR / relative_parent / anchor_name
    anchor_path.parent.mkdir(parents=True, exist_ok=True)
    anchor_path.write_text(ANCHOR_CONTENT, encoding="utf-8")


def write_current_route_anchor(
    source_directory: Path, anchor_name: str, current_version: str
) -> None:
    """Write a generated stable current-docs route anchor for one current-version page."""
    version_root = DOCS_CONTENT_DIR / current_version
    relative_parent = source_directory.relative_to(version_root)
    if not relative_parent.parts:
        return

    anchor_path = GENERATED_CONTENT_DIR / relative_parent / anchor_name
    anchor_path.parent.mkdir(parents=True, exist_ok=True)
    source_docs_path = "/docs/" + "/".join((current_version, *relative_parent.parts))
    anchor_path.write_text(
        CURRENT_ROUTE_ANCHOR_TEMPLATE.format(source_docs_path=source_docs_path),
        encoding="utf-8",
    )


def materialize_markers() -> int:
    """Generate routing anchors and return the number written."""
    reset_generated_docs()
    generated_count = 0

    for marker in sorted(DOCS_CONTENT_DIR.rglob(BRANCH_MARKER)):
        write_anchor(marker, BRANCH_ANCHOR)
        generated_count += 1

    for marker in sorted(DOCS_CONTENT_DIR.rglob(PAGE_MARKER)):
        write_anchor(marker, PAGE_ANCHOR)
        generated_count += 1

    return generated_count


def materialize_current_routes(current_version: str) -> int:
    """Generate stable current-docs routes for the declared current version."""
    if not current_version:
        return 0

    current_version_dir = DOCS_CONTENT_DIR / current_version
    if not current_version_dir.exists():
        return 0

    generated_count = 0

    for directory in sorted(
        path for path in current_version_dir.rglob("*") if path.is_dir()
    ):
        if (directory / BRANCH_SOURCE).exists() or (directory / BRANCH_MARKER).exists():
            write_current_route_anchor(directory, BRANCH_ANCHOR, current_version)
            generated_count += 1
            continue

        if (directory / PAGE_SOURCE).exists() or (directory / PAGE_MARKER).exists():
            write_current_route_anchor(directory, PAGE_ANCHOR, current_version)
            generated_count += 1

    return generated_count


def main() -> int:
    """Generate inherited docs anchors for the Hugo build."""
    if not DOCS_CONTENT_DIR.exists():
        print(
            f"Docs content directory not found at {DOCS_CONTENT_DIR}; no anchors generated."
        )
        return 0

    current_version = load_current_version()
    inherited_count = materialize_markers()
    current_route_count = materialize_current_routes(current_version)
    print(
        "Generated "
        f"{inherited_count} inherited docs route anchor(s) and "
        f"{current_route_count} stable current-docs route anchor(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
