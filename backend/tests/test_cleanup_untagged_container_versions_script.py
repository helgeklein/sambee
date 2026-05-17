from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "cleanup_untagged_container_versions.py"


def load_cleanup_module():
    spec = importlib.util.spec_from_file_location("cleanup_untagged_container_versions", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeCompletedProcess:
    def __init__(self, returncode: int, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


@pytest.mark.unit
def test_referenced_child_digests_protects_runnable_index_children(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_cleanup_module()
    index_digest = "sha256:" + "1" * 64
    child_digest = "sha256:" + "2" * 64
    unknown_digest = "sha256:" + "3" * 64
    versions = [
        module.PackageVersion(
            version_id=1,
            created_at="2026-05-17T00:00:00Z",
            digest=index_digest,
            tags=["test", "sha-0123456789abcdef0123456789abcdef01234567"],
        )
    ]
    manifest = {
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": [
            {"digest": child_digest, "platform": {"os": "linux", "architecture": "amd64"}},
            {"digest": unknown_digest, "platform": {"os": "unknown", "architecture": "unknown"}},
        ],
    }

    def fake_run(command, check, capture_output, text):
        assert command == ["crane", "manifest", f"ghcr.io/example/sambee@{index_digest}"]
        assert check is False
        assert capture_output is True
        assert text is True
        return FakeCompletedProcess(0, json.dumps(manifest))

    monkeypatch.setattr(module.subprocess, "run", fake_run)

    assert module.referenced_child_digests("ghcr.io/example/sambee", versions) == {
        child_digest,
        unknown_digest,
    }


@pytest.mark.unit
def test_referenced_child_digests_protects_cosign_signature_index_children(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_cleanup_module()
    index_digest = "sha256:" + "1" * 64
    signature_manifest_digest = "sha256:" + "2" * 64
    versions = [
        module.PackageVersion(
            version_id=1,
            created_at="2026-05-17T00:00:00Z",
            digest=index_digest,
            tags=["sha256-" + "a" * 64],
        )
    ]
    manifest = {
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": [
            {
                "digest": signature_manifest_digest,
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
            },
        ],
    }

    def fake_run(command, check, capture_output, text):
        assert command == [
            "crane",
            "manifest",
            f"ghcr.io/example/sambee-signatures@{index_digest}",
        ]
        return FakeCompletedProcess(0, json.dumps(manifest))

    monkeypatch.setattr(module.subprocess, "run", fake_run)

    assert module.referenced_child_digests("ghcr.io/example/sambee-signatures", versions) == {signature_manifest_digest}


@pytest.mark.unit
def test_referenced_child_digests_ignores_non_index_manifests(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_cleanup_module()
    digest = "sha256:" + "4" * 64
    versions = [
        module.PackageVersion(
            version_id=1,
            created_at="2026-05-17T00:00:00Z",
            digest=digest,
            tags=["sha-0123456789abcdef0123456789abcdef01234567"],
        )
    ]

    def fake_run(command, check, capture_output, text):
        return FakeCompletedProcess(
            0,
            json.dumps({"mediaType": "application/vnd.oci.image.manifest.v1+json", "layers": []}),
        )

    monkeypatch.setattr(module.subprocess, "run", fake_run)

    assert module.referenced_child_digests("ghcr.io/example/sambee", versions) == set()
