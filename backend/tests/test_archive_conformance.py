"""Shared v1 ZIP reader conformance fixture checks for the backend parser."""

import hashlib
import json
from pathlib import Path

import pytest

from app.services.archive.zip_reader import ArchiveFormatError, ZipReader

CORPUS_ROOT = Path(__file__).resolve().parents[2] / "archive_testdata"


class FileRandomAccessReader:
    def __init__(self, path: Path) -> None:
        self._data = path.read_bytes()

    async def read_at(self, offset: int, length: int) -> bytes:
        return self._data[offset : offset + length]

    async def close(self) -> None:
        return None


@pytest.mark.asyncio
async def test_v1_zip_reader_conformance_corpus() -> None:
    manifest = json.loads((CORPUS_ROOT / "manifest-v1.json").read_text())
    assert manifest["version"] == 1

    for fixture in manifest["fixtures"]:
        fixture_path = CORPUS_ROOT / fixture["name"]
        data = fixture_path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == fixture["sha256"]
        if fixture.get("expected_error") == "format_error":
            with pytest.raises(ArchiveFormatError):
                reader = ZipReader(FileRandomAccessReader(fixture_path), len(data))
                await reader.entries()
            continue
        reader = ZipReader(FileRandomAccessReader(fixture_path), len(data))
        entries = await reader.entries()
        expected_entries = fixture["entries"]
        assert len(entries) == len(expected_entries)
        for entry, expected in zip(entries, expected_entries, strict=True):
            assert entry.raw_name.hex() == expected["raw_name_hex"]
            assert entry.path == expected["path"]
            assert entry.is_directory is expected["directory"]
            assert entry.compression_method == expected["method"]
            assert entry.uncompressed_size == expected["uncompressed_size"]
            assert entry.is_safe is expected["safe"]
            assert bool(entry.flags & 0x0008) is expected["data_descriptor"]
            if expected["safe"] and expected["member_sha256"] is not None:
                member = b"".join([chunk async for chunk in reader.stream_member(entry.path)])
                assert hashlib.sha256(member).hexdigest() == expected["member_sha256"]
