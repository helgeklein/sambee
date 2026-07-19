"""Standalone HTML docs structure report generator."""

from __future__ import annotations

import argparse
import difflib
import html
import json
from pathlib import Path
from typing import Any

from .core import (
    BRANCH_INHERIT,
    DEFAULT_WEBSITE_DIR,
    DOCS_ROOT_INDEX,
    PAGE_INDEX,
    PAGE_INHERIT,
    BranchNodeState,
    DocsEditor,
    PageNodeState,
)

DEFAULT_REPORT_FILENAME = "docs-structure-report.html"
DEFAULT_REPORT_RELATIVE_PATH = (
    Path("website-meta") / "docs-reports" / DEFAULT_REPORT_FILENAME
)


def default_report_output(website_dir: Path) -> Path:
    """Return the default committed report path for one website root."""
    return (
        website_dir.resolve().parent
        / "website-meta"
        / "docs-reports"
        / DEFAULT_REPORT_FILENAME
    )


def merge_ordered(existing: list[str], values: list[str]) -> list[str]:
    """Append unseen values while preserving first-seen order."""
    for value in values:
        if value not in existing:
            existing.append(value)
    return existing


def count_line_changes(previous_text: str, current_text: str) -> tuple[int, int]:
    """Return added and removed line counts between two markdown texts."""
    previous_lines = previous_text.splitlines()
    current_lines = current_text.splitlines()
    matcher = difflib.SequenceMatcher(a=previous_lines, b=current_lines)
    added = 0
    removed = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "insert":
            added += j2 - j1
        elif tag == "delete":
            removed += i2 - i1
        elif tag == "replace":
            removed += i2 - i1
            added += j2 - j1
    return added, removed


def version_index(version_order: list[str], slug: str) -> int:
    """Return the index of one version slug."""
    return version_order.index(slug)


def resolve_page_source_version(
    editor: DocsEditor,
    version: str,
    relative_parts: tuple[str, ...],
    *,
    include_current: bool,
) -> str | None:
    """Return the version that provides real page content for one page path."""
    version_order = editor.version_slugs()
    start_index = version_index(version_order, version)
    limit = start_index + 1 if include_current else start_index

    for candidate_version in reversed(version_order[:limit]):
        candidate_dir = editor.version_root(candidate_version) / Path(*relative_parts)
        if (candidate_dir / PAGE_INDEX).exists():
            return candidate_version
        if (candidate_dir / PAGE_INHERIT).exists():
            continue
        return None

    return None


def resolve_branch_source_version(
    editor: DocsEditor,
    version: str,
    relative_parts: tuple[str, ...],
    *,
    include_current: bool,
) -> str | None:
    """Return the version that provides real branch content for one path."""
    version_order = editor.version_slugs()
    start_index = version_index(version_order, version)
    limit = start_index + 1 if include_current else start_index

    for candidate_version in reversed(version_order[:limit]):
        candidate_dir = editor.version_root(candidate_version) / Path(*relative_parts)
        if (candidate_dir / DOCS_ROOT_INDEX).exists():
            return candidate_version
        if (candidate_dir / BRANCH_INHERIT).exists():
            continue
        return None

    return None


def display_branch_state(raw_state: BranchNodeState, *, is_section: bool) -> str:
    """Return one user-facing branch node state label."""
    if raw_state is BranchNodeState.AUTHORED:
        return "authored"
    if raw_state is BranchNodeState.INHERITED:
        return "inherited"
    if raw_state is BranchNodeState.STRUCTURAL:
        return "structural-only"
    return "invalid"


def build_book_order(
    editor: DocsEditor,
) -> tuple[
    list[str],
    dict[str, list[str]],
    dict[tuple[str, str], list[str]],
    dict[tuple[str, str], str],
]:
    """Return union ordering for books, sections, pages, and section titles."""
    books: list[str] = []
    sections: dict[str, list[str]] = {}
    pages: dict[tuple[str, str], list[str]] = {}
    section_titles: dict[tuple[str, str], str] = {}

    current_version = editor.load_versions_document().current

    for version in editor.version_slugs():
        nav = editor.load_nav_document(version)
        merge_ordered(books, nav.get("books", []))

        for book in nav.get("books", []):
            section_entries = nav.get("sections", {}).get(book, [])
            section_order = sections.setdefault(book, [])
            merge_ordered(section_order, [entry["slug"] for entry in section_entries])
            for entry in section_entries:
                key = (book, entry["slug"])
                if key not in section_titles or version == current_version:
                    section_titles[key] = entry["title"]

            for section_slug, page_items in nav.get("pages", {}).get(book, {}).items():
                merge_ordered(section_order, [section_slug])
                page_order = pages.setdefault((book, section_slug), [])
                merge_ordered(page_order, page_items)

    return books, sections, pages, section_titles


def build_page_version_cell(
    editor: DocsEditor,
    version: str,
    book: str,
    section: str,
    page: str,
) -> tuple[dict[str, Any], str | None]:
    """Build per-version report data for one page row."""
    page_dir = editor.page_root(version, book, section, page)
    if not page_dir.exists():
        return {"state": "missing"}, None

    raw_state = editor.classify_page_node_state(page_dir)
    if raw_state is PageNodeState.INVALID:
        return {"state": "invalid"}, None

    resolved_content: str | None = None
    resolved_source_version: str | None = None
    predecessor_version: str | None = None
    diff_added: int | None = None
    diff_removed: int | None = None

    if raw_state is PageNodeState.INHERITED:
        resolved_source_version = resolve_page_source_version(
            editor,
            version,
            (book, section, page),
            include_current=True,
        )
        resolved_content = editor.resolve_page_source_file(
            version, (book, section, page)
        ).read_text(encoding="utf-8")
        return (
            {
                "state": "inherited",
                "source_version": resolved_source_version,
            },
            resolved_content,
        )

    resolved_content = (page_dir / PAGE_INDEX).read_text(encoding="utf-8")
    predecessor_version = resolve_page_source_version(
        editor,
        version,
        (book, section, page),
        include_current=False,
    )
    if predecessor_version is not None:
        previous_text = editor.resolve_page_source_file(
            predecessor_version, (book, section, page)
        ).read_text(encoding="utf-8")
        diff_added, diff_removed = count_line_changes(previous_text, resolved_content)
        return (
            {
                "state": "branched",
                "source_version": predecessor_version,
                "diff_added": diff_added,
                "diff_removed": diff_removed,
            },
            resolved_content,
        )

    return ({"state": "authored"}, resolved_content)


def build_branch_version_cell(
    editor: DocsEditor,
    version: str,
    relative_parts: tuple[str, ...],
    *,
    is_section: bool,
) -> tuple[dict[str, Any], str | None]:
    """Build per-version report data for one book or section row."""
    node_dir = editor.version_root(version) / Path(*relative_parts)
    if not node_dir.exists():
        return {"state": "missing"}, None

    raw_state = editor.classify_branch_node_state(node_dir)
    if raw_state is BranchNodeState.INVALID:
        return {"state": "invalid"}, None

    if raw_state is BranchNodeState.INHERITED:
        source_version = resolve_branch_source_version(
            editor,
            version,
            relative_parts,
            include_current=True,
        )
        resolved_content = editor.resolve_branch_source_file(
            version, relative_parts
        ).read_text(encoding="utf-8")
        cell: dict[str, Any] = {"state": "inherited"}
        if source_version is not None:
            cell["source_version"] = source_version
        return cell, resolved_content

    if raw_state is BranchNodeState.AUTHORED:
        resolved_content = (node_dir / DOCS_ROOT_INDEX).read_text(encoding="utf-8")
        predecessor_version = resolve_branch_source_version(
            editor,
            version,
            relative_parts,
            include_current=False,
        )
        if predecessor_version is not None:
            previous_text = editor.resolve_branch_source_file(
                predecessor_version, relative_parts
            ).read_text(encoding="utf-8")
            diff_added, diff_removed = count_line_changes(
                previous_text, resolved_content
            )
            return (
                {
                    "state": "branched",
                    "source_version": predecessor_version,
                    "diff_added": diff_added,
                    "diff_removed": diff_removed,
                },
                resolved_content,
            )
        return {"state": "authored"}, resolved_content

    state = display_branch_state(raw_state, is_section=is_section)
    return {"state": state}, None


def summarize_row_states(version_cells: dict[str, dict[str, Any]]) -> dict[str, bool]:
    """Return filterable flags for one row from its per-version state data."""
    states = {cell.get("state") for cell in version_cells.values()}
    return {
        "has_branched": "branched" in states,
        "has_inherited": "inherited" in states,
        "has_structural": "structural-only" in states,
        "has_invalid": "invalid" in states,
    }


def build_report_data(website_dir: Path = DEFAULT_WEBSITE_DIR) -> dict[str, Any]:
    """Build the docs structure report data model."""
    editor = DocsEditor(website_dir)
    versions_document = editor.load_versions_document()
    versions = [
        {
            "slug": entry.slug,
            "label": entry.label,
            "status": entry.status,
            "visible": entry.visible,
            "searchable": entry.searchable,
            "is_current": entry.slug == versions_document.current,
        }
        for entry in versions_document.versions
    ]
    version_slugs = [version["slug"] for version in versions]

    books, sections, pages, section_titles = build_book_order(editor)
    rows: list[dict[str, Any]] = []

    for book in books:
        book_id = f"book:{book}"
        book_cells: dict[str, dict[str, Any]] = {}
        book_contents: dict[str, str] = {}
        for version in version_slugs:
            cell, resolved_content = build_branch_version_cell(
                editor, version, (book,), is_section=False
            )
            book_cells[version] = cell
            if resolved_content is not None:
                book_contents[version] = resolved_content
        rows.append(
            {
                "id": book_id,
                "parent_id": None,
                "depth": 0,
                "kind": "book",
                "label": book,
                "title": editor.humanize_slug(book),
                "path": book,
                "has_children": True,
                "version_cells": book_cells,
                "content_versions": book_contents,
                "flags": summarize_row_states(book_cells),
            }
        )

        for section in sections.get(book, []):
            section_id = f"section:{book}/{section}"
            section_cells: dict[str, dict[str, Any]] = {}
            section_contents: dict[str, str] = {}
            for version in version_slugs:
                cell, resolved_content = build_branch_version_cell(
                    editor,
                    version,
                    (book, section),
                    is_section=True,
                )
                section_cells[version] = cell
                if resolved_content is not None:
                    section_contents[version] = resolved_content
            page_slugs = pages.get((book, section), [])
            rows.append(
                {
                    "id": section_id,
                    "parent_id": book_id,
                    "depth": 1,
                    "kind": "section",
                    "label": section,
                    "title": section_titles.get(
                        (book, section), editor.humanize_slug(section)
                    ),
                    "path": f"{book}/{section}",
                    "has_children": bool(page_slugs),
                    "version_cells": section_cells,
                    "content_versions": section_contents,
                    "flags": summarize_row_states(section_cells),
                }
            )

            for page in page_slugs:
                page_id = f"page:{book}/{section}/{page}"
                page_cells: dict[str, dict[str, Any]] = {}
                page_contents: dict[str, str] = {}
                for version in version_slugs:
                    cell, resolved_content = build_page_version_cell(
                        editor, version, book, section, page
                    )
                    page_cells[version] = cell
                    if resolved_content is not None:
                        page_contents[version] = resolved_content

                rows.append(
                    {
                        "id": page_id,
                        "parent_id": section_id,
                        "depth": 2,
                        "kind": "page",
                        "label": page,
                        "title": editor.humanize_slug(page),
                        "path": f"{book}/{section}/{page}",
                        "has_children": False,
                        "version_cells": page_cells,
                        "content_versions": page_contents,
                        "page_contents": page_contents,
                        "flags": summarize_row_states(page_cells),
                    }
                )

    issues = [issue.format() for issue in editor.validate()]
    return {
        "meta": {
            "title": "Docs Structure Report",
            "current_version": versions_document.current,
            "report_output": str(DEFAULT_REPORT_RELATIVE_PATH),
        },
        "versions": versions,
        "warnings": issues,
        "rows": rows,
    }


def render_report_html(data: dict[str, Any]) -> str:
    """Render the standalone HTML report."""
    payload = (
        json.dumps(data, ensure_ascii=True)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )
    title = html.escape(data["meta"]["title"])
    brand_mark = """<svg class="brand-mark" viewBox="0 0 320 320" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="2.5" y="30.784271" width="315" height="67" rx="20" fill="#1F262B" stroke="#1F262B" stroke-width="5"/><circle cx="42.5" cy="64.284271" r="10" fill="#F4C430"/><rect x="74.5" y="54.284271" width="200" height="20" rx="10" fill="#F4C430"/><rect x="2.5" y="124.28427" width="315" height="72" rx="20" fill="#F4C430" stroke="#1F262B" stroke-width="5"/><circle cx="40" cy="160.28427" r="10" fill="#1F262B"/><rect x="72" y="150.28427" width="200" height="20" rx="10" fill="#1F262B"/><rect x="2.5" y="222.78427" width="315" height="67" rx="20" fill="#1F262B" stroke="#1F262B" stroke-width="5"/><circle cx="42.5" cy="256.28427" r="10" fill="#F4C430"/><rect x="74.5" y="246.28427" width="200" height="20" rx="10" fill="#F4C430"/></svg>"""
    return f"""<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
  <title>{title}</title>
  <style>
    :root {{
      --bg: #fbf9f4;
      --surface: #fbf9f4;
      --surface-2: #f5f3ee;
      --surface-3: #f0eee9;
      --line: #d4c4ae;
      --line-strong: #827562;
      --text: #1b1c19;
      --muted: #504535;
      --accent: #7c5800;
      --accent-fill: #ebb035;
      --accent-fill-text: #624500;
      --danger: #b91c1c;
      --ok: #166534;
      --shadow: 0 20px 44px rgba(52, 38, 18, 0.08);
      --radius: 0;
      --radius-sm: 0;
      --font-sans: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      --font-display: Georgia, "Times New Roman", serif;
      --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: var(--font-sans);
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(235,176,53,0.14), transparent 30%),
        linear-gradient(180deg, #fdfbf7 0%, var(--bg) 100%);
    }}
    .shell {{ max-width: 1800px; margin: 0 auto; padding: 28px; }}
    .hero {{ display: grid; gap: 18px; margin-bottom: 20px; }}
    .brand-banner {{ display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border: 1px solid var(--line); border-radius: 0; background: rgba(251,249,244,0.92); box-shadow: var(--shadow); }}
    .brand-lockup {{ display: flex; align-items: center; gap: 14px; min-width: 0; }}
    .brand-mark {{ width: 42px; height: 42px; flex: none; }}
    .brand-copy {{ min-width: 0; }}
    .brand-wordmark {{ margin: 0; font: 700 clamp(1.85rem, 3vw, 2.8rem)/0.92 var(--font-sans); letter-spacing: -0.04em; color: var(--text); }}
    .hero-copy {{ display: grid; gap: 10px; padding: 10px 4px 0; }}
    h1 {{ margin: 0; font: 700 clamp(2.25rem, 4vw, 3.8rem)/0.96 var(--font-display); letter-spacing: -0.02em; }}
    .lede {{ max-width: 90ch; color: var(--muted); font-size: 1rem; line-height: 1.6; }}
    .card {{ background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; }}
    .toolbar {{ display: grid; gap: 14px; margin: 22px 0; }}
    .toolbar-grid {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }}
    .toolbar h2 {{ margin: 0 0 8px; font-size: 0.92rem; letter-spacing: 0.01em; }}
    .toolbar-section {{ display: grid; gap: 8px; }}
    .toolbar-section + .toolbar-section {{ margin-top: 8px; }}
    .toolbar-label {{ font: 600 0.72rem/1 var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }}
    .toolbar-copy {{ color: var(--muted); font-size: 0.84rem; line-height: 1.38; margin-bottom: 8px; }}
    .search-input {{ width: 100%; padding: 11px 14px; border: 1px solid var(--line); border-radius: 0; background: #fff; font: 400 0.84rem/1.2 var(--font-sans); }}
    .pill-row {{ display: flex; flex-wrap: wrap; gap: 8px; }}
    .filter-pill, .version-focus-pill, .action-button {{
      border: 1px solid var(--line);
      background: var(--surface-2);
      color: var(--text);
      border-radius: 0;
      padding: 8px 12px;
      font: 500 0.82rem/1 var(--font-sans);
      cursor: pointer;
    }}
    .filter-pill:hover, .version-focus-pill:hover, .action-button:hover, .diff-modal__close:hover, .diff-modal-pill:hover {{ border-color: rgba(124,88,0,0.32); color: var(--accent); }}
    .filter-pill.active, .version-focus-pill.active {{ background: rgba(235,176,53,0.18); border-color: rgba(124,88,0,0.3); color: var(--accent); }}
    .action-button {{ background: #fff; }}
    .controls-card {{ display: grid; gap: 10px; }}
    .controls-card .toolbar-copy {{ margin-bottom: 2px; font-size: 0.82rem; line-height: 1.35; }}
    .controls-grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; align-items: start; }}
    .controls-group {{ display: grid; gap: 7px; }}
    .controls-card .pill-row {{ gap: 6px; }}
    .controls-card .filter-pill,
    .controls-card .action-button {{ padding: 7px 10px; font-size: 0.78rem; }}
    .layout {{ display: block; }}
    .main-table, .warnings {{ background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }}
    .main-table {{ overflow: visible; }}
    .table-wrap {{ overflow-x: auto; overflow-y: visible; max-height: none; }}
    table {{ width: 100%; border-collapse: collapse; }}
    thead th {{ position: sticky; top: 0; background: rgba(245, 243, 238, 0.96); backdrop-filter: blur(10px); z-index: 2; text-align: left; padding: 10px 10px; border-bottom: 1px solid var(--line); font-size: 0.79rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }}
    tbody td {{ padding: 6px 10px; border-bottom: 1px solid rgba(215,205,191,0.7); vertical-align: top; }}
    tbody tr:hover {{ background: rgba(235,176,53,0.08); }}
    tbody tr.selected {{ background: rgba(235,176,53,0.14); }}
    .name-col {{ position: sticky; left: 0; background: inherit; min-width: 280px; max-width: 420px; z-index: 1; }}
    .row-title {{ display: flex; align-items: center; gap: 8px; min-width: 0; }}
    .indent-0 {{ padding-left: 0; }}
    .indent-1 {{ padding-left: 18px; }}
    .indent-2 {{ padding-left: 36px; }}
    .toggle {{ width: 24px; height: 24px; border-radius: 0; border: 1px solid var(--line); background: #fff; cursor: pointer; font: inherit; padding: 0; box-shadow: inset 0 1px 0 rgba(255,255,255,0.8); }}
    .row-label-block {{ min-width: 0; }}
    .row-label {{ font-weight: 500; overflow-wrap: anywhere; }}
    .row-subtitle {{ color: var(--muted); font-size: 0.78rem; line-height: 1.2; margin-top: 1px; }}
    .kind-badge {{ display: inline-flex; align-items: center; gap: 5px; border-radius: 0; padding: 4px 8px; background: var(--surface-2); color: var(--muted); font: 600 0.72rem/1 var(--font-mono); text-transform: uppercase; }}
    .version-strip {{ display: flex; flex-wrap: wrap; gap: 6px; align-items: stretch; min-width: 240px; }}
    .version-chip {{ display: inline-flex; flex-direction: column; gap: 3px; min-width: 64px; padding: 6px 8px; border-radius: 0; border: 1px solid transparent; background: var(--surface-2); }}
    .version-chip.collapsed {{ min-width: 16px; width: 16px; padding: 0; border-radius: 0; overflow: hidden; justify-content: center; }}
    .version-chip.collapsed .version-chip__slug,
    .version-chip.collapsed .version-chip__state,
    .version-chip.collapsed .version-chip__diff {{ display: none; }}
    .version-chip.version-chip--placeholder {{ visibility: hidden; background: transparent; border-color: transparent; pointer-events: none; }}
    .version-chip__slug {{ font: 700 0.78rem/1 var(--font-mono); }}
    .version-chip__state {{ font-size: 0.66rem; font-weight: 600; line-height: 1.05; }}
    .version-chip__diff {{ font: 600 0.68rem/1 var(--font-mono); display: flex; gap: 6px; }}
    .state-authored {{ background: #ebf6ff; color: #0f4c81; border-color: rgba(15,76,129,0.15); }}
    .state-branched {{ background: var(--accent-fill); color: var(--accent-fill-text); border-color: rgba(98,69,0,0.3); }}
    .state-inherited {{ background: #f3ebdd; color: #7f5b14; border-color: rgba(127,91,20,0.16); }}
    .state-structural-only {{ background: #f3f4f6; color: #4b5563; border-color: rgba(75,85,99,0.12); }}
    .state-structural {{ background: #f3f4f6; color: #4b5563; border-color: rgba(75,85,99,0.12); }}
    .state-missing {{ background: #fff7ed; color: #c2410c; border-color: rgba(194,65,12,0.18); }}
    .state-invalid {{ background: #fef2f2; color: var(--danger); border-color: rgba(185,28,28,0.18); }}
    .plus {{ color: var(--ok); }}
    .minus {{ color: var(--danger); }}
    .hidden-row {{ display: none; }}
    .muted {{ color: var(--muted); }}
    .detail-meta {{ display: grid; gap: 10px; }}
    .selector-row {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }}
    select {{ width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 0; font: inherit; background: #fffdf9; color: var(--text); }}
    .diff-modal__toolbar {{ display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }}
    .diff-modal__toolbar-label {{ font: 600 0.72rem/1 var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }}
    .diff-modal-pill {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 0 14px;
      border: 1px solid #cdbfaa;
      border-radius: 0;
      background: #fffdf9;
      color: #52483d;
      font: 600 0.84rem/1 var(--font-sans);
      cursor: pointer;
      box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset;
      transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
      justify-self: start;
    }}
    .diff-modal-pill.active {{ background: rgba(235,176,53,0.18); border-color: rgba(124,88,0,0.3); color: var(--accent); box-shadow: inset 0 0 0 1px rgba(124,88,0,0.06); }}
    .diff-summary {{ display: flex; gap: 12px; align-items: center; font: 700 0.95rem/1 var(--font-mono); }}
    .diff-meta {{ display: grid; gap: 12px; padding: 18px 20px; border-bottom: 1px solid #d9cdbd; background: #f6f1e8; }}
    .diff-meta__versions {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }}
    .diff-meta__version {{ padding: 12px 14px; border: 1px solid #d9cdbd; border-radius: 0; background: #fffdf9; }}
    .diff-meta__label {{ font: 700 0.76rem/1 var(--font-mono); color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }}
    .diff-meta__state {{ margin-top: 8px; font-size: 0.92rem; }}
    .diff-meta__source {{ margin-top: 4px; color: var(--muted); font-size: 0.82rem; }}
    .diff-panel {{
      position: relative;
      min-height: 0;
      overflow: auto;
      border: 1px solid #d7cdbf;
      border-radius: 0;
      background: linear-gradient(90deg, #f6efe5 0 88px, #e6dac8 88px 89px, #fffdf9 89px 100%);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.7);
      padding: 14px 0 20px;
    }}
    .diff-line {{ position: relative; display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 0; align-items: start; font: 0.84rem/1.6 var(--font-mono); white-space: pre-wrap; word-break: break-word; color: #201c18; background: transparent; }}
    .diff-line + .diff-line {{ box-shadow: none; }}
    .diff-line.add,
    .diff-line.remove,
    .diff-line.same {{ background: transparent; }}
    .diff-line.empty {{ grid-template-columns: 1fr; color: #7a7066; font-style: italic; }}
    .diff-line__gutter {{ padding: 0 12px 0 0; border-right: 0; color: #7a7066; background: transparent; text-align: right; user-select: none; }}
    .diff-line__code {{ position: relative; padding: 0 20px 0 18px; background: transparent; }}
    .diff-line.add .diff-line__code {{ background: rgba(238, 250, 241, 0.78); }}
    .diff-line.remove .diff-line__code {{ background: rgba(253, 240, 240, 0.82); }}
    .diff-line.add .diff-line__code::before,
    .diff-line.remove .diff-line__code::before {{ content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: 0; }}
    .diff-line.add .diff-line__code::before {{ background: #5ea975; }}
    .diff-line.remove .diff-line__code::before {{ background: #cf6f7a; }}
    .inline-add {{ background: #bfe7ca; color: #12351f; border-radius: 0; box-shadow: inset 0 -1px 0 rgba(18,53,31,0.08); }}
    .inline-remove {{ background: #f4c9cf; color: #5a171d; border-radius: 0; box-shadow: inset 0 -1px 0 rgba(90,23,29,0.08); }}
    .warnings {{ margin-top: 18px; padding: 18px; background: linear-gradient(180deg, rgba(235,176,53,0.14), rgba(245,243,238,0.9)); }}
    .warnings ol {{ margin: 10px 0 0; padding-left: 18px; }}
    .warnings li {{ margin: 6px 0; font: 0.88rem/1.4 var(--font-mono); }}
    .hero .warnings {{ margin-top: 0; }}
    .diff-modal[hidden] {{ display: none; }}
    .diff-modal {{ position: fixed; inset: 0; z-index: 30; background: rgba(20, 16, 12, 0.76); display: grid; place-items: center; padding: 10px; backdrop-filter: blur(6px); }}
    .diff-modal__panel {{ width: min(1520px, calc(100vw - 20px)); height: calc(100vh - 20px); background: #f7f3ec; border: 1px solid #cdbfaa; border-radius: 0; box-shadow: 0 28px 70px rgba(20, 14, 10, 0.28); overflow: hidden; display: grid; grid-template-rows: auto auto minmax(0, 1fr); min-height: 0; }}
    .diff-modal__header {{ display: flex; justify-content: space-between; gap: 16px; align-items: start; padding: 18px 20px 14px; border-bottom: 1px solid #d9cdbd; background: #f7f3ec; }}
    .diff-modal__title {{ margin: 0; font-size: 1.35rem; line-height: 1.1; }}
    .diff-modal__subtitle {{ margin-top: 4px; color: var(--muted); font-size: 0.92rem; }}
    .diff-modal__close {{ border: 1px solid #cdbfaa; background: #fffdf9; border-radius: 0; padding: 8px 12px; font: inherit; cursor: pointer; }}
    .diff-modal__controls {{ padding: 14px 20px; border-bottom: 1px solid #d9cdbd; display: grid; gap: 12px; background: #f4efe7; align-items: start; }}
    .diff-modal__body {{ min-height: 0; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr); background: #f7f3ec; }}
    @media (max-width: 1200px) {{ .toolbar-grid {{ grid-template-columns: 1fr; }} .controls-grid {{ grid-template-columns: 1fr; }} .brand-banner {{ border-radius: 0; align-items: flex-start; }} .diff-modal {{ padding: 8px; }} .diff-modal__panel {{ width: calc(100vw - 16px); height: calc(100vh - 16px); }} }}
    @media (max-width: 840px) {{ .brand-banner {{ flex-direction: column; }} }}
    @media (max-width: 720px) {{ .selector-row, .diff-meta__versions {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <div class=\"shell\">
    <section class=\"hero\">
      <div class=\"brand-banner\">
        <div class=\"brand-lockup\">
          {brand_mark}
          <div class=\"brand-copy\">
            <p class=\"brand-wordmark\">Sambee Docs Report</p>
          </div>
        </div>
      </div>
      <section class=\"warnings\" id=\"warnings-panel\" hidden></section>
    </section>

    <section class=\"toolbar\">
      <div class=\"toolbar-grid\">
        <div class="card controls-card">
          <h2>Filter and Focus</h2>
          <div class="toolbar-copy">Search the docs tree, then choose which versions stay expanded into full chips.</div>
          <input id=\"search-input\" class=\"search-input\" type=\"search\" placeholder=\"Filter by slug, title, path, or state\">
          <div class="controls-group">
            <div class="toolbar-label">Expanded version chips</div>
            <div class="pill-row" id="version-focus"></div>
          </div>
        </div>
        <div class=\"card controls-card\">
          <div>
            <h2>View Controls</h2>
            <div class="toolbar-copy">Highlight key states and control tree expansion.</div>
          </div>
          <div class="controls-grid">
            <div class="controls-group">
              <div class="toolbar-label">Signals to surface</div>
              <div class="pill-row" id="toggle-pills"></div>
            </div>
            <div class="controls-group">
              <div class="toolbar-label">Tree expansion</div>
              <div class="pill-row">
                <button class="action-button" id="expand-all" type="button">Expand all</button>
                <button class="action-button" id="expand-books" type="button">Expand books</button>
                <button class="action-button" id="expand-sections" type="button">Expand sections</button>
                <button class="action-button" id="collapse-all" type="button">Collapse all</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class=\"layout\">
      <div class=\"main-table\">
        <div class=\"table-wrap\">
          <table>
            <thead>
              <tr>
                <th class=\"name-col\">Structure</th>
                <th>Kind</th>
                <th>Version footprint</th>
              </tr>
            </thead>
            <tbody id=\"report-rows\"></tbody>
          </table>
        </div>
      </div>
    </section>
  </div>

  <div class="diff-modal" id="diff-modal" hidden>
    <div class="diff-modal__panel">
      <div class="diff-modal__header">
        <div>
          <h2 class="diff-modal__title" id="diff-modal-title">Content diff</h2>
          <div class="diff-modal__subtitle" id="diff-modal-subtitle"></div>
        </div>
        <button class="diff-modal__close" id="diff-modal-close" type="button">Close</button>
      </div>
      <div class="diff-modal__controls" id="diff-modal-controls"></div>
      <div class="diff-modal__body" id="diff-modal-body"></div>
    </div>
  </div>

  <script id=\"report-data\" type=\"application/json\">{payload}</script>
  <script>
    const report = JSON.parse(document.getElementById('report-data').textContent);
    const versions = report.versions;
    const rows = report.rows;
    const rowMap = new Map(rows.map((row) => [row.id, row]));
    const childMap = new Map();
    for (const row of rows) {{
      const parent = row.parent_id ?? '__root__';
      if (!childMap.has(parent)) childMap.set(parent, []);
      childMap.get(parent).push(row.id);
    }}

    const state = {{
      search: '',
      focusVersions: new Set(),
      selectedRowId: null,
      diffModalOpen: false,
      toggles: {{
        showDiffCount: true,
        onlyBranched: false,
        onlyInheritedPages: false,
        onlyStructuralNodes: false,
      }},
      expanded: new Set(rows.filter((row) => row.has_children).map((row) => row.id)),
      compare: {{ left: null, right: null, onlyChanges: true }},
    }};

    function createPill(label, active, onClick, className = 'filter-pill') {{
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = className + (active ? ' active' : '');
      button.addEventListener('click', onClick);
      return button;
    }}

    function renderVersionFocus() {{
      const container = document.getElementById('version-focus');
      container.replaceChildren();
      for (const version of versions) {{
        const label = version.status ? `${{version.label}} · ${{version.status}}` : version.label;
        container.appendChild(createPill(label, state.focusVersions.has(version.slug), () => {{
          if (state.focusVersions.has(version.slug)) state.focusVersions.delete(version.slug);
          else state.focusVersions.add(version.slug);
          render();
        }}, 'version-focus-pill'));
      }}
    }}

    function renderTogglePills() {{
      const defs = [
        ['showDiffCount', 'Show diff counts'],
        ['onlyBranched', 'Only branched'],
        ['onlyInheritedPages', 'Only inherited pages'],
        ['onlyStructuralNodes', 'Only structural-only nodes'],
      ];
      const container = document.getElementById('toggle-pills');
      container.replaceChildren();
      for (const [key, label] of defs) {{
        container.appendChild(createPill(label, state.toggles[key], () => {{
          state.toggles[key] = !state.toggles[key];
          render();
        }}));
      }}
    }}

    function rowMatchesFilters(row) {{
      const haystack = `${{row.label}} ${{row.title || ''}} ${{row.path || ''}} ${{Object.values(row.version_cells).map((cell) => cell.state).join(' ')}}`.toLowerCase();
      if (state.search && !haystack.includes(state.search)) return false;
      if (state.toggles.onlyBranched && !row.flags.has_branched) return false;
      if (state.toggles.onlyInheritedPages && !(row.kind === 'page' && row.flags.has_inherited)) return false;
      if (state.toggles.onlyStructuralNodes && !row.flags.has_structural) return false;
      return true;
    }}

    function hasVisibleDescendant(rowId) {{
      const children = childMap.get(rowId) || [];
      for (const childId of children) {{
        const child = rowMap.get(childId);
        if (rowMatchesFilters(child) || hasVisibleDescendant(childId)) return true;
      }}
      return false;
    }}

    function hasExclusiveRowFilter() {{
      return (
        state.toggles.onlyBranched ||
        state.toggles.onlyInheritedPages ||
        state.toggles.onlyStructuralNodes
      );
    }}

    function rowVisible(row) {{
      if (hasExclusiveRowFilter()) {{
        if (!rowMatchesFilters(row)) return false;
      }} else if (!rowMatchesFilters(row) && !hasVisibleDescendant(row.id)) return false;
      let parentId = row.parent_id;
      while (parentId) {{
        if (!state.expanded.has(parentId)) return false;
        parentId = rowMap.get(parentId)?.parent_id ?? null;
      }}
      return true;
    }}

    function shouldCollapseVersionChip(versionSlug) {{
      return state.focusVersions.size > 0 && !state.focusVersions.has(versionSlug);
    }}

    function compactStateLabel(stateName) {{
      const labels = {{
        authored: 'authored',
        branched: 'branched',
        inherited: 'inherited',
        'structural-only': 'structural',
        missing: 'missing',
        invalid: 'invalid',
      }};
      return labels[stateName] || stateName;
    }}

    function versionChipTitle(version, cell) {{
      const parts = [version.label, cell.state];
      if (version.status) parts.push(`status: ${{version.status}}`);
      if (version.is_current) parts.push('latest version');
      if (cell.source_version) parts.push(`source: ${{cell.source_version}}`);
      if (cell.diff_added || cell.diff_removed) parts.push(`diff: +${{cell.diff_added || 0}} -${{cell.diff_removed || 0}}`);
      return parts.join(' · ');
    }}

    function renderVersionStrip(row) {{
      const strip = document.createElement('div');
      strip.className = 'version-strip';
      for (const version of versions) {{
        const cell = row.version_cells[version.slug] || {{ state: 'missing' }};
        const chip = document.createElement('div');
        const isPlaceholder = cell.state === 'missing';
        chip.className = `version-chip state-${{cell.state}}${{shouldCollapseVersionChip(version.slug) ? ' collapsed' : ''}}${{isPlaceholder ? ' version-chip--placeholder' : ''}}`;
        if (!isPlaceholder) chip.title = versionChipTitle(version, cell);
        const diffHtml = cell.state === 'branched' && state.toggles.showDiffCount
          ? `<div class="version-chip__diff"><span class="plus">+${{cell.diff_added || 0}}</span><span class="minus">-${{cell.diff_removed || 0}}</span></div>`
          : '';
        chip.innerHTML = `
          <div class="version-chip__slug">${{version.label}}</div>
          <div class="version-chip__state">${{compactStateLabel(cell.state)}}</div>
          ${{diffHtml}}
        `;
        strip.appendChild(chip);
      }}
      return strip;
    }}

    function renderRows() {{
      const body = document.getElementById('report-rows');
      body.replaceChildren();

      for (const row of rows) {{
        if (!rowVisible(row)) continue;
        const tr = document.createElement('tr');
        if (state.selectedRowId === row.id) tr.classList.add('selected');
        const nameCell = document.createElement('td');
        nameCell.className = 'name-col';
        const rowTitle = document.createElement('div');
        rowTitle.className = `row-title indent-${{Math.min(row.depth, 2)}}`;
        if (row.has_children) {{
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'toggle';
          toggle.textContent = state.expanded.has(row.id) ? '−' : '+';
          toggle.addEventListener('click', (event) => {{
            event.stopPropagation();
            if (state.expanded.has(row.id)) state.expanded.delete(row.id);
            else state.expanded.add(row.id);
            renderRows();
          }});
          rowTitle.appendChild(toggle);
        }} else {{
          const spacer = document.createElement('div');
          spacer.style.width = '28px';
          spacer.style.height = '28px';
          rowTitle.appendChild(spacer);
        }}
        const block = document.createElement('div');
        block.className = 'row-label-block';
        block.innerHTML = `<div class="row-label">${{row.title || row.label}}</div><div class="row-subtitle">${{row.label}}</div>`;
        rowTitle.appendChild(block);
        nameCell.appendChild(rowTitle);
        tr.appendChild(nameCell);

        const kindCell = document.createElement('td');
        kindCell.innerHTML = `<span class="kind-badge">${{row.kind}}</span>`;
        tr.appendChild(kindCell);

        const stripCell = document.createElement('td');
        stripCell.appendChild(renderVersionStrip(row));
        tr.appendChild(stripCell);

        tr.addEventListener('click', () => {{
          state.selectedRowId = row.id;
          if (row.content_versions && Object.keys(row.content_versions).length > 0) {{
            const available = versions.filter((version) => row.content_versions[version.slug]);
            state.compare.left = available[0]?.slug ?? null;
            state.compare.right = available[available.length - 1]?.slug ?? null;
            state.diffModalOpen = true;
          }} else {{
            state.diffModalOpen = false;
          }}
          render();
        }});

        body.appendChild(tr);
      }}
    }}

    function lcsDiff(leftLines, rightLines) {{
      const rows = leftLines.length;
      const cols = rightLines.length;
      const dp = Array.from({{ length: rows + 1 }}, () => Array(cols + 1).fill(0));
      for (let i = rows - 1; i >= 0; i -= 1) {{
        for (let j = cols - 1; j >= 0; j -= 1) {{
          if (leftLines[i] === rightLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
          else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }}
      }}

      const output = [];
      let i = 0;
      let j = 0;
      while (i < rows && j < cols) {{
        if (leftLines[i] === rightLines[j]) {{
          output.push({{ type: 'same', left: i + 1, right: j + 1, text: leftLines[i] }});
          i += 1;
          j += 1;
        }} else if (dp[i + 1][j] >= dp[i][j + 1]) {{
          output.push({{ type: 'remove', left: i + 1, right: '', text: leftLines[i] }});
          i += 1;
        }} else {{
          output.push({{ type: 'add', left: '', right: j + 1, text: rightLines[j] }});
          j += 1;
        }}
      }}
      while (i < rows) {{
        output.push({{ type: 'remove', left: i + 1, right: '', text: leftLines[i] }});
        i += 1;
      }}
      while (j < cols) {{
        output.push({{ type: 'add', left: '', right: j + 1, text: rightLines[j] }});
        j += 1;
      }}
      return output;
    }}

    function escapeHtml(text) {{
      return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    }}

    function buildLcsMatrix(leftItems, rightItems) {{
      const dp = Array.from({{ length: leftItems.length + 1 }}, () => Array(rightItems.length + 1).fill(0));
      for (let i = leftItems.length - 1; i >= 0; i -= 1) {{
        for (let j = rightItems.length - 1; j >= 0; j -= 1) {{
          if (leftItems[i] === rightItems[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
          else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }}
      }}
      return dp;
    }}

    function tokenizeInlineText(text) {{
      return text.match(/\\s+|[A-Za-z0-9_]+|[^\\sA-Za-z0-9_]/g) || [];
    }}

    function compressSegments(segments) {{
      const compressed = [];
      for (const segment of segments) {{
        const previous = compressed[compressed.length - 1];
        if (previous && previous.type === segment.type) previous.text += segment.text;
        else compressed.push({{ ...segment }});
      }}
      return compressed;
    }}

    function inlineDiffMarkup(leftText, rightText) {{
      const leftTokens = tokenizeInlineText(leftText);
      const rightTokens = tokenizeInlineText(rightText);
      const dp = buildLcsMatrix(leftTokens, rightTokens);

      const leftSegments = [];
      const rightSegments = [];
      let i = 0;
      let j = 0;
      while (i < leftTokens.length && j < rightTokens.length) {{
        if (leftTokens[i] === rightTokens[j]) {{
          leftSegments.push({{ type: 'same', text: leftTokens[i] }});
          rightSegments.push({{ type: 'same', text: rightTokens[j] }});
          i += 1;
          j += 1;
        }} else if (dp[i + 1][j] >= dp[i][j + 1]) {{
          leftSegments.push({{ type: 'remove', text: leftTokens[i] }});
          i += 1;
        }} else {{
          rightSegments.push({{ type: 'add', text: rightTokens[j] }});
          j += 1;
        }}
      }}
      while (i < leftTokens.length) {{
        leftSegments.push({{ type: 'remove', text: leftTokens[i] }});
        i += 1;
      }}
      while (j < rightTokens.length) {{
        rightSegments.push({{ type: 'add', text: rightTokens[j] }});
        j += 1;
      }}

      function renderSegments(segments, changedClass) {{
        return compressSegments(segments).map((segment) => {{
          const text = escapeHtml(segment.text || ' ');
          if (segment.type === 'same') return text;
          return `<span class="${{changedClass}}">${{text}}</span>`;
        }}).join('');
      }}

      return {{
        leftHtml: renderSegments(leftSegments, 'inline-remove'),
        rightHtml: renderSegments(rightSegments, 'inline-add'),
      }};
    }}

    function similarityRatio(leftText, rightText) {{
      const leftChars = Array.from(leftText);
      const rightChars = Array.from(rightText);
      if (!leftChars.length && !rightChars.length) return 1;
      const dp = buildLcsMatrix(leftChars, rightChars);
      return (2 * dp[0][0]) / (leftChars.length + rightChars.length);
    }}

    function appendDiffLine(container, lineType, marker, number, htmlText) {{
      const lineEl = document.createElement('div');
      lineEl.className = `diff-line ${{lineType}}`;
      lineEl.innerHTML = `<div class="diff-line__gutter">${{marker}}${{number}}</div><div class="diff-line__code">${{htmlText}}</div>`;
      container.appendChild(lineEl);
    }}

    function renderDiffLines(diffPanel, diffLines) {{
      const visibleLines = state.compare.onlyChanges
        ? diffLines.filter((line) => line.type !== 'same')
        : diffLines;
      if (!visibleLines.length) {{
        diffPanel.innerHTML = '<div class="diff-line empty"><div class="diff-line__code">No diff available.</div></div>';
        return;
      }}

      let index = 0;
      while (index < visibleLines.length) {{
        const line = visibleLines[index];
        if (line.type === 'same') {{
          appendDiffLine(diffPanel, 'same', ' ', line.left, escapeHtml(line.text || ' '));
          index += 1;
          continue;
        }}

        if (line.type === 'remove') {{
          const removes = [];
          while (index < visibleLines.length && visibleLines[index].type === 'remove') {{
            removes.push(visibleLines[index]);
            index += 1;
          }}
          const adds = [];
          while (index < visibleLines.length && visibleLines[index].type === 'add') {{
            adds.push(visibleLines[index]);
            index += 1;
          }}

          const pairCount = Math.min(removes.length, adds.length);
          for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {{
            const leftLine = removes[pairIndex].text || '';
            const rightLine = adds[pairIndex].text || '';
            if (similarityRatio(leftLine, rightLine) >= 0.55) {{
              const markup = inlineDiffMarkup(leftLine, rightLine);
              appendDiffLine(diffPanel, 'remove', '−', removes[pairIndex].left, markup.leftHtml || ' ');
              appendDiffLine(diffPanel, 'add', '+', adds[pairIndex].right, markup.rightHtml || ' ');
            }} else {{
              appendDiffLine(diffPanel, 'remove', '−', removes[pairIndex].left, escapeHtml(leftLine || ' '));
              appendDiffLine(diffPanel, 'add', '+', adds[pairIndex].right, escapeHtml(rightLine || ' '));
            }}
          }}
          for (let pairIndex = pairCount; pairIndex < removes.length; pairIndex += 1) {{
            appendDiffLine(diffPanel, 'remove', '−', removes[pairIndex].left, escapeHtml(removes[pairIndex].text || ' '));
          }}
          for (let pairIndex = pairCount; pairIndex < adds.length; pairIndex += 1) {{
            appendDiffLine(diffPanel, 'add', '+', adds[pairIndex].right, escapeHtml(adds[pairIndex].text || ' '));
          }}
          continue;
        }}

        appendDiffLine(diffPanel, 'add', '+', line.right, escapeHtml(line.text || ' '));
        index += 1;
      }}
    }}

    function renderDiffModal() {{
      const modal = document.getElementById('diff-modal');
      const controls = document.getElementById('diff-modal-controls');
      const body = document.getElementById('diff-modal-body');
      const selected = state.selectedRowId ? rowMap.get(state.selectedRowId) : null;
      controls.replaceChildren();
      body.replaceChildren();

      if (!state.diffModalOpen || !selected || !selected.content_versions || Object.keys(selected.content_versions).length === 0) {{
        modal.hidden = true;
        document.body.style.overflow = '';
        return;
      }}

      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      document.getElementById('diff-modal-title').textContent = selected.title || selected.label;
      document.getElementById('diff-modal-subtitle').textContent = selected.path || selected.label;

      const available = versions.filter((version) => selected.content_versions[version.slug]);
      if (!available.length) {{
        body.appendChild(document.createTextNode('No resolved page content is available for this row.'));
        return;
      }}

      if (!state.compare.left) state.compare.left = available[0].slug;
      if (!state.compare.right) state.compare.right = available[available.length - 1].slug;

      const selectors = document.createElement('div');
      selectors.className = 'selector-row';
      const leftSelect = document.createElement('select');
      const rightSelect = document.createElement('select');
      for (const version of available) {{
        const leftOption = document.createElement('option');
        leftOption.value = version.slug;
        leftOption.textContent = version.label;
        if (version.slug === state.compare.left) leftOption.selected = true;
        leftSelect.appendChild(leftOption);

        const rightOption = document.createElement('option');
        rightOption.value = version.slug;
        rightOption.textContent = version.label;
        if (version.slug === state.compare.right) rightOption.selected = true;
        rightSelect.appendChild(rightOption);
      }}
      leftSelect.addEventListener('change', () => {{ state.compare.left = leftSelect.value; renderDiffModal(); }});
      rightSelect.addEventListener('change', () => {{ state.compare.right = rightSelect.value; renderDiffModal(); }});
      selectors.appendChild(leftSelect);
      selectors.appendChild(rightSelect);
      controls.appendChild(selectors);

      const toolbar = document.createElement('div');
      toolbar.className = 'diff-modal__toolbar';
      const toolbarLabel = document.createElement('div');
      toolbarLabel.className = 'diff-modal__toolbar-label';
      toolbarLabel.textContent = 'Diff view';
      toolbar.appendChild(toolbarLabel);
      toolbar.appendChild(createPill('Only show changes', state.compare.onlyChanges, () => {{
        state.compare.onlyChanges = !state.compare.onlyChanges;
        renderDiffModal();
      }}, 'diff-modal-pill'));
      controls.appendChild(toolbar);

      const leftCell = selected.version_cells[state.compare.left] || {{ state: 'missing' }};
      const rightCell = selected.version_cells[state.compare.right] || {{ state: 'missing' }};
      const leftText = selected.content_versions[state.compare.left] || '';
      const rightText = selected.content_versions[state.compare.right] || '';
      const [added, removed] = (() => {{
        const diff = lcsDiff(leftText.split(/\\r?\\n/), rightText.split(/\\r?\\n/));
        let a = 0;
        let r = 0;
        for (const line of diff) {{
          if (line.type === 'add') a += 1;
          if (line.type === 'remove') r += 1;
        }}
        return [a, r, diff];
      }})();
      const diffLines = lcsDiff(leftText.split(/\\r?\\n/), rightText.split(/\\r?\\n/));

      const meta = document.createElement('div');
      meta.className = 'diff-meta';
      meta.innerHTML = `
        <div class="diff-meta__versions">
          <div class="diff-meta__version">
            <div class="diff-meta__label">Left version</div>
            <div class="diff-meta__state"><strong>${{state.compare.left}}</strong> · ${{leftCell.state}}</div>
            <div class="diff-meta__source">${{leftCell.source_version ? `Source: ${{leftCell.source_version}}` : 'Source: direct content in this version'}}</div>
          </div>
          <div class="diff-meta__version">
            <div class="diff-meta__label">Right version</div>
            <div class="diff-meta__state"><strong>${{state.compare.right}}</strong> · ${{rightCell.state}}</div>
            <div class="diff-meta__source">${{rightCell.source_version ? `Source: ${{rightCell.source_version}}` : 'Source: direct content in this version'}}</div>
          </div>
        </div>
        <div class="diff-summary"><span class="plus">+${{added}}</span><span class="minus">-${{removed}}</span></div>
      `;
      body.appendChild(meta);

      const diffPanel = document.createElement('div');
      diffPanel.className = 'diff-panel';
      renderDiffLines(diffPanel, diffLines);
      diffPanel.scrollTop = 0;
      body.appendChild(diffPanel);
    }}

    function renderWarnings() {{
      const panel = document.getElementById('warnings-panel');
      const warnings = report.warnings;
      if (!warnings.length) {{
        panel.hidden = true;
        panel.replaceChildren();
        return;
      }}
      panel.hidden = false;
      const items = warnings.map((warning) => `<li>${{escapeHtml(warning)}}</li>`).join('');
      panel.innerHTML = `<h2>Validator issues</h2><p class="muted">These issues come from the same docs validator used in CI and are shown here first because they may indicate missing, orphaned, or invalid docs nodes.</p><ol>${{items}}</ol>`;
    }}

    function render() {{
      renderVersionFocus();
      renderTogglePills();
      renderRows();
      renderDiffModal();
      renderWarnings();
    }}

    document.getElementById('search-input').addEventListener('input', (event) => {{
      state.search = event.target.value.trim().toLowerCase();
      renderRows();
    }});
    document.getElementById('expand-all').addEventListener('click', () => {{
      rows.filter((row) => row.has_children).forEach((row) => state.expanded.add(row.id));
      renderRows();
    }});
    document.getElementById('expand-books').addEventListener('click', () => {{
      rows.filter((row) => row.kind === 'book').forEach((row) => state.expanded.add(row.id));
      renderRows();
    }});
    document.getElementById('expand-sections').addEventListener('click', () => {{
      rows.filter((row) => row.kind === 'book' || row.kind === 'section').forEach((row) => state.expanded.add(row.id));
      renderRows();
    }});
    document.getElementById('collapse-all').addEventListener('click', () => {{
      state.expanded.clear();
      renderRows();
    }});
    document.getElementById('diff-modal-close').addEventListener('click', () => {{
      state.diffModalOpen = false;
      renderDiffModal();
    }});
    document.getElementById('diff-modal').addEventListener('click', (event) => {{
      if (event.target.id !== 'diff-modal') return;
      state.diffModalOpen = false;
      renderDiffModal();
    }});
    document.addEventListener('keydown', (event) => {{
      if (event.key !== 'Escape' || !state.diffModalOpen) return;
      state.diffModalOpen = false;
      renderDiffModal();
    }});

    render();
  </script>
</body>
</html>
"""


def write_report(output_path: Path, website_dir: Path = DEFAULT_WEBSITE_DIR) -> Path:
    """Generate and write the standalone HTML report."""
    data = build_report_data(website_dir)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_report_html(data), encoding="utf-8")
    return output_path


def generate_docs_report(
    website_dir: Path = DEFAULT_WEBSITE_DIR,
    output_path: Path | None = None,
) -> Path:
    """Generate the standalone HTML docs structure report and return its path."""
    target = output_path or default_report_output(website_dir)
    return write_report(target, website_dir)


def check_report(output_path: Path, website_dir: Path = DEFAULT_WEBSITE_DIR) -> bool:
    """Return whether the committed report matches the current generated output."""
    generated = render_report_html(build_report_data(website_dir))
    if not output_path.exists():
        return False
    return output_path.read_text(encoding="utf-8") == generated


def build_parser() -> argparse.ArgumentParser:
    """Build the report generator CLI parser."""
    parser = argparse.ArgumentParser(
        description="Generate a standalone HTML report for docs structure, inheritance, and branching.",
    )
    parser.add_argument(
        "--website-dir",
        type=Path,
        default=DEFAULT_WEBSITE_DIR,
        help="website root to inspect",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="output HTML path (defaults to website-meta/docs-reports/docs-structure-report.html)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the committed report is missing or stale instead of writing it",
    )
    return parser


def main() -> int:
    """CLI entry point for docs report generation."""
    parser = build_parser()
    args = parser.parse_args()
    website_dir = args.website_dir.resolve()
    output_path = (args.output or default_report_output(website_dir)).resolve()

    if args.check:
        if check_report(output_path, website_dir):
            print(f"Docs structure report is current: {output_path}")
            return 0
        print(
            "Docs structure report is stale. Re-run "
            f"python3 website/scripts/docs-report.py --output {output_path}",
            flush=True,
        )
        return 1

    write_report(output_path, website_dir)
    print(f"Wrote docs structure report: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
