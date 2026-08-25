"""Round-trip tests for direct portable ZIP creation."""

import io
import zipfile
from collections.abc import AsyncIterator

import pytest

from app.models.file import FileInfo, FileType
from app.services.archive.creation import ArchiveCreationCancelled, create_archive_from_files
from app.services.archive.zip_writer import PortableZipWriter


class MemoryExclusiveWriter:
    def __init__(self) -> None:
        self.data = bytearray()
        self.closed = False

    async def write(self, data: bytes) -> int:
        self.data.extend(data)
        return len(data)

    async def close(self) -> None:
        self.closed = True

    async def abort_and_delete_if_owned(self) -> bool:
        self.data.clear()
        return False


class MemoryCreationBackend:
    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files
        self.target = MemoryExclusiveWriter()

    async def get_file_info(self, path: str) -> FileInfo:
        return FileInfo(name=path.rsplit("/", 1)[-1], path=path, type=FileType.FILE, size=len(self.files[path]))

    async def open_exclusive_writer(self, path: str) -> MemoryExclusiveWriter:
        return self.target

    async def _read(self, data: bytes) -> AsyncIterator[bytes]:
        yield data

    def read_file(self, path: str) -> AsyncIterator[bytes]:
        return self._read(self.files[path])


async def _chunks(data: bytes) -> AsyncIterator[bytes]:
    for position in range(0, len(data), 3):
        yield data[position : position + 3]


@pytest.mark.asyncio
async def test_writes_readable_portable_zip_without_source_staging() -> None:
    target = MemoryExclusiveWriter()
    writer = PortableZipWriter(target)

    await writer.add_directory("empty")
    await writer.add_file("notes.txt", _chunks(b"notes"))
    await writer.add_file("repeated.txt", _chunks(b"archive data " * 2_000))
    await writer.close()

    with zipfile.ZipFile(io.BytesIO(target.data)) as archive:
        assert archive.namelist() == ["empty/", "notes.txt", "repeated.txt"]
        assert archive.read("notes.txt") == b"notes"
        assert archive.read("repeated.txt") == b"archive data " * 2_000
        assert archive.getinfo("notes.txt").compress_type == zipfile.ZIP_STORED
        assert archive.getinfo("repeated.txt").compress_type == zipfile.ZIP_DEFLATED
    assert target.closed is True


@pytest.mark.asyncio
async def test_creates_direct_archive_from_regular_file_sources() -> None:
    backend = MemoryCreationBackend({"in/first.txt": b"first", "in/second.txt": b"second"})

    result = await create_archive_from_files(backend, source_paths=["in/first.txt", "in/second.txt"], target_path="out.zip")

    assert result.files_created == 2
    assert result.source_bytes == 11
    with zipfile.ZipFile(io.BytesIO(backend.target.data)) as archive:
        assert archive.read("first.txt") == b"first"
        assert archive.read("second.txt") == b"second"


@pytest.mark.asyncio
async def test_cancellation_deletes_the_owned_partial_target() -> None:
    backend = MemoryCreationBackend({"in/first.txt": b"first"})

    with pytest.raises(ArchiveCreationCancelled):
        await create_archive_from_files(
            backend,
            source_paths=["in/first.txt"],
            target_path="out.zip",
            is_cancelled=lambda: _cancelled(),
        )

    assert backend.target.data == b""


async def _cancelled() -> bool:
    return True
