"""Tests for same-executor direct ZIP extraction."""

import io
import json
import logging
import zipfile
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from app.models.file import DirectoryListing, FileInfo, FileType
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
from app.services.archive.target_write import (
    ResolvedCollisionPolicy,
    TargetExistsBeforeContent,
    TargetSnapshot,
    TargetWriteDisposition,
    TargetWriteResult,
    resolve_target_write,
    resolve_target_write_attempt,
)
from app.services.archive.zip_reader import ArchiveFormatError, ZipReader

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
EXTRACTION_OUTCOME_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "extraction-outcome-scenarios-v2.json"
TARGET_WRITE_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "target-write-resolution-scenarios-v2.json"
TOPOLOGY_TRACE_FIXTURE_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "topology-execution-traces-v2.json"


class MemoryRandomReader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.closed = False
        self.reads: list[tuple[int, int]] = []

    async def read_at(self, offset: int, length: int) -> bytes:
        self.reads.append((offset, length))
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
        self.file_info_paths: list[str] = []
        self.listed_paths: list[str] = []
        self.created_directory_paths: list[str] = []
        self.written_file_paths: list[str] = []

    async def get_file_info(self, path: str) -> FileInfo:
        self.file_info_paths.append(path)
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

    async def list_directory(self, path: str = "") -> DirectoryListing:
        self.listed_paths.append(path)
        if path in self.files:
            raise NotADirectoryError(path)
        if path and path not in self.directories:
            raise FileNotFoundError(path)
        prefix = f"{path}/" if path else ""
        items = [
            await self.get_file_info(candidate)
            for candidate in sorted(self.directories | set(self.files))
            if candidate.startswith(prefix) and "/" not in candidate[len(prefix) :]
        ]
        return DirectoryListing(path=path, items=items, total=len(items))

    async def open_random_access_reader(self, path: str) -> MemoryRandomReader:
        assert path == "input.zip"
        return self.reader

    async def create_directory(self, path: str) -> None:
        self.created_directory_paths.append(path)
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
        self.written_file_paths.append(path)
        replaced = path in self.files and overwrite
        if path in self.files and not overwrite:
            raise FileExistsError(path)
        content = b"".join([chunk async for chunk in stream])
        self.files[path] = content
        return TargetWriteResult(len(content), replaced=replaced)


class CaseInsensitiveMemoryExtractionBackend(MemoryExtractionBackend):
    async def get_file_info(self, path: str) -> FileInfo:
        if path != "input.zip":
            matching_path = next(
                (candidate for candidate in self.directories | set(self.files) if candidate.casefold() == path.casefold()),
                None,
            )
            if matching_path is not None:
                return await super().get_file_info(matching_path)
        return await super().get_file_info(path)


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

    async def list_directory(self, path: str = "") -> DirectoryListing:
        return await self.backend.list_directory(path)

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


class NonListingMemoryExtractionDestination:
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


def _flat_archive_bytes(member_names: list[str]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for member_name in member_names:
            archive.writestr(member_name, member_name)
    return output.getvalue()


def _unavailable_member_archive_bytes(member_path: str = "unavailable.txt") -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(member_path, b"unavailable payload")
    archive_bytes = bytearray(output.getvalue())
    central_directory_offset = archive_bytes.index(b"PK\x01\x02")
    archive_bytes[central_directory_offset + 10 : central_directory_offset + 12] = (99).to_bytes(2, "little")
    return bytes(archive_bytes)


def _bzip2_archive_bytes() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_BZIP2) as archive:
        archive.writestr("compressed.txt", b"BZIP2 extraction content" * 100)
    return output.getvalue()


class _NonSeekableArchiveBuffer(io.BytesIO):
    def seekable(self) -> bool:
        return False

    def seek(self, _offset: int, _whence: int = io.SEEK_SET) -> int:
        raise OSError("archive buffer is not seekable")


def _data_descriptor_archive_bytes() -> bytes:
    output = _NonSeekableArchiveBuffer()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("descriptor.txt", b"data descriptor content")
    return output.getvalue()


def _zip64_archive_bytes() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        with archive.open("zip64.txt", "w", force_zip64=True) as member:
            member.write(b"ZIP64 extraction content")
    return output.getvalue()


def _malformed_local_header_archive_bytes() -> bytes:
    archive = bytearray(_flat_archive_bytes(["broken.txt"]))
    archive[:4] = b"FAIL"
    return bytes(archive)


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


def test_target_write_policy_matches_the_v2_scenario_corpus() -> None:
    corpus = json.loads(TARGET_WRITE_CORPUS_PATH.read_text(encoding="utf-8"))

    for scenario in corpus["scenarios"]:
        phase = scenario.get("phase")
        attempt_ordinal = scenario.get("attempt_ordinal")
        if phase is None:
            assert attempt_ordinal is None, scenario["name"]
        else:
            assert phase == "after_create_race", scenario["name"]
            assert attempt_ordinal in {1, 2}, scenario["name"]
        target = TargetSnapshot.missing()
        if scenario["target"] == "regular_file":
            target_modified_at = scenario.get("target_modified_at")
            target = TargetSnapshot(
                exists=True,
                is_regular_file=True,
                modified_at=datetime.fromisoformat(target_modified_at) if target_modified_at is not None else None,
            )
        elif scenario["target"] == "other":
            target = TargetSnapshot(exists=True)
        source_modified_at = scenario.get("source_modified_at")
        disposition = resolve_target_write(
            ResolvedCollisionPolicy(scenario["policy"]),
            datetime.fromisoformat(source_modified_at) if source_modified_at is not None else None,
            target,
        )

        assert disposition == TargetWriteDisposition(scenario["expected"]), scenario["name"]


@pytest.mark.asyncio
async def test_target_write_controller_matches_the_v2_attempt_scenario_corpus() -> None:
    corpus = json.loads(TARGET_WRITE_CORPUS_PATH.read_text(encoding="utf-8"))

    for scenario in corpus["attempt_scenarios"]:
        steps = iter(scenario["steps"])
        write_attempts = 0
        stream_polls = 0

        async def observe_target(_path: str) -> FileInfo:
            step = next(steps)
            assert step["kind"] == "observe", scenario["name"]
            if step["target"] == "missing":
                raise FileNotFoundError()
            if step["target"] == "regular_file":
                target_modified_at = step.get("target_modified_at")
                return FileInfo(
                    name="entry.txt",
                    path="output/entry.txt",
                    type=FileType.FILE,
                    size=7,
                    modified_at=datetime.fromisoformat(target_modified_at) if target_modified_at is not None else None,
                )
            assert step["target"] == "other", scenario["name"]
            return FileInfo(name="entry.txt", path="output/entry.txt", type=FileType.DIRECTORY)

        def stream_factory() -> AsyncIterator[bytes]:
            async def stream() -> AsyncIterator[bytes]:
                nonlocal stream_polls
                stream_polls += 1
                yield b"content"

            return stream()

        async def write_target(_path: str, stream: AsyncIterator[bytes], _overwrite: bool, _mtime: datetime | None) -> int:
            nonlocal write_attempts
            write_attempts += 1
            step = next(steps)
            assert step["kind"] == "write", scenario["name"]
            if step["result"] == "target_exists_before_content":
                raise TargetExistsBeforeContent()
            assert step["result"] == "ready", scenario["name"]
            bytes_written = 0
            async for chunk in stream:
                bytes_written += len(chunk)
            return bytes_written

        source_modified_at = scenario.get("source_modified_at")
        result = await resolve_target_write_attempt(
            target_path="output/entry.txt",
            policy=ResolvedCollisionPolicy(scenario["policy"]),
            source_modified_at=datetime.fromisoformat(source_modified_at) if source_modified_at is not None else None,
            observe_target=observe_target,
            stream_factory=stream_factory,
            write_target=write_target,
        )

        assert result.disposition == TargetWriteDisposition(scenario["expected"]), scenario["name"]
        assert write_attempts == scenario["expected_attempts"], scenario["name"]
        assert stream_polls == scenario["expected_stream_polls"], scenario["name"]
        with pytest.raises(StopIteration):
            next(steps)


@pytest.mark.asyncio
async def test_target_write_controller_does_not_poll_pre_content_collision_stream() -> None:
    target: FileInfo | None = None
    stream_polls = 0

    async def observe_target(_path: str) -> FileInfo:
        if target is None:
            raise FileNotFoundError()
        return target

    def stream_factory() -> AsyncIterator[bytes]:
        async def stream() -> AsyncIterator[bytes]:
            nonlocal stream_polls
            stream_polls += 1
            yield b"content"

        return stream()

    async def write_target(_path: str, _stream: AsyncIterator[bytes], _overwrite: bool, _mtime: datetime | None) -> int:
        nonlocal target
        target = FileInfo(name="entry.txt", path="output/entry.txt", type=FileType.FILE, size=7)
        raise TargetExistsBeforeContent()

    result = await resolve_target_write_attempt(
        target_path="output/entry.txt",
        policy=ResolvedCollisionPolicy.ASK,
        source_modified_at=None,
        observe_target=observe_target,
        stream_factory=stream_factory,
        write_target=write_target,
    )

    assert result.disposition == TargetWriteDisposition.AWAIT_COLLISION
    assert stream_polls == 0


@pytest.mark.asyncio
async def test_target_write_controller_retries_once_when_late_target_disappears() -> None:
    observations = 0
    write_attempts: list[bool] = []

    async def observe_target(_path: str) -> FileInfo:
        nonlocal observations
        observations += 1
        raise FileNotFoundError()

    async def stream() -> AsyncIterator[bytes]:
        yield b"content"

    async def write_target(_path: str, _stream: AsyncIterator[bytes], overwrite: bool, _mtime: datetime | None) -> int:
        write_attempts.append(overwrite)
        if len(write_attempts) == 1:
            raise TargetExistsBeforeContent()
        return 7

    result = await resolve_target_write_attempt(
        target_path="output/entry.txt",
        policy=ResolvedCollisionPolicy.ASK,
        source_modified_at=None,
        observe_target=observe_target,
        stream_factory=stream,
        write_target=write_target,
    )

    assert result.disposition == TargetWriteDisposition.CREATE_NEW
    assert result.bytes_written == 7
    assert observations == 2
    assert write_attempts == [False, False]


@pytest.mark.asyncio
async def test_target_write_controller_propagates_native_failures() -> None:
    failure = OSError("destination is unavailable")

    async def observe_target(_path: str) -> FileInfo:
        raise FileNotFoundError()

    async def stream() -> AsyncIterator[bytes]:
        yield b"content"

    async def write_target(_path: str, _stream: AsyncIterator[bytes], _overwrite: bool, _mtime: datetime | None) -> int:
        raise failure

    with pytest.raises(OSError, match="destination is unavailable") as raised:
        await resolve_target_write_attempt(
            target_path="output/entry.txt",
            policy=ResolvedCollisionPolicy.ASK,
            source_modified_at=None,
            observe_target=observe_target,
            stream_factory=stream,
            write_target=write_target,
        )

    assert raised.value is failure


@pytest.mark.asyncio
async def test_directory_creation_retries_when_a_late_target_disappears() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    original_create_directory = backend.create_directory
    attempts = 0

    async def create_directory(path: str) -> None:
        nonlocal attempts
        if path == "output/docs":
            attempts += 1
            if attempts == 1:
                raise FileExistsError(path)
        await original_create_directory(path)

    backend.create_directory = create_directory  # type: ignore[method-assign]

    result = await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert result.files_extracted == 2
    assert attempts == 2


@pytest.mark.asyncio
async def test_repeated_unresolved_directory_collision_pauses_resolution() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    async def create_directory(path: str) -> None:
        if path == "output/docs":
            raise FileExistsError(path)
        backend.directories.add(path)

    backend.create_directory = create_directory  # type: ignore[method-assign]

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert error.value.conflicts[0].member_path == "docs/readme.txt"
    assert error.value.conflicts[0].target_path == "output/docs"
    assert error.value.conflicts[0].is_directory is True


@pytest.mark.asyncio
async def test_extracts_safe_members_to_new_paths() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    result = await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert result.files_extracted == 2
    assert result.extracted_bytes == 10
    assert backend.directories == {"output", "output/docs"}
    assert backend.files == {"output/docs/readme.txt": b"readme", "output/root.txt": b"root"}
    assert backend.reader.closed is True
    assert sum(length == 30 for _, length in backend.reader.reads) == 2
    assert backend.created_directory_paths == ["output", "output/docs"]
    assert backend.written_file_paths == ["output/docs/readme.txt", "output/root.txt"]


@pytest.mark.asyncio
async def test_materializes_explicit_directories_in_effective_depth_and_path_order() -> None:
    backend = MemoryExtractionBackend(_flat_archive_bytes(["z/", "a/child/", "a/"]))
    completed: list[ArchiveExtractionDestinationResult] = []

    async def record_outcome(outcome: ArchiveExtractionDestinationResult) -> None:
        completed.append(outcome)

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        on_member_completed=record_outcome,
    )

    assert result.directories_created == 4
    assert backend.created_directory_paths == ["output", "output/a", "output/z", "output/a/child"]
    assert [outcome.member_path for outcome in completed] == ["a", "z", "a/child"]


@pytest.mark.asyncio
async def test_records_an_unavailable_selected_member_as_skipped_without_reading_it() -> None:
    backend = MemoryExtractionBackend(_unavailable_member_archive_bytes())
    outcomes: list[ArchiveExtractionDestinationResult] = []

    async def record_outcome(outcome: ArchiveExtractionDestinationResult) -> None:
        outcomes.append(outcome)

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        on_member_completed=record_outcome,
    )

    assert result.files_extracted == 0
    assert result.files_skipped == 1
    assert result.skipped_members == ("unavailable.txt",)
    assert outcomes == [ArchiveExtractionDestinationResult("unavailable.txt", "skipped", "output/unavailable.txt")]
    assert backend.files == {}
    assert backend.directories == set()
    assert (0, 30) not in backend.reader.reads


@pytest.mark.asyncio
async def test_skips_an_unavailable_member_without_preflighting_its_blocked_parent() -> None:
    backend = MemoryExtractionBackend(_unavailable_member_archive_bytes("folder/file.txt"))
    backend.directories.add("output")
    backend.files["output/folder"] = b"existing file"

    result = await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert result.files_skipped == 1
    assert result.skipped_members == ("folder/file.txt",)
    assert backend.file_info_paths == ["input.zip"]
    assert backend.written_file_paths == []


@pytest.mark.asyncio
async def test_direct_extraction_parses_the_central_directory_once() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    original_directory = ZipReader._directory
    directory_calls = 0

    async def count_directory(reader: ZipReader):
        nonlocal directory_calls
        directory_calls += 1
        return await original_directory(reader)

    with patch.object(ZipReader, "_directory", count_directory):
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert directory_calls == 1


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
    backend.directories.add("output")
    backend.files["output/docs"] = b"existing file"

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert [(conflict.member_path, conflict.is_directory) for conflict in error.value.conflicts] == [("docs/readme.txt", True)]
    assert backend.listed_paths == ["output"]


@pytest.mark.asyncio
async def test_preflight_detects_case_insensitive_destination_collisions() -> None:
    backend = CaseInsensitiveMemoryExtractionBackend(_flat_archive_bytes(["report.txt"]))
    backend.directories.add("output")
    backend.files["output/Report.txt"] = b"existing"

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert [(conflict.member_path, conflict.target_path) for conflict in error.value.conflicts] == [("report.txt", "output/report.txt")]
    assert backend.listed_paths == ["output"]


@pytest.mark.asyncio
async def test_extracts_only_the_last_exact_duplicate_member() -> None:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("duplicate.txt", "first")
        archive.writestr("duplicate.txt", "last")
    backend = MemoryExtractionBackend(output.getvalue())

    result = await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert result.files_extracted == 1
    assert backend.written_file_paths == ["output/duplicate.txt"]
    assert backend.files["output/duplicate.txt"] == b"last"


@pytest.mark.asyncio
async def test_case_distinct_members_pause_through_generic_collision_and_resume_after_rename() -> None:
    backend = CaseInsensitiveMemoryExtractionBackend(_flat_archive_bytes(["Report.txt", "report.txt"]))

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert [(conflict.member_path, conflict.target_path) for conflict in error.value.conflicts] == [("report.txt", "output/report.txt")]
    assert backend.files == {"output/Report.txt": b"Report.txt"}

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        completed_members={"Report.txt"},
        member_rename_targets={"report.txt": "report-renamed.txt"},
    )

    assert result.files_extracted == 1
    assert backend.files == {
        "output/Report.txt": b"Report.txt",
        "output/report-renamed.txt": b"report.txt",
    }


@pytest.mark.asyncio
async def test_preflight_falls_back_to_target_stats_without_directory_listing() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.directories.add("output")
    backend.files["output/root.txt"] = b"existing"
    destination = NonListingMemoryExtractionDestination(backend)

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(
            backend,
            destination=destination,
            archive_path="input.zip",
            destination_root="output",
        )

    assert [(conflict.member_path, conflict.target_path) for conflict in error.value.conflicts] == [("root.txt", "output/root.txt")]
    assert backend.listed_paths == []


@pytest.mark.asyncio
async def test_preflight_propagates_directory_listing_failures() -> None:
    backend = MemoryExtractionBackend(_flat_archive_bytes(["root.txt"]))
    backend.directories.add("output")

    async def fail_listing(_path: str = "") -> DirectoryListing:
        raise OSError("directory listing failed")

    backend.list_directory = fail_listing  # type: ignore[method-assign]

    with pytest.raises(OSError, match="directory listing failed"):
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")


@pytest.mark.asyncio
async def test_preflight_rejects_incomplete_directory_listings() -> None:
    backend = MemoryExtractionBackend(_flat_archive_bytes(["root.txt"]))
    backend.directories.add("output")

    async def incomplete_listing(path: str = "") -> DirectoryListing:
        return DirectoryListing(path=path, items=[], total=1)

    backend.list_directory = incomplete_listing  # type: ignore[method-assign]

    with pytest.raises(OSError, match="listing is incomplete"):
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")


@pytest.mark.asyncio
async def test_flat_preflight_uses_one_listing_and_defers_file_observations_to_writes() -> None:
    member_names = ["first.txt", "second.txt", "third.txt"]
    backend = MemoryExtractionBackend(_flat_archive_bytes(member_names))
    backend.directories.add("output")

    result = await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    target_paths = {f"output/{member_name}" for member_name in member_names}
    assert result.files_extracted == len(member_names)
    assert backend.listed_paths == ["output"]
    assert sum(path in target_paths for path in backend.file_info_paths) == len(member_names)


@pytest.mark.asyncio
async def test_extracts_bzip2_members_without_staging() -> None:
    backend = MemoryExtractionBackend(_bzip2_archive_bytes())

    result = await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert result.files_extracted == 1
    assert backend.files["output/compressed.txt"] == b"BZIP2 extraction content" * 100


@pytest.mark.asyncio
async def test_extracts_data_descriptor_members() -> None:
    backend = MemoryExtractionBackend(_data_descriptor_archive_bytes())

    result = await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert result.files_extracted == 1
    assert backend.files["output/descriptor.txt"] == b"data descriptor content"


@pytest.mark.asyncio
async def test_extracts_zip64_members() -> None:
    backend = MemoryExtractionBackend(_zip64_archive_bytes())

    result = await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert result.files_extracted == 1
    assert backend.files["output/zip64.txt"] == b"ZIP64 extraction content"


@pytest.mark.asyncio
async def test_rejects_malformed_local_header_without_creating_the_target() -> None:
    backend = MemoryExtractionBackend(_malformed_local_header_archive_bytes())

    with pytest.raises(ArchiveExtractionMemberError, match="local header is invalid"):
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert "output/broken.txt" not in backend.files


@pytest.mark.asyncio
async def test_preflight_logs_aggregate_metrics_without_member_or_destination_paths(caplog: pytest.LogCaptureFixture) -> None:
    backend = MemoryExtractionBackend(_flat_archive_bytes(["private-member.txt"]))
    backend.directories.add("private-output")

    with caplog.at_level(logging.INFO, logger="app.services.archive.telemetry"):
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="private-output")

    message = next(record.getMessage() for record in caplog.records if "operation='extraction_preflight'" in record.getMessage())
    assert "planned_file_count=1" in message
    assert "directory_listing_operations=1" in message
    assert "private-member.txt" not in message
    assert "private-output" not in message


@pytest.mark.asyncio
async def test_preflight_does_not_probe_renamed_descendants_of_a_missing_parent() -> None:
    backend = MemoryExtractionBackend(_flat_archive_bytes(["root.txt"]))

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        member_rename_targets={"root.txt": "deep/tree/root.txt"},
    )

    assert result.renamed_members == ("root.txt",)
    assert backend.listed_paths == []
    assert "output/deep" not in backend.file_info_paths
    assert backend.files["output/deep/tree/root.txt"] == b"root.txt"


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
async def test_rename_validation_rejects_aliased_effective_directories() -> None:
    entries = await _archive_entries(_flat_archive_bytes(["first/", "second/"]))

    with pytest.raises(ArchiveFormatError, match="output directories collide"):
        validate_archive_rename_targets(entries, {"first": "shared", "second": "shared"})


@pytest.mark.asyncio
async def test_rename_validation_preserves_untouched_case_distinct_members() -> None:
    entries = await _archive_entries(_flat_archive_bytes(["Report.txt", "report.txt", "other.txt"]))

    targets = validate_archive_rename_targets(entries, {"other.txt": "renamed.txt"})

    assert targets == {"other.txt": "renamed.txt"}


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
    backend.directories.add("output")
    backend.files["output/root.txt"] = b"existing"

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert [(conflict.member_path, conflict.target_path) for conflict in error.value.conflicts] == [("root.txt", "output/root.txt")]
    conflict = error.value.conflicts[0]
    assert conflict.source_size == len(b"root")
    assert conflict.target_size == len(b"existing")
    assert backend.files == {"output/root.txt": b"existing"}
    assert backend.directories == {"output"}
    assert backend.reader.closed is True


@pytest.mark.asyncio
async def test_preflights_a_non_file_target_as_an_overwrite_collision() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())
    backend.directories.add("output/root.txt")

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(backend, archive_path="input.zip", destination_root="output")

    assert [(conflict.member_path, conflict.target_path, conflict.is_directory) for conflict in error.value.conflicts] == [
        ("root.txt", "output/root.txt", False)
    ]


@pytest.mark.asyncio
async def test_reclassifies_a_file_created_after_preflight_as_a_collision_without_a_policy() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    async def create_competing_file(path: str, _stream: AsyncIterator[bytes], **_kwargs: object) -> int:
        backend.files[path] = b"existing"
        backend.modified_at[path] = datetime(2026, 1, 2, tzinfo=timezone.utc)
        raise TargetExistsBeforeContent(path)

    backend.write_file_from_stream = create_competing_file  # type: ignore[method-assign]

    with pytest.raises(ArchiveExtractionConflicts) as error:
        await extract_archive_to_new_paths(
            backend,
            archive_path="input.zip",
            destination_root="output",
        )

    conflict = error.value.conflicts[0]
    assert (conflict.member_path, conflict.target_path) == ("docs/readme.txt", "output/docs/readme.txt")
    assert conflict.source_size == len(b"readme")
    assert conflict.target_size == len(b"existing")
    assert conflict.target_modified_at == datetime(2026, 1, 2, tzinfo=timezone.utc)
    assert backend.reader.closed is True


@pytest.mark.asyncio
async def test_replace_older_skips_a_newer_target_created_after_preflight() -> None:
    backend = MemoryExtractionBackend(_archive_bytes())

    async def create_newer_competing_file(path: str, _stream: AsyncIterator[bytes], **_kwargs: object) -> int:
        backend.files[path] = b"existing"
        backend.modified_at[path] = datetime(2026, 1, 2, tzinfo=timezone.utc)
        raise TargetExistsBeforeContent(path)

    backend.write_file_from_stream = create_newer_competing_file  # type: ignore[method-assign]

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        existing_file_policy="replace_older",
    )

    assert result.files_extracted == 0
    assert result.files_skipped == 2
    assert backend.files["output/docs/readme.txt"] == b"existing"


@pytest.mark.asyncio
async def test_replace_older_retries_an_older_target_created_after_preflight() -> None:
    topology_fixture = json.loads(TOPOLOGY_TRACE_FIXTURE_PATH.read_text(encoding="utf-8"))
    scenario_name = next(case["scenario"] for case in topology_fixture["target_write_attempt_cases"] if case["topology"] == "smb_to_smb")
    target_write_fixture = json.loads(TARGET_WRITE_CORPUS_PATH.read_text(encoding="utf-8"))
    scenario = next(scenario for scenario in target_write_fixture["attempt_scenarios"] if scenario["name"] == scenario_name)
    assert scenario["expected"] == "replace_existing"

    backend = MemoryExtractionBackend(_archive_bytes())
    source_modified_at = (await _archive_entries(backend.archive))[0].modified_at
    assert source_modified_at is not None
    writes: list[tuple[str, bool]] = []

    async def write_after_race(path: str, stream: AsyncIterator[bytes], **kwargs: object) -> int:
        overwrite = kwargs["overwrite"]
        assert isinstance(overwrite, bool)
        writes.append((path, overwrite))
        if path == "output/docs/readme.txt" and len([attempt for attempt in writes if attempt[0] == path]) == 1:
            backend.files[path] = b"existing"
            backend.modified_at[path] = source_modified_at - timedelta(seconds=1)
            raise TargetExistsBeforeContent(path)
        return await MemoryExtractionBackend.write_file_from_stream(backend, path, stream, **kwargs)

    backend.write_file_from_stream = write_after_race  # type: ignore[method-assign]

    result = await extract_archive_to_new_paths(
        backend,
        archive_path="input.zip",
        destination_root="output",
        existing_file_policy="replace_older",
    )

    assert [overwrite for path, overwrite in writes if path == "output/docs/readme.txt"] == [False, True]
    assert result.files_replaced == scenario["expected_attempts"] - 1
    assert backend.files["output/docs/readme.txt"] == b"readme"


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
