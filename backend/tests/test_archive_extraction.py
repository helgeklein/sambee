"""Tests for same-executor direct ZIP extraction."""

import io
import zipfile
from collections.abc import AsyncIterator
from datetime import datetime, timezone

import pytest

from app.models.file import FileInfo, FileType
from app.services.archive.extraction import ArchiveExtractionCancelled, ArchiveExtractionConflicts, extract_archive_to_new_paths
from app.services.archive.zip_reader import ArchiveFormatError


class MemoryRandomReader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.closed = False

    async def read_at(self, offset: int, length: int) -> bytes:
        return self.data[offset : offset + length]

    async def close(self) -> None:
        self.closed = True


class MemoryExtractionBackend:
    def __init__(self, archive: bytes) -> None:
        self.archive = archive
        self.reader = MemoryRandomReader(archive)
        self.directories: set[str] = set()
        self.files: dict[str, bytes] = {}
        self.modified_at: dict[str, datetime] = {}

    async def get_file_info(self, path: str) -> FileInfo:
        if path == "input.zip":
            return FileInfo(name="input.zip", path=path, type=FileType.FILE, size=len(self.archive))
        if path in self.directories:
            return FileInfo(name=path.rsplit("/", 1)[-1], path=path, type=FileType.DIRECTORY)
        if path in self.files:
            return FileInfo(
                name=path.rsplit("/", 1)[-1],
                path=path,
                type=FileType.FILE,
                size=len(self.files[path]),
                modified_at=self.modified_at.get(path),
            )
        raise FileNotFoundError(path)

    async def open_random_access_reader(self, path: str) -> MemoryRandomReader:
        assert path == "input.zip"
        return self.reader

    async def create_directory(self, path: str) -> None:
        if path in self.directories:
            raise FileExistsError(path)
        self.directories.add(path)

    async def write_file_from_stream(
        self,
        path: str,
        stream: AsyncIterator[bytes],
        *,
        overwrite: bool = False,
        source_mtime: object | None = None,
    ) -> int:
        del source_mtime
        if path in self.files and not overwrite:
            raise FileExistsError(path)
        content = b"".join([chunk async for chunk in stream])
        self.files[path] = content
        return len(content)


def _archive_bytes() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("docs/readme.txt", "readme")
        archive.writestr("root.txt", "root")
    return output.getvalue()


@pytest.mark.asyncio
async def test_extracts_safe_members_to_new_paths() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    result = await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert result.files_extracted == 2
    assert result.extracted_bytes == 10
    assert backend.directories == {"output", "output/docs"}
    assert backend.files == {"output/docs/readme.txt": b"readme", "output/root.txt": b"root"}
    assert backend.reader.closed is True


@pytest.mark.asyncio
async def test_skip_all_policy_preserves_existing_files() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"

    result = await extract_archive_to_new_paths(
        backend, archive_path="input.zip", destination_root="output", existing_file_policy="skip_all"
    )

    assert result.files_extracted == 1
    assert backend.files == {"output/docs/readme.txt": b"readme", "output/root.txt": b"existing"}


@pytest.mark.asyncio
async def test_replace_all_policy_replaces_existing_files() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"

    result = await extract_archive_to_new_paths(
        backend, archive_path="input.zip", destination_root="output", existing_file_policy="replace_all"
    )

    assert result.files_extracted == 2
    assert backend.files["output/root.txt"] == b"root"


@pytest.mark.asyncio
async def test_individual_skip_policy_preserves_only_the_selected_member() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        member_collision_actions={"root.txt": "skip"},
    )

    assert result.files_extracted == 1
    assert result.skipped_members == ("root.txt",)
    assert backend.files["output/root.txt"] == b"existing"


@pytest.mark.asyncio
async def test_individual_replace_policy_replaces_only_the_selected_member() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        member_collision_actions={"root.txt": "replace"},
    )

    assert result.files_replaced == 1
    assert result.replaced_members == ("root.txt",)
    assert backend.files["output/root.txt"] == b"root"


@pytest.mark.asyncio
async def test_individual_rename_writes_member_to_the_persisted_target() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        member_rename_targets={"root.txt": "renamed/root-copy.txt"},
    )

    assert result.files_extracted == 2
    assert result.renamed_members == ("root.txt",)
    assert backend.files["output/root.txt"] == b"existing"
    assert backend.files["output/renamed/root-copy.txt"] == b"root"


@pytest.mark.asyncio
async def test_directory_rename_remaps_implicit_directory_descendants() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/docs"] = b"existing file"

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        member_rename_targets={"docs": "renamed-docs"},
    )

    assert result.renamed_members == ("docs/readme.txt",)
    assert backend.files["output/docs"] == b"existing file"
    assert backend.files["output/renamed-docs/readme.txt"] == b"readme"


@pytest.mark.asyncio
async def test_preflights_file_destination_at_implicit_directory_path() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/docs"] = b"existing file"

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert [(conflict.member_path, conflict.is_directory) for conflict in error.value.conflicts] == [("docs", True)]


@pytest.mark.asyncio
async def test_rename_rejects_unsafe_or_colliding_output_paths() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    with pytest.raises(ArchiveFormatError, match="safe relative path"):
        await extract_archive_to_new_paths(
            backend,
            archive_path="input.zip",
            destination_root="output",
            member_rename_targets={"root.txt": "../escape.txt"},
        )
    with pytest.raises(ArchiveFormatError, match="collide after normalization"):
        await extract_archive_to_new_paths(
            backend,
            archive_path="input.zip",
            destination_root="output",
            member_rename_targets={"root.txt": "docs/README.txt"},
        )
    with pytest.raises(ArchiveFormatError, match="file/directory collision"):
        await extract_archive_to_new_paths(
            backend,
            archive_path="input.zip",
            destination_root="output",
            member_rename_targets={"root.txt": "docs"},
        )


@pytest.mark.asyncio
async def test_replace_older_policy_replaces_only_strictly_older_destination() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"
    backend.modified_at["output/root.txt"] = datetime(1979, 1, 1)

    result = await extract_archive_to_new_paths(
        backend, archive_path="input.zip", destination_root="output", existing_file_policy="replace_older"
    )

    assert result.files_extracted == 2
    assert result.files_replaced == 1
    assert result.files_skipped == 0
    assert result.replaced_members == ("root.txt",)
    assert backend.files["output/root.txt"] == b"root"


@pytest.mark.asyncio
async def test_replace_older_policy_skips_incomparable_timestamps() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"
    backend.modified_at["output/root.txt"] = datetime(1979, 1, 1, tzinfo=timezone.utc)

    result = await extract_archive_to_new_paths(
        backend, archive_path="input.zip", destination_root="output", existing_file_policy="replace_older"
    )

    assert result.files_extracted == 1
    assert result.files_replaced == 0
    assert result.files_skipped == 1
    assert result.skipped_members == ("root.txt",)
    assert backend.files["output/root.txt"] == b"existing"


@pytest.mark.asyncio
async def test_cancellation_stops_before_writing_members() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    with pytest.raises(ArchiveExtractionCancelled):
        await extract_archive_to_new_paths(
            backend,
            archive_path="input.zip",
            destination_root="output",
            is_cancelled=lambda: _cancelled(),
        )

    assert backend.files == {}
    assert backend.reader.closed is True


@pytest.mark.asyncio
async def test_preflights_existing_file_collisions_before_writing() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert [(conflict.member_path, conflict.target_path) for conflict in error.value.conflicts] == [("root.txt", "output/root.txt")]
    assert backend.files == {"output/root.txt": b"existing"}
    assert backend.directories == set()
    assert backend.reader.closed is True


async def _cancelled() -> bool:
    return True
