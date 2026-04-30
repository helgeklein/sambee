#!/usr/bin/env python3
"""Generate Hugo routing anchors for docs inheritance marker files."""

from __future__ import annotations

import shutil
from pathlib import Path

WEBSITE_DIR = Path(__file__).resolve().parent.parent
DOCS_CONTENT_DIR = WEBSITE_DIR / "content" / "docs"
GENERATED_CONTENT_DIR = WEBSITE_DIR / ".generated" / "content" / "docs"

BRANCH_MARKER = "_inherit.md"
BRANCH_ANCHOR = "_index.md"
PAGE_MARKER = "inherit.md"
PAGE_ANCHOR = "index.md"

ANCHOR_CONTENT = """+++
title = "Inherited Documentation"
inherit = true
+++
"""


def reset_generated_docs() -> None:
    """Remove stale generated docs anchors before rebuilding them."""
    if GENERATED_CONTENT_DIR.exists():
        shutil.rmtree(GENERATED_CONTENT_DIR)
    GENERATED_CONTENT_DIR.mkdir(parents=True, exist_ok=True)


def write_anchor(source_marker: Path, anchor_name: str) -> None:
    """Write a generated Hugo page anchor for one inheritance marker."""
    relative_parent = source_marker.parent.relative_to(DOCS_CONTENT_DIR)
    anchor_path = GENERATED_CONTENT_DIR / relative_parent / anchor_name
    anchor_path.parent.mkdir(parents=True, exist_ok=True)
    anchor_path.write_text(ANCHOR_CONTENT, encoding="utf-8")


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


def main() -> int:
    """Generate inherited docs anchors for the Hugo build."""
    if not DOCS_CONTENT_DIR.exists():
        print(f"Docs content directory not found at {DOCS_CONTENT_DIR}; no anchors generated.")
        return 0

    generated_count = materialize_markers()
    print(f"Generated {generated_count} inherited docs route anchor(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())