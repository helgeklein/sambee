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
        "version": IDENTITY.version,
        "build_tag": IDENTITY.build_tag,
        "source_sha": IDENTITY.source_sha,
        "release_tag": IDENTITY.release_tag,
    }
    if recoverable:
        provenance["workflow_run"] = {"id": 123, "attempt": 1}
        provenance["actions_artifacts"] = [{"id": 456, "name": "companion-123-1-linux"}]
    assets = [{"name": MODULE.PROVENANCE_ASSET, "url": "provenance"}]
    if completion:
        assets.append({"name": MODULE.COMPLETION_ASSET, "url": "completion"})
    return {"draft": draft, "assets": assets, "provenance": provenance}


def asset_json(asset: dict, _token: str) -> dict:
    return CURRENT_RELEASE["provenance"]


CURRENT_RELEASE: dict = {}


def test_missing_release_requires_build() -> None:
    assert MODULE.resolve_state(None, IDENTITY, "token") == "build"


def test_matching_complete_release_skips_build(monkeypatch: pytest.MonkeyPatch) -> None:
    global CURRENT_RELEASE
    CURRENT_RELEASE = release(draft=False, completion=True)
    monkeypatch.setattr(MODULE, "request_asset_json", asset_json)

    assert MODULE.resolve_state(CURRENT_RELEASE, IDENTITY, "token") == "complete"


def test_matching_draft_with_retained_artifacts_recovers(monkeypatch: pytest.MonkeyPatch) -> None:
    global CURRENT_RELEASE
    CURRENT_RELEASE = release(draft=True, completion=False, recoverable=True)
    monkeypatch.setattr(MODULE, "request_asset_json", asset_json)

    assert MODULE.resolve_state(CURRENT_RELEASE, IDENTITY, "token") == "recover-finalizer"


def test_conflicting_release_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    global CURRENT_RELEASE
    CURRENT_RELEASE = release(draft=True, completion=False, recoverable=True)
    CURRENT_RELEASE["provenance"]["source_sha"] = "b" * 40
    monkeypatch.setattr(MODULE, "request_asset_json", asset_json)

    with pytest.raises(SystemExit, match="1"):
        MODULE.resolve_state(CURRENT_RELEASE, IDENTITY, "token")
