"""Unit tests for the bounded custom ZIP metadata reader."""

import io
import struct
import zipfile
import zlib

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


def _symbolic_link_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        member = zipfile.ZipInfo("link")
        member.create_system = 3
        member.external_attr = 0o120777 << 16
        archive.writestr(member, "target")
    return buffer.getvalue()


def _zip_with_unicode_path_extra(*, valid_crc: bool) -> bytes:
    raw_name = b"cafe.txt"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("cafe.txt", "content")
    data = bytearray(buffer.getvalue())
    local_offset = data.index(b"PK\x03\x04")
    central_offset = data.index(b"PK\x01\x02")
    data[local_offset + 30 : local_offset + 30 + len(raw_name)] = raw_name
    data[central_offset + 46 : central_offset + 46 + len(raw_name)] = raw_name
    crc32 = zlib.crc32(raw_name) & 0xFFFFFFFF
    unicode_extra = (
        struct.pack("<HHBI", 0x7075, 1 + 4 + len("café.txt".encode()), 1, crc32 if valid_crc else crc32 ^ 1) + "café.txt".encode()
    )
    name_length = struct.unpack_from("<H", data, central_offset + 28)[0]
    struct.pack_into("<H", data, central_offset + 30, len(unicode_extra))
    insert_at = central_offset + 46 + name_length
    data[insert_at:insert_at] = unicode_extra
    eocd_offset = data.rindex(b"PK\x05\x06")
    directory_size = struct.unpack_from("<I", data, eocd_offset + 12)[0]
    struct.pack_into("<I", data, eocd_offset + 12, directory_size + len(unicode_extra))
    return bytes(data)


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
async def test_lists_subdirectory_with_canonical_path() -> None:
    data = _zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    items, total, next_cursor = await reader.list_directory("folder", None, 10)

    assert total == 2
    assert next_cursor is None
    assert [item.name for item in items] == ["deeper", "nested.txt"]


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
async def test_uses_validated_infozip_unicode_path_for_unflagged_names() -> None:
    data = _zip_with_unicode_path_extra(valid_crc=True)

    entries = await ZipReader(MemoryRandomAccessReader(data), len(data)).entries()

    assert entries[0].path == "café.txt"


@pytest.mark.asyncio
async def test_ignores_infozip_unicode_path_when_its_crc_does_not_match() -> None:
    data = _zip_with_unicode_path_extra(valid_crc=False)

    entries = await ZipReader(MemoryRandomAccessReader(data), len(data)).entries()

    assert entries[0].path == "cafe.txt"


@pytest.mark.asyncio
async def test_hides_symbolic_link_members_from_virtual_listings() -> None:
    data = _symbolic_link_zip_bytes()

    items, total, next_cursor = await ZipReader(MemoryRandomAccessReader(data), len(data)).list_directory("", None, 10)

    assert items == []
    assert total == 0
    assert next_cursor is None


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
