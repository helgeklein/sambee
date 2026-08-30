"""Unit tests for the bounded custom ZIP metadata reader."""

import io
import struct
import zipfile
import zlib

import pytest

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


def _zip_with_underreported_size(compression: int) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=compression) as archive:
        archive.writestr("data.txt", b"oversized member")
    data = bytearray(buffer.getvalue())
    central_offset = data.index(b"PK\x01\x02")
    struct.pack_into("<I", data, central_offset + 24, 1)
    return bytes(data)


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
    manifest = await ZipReader(MemoryRandomAccessReader(data), len(data)).inspection_manifest()
    page = manifest.list_directory("", None, 10)

    assert page.total == 2
    assert page.next_cursor is None
    assert [(item.name, item.is_directory) for item in page.entries] == [("folder", True), ("root.txt", False)]


@pytest.mark.asyncio
async def test_projects_a_normalized_inspection_manifest() -> None:
    data = _zip_bytes()

    manifest = await ZipReader(MemoryRandomAccessReader(data), len(data)).inspection_manifest()

    assert [(entry.path, entry.is_directory, entry.preview_state) for entry in manifest.entries] == [
        ("root.txt", False, "readable"),
        ("folder/nested.txt", False, "readable"),
        ("folder/deeper/item.txt", False, "readable"),
    ]


@pytest.mark.asyncio
async def test_pages_subdirectory_listing_stably() -> None:
    data = _zip_bytes()
    manifest = await ZipReader(MemoryRandomAccessReader(data), len(data)).inspection_manifest()
    first_page = manifest.list_directory("folder/", None, 1)
    second_page = manifest.list_directory("folder/", first_page.next_cursor, 1)

    assert first_page.total == 2
    assert [item.name for item in first_page.entries] == ["deeper"]
    assert [item.name for item in second_page.entries] == ["nested.txt"]
    assert second_page.next_cursor is None


@pytest.mark.asyncio
async def test_lists_subdirectory_with_canonical_path() -> None:
    data = _zip_bytes()
    manifest = await ZipReader(MemoryRandomAccessReader(data), len(data)).inspection_manifest()
    page = manifest.list_directory("folder", None, 10)

    assert page.total == 2
    assert page.next_cursor is None
    assert [item.name for item in page.entries] == ["deeper", "nested.txt"]


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

    page = (await ZipReader(MemoryRandomAccessReader(data), len(data)).inspection_manifest()).list_directory("", None, 10)

    assert page.total == 1
    assert page.entries[0].name == "folder"
    assert page.entries[0].is_directory


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

    page = (await ZipReader(MemoryRandomAccessReader(data), len(data)).inspection_manifest()).list_directory("", None, 10)

    assert page.entries == ()
    assert page.total == 0
    assert page.next_cursor is None


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


@pytest.mark.asyncio
@pytest.mark.parametrize("compression", [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2])
async def test_rejects_member_before_yielding_bytes_beyond_its_declared_size(compression: int) -> None:
    reader = ZipReader(MemoryRandomAccessReader(_zip_with_underreported_size(compression)), len(_zip_with_underreported_size(compression)))
    chunks: list[bytes] = []

    with pytest.raises(ArchiveFormatError, match="exceeds its declared"):
        async for chunk in reader.stream_member("data.txt", chunk_size=1):
            chunks.append(chunk)

    assert len(b"".join(chunks)) <= 1


@pytest.mark.asyncio
async def test_caches_parsed_central_directory_entries() -> None:
    data = _zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    first_entries = await reader.entries()
    second_entries = await reader.entries()

    assert first_entries == second_entries
    assert reader._entries is not None
