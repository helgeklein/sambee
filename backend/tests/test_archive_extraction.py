"""Tests for same-executor direct ZIP extraction."""

import io
import json
import zipfile
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.models.file import FileInfo, FileType
from app.services.archive.extraction import (
    ArchiveExtractionCancelled,
    ArchiveExtractionConflicts,
    ArchiveExtractionDestinationResult,
    ArchiveExtractionMemberError,
    ArchiveExtractionMemberOutcome,
    ArchiveExtractionProgress,
    extract_archive_to_new_paths,
    validate_archive_rename_targets,
)
from app.services.archive.zip_reader import ArchiveFormatError, ZipReader

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
EXTRACTION_OUTCOME_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "extraction-outcome-scenarios-v1.json"


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


class MemoryExtractionSource:
    def __init__(self, backend: MemoryExtractionBackend) -> None:
        self.backend = backend

    async def get_file_info(self, path: str) -> FileInfo:
        return await self.backend.get_file_info(path)

    async def open_random_access_reader(self, path: str) -> MemoryRandomReader:
        return await self.backend.open_random_access_reader(path)


class MemoryExtractionDestination:
    def __init__(self, backend: MemoryExtractionBackend) -> None:
        self.backend = backend

    async def get_file_info(self, path: str) -> FileInfo:
        return await self.backend.get_file_info(path)

    async def create_directory(self, path: str) -> None:
        await self.backend.create_directory(path)

    async def write_file_from_stream(
        self,
        path: str,
        stream: AsyncIterator[bytes],
        *,
        overwrite: bool = False,
        source_mtime: datetime | None = None,
    ) -> int:
        return await self.backend.write_file_from_stream(path, stream, overwrite=overwrite, source_mtime=source_mtime)


def _archive_bytes() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("docs/readme.txt", "readme")
        archive.writestr("root.txt", "root")
    return output.getvalue()


def _unsafe_archive_bytes() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("../unsafe.txt", "unsafe")
    return output.getvalue()


def _symbolic_link_archive_bytes() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        member = zipfile.ZipInfo("link")
        member.create_system = 3
        member.external_attr = 0o120777 << 16
        archive.writestr(member, "target")
    return output.getvalue()


async def _archive_entries(archive: bytes):
    reader = MemoryRandomReader(archive)
    try:
        return await ZipReader(reader, len(archive)).entries()
    finally:
        await reader.close()


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
async def test_extracts_through_separate_source_and_destination_adapters() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    result = await extract_archive_to_new_paths(
        MemoryExtractionSource(backend),
        destination=MemoryExtractionDestination(backend),
        archive_path="input.zip",
        destination_root="output",
    )

    assert result.files_extracted == 2
    assert backend.files == {"output/docs/readme.txt": b"readme", "output/root.txt": b"root"}


def test_extraction_progress_records_completed_member_outcomes() -> None:
    progress = ArchiveExtractionProgress.from_checkpoint({"files_extracted": 1, "extracted_bytes": 4})

    progress.record(ArchiveExtractionMemberOutcome("docs", "directory", "output/docs", directories_created=1))
    progress.record(ArchiveExtractionMemberOutcome("docs/readme.txt", "extracted", "output/docs/readme.txt", 6, replaced=True))
    progress.record(ArchiveExtractionMemberOutcome("ignored.txt", "ignored", "output/ignored.txt"))
    checkpoint: dict[str, object] = {}
    progress.write_to(checkpoint)

    assert checkpoint == {
        "files_extracted": 2,
        "directories_created": 1,
        "extracted_bytes": 10,
        "files_skipped": 1,
        "files_replaced": 1,
    }


@pytest.mark.asyncio
async def test_rejects_unsafe_members_before_creating_output() -> None:
    backend = MemoryExtractionBackend(_unsafe_archive_bytes())

    with pytest.raises(ArchiveFormatError, match="unsafe member path"):
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert backend.directories == set()
    assert backend.files == {}
    assert backend.reader.closed is True


@pytest.mark.asyncio
async def test_rejects_symbolic_link_members_before_creating_output() -> None:
    backend = MemoryExtractionBackend(_symbolic_link_archive_bytes())

    with pytest.raises(ArchiveFormatError, match="symbolic link"):
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert backend.directories == set()
    assert backend.files == {}
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
async def test_v1_collision_skip_behavioral_scenario() -> None:
    corpus = json.loads(EXTRACTION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    scenario = next(scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "collision_skip_is_terminal")
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        member_collision_actions={"root.txt": scenario["collision_action"]},
    )

    assert scenario["terminal_phase"] == "completed"
    assert result.files_skipped == scenario["progress"]["files_skipped"]
    assert result.skipped_members == ("root.txt",)


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
    corpus = json.loads(EXTRACTION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    scenario = next(
        scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "rename_preserves_terminal_destination_metadata"
    )
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        member_rename_targets={"root.txt": scenario["rename_target"]},
    )

    assert scenario["terminal_phase"] == "completed"
    assert result.files_extracted == 2
    assert result.renamed_members == ("root.txt",)
    assert backend.files["output/root.txt"] == b"existing"
    assert backend.files[f"output/{scenario['rename_target']}"] == b"root"


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
async def test_rename_validation_rejects_portable_output_collisions_before_writing() -> None:
    entries = await _archive_entries(_archive_bytes())

    with pytest.raises(ArchiveFormatError, match="collide after normalization"):
        validate_archive_rename_targets(entries, {"root.txt": "docs/README.txt"})
    with pytest.raises(ArchiveFormatError, match="file/directory collision"):
        validate_archive_rename_targets(entries, {"root.txt": "docs"})


@pytest.mark.asyncio
async def test_replace_older_policy_replaces_only_strictly_older_destination() -> None:
    corpus = json.loads(EXTRACTION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    scenario = next(
        scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "replace_older_replaces_strictly_older_destination"
    )
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"
    backend.modified_at["output/root.txt"] = datetime.fromisoformat(scenario["target_modified_at"])

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        existing_file_policy=scenario["existing_file_policy"],
    )

    assert scenario["terminal_phase"] == "completed"
    assert result.files_extracted == scenario["progress"]["files_extracted"]
    assert result.files_replaced == scenario["progress"]["files_replaced"]
    assert result.files_skipped == scenario["progress"]["files_skipped"]
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
    corpus = json.loads(EXTRACTION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    scenario = next(
        scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "cancellation_stops_before_member_completion"
    )
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
    assert scenario["terminal_phase"] == "cancelled"
    assert scenario["progress"]["files_extracted"] == 0


@pytest.mark.asyncio
async def test_preflights_existing_file_collisions_before_writing() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.files["output/root.txt"] = b"existing"

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert [(conflict.member_path, conflict.target_path) for conflict in error.value.conflicts] == [("root.txt", "output/root.txt")]
    conflict = error.value.conflicts[0]
    assert conflict.source_size == len(b"root")
    assert conflict.target_size == len(b"existing")
    assert backend.files == {"output/root.txt": b"existing"}
    assert backend.directories == set()
    assert backend.reader.closed is True


@pytest.mark.asyncio
async def test_write_failure_identifies_the_member_that_can_be_retried() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    async def fail_write(path: str, _stream: AsyncIterator[bytes], **_kwargs: object) -> int:
        raise OSError(f"Cannot write {path}")

    backend.write_file_from_stream = fail_write  # type: ignore[method-assign]

    with pytest.raises(ArchiveExtractionMemberError) as error:
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert error.value.member_path == "docs/readme.txt"
    assert error.value.target_path == "output/docs/readme.txt"
    assert error.value.message == "Cannot write output/docs/readme.txt"


@pytest.mark.asyncio
async def test_resumed_extraction_skips_already_completed_members() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    outcomes: list[ArchiveExtractionMemberOutcome] = []

    async def record_outcome(outcome: ArchiveExtractionMemberOutcome) -> None:
        outcomes.append(outcome)

    await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        completed_members={"docs/readme.txt"},
        on_member_completed=record_outcome,
    )

    assert backend.files == {"output/root.txt": b"root"}
    assert [outcome.member_path for outcome in outcomes] == ["root.txt"]


@pytest.mark.asyncio
async def test_extraction_callback_receives_normalized_destination_results() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    results: list[ArchiveExtractionDestinationResult] = []

    async def record_result(result: ArchiveExtractionDestinationResult) -> None:
        results.append(result)

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        on_member_completed=record_result,
    )

    assert result.files_extracted == 2
    assert result.directories_created == sum(member.directories_created for member in results)
    assert result.extracted_bytes == sum(member.extracted_bytes for member in results)
    assert [member.status for member in results] == ["extracted", "extracted"]


async def _cancelled() -> bool:
    return True
