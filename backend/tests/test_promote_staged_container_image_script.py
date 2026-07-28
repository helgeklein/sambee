from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).parents[2] / ".github" / "scripts" / "promote_staged_container_image.sh"
SOURCE_IMAGE = "example.test/sambee-staging"
TARGET_IMAGE = "example.test/sambee"
SOURCE_DIGEST = "sha256:" + "a" * 64


def _write_fake_crane(directory: Path) -> None:
    crane = directory / "crane"
    crane.write_text(
        """#!/usr/bin/env python3
import json
import os
import pathlib
import sys

command = sys.argv[1]
reference = sys.argv[2]
source_digest = os.environ["SOURCE_DIGEST"]
if command == "digest":
    if reference.endswith(":build-v0.7.0") and os.environ["CRANE_MODE"] == "conflict":
        print("sha256:" + "b" * 64)
    elif reference.endswith(":build-v0.7.0") and not pathlib.Path(os.environ["CRANE_COPY_LOG"]).exists():
        raise SystemExit(1)
    else:
        print(source_digest)
elif command == "cp":
    if "--no-clobber" not in sys.argv:
        raise SystemExit("promotion must use --no-clobber")
    with open(os.environ["CRANE_COPY_LOG"], "w", encoding="utf-8") as file:
        file.write(" ".join(sys.argv[1:]))
elif command == "manifest":
    print(os.environ["CRANE_MANIFEST"])
else:
    raise SystemExit(f"unsupported crane command: {command}")
""",
        encoding="utf-8",
    )
    crane.chmod(0o755)


def _run_promotion(tmp_path: Path, mode: str) -> subprocess.CompletedProcess[str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_fake_crane(bin_dir)
    copy_log = tmp_path / "copies"
    manifest = {
        "manifests": [
            {
                "digest": "sha256:" + "1" * 64,
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "platform": {"os": "linux", "architecture": "amd64"},
            },
            {
                "digest": "sha256:" + "2" * 64,
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "platform": {"os": "linux", "architecture": "arm64"},
            },
        ]
    }
    result = subprocess.run(
        [
            "bash",
            str(SCRIPT),
            "--source-image",
            SOURCE_IMAGE,
            "--source-digest",
            SOURCE_DIGEST,
            "--target-image",
            TARGET_IMAGE,
            "--target-tag",
            "build-v0.7.0",
        ],
        capture_output=True,
        text=True,
        env=os.environ
        | {
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "SOURCE_DIGEST": SOURCE_DIGEST,
            "CRANE_MODE": mode,
            "CRANE_COPY_LOG": str(copy_log),
            "CRANE_MANIFEST": json.dumps(manifest),
        },
    )
    result.copy_log = copy_log  # type: ignore[attr-defined]
    return result


def test_promotes_verified_staging_digest_with_no_clobber_copy(tmp_path: Path) -> None:
    result = _run_promotion(tmp_path, "success")

    assert result.returncode == 0, result.stderr
    assert "--no-clobber" in result.copy_log.read_text(encoding="utf-8")  # type: ignore[attr-defined]
    assert f"{SOURCE_IMAGE}@{SOURCE_DIGEST}" in result.copy_log.read_text(encoding="utf-8")  # type: ignore[attr-defined]
    assert f"{TARGET_IMAGE}:build-v0.7.0" in result.copy_log.read_text(encoding="utf-8")  # type: ignore[attr-defined]


def test_rejects_conflicting_immutable_final_marker_without_copying(tmp_path: Path) -> None:
    result = _run_promotion(tmp_path, "conflict")

    assert result.returncode != 0
    assert "Immutable final marker conflict" in result.stderr
    assert not result.copy_log.exists()  # type: ignore[attr-defined]
