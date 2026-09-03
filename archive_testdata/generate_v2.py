"""Generate deterministic V2 ZIP reader conformance fixtures and manifest."""

import bz2
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
PREVIEW_EXACT_LIMIT_MEMBER_NAME = "exact-limit.txt"
PREVIEW_OVER_LIMIT_MEMBER_NAME = "over-limit.txt"
PREVIEW_MAX_BYTES = 5 * 1024 * 1024
EOCD_MALFORMED_MEMBER_NAME = "eocd.txt"
EOCD_MALFORMED_MEMBER_CONTENT = b"malformed " * 16
INVALID_EOCD_COMMENT_LENGTH = 0x00FF
COMPATIBILITY_CONTRACT_PATH = (
    ROOT.parent
    / "archive-contract"
    / "v2"
    / "fixtures"
    / "zip-compatibility-recovery.json"
)
COMPATIBILITY_CONTENT = b"verified compatibility payload"
COMPATIBILITY_SECOND_STREAM_CONTENT = b"second member stream"


def _raw_deflate(content: bytes) -> bytes:
    compressor = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    return compressor.compress(content) + compressor.flush()


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


def _write_preview_boundary_fixture(path: Path) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        _write_entry(
            archive,
            PREVIEW_EXACT_LIMIT_MEMBER_NAME,
            b"\0" * PREVIEW_MAX_BYTES,
            zipfile.ZIP_DEFLATED,
        )
        _write_entry(
            archive,
            PREVIEW_OVER_LIMIT_MEMBER_NAME,
            b"\0" * (PREVIEW_MAX_BYTES + 1),
            zipfile.ZIP_DEFLATED,
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


def _append_declared_member_data(path: Path, trailing_data: bytes) -> None:
    """Append ignored member bytes before the central directory of a single-entry ZIP."""

    data = bytearray(path.read_bytes())
    local_offset = data.index(b"PK\x03\x04")
    central_offset = data.index(b"PK\x01\x02")
    eocd_offset = data.rindex(b"PK\x05\x06")
    compressed_size = struct.unpack_from(
        "<I", data, central_offset + CENTRAL_COMPRESSED_SIZE_OFFSET
    )[0]

    data[central_offset:central_offset] = trailing_data
    central_offset += len(trailing_data)
    eocd_offset += len(trailing_data)
    struct.pack_into(
        "<I", data, local_offset + 18, compressed_size + len(trailing_data)
    )
    struct.pack_into(
        "<I",
        data,
        central_offset + CENTRAL_COMPRESSED_SIZE_OFFSET,
        compressed_size + len(trailing_data),
    )
    directory_offset = struct.unpack_from(
        "<I", data, eocd_offset + EOCD_DIRECTORY_OFFSET
    )[0]
    struct.pack_into(
        "<I",
        data,
        eocd_offset + EOCD_DIRECTORY_OFFSET,
        directory_offset + len(trailing_data),
    )
    path.write_bytes(data)


def _write_compatibility_member_fixture(
    path: Path, member_name: str, method: int, trailing_data: bytes = b""
) -> None:
    with zipfile.ZipFile(path, "w", compression=method) as archive:
        _write_entry(archive, member_name, COMPATIBILITY_CONTENT, method)
    if trailing_data:
        _append_declared_member_data(path, trailing_data)


def _write_truncated_compatibility_fixture(path: Path) -> None:
    _write_compatibility_member_fixture(
        path, "truncated-deflate.txt", zipfile.ZIP_DEFLATED
    )
    data = bytearray(path.read_bytes())
    central_offset = data.index(b"PK\x01\x02")
    compressed_size = struct.unpack_from(
        "<I", data, central_offset + CENTRAL_COMPRESSED_SIZE_OFFSET
    )[0]
    assert compressed_size > 1
    struct.pack_into("<I", data, 18, compressed_size - 1)
    struct.pack_into(
        "<I", data, central_offset + CENTRAL_COMPRESSED_SIZE_OFFSET, compressed_size - 1
    )
    path.write_bytes(data)


def _write_bad_crc_compatibility_fixture(path: Path) -> None:
    _write_compatibility_member_fixture(
        path, "bad-crc-deflate.txt", zipfile.ZIP_DEFLATED
    )
    data = bytearray(path.read_bytes())
    central_offset = data.index(b"PK\x01\x02")
    crc32 = struct.unpack_from("<I", data, central_offset + 16)[0]
    struct.pack_into("<I", data, central_offset + 16, crc32 ^ 1)
    path.write_bytes(data)


def _write_bad_size_compatibility_fixture(path: Path) -> None:
    _write_compatibility_member_fixture(
        path, "bad-size-deflate.txt", zipfile.ZIP_DEFLATED
    )
    data = bytearray(path.read_bytes())
    central_offset = data.index(b"PK\x01\x02")
    struct.pack_into(
        "<I",
        data,
        central_offset + CENTRAL_UNCOMPRESSED_SIZE_OFFSET,
        len(COMPATIBILITY_CONTENT) - 1,
    )
    path.write_bytes(data)


def _write_compatibility_name_fixture(path: Path) -> None:
    raw_malformed_name = b"bad\xff.txt"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        _write_entry(archive, "badx.txt", b"malformed UTF-8 name", zipfile.ZIP_STORED)
        _write_entry(archive, "bad\ufffd.txt", b"replacement name", zipfile.ZIP_STORED)
    data = bytearray(path.read_bytes())
    local_offset = data.index(b"PK\x03\x04")
    central_offset = data.index(b"PK\x01\x02")
    assert len(raw_malformed_name) == len(b"badx.txt")
    data[local_offset + 7] |= 0x08
    data[central_offset + 9] |= 0x08
    data[local_offset + 30 : local_offset + 30 + len(raw_malformed_name)] = (
        raw_malformed_name
    )
    data[
        central_offset + CENTRAL_DIRECTORY_FIXED_SIZE : central_offset
        + CENTRAL_DIRECTORY_FIXED_SIZE
        + len(raw_malformed_name)
    ] = raw_malformed_name
    path.write_bytes(data)


def _compatibility_fixture(
    name: str, members: list[dict[str, object]]
) -> dict[str, object]:
    return {
        "name": name,
        "sha256": hashlib.sha256((ROOT / name).read_bytes()).hexdigest(),
        "members": members,
    }


def _compatibility_member(
    raw_name: bytes,
    path: str,
    method: int,
    *,
    accepted: bool,
    content: bytes = COMPATIBILITY_CONTENT,
    collision_group: str | None = None,
) -> dict[str, object]:
    member = {
        "raw_name_hex": raw_name.hex(),
        "path": path,
        "method": method,
        "outcome": "accepted" if accepted else "rejected",
        "member_sha256": hashlib.sha256(content).hexdigest() if accepted else None,
    }
    if collision_group is not None:
        member["collision_group"] = collision_group
    return member


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
    _write_portable_fixture(ROOT / "portable-v2.zip")
    _write_unsafe_path_fixture(ROOT / "unsafe-path-v2.zip")
    _write_data_descriptor_fixture(ROOT / "data-descriptor-v2.zip")
    _write_unicode_path_fixture(ROOT / "unicode-path-v2.zip")
    _write_zip64_fixture(ROOT / "zip64-v2.zip")
    _write_bzip2_fixture(ROOT / "bzip2-v2.zip")
    _write_preview_boundary_fixture(ROOT / "preview-boundary-v2.zip")
    _write_malformed_fixture(ROOT / "malformed-v2.zip")
    _write_eocd_malformed_fixture(ROOT / "eocd-malformed-v2.zip")
    _write_compatibility_member_fixture(
        ROOT / "compat-deflate-padding.zip",
        "deflate-padding.txt",
        zipfile.ZIP_DEFLATED,
        b"producer padding",
    )
    _write_compatibility_member_fixture(
        ROOT / "compat-bzip2-padding.zip",
        "bzip2-padding.txt",
        zipfile.ZIP_BZIP2,
        b"producer padding",
    )
    _write_compatibility_member_fixture(
        ROOT / "compat-deflate-second-stream.zip",
        "deflate-second-stream.txt",
        zipfile.ZIP_DEFLATED,
        _raw_deflate(COMPATIBILITY_SECOND_STREAM_CONTENT),
    )
    _write_compatibility_member_fixture(
        ROOT / "compat-bzip2-second-stream.zip",
        "bzip2-second-stream.txt",
        zipfile.ZIP_BZIP2,
        bz2.compress(COMPATIBILITY_SECOND_STREAM_CONTENT),
    )
    _write_truncated_compatibility_fixture(ROOT / "compat-truncated-deflate.zip")
    _write_bad_crc_compatibility_fixture(ROOT / "compat-bad-crc-deflate.zip")
    _write_bad_size_compatibility_fixture(ROOT / "compat-bad-size-deflate.zip")
    _write_compatibility_name_fixture(ROOT / "compat-names.zip")
    manifest = {
        "version": 2,
        "fixtures": [
            _fixture(
                "portable-v2.zip",
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
                "unsafe-path-v2.zip",
                [_entry("../unsafe.txt", b"blocked", zipfile.ZIP_STORED, safe=False)],
            ),
            _fixture(
                "data-descriptor-v2.zip",
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
                "unicode-path-v2.zip",
                [
                    _entry(
                        "café.txt", b"unicode", zipfile.ZIP_STORED, raw_name=b"cafe.txt"
                    )
                ],
            ),
            _fixture(
                "zip64-v2.zip",
                [_entry(ZIP64_MEMBER_NAME, ZIP64_MEMBER_CONTENT, zipfile.ZIP_DEFLATED)],
            ),
            _fixture(
                "bzip2-v2.zip",
                [_entry(BZIP2_MEMBER_NAME, BZIP2_MEMBER_CONTENT, zipfile.ZIP_BZIP2)],
            ),
            _fixture(
                "preview-boundary-v2.zip",
                [
                    _entry(
                        PREVIEW_EXACT_LIMIT_MEMBER_NAME,
                        b"\0" * PREVIEW_MAX_BYTES,
                        zipfile.ZIP_DEFLATED,
                    ),
                    _entry(
                        PREVIEW_OVER_LIMIT_MEMBER_NAME,
                        b"\0" * (PREVIEW_MAX_BYTES + 1),
                        zipfile.ZIP_DEFLATED,
                    ),
                ],
            ),
            _fixture("malformed-v2.zip", [], expected_error="format_error"),
            _fixture("eocd-malformed-v2.zip", [], expected_error="format_error"),
        ],
    }
    (ROOT / "manifest-v2.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    compatibility_contract = {
        "version": 1,
        "fixtures": [
            _compatibility_fixture(
                "compat-deflate-padding.zip",
                [
                    _compatibility_member(
                        b"deflate-padding.txt",
                        "deflate-padding.txt",
                        zipfile.ZIP_DEFLATED,
                        accepted=True,
                    )
                ],
            ),
            _compatibility_fixture(
                "compat-bzip2-padding.zip",
                [
                    _compatibility_member(
                        b"bzip2-padding.txt",
                        "bzip2-padding.txt",
                        zipfile.ZIP_BZIP2,
                        accepted=True,
                    )
                ],
            ),
            _compatibility_fixture(
                "compat-deflate-second-stream.zip",
                [
                    _compatibility_member(
                        b"deflate-second-stream.txt",
                        "deflate-second-stream.txt",
                        zipfile.ZIP_DEFLATED,
                        accepted=True,
                    )
                ],
            ),
            _compatibility_fixture(
                "compat-bzip2-second-stream.zip",
                [
                    _compatibility_member(
                        b"bzip2-second-stream.txt",
                        "bzip2-second-stream.txt",
                        zipfile.ZIP_BZIP2,
                        accepted=True,
                    )
                ],
            ),
            _compatibility_fixture(
                "compat-truncated-deflate.zip",
                [
                    _compatibility_member(
                        b"truncated-deflate.txt",
                        "truncated-deflate.txt",
                        zipfile.ZIP_DEFLATED,
                        accepted=False,
                    )
                ],
            ),
            _compatibility_fixture(
                "compat-bad-crc-deflate.zip",
                [
                    _compatibility_member(
                        b"bad-crc-deflate.txt",
                        "bad-crc-deflate.txt",
                        zipfile.ZIP_DEFLATED,
                        accepted=False,
                    )
                ],
            ),
            _compatibility_fixture(
                "compat-bad-size-deflate.zip",
                [
                    _compatibility_member(
                        b"bad-size-deflate.txt",
                        "bad-size-deflate.txt",
                        zipfile.ZIP_DEFLATED,
                        accepted=False,
                    )
                ],
            ),
            _compatibility_fixture(
                "compat-names.zip",
                [
                    _compatibility_member(
                        b"bad\xff.txt",
                        "bad\ufffd.txt",
                        zipfile.ZIP_STORED,
                        accepted=True,
                        content=b"malformed UTF-8 name",
                        collision_group="replacement-decoded-name",
                    ),
                    _compatibility_member(
                        "bad\ufffd.txt".encode(),
                        "bad\ufffd.txt",
                        zipfile.ZIP_STORED,
                        accepted=True,
                        content=b"replacement name",
                        collision_group="replacement-decoded-name",
                    ),
                ],
            ),
        ],
    }
    COMPATIBILITY_CONTRACT_PATH.write_text(
        json.dumps(compatibility_contract, indent=2, sort_keys=True) + "\n"
    )


if __name__ == "__main__":
    main()
