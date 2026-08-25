"""Unit tests for the bounded custom ZIP metadata reader."""

import io
import zipfile

import pytest

from app.models.file import FileType
from app.services.archive.zip_reader import ArchiveFormatError, ZipReader


class MemoryRandomAccessReader:
    """In-memory reader used only to exercise archive metadata parsing."""

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.closed = False

    async def read_at(self, offset: int, length: int) -> bytes:
        return self.data[offset : offset + length]

    async def close(self) -> None:
        self.closed = True


def _zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("root.txt", "root")
        archive.writestr("folder/nested.txt", "nested")
        archive.writestr("folder/deeper/item.txt", "item")
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_lists_root_and_implicit_directory() -> None:
    data = _zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    items, total, next_cursor = await reader.list_directory("", None, 10)

    assert total == 2
    assert next_cursor is None
    assert [(item.name, item.type) for item in items] == [("folder", FileType.DIRECTORY), ("root.txt", FileType.FILE)]


@pytest.mark.asyncio
async def test_pages_subdirectory_listing_stably() -> None:
    data = _zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    first_page, total, cursor = await reader.list_directory("folder/", None, 1)
    second_page, _, final_cursor = await reader.list_directory("folder/", cursor, 1)

    assert total == 2
    assert [item.name for item in first_page] == ["deeper"]
    assert [item.name for item in second_page] == ["nested.txt"]
    assert final_cursor is None


@pytest.mark.asyncio
async def test_rejects_non_zip_bytes() -> None:
    reader = ZipReader(MemoryRandomAccessReader(b"not a zip" * 4), len(b"not a zip" * 4))

    with pytest.raises(ArchiveFormatError, match="end-of-central-directory"):
        await reader.entries()


@pytest.mark.asyncio
async def test_streams_and_verifies_deflated_member() -> None:
    data = _zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    chunks = [chunk async for chunk in reader.stream_member("folder/nested.txt", chunk_size=2)]

    assert b"".join(chunks) == b"nested"


@pytest.mark.asyncio
async def test_rejects_invalid_member_stream_chunk_sizes() -> None:
    data = _zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    with pytest.raises(ValueError, match="between 1"):
        await anext(reader.stream_member("folder/nested.txt", chunk_size=0))


@pytest.mark.asyncio
async def test_normalizes_backslash_member_names() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("folder\\entry.txt", "entry")
    data = buffer.getvalue()

    items, total, _ = await ZipReader(MemoryRandomAccessReader(data), len(data)).list_directory("", None, 10)

    assert total == 1
    assert items[0].name == "folder"
    assert items[0].type == FileType.DIRECTORY


@pytest.mark.asyncio
async def test_streams_bzip2_member_in_bounded_chunks() -> None:
    buffer = io.BytesIO()
    expected = b"bounded bzip2 member " * 20_000
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_BZIP2) as archive:
        archive.writestr("data.txt", expected)
    data = buffer.getvalue()

    chunks = [chunk async for chunk in ZipReader(MemoryRandomAccessReader(data), len(data)).stream_member("data.txt", chunk_size=1024)]

    assert b"".join(chunks) == expected
    assert max(map(len, chunks)) <= 1024
