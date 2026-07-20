import json
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / ".github/scripts/manage_companion_artifact_manifest.py"
SPEC = spec_from_file_location("manage_companion_artifact_manifest", SCRIPT)
assert SPEC and SPEC.loader
MODULE = module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def make_linux_artifact(directory: Path) -> Path:
    directory.mkdir()
    (directory / "Sambee_1.2.3_amd64.deb").write_bytes(b"deb")
    (directory / "Sambee_1.2.3_amd64.AppImage").write_bytes(b"appimage")
    (directory / "Sambee_1.2.3_amd64.AppImage.sig").write_bytes(b"signature")
    return directory


def make_windows_artifact(directory: Path) -> Path:
    directory.mkdir()
    (directory / "Sambee_1.2.3_x64-setup.exe").write_bytes(b"installer")
    (directory / "Sambee_1.2.3_x64-setup.exe.sig").write_bytes(b"signature")
    return directory


def test_create_and_verify_linux_manifest(tmp_path: Path) -> None:
    artifact_dir = make_linux_artifact(tmp_path / "linux")
    artifact_manifest = artifact_dir / MODULE.ARTIFACT_MANIFEST_NAME
    MODULE.create_manifest(
        artifact_dir,
        "linux-x64",
        "x86_64-unknown-linux-gnu",
        artifact_manifest,
    )
    release_manifest = tmp_path / MODULE.RELEASE_MANIFEST_NAME
    MODULE.verify_manifests(tmp_path, release_manifest)

    payload = json.loads(release_manifest.read_text(encoding="utf-8"))
    assert payload["platforms"][0]["platform"] == "linux-x64"
    assert len(payload["platforms"][0]["assets"]) == 3


def test_verify_rejects_tampered_retained_asset(tmp_path: Path) -> None:
    artifact_dir = make_linux_artifact(tmp_path / "linux")
    MODULE.create_manifest(
        artifact_dir,
        "linux-x64",
        "x86_64-unknown-linux-gnu",
        artifact_dir / MODULE.ARTIFACT_MANIFEST_NAME,
    )
    (artifact_dir / "Sambee_1.2.3_amd64.AppImage").write_bytes(b"tampered")

    with pytest.raises(SystemExit, match="1"):
        MODULE.verify_manifests(tmp_path, tmp_path / MODULE.RELEASE_MANIFEST_NAME)


def test_verify_aggregates_multiple_platforms_with_a_stable_digest(tmp_path: Path) -> None:
    linux_dir = make_linux_artifact(tmp_path / "linux")
    windows_dir = make_windows_artifact(tmp_path / "windows")
    MODULE.create_manifest(
        linux_dir,
        "linux-x64",
        "x86_64-unknown-linux-gnu",
        linux_dir / MODULE.ARTIFACT_MANIFEST_NAME,
    )
    MODULE.create_manifest(
        windows_dir,
        "windows-x64",
        "x86_64-pc-windows-msvc",
        windows_dir / MODULE.ARTIFACT_MANIFEST_NAME,
    )
    release_manifest = tmp_path / MODULE.RELEASE_MANIFEST_NAME

    MODULE.verify_manifests(tmp_path, release_manifest)

    payload = json.loads(release_manifest.read_text(encoding="utf-8"))
    assert [platform["platform"] for platform in payload["platforms"]] == ["linux-x64", "windows-x64"]
    assert payload["manifest_sha256"] == MODULE.canonical_digest(
        {"schema_version": payload["schema_version"], "platforms": payload["platforms"]}
    )


def test_verify_rejects_duplicate_platform_manifests(tmp_path: Path) -> None:
    for directory_name in ("linux-one", "linux-two"):
        artifact_dir = make_linux_artifact(tmp_path / directory_name)
        MODULE.create_manifest(
            artifact_dir,
            "linux-x64",
            "x86_64-unknown-linux-gnu",
            artifact_dir / MODULE.ARTIFACT_MANIFEST_NAME,
        )

    with pytest.raises(SystemExit, match="1"):
        MODULE.verify_manifests(tmp_path, tmp_path / MODULE.RELEASE_MANIFEST_NAME)


def test_verify_rejects_colliding_asset_names_across_platforms(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "schema_version": 1,
        "assets": [{"name": "shared-package", "sha256": "a" * 64, "size": 1, "roles": ["installer"]}],
    }
    for directory_name, platform, target in (
        ("linux", "linux-x64", "x86_64-unknown-linux-gnu"),
        ("windows", "windows-x64", "x86_64-pc-windows-msvc"),
    ):
        directory = tmp_path / directory_name
        directory.mkdir()
        (directory / MODULE.ARTIFACT_MANIFEST_NAME).write_text(
            json.dumps({**payload, "platform": platform, "target": target}), encoding="utf-8"
        )
    monkeypatch.setattr(MODULE, "validate_manifest", lambda _manifest, _directory: None)

    with pytest.raises(SystemExit, match="1"):
        MODULE.verify_manifests(tmp_path, tmp_path / MODULE.RELEASE_MANIFEST_NAME)
