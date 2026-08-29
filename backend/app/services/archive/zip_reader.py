"""Bounded ZIP central-directory parsing for virtual archive browsing."""

import base64
import bz2
import struct
import unicodedata
import zlib
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app.models.archive import ArchiveEntryInfo
from app.models.file import FileType
from app.storage.base import RandomAccessReader

_EOCD_SIGNATURE = b"PK\x05\x06"
_CENTRAL_DIRECTORY_SIGNATURE = b"PK\x01\x02"
_LOCAL_FILE_SIGNATURE = b"PK\x03\x04"
_ZIP64_LOCATOR_SIGNATURE = b"PK\x06\x07"
_ZIP64_EOCD_SIGNATURE = b"PK\x06\x06"
_EOCD_SIZE = 22
_ZIP64_LOCATOR_SIZE = 20
_MAX_COMMENT_BYTES = 65_535
_MAX_ENTRY_VARIABLE_BYTES = 65_535 * 3
_CENTRAL_DIRECTORY_FIXED_SIZE = 46
_ZIP64_SENTINEL_U32 = 0xFFFFFFFF
_ZIP64_SENTINEL_U16 = 0xFFFF
_INFOZIP_UNICODE_PATH_FIELD_ID = 0x7075
_INFOZIP_UNICODE_PATH_VERSION = 1
_READABLE_METHODS = {0, 8, 12}
_ARCHIVE_IO_CHUNK_BYTES = 256 * 1024
ARCHIVE_INLINE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024
_UNIX_HOST_SYSTEM = 3
_UNIX_FILE_TYPE_MASK = 0o170000
_UNIX_DIRECTORY_FILE_TYPE = 0o040000
_UNIX_REGULAR_FILE_TYPE = 0o100000


class ArchiveFormatError(ValueError):
    """Raised when an archive cannot be safely interpreted as a ZIP file."""


@dataclass(frozen=True)
class ZipDirectory:
    """Location and entry count declared by the ZIP directory records."""

    offset: int
    size: int
    entries: int


@dataclass(frozen=True)
class ZipEntry:
    """Minimal parsed central-directory record used for virtual listings."""

    path: str
    is_directory: bool
    compressed_size: int
    uncompressed_size: int
    compression_method: int
    crc32: int
    modified_at: datetime | None
    encrypted: bool
    is_safe: bool
    has_supported_file_type: bool
    local_header_offset: int
    flags: int
    raw_name: bytes


@dataclass(frozen=True)
class ArchiveInspectionManifestMember:
    """Normalized inspection metadata for one archive member."""

    path: str
    is_directory: bool
    compressed_size: int
    uncompressed_size: int
    compression_method: int
    crc32: int
    modified_at: datetime | None
    encrypted: bool
    is_safe: bool
    has_supported_file_type: bool

    @property
    def preview_state(self) -> Literal["readable", "blocked", "unavailable"]:
        if self.encrypted:
            return "blocked"
        return "readable" if self.compression_method in _READABLE_METHODS else "unavailable"

    def is_inline_preview_eligible(self) -> bool:
        return (
            not self.is_directory
            and self.is_safe
            and self.has_supported_file_type
            and self.preview_state == "readable"
            and self.uncompressed_size <= ARCHIVE_INLINE_PREVIEW_MAX_BYTES
        )


@dataclass(frozen=True)
class ArchiveInspectionManifest:
    """Immutable normalized archive inspection result, independent of HTTP DTOs."""

    entries: tuple[ArchiveInspectionManifestMember, ...]


def _u16(data: bytes, offset: int) -> int:
    return int(struct.unpack_from("<H", data, offset)[0])


def _u32(data: bytes, offset: int) -> int:
    return int(struct.unpack_from("<I", data, offset)[0])


def _u64(data: bytes, offset: int) -> int:
    return int(struct.unpack_from("<Q", data, offset)[0])


def _unicode_path_name(raw_name: bytes, extra: bytes) -> str | None:
    """Return a validated Info-ZIP Unicode Path name, when one is present."""

    position = 0
    while position + 4 <= len(extra):
        field_id = _u16(extra, position)
        field_length = _u16(extra, position + 2)
        position += 4
        if position + field_length > len(extra):
            return None
        field = extra[position : position + field_length]
        position += field_length
        if field_id != _INFOZIP_UNICODE_PATH_FIELD_ID or len(field) < 5:
            continue
        if field[0] != _INFOZIP_UNICODE_PATH_VERSION or _u32(field, 1) != zlib.crc32(raw_name) & _ZIP64_SENTINEL_U32:
            continue
        try:
            return field[5:].decode("utf-8")
        except UnicodeDecodeError:
            continue
    return None


def _decode_name(raw_name: bytes, flags: int, extra: bytes) -> str:
    if flags & 0x0800:
        try:
            return raw_name.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ArchiveFormatError("ZIP entry declares invalid UTF-8 filename") from exc
    unicode_path_name = _unicode_path_name(raw_name, extra)
    if unicode_path_name is not None:
        return unicode_path_name
    try:
        return raw_name.decode("utf-8")
    except UnicodeDecodeError:
        return raw_name.decode("cp437")


def _zip64_member_values(
    extra: bytes,
    *,
    compressed_size: int,
    uncompressed_size: int,
    local_header_offset: int,
) -> tuple[int, int, int]:
    """Resolve sentinel central-directory fields from the ZIP64 extra field."""

    position = 0
    while position + 4 <= len(extra):
        field_id = _u16(extra, position)
        field_length = _u16(extra, position + 2)
        position += 4
        if position + field_length > len(extra):
            raise ArchiveFormatError("ZIP extra field is malformed")
        if field_id != 0x0001:
            position += field_length
            continue
        field = extra[position : position + field_length]
        value_position = 0

        def take_u64(required: bool, value: int) -> int:
            nonlocal value_position
            if not required:
                return value
            if value_position + 8 > len(field):
                raise ArchiveFormatError("ZIP64 member metadata is truncated")
            value = _u64(field, value_position)
            value_position += 8
            return value

        uncompressed_size = take_u64(uncompressed_size == _ZIP64_SENTINEL_U32, uncompressed_size)
        compressed_size = take_u64(compressed_size == _ZIP64_SENTINEL_U32, compressed_size)
        local_header_offset = take_u64(local_header_offset == _ZIP64_SENTINEL_U32, local_header_offset)
        return compressed_size, uncompressed_size, local_header_offset
    if compressed_size == _ZIP64_SENTINEL_U32 or uncompressed_size == _ZIP64_SENTINEL_U32 or local_header_offset == _ZIP64_SENTINEL_U32:
        raise ArchiveFormatError("ZIP64 member metadata is missing")
    return compressed_size, uncompressed_size, local_header_offset


def _normalize_path(name: str) -> tuple[str, bool]:
    is_directory = name.endswith(("/", "\\"))
    normalized = name.replace("\\", "/")
    if normalized.startswith("/") or "\x00" in normalized:
        return normalized.rstrip("/"), False
    segments = normalized.rstrip("/").split("/")
    if not segments or any(not segment or segment in {".", ".."} for segment in segments):
        return normalized.rstrip("/"), False
    if any(":" in segment for segment in segments):
        return normalized.rstrip("/"), False
    return "/".join(segments), is_directory


def _is_safe_path(name: str, normalized_path: str) -> bool:
    canonical = name.replace("\\", "/").rstrip("/")
    if not canonical or canonical.startswith("/") or "\x00" in canonical:
        return False
    segments = canonical.split("/")
    return all(segment and segment not in {".", ".."} and ":" not in segment for segment in segments) and normalized_path == "/".join(
        segments
    )


def _has_supported_file_type(version_made_by: int, external_attributes: int) -> bool:
    if version_made_by >> 8 != _UNIX_HOST_SYSTEM:
        return True
    file_type = (external_attributes >> 16) & _UNIX_FILE_TYPE_MASK
    return file_type in {0, _UNIX_DIRECTORY_FILE_TYPE, _UNIX_REGULAR_FILE_TYPE}


def _dos_datetime(date_value: int, time_value: int) -> datetime | None:
    year = ((date_value >> 9) & 0x7F) + 1980
    month = (date_value >> 5) & 0x0F
    day = date_value & 0x1F
    hour = (time_value >> 11) & 0x1F
    minute = (time_value >> 5) & 0x3F
    second = (time_value & 0x1F) * 2
    try:
        return datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None


def _cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(offset).encode()).decode().rstrip("=")


def decode_cursor(value: str | None) -> int:
    if not value:
        return 0
    try:
        padded = value + "=" * (-len(value) % 4)
        offset = int(base64.urlsafe_b64decode(padded.encode()).decode())
    except (ValueError, UnicodeDecodeError) as exc:
        raise ArchiveFormatError("Archive listing cursor is invalid") from exc
    if offset < 0:
        raise ArchiveFormatError("Archive listing cursor is invalid")
    return offset


class ZipReader:
    """Read ZIP metadata without staging archive contents or member bytes."""

    def __init__(self, reader: RandomAccessReader, size: int) -> None:
        if size < _EOCD_SIZE:
            raise ArchiveFormatError("Archive is too small to be a ZIP file")
        self._reader = reader
        self._size = size

    async def _read_exact(self, offset: int, length: int) -> bytes:
        if offset < 0 or length < 0 or offset + length > self._size:
            raise ArchiveFormatError("ZIP record extends beyond archive bounds")
        data = await self._reader.read_at(offset, length)
        if len(data) != length:
            raise ArchiveFormatError("ZIP record is truncated")
        return data

    async def _directory(self) -> ZipDirectory:
        tail_length = min(self._size, _EOCD_SIZE + _MAX_COMMENT_BYTES)
        tail_offset = self._size - tail_length
        tail = await self._read_exact(tail_offset, tail_length)
        eocd_index = tail.rfind(_EOCD_SIGNATURE)
        if eocd_index < 0 or eocd_index + _EOCD_SIZE > len(tail):
            raise ArchiveFormatError("ZIP end-of-central-directory record is missing")
        eocd = tail[eocd_index : eocd_index + _EOCD_SIZE]
        comment_length = _u16(eocd, 20)
        if eocd_index + _EOCD_SIZE + comment_length != len(tail):
            raise ArchiveFormatError("ZIP end-of-central-directory comment is malformed")
        entries = _u16(eocd, 10)
        directory_size = _u32(eocd, 12)
        directory_offset = _u32(eocd, 16)
        eocd_offset = tail_offset + eocd_index
        if entries != _ZIP64_SENTINEL_U16 and directory_size != _ZIP64_SENTINEL_U32 and directory_offset != _ZIP64_SENTINEL_U32:
            return ZipDirectory(directory_offset, directory_size, entries)
        if eocd_offset < _ZIP64_LOCATOR_SIZE:
            raise ArchiveFormatError("ZIP64 locator is missing")
        locator = await self._read_exact(eocd_offset - _ZIP64_LOCATOR_SIZE, _ZIP64_LOCATOR_SIZE)
        if locator[:4] != _ZIP64_LOCATOR_SIGNATURE:
            raise ArchiveFormatError("ZIP64 locator is invalid")
        zip64_offset = _u64(locator, 8)
        header = await self._read_exact(zip64_offset, 56)
        if header[:4] != _ZIP64_EOCD_SIGNATURE or _u64(header, 4) < 44:
            raise ArchiveFormatError("ZIP64 end-of-central-directory record is invalid")
        return ZipDirectory(_u64(header, 48), _u64(header, 40), _u64(header, 32))

    async def entries(self) -> list[ZipEntry]:
        directory = await self._directory()
        if directory.offset + directory.size > self._size:
            raise ArchiveFormatError("ZIP central directory extends beyond archive bounds")
        entries: list[ZipEntry] = []
        position = directory.offset
        directory_end = directory.offset + directory.size
        for _ in range(directory.entries):
            fixed = await self._read_exact(position, _CENTRAL_DIRECTORY_FIXED_SIZE)
            if fixed[:4] != _CENTRAL_DIRECTORY_SIGNATURE:
                raise ArchiveFormatError("ZIP central-directory entry is invalid")
            flags = _u16(fixed, 8)
            version_made_by = _u16(fixed, 4)
            external_attributes = _u32(fixed, 38)
            method = _u16(fixed, 10)
            time_value = _u16(fixed, 12)
            date_value = _u16(fixed, 14)
            crc32 = _u32(fixed, 16)
            compressed_size = _u32(fixed, 20)
            uncompressed_size = _u32(fixed, 24)
            name_length = _u16(fixed, 28)
            extra_length = _u16(fixed, 30)
            comment_length = _u16(fixed, 32)
            variable_length = name_length + extra_length + comment_length
            if variable_length > _MAX_ENTRY_VARIABLE_BYTES or position + _CENTRAL_DIRECTORY_FIXED_SIZE + variable_length > directory_end:
                raise ArchiveFormatError("ZIP central-directory entry length is invalid")
            variable = await self._read_exact(position + _CENTRAL_DIRECTORY_FIXED_SIZE, variable_length)
            raw_name = variable[:name_length]
            extra = variable[name_length : name_length + extra_length]
            decoded_name = _decode_name(raw_name, flags, extra)
            path, is_directory = _normalize_path(decoded_name)
            local_header_offset = _u32(fixed, 42)
            compressed_size, uncompressed_size, local_header_offset = _zip64_member_values(
                extra,
                compressed_size=compressed_size,
                uncompressed_size=uncompressed_size,
                local_header_offset=local_header_offset,
            )
            entries.append(
                ZipEntry(
                    path=path,
                    is_directory=is_directory,
                    compressed_size=compressed_size,
                    uncompressed_size=uncompressed_size,
                    compression_method=method,
                    crc32=crc32,
                    modified_at=_dos_datetime(date_value, time_value),
                    encrypted=bool(flags & 1),
                    is_safe=_is_safe_path(decoded_name, path),
                    has_supported_file_type=_has_supported_file_type(version_made_by, external_attributes),
                    local_header_offset=local_header_offset,
                    flags=flags,
                    raw_name=raw_name,
                )
            )
            position += _CENTRAL_DIRECTORY_FIXED_SIZE + variable_length
        if position != directory_end:
            raise ArchiveFormatError("ZIP central-directory size does not match its entries")
        return entries

    async def validate_member(self, path: str) -> ZipEntry:
        """Resolve and validate a member before a response commits headers."""
        normalized_path, is_directory = _normalize_path(path)
        if is_directory or not normalized_path:
            raise ArchiveFormatError("Archive member path must identify a regular file")
        entry = next(
            (
                candidate
                for candidate in await self.entries()
                if candidate.is_safe and candidate.has_supported_file_type and candidate.path == normalized_path
            ),
            None,
        )
        if entry is None:
            raise ArchiveFormatError("Archive member was not found")
        if entry.encrypted or entry.compression_method not in _READABLE_METHODS:
            raise ArchiveFormatError("Archive member uses an unavailable codec or blocked feature")

        local_header = await self._read_exact(entry.local_header_offset, 30)
        if local_header[:4] != _LOCAL_FILE_SIGNATURE:
            raise ArchiveFormatError("ZIP local header is invalid")
        local_flags = _u16(local_header, 6)
        local_method = _u16(local_header, 8)
        local_name_length = _u16(local_header, 26)
        if local_flags != entry.flags:
            raise ArchiveFormatError("ZIP local header flags do not match central directory")
        if local_method != entry.compression_method:
            raise ArchiveFormatError("ZIP local header method does not match central directory")
        local_name = await self._read_exact(entry.local_header_offset + 30, local_name_length)
        if local_name != entry.raw_name:
            raise ArchiveFormatError("ZIP local header filename does not match central directory")
        return entry

    async def inspection_manifest(self) -> ArchiveInspectionManifest:
        """Project parsed ZIP metadata into the shared inspection domain value."""

        return ArchiveInspectionManifest(
            entries=tuple(
                ArchiveInspectionManifestMember(
                    path=entry.path,
                    is_directory=entry.is_directory,
                    compressed_size=entry.compressed_size,
                    uncompressed_size=entry.uncompressed_size,
                    compression_method=entry.compression_method,
                    crc32=entry.crc32,
                    modified_at=entry.modified_at,
                    encrypted=entry.encrypted,
                    is_safe=entry.is_safe,
                    has_supported_file_type=entry.has_supported_file_type,
                )
                for entry in await self.entries()
            )
        )

    async def stream_member(self, path: str, chunk_size: int = 262_144) -> AsyncIterator[bytes]:
        """Validate and stream a single permitted member without staging it."""

        if not 0 < chunk_size <= _ARCHIVE_IO_CHUNK_BYTES:
            raise ValueError(f"ZIP member chunk size must be between 1 and {_ARCHIVE_IO_CHUNK_BYTES} bytes")
        entry = await self.validate_member(path)
        local_header = await self._read_exact(entry.local_header_offset, 30)
        local_name_length = _u16(local_header, 26)
        local_extra_length = _u16(local_header, 28)
        data_offset = entry.local_header_offset + 30 + local_name_length + local_extra_length
        if data_offset + entry.compressed_size > self._size:
            raise ArchiveFormatError("ZIP member payload extends beyond archive bounds")

        crc = 0
        total = 0
        offset = data_offset
        remaining = entry.compressed_size
        if entry.compression_method == 0:
            while remaining:
                part = await self._read_exact(offset, min(chunk_size, remaining))
                offset += len(part)
                remaining -= len(part)
                crc = zlib.crc32(part, crc)
                total += len(part)
                yield part
        elif entry.compression_method == 8:
            deflate_decompressor = zlib.decompressobj(-zlib.MAX_WBITS)
            while remaining:
                part = await self._read_exact(offset, min(chunk_size, remaining))
                offset += len(part)
                remaining -= len(part)
                pending = part
                while pending:
                    output = deflate_decompressor.decompress(pending, chunk_size)
                    pending = deflate_decompressor.unconsumed_tail
                    if output:
                        crc = zlib.crc32(output, crc)
                        total += len(output)
                        yield output
            output = deflate_decompressor.flush(chunk_size)
            if output:
                crc = zlib.crc32(output, crc)
                total += len(output)
                yield output
            if not deflate_decompressor.eof:
                raise ArchiveFormatError("ZIP Deflate member is truncated")
        elif entry.compression_method == 12:
            bzip2_decompressor = bz2.BZ2Decompressor()
            while remaining:
                part = await self._read_exact(offset, min(chunk_size, remaining))
                offset += len(part)
                remaining -= len(part)
                pending = part
                while pending or not bzip2_decompressor.needs_input:
                    output = bzip2_decompressor.decompress(pending, max_length=chunk_size)
                    pending = b""
                    if output:
                        crc = zlib.crc32(output, crc)
                        total += len(output)
                        yield output
                    if bzip2_decompressor.eof or bzip2_decompressor.needs_input:
                        break
            if not bzip2_decompressor.eof:
                raise ArchiveFormatError("ZIP BZIP2 member is truncated")
        else:
            raise ArchiveFormatError("Archive member codec is unavailable")
        if total != entry.uncompressed_size or crc & 0xFFFFFFFF != entry.crc32:
            raise ArchiveFormatError("ZIP member integrity check failed")

    async def list_directory(self, path: str, cursor: str | None, page_size: int) -> tuple[list[ArchiveEntryInfo], int, str | None]:
        normalized_path, _ = _normalize_path(path)
        if path and not normalized_path:
            raise ArchiveFormatError("Archive directory path is invalid")
        prefix = f"{normalized_path}/" if normalized_path else ""
        children: dict[str, ArchiveEntryInfo] = {}
        for entry in (await self.inspection_manifest()).entries:
            if not entry.is_safe or not entry.has_supported_file_type or not entry.path.startswith(prefix):
                continue
            remainder = entry.path[len(prefix) :]
            if not remainder:
                continue
            child_name, separator, _ = remainder.partition("/")
            child_path = f"{prefix}{child_name}"
            if separator:
                children.setdefault(
                    child_path,
                    ArchiveEntryInfo(name=child_name, path=child_path, type=FileType.DIRECTORY, state="unavailable"),
                )
                continue
            children[child_path] = ArchiveEntryInfo(
                name=child_name,
                path=child_path,
                type=FileType.DIRECTORY if entry.is_directory else FileType.FILE,
                size=None if entry.is_directory else entry.uncompressed_size,
                compressed_size=None if entry.is_directory else entry.compressed_size,
                compression_method=None if entry.is_directory else entry.compression_method,
                crc32=None if entry.is_directory else entry.crc32,
                modified_at=entry.modified_at,
                state=entry.preview_state,
                is_hidden=child_name.startswith("."),
            )
        ordered = sorted(
            children.values(),
            key=lambda item: (item.type != FileType.DIRECTORY, unicodedata.normalize("NFC", item.name).casefold(), item.name),
        )
        start = decode_cursor(cursor)
        if start > len(ordered):
            raise ArchiveFormatError("Archive listing cursor is out of range")
        page = ordered[start : start + page_size]
        next_cursor = _cursor(start + page_size) if start + page_size < len(ordered) else None
        return page, len(ordered), next_cursor
