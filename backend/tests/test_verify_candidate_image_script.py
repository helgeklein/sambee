from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "verify_candidate_image.sh"

IMAGE_REPOSITORY = "ghcr.io/example/sambee"
CANDIDATE_DIGEST = "sha256:" + "1" * 64
AMD64_DIGEST = "sha256:" + "a" * 64
ARM64_DIGEST = "sha256:" + "b" * 64
DESCRIPTION = "Browser-based file viewer and manager for SMB shares and local drives."
REVISION = "40e378207d17fda88c29c1dc3b80a3628562dff0"
SOURCE_URL = "https://github.com/example/sambee"
TITLE = "Sambee"
VERSION = "0.7.0"


def _labels(revision: str = REVISION) -> dict[str, object]:
    return {
        "config": {
            "Labels": {
                "org.opencontainers.image.description": DESCRIPTION,
                "org.opencontainers.image.revision": revision,
                "org.opencontainers.image.source": SOURCE_URL,
                "org.opencontainers.image.title": TITLE,
                "org.opencontainers.image.url": SOURCE_URL,
                "org.opencontainers.image.version": VERSION,
            }
        }
    }


def _docker_manifest_list() -> dict[str, object]:
    return {
        "mediaType": "application/vnd.docker.distribution.manifest.list.v2+json",
        "manifests": [
            {
                "digest": AMD64_DIGEST,
                "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                "platform": {"os": "linux", "architecture": "amd64"},
            },
            {
                "digest": ARM64_DIGEST,
                "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                "platform": {"os": "linux", "architecture": "arm64"},
            },
        ],
    }


def _write_fake_crane(directory: Path) -> Path:
    crane_path = directory / "bin" / "crane"
    crane_path.parent.mkdir(parents=True, exist_ok=True)
    crane_path.write_text(
        """
#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys

command = sys.argv[1]
ref = sys.argv[2]

configs = json.loads(os.environ["FAKE_CRANE_CONFIGS"])
digests = json.loads(os.environ["FAKE_CRANE_DIGESTS"])
manifests = json.loads(os.environ["FAKE_CRANE_MANIFESTS"])

if command == "config":
    sys.stdout.write(configs[ref])
elif command == "digest":
    sys.stdout.write(digests[ref] + "\\n")
elif command == "manifest":
    sys.stdout.write(manifests[ref])
else:
    raise SystemExit(f"unsupported crane command: {command}")
""".strip()
        + "\n",
        encoding="utf-8",
    )
    crane_path.chmod(crane_path.stat().st_mode | stat.S_IEXEC)
    return crane_path.parent


def _base_crane_data() -> tuple[str, dict[str, str], dict[str, str], dict[str, str]]:
    image_ref = f"{IMAGE_REPOSITORY}@{CANDIDATE_DIGEST}"
    amd64_ref = f"{IMAGE_REPOSITORY}@{AMD64_DIGEST}"
    arm64_ref = f"{IMAGE_REPOSITORY}@{ARM64_DIGEST}"
    configs = {
        image_ref: json.dumps(_labels()),
        amd64_ref: json.dumps(_labels()),
        arm64_ref: json.dumps(_labels()),
    }
    digests = {image_ref: CANDIDATE_DIGEST}
    manifests = {
        image_ref: json.dumps(_docker_manifest_list()),
        amd64_ref: json.dumps({"mediaType": "application/vnd.docker.distribution.manifest.v2+json"}),
        arm64_ref: json.dumps({"mediaType": "application/vnd.docker.distribution.manifest.v2+json"}),
    }
    return image_ref, configs, digests, manifests


def _run_script(
    path_dir: Path,
    output_path: Path,
    image_ref: str,
    configs: dict[str, str],
    digests: dict[str, str],
    manifests: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["GITHUB_OUTPUT"] = str(output_path)
    env["PATH"] = f"{path_dir}:{env['PATH']}"
    env["FAKE_CRANE_CONFIGS"] = json.dumps(configs)
    env["FAKE_CRANE_DIGESTS"] = json.dumps(digests)
    env["FAKE_CRANE_MANIFESTS"] = json.dumps(manifests)
    return subprocess.run(
        [
            "bash",
            str(SCRIPT_PATH),
            "--image-ref",
            image_ref,
            "--expected-description",
            DESCRIPTION,
            "--expected-revision",
            REVISION,
            "--expected-version",
            VERSION,
            "--expected-source",
            SOURCE_URL,
            "--expected-title",
            TITLE,
        ],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_accepts_docker_manifest_lists_without_annotations(tmp_path: Path) -> None:
    image_ref, configs, digests, manifests = _base_crane_data()
    path_dir = _write_fake_crane(tmp_path)

    result = _run_script(path_dir, tmp_path / "output", image_ref, configs, digests, manifests)

    assert result.returncode == 0, result.stderr


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_checks_each_platform_config_label(tmp_path: Path) -> None:
    image_ref, configs, digests, manifests = _base_crane_data()
    configs[f"{IMAGE_REPOSITORY}@{ARM64_DIGEST}"] = json.dumps(_labels(revision="bad-revision"))
    path_dir = _write_fake_crane(tmp_path)

    result = _run_script(path_dir, tmp_path / "output", image_ref, configs, digests, manifests)

    assert result.returncode != 0
    assert f"Candidate manifest {ARM64_DIGEST} config revision mismatch" in result.stderr
