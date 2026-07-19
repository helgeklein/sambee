"""Direct tests for docs filesystem validation invariants."""

from __future__ import annotations

import importlib.util
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

WEBSITE_DIR = Path(__file__).resolve().parent.parent
VALIDATOR_PATH = WEBSITE_DIR / "scripts" / "validate-docs-content.py"


def load_validator_module():
    """Load the docs validator module from the workspace."""
    spec = importlib.util.spec_from_file_location(
        "validate_docs_content", VALIDATOR_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load validate-docs-content.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


VALIDATOR = load_validator_module()


class DocsValidatorTests(unittest.TestCase):
    """Exercise docs validation against intentionally broken filesystem fixtures."""

    def build_temp_website(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        """Create a temporary copy of the website docs inputs for validation tests."""
        tempdir = tempfile.TemporaryDirectory()
        root = Path(tempdir.name)
        shutil.copytree(WEBSITE_DIR / "content" / "docs", root / "content" / "docs")
        shutil.copytree(WEBSITE_DIR / "data" / "docs-nav", root / "data" / "docs-nav")
        shutil.copy2(
            WEBSITE_DIR / "data" / "docs-versions.toml",
            root / "data" / "docs-versions.toml",
        )
        return tempdir, root

    def validate(self, root: Path) -> list[str]:
        """Run the validator against one temporary website root and format issues."""
        VALIDATOR.WEBSITE_DIR = root
        VALIDATOR.DOCS_CONTENT_DIR = root / "content" / "docs"
        VALIDATOR.DOCS_NAV_DIR = root / "data" / "docs-nav"
        VALIDATOR.DOCS_VERSIONS_FILE = root / "data" / "docs-versions.toml"
        return [issue.format() for issue in VALIDATOR.validate_all()]

    def find_inherited_page(self, root: Path, version: str) -> tuple[str, str, str]:
        """Return one inherited page path under a given version."""
        version_root = root / "content" / "docs" / version
        for marker in sorted(version_root.rglob(VALIDATOR.INHERIT_FILE)):
            relative = marker.relative_to(version_root)
            if len(relative.parts) == 4:
                book, section, page, _ = relative.parts
                return book, section, page
        raise AssertionError(f"no inherited page found under docs version {version}")

    def test_validate_all_passes_on_current_fixture(self) -> None:
        """The checked-in website docs tree should satisfy the validator."""
        tempdir, root = self.build_temp_website()
        self.addCleanup(tempdir.cleanup)

        self.assertEqual(self.validate(root), [])

    def test_validate_all_reports_orphan_page_folder(self) -> None:
        """A page directory on disk that is not listed in nav should fail validation."""
        tempdir, root = self.build_temp_website()
        self.addCleanup(tempdir.cleanup)

        orphan_dir = (
            root
            / "content"
            / "docs"
            / "0.7"
            / "website-dev-guide"
            / "authoring-and-tooling"
            / "orphan-page"
        )
        orphan_dir.mkdir(parents=True)
        (orphan_dir / "index.md").write_text(
            '+++\ntitle = "Orphan"\n+++\n', encoding="utf-8"
        )

        issues = self.validate(root)

        self.assertTrue(
            any(
                "orphan-page: page folder exists on disk but is not listed in nav"
                in issue
                for issue in issues
            ),
            msg="expected orphan page issue",
        )

    def test_validate_all_reports_undeclared_content_version_directory(self) -> None:
        """A content version directory without matching version metadata should fail validation."""
        tempdir, root = self.build_temp_website()
        self.addCleanup(tempdir.cleanup)

        extra_version = root / "content" / "docs" / "9.9"
        extra_version.mkdir(parents=True)
        (extra_version / "_index.md").write_text(
            '+++\ntitle = "9.9"\n+++\n', encoding="utf-8"
        )

        issues = self.validate(root)

        self.assertTrue(
            any(
                "content/docs/9.9: content directory exists for undeclared docs version"
                in issue
                for issue in issues
            ),
            msg="expected undeclared version directory issue",
        )

    def test_validate_all_reports_missing_declared_nav_file(self) -> None:
        """A declared version without its nav file should fail validation."""
        tempdir, root = self.build_temp_website()
        self.addCleanup(tempdir.cleanup)

        (root / "data" / "docs-nav" / "0.8.toml").unlink()

        issues = self.validate(root)

        self.assertTrue(
            any(
                "data/docs-nav/0.8.toml: declared docs version is missing its nav file"
                in issue
                for issue in issues
            ),
            msg="expected missing declared nav file issue",
        )

    def test_validate_all_reports_nav_pages_for_undeclared_section(self) -> None:
        """A pages table for an undeclared section should fail validation."""
        tempdir, root = self.build_temp_website()
        self.addCleanup(tempdir.cleanup)

        nav_path = root / "data" / "docs-nav" / "0.7.toml"
        nav_path.write_text(
            nav_path.read_text(encoding="utf-8")
            + '\n[pages.website-dev-guide.orphan-section]\nitems = [\n  "ghost-page",\n]\n',
            encoding="utf-8",
        )

        issues = self.validate(root)

        self.assertTrue(
            any(
                "data/docs-nav/0.7.toml: pages table references undeclared section slug under website-dev-guide: orphan-section"
                in issue
                for issue in issues
            ),
            msg="expected undeclared nav section issue",
        )

    def test_validate_all_reports_broken_page_inheritance_chain(self) -> None:
        """An inherited page with no earlier authored source should fail validation."""
        tempdir, root = self.build_temp_website()
        self.addCleanup(tempdir.cleanup)

        book, section, page = self.find_inherited_page(root, "0.8")
        shutil.rmtree(root / "content" / "docs" / "0.7" / book / section / page)

        issues = self.validate(root)

        self.assertTrue(
            any(
                f"content/docs/0.8/{book}/{section}/{page}: page inheritance does not resolve to `index.md`"
                in issue
                for issue in issues
            ),
            msg="expected broken page inheritance issue",
        )

    def test_validate_all_reports_unexpected_page_bundle_file(self) -> None:
        """Unexpected direct files inside a page bundle should fail validation."""
        tempdir, root = self.build_temp_website()
        self.addCleanup(tempdir.cleanup)

        page_dir = (
            root
            / "content"
            / "docs"
            / "0.7"
            / "website-dev-guide"
            / "authoring-and-tooling"
            / "docs-editor-tool"
        )
        (page_dir / "notes.txt").write_text("scratch", encoding="utf-8")

        issues = self.validate(root)

        self.assertTrue(
            any(
                "unexpected file in page bundle 0.7/website-dev-guide/authoring-and-tooling/docs-editor-tool: notes.txt"
                in issue
                for issue in issues
            ),
            msg="expected unexpected page bundle file issue",
        )

    def test_validate_all_reports_current_version_not_declared(self) -> None:
        """The current docs version slug must point at a declared version entry."""
        tempdir, root = self.build_temp_website()
        self.addCleanup(tempdir.cleanup)

        versions_path = root / "data" / "docs-versions.toml"
        versions_text = versions_path.read_text(encoding="utf-8")
        updated_versions_text, replacement_count = re.subn(
            r'^current\s*=\s*"[^"]*"\s*$',
            'current = "9.9"',
            versions_text,
            count=1,
            flags=re.MULTILINE,
        )
        self.assertEqual(
            replacement_count, 1, msg="expected one current version assignment"
        )
        versions_path.write_text(
            updated_versions_text,
            encoding="utf-8",
        )

        issues = self.validate(root)

        self.assertTrue(
            any(
                "data/docs-versions.toml: current references undeclared version slug: 9.9"
                in issue
                for issue in issues
            ),
            msg="expected invalid current version issue",
        )


if __name__ == "__main__":
    unittest.main()
