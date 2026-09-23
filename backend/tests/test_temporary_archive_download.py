"""Private artifact behavior for selected-root archive downloads."""

import io
import json
import os
import time
import zipfile
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import browser
from app.core.system_setting_definitions import SYSTEM_SETTING_DEFINITIONS, SystemSettingKey
from app.models.file import DirectoryListing, FileInfo, FileType
from app.services.archive import temporary_download
from app.services.archive.creation import ArchiveCreationCancelled
from app.services.archive.temporary_download import TemporaryArchiveSizeLimitExceeded, create_temporary_download
from app.services.archive.zip_creation_source import ZipArchiveCreationSource
from app.services.archive.zip_reader import ArchiveFormatError, ZipReader


@pytest.mark.asyncio
async def test_companion_download_session_is_scoped_and_single_use(monkeypatch: pytest.MonkeyPatch) -> None:
    browser._download_sessions.clear()
    monkeypatch.setattr(browser, "get_integer_setting_value", lambda _: 123456)
    alice = SimpleNamespace(username="alice")
    bob = SimpleNamespace(username="bob")
    drive = browser.CompanionDownloadSessionRequest(drive="test-drive")
    other_drive = browser.CompanionDownloadSessionRequest(drive="other-drive")
    session = await browser.issue_companion_download_session(drive, alice)
    monkeypatch.setattr(browser, "get_integer_setting_value", lambda _: 999999)

    for user, requested_drive in ((bob, drive), (alice, other_drive)):
        with pytest.raises(HTTPException) as rejected:
            await browser.consume_companion_download_session(session.token, requested_drive, user)
        assert rejected.value.status_code == 403

    assert (await browser.consume_companion_download_session(session.token, drive, alice)).size_limit_bytes == 123456
    with pytest.raises(HTTPException) as replay:
        await browser.consume_companion_download_session(session.token, drive, alice)
    assert replay.value.status_code == 403


@pytest.mark.asyncio
async def test_companion_download_session_expiry(monkeypatch: pytest.MonkeyPatch) -> None:
    browser._download_sessions.clear()
    user = SimpleNamespace(username="alice")
    drive = browser.CompanionDownloadSessionRequest(drive="test-drive")
    session = await browser.issue_companion_download_session(drive, user)
    browser._download_sessions[session.token] = (browser.monotonic() - 1, "alice", "test-drive", 123456)
    with pytest.raises(HTTPException) as expired:
        await browser.consume_companion_download_session(session.token, drive, user)
    assert expired.value.status_code == 403


@pytest.mark.asyncio
async def test_companion_download_session_rejects_excess_pending_capabilities(monkeypatch: pytest.MonkeyPatch) -> None:
    browser._download_sessions.clear()
    monkeypatch.setattr(browser, "MAX_COMPANION_DOWNLOAD_SESSIONS", 1)
    user = SimpleNamespace(username="alice")
    drive = browser.CompanionDownloadSessionRequest(drive="test-drive")
    first = await browser.issue_companion_download_session(drive, user)
    with pytest.raises(HTTPException) as rejected:
        await browser.issue_companion_download_session(drive, user)
    assert rejected.value.status_code == 429
    await browser.consume_companion_download_session(first.token, drive, user)
    assert (await browser.issue_companion_download_session(drive, user)).token != first.token


class _Source:
    def __init__(self) -> None:
        self.entries = {
            "parent/folder": FileInfo(name="folder", path="parent/folder", type=FileType.DIRECTORY),
            "parent/folder/empty": FileInfo(name="empty", path="parent/folder/empty", type=FileType.DIRECTORY),
            "parent/file.txt": FileInfo(name="file.txt", path="parent/file.txt", type=FileType.FILE, size=5),
        }

    async def get_file_info(self, path: str) -> FileInfo:
        return self.entries[path]

    async def list_directory(self, path: str = "") -> DirectoryListing:
        children = [item for item in self.entries.values() if item.path.rpartition("/")[0] == path]
        return DirectoryListing(path=path, items=children, total=len(children))

    async def read_file(self, path: str) -> AsyncIterator[bytes]:
        yield b"hello"


@pytest.mark.asyncio
async def test_selected_roots_have_no_source_parent_and_preserve_empty_directories(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    scenario = json.loads(
        (Path(__file__).resolve().parents[2] / "archive-contract/v2/fixtures/temporary-download-scenarios-v2.json").read_text()
    )["physical_selection"]
    monkeypatch.setattr(temporary_download, "ARTIFACT_DIRECTORY", tmp_path)
    artifact = await create_temporary_download(_Source(), scenario["roots"], 1024 * 1024)
    try:
        with zipfile.ZipFile(artifact) as archive:
            assert set(archive.namelist()) == set(scenario["expected_paths"])
            assert archive.read(scenario["file_path"]).decode() == scenario["file_contents"]
    finally:
        artifact.unlink()


@pytest.mark.asyncio
async def test_limit_failure_deletes_owned_artifact(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    scenario = json.loads(
        (Path(__file__).resolve().parents[2] / "archive-contract/v2/fixtures/temporary-download-scenarios-v2.json").read_text()
    )["physical_selection"]
    monkeypatch.setattr(temporary_download, "ARTIFACT_DIRECTORY", tmp_path)
    with pytest.raises(TemporaryArchiveSizeLimitExceeded):
        await create_temporary_download(_Source(), scenario["roots"], scenario["reject_limit_bytes"])
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_cancelled_selection_leaves_no_owned_artifact(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    scenario = json.loads(
        (Path(__file__).resolve().parents[2] / "archive-contract/v2/fixtures/temporary-download-scenarios-v2.json").read_text()
    )["physical_selection"]
    monkeypatch.setattr(temporary_download, "ARTIFACT_DIRECTORY", tmp_path)

    async def is_cancelled() -> bool:
        return scenario["cancel_before_write"]

    with pytest.raises(ArchiveCreationCancelled):
        await create_temporary_download(_Source(), scenario["roots"], 1024 * 1024, is_cancelled)
    assert len(list(tmp_path.iterdir())) == scenario["expected_artifacts_after_cancel"]


@pytest.mark.asyncio
async def test_invalid_roots_fail_before_artifact_creation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(temporary_download, "ARTIFACT_DIRECTORY", tmp_path)
    for roots in ([], ["parent/file.txt", "parent/file.txt"], ["parent/file.txt", "other/file.txt"], ["../file.txt"]):
        with pytest.raises(ArchiveFormatError):
            await create_temporary_download(_Source(), roots, 1024 * 1024)
    assert list(tmp_path.iterdir()) == []


def test_default_limit_and_stale_artifact_cleanup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(temporary_download, "ARTIFACT_DIRECTORY", tmp_path)
    limit = SYSTEM_SETTING_DEFINITIONS[SystemSettingKey.TEMPORARY_ARCHIVE_DOWNLOAD_SIZE_BYTES]
    assert limit.default_value == 250 * 1024 * 1024
    assert limit.step == 1024 * 1024
    stale = tmp_path / "orphan.zip"
    stale.write_bytes(b"old")
    old_time = time.time() - temporary_download.STALE_ARTIFACT_SECONDS - 1
    os.utime(stale, (old_time, old_time))
    recent = tmp_path / "recent.zip"
    recent.write_bytes(b"active")
    temporary_download.cleanup_stale_artifacts()
    assert not stale.exists()
    assert recent.exists()


class _MemoryArchive:
    def __init__(self, data: bytes) -> None:
        self.data = data

    async def read_at(self, offset: int, length: int) -> bytes:
        return self.data[offset : offset + length]

    async def close(self) -> None:
        pass


@pytest.mark.asyncio
async def test_zip_member_source_preserves_selected_roots(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(temporary_download, "ARTIFACT_DIRECTORY", tmp_path)
    original = io.BytesIO()
    with zipfile.ZipFile(original, "w") as archive:
        archive.writestr("nested/empty/", "")
        archive.writestr("nested/report.txt", "hello")
    source = ZipArchiveCreationSource(ZipReader(_MemoryArchive(original.getvalue()), len(original.getvalue())))
    artifact = await create_temporary_download(source, ["nested"], 1024 * 1024)
    try:
        with zipfile.ZipFile(artifact) as archive:
            assert set(archive.namelist()) == {"nested/", "nested/empty/", "nested/report.txt"}
            assert archive.read("nested/report.txt") == b"hello"
    finally:
        artifact.unlink()


@pytest.mark.asyncio
async def test_missing_zip_root_fails_without_artifact(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(temporary_download, "ARTIFACT_DIRECTORY", tmp_path)
    original = io.BytesIO()
    with zipfile.ZipFile(original, "w") as archive:
        archive.writestr("report.txt", "hello")
    source = ZipArchiveCreationSource(ZipReader(_MemoryArchive(original.getvalue()), len(original.getvalue())))
    with pytest.raises(FileNotFoundError):
        await create_temporary_download(source, ["missing.txt"], 1024 * 1024)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_unsafe_zip_member_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(temporary_download, "ARTIFACT_DIRECTORY", tmp_path)
    original = io.BytesIO()
    with zipfile.ZipFile(original, "w") as archive:
        archive.writestr("report.txt", "hello")
        archive.writestr("../unsafe.txt", "blocked")
    source = ZipArchiveCreationSource(ZipReader(_MemoryArchive(original.getvalue()), len(original.getvalue())))
    with pytest.raises(ArchiveFormatError, match="unsafe"):
        await source.validate_projection()
    assert list(tmp_path.iterdir()) == []
