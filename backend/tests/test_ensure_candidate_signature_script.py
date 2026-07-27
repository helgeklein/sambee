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
printf '%s\n' "${COSIGN_REPOSITORY:-}" >> "${COSIGN_REPOSITORY_LOG}"
printf '%s %s\n' "$command" "$*" >> "${COSIGN_COMMAND_LOG}"
case "$command" in
  verify)
        [[ "${COSIGN_MODE}" == "reuse" || ( ( "${COSIGN_MODE}" == "missing" || "${COSIGN_MODE}" == "missing-associated" ) && -f "${COSIGN_SIGN_MARKER}" ) ]] && exit 0
        if [[ "${COSIGN_MODE}" == "delayed" && -f "${COSIGN_SIGN_MARKER}" ]]; then
            [[ -f "${COSIGN_VERIFY_ATTEMPT_MARKER}" ]] && exit 0
            touch "${COSIGN_VERIFY_ATTEMPT_MARKER}"
        fi
    exit 1
    ;;
  download)
    case "${COSIGN_MODE}" in
      missing) printf 'Error: no signatures found\nerror during command execution: no signatures found\n' >&2; exit 1 ;;
      missing-associated) printf 'Error: %s: no signatures associated\n' "$*" >&2; exit 1 ;;
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
    repository_log = tmp_path / "cosign-repositories"
    command_log = tmp_path / "cosign-commands"
    return subprocess.run(
        [
            "bash",
            str(SCRIPT),
            "--image-ref",
            IMAGE_REF,
            "--signature-repository",
            "example.test/sambee-signatures",
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
            "COSIGN_VERIFY_ATTEMPT_MARKER": str(tmp_path / "verify-attempt"),
            "COSIGN_REPOSITORY_LOG": str(repository_log),
            "COSIGN_COMMAND_LOG": str(command_log),
            "SIGNATURE_VERIFY_RETRY_DELAY_SECONDS": "0",
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
    assert set((tmp_path / "cosign-repositories").read_text(encoding="utf-8").splitlines()) == {"example.test/sambee-signatures"}
    command_log = (tmp_path / "cosign-commands").read_text(encoding="utf-8")
    assert "sign --new-bundle-format=false --registry-referrers-mode legacy --use-signing-config=false --yes" in command_log
    assert "verify --certificate-identity" in command_log
    assert "--new-bundle-format=false" in command_log
    assert "--new-bundle-format false" not in command_log
    assert "--use-signing-config=false" in command_log


def test_signs_when_cosign_reports_no_signatures_associated(tmp_path: Path) -> None:
    result = run_script(tmp_path, "missing-associated")

    assert result.returncode == 0, result.stderr
    assert "Published and verified candidate signature" in result.stdout
    assert (tmp_path / "sign").exists()


def test_retries_post_sign_verification_until_signature_is_visible(tmp_path: Path) -> None:
    result = run_script(tmp_path, "delayed")

    assert result.returncode == 0, result.stderr
    assert "retrying verification" in result.stderr
    assert "Published and verified candidate signature" in result.stdout


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
