"""Unit tests for the bounded custom ZIP metadata reader."""

import io
import logging
import math
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


class CountingRandomAccessReader(MemoryRandomAccessReader):
    def __init__(self, data: bytes) -> None:
        super().__init__(data)
        self.reads: list[tuple[int, int]] = []

    async def read_at(self, offset: int, length: int) -> bytes:
        self.reads.append((offset, length))
        return await super().read_at(offset, length)

    @property
    def read_count(self) -> int:
        return len(self.reads)

    @property
    def total_bytes_read(self) -> int:
        return sum(length for _, length in self.reads)


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


def _large_directory_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        for index in range(10_000):
            archive.writestr(f"directory/{index:05d}-{'x' * 64}.txt", b"")
    return buffer.getvalue()


def _large_nested_directory_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        for index in range(10_000):
            archive.writestr(f"nested/{index:05d}/entry.txt", b"")
    return buffer.getvalue()


def _duplicate_name_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("duplicate.txt", b"first")
        archive.writestr("duplicate.txt", b"second entry")
    return buffer.getvalue()


def _normalized_duplicate_name_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("folder\\entry.txt", b"first")
        archive.writestr("folder/entry.txt", b"second entry")
    return buffer.getvalue()


def _file_then_directory_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("member", b"file content")
        archive.writestr("member/", b"")
    return buffer.getvalue()


def _case_distinct_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("Report.txt", b"upper")
        archive.writestr("report.txt", b"lower")
    return buffer.getvalue()


def _effective_directory_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("empty/", b"")
        archive.writestr("empty/", b"")
        archive.writestr("nested/readme.txt", b"readme")
    return buffer.getvalue()


def _regular_then_symbolic_duplicate_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("member", b"readable payload")
        member = zipfile.ZipInfo("member")
        member.create_system = 3
        member.external_attr = 0o120777 << 16
        archive.writestr(member, b"target")
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
async def test_rejects_symbolic_link_members_from_virtual_listings() -> None:
    data = _symbolic_link_zip_bytes()

    with pytest.raises(ArchiveFormatError, match="symbolic link"):
        await ZipReader(MemoryRandomAccessReader(data), len(data)).inspection_manifest()


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


@pytest.mark.asyncio
async def test_logs_aggregate_parse_and_validation_metrics_without_member_path(caplog: pytest.LogCaptureFixture) -> None:
    data = _zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    with caplog.at_level(logging.INFO, logger="app.services.archive.telemetry"):
        await reader.validate_member("root.txt")

    messages = [record.getMessage() for record in caplog.records if record.getMessage().startswith("archive_metrics")]
    assert any("operation='inspection_parse'" in message and "entry_count=3" in message for message in messages)
    assert any("operation='member_validation'" in message and "read_operations=" in message for message in messages)
    assert all("root.txt" not in message for message in messages)


@pytest.mark.asyncio
async def test_reads_central_directory_in_bounded_sequential_chunks() -> None:
    data = _large_directory_zip_bytes()
    reader_source = CountingRandomAccessReader(data)

    entries = await ZipReader(reader_source, len(data)).entries()

    eocd_offset = data.rindex(b"PK\x05\x06")
    directory_size = struct.unpack_from("<I", data, eocd_offset + 12)[0]
    assert len(entries) == 10_000
    assert reader_source.read_count == 1 + math.ceil(directory_size / (256 * 1024))
    assert all(length <= 256 * 1024 for _, length in reader_source.reads[1:])


@pytest.mark.asyncio
async def test_discovers_implicit_directories_in_bounded_reads_for_large_nested_archives() -> None:
    data = _large_nested_directory_zip_bytes()
    reader_source = CountingRandomAccessReader(data)
    reader = ZipReader(reader_source, len(data))

    page = (await reader.inspection_manifest()).list_directory("nested", None, 10_000)
    eocd_offset = data.rindex(b"PK\x05\x06")
    directory_size = struct.unpack_from("<I", data, eocd_offset + 12)[0]

    assert page.total == 10_000
    assert reader_source.read_count == 1 + math.ceil(directory_size / (256 * 1024))


@pytest.mark.asyncio
async def test_reuses_one_request_local_inspection_manifest() -> None:
    data = _zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    first_manifest = await reader.inspection_manifest()
    second_manifest = await reader.inspection_manifest()

    assert first_manifest is second_manifest


@pytest.mark.asyncio
async def test_inspection_and_member_validation_reuse_the_effective_projection() -> None:
    data = _zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))
    original_entries = reader.entries
    entries_calls = 0

    async def count_entries():
        nonlocal entries_calls
        entries_calls += 1
        return await original_entries()

    reader.entries = count_entries  # type: ignore[method-assign]

    await reader.inspection_manifest()
    await reader.validate_member("root.txt")

    assert entries_calls == 1


@pytest.mark.asyncio
async def test_resolves_duplicate_member_metadata_and_bytes_to_last_record() -> None:
    data = _duplicate_name_zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))
    manifest = await reader.inspection_manifest()

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        expected = archive.read("duplicate.txt")

    member = manifest.member("duplicate.txt")
    page = manifest.list_directory("", None, 10)
    chunks = [chunk async for chunk in reader.stream_member("duplicate.txt")]

    assert member.uncompressed_size == len(expected)
    assert page.entries[0].uncompressed_size == len(expected)
    assert b"".join(chunks) == expected


@pytest.mark.asyncio
async def test_resolves_normalized_duplicate_member_to_last_regular_record() -> None:
    data = _normalized_duplicate_name_zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    member = (await reader.inspection_manifest()).member("folder/entry.txt")
    chunks = [chunk async for chunk in reader.stream_member("folder/entry.txt")]

    assert member.uncompressed_size == len(b"second entry")
    assert b"".join(chunks) == b"second entry"


@pytest.mark.asyncio
async def test_rejects_unsupported_duplicate_before_inspection_or_member_delivery() -> None:
    data = _regular_then_symbolic_duplicate_zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    with pytest.raises(ArchiveFormatError, match="symbolic link"):
        await reader.inspection_manifest()
    with pytest.raises(ArchiveFormatError, match="symbolic link"):
        await reader.validate_member("member")

    projection = await reader.effective_entries()
    assert [entry.path for entry in projection.regular_entries] == ["member"]


@pytest.mark.asyncio
async def test_effective_entries_reuses_its_projection_and_preserves_case_distinct_members() -> None:
    data = _case_distinct_zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    first_projection = await reader.effective_entries()
    second_projection = await reader.effective_entries()
    manifest = await reader.inspection_manifest()
    upper_chunks = [chunk async for chunk in reader.stream_member("Report.txt")]
    lower_chunks = [chunk async for chunk in reader.stream_member("report.txt")]

    assert first_projection is second_projection
    assert [entry.path for entry in first_projection.regular_entries] == ["Report.txt", "report.txt"]
    assert [entry.path for entry in manifest.entries] == ["Report.txt", "report.txt"]
    assert b"".join(upper_chunks) == b"upper"
    assert b"".join(lower_chunks) == b"lower"


@pytest.mark.asyncio
async def test_effective_entries_constructs_one_sorted_explicit_and_inferred_directory_work_item() -> None:
    data = _effective_directory_zip_bytes()
    projection = await ZipReader(MemoryRandomAccessReader(data), len(data)).effective_entries()

    assert [(directory.path, directory.source_member_path) for directory in projection.directories] == [
        ("empty", "empty"),
        ("nested", "nested/readme.txt"),
    ]
    assert projection.directories[0].explicit_entry is projection.directory_entries[0]
    assert projection.directories[1].explicit_entry is None


@pytest.mark.asyncio
async def test_directory_record_does_not_mask_an_earlier_regular_member() -> None:
    data = _file_then_directory_zip_bytes()
    reader = ZipReader(MemoryRandomAccessReader(data), len(data))

    member = (await reader.inspection_manifest()).member("member")
    page = (await reader.inspection_manifest()).list_directory("", None, 10)
    chunks = [chunk async for chunk in reader.stream_member("member")]

    assert member.is_directory is False
    assert page.entries[0].is_directory is False
    assert b"".join(chunks) == b"file content"


@pytest.mark.asyncio
async def test_rejects_validated_descriptor_from_another_reader() -> None:
    data = _zip_bytes()
    first_reader = ZipReader(MemoryRandomAccessReader(data), len(data))
    second_reader = ZipReader(MemoryRandomAccessReader(data), len(data))
    validated_entry = await first_reader.validate_member("root.txt")

    with pytest.raises(ArchiveFormatError, match="different reader"):
        await anext(second_reader.stream_validated_entry(validated_entry))


@pytest.mark.asyncio
async def test_rejects_raw_entry_from_another_reader_without_searching_its_entries() -> None:
    data = _zip_bytes()
    first_reader = ZipReader(MemoryRandomAccessReader(data), len(data))
    second_reader = ZipReader(MemoryRandomAccessReader(data), len(data))
    entry = (await first_reader.entries())[0]

    with pytest.raises(ArchiveFormatError, match="member was not found"):
        await anext(second_reader.stream_entry(entry))


@pytest.mark.asyncio
async def test_stream_entry_reads_local_header_once_after_validation() -> None:
    data = _zip_bytes()
    reader_source = CountingRandomAccessReader(data)
    reader = ZipReader(reader_source, len(data))
    entry = (await reader.entries())[0]
    reader_source.reads.clear()

    chunks = [chunk async for chunk in reader.stream_entry(entry)]

    assert b"".join(chunks) == b"root"
    assert reader_source.reads.count((entry.local_header_offset, 30)) == 1
