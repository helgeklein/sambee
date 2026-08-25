"""Tests for same-executor direct ZIP extraction."""

import io
import zipfile
from collections.abc import AsyncIterator

import pytest

from app.models.file import FileInfo, FileType
from app.services.archive.extraction import ArchiveExtractionCancelled, extract_archive_to_new_paths


class MemoryRandomReader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.closed = False

    async def read_at(self, offset: int, length: int) -> bytes:
        return self.data[offset : offset + length]

    async def close(self) -> None:
        self.closed = True


class MemoryExtractionBackend:
    def __init__(self, archive: bytes) -> None:
        self.archive = archive
        self.reader = MemoryRandomReader(archive)
        self.directories: set[str] = set()
        self.files: dict[str, bytes] = {}

    async def get_file_info(self, path: str) -> FileInfo:
        if path == "input.zip":
            return FileInfo(name="input.zip", path=path, type=FileType.FILE, size=len(self.archive))
        if path in self.directories:
            return FileInfo(name=path.rsplit("/", 1)[-1], path=path, type=FileType.DIRECTORY)
        if path in self.files:
            return FileInfo(name=path.rsplit("/", 1)[-1], path=path, type=FileType.FILE, size=len(self.files[path]))
        raise FileNotFoundError(path)

    async def open_random_access_reader(self, path: str) -> MemoryRandomReader:
        assert path == "input.zip"
        return self.reader

    async def create_directory(self, path: str) -> None:
        if path in self.directories:
            raise FileExistsError(path)
        self.directories.add(path)

    async def write_file_from_stream(
        self,
        path: str,
        stream: AsyncIterator[bytes],
        *,
        overwrite: bool = False,
        source_mtime: object | None = None,
    ) -> int:
        del overwrite, source_mtime
        if path in self.files:
            raise FileExistsError(path)
        content = b"".join([chunk async for chunk in stream])
        self.files[path] = content
        return len(content)


def _archive_bytes() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("docs/readme.txt", "readme")
        archive.writestr("root.txt", "root")
    return output.getvalue()


@pytest.mark.asyncio
async def test_extracts_safe_members_to_new_paths() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    result = await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert result.files_extracted == 2
    assert result.extracted_bytes == 10
    assert backend.directories == {"output", "output/docs"}
    assert backend.files == {"output/docs/readme.txt": b"readme", "output/root.txt": b"root"}
    assert backend.reader.closed is True


@pytest.mark.asyncio
async def test_cancellation_stops_before_writing_members() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    with pytest.raises(ArchiveExtractionCancelled):
        await extract_archive_to_new_paths(
            backend,
            archive_path="input.zip",
            destination_root="output",
            is_cancelled=lambda: _cancelled(),
        )

    assert backend.files == {}
    assert backend.reader.closed is True


async def _cancelled() -> bool:
    return True