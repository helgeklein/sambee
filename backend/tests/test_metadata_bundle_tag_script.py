from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "metadata_bundle_tag.sh"


@pytest.mark.unit
def test_metadata_bundle_tag_derives_meta_tag() -> None:
    result = subprocess.run(
        ["bash", str(SCRIPT_PATH), "--image-digest", "sha256:" + "a" * 64],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == f"sha256-{'a' * 64}.meta"


@pytest.mark.unit
def test_metadata_bundle_tag_rejects_invalid_digest() -> None:
    result = subprocess.run(
        ["bash", str(SCRIPT_PATH), "--image-digest", "sha256:not-a-real-digest"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "sha256:<64 lowercase hex characters>" in result.stderr
