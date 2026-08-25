"""Portable ZIP creation directly to an exclusive final-target writer."""

import struct
import unicodedata
import zlib
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime

from app.services.archive.zip_reader import ArchiveFormatError
from app.storage.base import ExclusiveWriter

_ARCHIVE_IO_CHUNK_BYTES = 256 * 1024
_COMPRESSION_PROBE_BYTES = 64 * 1024
_STORED_SAVINGS_BYTES = 1024
_STORED_SAVINGS_RATIO = 0.05
_ZIP32_MAX = 0xFFFFFFFF
_ZIP16_MAX = 0xFFFF
_UTF8_FLAG = 0x0800
_DATA_DESCRIPTOR_FLAG = 0x0008
_STORED_METHOD = 0
_DEFLATE_METHOD = 8


@dataclass(frozen=True)
class _WrittenEntry:
    name: bytes
    flags: int
    method: int
    dos_time: int
    dos_date: int
    crc32: int
    compressed_size: int
    uncompressed_size: int
    local_offset: int
    is_directory: bool


def _dos_time_and_date(modified_at: datetime | None) -> tuple[int, int]:
    if modified_at is None:
        return 0, 0
    timestamp = modified_at.replace(tzinfo=None)
    if timestamp.year < 1980:
        return 0, 0
    year = min(timestamp.year, 2107) - 1980
    return (timestamp.hour << 11) | (timestamp.minute << 5) | (timestamp.second // 2), (year << 9) | (timestamp.month << 5) | timestamp.day


def _normalize_entry_name(name: str, *, directory: bool) -> str:
    normalized = name.replace("\\", "/").rstrip("/")
    segments = normalized.split("/")
    if (
        not normalized
        or normalized.startswith("/")
        or "\x00" in normalized
        or any(not part or part in {".", ".."} or ":" in part for part in segments)
    ):
        raise ArchiveFormatError("Archive output entry name is unsafe")
    return f"{normalized}/" if directory else normalized


class PortableZipWriter:
    """Writes UTF-8 Stored/Deflate ZIP entries without staging source members."""

    def __init__(self, writer: ExclusiveWriter) -> None:
        self._writer = writer
        self._offset = 0
        self._entries: list[_WrittenEntry] = []
        self._path_keys: set[str] = set()
        self._closed = False

    async def _write(self, data: bytes) -> None:
        position = 0
        while position < len(data):
            written = await self._writer.write(data[position:])
            if written <= 0:
                raise OSError("Archive target writer accepted no bytes")
            position += written
        self._offset += len(data)

    def _reserve_name(self, name: str, *, directory: bool) -> bytes:
        normalized = _normalize_entry_name(name, directory=directory)
        key = unicodedata.normalize("NFC", normalized.rstrip("/")).casefold()
        if key in self._path_keys:
            raise ArchiveFormatError("Archive output contains duplicate normalized entry names")
        self._path_keys.add(key)
        return normalized.encode("utf-8")

    async def add_directory(self, name: str, modified_at: datetime | None = None) -> None:
        """Emit an explicit empty directory entry."""

        entry_name = self._reserve_name(name, directory=True)
        await self._write_entry(entry_name, None, modified_at, is_directory=True)

    async def add_file(self, name: str, source: AsyncIterator[bytes], modified_at: datetime | None = None) -> None:
        """Stream a regular file using the portable Stored/Deflate selection rule."""

        entry_name = self._reserve_name(name, directory=False)
        await self._write_entry(entry_name, source, modified_at, is_directory=False)

    async def _write_entry(
        self,
        name: bytes,
        source: AsyncIterator[bytes] | None,
        modified_at: datetime | None,
        *,
        is_directory: bool,
    ) -> None:
        if self._closed:
            raise ValueError("ZIP writer is already finalized")
        source = source or _empty_chunks()
        probe, remainder = await _read_probe(source)
        method = _STORED_METHOD if is_directory or _should_store(probe) else _DEFLATE_METHOD
        flags = _UTF8_FLAG | _DATA_DESCRIPTOR_FLAG
        dos_time, dos_date = _dos_time_and_date(modified_at)
        local_offset = self._offset
        await self._write(struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, flags, method, dos_time, dos_date, 0, 0, 0, len(name), 0))
        await self._write(name)

        crc = 0
        uncompressed_size = 0
        compressed_size = 0
        compressor = zlib.compressobj(level=6, wbits=-zlib.MAX_WBITS) if method == _DEFLATE_METHOD else None
        async for chunk in _prepend_chunks(probe, remainder, source):
            if not chunk:
                continue
            crc = zlib.crc32(chunk, crc)
            uncompressed_size += len(chunk)
            output = compressor.compress(chunk) if compressor is not None else chunk
            if output:
                await self._write(output)
                compressed_size += len(output)
        if compressor is not None:
            output = compressor.flush()
            if output:
                await self._write(output)
                compressed_size += len(output)

        if max(compressed_size, uncompressed_size, local_offset) > _ZIP32_MAX:
            raise ArchiveFormatError("ZIP64 output entries are not implemented")
        await self._write(struct.pack("<IIII", 0x08074B50, crc & _ZIP32_MAX, compressed_size, uncompressed_size))
        self._entries.append(
            _WrittenEntry(
                name, flags, method, dos_time, dos_date, crc & _ZIP32_MAX, compressed_size, uncompressed_size, local_offset, is_directory
            )
        )

    async def close(self) -> None:
        """Write central-directory records and close the final target."""

        if self._closed:
            return
        if len(self._entries) > _ZIP16_MAX:
            raise ArchiveFormatError("ZIP64 archive directory output is not implemented")
        directory_offset = self._offset
        for entry in self._entries:
            external_attributes = 0x10 if entry.is_directory else 0
            await self._write(
                struct.pack(
                    "<IHHHHHHIIIHHHHHII",
                    0x02014B50,
                    0x0314,
                    20,
                    entry.flags,
                    entry.method,
                    entry.dos_time,
                    entry.dos_date,
                    entry.crc32,
                    entry.compressed_size,
                    entry.uncompressed_size,
                    len(entry.name),
                    0,
                    0,
                    0,
                    0,
                    external_attributes,
                    entry.local_offset,
                )
            )
            await self._write(entry.name)
        directory_size = self._offset - directory_offset
        if max(directory_offset, directory_size) > _ZIP32_MAX:
            raise ArchiveFormatError("ZIP64 archive directory output is not implemented")
        await self._write(
            struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(self._entries), len(self._entries), directory_size, directory_offset, 0)
        )
        self._closed = True
        await self._writer.close()


async def _empty_chunks() -> AsyncIterator[bytes]:
    if False:
        yield b""


async def _read_probe(source: AsyncIterator[bytes]) -> tuple[bytes, bytes]:
    probe = bytearray()
    remainder = b""
    async for chunk in source:
        if len(probe) + len(chunk) <= _COMPRESSION_PROBE_BYTES:
            probe.extend(chunk)
            if len(probe) == _COMPRESSION_PROBE_BYTES:
                break
            continue
        required = _COMPRESSION_PROBE_BYTES - len(probe)
        probe.extend(chunk[:required])
        remainder = chunk[required:]
        break
    return bytes(probe), remainder


async def _prepend_chunks(probe: bytes, remainder: bytes, source: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
    if probe:
        yield probe
    if remainder:
        yield remainder
    async for chunk in source:
        yield chunk


def _should_store(probe: bytes) -> bool:
    if not probe:
        return True
    compressed = zlib.compress(probe, level=6)
    savings = len(probe) - len(compressed)
    return savings < _STORED_SAVINGS_BYTES and savings / len(probe) < _STORED_SAVINGS_RATIO
