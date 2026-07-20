from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Literal

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "cleanup_test_container_versions.py"


def load_cleanup_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("cleanup_test_container_versions", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, status: int, payload: bytes = b"") -> None:
        self.status = status
        self._payload = payload

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> Literal[False]:
        return False

    def read(self) -> bytes:
        return self._payload


@pytest.mark.unit
def test_api_request_returns_none_for_delete_no_content(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_cleanup_module()

    monkeypatch.setattr(
        module.urllib.request,
        "urlopen",
        lambda request: FakeResponse(204),
    )

    assert module.api_request("https://example.invalid", "token", method="DELETE") is None


@pytest.mark.unit
def test_api_request_parses_json_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_cleanup_module()

    monkeypatch.setattr(
        module.urllib.request,
        "urlopen",
        lambda request: FakeResponse(200, json.dumps({"type": "Organization"}).encode("utf-8")),
    )

    assert module.api_request("https://example.invalid", "token") == {"type": "Organization"}


@pytest.mark.unit
def test_supported_arch_specific_preview_tags_are_test_only() -> None:
    module = load_cleanup_module()

    assert module.is_test_only_tag("sha-0123456789abcdef0123456789abcdef01234567-amd64")
    assert module.is_test_only_tag("sha-0123456789abcdef0123456789abcdef01234567-arm64")


@pytest.mark.unit
def test_unknown_arch_specific_tags_are_not_test_only() -> None:
    module = load_cleanup_module()

    assert not module.is_test_only_tag("sha-0123456789abcdef0123456789abcdef01234567-s390x")


@pytest.mark.unit
def test_run_scoped_staging_tags_are_test_only() -> None:
    module = load_cleanup_module()

    for platform in ("amd64", "arm64", "index"):
        assert module.is_test_only_tag(f"staging-123456-2-{platform}")


@pytest.mark.unit
def test_malformed_staging_tags_are_not_test_only() -> None:
    module = load_cleanup_module()

    assert not module.is_test_only_tag("staging-123456-2-s390x")
    assert not module.is_test_only_tag("staging-run-2-amd64")


@pytest.mark.unit
def test_test_tag_is_protected() -> None:
    module = load_cleanup_module()

    assert module.is_protected_tag("test")
    assert not module.is_test_only_tag("test")
    assert (
        module.classify(
            module.PackageVersion(
                version_id=1,
                created_at="2026-05-17T00:00:00Z",
                tags=["test", "sha-0123456789abcdef0123456789abcdef01234567"],
            )
        )
        == "protected"
    )
