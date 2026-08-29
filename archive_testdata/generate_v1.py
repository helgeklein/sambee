"""Generate deterministic v1 ZIP reader conformance fixtures and manifest."""

import hashlib
import io
import json
import struct
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).parent
FIXTURE_TIMESTAMP = (2020, 1, 1, 0, 0, 0)
UNICODE_PATH_FIELD_ID = 0x7075
UNICODE_PATH_VERSION = 1
ZIP64_EXTRA_FIELD_ID = 0x0001
ZIP64_SENTINEL_U16 = 0xFFFF
ZIP64_SENTINEL_U32 = 0xFFFFFFFF
ZIP64_EOCD_SIGNATURE = 0x06064B50
ZIP64_LOCATOR_SIGNATURE = 0x07064B50
ZIP64_VERSION = 45
CENTRAL_DIRECTORY_FIXED_SIZE = 46
CENTRAL_COMPRESSED_SIZE_OFFSET = 20
CENTRAL_UNCOMPRESSED_SIZE_OFFSET = 24
CENTRAL_NAME_LENGTH_OFFSET = 28
CENTRAL_EXTRA_LENGTH_OFFSET = 30
CENTRAL_LOCAL_HEADER_OFFSET = 42
EOCD_ENTRIES_ON_DISK_OFFSET = 8
EOCD_TOTAL_ENTRIES_OFFSET = 10
EOCD_DIRECTORY_SIZE_OFFSET = 12
EOCD_DIRECTORY_OFFSET = 16
EOCD_COMMENT_LENGTH_OFFSET = 20
ZIP64_MEMBER_NAME = "zip64.txt"
ZIP64_MEMBER_CONTENT = b"zip64 " * 128
BZIP2_MEMBER_NAME = "bzip2.txt"
BZIP2_MEMBER_CONTENT = b"bzip2 " * 128
EOCD_MALFORMED_MEMBER_NAME = "eocd.txt"
EOCD_MALFORMED_MEMBER_CONTENT = b"malformed " * 16
INVALID_EOCD_COMMENT_LENGTH = 0x00FF


class NonSeekableBuffer(io.BytesIO):
    def seekable(self) -> bool:
        return False

    def seek(self, offset: int, whence: int = 0) -> int:
        raise io.UnsupportedOperation("ZIP conformance fixture output is non-seekable")


def _write_entry(
    archive: zipfile.ZipFile, name: str, content: bytes, method: int
) -> None:
    entry = zipfile.ZipInfo(name, date_time=FIXTURE_TIMESTAMP)
    entry.compress_type = method
    archive.writestr(entry, content)


def _write_portable_fixture(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        _write_entry(archive, "stored.txt", b"stored", zipfile.ZIP_STORED)
        _write_entry(archive, "deflated.txt", b"deflated " * 128, zipfile.ZIP_DEFLATED)
        _write_entry(archive, "empty/", b"", zipfile.ZIP_STORED)


def _write_unsafe_path_fixture(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        _write_entry(archive, "../unsafe.txt", b"blocked", zipfile.ZIP_STORED)


def _write_data_descriptor_fixture(path: Path) -> None:
    buffer = NonSeekableBuffer()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        _write_entry(
            archive, "descriptor.txt", b"descriptor " * 128, zipfile.ZIP_DEFLATED
        )
    path.write_bytes(buffer.getvalue())


def _write_unicode_path_fixture(path: Path) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        _write_entry(archive, "cafe.txt", b"unicode", zipfile.ZIP_STORED)
    data = bytearray(path.read_bytes())
    raw_name = b"cafe.txt"
    unicode_name = "café.txt".encode()
    local_offset = data.index(b"PK\x03\x04")
    central_offset = data.index(b"PK\x01\x02")
    data[local_offset + 30 : local_offset + 30 + len(raw_name)] = raw_name
    data[central_offset + 46 : central_offset + 46 + len(raw_name)] = raw_name
    unicode_extra = (
        struct.pack(
            "<HHBI",
            UNICODE_PATH_FIELD_ID,
            1 + 4 + len(unicode_name),
            UNICODE_PATH_VERSION,
            zlib.crc32(raw_name) & 0xFFFFFFFF,
        )
        + unicode_name
    )
    name_length = struct.unpack_from("<H", data, central_offset + 28)[0]
    struct.pack_into("<H", data, central_offset + 30, len(unicode_extra))
    insert_at = central_offset + 46 + name_length
    data[insert_at:insert_at] = unicode_extra
    eocd_offset = data.rindex(b"PK\x05\x06")
    directory_size = struct.unpack_from("<I", data, eocd_offset + 12)[0]
    struct.pack_into("<I", data, eocd_offset + 12, directory_size + len(unicode_extra))
    path.write_bytes(data)


def _write_zip64_fixture(path: Path) -> None:
    """Write a compact ZIP64 archive without requiring a multi-gigabyte input."""

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        _write_entry(
            archive, ZIP64_MEMBER_NAME, ZIP64_MEMBER_CONTENT, zipfile.ZIP_DEFLATED
        )

    data = bytearray(path.read_bytes())
    central_offset = data.index(b"PK\x01\x02")
    compressed_size = struct.unpack_from(
        "<I", data, central_offset + CENTRAL_COMPRESSED_SIZE_OFFSET
    )[0]
    uncompressed_size = struct.unpack_from(
        "<I", data, central_offset + CENTRAL_UNCOMPRESSED_SIZE_OFFSET
    )[0]
    local_header_offset = struct.unpack_from(
        "<I", data, central_offset + CENTRAL_LOCAL_HEADER_OFFSET
    )[0]
    name_length = struct.unpack_from(
        "<H", data, central_offset + CENTRAL_NAME_LENGTH_OFFSET
    )[0]
    extra_length = struct.unpack_from(
        "<H", data, central_offset + CENTRAL_EXTRA_LENGTH_OFFSET
    )[0]
    zip64_extra = struct.pack(
        "<HHQQQ",
        ZIP64_EXTRA_FIELD_ID,
        24,
        uncompressed_size,
        compressed_size,
        local_header_offset,
    )
    struct.pack_into(
        "<II",
        data,
        central_offset + CENTRAL_COMPRESSED_SIZE_OFFSET,
        ZIP64_SENTINEL_U32,
        ZIP64_SENTINEL_U32,
    )
    struct.pack_into(
        "<I", data, central_offset + CENTRAL_LOCAL_HEADER_OFFSET, ZIP64_SENTINEL_U32
    )
    struct.pack_into(
        "<H",
        data,
        central_offset + CENTRAL_EXTRA_LENGTH_OFFSET,
        extra_length + len(zip64_extra),
    )
    insert_at = (
        central_offset + CENTRAL_DIRECTORY_FIXED_SIZE + name_length + extra_length
    )
    data[insert_at:insert_at] = zip64_extra

    eocd_offset = data.rindex(b"PK\x05\x06")
    directory_size = struct.unpack_from(
        "<I", data, eocd_offset + EOCD_DIRECTORY_SIZE_OFFSET
    )[0] + len(zip64_extra)
    directory_offset = struct.unpack_from(
        "<I", data, eocd_offset + EOCD_DIRECTORY_OFFSET
    )[0]
    struct.pack_into(
        "<HHII",
        data,
        eocd_offset + EOCD_ENTRIES_ON_DISK_OFFSET,
        ZIP64_SENTINEL_U16,
        ZIP64_SENTINEL_U16,
        ZIP64_SENTINEL_U32,
        ZIP64_SENTINEL_U32,
    )
    zip64_eocd = struct.pack(
        "<IQHHIIQQQQ",
        ZIP64_EOCD_SIGNATURE,
        44,
        ZIP64_VERSION,
        ZIP64_VERSION,
        0,
        0,
        1,
        1,
        directory_size,
        directory_offset,
    )
    zip64_locator = struct.pack("<IIQI", ZIP64_LOCATOR_SIGNATURE, 0, eocd_offset, 1)
    data[eocd_offset:eocd_offset] = zip64_eocd + zip64_locator
    path.write_bytes(data)


def _write_bzip2_fixture(path: Path) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_BZIP2) as archive:
        _write_entry(
            archive, BZIP2_MEMBER_NAME, BZIP2_MEMBER_CONTENT, zipfile.ZIP_BZIP2
        )


def _write_malformed_fixture(path: Path) -> None:
    path.write_bytes(b"not a zip archive\n")


def _write_eocd_malformed_fixture(path: Path) -> None:
    """Write a ZIP whose end record declares a comment that is not present."""

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        _write_entry(
            archive,
            EOCD_MALFORMED_MEMBER_NAME,
            EOCD_MALFORMED_MEMBER_CONTENT,
            zipfile.ZIP_DEFLATED,
        )
    data = bytearray(path.read_bytes())
    eocd_offset = data.rindex(b"PK\x05\x06")
    struct.pack_into(
        "<H",
        data,
        eocd_offset + EOCD_COMMENT_LENGTH_OFFSET,
        INVALID_EOCD_COMMENT_LENGTH,
    )
    path.write_bytes(data)


def _entry(
    name: str,
    content: bytes | None,
    method: int,
    *,
    safe: bool = True,
    directory: bool = False,
    data_descriptor: bool = False,
    raw_name: bytes | None = None,
) -> dict[str, object]:
    return {
        "raw_name_hex": (raw_name or name.encode()).hex(),
        "path": name,
        "directory": directory,
        "method": method,
        "uncompressed_size": len(content or b""),
        "safe": safe,
        "data_descriptor": data_descriptor,
        "member_sha256": hashlib.sha256(content).hexdigest()
        if content is not None
        else None,
    }


def _fixture(
    name: str, entries: list[dict[str, object]], *, expected_error: str | None = None
) -> dict[str, object]:
    fixture = {
        "name": name,
        "sha256": hashlib.sha256((ROOT / name).read_bytes()).hexdigest(),
        "entries": entries,
    }
    if expected_error is not None:
        fixture["expected_error"] = expected_error
    return fixture


def main() -> None:
    _write_portable_fixture(ROOT / "portable-v1.zip")
    _write_unsafe_path_fixture(ROOT / "unsafe-path-v1.zip")
    _write_data_descriptor_fixture(ROOT / "data-descriptor-v1.zip")
    _write_unicode_path_fixture(ROOT / "unicode-path-v1.zip")
    _write_zip64_fixture(ROOT / "zip64-v1.zip")
    _write_bzip2_fixture(ROOT / "bzip2-v1.zip")
    _write_malformed_fixture(ROOT / "malformed-v1.zip")
    _write_eocd_malformed_fixture(ROOT / "eocd-malformed-v1.zip")
    manifest = {
        "version": 1,
        "fixtures": [
            _fixture(
                "portable-v1.zip",
                [
                    _entry("stored.txt", b"stored", zipfile.ZIP_STORED),
                    _entry("deflated.txt", b"deflated " * 128, zipfile.ZIP_DEFLATED),
                    _entry(
                        "empty",
                        None,
                        zipfile.ZIP_STORED,
                        directory=True,
                        raw_name=b"empty/",
                    ),
                ],
            ),
            _fixture(
                "unsafe-path-v1.zip",
                [_entry("../unsafe.txt", b"blocked", zipfile.ZIP_STORED, safe=False)],
            ),
            _fixture(
                "data-descriptor-v1.zip",
                [
                    _entry(
                        "descriptor.txt",
                        b"descriptor " * 128,
                        zipfile.ZIP_DEFLATED,
                        data_descriptor=True,
                    )
                ],
            ),
            _fixture(
                "unicode-path-v1.zip",
                [
                    _entry(
                        "café.txt", b"unicode", zipfile.ZIP_STORED, raw_name=b"cafe.txt"
                    )
                ],
            ),
            _fixture(
                "zip64-v1.zip",
                [_entry(ZIP64_MEMBER_NAME, ZIP64_MEMBER_CONTENT, zipfile.ZIP_DEFLATED)],
            ),
            _fixture(
                "bzip2-v1.zip",
                [_entry(BZIP2_MEMBER_NAME, BZIP2_MEMBER_CONTENT, zipfile.ZIP_BZIP2)],
            ),
            _fixture("malformed-v1.zip", [], expected_error="format_error"),
            _fixture("eocd-malformed-v1.zip", [], expected_error="format_error"),
        ],
    }
    (ROOT / "manifest-v1.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )


if __name__ == "__main__":
    main()
