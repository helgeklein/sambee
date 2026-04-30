#!/usr/bin/env python3
"""Editor-oriented automation for versioned website docs content."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import tomllib

DEFAULT_WEBSITE_DIR = Path(__file__).resolve().parent.parent.parent

DOCS_ROOT_INDEX = "_index.md"
BRANCH_INHERIT = "_inherit.md"
PAGE_INDEX = "index.md"
PAGE_INHERIT = "inherit.md"


class BranchNodeState(Enum):
    """State of a version, book, or section node on disk."""

    AUTHORED = "authored"
    INHERITED = "inherited"
    STRUCTURAL = "structural"
    INVALID = "invalid"


class PageNodeState(Enum):
    """State of a page node on disk."""

    AUTHORED = "authored"
    INHERITED = "inherited"
    INVALID = "invalid"


class DocsEditorError(RuntimeError):
    """Raised when the docs editor cannot safely perform an operation."""


@dataclass(frozen=True)
class VersionEntry:
    """One docs version entry from docs-versions.toml."""

    slug: str
    label: str
    visible: bool = True
    status: str | None = None
    searchable: bool = False


@dataclass(frozen=True)
class VersionsDocument:
    """Structured representation of docs-versions.toml."""

    preamble: str
    current: str
    versions: list[VersionEntry]


@dataclass(frozen=True)
class PlannedChange:
    """One filesystem mutation the editor intends to apply."""

    action: str
    path: Path
    description: str
    content: str | None = None
    target: Path | None = None

    def display_path(self, website_dir: Path) -> str:
        """Return a workspace-relative path for human-readable output."""
        try:
            return str(self.path.relative_to(website_dir))
        except ValueError:
            return str(self.path)


@dataclass(frozen=True)
class OperationPlan:
    """A fully computed plan for one requested operation."""

    summary: str
    destructive: bool
    changes: list[PlannedChange]
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class EditorPaths:
    """Filesystem locations used by the docs editor."""

    website_dir: Path
    docs_content_dir: Path
    docs_nav_dir: Path
    docs_versions_file: Path
    validator_script: Path

    @classmethod
    def for_website(cls, website_dir: Path) -> "EditorPaths":
        """Build an EditorPaths object for one website root."""
        root = website_dir.resolve()
        return cls(
            website_dir=root,
            docs_content_dir=root / "content" / "docs",
            docs_nav_dir=root / "data" / "docs-nav",
            docs_versions_file=root / "data" / "docs-versions.toml",
            validator_script=root / "scripts" / "validate-docs-content.py",
        )


def parse_bool(value: str) -> bool:
    """Parse a CLI boolean flag value."""
    normalized = value.strip().lower()
    if normalized in {"true", "1", "yes", "y"}:
        return True
    if normalized in {"false", "0", "no", "n"}:
        return False
    raise argparse.ArgumentTypeError(f"expected a boolean value, got: {value}")


class DocsEditor:
    """High-level planner and executor for docs tree operations."""

    def __init__(self, website_dir: Path = DEFAULT_WEBSITE_DIR):
        self.paths = EditorPaths.for_website(website_dir)

    def load_toml(self, path: Path) -> dict[str, Any]:
        """Load TOML data from path."""
        with path.open("rb") as file:
            return tomllib.load(file)

    def load_versions_document(self) -> VersionsDocument:
        """Load docs-versions.toml with both structure and preserved preamble."""
        text = self.paths.docs_versions_file.read_text(encoding="utf-8")
        data = tomllib.loads(text)
        lines = text.splitlines()

        current_line_index = -1
        for index, line in enumerate(lines):
            if line.startswith("current ="):
                current_line_index = index
                break

        if current_line_index < 0:
            versions_data = data.get("versions", [])
            if versions_data:
                raise DocsEditorError("docs-versions.toml is missing the current key")
            preamble = text.rstrip("\n")
            if preamble:
                preamble = f"{preamble}\n"
            return VersionsDocument(
                preamble=preamble,
                current="",
                versions=[],
            )

        preamble = "\n".join(lines[:current_line_index])
        if preamble:
            preamble = f"{preamble}\n"

        versions_data = data.get("versions", [])
        versions: list[VersionEntry] = []
        for entry in versions_data:
            versions.append(
                VersionEntry(
                    slug=entry["slug"],
                    label=entry.get("label", entry["slug"]),
                    visible=entry.get("visible", True),
                    status=entry.get("status"),
                    searchable=entry.get("searchable", False),
                )
            )

        return VersionsDocument(
            preamble=preamble,
            current=data["current"],
            versions=versions,
        )

    def render_versions_document(self, document: VersionsDocument) -> str:
        """Render docs-versions.toml in the canonical project format."""
        parts: list[str] = []
        if document.preamble:
            parts.append(document.preamble.rstrip("\n"))

        parts.append(f'current = "{document.current}"')
        parts.append("")

        for entry in document.versions:
            parts.append("[[versions]]")
            parts.append(f'slug = "{entry.slug}"')
            parts.append(f'label = "{entry.label}"')
            parts.append(f"visible = {str(entry.visible).lower()}")
            if entry.status is not None:
                parts.append(f'status = "{entry.status}"')
            parts.append(f"searchable = {str(entry.searchable).lower()}")
            parts.append("")

        return "\n".join(parts).rstrip() + "\n"

    def version_root(self, version: str) -> Path:
        """Return the content root for one docs version."""
        return self.paths.docs_content_dir / version

    def nav_path(self, version: str) -> Path:
        """Return the nav file path for one docs version."""
        return self.paths.docs_nav_dir / f"{version}.toml"

    def existing_docs_versions_on_disk(self) -> list[str]:
        """Return version slugs that still exist in content or nav files on disk."""
        content_versions = {
            child.name
            for child in self.paths.docs_content_dir.iterdir()
            if child.is_dir()
        }
        nav_versions = {
            path.stem
            for path in self.paths.docs_nav_dir.glob("*.toml")
            if path.name != "README.toml"
        }
        return sorted(content_versions | nav_versions)

    def book_root(self, version: str, book: str) -> Path:
        """Return the root directory for one docs book."""
        return self.version_root(version) / book

    def section_root(self, version: str, book: str, section: str) -> Path:
        """Return the root directory for one docs section."""
        return self.book_root(version, book) / section

    def page_root(self, version: str, book: str, section: str, page: str) -> Path:
        """Return the root directory for one docs page."""
        return self.section_root(version, book, section) / page

    def version_slugs(self) -> list[str]:
        """Return declared version slugs in canonical order."""
        return [entry.slug for entry in self.load_versions_document().versions]

    def quote_toml_string(self, value: str) -> str:
        """Return a safe TOML basic string literal."""
        return json.dumps(value)

    def humanize_slug(self, slug: str) -> str:
        """Create a simple human-readable title from a slug."""
        return " ".join(part.capitalize() for part in slug.replace("_", "-").split("-"))

    def render_markdown_with_title(self, title: str, body: str = "") -> str:
        """Render a simple Markdown file with TOML front matter."""
        rendered = f"+++\ntitle = {self.quote_toml_string(title)}\n+++\n"
        if body:
            rendered += f"\n{body.rstrip()}\n"
        else:
            rendered += "\n"
        return rendered

    def load_nav_document(self, version: str) -> dict[str, Any]:
        """Load the canonical docs nav structure for one version."""
        nav_path = self.nav_path(version)
        if not nav_path.exists():
            raise DocsEditorError(f"docs nav file is missing for version {version}")

        data = self.load_toml(nav_path)
        books = list(data.get("books", []))
        sections: dict[str, list[dict[str, str]]] = {}
        for book_slug, section_table in data.get("sections", {}).items():
            sections[book_slug] = [
                {"slug": item["slug"], "title": item["title"]}
                for item in section_table.get("items", [])
            ]

        pages: dict[str, dict[str, list[str]]] = {}
        for book_slug, book_pages in data.get("pages", {}).items():
            pages[book_slug] = {}
            for section_slug, section_pages in book_pages.items():
                pages[book_slug][section_slug] = list(section_pages.get("items", []))

        return {
            "books": books,
            "sections": sections,
            "pages": pages,
        }

    def render_nav_document(self, document: dict[str, Any]) -> str:
        """Render one docs nav document in the project's canonical format."""
        books: list[str] = list(document.get("books", []))
        sections: dict[str, list[dict[str, str]]] = document.get("sections", {})
        pages: dict[str, dict[str, list[str]]] = document.get("pages", {})

        parts: list[str] = ["books = ["]
        for book in books:
            parts.append(f"  {self.quote_toml_string(book)},")
        parts.append("]")

        for book in books:
            book_sections = sections.get(book, [])
            for section in book_sections:
                parts.append("")
                parts.append(f"[[sections.{book}.items]]")
                parts.append(f"slug = {self.quote_toml_string(section['slug'])}")
                parts.append(f"title = {self.quote_toml_string(section['title'])}")

                page_items = pages.get(book, {}).get(section["slug"])
                if page_items is not None:
                    parts.append("")
                    parts.append(f"[pages.{book}.{section['slug']}]")
                    if page_items:
                        parts.append("items = [")
                        for page_slug in page_items:
                            parts.append(f"  {self.quote_toml_string(page_slug)},")
                        parts.append("]")
                    else:
                        parts.append("items = []")

        return "\n".join(parts).rstrip() + "\n"

    def insert_at_position(
        self, existing: list[str], value: str, position: str | None
    ) -> list[str]:
        """Insert a value into an ordered slug list using a flexible position syntax."""
        updated = list(existing)
        if value in updated:
            raise DocsEditorError(f"slug already exists in ordered list: {value}")

        if position is None or position == "end":
            updated.append(value)
            return updated

        if position == "start":
            updated.insert(0, value)
            return updated

        if position.startswith("before:"):
            anchor = position.split(":", 1)[1]
            if anchor not in updated:
                raise DocsEditorError(f"unknown position anchor: {anchor}")
            updated.insert(updated.index(anchor), value)
            return updated

        if position.startswith("after:"):
            anchor = position.split(":", 1)[1]
            if anchor not in updated:
                raise DocsEditorError(f"unknown position anchor: {anchor}")
            updated.insert(updated.index(anchor) + 1, value)
            return updated

        try:
            index = int(position)
        except ValueError as error:
            raise DocsEditorError(f"unsupported position value: {position}") from error

        if index < 0 or index > len(updated):
            raise DocsEditorError(f"position index out of range: {index}")
        updated.insert(index, value)
        return updated

    def can_resolve_branch_inheritance(
        self, version: str, relative_parts: tuple[str, ...]
    ) -> bool:
        """Return whether a branch inheritance marker would resolve from a given version."""
        version_order = self.version_slugs()
        try:
            start_index = version_order.index(version)
        except ValueError:
            raise DocsEditorError(f"unknown docs version: {version}")

        for candidate_version in reversed(version_order[:start_index]):
            candidate = self.version_root(candidate_version) / Path(*relative_parts)
            if (candidate / DOCS_ROOT_INDEX).exists():
                return True
            if (candidate / BRANCH_INHERIT).exists():
                continue
            return False

        return False

    def can_resolve_page_inheritance(
        self, version: str, relative_parts: tuple[str, ...]
    ) -> bool:
        """Return whether a page inheritance marker would resolve from a given version."""
        version_order = self.version_slugs()
        try:
            start_index = version_order.index(version)
        except ValueError:
            raise DocsEditorError(f"unknown docs version: {version}")

        for candidate_version in reversed(version_order[:start_index]):
            candidate = self.version_root(candidate_version) / Path(*relative_parts)
            if (candidate / PAGE_INDEX).exists():
                return True
            if (candidate / PAGE_INHERIT).exists():
                continue
            return False

        return False

    def resolve_branch_source_file(
        self, version: str, relative_parts: tuple[str, ...]
    ) -> Path:
        """Return the resolved source `_index.md` for a branch node."""
        version_order = self.version_slugs()
        try:
            start_index = version_order.index(version)
        except ValueError as error:
            raise DocsEditorError(f"unknown docs version: {version}") from error

        for candidate_version in reversed(version_order[: start_index + 1]):
            candidate = self.version_root(candidate_version) / Path(*relative_parts)
            branch_index = candidate / DOCS_ROOT_INDEX
            branch_inherit = candidate / BRANCH_INHERIT
            if branch_index.exists():
                return branch_index
            if branch_inherit.exists():
                continue
            break

        raise DocsEditorError(
            f"unable to resolve branch content for {'/'.join((version, *relative_parts))}"
        )

    def resolve_page_source_file(
        self, version: str, relative_parts: tuple[str, ...]
    ) -> Path:
        """Return the resolved source `index.md` for a page node."""
        version_order = self.version_slugs()
        try:
            start_index = version_order.index(version)
        except ValueError as error:
            raise DocsEditorError(f"unknown docs version: {version}") from error

        for candidate_version in reversed(version_order[: start_index + 1]):
            candidate = self.version_root(candidate_version) / Path(*relative_parts)
            page_index = candidate / PAGE_INDEX
            page_inherit = candidate / PAGE_INHERIT
            if page_index.exists():
                return page_index
            if page_inherit.exists():
                continue
            break

        raise DocsEditorError(
            f"unable to resolve page content for {'/'.join((version, *relative_parts))}"
        )

    def replace_title_in_markdown(self, text: str, title: str) -> str:
        """Replace or insert a TOML front matter title in a Markdown file."""
        lines = text.splitlines()
        if not lines or lines[0].strip() != "+++":
            raise DocsEditorError("expected TOML front matter delimited by +++")

        closing_index = -1
        for index in range(1, len(lines)):
            if lines[index].strip() == "+++":
                closing_index = index
                break

        if closing_index < 0:
            raise DocsEditorError("unterminated TOML front matter")

        title_line = f"title = {self.quote_toml_string(title)}"
        replaced = False
        for index in range(1, closing_index):
            if lines[index].startswith("title ="):
                lines[index] = title_line
                replaced = True
                break

        if not replaced:
            lines.insert(1, title_line)

        return "\n".join(lines).rstrip() + "\n"

    def rename_book_in_nav(
        self, document: dict[str, Any], old_book: str, new_book: str
    ) -> dict[str, Any]:
        """Return a nav document with one book slug renamed."""
        books = list(document.get("books", []))
        if old_book not in books:
            raise DocsEditorError(f"book is not listed in nav: {old_book}")
        if new_book in books:
            raise DocsEditorError(f"book already exists in nav: {new_book}")

        updated_books = [new_book if book == old_book else book for book in books]
        updated_sections = dict(document.get("sections", {}))
        updated_pages = dict(document.get("pages", {}))

        if old_book in updated_sections:
            updated_sections[new_book] = updated_sections.pop(old_book)
        if old_book in updated_pages:
            updated_pages[new_book] = updated_pages.pop(old_book)

        return {
            "books": updated_books,
            "sections": updated_sections,
            "pages": updated_pages,
        }

    def remove_book_from_nav(
        self, document: dict[str, Any], book: str
    ) -> dict[str, Any]:
        """Return a nav document with one book removed."""
        return {
            "books": [slug for slug in document.get("books", []) if slug != book],
            "sections": {
                slug: value
                for slug, value in document.get("sections", {}).items()
                if slug != book
            },
            "pages": {
                slug: value
                for slug, value in document.get("pages", {}).items()
                if slug != book
            },
        }

    def rename_section_in_nav(
        self,
        document: dict[str, Any],
        book: str,
        old_section: str,
        new_section: str,
        title: str | None,
    ) -> dict[str, Any]:
        """Return a nav document with one section slug renamed within a book."""
        updated_sections = dict(document.get("sections", {}))
        updated_pages = {
            book_slug: dict(book_pages)
            for book_slug, book_pages in document.get("pages", {}).items()
        }

        if book not in updated_sections:
            raise DocsEditorError(f"book has no sections in nav: {book}")

        section_entries = [dict(entry) for entry in updated_sections[book]]
        old_index = -1
        for index, entry in enumerate(section_entries):
            if entry["slug"] == old_section:
                old_index = index
            elif entry["slug"] == new_section:
                raise DocsEditorError(
                    f"section already exists in nav for {book}: {new_section}"
                )

        if old_index < 0:
            raise DocsEditorError(f"section is not listed in nav: {book}/{old_section}")

        section_entries[old_index] = {
            "slug": new_section,
            "title": title or section_entries[old_index]["title"],
        }
        updated_sections[book] = section_entries

        book_pages = updated_pages.setdefault(book, {})
        if old_section in book_pages:
            book_pages[new_section] = book_pages.pop(old_section)
        elif new_section in book_pages:
            raise DocsEditorError(
                f"section pages already exist for {book}/{new_section} in nav"
            )

        return {
            "books": list(document.get("books", [])),
            "sections": updated_sections,
            "pages": updated_pages,
        }

    def remove_section_from_nav(
        self, document: dict[str, Any], book: str, section: str
    ) -> dict[str, Any]:
        """Return a nav document with one section removed from a book."""
        updated_sections = dict(document.get("sections", {}))
        book_sections = updated_sections.get(book, [])
        updated_sections[book] = [
            entry for entry in book_sections if entry["slug"] != section
        ]

        updated_pages = {
            book_slug: dict(book_pages)
            for book_slug, book_pages in document.get("pages", {}).items()
        }
        if book in updated_pages and section in updated_pages[book]:
            del updated_pages[book][section]

        return {
            "books": list(document.get("books", [])),
            "sections": updated_sections,
            "pages": updated_pages,
        }

    def rename_page_in_nav(
        self,
        document: dict[str, Any],
        book: str,
        section: str,
        old_page: str,
        new_page: str,
    ) -> dict[str, Any]:
        """Return a nav document with one page slug renamed within a section."""
        updated_pages = {
            book_slug: dict(book_pages)
            for book_slug, book_pages in document.get("pages", {}).items()
        }

        book_pages = updated_pages.setdefault(book, {})
        section_pages = list(book_pages.get(section, []))
        old_index = -1
        for index, page_slug in enumerate(section_pages):
            if page_slug == old_page:
                old_index = index
            elif page_slug == new_page:
                raise DocsEditorError(
                    f"page already exists in nav for {book}/{section}: {new_page}"
                )

        if old_index < 0:
            raise DocsEditorError(
                f"page is not listed in nav: {book}/{section}/{old_page}"
            )

        section_pages[old_index] = new_page
        book_pages[section] = section_pages

        return {
            "books": list(document.get("books", [])),
            "sections": dict(document.get("sections", {})),
            "pages": updated_pages,
        }

    def remove_page_from_nav(
        self, document: dict[str, Any], book: str, section: str, page: str
    ) -> dict[str, Any]:
        """Return a nav document with one page removed from a section."""
        updated_pages = {
            book_slug: dict(book_pages)
            for book_slug, book_pages in document.get("pages", {}).items()
        }
        book_pages = updated_pages.setdefault(book, {})
        section_pages = list(book_pages.get(section, []))
        book_pages[section] = [
            page_slug for page_slug in section_pages if page_slug != page
        ]

        return {
            "books": list(document.get("books", [])),
            "sections": dict(document.get("sections", {})),
            "pages": updated_pages,
        }

    def insert_section_entry_at_position(
        self,
        existing: list[dict[str, str]],
        entry: dict[str, str],
        position: str | None,
    ) -> list[dict[str, str]]:
        """Insert a section entry using the same position syntax as slug lists."""
        ordered_slugs = [item["slug"] for item in existing]
        updated_order = self.insert_at_position(ordered_slugs, entry["slug"], position)
        by_slug = {item["slug"]: dict(item) for item in existing}
        by_slug[entry["slug"]] = dict(entry)
        return [by_slug[slug] for slug in updated_order]

    def book_tree_has_real_content(self, book_dir: Path) -> bool:
        """Return whether a book tree contains real authored content."""
        for markdown_path in sorted(book_dir.rglob("*.md")):
            if markdown_path.name in {DOCS_ROOT_INDEX, PAGE_INDEX}:
                return True
        return False

    def section_tree_has_real_content(self, section_dir: Path) -> bool:
        """Return whether a section tree contains real authored content."""
        for markdown_path in sorted(section_dir.rglob("*.md")):
            if markdown_path.name in {DOCS_ROOT_INDEX, PAGE_INDEX}:
                return True
        return False

    def page_has_real_content(self, page_dir: Path) -> bool:
        """Return whether a page folder contains real authored content."""
        return (page_dir / PAGE_INDEX).exists()

    def classify_branch_node_state(self, path: Path) -> BranchNodeState:
        """Return whether a branch node is authored, inherited, structural, or invalid."""
        if not path.exists():
            return BranchNodeState.INVALID

        has_index = (path / DOCS_ROOT_INDEX).exists()
        has_inherit = (path / BRANCH_INHERIT).exists()
        if has_index and has_inherit:
            return BranchNodeState.INVALID
        if has_index:
            return BranchNodeState.AUTHORED
        if has_inherit:
            return BranchNodeState.INHERITED
        return BranchNodeState.STRUCTURAL

    def classify_page_node_state(self, path: Path) -> PageNodeState:
        """Return whether a page node is authored, inherited, or invalid."""
        if not path.exists():
            return PageNodeState.INVALID

        has_index = (path / PAGE_INDEX).exists()
        has_inherit = (path / PAGE_INHERIT).exists()
        if has_index and has_inherit:
            return PageNodeState.INVALID
        if has_index:
            return PageNodeState.AUTHORED
        if has_inherit:
            return PageNodeState.INHERITED
        return PageNodeState.INVALID

    def inherited_only_book_descendants(
        self, version: str, old_book: str, new_book: str
    ) -> list[str]:
        """Return later versions that can safely follow a book rename automatically."""
        version_order = self.version_slugs()
        try:
            start_index = version_order.index(version)
        except ValueError as error:
            raise DocsEditorError(f"unknown docs version: {version}") from error

        inherited_only: list[str] = []
        modified: list[str] = []

        for later_version in version_order[start_index + 1 :]:
            old_book_dir = self.book_root(later_version, old_book)
            new_book_dir = self.book_root(later_version, new_book)
            nav_path = self.nav_path(later_version)

            if not nav_path.exists() and not old_book_dir.exists():
                continue

            later_nav = self.load_nav_document(later_version)
            old_in_nav = old_book in later_nav.get("books", [])
            new_in_nav = new_book in later_nav.get("books", [])

            if new_book_dir.exists() or new_in_nav:
                raise DocsEditorError(
                    f"cannot rename book {old_book} to {new_book}: later version {later_version} already has {new_book}"
                )

            if not old_book_dir.exists() and not old_in_nav:
                continue

            if not old_book_dir.exists():
                raise DocsEditorError(
                    f"later version {later_version} lists book {old_book} in nav but the folder is missing"
                )

            if self.book_tree_has_real_content(old_book_dir):
                modified.append(later_version)
            else:
                inherited_only.append(later_version)

        if modified:
            raise DocsEditorError(
                "cannot rename book across later versions with real content: "
                + ", ".join(modified)
            )

        return inherited_only

    def deletable_book_descendants(self, version: str, book: str) -> list[str]:
        """Return later versions that can safely follow a book delete automatically."""
        version_order = self.version_slugs()
        try:
            start_index = version_order.index(version)
        except ValueError as error:
            raise DocsEditorError(f"unknown docs version: {version}") from error

        inherited_only: list[str] = []
        modified: list[str] = []

        for later_version in version_order[start_index + 1 :]:
            later_book_dir = self.book_root(later_version, book)
            nav_path = self.nav_path(later_version)

            if not nav_path.exists() and not later_book_dir.exists():
                continue

            later_nav = self.load_nav_document(later_version)
            in_nav = book in later_nav.get("books", [])

            if not later_book_dir.exists() and not in_nav:
                continue

            if not later_book_dir.exists():
                raise DocsEditorError(
                    f"later version {later_version} lists book {book} in nav but the folder is missing"
                )

            if self.book_tree_has_real_content(later_book_dir):
                modified.append(later_version)
            else:
                inherited_only.append(later_version)

        if modified:
            raise DocsEditorError(
                "cannot delete book across later versions with real content: "
                + ", ".join(modified)
            )

        return inherited_only

    def build_materialized_book_tree_changes(
        self, version: str, old_book: str, new_book: str, title: str | None
    ) -> list[PlannedChange]:
        """Create the renamed book tree, materializing inherited content in the target version."""
        old_book_dir = self.book_root(version, old_book)
        new_book_dir = self.book_root(version, new_book)
        changes: list[PlannedChange] = [
            PlannedChange(
                "create_dir",
                new_book_dir,
                f"Create renamed book directory {version}/{new_book}",
            )
        ]

        old_book_state = self.classify_branch_node_state(old_book_dir)
        if old_book_state is BranchNodeState.INVALID:
            raise DocsEditorError(
                f"book node is invalid for rename materialization: {version}/{old_book}"
            )
        if old_book_state is BranchNodeState.STRUCTURAL:
            raise DocsEditorError(
                f"book node cannot be structural-only: {version}/{old_book}"
            )

        # Once the slug changes in the target version, inheritance can no longer continue
        # to resolve through the old path lineage, so inherited roots are materialized here.
        book_index_text = self.resolve_branch_source_file(
            version, (old_book,)
        ).read_text(encoding="utf-8")
        if title is not None:
            book_index_text = self.replace_title_in_markdown(book_index_text, title)
        changes.append(
            PlannedChange(
                "write_text",
                new_book_dir / DOCS_ROOT_INDEX,
                f"Materialize renamed book landing content for {version}/{new_book}",
                book_index_text,
            )
        )

        for section_dir in self.direct_child_dirs(old_book_dir):
            new_section_dir = new_book_dir / section_dir.name
            section_state = self.classify_branch_node_state(section_dir)
            if section_state is BranchNodeState.INVALID:
                raise DocsEditorError(
                    f"section node is invalid for rename materialization: {version}/{old_book}/{section_dir.name}"
                )
            changes.append(
                PlannedChange(
                    "create_dir",
                    new_section_dir,
                    f"Create renamed section directory {version}/{new_book}/{section_dir.name}",
                )
            )

            if section_state in {
                BranchNodeState.AUTHORED,
                BranchNodeState.INHERITED,
            }:
                section_index_text = self.resolve_branch_source_file(
                    version, (old_book, section_dir.name)
                ).read_text(encoding="utf-8")
                changes.append(
                    PlannedChange(
                        "write_text",
                        new_section_dir / DOCS_ROOT_INDEX,
                        f"Materialize renamed section landing content for {version}/{new_book}/{section_dir.name}",
                        section_index_text,
                    )
                )

            for page_dir in self.direct_child_dirs(section_dir):
                new_page_dir = new_section_dir / page_dir.name
                page_state = self.classify_page_node_state(page_dir)
                if page_state is PageNodeState.INVALID:
                    raise DocsEditorError(
                        f"page node is invalid for rename materialization: {version}/{old_book}/{section_dir.name}/{page_dir.name}"
                    )
                changes.append(
                    PlannedChange(
                        "create_dir",
                        new_page_dir,
                        f"Create renamed page directory {version}/{new_book}/{section_dir.name}/{page_dir.name}",
                    )
                )
                page_index_text = self.resolve_page_source_file(
                    version, (old_book, section_dir.name, page_dir.name)
                ).read_text(encoding="utf-8")
                changes.append(
                    PlannedChange(
                        "write_text",
                        new_page_dir / PAGE_INDEX,
                        f"Materialize renamed page content for {version}/{new_book}/{section_dir.name}/{page_dir.name}",
                        page_index_text,
                    )
                )

        return changes

    def inherited_only_section_descendants(
        self, version: str, book: str, old_section: str, new_section: str
    ) -> list[str]:
        """Return later versions that can safely follow a section rename automatically."""
        version_order = self.version_slugs()
        try:
            start_index = version_order.index(version)
        except ValueError as error:
            raise DocsEditorError(f"unknown docs version: {version}") from error

        inherited_only: list[str] = []
        modified: list[str] = []

        for later_version in version_order[start_index + 1 :]:
            old_section_dir = self.section_root(later_version, book, old_section)
            new_section_dir = self.section_root(later_version, book, new_section)
            nav_path = self.nav_path(later_version)

            if not nav_path.exists() and not old_section_dir.exists():
                continue

            later_nav = self.load_nav_document(later_version)
            later_sections = later_nav.get("sections", {}).get(book, [])
            old_in_nav = any(entry["slug"] == old_section for entry in later_sections)
            new_in_nav = any(entry["slug"] == new_section for entry in later_sections)

            if new_section_dir.exists() or new_in_nav:
                raise DocsEditorError(
                    f"cannot rename section {book}/{old_section} to {new_section}: later version {later_version} already has {new_section}"
                )

            if not old_section_dir.exists() and not old_in_nav:
                continue

            if not old_section_dir.exists():
                raise DocsEditorError(
                    f"later version {later_version} lists section {book}/{old_section} in nav but the folder is missing"
                )

            if self.section_tree_has_real_content(old_section_dir):
                modified.append(later_version)
            else:
                inherited_only.append(later_version)

        if modified:
            raise DocsEditorError(
                "cannot rename section across later versions with real content: "
                + ", ".join(modified)
            )

        return inherited_only

    def deletable_section_descendants(
        self, version: str, book: str, section: str
    ) -> list[str]:
        """Return later versions that can safely follow a section delete automatically."""
        version_order = self.version_slugs()
        try:
            start_index = version_order.index(version)
        except ValueError as error:
            raise DocsEditorError(f"unknown docs version: {version}") from error

        inherited_only: list[str] = []
        modified: list[str] = []

        for later_version in version_order[start_index + 1 :]:
            later_section_dir = self.section_root(later_version, book, section)
            nav_path = self.nav_path(later_version)

            if not nav_path.exists() and not later_section_dir.exists():
                continue

            later_nav = self.load_nav_document(later_version)
            later_sections = later_nav.get("sections", {}).get(book, [])
            in_nav = any(entry["slug"] == section for entry in later_sections)

            if not later_section_dir.exists() and not in_nav:
                continue

            if not later_section_dir.exists():
                raise DocsEditorError(
                    f"later version {later_version} lists section {book}/{section} in nav but the folder is missing"
                )

            if self.section_tree_has_real_content(later_section_dir):
                modified.append(later_version)
            else:
                inherited_only.append(later_version)

        if modified:
            raise DocsEditorError(
                "cannot delete section across later versions with real content: "
                + ", ".join(modified)
            )

        return inherited_only

    def inherited_only_page_descendants(
        self, version: str, book: str, section: str, old_page: str, new_page: str
    ) -> list[str]:
        """Return later versions that can safely follow a page rename automatically."""
        version_order = self.version_slugs()
        try:
            start_index = version_order.index(version)
        except ValueError as error:
            raise DocsEditorError(f"unknown docs version: {version}") from error

        inherited_only: list[str] = []
        modified: list[str] = []

        for later_version in version_order[start_index + 1 :]:
            old_page_dir = self.page_root(later_version, book, section, old_page)
            new_page_dir = self.page_root(later_version, book, section, new_page)
            nav_path = self.nav_path(later_version)

            if not nav_path.exists() and not old_page_dir.exists():
                continue

            later_nav = self.load_nav_document(later_version)
            later_pages = later_nav.get("pages", {}).get(book, {}).get(section, [])
            old_in_nav = old_page in later_pages
            new_in_nav = new_page in later_pages

            if new_page_dir.exists() or new_in_nav:
                raise DocsEditorError(
                    f"cannot rename page {book}/{section}/{old_page} to {new_page}: later version {later_version} already has {new_page}"
                )

            if not old_page_dir.exists() and not old_in_nav:
                continue

            if not old_page_dir.exists():
                raise DocsEditorError(
                    f"later version {later_version} lists page {book}/{section}/{old_page} in nav but the folder is missing"
                )
            if not self.has_page_marker(old_page_dir):
                raise DocsEditorError(
                    f"later version {later_version} page {book}/{section}/{old_page} is missing index.md or inherit.md"
                )

            if self.page_has_real_content(old_page_dir):
                modified.append(later_version)
            else:
                inherited_only.append(later_version)

        if modified:
            raise DocsEditorError(
                "cannot rename page across later versions with real content: "
                + ", ".join(modified)
            )

        return inherited_only

    def deletable_page_descendants(
        self, version: str, book: str, section: str, page: str
    ) -> list[str]:
        """Return later versions that can safely follow a page delete automatically."""
        version_order = self.version_slugs()
        try:
            start_index = version_order.index(version)
        except ValueError as error:
            raise DocsEditorError(f"unknown docs version: {version}") from error

        inherited_only: list[str] = []
        modified: list[str] = []

        for later_version in version_order[start_index + 1 :]:
            later_page_dir = self.page_root(later_version, book, section, page)
            nav_path = self.nav_path(later_version)

            if not nav_path.exists() and not later_page_dir.exists():
                continue

            later_nav = self.load_nav_document(later_version)
            later_pages = later_nav.get("pages", {}).get(book, {}).get(section, [])
            in_nav = page in later_pages

            if not later_page_dir.exists() and not in_nav:
                continue

            if not later_page_dir.exists():
                raise DocsEditorError(
                    f"later version {later_version} lists page {book}/{section}/{page} in nav but the folder is missing"
                )
            if not self.has_page_marker(later_page_dir):
                raise DocsEditorError(
                    f"later version {later_version} page {book}/{section}/{page} is missing index.md or inherit.md"
                )

            if self.page_has_real_content(later_page_dir):
                modified.append(later_version)
            else:
                inherited_only.append(later_version)

        if modified:
            raise DocsEditorError(
                "cannot delete page across later versions with real content: "
                + ", ".join(modified)
            )

        return inherited_only

    def build_materialized_section_tree_changes(
        self,
        version: str,
        book: str,
        old_section: str,
        new_section: str,
        title: str | None,
    ) -> list[PlannedChange]:
        """Create the renamed section tree, materializing inherited content in the target version."""
        old_section_dir = self.section_root(version, book, old_section)
        new_section_dir = self.section_root(version, book, new_section)
        changes: list[PlannedChange] = [
            PlannedChange(
                "create_dir",
                new_section_dir,
                f"Create renamed section directory {version}/{book}/{new_section}",
            )
        ]

        old_section_state = self.classify_branch_node_state(old_section_dir)
        if old_section_state is BranchNodeState.INVALID:
            raise DocsEditorError(
                f"section node is invalid for rename materialization: {version}/{book}/{old_section}"
            )

        if old_section_state in {
            BranchNodeState.AUTHORED,
            BranchNodeState.INHERITED,
        }:
            section_index_text = self.resolve_branch_source_file(
                version, (book, old_section)
            ).read_text(encoding="utf-8")
            if title is not None:
                section_index_text = self.replace_title_in_markdown(
                    section_index_text, title
                )
            changes.append(
                PlannedChange(
                    "write_text",
                    new_section_dir / DOCS_ROOT_INDEX,
                    f"Materialize renamed section landing content for {version}/{book}/{new_section}",
                    section_index_text,
                )
            )

        for page_dir in self.direct_child_dirs(old_section_dir):
            new_page_dir = new_section_dir / page_dir.name
            page_state = self.classify_page_node_state(page_dir)
            if page_state is PageNodeState.INVALID:
                raise DocsEditorError(
                    f"page node is invalid for rename materialization: {version}/{book}/{old_section}/{page_dir.name}"
                )
            changes.append(
                PlannedChange(
                    "create_dir",
                    new_page_dir,
                    f"Create renamed page directory {version}/{book}/{new_section}/{page_dir.name}",
                )
            )
            page_index_text = self.resolve_page_source_file(
                version, (book, old_section, page_dir.name)
            ).read_text(encoding="utf-8")
            changes.append(
                PlannedChange(
                    "write_text",
                    new_page_dir / PAGE_INDEX,
                    f"Materialize renamed page content for {version}/{book}/{new_section}/{page_dir.name}",
                    page_index_text,
                )
            )

        return changes

    def build_materialized_page_changes(
        self,
        version: str,
        book: str,
        section: str,
        old_page: str,
        new_page: str,
        title: str | None,
    ) -> list[PlannedChange]:
        """Create the renamed page node, materializing inherited content in the target version."""
        old_page_dir = self.page_root(version, book, section, old_page)
        old_page_state = self.classify_page_node_state(old_page_dir)
        if old_page_state is PageNodeState.INVALID:
            raise DocsEditorError(
                f"page node is invalid for rename materialization: {version}/{book}/{section}/{old_page}"
            )

        new_page_dir = self.page_root(version, book, section, new_page)
        page_index_text = self.resolve_page_source_file(
            version, (book, section, old_page)
        ).read_text(encoding="utf-8")
        if title is not None:
            page_index_text = self.replace_title_in_markdown(page_index_text, title)

        return [
            PlannedChange(
                "create_dir",
                new_page_dir,
                f"Create renamed page directory {version}/{book}/{section}/{new_page}",
            ),
            PlannedChange(
                "write_text",
                new_page_dir / PAGE_INDEX,
                f"Materialize renamed page content for {version}/{book}/{section}/{new_page}",
                page_index_text,
            ),
        ]

    def find_version_index(self, versions: list[VersionEntry], slug: str) -> int:
        """Return the index of one version slug or raise."""
        for index, entry in enumerate(versions):
            if entry.slug == slug:
                return index
        raise DocsEditorError(f"unknown docs version: {slug}")

    def direct_child_dirs(self, path: Path) -> list[Path]:
        """Return sorted direct child directories for a docs node."""
        if not path.exists():
            return []
        return sorted(child for child in path.iterdir() if child.is_dir())

    def has_branch_marker(self, path: Path) -> bool:
        """Return whether a version/book/section folder has landing content or inheritance."""
        return self.classify_branch_node_state(path) in {
            BranchNodeState.AUTHORED,
            BranchNodeState.INHERITED,
        }

    def has_page_marker(self, path: Path) -> bool:
        """Return whether a page folder has page content or inheritance."""
        return self.classify_page_node_state(path) in {
            PageNodeState.AUTHORED,
            PageNodeState.INHERITED,
        }

    def empty_marker(self, path: Path) -> str:
        """Return the canonical content for an inheritance marker file."""
        return ""

    def build_inherited_version_tree_changes(
        self, source_version: str, new_version: str
    ) -> list[PlannedChange]:
        """Create the directory and marker changes for a new inherited version."""
        source_root = self.version_root(source_version)
        new_root = self.version_root(new_version)

        if not source_root.exists():
            raise DocsEditorError(
                f"cannot inherit from {source_version}: content directory is missing"
            )
        if not self.has_branch_marker(source_root):
            raise DocsEditorError(
                f"cannot inherit from {source_version}: version root is missing _index.md or _inherit.md"
            )

        changes: list[PlannedChange] = [
            PlannedChange(
                "create_dir", new_root, f"Create version directory {new_version}"
            ),
            PlannedChange(
                "write_text",
                new_root / BRANCH_INHERIT,
                f"Create version inheritance marker for {new_version}",
                self.empty_marker(new_root / BRANCH_INHERIT),
            ),
        ]

        for book_dir in self.direct_child_dirs(source_root):
            new_book_dir = new_root / book_dir.name
            if not self.has_branch_marker(book_dir):
                raise DocsEditorError(
                    f"cannot inherit book {book_dir.name} from {source_version}: missing _index.md or _inherit.md"
                )
            changes.append(
                PlannedChange(
                    "create_dir",
                    new_book_dir,
                    f"Create book directory {new_version}/{book_dir.name}",
                )
            )
            changes.append(
                PlannedChange(
                    "write_text",
                    new_book_dir / BRANCH_INHERIT,
                    f"Create book inheritance marker for {new_version}/{book_dir.name}",
                    self.empty_marker(new_book_dir / BRANCH_INHERIT),
                )
            )

            for section_dir in self.direct_child_dirs(book_dir):
                new_section_dir = new_book_dir / section_dir.name
                changes.append(
                    PlannedChange(
                        "create_dir",
                        new_section_dir,
                        f"Create section directory {new_version}/{book_dir.name}/{section_dir.name}",
                    )
                )

                if self.has_branch_marker(section_dir):
                    changes.append(
                        PlannedChange(
                            "write_text",
                            new_section_dir / BRANCH_INHERIT,
                            f"Create section inheritance marker for {new_version}/{book_dir.name}/{section_dir.name}",
                            self.empty_marker(new_section_dir / BRANCH_INHERIT),
                        )
                    )

                for page_dir in self.direct_child_dirs(section_dir):
                    if not self.has_page_marker(page_dir):
                        raise DocsEditorError(
                            "cannot inherit page "
                            f"{book_dir.name}/{section_dir.name}/{page_dir.name} from {source_version}: "
                            "missing index.md or inherit.md"
                        )
                    new_page_dir = new_section_dir / page_dir.name
                    changes.append(
                        PlannedChange(
                            "create_dir",
                            new_page_dir,
                            f"Create page directory {new_version}/{book_dir.name}/{section_dir.name}/{page_dir.name}",
                        )
                    )
                    changes.append(
                        PlannedChange(
                            "write_text",
                            new_page_dir / PAGE_INHERIT,
                            f"Create page inheritance marker for {new_version}/{book_dir.name}/{section_dir.name}/{page_dir.name}",
                            self.empty_marker(new_page_dir / PAGE_INHERIT),
                        )
                    )

        return changes

    def plan_version_create(
        self,
        new_version: str,
        *,
        after: str | None,
        latest: bool,
        label: str | None,
        status: str | None,
        visible: bool | None,
        searchable: bool | None,
        set_current: bool,
    ) -> OperationPlan:
        """Build a plan for version creation."""
        if bool(after) == bool(latest):
            raise DocsEditorError("provide exactly one of --after or --latest")

        if (
            self.version_root(new_version).exists()
            or self.nav_path(new_version).exists()
        ):
            raise DocsEditorError(f"docs version already exists on disk: {new_version}")

        document = self.load_versions_document()
        if any(entry.slug == new_version for entry in document.versions):
            raise DocsEditorError(
                f"docs version already exists in metadata: {new_version}"
            )

        bootstrap_first_version = False
        if after is not None:
            base_index = self.find_version_index(document.versions, after)
            insert_index = base_index + 1
            source_version = after
        else:
            if not document.versions:
                bootstrap_first_version = True
                insert_index = 0
                source_version = None
                existing_versions = self.existing_docs_versions_on_disk()
                if existing_versions:
                    raise DocsEditorError(
                        "cannot bootstrap first version while undeclared docs versions still exist on disk: "
                        + ", ".join(existing_versions)
                    )
            else:
                base_index = len(document.versions) - 1
                insert_index = len(document.versions)
                source_version = document.versions[base_index].slug

        source_nav_text: str | None = None
        if source_version is not None:
            source_nav_path = self.nav_path(source_version)
            if not source_nav_path.exists():
                raise DocsEditorError(
                    f"cannot inherit from {source_version}: nav file is missing"
                )

            if latest and (not self.version_root(source_version).exists()):
                raise DocsEditorError(
                    f"cannot append after latest version {source_version}: content directory is missing; use --after on an existing authored version"
                )

            source_nav_text = source_nav_path.read_text(encoding="utf-8")

        new_entry = VersionEntry(
            slug=new_version,
            label=label or new_version,
            visible=True if visible is None else visible,
            status=status,
            searchable=False if searchable is None else searchable,
        )
        updated_versions = list(document.versions)
        updated_versions.insert(insert_index, new_entry)
        updated_current = (
            new_version if set_current or bootstrap_first_version else document.current
        )

        updated_document = VersionsDocument(
            preamble=document.preamble,
            current=updated_current,
            versions=updated_versions,
        )

        changes = [
            PlannedChange(
                "write_text",
                self.paths.docs_versions_file,
                f"Update docs version metadata to include {new_version}",
                self.render_versions_document(updated_document),
            ),
        ]

        if bootstrap_first_version:
            changes.extend(
                [
                    PlannedChange(
                        "write_text",
                        self.nav_path(new_version),
                        f"Create nav file for initial version {new_version}",
                        self.render_nav_document(
                            {"books": [], "sections": {}, "pages": {}}
                        ),
                    ),
                    PlannedChange(
                        "create_dir",
                        self.version_root(new_version),
                        f"Create version directory {new_version}",
                    ),
                    PlannedChange(
                        "write_text",
                        self.version_root(new_version) / DOCS_ROOT_INDEX,
                        f"Create initial version landing content for {new_version}",
                        self.render_markdown_with_title(new_entry.label),
                    ),
                ]
            )
        else:
            changes.append(
                PlannedChange(
                    "write_text",
                    self.nav_path(new_version),
                    f"Create nav file for version {new_version}",
                    source_nav_text or "",
                )
            )
            changes.extend(
                self.build_inherited_version_tree_changes(source_version, new_version)
            )

        return OperationPlan(
            summary=(
                f"Create initial docs version {new_version}"
                if bootstrap_first_version
                else f"Create docs version {new_version} after {source_version} with inherited content"
            ),
            destructive=False,
            changes=changes,
            metadata={
                "entity": "version",
                "operation": "create",
                "new_version": new_version,
                "source_version": source_version,
                "bootstrap": bootstrap_first_version,
            },
        )

    def plan_version_delete(
        self, version: str, *, new_current: str | None
    ) -> OperationPlan:
        """Build a plan for version deletion."""
        document = self.load_versions_document()
        version_index = self.find_version_index(document.versions, version)

        updated_versions = list(document.versions)
        del updated_versions[version_index]

        updated_current = document.current
        if document.current == version:
            if new_current is None:
                raise DocsEditorError(
                    f"refusing to delete current version {version} without --new-current"
                )
            if new_current == version:
                raise DocsEditorError("--new-current must point to a different version")
            if not any(entry.slug == new_current for entry in updated_versions):
                raise DocsEditorError(
                    f"replacement current version does not exist after deletion: {new_current}"
                )
            updated_current = new_current
        elif new_current is not None:
            raise DocsEditorError(
                "--new-current is only valid when deleting the current version"
            )

        updated_document = VersionsDocument(
            preamble=document.preamble,
            current=updated_current,
            versions=updated_versions,
        )

        changes: list[PlannedChange] = [
            PlannedChange(
                "write_text",
                self.paths.docs_versions_file,
                f"Remove docs version metadata for {version}",
                self.render_versions_document(updated_document),
            )
        ]

        nav_path = self.nav_path(version)
        if nav_path.exists():
            changes.append(
                PlannedChange(
                    "delete_file",
                    nav_path,
                    f"Delete nav file for version {version}",
                )
            )

        version_root = self.version_root(version)
        if version_root.exists():
            changes.append(
                PlannedChange(
                    "delete_dir",
                    version_root,
                    f"Delete content tree for version {version}",
                )
            )

        return OperationPlan(
            summary=f"Delete docs version {version}",
            destructive=True,
            changes=changes,
            metadata={
                "entity": "version",
                "operation": "delete",
                "version": version,
            },
        )

    def plan_book_create(
        self,
        version: str,
        *,
        book: str,
        title: str | None,
        position: str | None,
        inherit: bool,
    ) -> OperationPlan:
        """Build a plan for book creation within one docs version."""
        if version not in self.version_slugs():
            raise DocsEditorError(f"unknown docs version: {version}")

        book_dir = self.book_root(version, book)
        if book_dir.exists():
            raise DocsEditorError(f"book folder already exists: {version}/{book}")

        nav_document = self.load_nav_document(version)
        updated_books = self.insert_at_position(nav_document["books"], book, position)
        updated_nav = {
            "books": updated_books,
            "sections": dict(nav_document.get("sections", {})),
            "pages": dict(nav_document.get("pages", {})),
        }

        changes: list[PlannedChange] = [
            PlannedChange(
                "write_text",
                self.nav_path(version),
                f"Add book {book} to nav for version {version}",
                self.render_nav_document(updated_nav),
            ),
            PlannedChange(
                "create_dir",
                book_dir,
                f"Create book directory {version}/{book}",
            ),
        ]

        if inherit:
            if not self.can_resolve_branch_inheritance(version, (book,)):
                raise DocsEditorError(
                    f"cannot create inherited book {version}/{book}: no earlier version resolves to _index.md"
                )
            changes.append(
                PlannedChange(
                    "write_text",
                    book_dir / BRANCH_INHERIT,
                    f"Create book inheritance marker for {version}/{book}",
                    self.empty_marker(book_dir / BRANCH_INHERIT),
                )
            )
        else:
            book_title = title or self.humanize_slug(book)
            changes.append(
                PlannedChange(
                    "write_text",
                    book_dir / DOCS_ROOT_INDEX,
                    f"Create book landing content for {version}/{book}",
                    self.render_markdown_with_title(book_title),
                )
            )

        return OperationPlan(
            summary=f"Create book {book} in docs version {version}",
            destructive=False,
            changes=changes,
            metadata={
                "entity": "book",
                "operation": "create",
                "version": version,
                "book": book,
            },
        )

    def plan_book_delete(self, version: str, *, book: str) -> OperationPlan:
        """Build a plan for deleting a book from one docs version."""
        if version not in self.version_slugs():
            raise DocsEditorError(f"unknown docs version: {version}")

        book_dir = self.book_root(version, book)
        if not book_dir.exists():
            raise DocsEditorError(f"book folder is missing: {version}/{book}")

        nav_document = self.load_nav_document(version)
        if book not in nav_document["books"]:
            raise DocsEditorError(f"book is not listed in nav: {version}/{book}")

        descendant_versions = self.deletable_book_descendants(version, book)

        changes: list[PlannedChange] = [
            PlannedChange(
                "write_text",
                self.nav_path(version),
                f"Remove book {book} from nav for version {version}",
                self.render_nav_document(self.remove_book_from_nav(nav_document, book)),
            ),
            PlannedChange(
                "delete_dir",
                book_dir,
                f"Delete book directory {version}/{book}",
            ),
        ]

        for later_version in descendant_versions:
            later_book_dir = self.book_root(later_version, book)
            later_nav = self.load_nav_document(later_version)
            if book in later_nav.get("books", []):
                changes.append(
                    PlannedChange(
                        "write_text",
                        self.nav_path(later_version),
                        f"Remove inherited-only descendant book {book} from nav for version {later_version}",
                        self.render_nav_document(
                            self.remove_book_from_nav(later_nav, book)
                        ),
                    )
                )
            changes.append(
                PlannedChange(
                    "delete_dir",
                    later_book_dir,
                    f"Delete inherited-only descendant book directory {later_version}/{book}",
                )
            )

        return OperationPlan(
            summary=f"Delete book {book} from docs version {version}",
            destructive=True,
            changes=changes,
            metadata={
                "entity": "book",
                "operation": "delete",
                "version": version,
                "book": book,
                "propagated_versions": descendant_versions,
            },
        )

    def plan_book_rename(
        self,
        version: str,
        *,
        old_book: str,
        new_book: str,
        title: str | None,
    ) -> OperationPlan:
        """Build a plan for renaming a book and propagating inherited-only descendants."""
        if version not in self.version_slugs():
            raise DocsEditorError(f"unknown docs version: {version}")

        old_book_dir = self.book_root(version, old_book)
        new_book_dir = self.book_root(version, new_book)
        if not old_book_dir.exists():
            raise DocsEditorError(f"book folder is missing: {version}/{old_book}")
        if new_book_dir.exists():
            raise DocsEditorError(
                f"destination book already exists: {version}/{new_book}"
            )

        nav_document = self.load_nav_document(version)
        updated_nav = self.rename_book_in_nav(nav_document, old_book, new_book)
        descendant_versions = self.inherited_only_book_descendants(
            version, old_book, new_book
        )

        changes: list[PlannedChange] = [
            PlannedChange(
                "write_text",
                self.nav_path(version),
                f"Rename book {old_book} to {new_book} in nav for version {version}",
                self.render_nav_document(updated_nav),
            ),
        ]
        changes.extend(
            self.build_materialized_book_tree_changes(
                version, old_book, new_book, title
            )
        )
        changes.append(
            PlannedChange(
                "delete_dir",
                old_book_dir,
                f"Delete old book directory {version}/{old_book} after rename materialization",
            )
        )

        for later_version in descendant_versions:
            later_old_book_dir = self.book_root(later_version, old_book)
            later_new_book_dir = self.book_root(later_version, new_book)
            later_nav = self.load_nav_document(later_version)
            later_updated_nav = later_nav
            if old_book in later_nav.get("books", []):
                later_updated_nav = self.rename_book_in_nav(
                    later_nav, old_book, new_book
                )
                changes.append(
                    PlannedChange(
                        "write_text",
                        self.nav_path(later_version),
                        f"Rename inherited-only descendant book {old_book} to {new_book} in nav for version {later_version}",
                        self.render_nav_document(later_updated_nav),
                    )
                )

            changes.append(
                PlannedChange(
                    "rename_path",
                    later_old_book_dir,
                    f"Rename inherited-only descendant book directory {later_version}/{old_book} to {new_book}",
                    target=later_new_book_dir,
                )
            )

        return OperationPlan(
            summary=f"Rename book {old_book} to {new_book} in docs version {version}",
            destructive=True,
            changes=changes,
            metadata={
                "entity": "book",
                "operation": "rename",
                "version": version,
                "book": old_book,
                "new_book": new_book,
                "propagated_versions": descendant_versions,
            },
        )

    def plan_section_create(
        self,
        version: str,
        *,
        book: str,
        section: str,
        title: str | None,
        position: str | None,
        inherit: bool,
        structural_only: bool,
    ) -> OperationPlan:
        """Build a plan for creating a section within one docs book."""
        if inherit and structural_only:
            raise DocsEditorError("--inherit and --structural-only cannot be combined")
        if version not in self.version_slugs():
            raise DocsEditorError(f"unknown docs version: {version}")

        book_dir = self.book_root(version, book)
        if not book_dir.exists():
            raise DocsEditorError(f"book folder is missing: {version}/{book}")

        section_dir = self.section_root(version, book, section)
        if section_dir.exists():
            raise DocsEditorError(
                f"section folder already exists: {version}/{book}/{section}"
            )

        nav_document = self.load_nav_document(version)
        if book not in nav_document["books"]:
            raise DocsEditorError(f"book is not listed in nav: {version}/{book}")

        section_title = title or self.humanize_slug(section)
        existing_sections = nav_document.get("sections", {}).get(book, [])
        updated_sections = dict(nav_document.get("sections", {}))
        updated_sections[book] = self.insert_section_entry_at_position(
            existing_sections,
            {"slug": section, "title": section_title},
            position,
        )

        updated_pages = {
            book_slug: dict(book_pages)
            for book_slug, book_pages in nav_document.get("pages", {}).items()
        }
        book_pages = updated_pages.setdefault(book, {})
        if section in book_pages:
            raise DocsEditorError(
                f"section pages already exist in nav: {book}/{section}"
            )
        book_pages[section] = []

        updated_nav = {
            "books": list(nav_document["books"]),
            "sections": updated_sections,
            "pages": updated_pages,
        }

        changes: list[PlannedChange] = [
            PlannedChange(
                "write_text",
                self.nav_path(version),
                f"Add section {book}/{section} to nav for version {version}",
                self.render_nav_document(updated_nav),
            ),
            PlannedChange(
                "create_dir",
                section_dir,
                f"Create section directory {version}/{book}/{section}",
            ),
        ]

        if structural_only:
            pass
        elif inherit:
            if not self.can_resolve_branch_inheritance(version, (book, section)):
                raise DocsEditorError(
                    f"cannot create inherited section {version}/{book}/{section}: no earlier version resolves to _index.md"
                )
            changes.append(
                PlannedChange(
                    "write_text",
                    section_dir / BRANCH_INHERIT,
                    f"Create section inheritance marker for {version}/{book}/{section}",
                    self.empty_marker(section_dir / BRANCH_INHERIT),
                )
            )
        else:
            changes.append(
                PlannedChange(
                    "write_text",
                    section_dir / DOCS_ROOT_INDEX,
                    f"Create section landing content for {version}/{book}/{section}",
                    self.render_markdown_with_title(section_title),
                )
            )

        return OperationPlan(
            summary=f"Create section {book}/{section} in docs version {version}",
            destructive=False,
            changes=changes,
            metadata={
                "entity": "section",
                "operation": "create",
                "version": version,
                "book": book,
                "section": section,
                "structural_only": structural_only,
            },
        )

    def plan_section_delete(
        self, version: str, *, book: str, section: str
    ) -> OperationPlan:
        """Build a plan for deleting a section from one docs book."""
        if version not in self.version_slugs():
            raise DocsEditorError(f"unknown docs version: {version}")

        section_dir = self.section_root(version, book, section)
        if not section_dir.exists():
            raise DocsEditorError(
                f"section folder is missing: {version}/{book}/{section}"
            )

        nav_document = self.load_nav_document(version)
        sections = nav_document.get("sections", {}).get(book, [])
        if not any(entry["slug"] == section for entry in sections):
            raise DocsEditorError(
                f"section is not listed in nav: {version}/{book}/{section}"
            )

        descendant_versions = self.deletable_section_descendants(version, book, section)

        changes: list[PlannedChange] = [
            PlannedChange(
                "write_text",
                self.nav_path(version),
                f"Remove section {book}/{section} from nav for version {version}",
                self.render_nav_document(
                    self.remove_section_from_nav(nav_document, book, section)
                ),
            ),
            PlannedChange(
                "delete_dir",
                section_dir,
                f"Delete section directory {version}/{book}/{section}",
            ),
        ]

        for later_version in descendant_versions:
            later_section_dir = self.section_root(later_version, book, section)
            later_nav = self.load_nav_document(later_version)
            later_sections = later_nav.get("sections", {}).get(book, [])
            if any(entry["slug"] == section for entry in later_sections):
                changes.append(
                    PlannedChange(
                        "write_text",
                        self.nav_path(later_version),
                        f"Remove inherited-only descendant section {book}/{section} from nav for version {later_version}",
                        self.render_nav_document(
                            self.remove_section_from_nav(later_nav, book, section)
                        ),
                    )
                )
            changes.append(
                PlannedChange(
                    "delete_dir",
                    later_section_dir,
                    f"Delete inherited-only descendant section directory {later_version}/{book}/{section}",
                )
            )

        return OperationPlan(
            summary=f"Delete section {book}/{section} from docs version {version}",
            destructive=True,
            changes=changes,
            metadata={
                "entity": "section",
                "operation": "delete",
                "version": version,
                "book": book,
                "section": section,
                "propagated_versions": descendant_versions,
            },
        )

    def plan_section_rename(
        self,
        version: str,
        *,
        book: str,
        old_section: str,
        new_section: str,
        title: str | None,
    ) -> OperationPlan:
        """Build a plan for renaming a section and propagating inherited-only descendants."""
        if version not in self.version_slugs():
            raise DocsEditorError(f"unknown docs version: {version}")

        old_section_dir = self.section_root(version, book, old_section)
        new_section_dir = self.section_root(version, book, new_section)
        if not old_section_dir.exists():
            raise DocsEditorError(
                f"section folder is missing: {version}/{book}/{old_section}"
            )
        if new_section_dir.exists():
            raise DocsEditorError(
                f"destination section already exists: {version}/{book}/{new_section}"
            )

        nav_document = self.load_nav_document(version)
        updated_nav = self.rename_section_in_nav(
            nav_document, book, old_section, new_section, title
        )
        descendant_versions = self.inherited_only_section_descendants(
            version, book, old_section, new_section
        )

        changes: list[PlannedChange] = [
            PlannedChange(
                "write_text",
                self.nav_path(version),
                f"Rename section {book}/{old_section} to {new_section} in nav for version {version}",
                self.render_nav_document(updated_nav),
            )
        ]
        changes.extend(
            self.build_materialized_section_tree_changes(
                version, book, old_section, new_section, title
            )
        )
        changes.append(
            PlannedChange(
                "delete_dir",
                old_section_dir,
                f"Delete old section directory {version}/{book}/{old_section} after rename materialization",
            )
        )

        for later_version in descendant_versions:
            later_old_section_dir = self.section_root(later_version, book, old_section)
            later_new_section_dir = self.section_root(later_version, book, new_section)
            later_nav = self.load_nav_document(later_version)
            later_updated_nav = later_nav
            later_sections = later_nav.get("sections", {}).get(book, [])
            if any(entry["slug"] == old_section for entry in later_sections):
                later_updated_nav = self.rename_section_in_nav(
                    later_nav, book, old_section, new_section, title
                )
                changes.append(
                    PlannedChange(
                        "write_text",
                        self.nav_path(later_version),
                        f"Rename inherited-only descendant section {book}/{old_section} to {new_section} in nav for version {later_version}",
                        self.render_nav_document(later_updated_nav),
                    )
                )

            changes.append(
                PlannedChange(
                    "rename_path",
                    later_old_section_dir,
                    f"Rename inherited-only descendant section directory {later_version}/{book}/{old_section} to {new_section}",
                    target=later_new_section_dir,
                )
            )

        return OperationPlan(
            summary=f"Rename section {book}/{old_section} to {new_section} in docs version {version}",
            destructive=True,
            changes=changes,
            metadata={
                "entity": "section",
                "operation": "rename",
                "version": version,
                "book": book,
                "section": old_section,
                "new_section": new_section,
                "propagated_versions": descendant_versions,
            },
        )

    def plan_page_create(
        self,
        version: str,
        *,
        book: str,
        section: str,
        page: str,
        title: str | None,
        position: str | None,
        inherit: bool,
    ) -> OperationPlan:
        """Build a plan for creating a page within one docs section."""
        if version not in self.version_slugs():
            raise DocsEditorError(f"unknown docs version: {version}")

        section_dir = self.section_root(version, book, section)
        if not section_dir.exists():
            raise DocsEditorError(
                f"section folder is missing: {version}/{book}/{section}"
            )

        page_dir = self.page_root(version, book, section, page)
        if page_dir.exists():
            raise DocsEditorError(
                f"page folder already exists: {version}/{book}/{section}/{page}"
            )

        nav_document = self.load_nav_document(version)
        if book not in nav_document["books"]:
            raise DocsEditorError(f"book is not listed in nav: {version}/{book}")
        section_entries = nav_document.get("sections", {}).get(book, [])
        if not any(entry["slug"] == section for entry in section_entries):
            raise DocsEditorError(
                f"section is not listed in nav: {version}/{book}/{section}"
            )

        updated_pages = {
            book_slug: dict(book_pages)
            for book_slug, book_pages in nav_document.get("pages", {}).items()
        }
        book_pages = updated_pages.setdefault(book, {})
        existing_pages = list(book_pages.get(section, []))
        updated_page_items = self.insert_at_position(existing_pages, page, position)
        book_pages[section] = updated_page_items

        updated_nav = {
            "books": list(nav_document["books"]),
            "sections": dict(nav_document.get("sections", {})),
            "pages": updated_pages,
        }

        changes: list[PlannedChange] = [
            PlannedChange(
                "write_text",
                self.nav_path(version),
                f"Add page {book}/{section}/{page} to nav for version {version}",
                self.render_nav_document(updated_nav),
            ),
            PlannedChange(
                "create_dir",
                page_dir,
                f"Create page directory {version}/{book}/{section}/{page}",
            ),
        ]

        if inherit:
            if not self.can_resolve_page_inheritance(version, (book, section, page)):
                raise DocsEditorError(
                    f"cannot create inherited page {version}/{book}/{section}/{page}: no earlier version resolves to index.md"
                )
            changes.append(
                PlannedChange(
                    "write_text",
                    page_dir / PAGE_INHERIT,
                    f"Create page inheritance marker for {version}/{book}/{section}/{page}",
                    self.empty_marker(page_dir / PAGE_INHERIT),
                )
            )
        else:
            page_title = title or self.humanize_slug(page)
            changes.append(
                PlannedChange(
                    "write_text",
                    page_dir / PAGE_INDEX,
                    f"Create page content for {version}/{book}/{section}/{page}",
                    self.render_markdown_with_title(page_title),
                )
            )

        return OperationPlan(
            summary=f"Create page {book}/{section}/{page} in docs version {version}",
            destructive=False,
            changes=changes,
            metadata={
                "entity": "page",
                "operation": "create",
                "version": version,
                "book": book,
                "section": section,
                "page": page,
            },
        )

    def plan_page_delete(
        self, version: str, *, book: str, section: str, page: str
    ) -> OperationPlan:
        """Build a plan for deleting a page from one docs section."""
        if version not in self.version_slugs():
            raise DocsEditorError(f"unknown docs version: {version}")

        page_dir = self.page_root(version, book, section, page)
        if not page_dir.exists():
            raise DocsEditorError(
                f"page folder is missing: {version}/{book}/{section}/{page}"
            )

        nav_document = self.load_nav_document(version)
        section_pages = nav_document.get("pages", {}).get(book, {}).get(section, [])
        if page not in section_pages:
            raise DocsEditorError(
                f"page is not listed in nav: {version}/{book}/{section}/{page}"
            )

        descendant_versions = self.deletable_page_descendants(
            version, book, section, page
        )

        changes: list[PlannedChange] = [
            PlannedChange(
                "write_text",
                self.nav_path(version),
                f"Remove page {book}/{section}/{page} from nav for version {version}",
                self.render_nav_document(
                    self.remove_page_from_nav(nav_document, book, section, page)
                ),
            ),
            PlannedChange(
                "delete_dir",
                page_dir,
                f"Delete page directory {version}/{book}/{section}/{page}",
            ),
        ]

        for later_version in descendant_versions:
            later_page_dir = self.page_root(later_version, book, section, page)
            later_nav = self.load_nav_document(later_version)
            later_pages = later_nav.get("pages", {}).get(book, {}).get(section, [])
            if page in later_pages:
                changes.append(
                    PlannedChange(
                        "write_text",
                        self.nav_path(later_version),
                        f"Remove inherited-only descendant page {book}/{section}/{page} from nav for version {later_version}",
                        self.render_nav_document(
                            self.remove_page_from_nav(later_nav, book, section, page)
                        ),
                    )
                )
            changes.append(
                PlannedChange(
                    "delete_dir",
                    later_page_dir,
                    f"Delete inherited-only descendant page directory {later_version}/{book}/{section}/{page}",
                )
            )

        return OperationPlan(
            summary=f"Delete page {book}/{section}/{page} from docs version {version}",
            destructive=True,
            changes=changes,
            metadata={
                "entity": "page",
                "operation": "delete",
                "version": version,
                "book": book,
                "section": section,
                "page": page,
                "propagated_versions": descendant_versions,
            },
        )

    def plan_page_rename(
        self,
        version: str,
        *,
        book: str,
        section: str,
        old_page: str,
        new_page: str,
        title: str | None,
    ) -> OperationPlan:
        """Build a plan for renaming a page and propagating inherited-only descendants."""
        if version not in self.version_slugs():
            raise DocsEditorError(f"unknown docs version: {version}")

        old_page_dir = self.page_root(version, book, section, old_page)
        new_page_dir = self.page_root(version, book, section, new_page)
        if not old_page_dir.exists():
            raise DocsEditorError(
                f"page folder is missing: {version}/{book}/{section}/{old_page}"
            )
        if new_page_dir.exists():
            raise DocsEditorError(
                f"destination page already exists: {version}/{book}/{section}/{new_page}"
            )

        nav_document = self.load_nav_document(version)
        updated_nav = self.rename_page_in_nav(
            nav_document, book, section, old_page, new_page
        )
        descendant_versions = self.inherited_only_page_descendants(
            version, book, section, old_page, new_page
        )

        changes: list[PlannedChange] = [
            PlannedChange(
                "write_text",
                self.nav_path(version),
                f"Rename page {book}/{section}/{old_page} to {new_page} in nav for version {version}",
                self.render_nav_document(updated_nav),
            )
        ]
        changes.extend(
            self.build_materialized_page_changes(
                version, book, section, old_page, new_page, title
            )
        )
        changes.append(
            PlannedChange(
                "delete_dir",
                old_page_dir,
                f"Delete old page directory {version}/{book}/{section}/{old_page} after rename materialization",
            )
        )

        for later_version in descendant_versions:
            later_old_page_dir = self.page_root(later_version, book, section, old_page)
            later_new_page_dir = self.page_root(later_version, book, section, new_page)
            later_nav = self.load_nav_document(later_version)
            later_pages = later_nav.get("pages", {}).get(book, {}).get(section, [])
            if old_page in later_pages:
                changes.append(
                    PlannedChange(
                        "write_text",
                        self.nav_path(later_version),
                        f"Rename inherited-only descendant page {book}/{section}/{old_page} to {new_page} in nav for version {later_version}",
                        self.render_nav_document(
                            self.rename_page_in_nav(
                                later_nav, book, section, old_page, new_page
                            )
                        ),
                    )
                )
            changes.append(
                PlannedChange(
                    "rename_path",
                    later_old_page_dir,
                    f"Rename inherited-only descendant page directory {later_version}/{book}/{section}/{old_page} to {new_page}",
                    target=later_new_page_dir,
                )
            )

        return OperationPlan(
            summary=f"Rename page {book}/{section}/{old_page} to {new_page} in docs version {version}",
            destructive=True,
            changes=changes,
            metadata={
                "entity": "page",
                "operation": "rename",
                "version": version,
                "book": book,
                "section": section,
                "page": old_page,
                "new_page": new_page,
                "propagated_versions": descendant_versions,
            },
        )

    def validate(self) -> list[Any]:
        """Run the existing docs validator against this editor's website root."""
        spec = importlib.util.spec_from_file_location(
            "docs_validator", self.paths.validator_script
        )
        if spec is None or spec.loader is None:
            raise DocsEditorError("unable to load validate-docs-content.py")

        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        module.WEBSITE_DIR = self.paths.website_dir
        module.DOCS_CONTENT_DIR = self.paths.docs_content_dir
        module.DOCS_NAV_DIR = self.paths.docs_nav_dir
        module.DOCS_VERSIONS_FILE = self.paths.docs_versions_file
        return module.validate_all()

    def format_validation_issues(self, issues: list[Any]) -> list[str]:
        """Convert validator issue objects into strings."""
        formatted: list[str] = []
        for issue in issues:
            if hasattr(issue, "format"):
                formatted.append(issue.format())
            else:
                formatted.append(str(issue))
        return formatted

    def atomic_write(self, path: Path, content: str) -> None:
        """Write file contents atomically."""
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, delete=False
        ) as temp_file:
            temp_file.write(content)
            temp_path = Path(temp_file.name)
        os.replace(temp_path, path)

    def apply_plan(self, plan: OperationPlan) -> None:
        """Apply a computed plan and roll back on validation failure."""
        backup_dir = Path(tempfile.mkdtemp(prefix="docs-editor-backup-"))
        created_paths: list[Path] = []
        backups: dict[Path, tuple[Path, bool]] = {}

        def backup_path(target: Path, is_dir: bool) -> Path:
            safe_name = (
                target.relative_to(self.paths.website_dir).as_posix().replace("/", "__")
            )
            suffix = "__dir" if is_dir else "__file"
            return backup_dir / f"{len(backups):04d}_{safe_name}{suffix}"

        def ensure_backup(target: Path) -> None:
            if target in backups or not target.exists():
                return
            is_dir = target.is_dir()
            destination = backup_path(target, is_dir)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if is_dir:
                shutil.copytree(target, destination)
            else:
                shutil.copy2(target, destination)
            backups[target] = (destination, is_dir)

        try:
            for change in plan.changes:
                if change.action == "create_dir":
                    if not change.path.exists():
                        change.path.mkdir(parents=True, exist_ok=True)
                        created_paths.append(change.path)
                elif change.action == "write_text":
                    if change.path.exists():
                        ensure_backup(change.path)
                    else:
                        created_paths.append(change.path)
                    self.atomic_write(change.path, change.content or "")
                elif change.action == "delete_file":
                    if change.path.exists():
                        ensure_backup(change.path)
                        change.path.unlink()
                elif change.action == "delete_dir":
                    if change.path.exists():
                        ensure_backup(change.path)
                        shutil.rmtree(change.path)
                elif change.action == "rename_path":
                    if change.target is None:
                        raise DocsEditorError(
                            "rename_path changes require a target path"
                        )
                    if not change.path.exists():
                        raise DocsEditorError(
                            f"cannot rename missing path: {change.path}"
                        )
                    if change.target.exists():
                        raise DocsEditorError(
                            f"cannot rename into existing path: {change.target}"
                        )
                    ensure_backup(change.path)
                    created_paths.append(change.target)
                    change.target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(change.path, change.target)
                else:
                    raise DocsEditorError(f"unsupported change action: {change.action}")

            issues = self.validate()
            if issues:
                raise DocsEditorError(
                    "validation failed after applying changes:\n- "
                    + "\n- ".join(self.format_validation_issues(issues))
                )
        except Exception:
            for created_path in sorted(
                created_paths,
                key=lambda path: len(path.relative_to(self.paths.website_dir).parts),
                reverse=True,
            ):
                if created_path.is_dir():
                    shutil.rmtree(created_path, ignore_errors=True)
                else:
                    created_path.unlink(missing_ok=True)

            for target, (backup, is_dir) in reversed(list(backups.items())):
                if target.exists():
                    if target.is_dir():
                        shutil.rmtree(target)
                    else:
                        target.unlink()
                target.parent.mkdir(parents=True, exist_ok=True)
                if is_dir:
                    shutil.copytree(backup, target)
                else:
                    shutil.copy2(backup, target)
            raise
        finally:
            shutil.rmtree(backup_dir, ignore_errors=True)

    def plan_to_dict(self, plan: OperationPlan) -> dict[str, Any]:
        """Return a machine-readable representation of an operation plan."""
        return {
            "summary": plan.summary,
            "destructive": plan.destructive,
            "metadata": plan.metadata,
            "changes": [
                {
                    "action": change.action,
                    "path": change.display_path(self.paths.website_dir),
                    "description": change.description,
                    "target": (
                        change.target
                        and change.target.relative_to(self.paths.website_dir).as_posix()
                    ),
                }
                for change in plan.changes
            ],
        }

    def render_preview(self, plan: OperationPlan) -> str:
        """Render a human-readable plan preview."""
        lines = [plan.summary, ""]
        for change in plan.changes:
            rendered_path = change.display_path(self.paths.website_dir)
            if change.target is not None:
                rendered_path = (
                    f"{rendered_path} -> "
                    f"{change.target.relative_to(self.paths.website_dir).as_posix()}"
                )
            lines.append(f"- {change.action}: {rendered_path} ({change.description})")
        lines.append("")
        lines.append("Run again with --apply to write these changes.")
        return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        description="Safe editor tooling for the Sambee docs tree."
    )
    parser.add_argument("--apply", action="store_true", help="write changes to disk")
    parser.add_argument(
        "--yes", action="store_true", help="skip destructive confirmation prompts"
    )
    parser.add_argument("--json", action="store_true", help="emit JSON output")
    parser.add_argument("--quiet", action="store_true", help="reduce non-error output")
    parser.add_argument(
        "--verbose", action="store_true", help="reserved for detailed future output"
    )

    entities = parser.add_subparsers(dest="entity", required=True)
    version_parser = entities.add_parser("version", help="manage docs versions")
    version_commands = version_parser.add_subparsers(dest="operation", required=True)
    book_parser = entities.add_parser("book", help="manage docs books")
    book_commands = book_parser.add_subparsers(dest="operation", required=True)
    section_parser = entities.add_parser("section", help="manage docs sections")
    section_commands = section_parser.add_subparsers(dest="operation", required=True)
    page_parser = entities.add_parser("page", help="manage docs pages")
    page_commands = page_parser.add_subparsers(dest="operation", required=True)

    create_parser = version_commands.add_parser("create", help="create a docs version")
    create_parser.add_argument("version", help="new version slug")
    insert_group = create_parser.add_mutually_exclusive_group(required=True)
    insert_group.add_argument(
        "--after", help="insert the new version after an existing version"
    )
    insert_group.add_argument(
        "--latest", action="store_true", help="append after the latest declared version"
    )
    create_parser.add_argument("--label", help="UI label for the new version")
    create_parser.add_argument("--status", help="status string for the new version")
    create_parser.add_argument(
        "--visible",
        type=parse_bool,
        help="whether the new version is visible in UI selectors",
    )
    create_parser.add_argument(
        "--searchable",
        type=parse_bool,
        help="whether the new version is indexed for docs search",
    )
    create_parser.add_argument(
        "--set-current", action="store_true", help="set the new version as current"
    )

    delete_parser = version_commands.add_parser("delete", help="delete a docs version")
    delete_parser.add_argument("version", help="version slug to delete")
    delete_parser.add_argument(
        "--new-current",
        help="replacement current version when deleting the current one",
    )

    book_create_parser = book_commands.add_parser("create", help="create a docs book")
    book_create_parser.add_argument(
        "--version", required=True, help="docs version slug"
    )
    book_create_parser.add_argument("--book", required=True, help="book slug")
    book_create_parser.add_argument("--title", help="book landing-page title")
    book_create_parser.add_argument(
        "--position",
        help="insert position: start, end, before:<slug>, after:<slug>, or a zero-based index",
    )
    book_create_parser.add_argument(
        "--inherit",
        action="store_true",
        help="create an inherited book marker instead of real landing content",
    )

    book_delete_parser = book_commands.add_parser("delete", help="delete a docs book")
    book_delete_parser.add_argument(
        "--version", required=True, help="docs version slug"
    )
    book_delete_parser.add_argument("--book", required=True, help="book slug")

    book_rename_parser = book_commands.add_parser("rename", help="rename a docs book")
    book_rename_parser.add_argument(
        "--version", required=True, help="docs version slug"
    )
    book_rename_parser.add_argument(
        "--from", dest="from_book", required=True, help="existing book slug"
    )
    book_rename_parser.add_argument(
        "--to", dest="to_book", required=True, help="new book slug"
    )
    book_rename_parser.add_argument(
        "--title",
        help="new book landing-page title for real content in the target version",
    )

    section_create_parser = section_commands.add_parser(
        "create", help="create a docs section"
    )
    section_create_parser.add_argument(
        "--version", required=True, help="docs version slug"
    )
    section_create_parser.add_argument("--book", required=True, help="book slug")
    section_create_parser.add_argument("--section", required=True, help="section slug")
    section_create_parser.add_argument("--title", help="displayed section title")
    section_create_parser.add_argument(
        "--position",
        help="insert position: start, end, before:<slug>, after:<slug>, or a zero-based index",
    )
    section_create_parser.add_argument(
        "--inherit",
        action="store_true",
        help="create an inherited section marker instead of real landing content",
    )
    section_create_parser.add_argument(
        "--structural-only",
        action="store_true",
        help="create only the section directory and nav entry, without landing content files",
    )

    section_delete_parser = section_commands.add_parser(
        "delete", help="delete a docs section"
    )
    section_delete_parser.add_argument(
        "--version", required=True, help="docs version slug"
    )
    section_delete_parser.add_argument("--book", required=True, help="book slug")
    section_delete_parser.add_argument("--section", required=True, help="section slug")

    section_rename_parser = section_commands.add_parser(
        "rename", help="rename a docs section"
    )
    section_rename_parser.add_argument(
        "--version", required=True, help="docs version slug"
    )
    section_rename_parser.add_argument("--book", required=True, help="book slug")
    section_rename_parser.add_argument(
        "--from", dest="from_section", required=True, help="existing section slug"
    )
    section_rename_parser.add_argument(
        "--to", dest="to_section", required=True, help="new section slug"
    )
    section_rename_parser.add_argument(
        "--title",
        help="new displayed section title and section landing-page title for real content in the target version",
    )

    page_create_parser = page_commands.add_parser("create", help="create a docs page")
    page_create_parser.add_argument(
        "--version", required=True, help="docs version slug"
    )
    page_create_parser.add_argument("--book", required=True, help="book slug")
    page_create_parser.add_argument("--section", required=True, help="section slug")
    page_create_parser.add_argument("--page", required=True, help="page slug")
    page_create_parser.add_argument("--title", help="page title")
    page_create_parser.add_argument(
        "--position",
        help="insert position: start, end, before:<slug>, after:<slug>, or a zero-based index",
    )
    page_create_parser.add_argument(
        "--inherit",
        action="store_true",
        help="create an inherited page marker instead of real page content",
    )

    page_delete_parser = page_commands.add_parser("delete", help="delete a docs page")
    page_delete_parser.add_argument(
        "--version", required=True, help="docs version slug"
    )
    page_delete_parser.add_argument("--book", required=True, help="book slug")
    page_delete_parser.add_argument("--section", required=True, help="section slug")
    page_delete_parser.add_argument("--page", required=True, help="page slug")

    page_rename_parser = page_commands.add_parser("rename", help="rename a docs page")
    page_rename_parser.add_argument(
        "--version", required=True, help="docs version slug"
    )
    page_rename_parser.add_argument("--book", required=True, help="book slug")
    page_rename_parser.add_argument("--section", required=True, help="section slug")
    page_rename_parser.add_argument(
        "--from", dest="from_page", required=True, help="existing page slug"
    )
    page_rename_parser.add_argument(
        "--to", dest="to_page", required=True, help="new page slug"
    )
    page_rename_parser.add_argument(
        "--title",
        help="new page title for real content in the target version",
    )

    return parser


def maybe_confirm(plan: OperationPlan, yes: bool) -> None:
    """Prompt for confirmation before destructive apply operations."""
    if not plan.destructive or yes:
        return
    if not os.isatty(0):
        raise DocsEditorError(
            "destructive apply operations require --yes in non-interactive mode"
        )

    response = input(f"{plan.summary}\nProceed? [y/N] ").strip().lower()
    if response not in {"y", "yes"}:
        raise DocsEditorError("operation cancelled")


def execute(args: argparse.Namespace) -> int:
    """Execute one CLI request."""
    editor = DocsEditor()

    if args.entity == "version":
        if args.operation == "create":
            plan = editor.plan_version_create(
                args.version,
                after=args.after,
                latest=args.latest,
                label=args.label,
                status=args.status,
                visible=args.visible,
                searchable=args.searchable,
                set_current=args.set_current,
            )
        elif args.operation == "delete":
            plan = editor.plan_version_delete(
                args.version, new_current=args.new_current
            )
        else:
            raise DocsEditorError(f"unsupported version operation: {args.operation}")
    elif args.entity == "book":
        if args.operation == "create":
            plan = editor.plan_book_create(
                args.version,
                book=args.book,
                title=args.title,
                position=args.position,
                inherit=args.inherit,
            )
        elif args.operation == "delete":
            plan = editor.plan_book_delete(args.version, book=args.book)
        elif args.operation == "rename":
            plan = editor.plan_book_rename(
                args.version,
                old_book=args.from_book,
                new_book=args.to_book,
                title=args.title,
            )
        else:
            raise DocsEditorError(f"unsupported book operation: {args.operation}")
    elif args.entity == "section":
        if args.operation == "create":
            plan = editor.plan_section_create(
                args.version,
                book=args.book,
                section=args.section,
                title=args.title,
                position=args.position,
                inherit=args.inherit,
                structural_only=args.structural_only,
            )
        elif args.operation == "delete":
            plan = editor.plan_section_delete(
                args.version, book=args.book, section=args.section
            )
        elif args.operation == "rename":
            plan = editor.plan_section_rename(
                args.version,
                book=args.book,
                old_section=args.from_section,
                new_section=args.to_section,
                title=args.title,
            )
        else:
            raise DocsEditorError(f"unsupported section operation: {args.operation}")
    elif args.entity == "page":
        if args.operation == "create":
            plan = editor.plan_page_create(
                args.version,
                book=args.book,
                section=args.section,
                page=args.page,
                title=args.title,
                position=args.position,
                inherit=args.inherit,
            )
        elif args.operation == "delete":
            plan = editor.plan_page_delete(
                args.version,
                book=args.book,
                section=args.section,
                page=args.page,
            )
        elif args.operation == "rename":
            plan = editor.plan_page_rename(
                args.version,
                book=args.book,
                section=args.section,
                old_page=args.from_page,
                new_page=args.to_page,
                title=args.title,
            )
        else:
            raise DocsEditorError(f"unsupported page operation: {args.operation}")
    else:
        raise DocsEditorError(f"{args.entity} operations are not implemented yet")

    if args.json:
        payload = editor.plan_to_dict(plan)
        payload["apply"] = args.apply
        if args.apply:
            maybe_confirm(plan, args.yes)
            editor.apply_plan(plan)
            payload["result"] = "applied"
        else:
            payload["result"] = "preview"
        print(json.dumps(payload, indent=2))
        return 0

    if not args.apply:
        if not args.quiet:
            print(editor.render_preview(plan))
        return 0

    maybe_confirm(plan, args.yes)
    editor.apply_plan(plan)
    if not args.quiet:
        print(f"Applied: {plan.summary}")
    return 0


def main() -> int:
    """CLI entry point."""
    parser = build_parser()
    args = parser.parse_args()
    try:
        return execute(args)
    except DocsEditorError as error:
        parser.exit(1, f"docs-editor: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
