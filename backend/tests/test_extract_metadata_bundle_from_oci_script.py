from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
from pathlib import Path
from typing import cast

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "extract_metadata_bundle_from_oci.sh"


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

manifests = json.loads(os.environ["FAKE_CRANE_MANIFESTS"])
command = sys.argv[1]

if command == "manifest":
    ref = sys.argv[2]
    sys.stdout.write(manifests[ref])
else:
    raise SystemExit(f"unsupported crane command: {command}")
""".strip()
        + "\n",
        encoding="utf-8",
    )
    crane_path.chmod(crane_path.stat().st_mode | stat.S_IEXEC)
    return crane_path.parent


def _write_blob(oci_layout: Path, digest: str, content: dict[str, object]) -> None:
    blob_path = oci_layout / "blobs" / "sha256" / digest.removeprefix("sha256:")
    blob_path.parent.mkdir(parents=True, exist_ok=True)
    blob_path.write_text(json.dumps(content, indent=2) + "\n", encoding="utf-8")


def _sha256_file(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _candidate_index(platform_digests: dict[str, str]) -> dict[str, object]:
    return {
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": [
            {
                "digest": digest,
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "platform": {"os": platform.split("/", 1)[0], "architecture": platform.split("/", 1)[1]},
            }
            for platform, digest in platform_digests.items()
        ],
    }


def _platform_config(platform: str) -> dict[str, object]:
    architecture = platform.split("/", 1)[1]
    return {
        "created": "2026-05-16T00:00:00Z",
        "architecture": architecture,
        "os": "linux",
        "config": {
            "Env": ["DEBIAN_FRONTEND=noninteractive"],
            "Entrypoint": None,
            "Cmd": ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"],
            "WorkingDir": "/app",
            "User": "sambee",
            "ExposedPorts": {"8000/tcp": {}},
            "Volumes": None,
            "Labels": {
                "org.opencontainers.image.created": "2026-05-16T00:00:00Z",
                "org.opencontainers.image.revision": "abcdef1234567890abcdef1234567890abcdef12",
                "org.opencontainers.image.source": "https://github.com/example/sambee",
                "org.opencontainers.image.version": "0.7.0",
            },
        },
        "rootfs": {"type": "layers", "diff_ids": ["sha256:" + ("5" if platform == "linux/amd64" else "6") * 64]},
        "history": [{"created": "2026-05-16T00:00:00Z", "created_by": "test"}],
    }


def _platform_manifest(platform: str, config_digest: str | None = None) -> dict[str, object]:
    platform_id = platform.replace("/", "-")
    digest_seed = "3" if platform == "linux/amd64" else "4"
    return {
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "config": {
            "mediaType": "application/vnd.oci.image.config.v1+json",
            "digest": config_digest or "sha256:" + digest_seed * 64,
        },
        "layers": [
            {
                "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
                "digest": "sha256:" + ("5" if platform_id == "linux-amd64" else "6") * 64,
            }
        ],
    }


def _fake_crane_outputs(
    image_ref: str,
    image_repository: str,
    platform_digests: dict[str, str],
) -> dict[str, str]:
    manifests = {image_ref: json.dumps(_candidate_index(platform_digests))}
    for platform, digest in platform_digests.items():
        manifests[f"{image_repository}@{digest}"] = json.dumps(_platform_manifest(platform))
    return manifests


def _build_oci_layout(
    oci_layout: Path,
    platform_digests: dict[str, str],
    attestation_subject_digests: dict[str, str] | None = None,
    provenance_subjectless_platforms: set[str] | None = None,
) -> None:
    attestation_manifest_digests = {
        "linux/amd64": "sha256:" + "c" * 64,
        "linux/arm64": "sha256:" + "d" * 64,
    }
    sbom_blob_digests = {
        "linux/amd64": "sha256:" + "e" * 64,
        "linux/arm64": "sha256:" + "1" * 64,
    }
    provenance_blob_digests = {
        "linux/amd64": "sha256:" + "f" * 64,
        "linux/arm64": "sha256:" + "2" * 64,
    }

    local_index = _candidate_index(platform_digests)
    manifests = cast(list[dict[str, object]], local_index["manifests"])
    manifests.extend(
        {
            "digest": attestation_manifest_digests[platform],
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "platform": {"os": "unknown", "architecture": "unknown"},
            "annotations": {
                "vnd.docker.reference.type": "attestation-manifest",
                "vnd.docker.reference.digest": manifest_digest,
            },
        }
        for platform, manifest_digest in platform_digests.items()
    )

    oci_layout.mkdir(parents=True, exist_ok=True)
    (oci_layout / "index.json").write_text(json.dumps(local_index, indent=2) + "\n", encoding="utf-8")

    for platform, manifest_digest in platform_digests.items():
        local_config_digest = "sha256:" + ("3" if platform == "linux/amd64" else "4") * 64
        _write_blob(oci_layout, manifest_digest, _platform_manifest(platform, config_digest=local_config_digest))
        _write_blob(oci_layout, local_config_digest, _platform_config(platform))

        subject_digest = (attestation_subject_digests or {}).get(platform, manifest_digest).removeprefix("sha256:")
        _write_blob(
            oci_layout,
            attestation_manifest_digests[platform],
            {
                "schemaVersion": 2,
                "layers": [
                    {
                        "mediaType": "application/vnd.in-toto+json",
                        "digest": sbom_blob_digests[platform],
                        "annotations": {"in-toto.io/predicate-type": "https://spdx.dev/Document"},
                    },
                    {
                        "mediaType": "application/vnd.in-toto+json",
                        "digest": provenance_blob_digests[platform],
                        "annotations": {"in-toto.io/predicate-type": "https://slsa.dev/provenance/v1"},
                    },
                ],
            },
        )
        _write_blob(
            oci_layout,
            sbom_blob_digests[platform],
            {
                "predicateType": "https://spdx.dev/Document",
                "subject": [{"digest": {"sha256": subject_digest}}],
                "predicate": {"spdxVersion": "SPDX-2.3", "name": platform},
            },
        )
        provenance_statement: dict[str, object] = {
            "predicateType": "https://slsa.dev/provenance/v1",
            "predicate": {"buildType": "https://example.invalid/build"},
        }
        if platform not in (provenance_subjectless_platforms or set()):
            provenance_statement["subject"] = [{"digest": {"sha256": subject_digest}}]
        _write_blob(oci_layout, provenance_blob_digests[platform], provenance_statement)


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell extractor tests")
def test_extractor_writes_spdx_sbom_payloads_and_metadata(tmp_path: Path) -> None:
    image_repository = "ghcr.io/example/sambee"
    image_digest = "sha256:" + "9" * 64
    image_ref = f"{image_repository}@{image_digest}"
    metadata_repository = "ghcr.io/example/sambee-signatures"
    platform_digests = {
        "linux/amd64": "sha256:" + "a" * 64,
        "linux/arm64": "sha256:" + "b" * 64,
    }
    oci_layout = tmp_path / "attested-image"
    output_dir = tmp_path / "bundle"
    _build_oci_layout(oci_layout, platform_digests)
    path_dir = _write_fake_crane(tmp_path)

    env = os.environ.copy()
    env["PATH"] = f"{path_dir}:{env['PATH']}"
    manifests = _fake_crane_outputs(image_ref, image_repository, platform_digests)
    env["FAKE_CRANE_MANIFESTS"] = json.dumps(manifests)
    result = subprocess.run(
        [
            "bash",
            str(SCRIPT_PATH),
            "--oci-layout",
            str(oci_layout),
            "--image-ref",
            image_ref,
            "--metadata-repository",
            metadata_repository,
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

    assert result.returncode == 0, result.stderr
    amd64_sbom = json.loads((output_dir / "sbom" / "linux-amd64.spdx.json").read_text(encoding="utf-8"))
    assert amd64_sbom == {"spdxVersion": "SPDX-2.3", "name": "linux/amd64"}

    provenance_lines = (output_dir / "provenance" / "intoto.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(provenance_lines) == 2
    assert {json.loads(line)["predicateType"] for line in provenance_lines} == {"https://slsa.dev/provenance/v1"}

    metadata = json.loads((output_dir / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["image_digest"] == image_digest
    assert metadata["metadata_tag"] == f"sha256-{'9' * 64}.meta"
    assert {entry["platform"] for entry in metadata["platforms"]} == {"linux/amd64", "linux/arm64"}
    assert metadata["checksums"] == {
        "provenance/intoto.jsonl": _sha256_file(output_dir / "provenance" / "intoto.jsonl"),
        "sbom/linux-amd64.spdx.json": _sha256_file(output_dir / "sbom" / "linux-amd64.spdx.json"),
        "sbom/linux-arm64.spdx.json": _sha256_file(output_dir / "sbom" / "linux-arm64.spdx.json"),
    }


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell extractor tests")
def test_extractor_accepts_local_manifest_digest_drift(tmp_path: Path) -> None:
    image_repository = "ghcr.io/example/sambee"
    image_digest = "sha256:" + "9" * 64
    image_ref = f"{image_repository}@{image_digest}"
    metadata_repository = "ghcr.io/example/sambee-signatures"
    remote_platform_digests = {
        "linux/amd64": "sha256:" + "a" * 64,
        "linux/arm64": "sha256:" + "b" * 64,
    }
    local_platform_digests = {
        "linux/amd64": "sha256:" + "7" * 64,
        "linux/arm64": "sha256:" + "8" * 64,
    }
    oci_layout = tmp_path / "attested-image"
    output_dir = tmp_path / "bundle"
    _build_oci_layout(oci_layout, local_platform_digests)
    path_dir = _write_fake_crane(tmp_path)

    env = os.environ.copy()
    env["PATH"] = f"{path_dir}:{env['PATH']}"
    manifests = _fake_crane_outputs(image_ref, image_repository, remote_platform_digests)
    env["FAKE_CRANE_MANIFESTS"] = json.dumps(manifests)
    result = subprocess.run(
        [
            "bash",
            str(SCRIPT_PATH),
            "--oci-layout",
            str(oci_layout),
            "--image-ref",
            image_ref,
            "--metadata-repository",
            metadata_repository,
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

    assert result.returncode == 0, result.stderr
    metadata = json.loads((output_dir / "metadata.json").read_text(encoding="utf-8"))
    assert {entry["manifest_digest"] for entry in metadata["platforms"]} == set(remote_platform_digests.values())

    provenance_subjects = [
        "sha256:" + json.loads(line)["subject"][0]["digest"]["sha256"]
        for line in (output_dir / "provenance" / "intoto.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert set(provenance_subjects) == set(remote_platform_digests.values())


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell extractor tests")
def test_extractor_normalizes_provenance_subjects_from_platform_attestations(tmp_path: Path) -> None:
    image_repository = "ghcr.io/example/sambee"
    image_digest = "sha256:" + "9" * 64
    image_ref = f"{image_repository}@{image_digest}"
    metadata_repository = "ghcr.io/example/sambee-signatures"
    remote_platform_digests = {
        "linux/amd64": "sha256:" + "a" * 64,
        "linux/arm64": "sha256:" + "b" * 64,
    }
    local_platform_digests = {
        "linux/amd64": "sha256:" + "7" * 64,
        "linux/arm64": "sha256:" + "8" * 64,
    }
    attestation_subject_digests = {
        "linux/amd64": "sha256:" + "c" * 64,
        "linux/arm64": "sha256:" + "d" * 64,
    }
    oci_layout = tmp_path / "attested-image"
    output_dir = tmp_path / "bundle"
    _build_oci_layout(oci_layout, local_platform_digests, attestation_subject_digests)
    path_dir = _write_fake_crane(tmp_path)

    env = os.environ.copy()
    env["PATH"] = f"{path_dir}:{env['PATH']}"
    manifests = _fake_crane_outputs(image_ref, image_repository, remote_platform_digests)
    env["FAKE_CRANE_MANIFESTS"] = json.dumps(manifests)
    result = subprocess.run(
        [
            "bash",
            str(SCRIPT_PATH),
            "--oci-layout",
            str(oci_layout),
            "--image-ref",
            image_ref,
            "--metadata-repository",
            metadata_repository,
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

    assert result.returncode == 0, result.stderr
    provenance_subjects = [
        "sha256:" + json.loads(line)["subject"][0]["digest"]["sha256"]
        for line in (output_dir / "provenance" / "intoto.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert set(provenance_subjects) == set(remote_platform_digests.values())


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell extractor tests")
def test_extractor_synthesizes_missing_provenance_subjects(tmp_path: Path) -> None:
    image_repository = "ghcr.io/example/sambee"
    image_digest = "sha256:" + "9" * 64
    image_ref = f"{image_repository}@{image_digest}"
    metadata_repository = "ghcr.io/example/sambee-signatures"
    platform_digests = {
        "linux/amd64": "sha256:" + "a" * 64,
        "linux/arm64": "sha256:" + "b" * 64,
    }
    oci_layout = tmp_path / "attested-image"
    output_dir = tmp_path / "bundle"
    _build_oci_layout(oci_layout, platform_digests, provenance_subjectless_platforms={"linux/amd64"})
    path_dir = _write_fake_crane(tmp_path)

    env = os.environ.copy()
    env["PATH"] = f"{path_dir}:{env['PATH']}"
    manifests = _fake_crane_outputs(image_ref, image_repository, platform_digests)
    env["FAKE_CRANE_MANIFESTS"] = json.dumps(manifests)
    result = subprocess.run(
        [
            "bash",
            str(SCRIPT_PATH),
            "--oci-layout",
            str(oci_layout),
            "--image-ref",
            image_ref,
            "--metadata-repository",
            metadata_repository,
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

    assert result.returncode == 0, result.stderr
    provenance_statements = [
        json.loads(line) for line in (output_dir / "provenance" / "intoto.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert {"sha256:" + statement["subject"][0]["digest"]["sha256"] for statement in provenance_statements} == set(
        platform_digests.values()
    )
    synthesized_subject = next(
        statement["subject"][0]
        for statement in provenance_statements
        if statement["subject"][0]["digest"]["sha256"] == platform_digests["linux/amd64"].removeprefix("sha256:")
    )
    assert synthesized_subject["name"] == f"{image_repository}@{platform_digests['linux/amd64']}"
