"""Private, size-bounded artifacts for completed ZIP downloads."""

import asyncio
import os
import tempfile
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

from app.models.file import FileInfo
from app.services.archive.creation import (
    ArchiveCreationCancelled,
    ArchiveCreationSource,
    build_archive_creation_manifest,
    create_archive_from_files,
)
from app.services.archive.zip_reader import ArchiveFormatError
from app.storage.base import ExclusiveWriter

DOWNLOAD_FILENAME = "Sambee-download.zip"
ARTIFACT_DIRECTORY = Path(tempfile.gettempdir()) / "sambee-archive-downloads"
STALE_ARTIFACT_SECONDS = 24 * 60 * 60


class TemporaryArchiveSizeLimitExceeded(Exception):
    """The completed archive would exceed the configured artifact cap."""


def _prepare_artifact_directory() -> None:
    ARTIFACT_DIRECTORY.mkdir(mode=0o700, exist_ok=True)
    if ARTIFACT_DIRECTORY.is_symlink() or ARTIFACT_DIRECTORY.stat().st_mode & 0o077:
        raise OSError("Temporary archive directory must be private")


def cleanup_stale_artifacts() -> None:
    """Scavenge artifacts left by terminated requests without touching live writes."""
    _prepare_artifact_directory()
    now = time.time()
    for path in ARTIFACT_DIRECTORY.glob("*.zip"):
        try:
            if now - path.stat().st_mtime > STALE_ARTIFACT_SECONDS:
                path.unlink()
        except FileNotFoundError:
            continue


class _TemporaryWriter(ExclusiveWriter):
    def __init__(self, path: Path, limit: int) -> None:
        self.path = path
        self.limit = limit
        self.size = 0
        self.handle = os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb")

    async def write(self, data: bytes) -> int:
        if self.size + len(data) > self.limit:
            raise TemporaryArchiveSizeLimitExceeded("temporary_archive_size_limit_exceeded")
        written = await asyncio.to_thread(self.handle.write, data)
        self.size += written
        return written

    async def close(self) -> None:
        await asyncio.to_thread(self.handle.close)

    async def abort_and_delete_if_owned(self) -> bool:
        await self.close()
        self.path.unlink(missing_ok=True)
        return True


class TemporaryArchiveDestination:
    """The creation writer's exclusive destination, outside user-visible storage."""

    def __init__(self, path: Path, limit: int) -> None:
        self.path = path
        self.limit = limit

    async def get_file_info(self, path: str) -> FileInfo:
        raise FileNotFoundError(path)

    async def open_exclusive_writer(self, path: str) -> ExclusiveWriter:
        if path != self.path.name:
            raise ArchiveFormatError("Invalid temporary archive target")
        return _TemporaryWriter(self.path, self.limit)


def validate_selected_roots(paths: list[str]) -> list[str]:
    if not paths:
        raise ArchiveFormatError("Select at least one source")
    normalized = []
    for path in paths:
        if (
            not path
            or path.startswith("/")
            or "\\" in path
            or "\x00" in path
            or any(segment in {"", ".", ".."} for segment in path.split("/"))
        ):
            raise ArchiveFormatError("Invalid archive selection path")
        normalized.append(path)
    if len(set(normalized)) != len(normalized) or len({path.rpartition("/")[0] for path in normalized}) != 1:
        raise ArchiveFormatError("Archive selections must be distinct items in one directory")
    return normalized


async def create_temporary_download(
    source: ArchiveCreationSource, paths: list[str], limit: int, is_cancelled: Callable[[], Awaitable[bool]] | None = None
) -> Path:
    """Preflight all selected roots and publish only a complete private ZIP."""
    paths = validate_selected_roots(paths)
    cleanup_stale_artifacts()
    artifact = ARTIFACT_DIRECTORY / f"{uuid.uuid4().hex}.zip"
    destination = TemporaryArchiveDestination(artifact, limit)
    try:
        if is_cancelled is not None and await is_cancelled():
            raise ArchiveCreationCancelled("Archive download cancelled")
        manifest = await build_archive_creation_manifest(source, paths, artifact.name, source_and_target_share_namespace=False)
        if any(not entry.info.is_readable for entry in manifest):
            raise ArchiveFormatError("Archive selection contains unreadable members")
        if is_cancelled is not None and await is_cancelled():
            raise ArchiveCreationCancelled("Archive download cancelled")
        await create_archive_from_files(
            source,
            destination=destination,
            source_paths=paths,
            target_path=artifact.name,
            preflight_entries=manifest,
            is_cancelled=is_cancelled,
        )
        return artifact
    except BaseException:
        artifact.unlink(missing_ok=True)
        raise
