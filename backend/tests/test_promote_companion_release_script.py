import hashlib
import json
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / ".github/scripts/promote_companion_release.py"
SPEC = spec_from_file_location("promote_companion_release", SCRIPT)
assert SPEC and SPEC.loader
MODULE = module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def make_release(payload: bytes) -> tuple[dict, list[dict], dict[str, bytes]]:
    signature_payload = b"signature"
    expected_assets = [
        {
            "name": "Sambee_1.2.3_x64-setup.exe",
            "sha256": hashlib.sha256(payload).hexdigest(),
            "size": len(payload),
        },
        {"name": "Sambee_1.2.3_x64-setup.exe.sig", "sha256": hashlib.sha256(signature_payload).hexdigest(), "size": len(signature_payload)},
    ]
    platform_assets = [
        {**expected_assets[0], "roles": ["installer", "updater"]},
        {**expected_assets[1], "roles": ["signature"]},
    ]
    release_manifest = {
        "schema_version": 1,
        "platforms": [
            {"platform": "windows-x64", "target": "x86_64-pc-windows-msvc", "manifest_sha256": "a" * 64, "assets": platform_assets}
        ],
    }
    release_manifest["manifest_sha256"] = MODULE.canonical_manifest_digest(release_manifest)
    release_manifest_bytes = json.dumps(release_manifest, indent=2, sort_keys=True).encode() + b"\n"
    expected_assets.append(
        {
            "name": MODULE.RELEASE_MANIFEST_ASSET_NAME,
            "sha256": hashlib.sha256(release_manifest_bytes).hexdigest(),
            "size": len(release_manifest_bytes),
        }
    )
    provenance = {
        "schema_version": 1,
        "build_tag": "build-v1.2.3",
        "release_tag": "companion-v1.2.3",
        "source_sha": "a" * 40,
        "version": "1.2.3",
        "artifact_manifest_sha256": hashlib.sha256(release_manifest_bytes).hexdigest(),
        "platforms": release_manifest["platforms"],
        "assets": expected_assets,
    }
    provenance_bytes = json.dumps(provenance, indent=2, sort_keys=True).encode() + b"\n"
    completion = {
        "schema_version": 1,
        "release_tag": "companion-v1.2.3",
        "artifact_manifest_sha256": provenance["artifact_manifest_sha256"],
        "provenance_sha256": hashlib.sha256(provenance_bytes).hexdigest(),
        "expected_assets": expected_assets,
        "expected_assets_sha256": MODULE.expected_asset_set_digest(expected_assets),
    }
    completion_bytes = json.dumps(completion, indent=2, sort_keys=True).encode() + b"\n"
    urls = {
        "https://example.test/setup": payload,
        "https://example.test/provenance": provenance_bytes,
        "https://example.test/completion": completion_bytes,
        "https://example.test/manifest": release_manifest_bytes,
    }
    assets = [
        {"name": expected_assets[0]["name"], "size": len(payload), "browser_download_url": "https://example.test/setup"},
        {"name": expected_assets[1]["name"], "size": len(signature_payload), "browser_download_url": "https://example.test/signature"},
        {
            "name": MODULE.RELEASE_MANIFEST_ASSET_NAME,
            "size": len(release_manifest_bytes),
            "browser_download_url": "https://example.test/manifest",
        },
        {"name": MODULE.PROVENANCE_ASSET_NAME, "size": len(provenance_bytes), "browser_download_url": "https://example.test/provenance"},
        {
            "name": MODULE.COMPLETION_MARKER_ASSET_NAME,
            "size": len(completion_bytes),
            "browser_download_url": "https://example.test/completion",
        },
    ]
    urls["https://example.test/signature"] = signature_payload
    return {"tag_name": "companion-v1.2.3"}, assets, urls


def test_verify_release_integrity_accepts_matching_assets(monkeypatch: pytest.MonkeyPatch) -> None:
    release, assets, urls = make_release(b"installer")
    monkeypatch.setattr(MODULE, "request_bytes", urls.__getitem__)

    MODULE.verify_release_integrity(release, assets)


def test_verify_release_integrity_authenticates_asset_downloads(monkeypatch: pytest.MonkeyPatch) -> None:
    release, assets, urls = make_release(b"installer")
    received_tokens = []

    def request_asset(asset: dict, token: str | None = None) -> bytes:
        received_tokens.append(token)
        return urls[asset["browser_download_url"]]

    monkeypatch.setattr(MODULE, "request_asset_bytes", request_asset)

    MODULE.verify_release_integrity(release, assets, "release-token")

    assert received_tokens
    assert set(received_tokens) == {"release-token"}


def test_verify_release_integrity_rejects_tampered_asset(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    release, assets, urls = make_release(b"installer")
    urls["https://example.test/setup"] = b"malicious"
    monkeypatch.setattr(MODULE, "request_bytes", urls.__getitem__)

    with pytest.raises(SystemExit):
        MODULE.verify_release_integrity(release, assets)
    assert "checksum mismatch" in capsys.readouterr().err


def test_verify_release_integrity_rejects_tampered_completion_asset_set(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    release, assets, urls = make_release(b"installer")
    completion = json.loads(urls["https://example.test/completion"])
    completion["expected_assets_sha256"] = "0" * 64
    urls["https://example.test/completion"] = json.dumps(completion).encode()
    monkeypatch.setattr(MODULE, "request_bytes", urls.__getitem__)

    with pytest.raises(SystemExit):
        MODULE.verify_release_integrity(release, assets)
    assert "asset-set digest" in capsys.readouterr().err


def test_verify_release_integrity_rejects_unmanifested_release_asset(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    release, assets, urls = make_release(b"installer")
    assets.append({"name": "unexpected.bin", "size": 1, "browser_download_url": "https://example.test/unexpected"})
    urls["https://example.test/unexpected"] = b"x"
    monkeypatch.setattr(MODULE, "request_bytes", urls.__getitem__)

    with pytest.raises(SystemExit):
        MODULE.verify_release_integrity(release, assets)
    assert "unexpected or missing assets" in capsys.readouterr().err


def test_verify_release_integrity_rejects_missing_manifested_release_asset(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    release, assets, urls = make_release(b"installer")
    assets[:] = [asset for asset in assets if asset["name"] != "Sambee_1.2.3_x64-setup.exe.sig"]
    monkeypatch.setattr(MODULE, "request_bytes", urls.__getitem__)

    with pytest.raises(SystemExit):
        MODULE.verify_release_integrity(release, assets)
    assert "unexpected or missing assets" in capsys.readouterr().err


def test_verify_release_integrity_rejects_release_version_mismatch(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    release, assets, urls = make_release(b"installer")
    release["tag_name"] = "companion-v1.2.4"
    monkeypatch.setattr(MODULE, "request_bytes", urls.__getitem__)

    with pytest.raises(SystemExit):
        MODULE.verify_release_integrity(release, assets)
    assert "does not match the selected release tag and version" in capsys.readouterr().err


def test_completion_asset_set_digest_is_order_independent_and_excludes_its_marker() -> None:
    release, _assets, urls = make_release(b"installer")
    completion = json.loads(urls["https://example.test/completion"])
    expected_assets = completion["expected_assets"]

    assert MODULE.COMPLETION_MARKER_ASSET_NAME not in {asset["name"] for asset in expected_assets}
    assert completion["expected_assets_sha256"] == MODULE.expected_asset_set_digest(list(reversed(expected_assets)))
    assert release["tag_name"] == completion["release_tag"]
