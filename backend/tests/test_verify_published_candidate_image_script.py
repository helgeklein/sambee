import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).parents[2] / ".github/scripts/verify_published_candidate_image.sh"
DIGEST = "sha256:" + "a" * 64


def write_fake_tools(directory: Path) -> None:
    (directory / "crane").write_text(
        """#!/bin/sh
    set -eu
printf '%s\n' "$*" >> "$TOOL_LOG"
    [ "$1" = digest ]
printf '%s\n' "$CRANE_DIGEST"
""",
        encoding="utf-8",
    )
    (directory / "bash").write_text(
        """#!/bin/sh
printf 'nested-bash %s\n' "$*" >> "$TOOL_LOG"
""",
        encoding="utf-8",
    )
    (directory / "cosign").write_text(
        """#!/bin/sh
printf 'cosign %s\n' "$*" >> "$TOOL_LOG"
""",
        encoding="utf-8",
    )
    for tool in ("crane", "bash", "cosign"):
        (directory / tool).chmod(0o755)


def run_verifier(tmp_path: Path, resolved_digest: str) -> tuple[subprocess.CompletedProcess[str], str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    write_fake_tools(bin_dir)
    tool_log = tmp_path / "tools.log"
    result = subprocess.run(
        [
            "/bin/bash",
            str(SCRIPT),
            "--image-name",
            "example.test/sambee",
            "--metadata-repository",
            "example.test/sambee-signatures",
            "--candidate-digest",
            DIGEST,
            "--expected-description",
            "Sambee",
            "--expected-revision",
            "b" * 40,
            "--expected-version",
            "1.2.3",
            "--expected-source",
            "https://example.test/sambee",
            "--expected-title",
            "Sambee",
            "--expected-build-tag",
            "build-v1.2.3",
            "--github-repository",
            "example/sambee",
        ],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "CRANE_DIGEST": resolved_digest,
            "TOOL_LOG": str(tool_log),
        },
    )
    return result, tool_log.read_text(encoding="utf-8")


def test_digest_mode_verifies_without_resolving_candidate_marker(tmp_path: Path) -> None:
    result, tool_log = run_verifier(tmp_path, DIGEST)

    assert result.returncode == 0, result.stderr
    assert f"digest example.test/sambee@{DIGEST}" in tool_log
    assert "example.test/sambee:build-v1.2.3" not in tool_log
    assert tool_log.count(f"example.test/sambee@{DIGEST}") == 4


def test_digest_mode_rejects_registry_digest_mismatch(tmp_path: Path) -> None:
    result, tool_log = run_verifier(tmp_path, "sha256:" + "c" * 64)

    assert result.returncode != 0
    assert "Candidate digest mismatch" in result.stderr
    assert "nested-bash" not in tool_log
    assert "cosign" not in tool_log
