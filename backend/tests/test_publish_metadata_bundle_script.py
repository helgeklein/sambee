import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).parents[2] / ".github/scripts/publish_metadata_bundle.sh"


def write_bundle(directory: Path, metadata: bytes = b"metadata") -> None:
    (directory / "provenance").mkdir(parents=True)
    (directory / "sbom").mkdir()
    (directory / "metadata.json").write_bytes(metadata)
    (directory / "provenance" / "intoto.jsonl").write_bytes(b"provenance")
    (directory / "sbom" / "linux-amd64.spdx.json").write_bytes(b"amd64")
    (directory / "sbom" / "linux-arm64.spdx.json").write_bytes(b"arm64")


def write_fake_oras(directory: Path) -> None:
    fake_oras = directory / "oras"
    fake_oras.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2 $3" == "manifest fetch --descriptor" ]]; then
  [[ "${ORAS_EXISTING:-}" == true ]] || exit 1
  printf '{"artifactType":"%s"}\n' "${ORAS_ARTIFACT_TYPE}"
  exit 0
fi
if [[ "$1" == pull ]]; then
  cp -R "${ORAS_SOURCE_DIR}/." "$3"
  exit 0
fi
if [[ "$1" == push ]]; then
  touch "${ORAS_PUSH_MARKER}"
  exit 0
fi
exit 1
""",
        encoding="utf-8",
    )
    fake_oras.chmod(0o755)


def write_fake_jq(directory: Path) -> None:
    fake_jq = directory / "jq"
    fake_jq.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "-r" && "$2" == ".artifactType // empty" ]]; then
    printf '%s\\n' "${ORAS_ARTIFACT_TYPE}"
    exit 0
fi
echo "Unexpected jq arguments: $*" >&2
exit 1
""",
        encoding="utf-8",
    )
    fake_jq.chmod(0o755)


def run_publish(tmp_path: Path, *, existing: bool, existing_metadata: bytes) -> subprocess.CompletedProcess[str]:
    bundle_dir = tmp_path / "bundle"
    existing_dir = tmp_path / "existing"
    bin_dir = tmp_path / "bin"
    bundle_dir.mkdir()
    existing_dir.mkdir()
    bin_dir.mkdir()
    write_bundle(bundle_dir)
    write_bundle(existing_dir, existing_metadata)
    write_fake_oras(bin_dir)
    write_fake_jq(bin_dir)
    push_marker = tmp_path / "push"
    environment = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "ORAS_EXISTING": str(existing).lower(),
        "ORAS_ARTIFACT_TYPE": "application/vnd.sambee.image-metadata.v1",
        "ORAS_SOURCE_DIR": str(existing_dir),
        "ORAS_PUSH_MARKER": str(push_marker),
    }
    result = subprocess.run(
        [
            "bash",
            str(SCRIPT),
            "--bundle-dir",
            str(bundle_dir),
            "--metadata-repository",
            "example.test/signatures",
            "--image-digest",
            "sha256:" + "a" * 64,
        ],
        capture_output=True,
        text=True,
        env=environment,
    )
    result.push_marker = push_marker  # type: ignore[attr-defined]
    return result


def test_reuses_matching_existing_metadata_bundle(tmp_path: Path) -> None:
    result = run_publish(tmp_path, existing=True, existing_metadata=b"metadata")

    assert result.returncode == 0, result.stderr
    assert "Reused verified metadata bundle" in result.stdout
    assert not result.push_marker.exists()  # type: ignore[attr-defined]


def test_rejects_conflicting_existing_metadata_bundle(tmp_path: Path) -> None:
    result = run_publish(tmp_path, existing=True, existing_metadata=b"conflict")

    assert result.returncode != 0
    assert "conflicts with the candidate digest" in result.stderr
    assert not result.push_marker.exists()  # type: ignore[attr-defined]
