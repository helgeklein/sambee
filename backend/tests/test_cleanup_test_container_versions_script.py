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
        assert module.is_test_only_tag(f"stage-123456-2-{platform}")


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


@pytest.mark.unit
def test_delete_exact_staging_tag_deletes_only_matching_staging_version(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_cleanup_module()
    staging_tag = "stage-123456-2-index"
    deleted_version_ids: list[int] = []
    monkeypatch.setattr(
        module, "delete_version", lambda _owner, _owner_type, _package, version_id, _token: deleted_version_ids.append(version_id)
    )

    deleted = module.delete_exact_staging_tag(
        [
            module.PackageVersion(version_id=1, created_at="2026-05-17T00:00:00Z", tags=[staging_tag]),
            module.PackageVersion(version_id=2, created_at="2026-05-17T00:00:00Z", tags=["test"]),
        ],
        staging_tag,
        "example",
        "User",
        "sambee",
        "token",
    )

    assert deleted
    assert deleted_version_ids == [1]


@pytest.mark.unit
def test_delete_exact_staging_tag_rejects_shared_protected_version(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_cleanup_module()
    staging_tag = "stage-123456-2-index"
    monkeypatch.setattr(module, "delete_version", pytest.fail)

    with pytest.raises(RuntimeError, match="shares it with tags outside the current run"):
        module.delete_exact_staging_tag(
            [module.PackageVersion(version_id=1, created_at="2026-05-17T00:00:00Z", tags=[staging_tag, "test"])],
            staging_tag,
            "example",
            "User",
            "sambee",
            "token",
        )


@pytest.mark.unit
def test_delete_exact_staging_tag_rejects_non_staging_tag() -> None:
    module = load_cleanup_module()

    with pytest.raises(ValueError, match="Refusing to delete non-index stage tag"):
        module.delete_exact_staging_tag([], "test", "example", "User", "sambee", "token")


@pytest.mark.unit
def test_delete_exact_staging_tag_deletes_whole_package_when_current_run_owns_every_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_cleanup_module()
    staging_tag = "stage-123456-2-index"
    deleted_packages: list[str] = []
    monkeypatch.setattr(module, "delete_version", pytest.fail)
    monkeypatch.setattr(
        module,
        "delete_package",
        lambda _owner, _owner_type, package_name, _token: deleted_packages.append(package_name),
    )

    deleted = module.delete_exact_staging_tag(
        [
            module.PackageVersion(version_id=1, created_at="2026-05-17T00:00:00Z", tags=[staging_tag]),
            module.PackageVersion(version_id=2, created_at="2026-05-17T00:00:00Z", tags=["stage-123456-2-amd64"]),
            module.PackageVersion(version_id=3, created_at="2026-05-17T00:00:00Z", tags=[]),
        ],
        staging_tag,
        "example",
        "User",
        "sambee-staging",
        "token",
    )

    assert deleted
    assert deleted_packages == ["sambee-staging"]


@pytest.mark.unit
def test_delete_exact_staging_tag_refuses_whole_package_deletion_outside_staging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_cleanup_module()
    staging_tag = "stage-123456-2-index"
    monkeypatch.setattr(module, "delete_version", pytest.fail)

    with pytest.raises(RuntimeError, match="outside the isolated staging package"):
        module.delete_exact_staging_tag(
            [
                module.PackageVersion(
                    version_id=1,
                    created_at="2026-05-17T00:00:00Z",
                    tags=[staging_tag],
                )
            ],
            staging_tag,
            "example",
            "User",
            "sambee",
            "token",
        )


@pytest.mark.unit
def test_scheduled_cleanup_deletes_fully_disposable_package_when_explicitly_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_cleanup_module()
    versions = [
        module.PackageVersion(version_id=1, created_at="2026-05-17T00:00:00Z", tags=["stage-123456-2-index"]),
        module.PackageVersion(version_id=2, created_at="2026-05-17T00:00:00Z", tags=["stage-123456-2-amd64"]),
        module.PackageVersion(version_id=3, created_at="2026-05-17T00:00:00Z", tags=[]),
    ]
    deleted_packages: list[str] = []
    monkeypatch.setattr(module, "get_owner_type", lambda _owner, _token: "User")
    monkeypatch.setattr(module, "load_versions", lambda *_args: versions)
    monkeypatch.setattr(
        module,
        "delete_package",
        lambda _owner, _owner_type, package_name, _token: deleted_packages.append(package_name),
    )
    monkeypatch.setattr(module, "delete_version", pytest.fail)
    monkeypatch.setattr(sys, "argv", ["cleanup", "--owner", "example", "--package-name", "sambee-staging", "--allow-package-delete"])
    monkeypatch.setenv("GITHUB_TOKEN", "token")

    assert module.main() == 0
    assert deleted_packages == ["sambee-staging"]


@pytest.mark.unit
def test_scheduled_cleanup_rejects_package_delete_outside_staging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_cleanup_module()
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "cleanup",
            "--owner",
            "example",
            "--package-name",
            "sambee",
            "--allow-package-delete",
        ],
    )

    with pytest.raises(RuntimeError, match="only valid for the isolated staging package"):
        module.main()
