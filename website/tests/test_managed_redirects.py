"""Tests for managed redirect registry validation and output generation."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

WEBSITE_DIR = Path(__file__).resolve().parent.parent
GENERATOR_PATH = WEBSITE_DIR / "scripts" / "generate-managed-redirects.py"


def load_generator_module():
    """Load the managed redirect generator from the website scripts directory."""
    spec = importlib.util.spec_from_file_location(
        "generate_managed_redirects", GENERATOR_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load generate-managed-redirects.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


GENERATOR = load_generator_module()


class ManagedRedirectGeneratorTests(unittest.TestCase):
    """Exercise managed redirect registry validation and artifact generation."""

    def write_file(self, root: Path, relative_path: str, content: str) -> Path:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_generates_deterministic_temporary_redirect_rules(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            config_path = self.write_file(
                root,
                "data/managed-redirects.toml",
                """[[redirects]]
id = "help-oidc-setup"
source = "/mr/help-oidc-setup"
target = "https://sambee.net/docs/admin-guide/configuration/openid-connect/"

[[redirects]]
id = "release-notes"
source = "/mr/release-notes"
target = "https://sambee.net/docs/"
""",
            )
            legacy_path = self.write_file(
                root, "static/_redirects", "/docs/old /docs/ 301\n"
            )
            output_path = root / "public/_redirects"

            redirects = GENERATOR.generate(config_path, legacy_path, output_path)

            self.assertEqual(
                [redirect.source for redirect in redirects],
                ["/mr/help-oidc-setup", "/mr/release-notes"],
            )
            self.assertEqual(
                output_path.read_text(encoding="utf-8"),
                "/docs/old /docs/ 301\n\n"
                "# Managed redirects. Generated from data/managed-redirects.toml; do not edit.\n"
                "/mr/help-oidc-setup https://sambee.net/docs/admin-guide/configuration/openid-connect/ 302\n"
                "/mr/release-notes https://sambee.net/docs/ 302\n",
            )

    def test_rejects_duplicate_managed_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            config_path = self.write_file(
                root,
                "data/managed-redirects.toml",
                """[[redirects]]
id = "first"
source = "/mr/shared"
target = "https://sambee.net/first"

[[redirects]]
id = "second"
source = "/mr/shared"
target = "https://sambee.net/second"
""",
            )

            with self.assertRaisesRegex(GENERATOR.ManagedRedirectError, "duplicates"):
                GENERATOR.load_managed_redirects(config_path)

    def test_rejects_noncanonical_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            config_path = self.write_file(
                root,
                "data/managed-redirects.toml",
                """[[redirects]]
id = "invalid"
source = "/mr/invalid/"
target = "https://sambee.net/docs/"
""",
            )

            with self.assertRaisesRegex(
                GENERATOR.ManagedRedirectError, "canonical literal path"
            ):
                GENERATOR.load_managed_redirects(config_path)

    def test_rejects_noncanonical_source_segments(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            config_path = self.write_file(
                root,
                "data/managed-redirects.toml",
                """[[redirects]]
id = "invalid"
source = "/mr//invalid"
target = "https://sambee.net/docs/"
""",
            )

            with self.assertRaisesRegex(
                GENERATOR.ManagedRedirectError, "canonical literal path"
            ):
                GENERATOR.load_managed_redirects(config_path)

    def test_rejects_insecure_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            config_path = self.write_file(
                root,
                "data/managed-redirects.toml",
                """[[redirects]]
id = "invalid"
source = "/mr/invalid"
target = "http://sambee.net/docs/"
""",
            )

            with self.assertRaisesRegex(
                GENERATOR.ManagedRedirectError, "absolute HTTPS URL"
            ):
                GENERATOR.load_managed_redirects(config_path)

    def test_rejects_source_matched_by_legacy_redirect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            config_path = self.write_file(
                root,
                "data/managed-redirects.toml",
                """[[redirects]]
id = "help"
source = "/mr/help"
target = "https://sambee.net/docs/"
""",
            )
            legacy_path = self.write_file(
                root, "static/_redirects", "/mr/* /legacy/:splat 301\n"
            )

            with self.assertRaisesRegex(
                GENERATOR.ManagedRedirectError, "conflicts with legacy"
            ):
                GENERATOR.generate(config_path, legacy_path, root / "public/_redirects")
