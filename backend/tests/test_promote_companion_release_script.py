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
    expected_assets = [
        {
            "name": "Sambee_1.2.3_x64-setup.exe",
            "sha256": hashlib.sha256(payload).hexdigest(),
            "size": len(payload),
        }
    ]
    provenance = {
        "schema_version": 1,
        "build_tag": "build-v1.2.3",
        "release_tag": "companion-v1.2.3",
        "source_sha": "a" * 40,
        "version": "1.2.3",
        "assets": expected_assets,
    }
    provenance_bytes = json.dumps(provenance, indent=2, sort_keys=True).encode() + b"\n"
    completion = {
        "schema_version": 1,
        "provenance_sha256": hashlib.sha256(provenance_bytes).hexdigest(),
        "expected_assets": expected_assets,
    }
    completion_bytes = json.dumps(completion, indent=2, sort_keys=True).encode() + b"\n"
    urls = {
        "https://example.test/setup": payload,
        "https://example.test/provenance": provenance_bytes,
        "https://example.test/completion": completion_bytes,
    }
    assets = [
        {"name": expected_assets[0]["name"], "size": len(payload), "browser_download_url": "https://example.test/setup"},
        {"name": MODULE.PROVENANCE_ASSET_NAME, "size": len(provenance_bytes), "browser_download_url": "https://example.test/provenance"},
        {
            "name": MODULE.COMPLETION_MARKER_ASSET_NAME,
            "size": len(completion_bytes),
            "browser_download_url": "https://example.test/completion",
        },
    ]
    return {"tag_name": "companion-v1.2.3"}, assets, urls


def test_verify_release_integrity_accepts_matching_assets(monkeypatch: pytest.MonkeyPatch) -> None:
    release, assets, urls = make_release(b"installer")
    monkeypatch.setattr(MODULE, "request_bytes", urls.__getitem__)

    MODULE.verify_release_integrity(release, assets)


def test_verify_release_integrity_rejects_tampered_asset(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    release, assets, urls = make_release(b"installer")
    urls["https://example.test/setup"] = b"malicious"
    monkeypatch.setattr(MODULE, "request_bytes", urls.__getitem__)

    with pytest.raises(SystemExit):
        MODULE.verify_release_integrity(release, assets)
    assert "checksum mismatch" in capsys.readouterr().err
