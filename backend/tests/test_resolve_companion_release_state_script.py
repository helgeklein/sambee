import hashlib
import json
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / ".github/scripts/resolve_companion_release_state.py"
SPEC = spec_from_file_location("resolve_companion_release_state", SCRIPT)
assert SPEC and SPEC.loader
MODULE = module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

IDENTITY = MODULE.ReleaseIdentity(
    version="1.2.3",
    build_tag="build-v1.2.3",
    source_sha="a" * 40,
    release_tag="companion-v1.2.3",
)


def release(*, draft: bool, completion: bool, recoverable: bool = False) -> dict:
    provenance = {
        "schema_version": 1,
        "version": IDENTITY.version,
        "build_tag": IDENTITY.build_tag,
        "source_sha": IDENTITY.source_sha,
        "release_tag": IDENTITY.release_tag,
        "assets": [],
    }
    if recoverable:
        provenance["workflow_run"] = {"id": 123, "attempt": 1}
        provenance["artifact_manifest_sha256"] = "a" * 64
        provenance["platforms"] = [{"platform": "linux-x64", "target": "x86_64-unknown-linux-gnu"}]
        provenance["actions_artifacts"] = [
            {
                "id": 456,
                "name": "companion-123-1-linux",
                "digest": "sha256:" + "a" * 64,
                "platform": "linux-x64",
                "target": "x86_64-unknown-linux-gnu",
            }
        ]
    assets = [{"name": MODULE.PROVENANCE_ASSET, "url": "provenance"}]
    if completion:
        assets.append({"name": MODULE.COMPLETION_ASSET, "url": "completion"})
    provenance_bytes = json.dumps(provenance, indent=2, sort_keys=True).encode() + b"\n"
    return {
        "draft": draft,
        "assets": assets,
        "provenance": provenance,
        "completion": {
            "schema_version": 1,
            "provenance_sha256": hashlib.sha256(provenance_bytes).hexdigest(),
            "expected_assets": provenance.get("assets", []),
            "expected_assets_sha256": MODULE.expected_asset_set_digest(provenance.get("assets", [])),
        },
    }


def asset_json(asset: dict, _token: str) -> dict:
    if asset["name"] == MODULE.PROVENANCE_ASSET:
        return CURRENT_RELEASE["provenance"]
    return CURRENT_RELEASE["completion"]


def asset_bytes(asset: dict, _token: str) -> bytes:
    if asset["name"] == MODULE.PROVENANCE_ASSET:
        return json.dumps(CURRENT_RELEASE["provenance"], indent=2, sort_keys=True).encode() + b"\n"
    return json.dumps(CURRENT_RELEASE["completion"], indent=2, sort_keys=True).encode() + b"\n"


CURRENT_RELEASE: dict = {}


def test_missing_release_requires_build() -> None:
    assert MODULE.resolve_state(None, IDENTITY, "token") == "build"


def test_matching_complete_release_skips_build(monkeypatch: pytest.MonkeyPatch) -> None:
    global CURRENT_RELEASE
    CURRENT_RELEASE = release(draft=False, completion=True)
    monkeypatch.setattr(MODULE, "request_asset_json", asset_json)
    monkeypatch.setattr(MODULE, "request_asset_bytes", asset_bytes)

    assert MODULE.resolve_state(CURRENT_RELEASE, IDENTITY, "token") == "complete"


def test_matching_draft_with_retained_artifacts_recovers(monkeypatch: pytest.MonkeyPatch) -> None:
    global CURRENT_RELEASE
    CURRENT_RELEASE = release(draft=True, completion=False, recoverable=True)
    monkeypatch.setattr(MODULE, "request_asset_json", asset_json)
    monkeypatch.setattr(MODULE, "request_asset_bytes", asset_bytes)

    assert MODULE.resolve_state(CURRENT_RELEASE, IDENTITY, "token") == "recover-finalizer"


def test_conflicting_release_fails_closed(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    global CURRENT_RELEASE
    CURRENT_RELEASE = release(draft=True, completion=False, recoverable=True)
    CURRENT_RELEASE["provenance"]["source_sha"] = "b" * 40
    monkeypatch.setattr(MODULE, "request_asset_json", asset_json)
    monkeypatch.setattr(MODULE, "request_asset_bytes", asset_bytes)

    with pytest.raises(SystemExit, match="1"):
        MODULE.resolve_state(CURRENT_RELEASE, IDENTITY, "token")

    error_output = capsys.readouterr().err
    assert "Increment the third build-sequence component in VERSION" in error_output
    assert "run ./scripts/sync-version" in error_output


def test_invalid_completion_marker_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    global CURRENT_RELEASE
    CURRENT_RELEASE = release(draft=False, completion=True)
    CURRENT_RELEASE["completion"]["expected_assets_sha256"] = "0" * 64
    monkeypatch.setattr(MODULE, "request_asset_json", asset_json)
    monkeypatch.setattr(MODULE, "request_asset_bytes", asset_bytes)

    with pytest.raises(SystemExit, match="1"):
        MODULE.resolve_state(CURRENT_RELEASE, IDENTITY, "token")


def test_completion_with_mismatched_provenance_digest_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    global CURRENT_RELEASE
    CURRENT_RELEASE = release(draft=False, completion=True)
    CURRENT_RELEASE["completion"]["provenance_sha256"] = "0" * 64
    monkeypatch.setattr(MODULE, "request_asset_json", asset_json)
    monkeypatch.setattr(MODULE, "request_asset_bytes", asset_bytes)

    with pytest.raises(SystemExit, match="1"):
        MODULE.resolve_state(CURRENT_RELEASE, IDENTITY, "token")


def test_recovery_rejects_retained_artifact_without_digest(monkeypatch: pytest.MonkeyPatch) -> None:
    global CURRENT_RELEASE
    CURRENT_RELEASE = release(draft=True, completion=False, recoverable=True)
    CURRENT_RELEASE["provenance"]["actions_artifacts"][0]["digest"] = ""
    monkeypatch.setattr(MODULE, "request_asset_json", asset_json)
    monkeypatch.setattr(MODULE, "request_asset_bytes", asset_bytes)

    with pytest.raises(SystemExit, match="1"):
        MODULE.resolve_state(CURRENT_RELEASE, IDENTITY, "token")


def test_recovery_rejects_non_integer_workflow_attempt(monkeypatch: pytest.MonkeyPatch) -> None:
    global CURRENT_RELEASE
    CURRENT_RELEASE = release(draft=True, completion=False, recoverable=True)
    CURRENT_RELEASE["provenance"]["workflow_run"]["attempt"] = "1"
    monkeypatch.setattr(MODULE, "request_asset_json", asset_json)
    monkeypatch.setattr(MODULE, "request_asset_bytes", asset_bytes)

    with pytest.raises(SystemExit, match="1"):
        MODULE.resolve_state(CURRENT_RELEASE, IDENTITY, "token")
