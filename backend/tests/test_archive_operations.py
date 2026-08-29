"""Integration tests for persisted archive-operation lifecycle state."""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from unittest.mock import ANY, AsyncMock, patch
from zipfile import ZipFile

import pytest
from fastapi import HTTPException, status
from fastapi.testclient import TestClient
from sqlmodel import select

from app.api.archive_operations import _ensure_mixed_archive_parent_directories
from app.models.archive_operation import (
    ARCHIVE_OPERATION_HEARTBEAT_TIMEOUT_SECONDS,
    ArchiveOperation,
    ArchiveOperationKind,
    ArchiveOperationPhase,
)
from app.models.audit import AuditEvent
from app.models.connection import Connection
from app.models.file import FileInfo, FileType
from app.services.archive.coordinator import (
    CREATION_OUTCOME_CHECKPOINT_VERSION,
    EXTRACTION_OUTCOME_CHECKPOINT_VERSION,
    ArchiveCreationCoordinator,
    ArchiveCreationManifest,
    ArchiveCreationManifestMember,
    ArchiveCreationState,
    ArchiveExtractionManifest,
    ArchiveExtractionManifestMember,
    ArchiveExtractionRelayState,
    DurableArchiveExecutionStateStore,
    advance_relay_transfer,
    begin_relay_execution,
    commit_creation_member_outcome,
    complete_checked_relay_execution,
    complete_relay_execution,
    completed_extraction_member_paths,
    creation_outcome_summary,
    existing_files_decision,
    load_archive_checkpoint,
    member_error_decision,
    new_extraction_outcome_checkpoint,
    persist_extraction_member_outcome,
    record_extraction_member_outcome,
    start_archive_execution,
)
from app.services.archive.creation import ArchiveCreationEntry, ArchiveCreationMemberOutcome, ArchiveCreationResult
from app.services.archive.execution import ArchiveCompanionRelayPurpose, ArchiveExecutionDriver, resolve_archive_execution_topology
from app.services.archive.extraction import (
    ArchiveExtractionConflict,
    ArchiveExtractionConflicts,
    ArchiveExtractionDestinationResult,
    ArchiveExtractionMemberError,
    ArchiveExtractionMemberOutcome,
    ArchiveExtractionResult,
)
from app.services.archive.operation_monitor import expire_stale_archive_operations
from app.services.archive.state_store import ArchiveOperationStateStore


class MemoryRandomAccessReader:
    """Minimal archive reader used to exercise scoped relay endpoints."""

    def __init__(self, data: bytes) -> None:
        self.data = data

    async def read_at(self, offset: int, length: int) -> bytes:
        return self.data[offset : offset + length]

    async def close(self) -> None:
        return None


def configure_direct_extraction_archive(backend: AsyncMock, members: dict[str, bytes]) -> None:
    """Configure a direct-extraction backend with a small valid ZIP source."""

    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        for member_path, contents in members.items():
            archive.writestr(member_path, contents)
    archive_bytes = archive_buffer.getvalue()
    backend.get_file_info.return_value = FileInfo(
        name="input.zip",
        path="input.zip",
        type=FileType.FILE,
        size=len(archive_bytes),
    )
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)


def completed_extraction_runner(
    result: ArchiveExtractionResult,
    outcomes: list[ArchiveExtractionDestinationResult],
):
    """Return an extraction adapter mock that publishes its terminal ledger entries."""

    async def run(*_args, on_member_completed, **_kwargs):
        for outcome in outcomes:
            await on_member_completed(outcome)
        return result

    return run


class MemoryArchiveExecutionStateStore:
    def __init__(self) -> None:
        self.transitions: list[tuple[ArchiveOperationPhase, ArchiveOperationPhase]] = []

    def transition(
        self,
        operation: ArchiveOperation,
        *,
        expected_phase: ArchiveOperationPhase,
        next_phase: ArchiveOperationPhase,
        additional_changes: dict[str, object] | None = None,
    ) -> ArchiveOperation:
        assert operation.phase == expected_phase
        self.transitions.append((expected_phase, next_phase))
        operation.phase = next_phase
        if additional_changes is not None:
            for name, value in additional_changes.items():
                setattr(operation, name, value)
        return operation

    def update_checkpoint(self, operation: ArchiveOperation, checkpoint_json: str) -> ArchiveOperation:
        operation.checkpoint_json = checkpoint_json
        return operation

    def await_decision(self, operation: ArchiveOperation, decision: dict[str, object]) -> ArchiveOperation:
        operation.phase = ArchiveOperationPhase.AWAITING_USER_DECISION
        operation.pending_decision_json = json.dumps(decision)
        return operation

    def fail(self, operation: ArchiveOperation, message: str) -> ArchiveOperation:
        operation.phase = ArchiveOperationPhase.FAILED
        operation.last_error_json = json.dumps({"message": message})
        return operation

    def cancellation_requested(self, operation: ArchiveOperation) -> bool:
        return operation.cancellation_requested

    def heartbeat(self, operation: ArchiveOperation) -> None:
        return None

    async def is_cancelled(self, operation: ArchiveOperation) -> bool:
        return operation.cancellation_requested


def test_companion_creation_summary_rejects_checkpoint_entry_without_size() -> None:
    operation = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.CREATE,
        checkpoint_json=json.dumps({"source_manifest": [{"is_directory": False, "source_identity": {}}]}),
    )

    with pytest.raises(HTTPException, match="Archive operation checkpoint is invalid") as exc_info:
        creation_outcome_summary(load_archive_checkpoint(operation))
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT


def test_creation_state_rejects_duplicate_members_and_bounds_member_lookup() -> None:
    member = {"archive_path": "docs/readme.txt", "is_directory": False, "source_identity": {"size": 7}}
    state = ArchiveCreationState.from_checkpoint({"source_manifest": [member]})

    assert state.member("docs/readme.txt").source_size == 7
    with pytest.raises(HTTPException, match="invalid or unavailable") as exc_info:
        state.member("missing.txt")
    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    with pytest.raises(HTTPException, match="checkpoint is invalid") as exc_info:
        ArchiveCreationState.from_checkpoint({"source_manifest": [member, member]})
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    with pytest.raises(HTTPException, match="checkpoint is invalid") as exc_info:
        ArchiveCreationState.from_checkpoint(
            {
                "source_manifest": [
                    {"archive_path": "folder", "is_directory": False, "source_identity": {"size": 1}},
                    {"archive_path": "folder/child.txt", "is_directory": False, "source_identity": {"size": 1}},
                ]
            }
        )
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT


def test_relay_extraction_state_validates_and_persists_companion_callbacks() -> None:
    state_store = MemoryArchiveExecutionStateStore()
    manifest = ArchiveExtractionManifest.from_members(
        [ArchiveExtractionManifestMember("readme.txt", False, 5, "2026-08-28T00:00:00+00:00")]
    )

    def streaming_operation() -> ArchiveOperation:
        return ArchiveOperation(
            user_id=uuid.uuid4(),
            kind=ArchiveOperationKind.EXTRACT,
            phase=ArchiveOperationPhase.STREAMING,
            destination_path="output",
            checkpoint_json=json.dumps(new_extraction_outcome_checkpoint(manifest=manifest)),
        )

    completion_state = ArchiveExtractionRelayState.from_operation(state_store, streaming_operation())
    with pytest.raises(HTTPException, match="target path is invalid") as exc_info:
        completion_state.complete_member(ArchiveExtractionMemberOutcome("readme.txt", "extracted", "outside.txt", extracted_bytes=5))
    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    completed = completion_state.complete_member(
        ArchiveExtractionMemberOutcome("readme.txt", "extracted", "output/readme.txt", extracted_bytes=5)
    )
    assert json.loads(completed.checkpoint_json)["member_outcomes"]["readme.txt"]["status"] == "extracted"

    collision_state = ArchiveExtractionRelayState.from_operation(state_store, streaming_operation())
    paused_for_collision = collision_state.pause_for_collision(
        member_path="readme.txt",
        is_directory=False,
        target_size=7,
        target_modified_at=None,
    )
    collision_decision = json.loads(paused_for_collision.pending_decision_json)
    assert collision_decision["kind"] == "existing_files"
    assert collision_decision["conflicts"][0]["target_path"] == "output/readme.txt"

    error_state = ArchiveExtractionRelayState.from_operation(state_store, streaming_operation())
    paused_for_error = error_state.pause_for_member_error(
        member_path="readme.txt",
        message="Disk full",
        partial_output=True,
    )
    assert json.loads(paused_for_error.checkpoint_json)["member_outcomes"]["readme.txt"]["status"] == "partial"
    assert json.loads(paused_for_error.pending_decision_json)["kind"] == "member_error"


def test_creation_state_normalizes_member_lookup_and_validates_member_reports() -> None:
    manifest = ArchiveCreationManifest.from_members([ArchiveCreationManifestMember("docs/readme.txt", False, 7, None, None)])
    state = ArchiveCreationState.from_checkpoint(manifest.empty_checkpoint())

    outcome = state.expected_outcome("docs\\readme.txt")

    assert outcome == ArchiveCreationMemberOutcome("docs/readme.txt", "created", 7)
    assert state.has_committed_outcome(outcome) is False
    with pytest.raises(HTTPException, match="completion counts are invalid") as exc_info:
        state.validate_report(ArchiveCreationMemberOutcome("docs/readme.txt", "created", 6))
    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_creation_member_commit_normalizes_and_persists_manifest_outcome() -> None:
    operation = ArchiveOperation(user_id=uuid.uuid4(), kind=ArchiveOperationKind.CREATE)
    manifest = ArchiveCreationManifest.from_members([ArchiveCreationManifestMember("docs/readme.txt", False, 7, None, None)])
    operation.checkpoint_json = json.dumps(manifest.empty_checkpoint())

    committed = commit_creation_member_outcome(
        MemoryArchiveExecutionStateStore(),
        operation,
        ArchiveCreationMemberOutcome("docs\\readme.txt", "created", 7),
    )

    assert json.loads(committed.checkpoint_json)["creation_member_outcomes"] == {
        "docs/readme.txt": {"status": "created", "source_bytes": 7}
    }


def test_creation_manifest_centralizes_relay_normalization_and_validation() -> None:
    manifest = ArchiveCreationManifest.from_members([ArchiveCreationManifestMember("docs\\readme.txt", False, 7, None, None)])

    assert manifest.members[0].archive_path == "docs/readme.txt"
    assert manifest.empty_checkpoint()["source_manifest"] == [
        {
            "archive_path": "docs/readme.txt",
            "is_directory": False,
            "source_identity": {"size": 7, "modified_at": None},
        }
    ]
    with pytest.raises(HTTPException, match="duplicate entry names") as exc_info:
        ArchiveCreationManifest.from_members(
            [
                ArchiveCreationManifestMember("Report.txt", False, 1, None, None),
                ArchiveCreationManifestMember("report.txt", False, 1, None, None),
            ]
        )
    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    with pytest.raises(HTTPException, match="duplicate entry names") as exc_info:
        ArchiveCreationManifest.from_members(
            [
                ArchiveCreationManifestMember("folder", False, 1, None, None),
                ArchiveCreationManifestMember("folder/child.txt", False, 1, None, None),
            ]
        )
    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    with pytest.raises(HTTPException, match="directory source size") as exc_info:
        ArchiveCreationManifest.from_members([ArchiveCreationManifestMember("docs", True, 1, None, None)])
    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_creation_member_outcome_recorder_is_idempotent_and_rejects_conflicts() -> None:
    from app.services.archive.coordinator import record_creation_member_outcome
    from app.services.archive.creation import ArchiveCreationMemberOutcome

    checkpoint: dict[str, object] = {"files_created": 99, "directories_created": 99, "source_bytes": 99}
    record_creation_member_outcome(checkpoint, ArchiveCreationMemberOutcome("docs", "directory"))
    record_creation_member_outcome(checkpoint, ArchiveCreationMemberOutcome("docs/readme.txt", "created", 7))
    record_creation_member_outcome(checkpoint, ArchiveCreationMemberOutcome("docs/readme.txt", "created", 7))

    assert checkpoint == {
        "files_created": 1,
        "directories_created": 1,
        "source_bytes": 7,
        "creation_outcome_checkpoint_version": CREATION_OUTCOME_CHECKPOINT_VERSION,
        "creation_member_outcomes": {
            "docs": {"status": "directory", "source_bytes": 0},
            "docs/readme.txt": {"status": "created", "source_bytes": 7},
        },
    }
    with pytest.raises(HTTPException, match="outcome conflicts") as exc_info:
        record_creation_member_outcome(checkpoint, ArchiveCreationMemberOutcome("docs/readme.txt", "created", 8))
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT


def test_creation_outcome_summary_requires_complete_manifest_ledger() -> None:
    checkpoint: dict[str, object] = {
        "creation_member_outcomes": {
            "docs": {"status": "directory", "source_bytes": 0},
            "docs/readme.txt": {"status": "created", "source_bytes": 7},
        },
        "source_manifest": [
            {"archive_path": "docs", "is_directory": True, "source_identity": {"size": 0}},
            {"archive_path": "docs/readme.txt", "is_directory": False, "source_identity": {"size": 7}},
        ],
    }

    assert creation_outcome_summary(checkpoint).to_checkpoint() == {
        "files_created": 1,
        "directories_created": 1,
        "source_bytes": 7,
    }
    assert checkpoint["creation_outcome_checkpoint_version"] == CREATION_OUTCOME_CHECKPOINT_VERSION
    checkpoint["creation_member_outcomes"] = {"docs": {"status": "directory", "source_bytes": 0}}
    with pytest.raises(HTTPException, match="outcomes did not match"):
        creation_outcome_summary(checkpoint)


@pytest.mark.parametrize("checkpoint_json", ["invalid-json", "[]"])
def test_common_archive_checkpoint_loader_rejects_invalid_state(checkpoint_json: str) -> None:
    operation = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.EXTRACT,
        checkpoint_json=checkpoint_json,
    )

    with pytest.raises(HTTPException, match="Archive operation checkpoint is invalid") as exc_info:
        load_archive_checkpoint(operation)
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT


def test_archive_operation_state_store_rejects_a_stale_revision(session, regular_user) -> None:
    operation = ArchiveOperation(user_id=regular_user.id, kind=ArchiveOperationKind.EXTRACT)
    session.add(operation)
    session.commit()
    session.refresh(operation)
    state_store = ArchiveOperationStateStore()

    state_store.compare_and_swap(
        session,
        operation,
        expected_revision=0,
        changes={"phase": ArchiveOperationPhase.ACCEPTED},
    )
    session.commit()
    assert operation.revision == 1

    with pytest.raises(HTTPException, match="revision is stale") as exc_info:
        state_store.compare_and_swap(
            session,
            operation,
            expected_revision=0,
            changes={"phase": ArchiveOperationPhase.STREAMING},
        )

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT


@pytest.mark.asyncio
async def test_creation_coordinator_uses_injected_state_store() -> None:
    operation = ArchiveOperation(user_id=uuid.uuid4(), kind=ArchiveOperationKind.CREATE)
    state_store = MemoryArchiveExecutionStateStore()

    async def run_creation(on_member_completed, is_cancelled) -> ArchiveCreationResult:
        assert await is_cancelled() is False
        await on_member_completed(ArchiveCreationMemberOutcome("docs", "directory"))
        await on_member_completed(ArchiveCreationMemberOutcome("docs/readme.txt", "created", 11))
        return ArchiveCreationResult(files_created=1, directories_created=1, source_bytes=11)

    completed = await ArchiveCreationCoordinator(
        operation=operation,
        state_store=state_store,
    ).run(
        run_creation,
        manifest=ArchiveCreationManifest.from_members(
            [
                ArchiveCreationManifestMember("docs", True, 0, "docs", None),
                ArchiveCreationManifestMember("docs/readme.txt", False, 11, "docs/readme.txt", None),
            ]
        ),
    )

    assert completed.phase == ArchiveOperationPhase.COMPLETED
    assert json.loads(completed.checkpoint_json) == {
        "creation_outcome_checkpoint_version": CREATION_OUTCOME_CHECKPOINT_VERSION,
        "creation_member_outcomes": {
            "docs": {"status": "directory", "source_bytes": 0},
            "docs/readme.txt": {"status": "created", "source_bytes": 11},
        },
        "files_created": 1,
        "directories_created": 1,
        "source_bytes": 11,
        "source_manifest": [
            {
                "source_path": "docs",
                "archive_path": "docs",
                "is_directory": True,
                "source_identity": {"size": 0, "modified_at": None},
            },
            {
                "source_path": "docs/readme.txt",
                "archive_path": "docs/readme.txt",
                "is_directory": False,
                "source_identity": {"size": 11, "modified_at": None},
            },
        ],
    }
    assert state_store.transitions == [
        (ArchiveOperationPhase.PREPARED, ArchiveOperationPhase.ACCEPTED),
        (ArchiveOperationPhase.ACCEPTED, ArchiveOperationPhase.STREAMING),
        (ArchiveOperationPhase.STREAMING, ArchiveOperationPhase.VERIFYING),
        (ArchiveOperationPhase.VERIFYING, ArchiveOperationPhase.COMPLETED),
    ]


@pytest.mark.asyncio
async def test_creation_coordinator_rejects_incomplete_preflight_manifest() -> None:
    operation = ArchiveOperation(user_id=uuid.uuid4(), kind=ArchiveOperationKind.CREATE)
    state_store = MemoryArchiveExecutionStateStore()
    manifest = ArchiveCreationManifest.from_members(
        [
            ArchiveCreationManifestMember("first.txt", False, 5, "first.txt", None),
            ArchiveCreationManifestMember("second.txt", False, 6, "second.txt", None),
        ]
    )

    async def run_creation(on_member_completed, _is_cancelled) -> ArchiveCreationResult:
        await on_member_completed(ArchiveCreationMemberOutcome("first.txt", "created", 5))
        return ArchiveCreationResult(files_created=1, source_bytes=5)

    with pytest.raises(HTTPException, match="preflight manifest") as exc_info:
        await ArchiveCreationCoordinator(operation=operation, state_store=state_store).run(run_creation, manifest=manifest)

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    assert operation.phase == ArchiveOperationPhase.FAILED


def test_relay_coordinator_starts_checkpoints_and_completes_idempotently(session, regular_user) -> None:
    operation = ArchiveOperation(
        user_id=regular_user.id,
        kind=ArchiveOperationKind.EXTRACT,
        phase=ArchiveOperationPhase.ACCEPTED,
    )
    session.add(operation)
    session.commit()
    session.refresh(operation)

    state_store = DurableArchiveExecutionStateStore(session)
    started = begin_relay_execution(state_store, operation, checkpoint_json=json.dumps({"written_members": []}))

    assert started.phase == ArchiveOperationPhase.STREAMING
    assert started.revision == 1
    assert json.loads(started.checkpoint_json) == {"written_members": []}

    completed = complete_relay_execution(state_store, started, checkpoint_json=json.dumps({"files_extracted": 1}))

    assert completed.phase == ArchiveOperationPhase.COMPLETED
    assert completed.revision == 4
    assert json.loads(completed.checkpoint_json) == {"files_extracted": 1}
    assert complete_relay_execution(state_store, completed).revision == 4


def test_direct_execution_start_policy_preserves_checkpoint_cancellation_and_resume_rules() -> None:
    state_store = MemoryArchiveExecutionStateStore()
    fresh_creation = ArchiveOperation(user_id=uuid.uuid4(), kind=ArchiveOperationKind.CREATE)

    started = start_archive_execution(
        state_store,
        fresh_creation,
        checkpoint_json=json.dumps({"source_manifest": []}),
        allow_streaming=False,
    )

    assert started.phase == ArchiveOperationPhase.STREAMING
    assert json.loads(started.checkpoint_json) == {"source_manifest": []}
    assert state_store.transitions == [
        (ArchiveOperationPhase.PREPARED, ArchiveOperationPhase.ACCEPTED),
        (ArchiveOperationPhase.ACCEPTED, ArchiveOperationPhase.STREAMING),
    ]

    cancelled_before_start = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.EXTRACT,
        phase=ArchiveOperationPhase.ACCEPTED,
        cancellation_requested=True,
    )
    assert start_archive_execution(state_store, cancelled_before_start, allow_streaming=True).phase == ArchiveOperationPhase.CANCELLED

    resumed_extraction = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.EXTRACT,
        phase=ArchiveOperationPhase.STREAMING,
    )
    assert start_archive_execution(state_store, resumed_extraction, allow_streaming=True) is resumed_extraction

    resumed_creation = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.CREATE,
        phase=ArchiveOperationPhase.STREAMING,
    )
    with pytest.raises(HTTPException, match="not ready to execute") as exc_info:
        start_archive_execution(state_store, resumed_creation, allow_streaming=False)
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT


@pytest.mark.asyncio
async def test_checked_relay_completion_aborts_on_cancellation_or_validation_failure() -> None:
    cancelled_operation = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.CREATE,
        phase=ArchiveOperationPhase.STREAMING,
        cancellation_requested=True,
    )
    cancelled_state_store = MemoryArchiveExecutionStateStore()
    cancelled_abort_calls = 0

    async def abort_cancelled() -> None:
        nonlocal cancelled_abort_calls
        cancelled_abort_calls += 1

    async def should_not_prepare() -> str | None:
        raise AssertionError("Cancelled completion must not prepare a checkpoint")

    cancelled = await complete_checked_relay_execution(
        cancelled_state_store,
        cancelled_operation,
        prepare_checkpoint_json=should_not_prepare,
        abort=abort_cancelled,
        validation_failure_message="invalid completion",
        finalization_failure_detail="completion failed",
    )

    assert cancelled.phase == ArchiveOperationPhase.CANCELLED
    assert cancelled_abort_calls == 1

    failed_operation = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.CREATE,
        phase=ArchiveOperationPhase.STREAMING,
    )
    failed_state_store = MemoryArchiveExecutionStateStore()
    failed_abort_calls = 0

    async def abort_failed() -> None:
        nonlocal failed_abort_calls
        failed_abort_calls += 1

    async def invalid_completion() -> str | None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="invalid completion")

    with pytest.raises(HTTPException, match="invalid completion") as exc_info:
        await complete_checked_relay_execution(
            failed_state_store,
            failed_operation,
            prepare_checkpoint_json=invalid_completion,
            abort=abort_failed,
            validation_failure_message="invalid completion",
            finalization_failure_detail="completion failed",
        )

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    assert failed_abort_calls == 1
    assert failed_operation.phase == ArchiveOperationPhase.FAILED
    assert json.loads(failed_operation.last_error_json) == {"message": "invalid completion"}


def test_relay_transfer_guard_transitions_a_cancelled_stream(session, regular_user) -> None:
    operation = ArchiveOperation(
        user_id=regular_user.id,
        kind=ArchiveOperationKind.EXTRACT,
        phase=ArchiveOperationPhase.STREAMING,
        cancellation_requested=True,
    )
    session.add(operation)
    session.commit()
    session.refresh(operation)

    assert advance_relay_transfer(DurableArchiveExecutionStateStore(session), operation) is False
    assert operation.phase == ArchiveOperationPhase.CANCELLED
    assert operation.revision == 1


def test_extraction_outcome_recorder_accumulates_member_outcomes() -> None:
    checkpoint: dict[str, object] = {}

    record_extraction_member_outcome(
        checkpoint,
        ArchiveExtractionMemberOutcome(
            "readme.txt",
            "extracted",
            "output/readme.txt",
            extracted_bytes=5,
            directories_created=1,
            replaced=True,
        ),
        preserve_absent_zero=True,
    )
    record_extraction_member_outcome(
        checkpoint,
        ArchiveExtractionMemberOutcome("skipped.txt", "skipped", "output/skipped.txt"),
        preserve_absent_zero=True,
    )

    assert checkpoint == {
        "extraction_outcome_checkpoint_version": EXTRACTION_OUTCOME_CHECKPOINT_VERSION,
        "member_outcomes": {
            "readme.txt": {
                "status": "extracted",
                "target_path": "output/readme.txt",
                "extracted_bytes": 5,
                "directories_created": 1,
                "replaced": True,
                "renamed": False,
            },
            "skipped.txt": {
                "status": "skipped",
                "target_path": "output/skipped.txt",
                "extracted_bytes": 0,
                "directories_created": 0,
                "replaced": False,
                "renamed": False,
            },
        },
        "files_extracted": 1,
        "directories_created": 1,
        "extracted_bytes": 5,
        "files_skipped": 1,
        "files_replaced": 1,
    }


def test_extraction_outcome_recorder_ignores_exact_duplicates_and_finalizes_partials() -> None:
    checkpoint: dict[str, object] = {
        "member_outcomes": {
            "retry.txt": {
                "status": "partial",
                "target_path": "output/retry.txt",
                "message": "connection closed",
            }
        }
    }
    outcome = ArchiveExtractionMemberOutcome("retry.txt", "extracted", "output/retry.txt", extracted_bytes=5)

    record_extraction_member_outcome(checkpoint, outcome, preserve_absent_zero=True)
    record_extraction_member_outcome(checkpoint, outcome, preserve_absent_zero=True)

    assert checkpoint == {
        "extraction_outcome_checkpoint_version": EXTRACTION_OUTCOME_CHECKPOINT_VERSION,
        "member_outcomes": {
            "retry.txt": {
                "status": "extracted",
                "target_path": "output/retry.txt",
                "extracted_bytes": 5,
                "directories_created": 0,
                "replaced": False,
                "renamed": False,
            }
        },
        "files_extracted": 1,
        "extracted_bytes": 5,
    }


def test_persists_extraction_outcome_through_injected_state_store() -> None:
    operation = ArchiveOperation(user_id=uuid.uuid4(), kind=ArchiveOperationKind.EXTRACT)

    persisted = persist_extraction_member_outcome(
        MemoryArchiveExecutionStateStore(),
        operation,
        ArchiveExtractionMemberOutcome("readme.txt", "extracted", "output/readme.txt", extracted_bytes=5),
    )

    assert persisted is operation
    assert json.loads(operation.checkpoint_json) == {
        "extraction_outcome_checkpoint_version": EXTRACTION_OUTCOME_CHECKPOINT_VERSION,
        "member_outcomes": {
            "readme.txt": {
                "status": "extracted",
                "target_path": "output/readme.txt",
                "extracted_bytes": 5,
                "directories_created": 0,
                "replaced": False,
                "renamed": False,
            }
        },
        "files_extracted": 1,
        "extracted_bytes": 5,
    }


def test_completed_extraction_member_paths_prefers_outcomes_and_excludes_partial_output() -> None:
    checkpoint: dict[str, object] = {
        "written_members": ["legacy-only.txt"],
        "member_outcomes": {
            "complete.txt": {"status": "extracted"},
            "partial.txt": {"status": "partial"},
        },
    }

    assert completed_extraction_member_paths(checkpoint) == ["complete.txt"]


def test_completed_extraction_member_paths_falls_back_to_legacy_members() -> None:
    assert completed_extraction_member_paths({"written_members": ["legacy.txt"]}) == ["legacy.txt"]


def test_versioned_extraction_checkpoint_requires_an_outcome_ledger() -> None:
    checkpoint = {"extraction_outcome_checkpoint_version": EXTRACTION_OUTCOME_CHECKPOINT_VERSION}

    with pytest.raises(HTTPException, match="checkpoint is invalid") as exc_info:
        completed_extraction_member_paths(checkpoint)
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT


def test_extraction_decisions_share_collision_and_member_error_contracts() -> None:
    collision = existing_files_decision([ArchiveExtractionConflict("folder", "output/folder", is_directory=True)])

    assert collision == {
        "kind": "existing_files",
        "allowed_actions": ["rename"],
        "conflicts": [{"member_path": "folder", "target_path": "output/folder", "is_directory": True}],
    }
    assert member_error_decision("readme.txt", "output/readme.txt", "disk full", partial_output=False) == {
        "kind": "member_error",
        "member_path": "readme.txt",
        "target_path": "output/readme.txt",
        "message": "disk full",
        "partial_output": False,
        "allowed_actions": ["retry", "ignore"],
    }


@pytest.mark.parametrize(
    ("kind", "source_connection_id", "destination_connection_id", "driver", "purpose"),
    [
        (ArchiveOperationKind.EXTRACT, "local-drive:c", "local-drive:c", ArchiveExecutionDriver.COMPANION, None),
        (ArchiveOperationKind.EXTRACT, "connection-1", "connection-1", ArchiveExecutionDriver.BACKEND, None),
        (
            ArchiveOperationKind.EXTRACT,
            "local-drive:c",
            "connection-1",
            ArchiveExecutionDriver.COMPANION,
            ArchiveCompanionRelayPurpose.LOCAL_ZIP_TO_SMB_EXTRACT,
        ),
        (
            ArchiveOperationKind.EXTRACT,
            "connection-1",
            "local-drive:c",
            ArchiveExecutionDriver.COMPANION,
            ArchiveCompanionRelayPurpose.SMB_ZIP_TO_LOCAL_EXTRACT,
        ),
        (
            ArchiveOperationKind.CREATE,
            "local-drive:c",
            "connection-1",
            ArchiveExecutionDriver.COMPANION,
            ArchiveCompanionRelayPurpose.LOCAL_TO_SMB_ZIP_CREATE,
        ),
        (
            ArchiveOperationKind.CREATE,
            "connection-1",
            "local-drive:c",
            ArchiveExecutionDriver.COMPANION,
            ArchiveCompanionRelayPurpose.SMB_TO_LOCAL_ZIP_CREATE,
        ),
    ],
)
def test_resolves_archive_execution_topology(
    kind: ArchiveOperationKind,
    source_connection_id: str,
    destination_connection_id: str,
    driver: ArchiveExecutionDriver,
    purpose: ArchiveCompanionRelayPurpose | None,
) -> None:
    topology = resolve_archive_execution_topology(
        kind=kind,
        source_connection_id=source_connection_id,
        destination_connection_id=destination_connection_id,
    )

    assert topology.driver == driver
    assert topology.companion_purpose == purpose
    if purpose is not None:
        assert purpose.kind == kind
        assert purpose.source_is_local == source_connection_id.startswith("local-drive:")
        assert purpose.destination_is_local == destination_connection_id.startswith("local-drive:")


def test_mixed_archive_parent_creation_rejects_target_outside_destination_root() -> None:
    backend = AsyncMock()

    with pytest.raises(HTTPException, match="Archive output path is outside its destination root") as exc_info:
        asyncio.run(
            _ensure_mixed_archive_parent_directories(
                backend,
                destination_root="extracted/archive",
                target_path="other-root/escape.txt",
            )
        )

    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    backend.create_directory.assert_not_awaited()


def test_prepare_read_and_cancel_archive_operation(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
    session,
) -> None:
    response = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
            "manifest_hash": "sha256:fixture",
        },
    )

    assert response.status_code == 201
    operation = response.json()
    assert operation["phase"] == "prepared"
    assert operation["revision"] == 0
    assert operation["cancellation_requested"] is False

    read_response = client.get(f"/api/archive/operations/{operation['id']}", headers=auth_headers_user)
    assert read_response.status_code == 200
    assert read_response.json()["manifest_hash"] == "sha256:fixture"

    transition = client.post(
        f"/api/archive/operations/{operation['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "prepared", "next_phase": "accepted"},
    )
    repeated_transition = client.post(
        f"/api/archive/operations/{operation['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "prepared", "next_phase": "accepted"},
    )
    assert transition.status_code == 200
    assert transition.json()["revision"] == 1
    assert repeated_transition.status_code == 200
    assert repeated_transition.json()["phase"] == "accepted"
    assert repeated_transition.json()["revision"] == 1

    first_cancel = client.post(f"/api/archive/operations/{operation['id']}/cancel", headers=auth_headers_user)
    second_cancel = client.post(f"/api/archive/operations/{operation['id']}/cancel", headers=auth_headers_user)
    assert first_cancel.status_code == 200
    assert first_cancel.json()["revision"] == 2
    assert second_cancel.status_code == 200
    assert second_cancel.json()["cancellation_requested"] is True
    assert second_cancel.json()["revision"] == 2

    stale_transition = client.post(
        f"/api/archive/operations/{operation['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "accepted", "next_phase": "streaming", "expected_revision": 0},
    )
    assert stale_transition.status_code == status.HTTP_409_CONFLICT

    events = list(session.exec(select(AuditEvent).where(AuditEvent.correlation_id == operation["id"])).all())
    assert {(event.event_name, event.result) for event in events} == {
        ("archive.operation.lifecycle", "succeeded"),
        ("archive.operation.decision", "succeeded"),
    }
    assert len(events) == 3
    assert all("backup.zip" not in event.safe_details_json and "backup" not in event.safe_details_json for event in events)


def test_expires_a_stale_archive_operation_as_interrupted(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
    session,
) -> None:
    operation = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
        },
    ).json()
    stale_time = datetime.now(timezone.utc) - timedelta(seconds=ARCHIVE_OPERATION_HEARTBEAT_TIMEOUT_SECONDS + 1)
    stored = session.get(ArchiveOperation, uuid.UUID(operation["id"]))
    assert stored is not None
    stored.heartbeat_at = stale_time
    session.add(stored)
    session.commit()

    assert expire_stale_archive_operations(session=session) == 1

    expired = client.get(f"/api/archive/operations/{operation['id']}", headers=auth_headers_user)
    assert expired.json()["phase"] == "failed"
    assert json.loads(expired.json()["last_error_json"])["code"] == "archive_interrupted"


def test_lists_owner_archive_operations_with_active_filter(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    active = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "active.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "active",
        },
    ).json()
    completed = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "completed.zip",
            "plan_json": json.dumps({"source_paths": ["source.txt"]}),
        },
    ).json()
    client.post(
        f"/api/archive/operations/{completed['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "prepared", "next_phase": "cancelled"},
    )

    all_operations = client.get("/api/archive/operations", headers=auth_headers_user)
    active_operations = client.get("/api/archive/operations?active_only=true", headers=auth_headers_user)

    assert all_operations.status_code == 200
    assert {operation["id"] for operation in all_operations.json()} >= {active["id"], completed["id"]}
    assert active_operations.status_code == 200
    assert [operation["id"] for operation in active_operations.json()] == [active["id"]]


def test_mints_companion_session_only_for_mixed_archive_extraction(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
        },
    ).json()

    session = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user)

    assert session.status_code == 200
    assert session.json()["expires_in"] == 900
    assert session.json()["operation"]["phase"] == "accepted"
    assert isinstance(session.json()["token"], str)

    repeated = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user)
    assert repeated.status_code == 409

    local_destination = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "backup",
        },
    ).json()
    reverse_session = client.post(f"/api/archive/operations/{local_destination['id']}/companion-session", headers=auth_headers_user)
    assert reverse_session.status_code == 200
    assert reverse_session.json()["operation"]["phase"] == "accepted"

    same_provider = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
        },
    ).json()
    rejected = client.post(f"/api/archive/operations/{same_provider['id']}/companion-session", headers=auth_headers_user)
    assert rejected.status_code == 422


@pytest.mark.parametrize(
    ("kind", "source_is_local", "relay_path", "wrong_relay_path"),
    [
        (
            "extract",
            True,
            "local_zip_to_smb_extract",
            "smb_to_local_zip_create",
        ),
        (
            "extract",
            False,
            "smb_zip_to_local_extract",
            "smb_to_local_zip_create",
        ),
        (
            "create",
            False,
            "smb_to_local_zip_create",
            "local_to_smb_zip_create",
        ),
        (
            "create",
            True,
            "local_to_smb_zip_create",
            "smb_zip_to_local_extract",
        ),
    ],
)
def test_companion_relay_failure_requires_its_scoped_purpose(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
    kind: str,
    source_is_local: bool,
    relay_path: str,
    wrong_relay_path: str,
) -> None:
    source_connection_id = "local-drive:c" if source_is_local else str(test_connection.id)
    destination_connection_id = str(test_connection.id) if source_is_local else "local-drive:c"
    payload: dict[str, object] = {
        "kind": kind,
        "source_connection_id": source_connection_id,
        "source_path": "backup.zip" if kind == "extract" else "",
        "destination_connection_id": destination_connection_id,
        "destination_path": "output" if kind == "extract" else "output.zip",
    }
    if kind == "create":
        payload["plan_json"] = json.dumps({"source_paths": ["source.txt"]})
    prepared = client.post("/api/archive/operations", headers=auth_headers_user, json=payload).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}

    rejected = client.post(
        f"/api/archive/operations/{prepared['id']}/companion-relay/{wrong_relay_path}/fail",
        headers=relay_headers,
        json={"message": "relay failed"},
    )
    failed = client.post(
        f"/api/archive/operations/{prepared['id']}/companion-relay/{relay_path}/fail",
        headers=relay_headers,
        json={"message": "relay failed"},
    )

    assert rejected.status_code == 401
    assert failed.status_code == 200
    assert failed.json()["phase"] == "failed"
    assert json.loads(failed.json()["last_error_json"])["message"] == "relay failed"


def test_companion_relay_writes_scoped_members_and_completes(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None

    async def write_member(_path, stream, **_kwargs):
        bytes_written = 0
        async for chunk in stream:
            bytes_written += len(chunk)
        return bytes_written

    backend.write_file_from_stream.side_effect = write_member
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/begin",
            headers=relay_headers,
        )
        write = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/member",
            headers=relay_headers,
            params={"member_path": "nested/readme.txt"},
            content=b"hello",
        )
        duplicate = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/member",
            headers=relay_headers,
            params={"member_path": "nested/readme.txt"},
            content=b"hello",
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/complete",
            headers=relay_headers,
        )

    assert begin.status_code == 200
    assert begin.json()["phase"] == "streaming"
    assert begin.json()["revision"] == 2
    assert write.status_code == 200
    assert write.json()["revision"] == 3
    assert json.loads(write.json()["checkpoint_json"]) == {
        "extraction_outcome_checkpoint_version": EXTRACTION_OUTCOME_CHECKPOINT_VERSION,
        "member_outcomes": {
            "nested/readme.txt": {
                "status": "extracted",
                "target_path": "output/nested/readme.txt",
                "extracted_bytes": 5,
                "directories_created": 1,
                "replaced": False,
                "renamed": False,
            }
        },
        "files_extracted": 1,
        "directories_created": 2,
        "extracted_bytes": 5,
    }
    assert duplicate.status_code == 409
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    assert complete.json()["revision"] == 5
    backend.write_file_from_stream.assert_awaited_once()


def test_manifest_backed_companion_relay_requires_terminal_member_coverage(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    backend.write_file_from_stream.return_value = 5

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/begin",
            headers=relay_headers,
            json={"entries": [{"path": "readme.txt", "is_directory": False, "uncompressed_size": 5, "modified_at": None}]},
        )
        incomplete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/complete",
            headers=relay_headers,
        )
        write = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/member",
            headers=relay_headers,
            params={"member_path": "readme.txt"},
            content=b"hello",
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/complete",
            headers=relay_headers,
        )

    assert begin.status_code == 200
    assert incomplete.status_code == 409
    assert incomplete.json()["detail"] == "Archive operation has unfinished members"
    assert write.status_code == 200
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"


@pytest.mark.parametrize(
    ("source_modified_at", "target_modified_at", "expected_overwrite", "expected_skipped"),
    [
        (datetime(2025, 1, 2, tzinfo=timezone.utc), datetime(2025, 1, 1, tzinfo=timezone.utc), True, 0),
        (datetime(2025, 1, 1, tzinfo=timezone.utc), datetime(2025, 1, 2, tzinfo=timezone.utc), False, 1),
    ],
)
def test_companion_relay_replace_older_compares_source_and_smb_timestamps(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
    source_modified_at: datetime,
    target_modified_at: datetime,
    expected_overwrite: bool,
    expected_skipped: int,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    backend.get_file_info.return_value = FileInfo(
        name="readme.txt",
        path="output/readme.txt",
        type=FileType.FILE,
        modified_at=target_modified_at,
    )
    backend.write_file_from_stream.return_value = 5

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/begin",
            headers=relay_headers,
        )
        backend.write_file_from_stream.side_effect = FileExistsError
        collision = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/member",
            headers=relay_headers,
            params={"member_path": "readme.txt"},
            content=b"hello",
        )
        decision = client.post(
            f"/api/archive/operations/{prepared['id']}/decide-extraction",
            headers=auth_headers_user,
            json={"action": "replace_older"},
        )
        backend.write_file_from_stream.side_effect = None
        backend.write_file_from_stream.reset_mock()
        response = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/member",
            headers=relay_headers,
            params={
                "member_path": "readme.txt",
                "source_modified_at": source_modified_at.isoformat(),
            },
            content=b"hello",
        )

    assert collision.status_code == 200
    assert collision.json()["phase"] == "awaiting_user_decision"
    assert decision.status_code == 200
    assert decision.json()["phase"] == "streaming"
    assert response.status_code == 200
    assert json.loads(response.json()["checkpoint_json"]).get("files_skipped", 0) == expected_skipped
    if expected_overwrite:
        assert backend.write_file_from_stream.await_args.kwargs["overwrite"] is True
    else:
        backend.write_file_from_stream.assert_not_awaited()


def test_companion_relay_rejects_unsafe_member_path(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/begin",
            headers=relay_headers,
        )
        response = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/member",
            headers=relay_headers,
            params={"member_path": "../outside.txt"},
            content=b"blocked",
        )

    assert response.status_code == 422
    backend.write_file_from_stream.assert_not_awaited()


def test_companion_relay_creates_empty_directory_members(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/begin",
            headers=relay_headers,
        )
        response = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/member",
            headers=relay_headers,
            params={"member_path": "empty", "is_directory": "true"},
        )

    assert response.status_code == 200
    assert json.loads(response.json()["checkpoint_json"]) == {
        "extraction_outcome_checkpoint_version": EXTRACTION_OUTCOME_CHECKPOINT_VERSION,
        "member_outcomes": {
            "empty": {
                "status": "directory",
                "target_path": "output/empty",
                "extracted_bytes": 0,
                "directories_created": 1,
                "replaced": False,
                "renamed": False,
            }
        },
        "files_extracted": 0,
        "directories_created": 2,
        "extracted_bytes": 0,
    }
    backend.write_file_from_stream.assert_not_awaited()


def test_companion_local_relay_streams_smb_members_and_completes(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("empty/", b"")
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/begin",
            headers=relay_headers,
        )
        member = client.get(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member",
            headers=relay_headers,
            params={"member_path": "readme.txt"},
        )
        empty_complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member-complete",
            headers=relay_headers,
            json={
                "member_path": "empty",
                "status": "directory",
                "target_path": "output/empty",
                "directories_created": 1,
                "extracted_bytes": 0,
                "replaced": False,
                "renamed": False,
            },
        )
        member_complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member-complete",
            headers=relay_headers,
            json={
                "member_path": "readme.txt",
                "status": "extracted",
                "target_path": "output/readme.txt",
                "directories_created": 0,
                "extracted_bytes": 5,
                "replaced": False,
                "renamed": False,
            },
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/complete",
            headers=relay_headers,
            json={"destination_root_created": True},
        )

    assert manifest.status_code == 200
    assert manifest.json()["operation"]["phase"] == "streaming"
    assert [{key: value for key, value in entry.items() if key != "modified_at"} for entry in manifest.json()["entries"]] == [
        {"path": "empty", "is_directory": True, "uncompressed_size": 0},
        {"path": "readme.txt", "is_directory": False, "uncompressed_size": 5},
    ]
    assert all(entry["modified_at"] is not None for entry in manifest.json()["entries"])
    assert member.status_code == 200
    assert member.content == b"hello"
    assert empty_complete.status_code == 200
    assert member_complete.status_code == 200
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    checkpoint = json.loads(complete.json()["checkpoint_json"])
    assert checkpoint["extracted_bytes"] == 5
    assert checkpoint["extraction_outcome_checkpoint_version"] == EXTRACTION_OUTCOME_CHECKPOINT_VERSION
    assert set(checkpoint["member_outcomes"]) == {"empty", "readme.txt"}
    assert checkpoint["source_identity"] == {"size": len(archive_bytes), "modified_at": None}
    assert checkpoint["archive_manifest"] == manifest.json()["entries"]


def test_companion_local_relay_fails_preflight_for_a_normalized_path_collision(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("Report.txt", b"first")
        archive.writestr("report.txt", b"second")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        response = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/begin",
            headers={"Authorization": f"Bearer {capability['token']}"},
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert response.status_code == 422
    assert response.json()["detail"] == "Archive extraction source is invalid"
    assert operation.json()["phase"] == "failed"


def test_companion_local_extraction_relay_reuses_its_persisted_manifest(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        first_manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/begin",
            headers=relay_headers,
        )
        backend.get_file_info.reset_mock()
        backend.open_random_access_reader.reset_mock()
        repeated_manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/begin",
            headers=relay_headers,
        )

    assert first_manifest.status_code == 200
    assert repeated_manifest.status_code == 200
    assert repeated_manifest.json()["entries"] == first_manifest.json()["entries"]
    backend.connect.assert_awaited_once()
    backend.get_file_info.assert_not_awaited()
    backend.open_random_access_reader.assert_not_awaited()


def test_companion_local_relay_pauses_for_a_scoped_collision_and_checkpoints_a_skip(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    corpus_path = Path(__file__).resolve().parents[2] / "archive-contract" / "v1" / "extraction-outcome-scenarios-v1.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    scenario = next(scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "collision_skip_is_terminal")
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/begin",
            headers=relay_headers,
        )
        paused = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member-collision",
            headers=relay_headers,
            json={"member_path": "readme.txt", "is_directory": False, "target_size": 8},
        )
        resumed = client.post(
            f"/api/archive/operations/{prepared['id']}/decide-extraction",
            headers=auth_headers_user,
            json={"action": scenario["collision_action"], "member_path": "readme.txt"},
        )
        completed_member = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member-complete",
            headers=relay_headers,
            json={
                "member_path": "readme.txt",
                "status": "skipped",
                "target_path": "output/readme.txt",
                "directories_created": 0,
                "extracted_bytes": 0,
                "replaced": False,
                "renamed": False,
            },
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/complete",
            headers=relay_headers,
            json={"destination_root_created": False},
        )

    assert manifest.status_code == 200
    assert paused.status_code == 200
    assert paused.json()["phase"] == "awaiting_user_decision"
    assert json.loads(paused.json()["pending_decision_json"])["conflicts"] == [
        {
            "member_path": "readme.txt",
            "target_path": "output/readme.txt",
            "is_directory": False,
            "source_size": 5,
            "source_modified_at": manifest.json()["entries"][0]["modified_at"],
            "target_size": 8,
        }
    ]
    assert resumed.status_code == 200
    assert completed_member.status_code == 200
    assert complete.status_code == 200
    assert complete.json()["phase"] == scenario["terminal_phase"]
    checkpoint = json.loads(complete.json()["checkpoint_json"])
    assert checkpoint["extraction_outcome_checkpoint_version"] == EXTRACTION_OUTCOME_CHECKPOINT_VERSION
    assert checkpoint["member_outcomes"]["readme.txt"]["status"] == "skipped"
    assert checkpoint["files_skipped"] == scenario["progress"]["files_skipped"]


def test_companion_local_relay_rename_preserves_the_normalized_destination_result(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    corpus_path = Path(__file__).resolve().parents[2] / "archive-contract" / "v1" / "extraction-outcome-scenarios-v1.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    scenario = next(
        scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "rename_preserves_terminal_destination_metadata"
    )
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("root.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    target_path = f"output/{scenario['rename_target']}"
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/begin",
            headers=relay_headers,
        )
        paused = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member-collision",
            headers=relay_headers,
            json={"member_path": "root.txt", "is_directory": False, "target_size": 8},
        )
        resumed = client.post(
            f"/api/archive/operations/{prepared['id']}/decide-extraction",
            headers=auth_headers_user,
            json={"action": "rename", "member_path": "root.txt", "target_path": scenario["rename_target"]},
        )
        completion = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member-complete",
            headers=relay_headers,
            json={
                "member_path": "root.txt",
                "status": scenario["member_outcome"]["status"],
                "target_path": target_path,
                "directories_created": 0,
                "extracted_bytes": 5,
                "replaced": False,
                "renamed": scenario["member_outcome"]["renamed"],
            },
        )

    assert begin.status_code == 200
    assert paused.status_code == 200
    assert resumed.status_code == 200
    assert completion.status_code == 200
    assert scenario["terminal_phase"] == "completed"
    outcome = json.loads(completion.json()["checkpoint_json"])["member_outcomes"]["root.txt"]
    assert outcome["target_path"] == target_path
    assert outcome["renamed"] is scenario["member_outcome"]["renamed"]


@pytest.mark.parametrize(
    "scenario_name",
    ["partial_error_retry_completes_extraction", "partial_error_ignore_skips_member"],
)
def test_companion_local_relay_persists_partial_outcome_before_retry_or_ignore(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
    scenario_name: str,
) -> None:
    corpus_path = Path(__file__).resolve().parents[2] / "archive-contract" / "v1" / "extraction-outcome-scenarios-v1.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    scenario = next(scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == scenario_name)
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("source.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/begin",
            headers=relay_headers,
        )
        paused = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member-error",
            headers=relay_headers,
            json={"member_path": scenario["member_path"], "message": "Disk full", "partial_output": True},
        )
        resumed = client.post(
            f"/api/archive/operations/{prepared['id']}/decide-extraction",
            headers=auth_headers_user,
            json={"action": scenario["member_error_action"], "member_path": scenario["member_path"]},
        )
        member_complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member-complete",
            headers=relay_headers,
            json={
                "member_path": scenario["member_path"],
                "status": scenario["member_outcome"]["status"],
                "target_path": f"output/{scenario['member_path']}",
                "directories_created": 0,
                "extracted_bytes": scenario["member_outcome"]["extracted_bytes"],
                "replaced": False,
                "renamed": False,
            },
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/complete",
            headers=relay_headers,
            json={"destination_root_created": False},
        )

    assert begin.status_code == 200
    assert paused.status_code == 200
    paused_checkpoint = json.loads(paused.json()["checkpoint_json"])
    assert paused_checkpoint["member_outcomes"][scenario["member_path"]] == {
        "status": "partial",
        "target_path": f"output/{scenario['member_path']}",
        "message": "Disk full",
    }
    assert json.loads(paused.json()["pending_decision_json"])["allowed_actions"] == scenario["allowed_member_error_actions"]
    assert resumed.status_code == 200
    assert member_complete.status_code == 200
    assert complete.status_code == 200
    assert complete.json()["phase"] == scenario["terminal_phase"]
    checkpoint = json.loads(complete.json()["checkpoint_json"])
    assert checkpoint["member_outcomes"][scenario["member_path"]]["status"] == scenario["member_outcome"]["status"]
    for key, value in scenario["progress"].items():
        assert checkpoint.get(key, 0) == value


def test_companion_local_relay_cancels_before_accepting_late_member_completion(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    corpus_path = Path(__file__).resolve().parents[2] / "archive-contract" / "v1" / "extraction-outcome-scenarios-v1.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    scenario = next(
        scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "cancellation_stops_before_member_completion"
    )
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/begin",
            headers=relay_headers,
        )
        cancellation = client.post(f"/api/archive/operations/{prepared['id']}/cancel", headers=auth_headers_user)
        completion = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member-complete",
            headers=relay_headers,
            json={
                "member_path": "readme.txt",
                "status": "extracted",
                "target_path": "output/readme.txt",
                "directories_created": 0,
                "extracted_bytes": 5,
                "replaced": False,
                "renamed": False,
            },
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert begin.status_code == 200
    assert cancellation.status_code == 200
    assert cancellation.json()["cancellation_requested"] is True
    assert completion.status_code == 409
    assert completion.json()["detail"] == "Archive operation was cancelled"
    assert operation.json()["phase"] == scenario["terminal_phase"]


def test_companion_local_relay_rejects_an_archive_changed_after_manifest_preflight(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.side_effect = [
        FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes)),
        FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes) + 1),
    ]
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/begin",
            headers=relay_headers,
        )
        member = client.get(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member",
            headers=relay_headers,
            params={"member_path": "readme.txt"},
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert manifest.status_code == 200
    assert member.status_code == 409
    assert operation.json()["phase"] == "failed"


def test_companion_local_relay_rejects_a_member_outside_its_preflight_manifest(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/begin",
            headers=relay_headers,
        )
        backend.open_random_access_reader.reset_mock()
        member = client.get(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_zip_to_local_extract/member",
            headers=relay_headers,
            params={"member_path": "not-approved.txt"},
        )

    assert manifest.status_code == 200
    assert member.status_code == 422
    backend.open_random_access_reader.assert_not_awaited()


def test_companion_local_creation_relay_streams_smb_members_and_completes(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)

    async def source_chunks():
        yield b"hello"

    backend.read_file = lambda _path: source_chunks()
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/begin",
            headers=relay_headers,
        )
        member = client.get(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
        )
        member_complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/member-complete",
            headers=relay_headers,
            json={"archive_path": "readme.txt", "status": "created", "source_bytes": 5},
        )
        repeated_member_complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/member-complete",
            headers=relay_headers,
            json={"archive_path": "readme.txt", "status": "created", "source_bytes": 5},
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 5},
        )

    assert manifest.status_code == 200
    assert manifest.json()["operation"]["phase"] == "streaming"
    assert manifest.json()["entries"] == [
        {
            "source_path": "readme.txt",
            "archive_path": "readme.txt",
            "is_directory": False,
            "source_size": 5,
            "modified_at": None,
        }
    ]
    assert member.status_code == 200
    assert member.content == b"hello"
    assert member_complete.status_code == 200
    assert repeated_member_complete.status_code == 200
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    checkpoint = json.loads(complete.json()["checkpoint_json"])
    assert checkpoint["source_bytes"] == 5
    assert checkpoint["creation_member_outcomes"] == {"readme.txt": {"status": "created", "source_bytes": 5}}
    assert checkpoint["source_manifest"] == [
        {
            "source_path": "readme.txt",
            "archive_path": "readme.txt",
            "is_directory": False,
            "source_identity": {"size": 5, "modified_at": None},
        }
    ]


def test_companion_local_creation_relay_reuses_its_persisted_manifest(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        first_manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/begin",
            headers=relay_headers,
        )
        backend.get_file_info.reset_mock()
        repeated_manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/begin",
            headers=relay_headers,
        )

    assert first_manifest.status_code == 200
    assert repeated_manifest.status_code == 200
    assert repeated_manifest.json()["entries"] == first_manifest.json()["entries"]
    backend.connect.assert_awaited_once()
    backend.get_file_info.assert_not_awaited()


def test_companion_local_creation_relay_rejects_a_source_changed_after_manifest_preflight(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.side_effect = [
        FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5),
        FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=6),
    ]
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/begin",
            headers=relay_headers,
        )
        member = client.get(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert manifest.status_code == 200
    assert member.status_code == 409
    assert operation.json()["phase"] == "failed"


def test_companion_local_creation_relay_rejects_an_inconsistent_completion_summary(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/begin",
            headers=relay_headers,
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 4},
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert manifest.status_code == 200
    assert complete.status_code == 409
    assert operation.json()["phase"] == "failed"


def test_companion_local_creation_relay_requires_member_outcomes_before_completion(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/begin",
            headers=relay_headers,
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/smb_to_local_zip_create/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 5},
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert manifest.status_code == 200
    assert complete.status_code == 409
    assert operation.json()["phase"] == "failed"


def test_companion_smb_creation_relay_commits_local_members_and_completes(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/begin",
            headers=relay_headers,
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 9}]},
        )
        member = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
            content=b"zip-bytes",
        )
        checkpoint = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 9},
        )
        repeated_complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 9},
        )

    assert begin.status_code == 200
    assert member.status_code == 200
    assert member.json()["phase"] == "streaming"
    assert json.loads(checkpoint.json()["checkpoint_json"])["creation_member_outcomes"] == {
        "readme.txt": {"status": "created", "source_bytes": 9}
    }
    writer.write.assert_awaited()
    writer.close.assert_awaited_once()
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    assert repeated_complete.status_code == 200
    assert repeated_complete.json()["phase"] == "completed"
    assert json.loads(complete.json()["checkpoint_json"])["source_bytes"] == 9


def test_local_to_smb_creation_relay_commits_directories_and_replays_members_once(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["docs"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/begin",
            headers=relay_headers,
            json={
                "entries": [
                    {"archive_path": "docs", "is_directory": True, "source_size": 0},
                    {"archive_path": "docs/readme.txt", "is_directory": False, "source_size": 5},
                ]
            },
        )
        repeated_begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/begin",
            headers=relay_headers,
            json={
                "entries": [
                    {"archive_path": "docs", "is_directory": True, "source_size": 0},
                    {"archive_path": "docs/readme.txt", "is_directory": False, "source_size": 5},
                ]
            },
        )
        directory = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/member",
            headers=relay_headers,
            params={"archive_path": "docs"},
        )
        file_member = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/member",
            headers=relay_headers,
            params={"archive_path": "docs\\readme.txt"},
            content=b"hello",
        )
        write_count_before_replay = writer.write.await_count
        replay = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/member",
            headers=relay_headers,
            params={"archive_path": "docs\\readme.txt"},
            content=b"hello",
        )
        write_count_after_replay = writer.write.await_count
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 1, "source_bytes": 5},
        )

    assert begin.status_code == 200
    assert repeated_begin.status_code == 200
    backend.open_exclusive_writer.assert_awaited_once()
    assert directory.status_code == 200
    assert file_member.status_code == 200
    assert replay.status_code == 200
    assert write_count_after_replay == write_count_before_replay
    assert complete.status_code == 200
    assert json.loads(complete.json()["checkpoint_json"])["creation_member_outcomes"] == {
        "docs": {"status": "directory", "source_bytes": 0},
        "docs/readme.txt": {"status": "created", "source_bytes": 5},
    }


def test_cancelling_local_to_smb_creation_after_a_member_commit_preserves_ledger(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["first.txt", "second.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/begin",
            headers=relay_headers,
            json={
                "entries": [
                    {"archive_path": "first.txt", "is_directory": False, "source_size": 5},
                    {"archive_path": "second.txt", "is_directory": False, "source_size": 6},
                ]
            },
        )
        member = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/member",
            headers=relay_headers,
            params={"archive_path": "first.txt"},
            content=b"first",
        )
        cancelled = client.post(f"/api/archive/operations/{prepared['id']}/cancel", headers=auth_headers_user)

    assert begin.status_code == 200
    assert member.status_code == 200
    assert cancelled.status_code == 200
    assert cancelled.json()["phase"] == "cancelled"
    assert json.loads(cancelled.json()["checkpoint_json"])["creation_member_outcomes"] == {
        "first.txt": {"status": "created", "source_bytes": 5}
    }
    writer.abort_and_delete_if_owned.assert_awaited_once()
    backend.disconnect.assert_awaited_once()


def test_local_to_smb_creation_rejects_completion_before_the_manifest_is_reported(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["first.txt", "second.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/begin",
            headers=relay_headers,
            json={
                "entries": [
                    {"archive_path": "first.txt", "is_directory": False, "source_size": 5},
                    {"archive_path": "second.txt", "is_directory": False, "source_size": 6},
                ]
            },
        )
        member = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/member",
            headers=relay_headers,
            params={"archive_path": "first.txt"},
            content=b"first",
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 5},
        )

    assert begin.status_code == 200
    assert member.status_code == 200
    assert complete.status_code == 409
    writer.abort_and_delete_if_owned.assert_awaited_once()
    backend.disconnect.assert_awaited_once()


def test_cancelled_local_to_smb_creation_does_not_open_a_live_writer(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        cancelled = client.post(f"/api/archive/operations/{prepared['id']}/cancel", headers=auth_headers_user)
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/begin",
            headers=relay_headers,
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 9}]},
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert cancelled.status_code == 200
    assert begin.status_code == 409
    assert operation.json()["phase"] == "cancelled"
    backend.connect.assert_not_awaited()
    backend.open_exclusive_writer.assert_not_awaited()


def test_cancelling_local_to_smb_creation_aborts_the_live_writer(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/begin",
            headers={"Authorization": f"Bearer {capability['token']}"},
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 9}]},
        )
        cancelled = client.post(f"/api/archive/operations/{prepared['id']}/cancel", headers=auth_headers_user)

    assert begin.status_code == 200
    assert cancelled.status_code == 200
    writer.abort_and_delete_if_owned.assert_awaited_once()
    backend.disconnect.assert_awaited_once()


def test_failing_local_to_smb_creation_aborts_the_live_writer(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/begin",
            headers=relay_headers,
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 9}]},
        )
        failed = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/fail",
            headers=relay_headers,
            json={"message": "Local source became unavailable"},
        )

    assert begin.status_code == 200
    assert failed.status_code == 200
    assert failed.json()["phase"] == "failed"
    writer.abort_and_delete_if_owned.assert_awaited_once()
    backend.disconnect.assert_awaited_once()


def test_local_to_smb_creation_rejects_changed_member_size(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/begin",
            headers=relay_headers,
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 10}]},
        )
        member = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
            content=b"zip-bytes",
        )

    assert begin.status_code == 200
    assert member.status_code == 409
    assert member.json()["detail"] == "Archive creation source changed after manifest validation"
    writer.abort_and_delete_if_owned.assert_awaited_once()


def test_local_to_smb_creation_rejects_members_after_live_writer_interruption(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    execution = AsyncMock()
    execution.is_active = lambda: False

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch("app.api.archive_operations._local_to_smb_creation_writers.execution", return_value=execution),
    ):
        begin = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/begin",
            headers=relay_headers,
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 5}]},
        )
        member = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_to_smb_zip_create/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
            content=b"hello",
        )

    assert begin.status_code == 200
    assert member.status_code == 409
    assert member.json()["detail"] == "Archive creation session was interrupted"
    execution.write_member.assert_not_awaited()


def test_companion_relay_pauses_for_destination_collision(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    backend.write_file_from_stream.side_effect = FileExistsError()
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        client.post(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/begin",
            headers=relay_headers,
        )
        response = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-relay/local_zip_to_smb_extract/member",
            headers=relay_headers,
            params={"member_path": "existing.txt"},
            content=b"blocked",
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "awaiting_user_decision"
    assert json.loads(response.json()["pending_decision_json"])["conflicts"] == [
        {"member_path": "existing.txt", "target_path": "output/existing.txt", "is_directory": False}
    ]
    assert operation.json()["phase"] == "awaiting_user_decision"


def test_executes_same_connection_creation_from_immutable_plan(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup.zip",
            "plan_json": json.dumps({"source_paths": ["first.txt", "second.txt"]}),
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None

    async def create_archive_with_member_outcomes(*_args, on_member_completed, **_kwargs):
        await on_member_completed(ArchiveCreationMemberOutcome("first.txt", "created", 5))
        await on_member_completed(ArchiveCreationMemberOutcome("second.txt", "created", 6))
        return ArchiveCreationResult(2, 11)

    preflight_entries = [
        ArchiveCreationEntry("first.txt", "first.txt", FileInfo(name="first.txt", path="first.txt", type=FileType.FILE, size=5)),
        ArchiveCreationEntry("second.txt", "second.txt", FileInfo(name="second.txt", path="second.txt", type=FileType.FILE, size=6)),
    ]
    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch("app.api.archive_operations.build_archive_creation_manifest", new=AsyncMock(return_value=preflight_entries)),
        patch(
            "app.api.archive_operations.create_archive_from_files", new=AsyncMock(side_effect=create_archive_with_member_outcomes)
        ) as create_archive,
    ):
        response = client.post(f"/api/archive/operations/{prepared['id']}/execute-create", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "completed"
    assert json.loads(response.json()["checkpoint_json"]) == {
        "creation_outcome_checkpoint_version": CREATION_OUTCOME_CHECKPOINT_VERSION,
        "creation_member_outcomes": {
            "first.txt": {"status": "created", "source_bytes": 5},
            "second.txt": {"status": "created", "source_bytes": 6},
        },
        "files_created": 2,
        "directories_created": 0,
        "source_bytes": 11,
        "source_manifest": [
            {
                "source_path": "first.txt",
                "archive_path": "first.txt",
                "is_directory": False,
                "source_identity": {"size": 5, "modified_at": None},
            },
            {
                "source_path": "second.txt",
                "archive_path": "second.txt",
                "is_directory": False,
                "source_identity": {"size": 6, "modified_at": None},
            },
        ],
    }
    create_archive.assert_awaited_once_with(
        backend,
        destination=backend,
        source_paths=["first.txt", "second.txt"],
        target_path="backup.zip",
        is_cancelled=ANY,
        on_member_completed=ANY,
        preflight_entries=preflight_entries,
    )


def test_executes_same_connection_extraction(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    configure_direct_extraction_archive(backend, {"first.txt": b"12345", "second.txt": b"67890"})

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(
                side_effect=completed_extraction_runner(
                    ArchiveExtractionResult(2, 2, 10),
                    [
                        ArchiveExtractionDestinationResult(
                            "first.txt", "extracted", "output/first.txt", extracted_bytes=5, directories_created=2
                        ),
                        ArchiveExtractionDestinationResult("second.txt", "extracted", "output/second.txt", extracted_bytes=5),
                    ],
                )
            ),
        ) as extract_archive,
    ):
        response = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "completed"
    checkpoint = json.loads(response.json()["checkpoint_json"])
    assert checkpoint["files_extracted"] == 2
    assert checkpoint["directories_created"] == 2
    assert checkpoint["extracted_bytes"] == 10
    assert checkpoint["member_outcomes"] == {
        "first.txt": {
            "status": "extracted",
            "target_path": "output/first.txt",
            "extracted_bytes": 5,
            "directories_created": 2,
            "replaced": False,
            "renamed": False,
        },
        "second.txt": {
            "status": "extracted",
            "target_path": "output/second.txt",
            "extracted_bytes": 5,
            "directories_created": 0,
            "replaced": False,
            "renamed": False,
        },
    }
    extract_archive.assert_awaited_once_with(
        backend,
        destination=backend,
        archive_path="input.zip",
        destination_root="output",
        existing_file_policy=None,
        member_collision_actions={},
        member_rename_targets={},
        ignored_members=[],
        completed_members=[],
        on_member_completed=ANY,
        is_cancelled=ANY,
    )


def test_extraction_conflicts_become_pending_user_decisions(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    configure_direct_extraction_archive(backend, {"root.txt": b"contents"})

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(side_effect=ArchiveExtractionConflicts([ArchiveExtractionConflict("root.txt", "output/root.txt")])),
        ),
    ):
        response = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "awaiting_user_decision"
    assert json.loads(response.json()["pending_decision_json"])["conflicts"] == [
        {"member_path": "root.txt", "target_path": "output/root.txt", "is_directory": False}
    ]

    decision = client.post(
        f"/api/archive/operations/{prepared['id']}/decide-extraction",
        headers=auth_headers_user,
        json={"action": "skip_all"},
    )
    assert decision.status_code == 200
    assert decision.json()["phase"] == "streaming"
    assert decision.json()["collision_policy"] == "skip_all"


def test_directory_extraction_conflicts_allow_only_rename_or_cancel(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    configure_direct_extraction_archive(backend, {"docs/readme.txt": b"contents"})
    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(side_effect=ArchiveExtractionConflicts([ArchiveExtractionConflict("docs", "output/docs", True)])),
        ),
    ):
        response = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert response.status_code == 200
    assert json.loads(response.json()["pending_decision_json"])["allowed_actions"] == ["rename"]

    rejected = client.post(
        f"/api/archive/operations/{prepared['id']}/decide-extraction",
        headers=auth_headers_user,
        json={"action": "skip", "member_path": "docs"},
    )
    assert rejected.status_code == 422


def test_individual_extraction_decision_is_limited_to_pending_member(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    configure_direct_extraction_archive(backend, {"root.txt": b"contents"})
    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(side_effect=ArchiveExtractionConflicts([ArchiveExtractionConflict("root.txt", "output/root.txt")])),
        ),
    ):
        client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    response = client.post(
        f"/api/archive/operations/{prepared['id']}/decide-extraction",
        headers=auth_headers_user,
        json={"action": "skip", "member_path": "root.txt"},
    )

    assert response.status_code == 200
    assert response.json()["phase"] == "streaming"
    assert response.json()["collision_policy"] is None
    assert json.loads(response.json()["checkpoint_json"])["member_collision_actions"] == {"root.txt": "skip"}

    with patch(
        "app.api.archive_operations.extract_archive_to_new_paths",
        new=AsyncMock(
            side_effect=completed_extraction_runner(
                ArchiveExtractionResult(1, 1, 6, files_skipped=1, skipped_members=("root.txt",)),
                [ArchiveExtractionDestinationResult("root.txt", "skipped", "output/root.txt")],
            )
        ),
    ) as extract_archive:
        resumed = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert resumed.status_code == 200
    assert resumed.json()["phase"] == "completed"
    assert json.loads(resumed.json()["checkpoint_json"])["skipped_members"] == ["root.txt"]
    assert extract_archive.await_args.kwargs["member_collision_actions"] == {"root.txt": "skip"}


def test_individual_rename_decision_persists_a_safe_member_remap(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("root.txt", b"contents")
    archive_bytes = archive_buffer.getvalue()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(
        name="input.zip",
        path="input.zip",
        type=FileType.FILE,
        size=len(archive_bytes),
    )
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(side_effect=ArchiveExtractionConflicts([ArchiveExtractionConflict("root.txt", "output/root.txt")])),
        ),
    ):
        client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        response = client.post(
            f"/api/archive/operations/{prepared['id']}/decide-extraction",
            headers=auth_headers_user,
            json={"action": "rename", "member_path": "root.txt", "target_path": "renamed/root-copy.txt"},
        )

    assert response.status_code == 200
    assert json.loads(response.json()["checkpoint_json"])["member_rename_targets"] == {"root.txt": "renamed/root-copy.txt"}

    with patch(
        "app.api.archive_operations.extract_archive_to_new_paths",
        new=AsyncMock(
            side_effect=completed_extraction_runner(
                ArchiveExtractionResult(1, 1, 4, renamed_members=("root.txt",)),
                [
                    ArchiveExtractionDestinationResult(
                        "root.txt", "extracted", "output/renamed/root-copy.txt", extracted_bytes=4, renamed=True
                    )
                ],
            )
        ),
    ) as extract_archive:
        resumed = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert resumed.status_code == 200
    assert json.loads(resumed.json()["checkpoint_json"])["renamed_members"] == ["root.txt"]
    assert extract_archive.await_args.kwargs["member_rename_targets"] == {"root.txt": "renamed/root-copy.txt"}


def test_member_write_failure_pauses_for_retry_or_ignore(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    corpus_path = Path(__file__).resolve().parents[2] / "archive-contract" / "v1" / "extraction-outcome-scenarios-v1.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    retry_scenario = next(
        scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "partial_error_retry_completes_extraction"
    )
    ignore_scenario = next(
        scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "partial_error_ignore_skips_member"
    )
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    configure_direct_extraction_archive(backend, {"root.txt": b"contents"})
    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(side_effect=ArchiveExtractionMemberError("root.txt", "output/root.txt", "Disk full")),
        ),
    ):
        response = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "awaiting_user_decision"
    assert json.loads(response.json()["pending_decision_json"])["allowed_actions"] == retry_scenario["allowed_member_error_actions"]
    checkpoint = json.loads(response.json()["checkpoint_json"])
    assert checkpoint["extraction_outcome_checkpoint_version"] == EXTRACTION_OUTCOME_CHECKPOINT_VERSION
    assert checkpoint["member_outcomes"] == {"root.txt": {"status": "partial", "target_path": "output/root.txt", "message": "Disk full"}}

    retry = client.post(
        f"/api/archive/operations/{prepared['id']}/decide-extraction",
        headers=auth_headers_user,
        json={"action": retry_scenario["member_error_action"], "member_path": "root.txt"},
    )
    assert retry.status_code == 200
    assert json.loads(retry.json()["checkpoint_json"])["retry_members"] == ["root.txt"]

    with patch(
        "app.api.archive_operations.extract_archive_to_new_paths",
        new=AsyncMock(side_effect=ArchiveExtractionMemberError("root.txt", "output/root.txt", "Disk full")),
    ):
        response = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "awaiting_user_decision"

    decision = client.post(
        f"/api/archive/operations/{prepared['id']}/decide-extraction",
        headers=auth_headers_user,
        json={"action": ignore_scenario["member_error_action"], "member_path": "root.txt"},
    )
    assert decision.status_code == 200
    assert decision.json()["phase"] == "streaming"
    assert json.loads(decision.json()["checkpoint_json"])["ignored_members"] == ["root.txt"]

    with patch(
        "app.api.archive_operations.extract_archive_to_new_paths",
        new=AsyncMock(
            side_effect=completed_extraction_runner(
                ArchiveExtractionResult(1, 1, 4, files_skipped=1, skipped_members=("root.txt",)),
                [ArchiveExtractionDestinationResult("root.txt", "ignored", "output/root.txt")],
            )
        ),
    ) as extract_archive:
        resumed = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert resumed.status_code == 200
    assert resumed.json()["phase"] == "completed"
    assert ignore_scenario["terminal_phase"] == "completed"
    assert ignore_scenario["progress"]["files_skipped"] == 1
    assert extract_archive.await_args.kwargs["ignored_members"] == ["root.txt"]


def test_rejects_malformed_persisted_extraction_decision(
    client: TestClient,
    session,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    operation = session.get(ArchiveOperation, uuid.UUID(prepared["id"]))
    assert operation is not None
    operation.phase = ArchiveOperationPhase.AWAITING_USER_DECISION
    operation.pending_decision_json = "[]"
    session.add(operation)
    session.commit()

    response = client.post(
        f"/api/archive/operations/{prepared['id']}/decide-extraction",
        headers=auth_headers_user,
        json={"action": "skip_all"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Archive operation decision state is invalid"
