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


def _fixture(name: str, entries: list[dict[str, object]]) -> dict[str, object]:
    return {
        "name": name,
        "sha256": hashlib.sha256((ROOT / name).read_bytes()).hexdigest(),
        "entries": entries,
    }


def main() -> None:
    _write_portable_fixture(ROOT / "portable-v1.zip")
    _write_unsafe_path_fixture(ROOT / "unsafe-path-v1.zip")
    _write_data_descriptor_fixture(ROOT / "data-descriptor-v1.zip")
    _write_unicode_path_fixture(ROOT / "unicode-path-v1.zip")
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
        ],
    }
    (ROOT / "manifest-v1.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )


if __name__ == "__main__":
    main()
