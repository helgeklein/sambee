import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).parents[2] / ".github/scripts/promote_container_image.sh"
IMAGE_NAME = "example.test/sambee"
SOURCE_DIGEST = "sha256:" + "a" * 64


def write_fake_crane(directory: Path) -> None:
    crane = directory / "crane"
    crane.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  digest)
    reference="$2"
    if [[ "$reference" == *"@sha256:"* ]]; then
      if [[ "${CRANE_MODE}" == "source-mismatch" ]]; then
        printf 'sha256:%064d\\n' 0
      else
        printf '%s\\n' "${SOURCE_DIGEST}"
      fi
    elif [[ "${CRANE_MODE}" == "immutable-absent" && ! -f "${CRANE_COPY_LOG}" ]]; then
      exit 1
    elif [[ -n "${CRANE_EXISTING_DIGEST:-}" ]]; then
      printf '%s\\n' "${CRANE_EXISTING_DIGEST}"
    elif [[ "${CRANE_MODE}" == "mismatch" ]]; then
      printf 'sha256:%064d\\n' 0
    else
      printf '%s\\n' "${SOURCE_DIGEST}"
    fi
    ;;
  cp)
    [[ "${CRANE_MODE}" != "copy-fails" ]] || exit 1
    printf '%s\\n' "$*" >> "${CRANE_COPY_LOG}"
    ;;
  *) exit 1 ;;
esac
""",
        encoding="utf-8",
    )
    crane.chmod(0o755)


def run_promotion(
    tmp_path: Path,
    mode: str,
    *,
    immutable: bool = False,
    existing_digest: str = "",
) -> subprocess.CompletedProcess[str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    write_fake_crane(bin_dir)
    copy_log = tmp_path / "copies"
    arguments = [
        "bash",
        str(SCRIPT),
        "--image-name",
        IMAGE_NAME,
        "--source-digest",
        SOURCE_DIGEST,
        "--tag",
        "stable",
    ]
    if immutable:
        arguments.append("--immutable")
    result = subprocess.run(
        arguments,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "SOURCE_DIGEST": SOURCE_DIGEST,
            "CRANE_MODE": mode,
            "CRANE_EXISTING_DIGEST": existing_digest,
            "CRANE_COPY_LOG": str(copy_log),
        },
    )
    result.copy_log = copy_log  # type: ignore[attr-defined]
    return result


def test_reports_the_pointer_when_copy_fails(tmp_path: Path) -> None:
    result = run_promotion(tmp_path, "copy-fails")

    assert result.returncode != 0
    assert f"mutable pointer {IMAGE_NAME}:stable" in result.stderr
    assert "final registry state is unknown" in result.stderr


def test_reports_the_pointer_when_post_copy_verification_fails(tmp_path: Path) -> None:
    result = run_promotion(tmp_path, "mismatch")

    assert result.returncode != 0
    assert f"Mutable pointer verification failed for {IMAGE_NAME}:stable" in result.stderr
    assert "No immutable artifact was changed" in result.stderr


def test_reuses_matching_immutable_tag_without_copying(tmp_path: Path) -> None:
    result = run_promotion(
        tmp_path,
        "immutable-present",
        immutable=True,
        existing_digest=SOURCE_DIGEST,
    )

    assert result.returncode == 0, result.stderr
    assert not result.copy_log.exists()  # type: ignore[attr-defined]


def test_rejects_conflicting_immutable_tag_without_copying(tmp_path: Path) -> None:
    result = run_promotion(
        tmp_path,
        "immutable-present",
        immutable=True,
        existing_digest="sha256:" + "b" * 64,
    )

    assert result.returncode != 0
    assert f"Immutable tag conflict for {IMAGE_NAME}:stable" in result.stderr
    assert not result.copy_log.exists()  # type: ignore[attr-defined]


def test_creates_absent_immutable_tag_and_verifies_it(tmp_path: Path) -> None:
    result = run_promotion(tmp_path, "immutable-absent", immutable=True)

    assert result.returncode == 0, result.stderr
    assert result.copy_log.exists()  # type: ignore[attr-defined]


def test_rejects_an_unverified_source_digest_before_copying(tmp_path: Path) -> None:
    result = run_promotion(tmp_path, "source-mismatch")

    assert result.returncode != 0
    assert "Source digest mismatch" in result.stderr
    assert not result.copy_log.exists()  # type: ignore[attr-defined]
