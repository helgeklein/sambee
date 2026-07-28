from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "assemble_metadata_bundle.sh"


def _write_fake_crane(directory: Path, manifest_by_ref: dict[str, dict[str, object]]) -> Path:
    crane_path = directory / "bin" / "crane"
    crane_path.parent.mkdir(parents=True, exist_ok=True)
    crane_path.write_text(
        """
#!/usr/bin/env python3
import json
import os
import sys

if sys.argv[1] != "manifest":
    raise SystemExit(f"unsupported crane command: {sys.argv[1]}")
print(json.dumps(json.loads(os.environ["FAKE_CRANE_MANIFESTS"])[sys.argv[2]]))
""".strip()
        + "\n",
        encoding="utf-8",
    )
    crane_path.chmod(crane_path.stat().st_mode | stat.S_IEXEC)
    return crane_path.parent


def _write_platform_input(directory: Path, manifest_digest: str) -> None:
    platform_dir = directory / "platforms"
    platform_dir.mkdir(parents=True)
    (platform_dir / "linux-amd64.json").write_text(
        json.dumps(
            {
                "platform": "linux/amd64",
                "manifest_digest": manifest_digest,
                "sbom_path": "sbom/linux-amd64.spdx.json",
                "provenance_path": "provenance/linux-amd64.intoto.jsonl",
            }
        ),
        encoding="utf-8",
    )
    sbom_dir = directory / "sbom"
    sbom_dir.mkdir()
    (sbom_dir / "linux-amd64.spdx.json").write_text('{"spdxVersion":"SPDX-2.3"}\n', encoding="utf-8")
    provenance_dir = directory / "provenance"
    provenance_dir.mkdir()
    (provenance_dir / "linux-amd64.intoto.jsonl").write_text("{}\n", encoding="utf-8")


def _run_builder(
    tmp_path: Path, inspect_image_ref: str, subject_image_ref: str, manifest_by_ref: dict[str, dict[str, object]]
) -> subprocess.CompletedProcess[str]:
    input_dir = tmp_path / "input"
    _write_platform_input(input_dir, "sha256:" + "a" * 64)
    output_dir = tmp_path / "output"
    path_dir = _write_fake_crane(tmp_path, manifest_by_ref)
    env = os.environ | {"PATH": f"{path_dir}:{os.environ['PATH']}", "FAKE_CRANE_MANIFESTS": json.dumps(manifest_by_ref)}
    result = subprocess.run(
        [
            "bash",
            str(SCRIPT_PATH),
            "--input-dir",
            str(input_dir),
            "--inspect-image-ref",
            inspect_image_ref,
            "--subject-image-ref",
            subject_image_ref,
            "--metadata-repository",
            "ghcr.io/example/sambee-signatures",
            "--version",
            "0.7.0",
            "--revision",
            "abcdef1234567890abcdef1234567890abcdef12",
            "--source-url",
            "https://github.com/example/sambee",
            "--output-dir",
            str(output_dir),
        ],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    result.output_dir = output_dir  # type: ignore[attr-defined]
    return result


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell metadata tests")
def test_builder_inspects_staging_and_records_final_subject_identity(tmp_path: Path) -> None:
    digest = "sha256:" + "1" * 64
    inspect_ref = f"ghcr.io/example/sambee-staging@{digest}"
    subject_ref = f"ghcr.io/example/sambee@{digest}"
    manifest = {"manifests": [{"digest": "sha256:" + "a" * 64, "platform": {"os": "linux", "architecture": "amd64"}}]}

    result = _run_builder(tmp_path, inspect_ref, subject_ref, {inspect_ref: manifest})

    assert result.returncode == 0, result.stderr
    metadata = json.loads((result.output_dir / "metadata.json").read_text(encoding="utf-8"))  # type: ignore[attr-defined]
    assert metadata["image_repository"] == "ghcr.io/example/sambee"
    assert metadata["image_digest"] == digest


@pytest.mark.unit
def test_builder_rejects_mismatched_inspect_and_subject_digests(tmp_path: Path) -> None:
    inspect_ref = "ghcr.io/example/sambee-staging@sha256:" + "1" * 64
    subject_ref = "ghcr.io/example/sambee@sha256:" + "2" * 64

    result = _run_builder(tmp_path, inspect_ref, subject_ref, {})

    assert result.returncode != 0
    assert "Inspect and subject image digests must match" in result.stderr
