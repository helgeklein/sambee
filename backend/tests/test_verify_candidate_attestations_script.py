from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "verify_candidate_attestations.sh"


def _write_fake_crane(directory: Path) -> Path:
    crane_path = directory / "bin" / "crane"
    crane_path.parent.mkdir()
    crane_path.write_text(
        """
#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys

manifests = json.loads(os.environ["FAKE_CRANE_MANIFESTS"])
blobs = json.loads(os.environ["FAKE_CRANE_BLOBS"])
command = sys.argv[1]

if command == "manifest":
    ref = sys.argv[2]
    sys.stdout.write(manifests[ref])
elif command == "blob":
    ref = sys.argv[2]
    digest = sys.argv[3]
    sys.stdout.write(blobs[f"{ref}|{digest}"])
else:
    raise SystemExit(f"unsupported crane command: {command}")
""".strip()
        + "\n",
        encoding="utf-8",
    )
    crane_path.chmod(crane_path.stat().st_mode | stat.S_IEXEC)
    return crane_path.parent


def _run_script(
    path_dir: Path,
    image_ref: str,
    manifests: dict[str, object],
    blobs: dict[tuple[str, str], object],
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PATH"] = f"{path_dir}:{env['PATH']}"
    env["FAKE_CRANE_MANIFESTS"] = json.dumps({key: json.dumps(value) for key, value in manifests.items()})
    env["FAKE_CRANE_BLOBS"] = json.dumps({f"{ref}|{digest}": json.dumps(value) for (ref, digest), value in blobs.items()})
    return subprocess.run(
        ["bash", str(SCRIPT_PATH), "--image-ref", image_ref],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_accepts_legacy_linkage_without_layer_predicate_annotation(tmp_path: Path) -> None:
    image_ref = "ghcr.io/example/sambee@sha256:index"
    platform_digest = "sha256:platform-amd64"
    attestation_digest = "sha256:attestation-legacy"
    sbom_blob_digest = "sha256:sbom-blob"
    provenance_blob_digest = "sha256:provenance-blob"

    manifests = {
        image_ref: {
            "schemaVersion": 2,
            "manifests": [
                {
                    "digest": platform_digest,
                    "mediaType": "application/vnd.oci.image.manifest.v1+json",
                    "platform": {"os": "linux", "architecture": "amd64"},
                },
                {
                    "digest": attestation_digest,
                    "mediaType": "application/vnd.oci.image.manifest.v1+json",
                    "platform": {"os": "unknown", "architecture": "unknown"},
                    "annotations": {
                        "vnd.docker.reference.type": "attestation-manifest",
                        "vnd.docker.reference.digest": platform_digest,
                    },
                },
            ],
        },
        f"ghcr.io/example/sambee@{attestation_digest}": {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "layers": [
                {
                    "digest": sbom_blob_digest,
                    "mediaType": "application/vnd.in-toto+json",
                    "annotations": {},
                },
                {
                    "digest": provenance_blob_digest,
                    "mediaType": "application/vnd.in-toto+json",
                    "annotations": {"in-toto.io/predicate-type": "https://slsa.dev/provenance/v0.2"},
                },
            ],
        },
    }
    blobs = {
        (f"ghcr.io/example/sambee@{attestation_digest}", sbom_blob_digest): {
            "predicateType": "https://spdx.dev/Document",
            "subject": [{"digest": {"sha256": platform_digest.removeprefix("sha256:")}}],
        },
        (f"ghcr.io/example/sambee@{attestation_digest}", provenance_blob_digest): {
            "predicateType": "https://slsa.dev/provenance/v0.2",
            "subject": [{"digest": {"sha256": platform_digest.removeprefix("sha256:")}}],
        },
    }

    path_dir = _write_fake_crane(tmp_path)
    result = _run_script(path_dir, image_ref, manifests, blobs)

    assert result.returncode == 0, result.stderr


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_accepts_oci_artifact_subject_linkage(tmp_path: Path) -> None:
    image_ref = "ghcr.io/example/sambee@sha256:index"
    platform_digest = "sha256:platform-arm64"
    attestation_digest = "sha256:attestation-oci"
    sbom_blob_digest = "sha256:sbom-blob-oci"
    provenance_blob_digest = "sha256:provenance-blob-oci"

    manifests = {
        image_ref: {
            "schemaVersion": 2,
            "manifests": [
                {
                    "digest": platform_digest,
                    "mediaType": "application/vnd.oci.image.manifest.v1+json",
                    "platform": {"os": "linux", "architecture": "arm64"},
                },
                {
                    "digest": attestation_digest,
                    "mediaType": "application/vnd.oci.image.manifest.v1+json",
                    "platform": {"os": "unknown", "architecture": "unknown"},
                },
            ],
        },
        f"ghcr.io/example/sambee@{attestation_digest}": {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "artifactType": "application/vnd.docker.attestation.manifest.v1+json",
            "subject": {"digest": platform_digest},
            "layers": [
                {
                    "digest": sbom_blob_digest,
                    "mediaType": "application/vnd.in-toto+json",
                    "annotations": {"in-toto.io/predicate-type": "https://spdx.dev/Document"},
                },
                {
                    "digest": provenance_blob_digest,
                    "mediaType": "application/vnd.in-toto+json",
                    "annotations": {"in-toto.io/predicate-type": "https://slsa.dev/provenance/v1"},
                },
            ],
        },
    }
    blobs = {
        (f"ghcr.io/example/sambee@{attestation_digest}", sbom_blob_digest): {
            "predicateType": "https://spdx.dev/Document",
            "subject": [{"digest": {"sha256": platform_digest.removeprefix("sha256:")}}],
        },
        (f"ghcr.io/example/sambee@{attestation_digest}", provenance_blob_digest): {
            "predicateType": "https://slsa.dev/provenance/v1",
            "subject": [{"digest": {"sha256": platform_digest.removeprefix("sha256:")}}],
        },
    }

    path_dir = _write_fake_crane(tmp_path)
    result = _run_script(path_dir, image_ref, manifests, blobs)

    assert result.returncode == 0, result.stderr
