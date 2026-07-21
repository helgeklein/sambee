import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).parents[2] / ".github/scripts/ensure_candidate_signature.sh"
IMAGE_REF = "example.test/sambee@sha256:" + "a" * 64


def write_fake_cosign(directory: Path) -> None:
    fake_cosign = directory / "cosign"
    fake_cosign.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
command="$1"
shift
case "$command" in
  verify)
    [[ "${COSIGN_MODE}" == "reuse" || ( "${COSIGN_MODE}" == "missing" && -f "${COSIGN_SIGN_MARKER}" ) ]] && exit 0
    exit 1
    ;;
  download)
    case "${COSIGN_MODE}" in
      missing) exit 0 ;;
      conflict) printf '{"signature":"conflict"}\\n' ;;
      download-error) printf 'registry unavailable\\n' >&2; exit 2 ;;
    esac
    ;;
  sign)
    touch "${COSIGN_SIGN_MARKER}"
    ;;
  *) exit 1 ;;
esac
""",
        encoding="utf-8",
    )
    fake_cosign.chmod(0o755)


def run_script(tmp_path: Path, mode: str) -> subprocess.CompletedProcess[str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    write_fake_cosign(bin_dir)
    sign_marker = tmp_path / "sign"
    return subprocess.run(
        [
            "bash",
            str(SCRIPT),
            "--image-ref",
            IMAGE_REF,
            "--github-repository",
            "example/sambee",
        ],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "COSIGN_MODE": mode,
            "COSIGN_SIGN_MARKER": str(sign_marker),
        },
    )


def test_reuses_existing_valid_signature(tmp_path: Path) -> None:
    result = run_script(tmp_path, "reuse")

    assert result.returncode == 0, result.stderr
    assert "Reused verified candidate signature" in result.stdout
    assert not (tmp_path / "sign").exists()


def test_signs_and_verifies_when_no_signature_exists(tmp_path: Path) -> None:
    result = run_script(tmp_path, "missing")

    assert result.returncode == 0, result.stderr
    assert "Published and verified candidate signature" in result.stdout
    assert (tmp_path / "sign").exists()


def test_rejects_existing_signature_that_fails_policy(tmp_path: Path) -> None:
    result = run_script(tmp_path, "conflict")

    assert result.returncode != 0
    assert "do not satisfy the required GitHub Actions identity policy" in result.stderr
    assert not (tmp_path / "sign").exists()


def test_rejects_signature_registry_inspection_error(tmp_path: Path) -> None:
    result = run_script(tmp_path, "download-error")

    assert result.returncode != 0
    assert "Unable to inspect existing signatures" in result.stderr
    assert not (tmp_path / "sign").exists()
