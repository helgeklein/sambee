from app.services.archive.operations import fail_operation

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
from app.core.security import create_access_token, decode_access_token
from app.models.archive import ArchiveDirectoryListing, ArchiveIdentity
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
    ArchiveCreationCoordinator,
    ArchiveCreationExecutionPlan,
    ArchiveCreationManifest,
    ArchiveCreationManifestMember,
    ArchiveCreationState,
    ArchiveExtractionCoordinator,
    ArchiveExtractionManifest,
    ArchiveExtractionManifestMember,
    DurableArchiveExecutionStateStore,
    advance_relay_transfer,
    begin_relay_execution,
    commit_creation_member_outcome,
    complete_checked_relay_execution,
    complete_relay_execution,
    completed_extraction_member_paths,
    creation_outcome_summary,
    existing_files_decision,
    extraction_outcome_summary,
    load_archive_checkpoint,
    member_error_decision,
    persist_extraction_member_outcome,
    record_extraction_member_outcome,
    start_archive_execution,
)
from app.services.archive.creation import ArchiveCreationEntry, ArchiveCreationMemberOutcome, ArchiveCreationResult
from app.services.archive.execution import (
    ArchiveCompanionRelayPurpose,
    ArchiveExecutionDriver,
    resolve_archive_execution_topology,
    resolve_archive_operation_topology_plan,
)
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
from app.services.archive.v2_checkpoint import new_v2_extraction_checkpoint


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


def new_v2_test_extraction_checkpoint(manifest: ArchiveExtractionManifest) -> dict[str, object]:
    """Build a strict V2 checkpoint for coordinator-focused tests."""

    return new_v2_extraction_checkpoint(
        manifest=manifest.checkpoint_entries(),
        source_snapshot={"size": 0, "modified_at": None},
    )


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
        checkpoint_json=json.dumps({"version": 2}),
    )

    with pytest.raises(HTTPException, match="Archive operation checkpoint is invalid") as exc_info:
        creation_outcome_summary(load_archive_checkpoint(operation))
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT


def test_creation_state_rejects_duplicate_members_and_bounds_member_lookup() -> None:
    manifest = ArchiveCreationManifest.from_members([ArchiveCreationManifestMember("docs/readme.txt", False, 7, None, None)])
    state = ArchiveCreationState.from_checkpoint(manifest.empty_checkpoint())

    assert state.member("docs/readme.txt").source_size == 7
    with pytest.raises(HTTPException, match="invalid or unavailable") as exc_info:
        state.member("missing.txt")
    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    with pytest.raises(HTTPException, match="checkpoint is invalid") as exc_info:
        ArchiveCreationState.from_checkpoint({**manifest.empty_checkpoint(), "manifest": manifest.empty_checkpoint()["manifest"] * 2})
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    with pytest.raises(HTTPException, match="checkpoint is invalid") as exc_info:
        ArchiveCreationState.from_checkpoint(
            {
                **manifest.empty_checkpoint(),
                "manifest": [
                    {"archive_path": "folder", "is_directory": False, "source_size": 1, "source_path": None, "modified_at": None},
                    {"archive_path": "folder/child.txt", "is_directory": False, "source_size": 1, "source_path": None, "modified_at": None},
                ],
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
            checkpoint_json=json.dumps(new_v2_test_extraction_checkpoint(manifest)),
        )

    completion_state = ArchiveExtractionCoordinator(streaming_operation(), state_store)
    with pytest.raises(HTTPException, match="target path is invalid") as exc_info:
        completion_state.record_member_completed(
            ArchiveExtractionMemberOutcome("readme.txt", "extracted", "outside.txt", extracted_bytes=5)
        )
    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    completed = completion_state.record_member_completed(
        ArchiveExtractionMemberOutcome("readme.txt", "extracted", "output/readme.txt", extracted_bytes=5)
    )
    assert json.loads(completed.checkpoint_json)["member_outcomes"]["readme.txt"]["status"] == "extracted"

    collision_state = ArchiveExtractionCoordinator(streaming_operation(), state_store)
    paused_for_collision = collision_state.pause_for_collision(
        member_path="readme.txt",
        is_directory=False,
        target_size=7,
        target_modified_at=None,
    )
    collision_decision = json.loads(paused_for_collision.pending_decision_json)
    assert collision_decision["kind"] == "existing_files"
    assert collision_decision["conflicts"][0]["target_path"] == "output/readme.txt"

    error_state = ArchiveExtractionCoordinator(streaming_operation(), state_store)
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

    assert json.loads(committed.checkpoint_json)["member_outcomes"] == {"docs/readme.txt": {"status": "created", "source_bytes": 7}}


def test_creation_manifest_centralizes_relay_normalization_and_validation() -> None:
    manifest = ArchiveCreationManifest.from_members([ArchiveCreationManifestMember("docs\\readme.txt", False, 7, None, None)])

    assert manifest.members[0].archive_path == "docs/readme.txt"
    assert manifest.empty_checkpoint()["manifest"] == [
        {
            "source_path": None,
            "archive_path": "docs/readme.txt",
            "is_directory": False,
            "source_size": 7,
            "modified_at": None,
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

    checkpoint = ArchiveCreationManifest.from_members(
        [
            ArchiveCreationManifestMember("docs", True, 0, None, None),
            ArchiveCreationManifestMember("docs/readme.txt", False, 7, None, None),
        ]
    ).empty_checkpoint()
    record_creation_member_outcome(checkpoint, ArchiveCreationMemberOutcome("docs", "directory"))
    record_creation_member_outcome(checkpoint, ArchiveCreationMemberOutcome("docs/readme.txt", "created", 7))
    record_creation_member_outcome(checkpoint, ArchiveCreationMemberOutcome("docs/readme.txt", "created", 7))

    assert checkpoint["member_outcomes"] == {
        "docs": {"status": "directory", "source_bytes": 0},
        "docs/readme.txt": {"status": "created", "source_bytes": 7},
    }
    with pytest.raises(HTTPException, match="outcome conflicts") as exc_info:
        record_creation_member_outcome(checkpoint, ArchiveCreationMemberOutcome("docs/readme.txt", "created", 8))
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT


def test_creation_outcome_summary_requires_complete_manifest_ledger() -> None:
    checkpoint = ArchiveCreationManifest.from_members(
        [
            ArchiveCreationManifestMember("docs", True, 0, None, None),
            ArchiveCreationManifestMember("docs/readme.txt", False, 7, None, None),
        ]
    ).empty_checkpoint()
    checkpoint["member_outcomes"] = {
        "docs": {"status": "directory", "source_bytes": 0},
        "docs/readme.txt": {"status": "created", "source_bytes": 7},
    }

    assert creation_outcome_summary(checkpoint).to_checkpoint() == {
        "files_created": 1,
        "directories_created": 1,
        "source_bytes": 7,
    }
    checkpoint["member_outcomes"] = {"docs": {"status": "directory", "source_bytes": 0}}
    with pytest.raises(HTTPException, match="outcomes did not match"):
        creation_outcome_summary(checkpoint)


@pytest.mark.parametrize("checkpoint_json", [None, "invalid-json", "[]", "{}", json.dumps({"version": 1})])
def test_common_archive_checkpoint_loader_rejects_invalid_state(checkpoint_json: str | None) -> None:
    operation = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.EXTRACT,
        checkpoint_json=checkpoint_json,
    )

    with pytest.raises(HTTPException, match="Archive operation checkpoint is") as exc_info:
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
        execution_plan=ArchiveCreationExecutionPlan(
            ArchiveCreationManifest.from_members(
                [
                    ArchiveCreationManifestMember("docs", True, 0, "docs", None),
                    ArchiveCreationManifestMember("docs/readme.txt", False, 11, "docs/readme.txt", None),
                ]
            )
        ),
    )

    assert completed.phase == ArchiveOperationPhase.COMPLETED
    assert json.loads(completed.checkpoint_json) == {
        "version": 2,
        "manifest": [
            {
                "source_path": "docs",
                "archive_path": "docs",
                "is_directory": True,
                "source_size": 0,
                "modified_at": None,
            },
            {
                "source_path": "docs/readme.txt",
                "archive_path": "docs/readme.txt",
                "is_directory": False,
                "source_size": 11,
                "modified_at": None,
            },
        ],
        "member_outcomes": {
            "docs": {"status": "directory", "source_bytes": 0},
            "docs/readme.txt": {"status": "created", "source_bytes": 11},
        },
        "decisions": {},
        "pending_decision": None,
        "delivery_ids": {},
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
        await ArchiveCreationCoordinator(operation=operation, state_store=state_store).run(
            run_creation,
            execution_plan=ArchiveCreationExecutionPlan(manifest),
        )

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
    checkpoint = new_v2_test_extraction_checkpoint(ArchiveExtractionManifest.from_members([]))
    started = begin_relay_execution(state_store, operation, checkpoint_json=json.dumps(checkpoint))

    assert started.phase == ArchiveOperationPhase.STREAMING
    assert started.revision == 1
    assert json.loads(started.checkpoint_json) == checkpoint

    completed = complete_relay_execution(state_store, started, checkpoint_json=json.dumps(checkpoint))

    assert completed.phase == ArchiveOperationPhase.COMPLETED
    assert completed.revision == 4
    assert json.loads(completed.checkpoint_json) == checkpoint
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
        checkpoint_json=json.dumps(new_v2_test_extraction_checkpoint(ArchiveExtractionManifest.from_members([]))),
    )
    session.add(operation)
    session.commit()
    session.refresh(operation)

    assert advance_relay_transfer(DurableArchiveExecutionStateStore(session), operation) is False
    assert operation.phase == ArchiveOperationPhase.CANCELLED
    assert operation.revision == 1


def test_extraction_outcome_recorder_accumulates_member_outcomes() -> None:
    checkpoint = new_v2_test_extraction_checkpoint(
        ArchiveExtractionManifest.from_members(
            [
                ArchiveExtractionManifestMember("readme.txt", False, 5, None),
                ArchiveExtractionManifestMember("skipped.txt", False, 0, None),
            ]
        )
    )

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

    assert checkpoint["member_outcomes"] == {
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
    }


def test_extraction_outcome_recorder_ignores_exact_duplicates_and_finalizes_partials() -> None:
    checkpoint = new_v2_test_extraction_checkpoint(
        ArchiveExtractionManifest.from_members([ArchiveExtractionManifestMember("retry.txt", False, 5, None)])
    )
    checkpoint["member_outcomes"] = {"retry.txt": {"status": "partial", "target_path": "output/retry.txt", "message": "connection closed"}}
    outcome = ArchiveExtractionMemberOutcome("retry.txt", "extracted", "output/retry.txt", extracted_bytes=5)

    record_extraction_member_outcome(checkpoint, outcome, preserve_absent_zero=True)
    record_extraction_member_outcome(checkpoint, outcome, preserve_absent_zero=True)

    assert checkpoint["member_outcomes"] == {
        "retry.txt": {
            "status": "extracted",
            "target_path": "output/retry.txt",
            "extracted_bytes": 5,
            "directories_created": 0,
            "replaced": False,
            "renamed": False,
        }
    }


def test_persists_extraction_outcome_through_injected_state_store() -> None:
    manifest = ArchiveExtractionManifest.from_members([ArchiveExtractionManifestMember("readme.txt", False, 5, None)])
    operation = ArchiveOperation(
        user_id=uuid.uuid4(), kind=ArchiveOperationKind.EXTRACT, checkpoint_json=json.dumps(new_v2_test_extraction_checkpoint(manifest))
    )

    persisted = persist_extraction_member_outcome(
        MemoryArchiveExecutionStateStore(),
        operation,
        ArchiveExtractionMemberOutcome("readme.txt", "extracted", "output/readme.txt", extracted_bytes=5),
    )

    assert persisted is operation
    checkpoint = json.loads(operation.checkpoint_json)
    assert checkpoint["member_outcomes"] == {
        "readme.txt": {
            "status": "extracted",
            "target_path": "output/readme.txt",
            "extracted_bytes": 5,
            "directories_created": 0,
            "replaced": False,
            "renamed": False,
        }
    }


def test_completed_extraction_member_paths_prefers_outcomes_and_excludes_partial_output() -> None:
    checkpoint = new_v2_test_extraction_checkpoint(
        ArchiveExtractionManifest.from_members(
            [
                ArchiveExtractionManifestMember("complete.txt", False, 0, None),
                ArchiveExtractionManifestMember("partial.txt", False, 0, None),
            ]
        )
    )
    checkpoint["member_outcomes"] = {
        "complete.txt": {
            "status": "extracted",
            "target_path": "output/complete.txt",
            "extracted_bytes": 0,
            "directories_created": 0,
            "replaced": False,
            "renamed": False,
        },
        "partial.txt": {"status": "partial", "target_path": "output/partial.txt", "message": "interrupted"},
    }

    assert completed_extraction_member_paths(checkpoint) == ["complete.txt"]


def test_completed_extraction_member_paths_rejects_non_v2_checkpoints() -> None:
    with pytest.raises(HTTPException, match="checkpoint is invalid"):
        completed_extraction_member_paths({"version": 1})


def test_versioned_extraction_checkpoint_requires_an_outcome_ledger() -> None:
    checkpoint = {"version": 2}

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


def test_operation_topology_plan_is_immutable_resolved_execution_selection() -> None:
    plan = resolve_archive_operation_topology_plan(
        kind=ArchiveOperationKind.EXTRACT,
        source_connection_id="connection-1",
        destination_connection_id="local-drive:c",
    )

    assert plan.kind == ArchiveOperationKind.EXTRACT
    assert plan.topology.driver == ArchiveExecutionDriver.COMPANION
    assert plan.topology.companion_purpose == ArchiveCompanionRelayPurpose.SMB_ZIP_TO_LOCAL_EXTRACT


def test_v2_relay_binding_fixture_matches_backend_topology_resolution() -> None:
    fixture = json.loads((Path(__file__).parents[2] / "archive-contract/v2/fixtures/relay-bindings-v2.json").read_text(encoding="utf-8"))

    assert fixture["version"] == 2
    fixture_bindings = {(binding["purpose"], binding["kind"], binding["source"], binding["destination"]) for binding in fixture["bindings"]}
    assert len(fixture_bindings) == len(fixture["bindings"])
    assert {binding[0] for binding in fixture_bindings} == {purpose.value for purpose in ArchiveCompanionRelayPurpose}

    resolver_bindings = set()
    for kind in ArchiveOperationKind:
        for source_is_local, destination_is_local in ((True, False), (False, True)):
            topology = resolve_archive_execution_topology(
                kind=kind,
                source_connection_id="local-drive:c" if source_is_local else "connection-1",
                destination_connection_id="local-drive:d" if destination_is_local else "connection-2",
            )
            assert topology.companion_purpose is not None
            resolver_bindings.add(
                (
                    topology.companion_purpose.value,
                    kind.value,
                    "local" if source_is_local else "smb",
                    "local" if destination_is_local else "smb",
                )
            )
    assert resolver_bindings == fixture_bindings

    for kind in ArchiveOperationKind:
        for connection_id in ("local-drive:c", "connection-1"):
            assert (
                resolve_archive_execution_topology(
                    kind=kind,
                    source_connection_id=connection_id,
                    destination_connection_id=connection_id,
                ).companion_purpose
                is None
            )


def test_prepare_archive_operation_rejects_unsupported_topology_before_persistence(
    client: TestClient,
    auth_headers_user: dict,
    multiple_connections: list[Connection],
    session,
) -> None:
    source, destination = multiple_connections[:2]

    response = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(source.id),
            "source_path": "backup.zip",
            "destination_connection_id": str(destination.id),
            "destination_path": "backup",
        },
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert response.json()["message"] == "Archive execution across distinct same-provider connections is unavailable"
    assert session.exec(select(ArchiveOperation)).all() == []


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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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

    read_response = client.get(f"/api/archive/v2/operations/{operation['id']}", headers=auth_headers_user)
    assert read_response.status_code == 200
    assert read_response.json()["manifest_hash"] == "sha256:fixture"

    transition = client.post(
        f"/api/archive/v2/operations/{operation['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "prepared", "next_phase": "accepted"},
    )
    repeated_transition = client.post(
        f"/api/archive/v2/operations/{operation['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "prepared", "next_phase": "accepted"},
    )
    assert transition.status_code == 200
    assert transition.json()["revision"] == 1
    assert repeated_transition.status_code == 200
    assert repeated_transition.json()["phase"] == "accepted"
    assert repeated_transition.json()["revision"] == 1

    first_cancel = client.post(f"/api/archive/v2/operations/{operation['id']}/cancel", headers=auth_headers_user)
    second_cancel = client.post(f"/api/archive/v2/operations/{operation['id']}/cancel", headers=auth_headers_user)
    assert first_cancel.status_code == 200
    assert first_cancel.json()["revision"] == 2
    assert second_cancel.status_code == 200
    assert second_cancel.json()["cancellation_requested"] is True
    assert second_cancel.json()["revision"] == 2

    stale_transition = client.post(
        f"/api/archive/v2/operations/{operation['id']}/phase",
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


def test_v2_phase_route_rejects_execution_without_an_initialized_checkpoint(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    operation = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
        },
    ).json()
    accepted = client.post(
        f"/api/archive/v2/operations/{operation['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "prepared", "next_phase": "accepted"},
    )
    assert accepted.status_code == status.HTTP_200_OK

    streaming = client.post(
        f"/api/archive/v2/operations/{operation['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "accepted", "next_phase": "streaming", "expected_revision": accepted.json()["revision"]},
    )

    assert streaming.status_code == status.HTTP_409_CONFLICT
    assert streaming.json() == {"code": "invalid_checkpoint", "message": "Archive operation checkpoint is invalid"}


def test_failing_execution_rejects_an_uninitialized_v2_checkpoint(session, regular_user) -> None:
    operation = ArchiveOperation(
        user_id=regular_user.id,
        kind=ArchiveOperationKind.EXTRACT,
        phase=ArchiveOperationPhase.STREAMING,
        checkpoint_json=None,
    )
    session.add(operation)
    session.commit()

    with pytest.raises(HTTPException, match="Archive operation checkpoint is invalid") as exc_info:
        fail_operation(session, operation, "relay failed")

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    session.refresh(operation)
    assert operation.phase == ArchiveOperationPhase.STREAMING
    assert operation.revision == 0


def test_v2_operation_routes_pin_contract_version_and_reject_legacy_input(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
    session,
) -> None:
    payload = {
        "contract_version": "v2",
        "kind": "extract",
        "source_connection_id": str(test_connection.id),
        "source_path": "backup.zip",
        "destination_connection_id": str(test_connection.id),
        "destination_path": "backup",
    }

    created = client.post("/api/archive/v2/operations", headers=auth_headers_user, json=payload)
    assert created.status_code == status.HTTP_201_CREATED
    operation = created.json()
    assert operation["contract_version"] == "v2"

    read = client.get(f"/api/archive/v2/operations/{operation['id']}", headers=auth_headers_user)
    assert read.status_code == status.HTTP_200_OK
    assert read.json()["contract_version"] == "v2"

    legacy_payload = {**payload, "contract_version": "v1"}
    rejected = client.post("/api/archive/v2/operations", headers=auth_headers_user, json=legacy_payload)
    assert rejected.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert rejected.json() == {
        "code": "invalid_request",
        "message": "Archive V2 request validation failed",
    }

    operation_count_before_missing_version = len(session.exec(select(ArchiveOperation)).all())
    missing_version = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={key: value for key, value in payload.items() if key != "contract_version"},
    )
    assert missing_version.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert missing_version.json() == {
        "code": "invalid_request",
        "message": "Archive V2 request validation failed",
    }
    assert len(session.exec(select(ArchiveOperation)).all()) == operation_count_before_missing_version

    unknown_field = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={**payload, "unexpected": True},
    )
    assert unknown_field.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert unknown_field.json() == {
        "code": "invalid_request",
        "message": "Archive V2 request validation failed",
    }

    unknown_query = client.get(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        params={"unexpected": "true"},
    )
    assert unknown_query.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert unknown_query.json() == {
        "code": "invalid_request",
        "message": "Archive V2 query parameters are invalid",
    }


def test_v2_inspection_is_request_scoped_and_rejects_legacy_contract(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    with patch(
        "app.api.archive_operations.list_archive_directory",
        new=AsyncMock(
            return_value=ArchiveDirectoryListing(
                archive=ArchiveIdentity(path="input.zip", size=1), path="", items=[], total=0, page_size=100
            )
        ),
    ) as list_inspection:
        response = client.get(
            "/api/archive/v2/inspection/directory",
            headers=auth_headers_user,
            params={"connection_id": str(test_connection.id), "archive_path": "input.zip", "contract_version": "v2"},
        )
        rejected = client.get(
            "/api/archive/v2/inspection/directory",
            headers=auth_headers_user,
            params={"connection_id": str(test_connection.id), "archive_path": "input.zip", "contract_version": "v1"},
        )

    assert response.status_code == status.HTTP_200_OK
    assert rejected.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    list_inspection.assert_awaited_once()


def test_expires_a_stale_archive_operation_as_interrupted(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
    session,
) -> None:
    operation = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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

    expired = client.get(f"/api/archive/v2/operations/{operation['id']}", headers=auth_headers_user)
    assert expired.json()["phase"] == "failed"
    assert json.loads(expired.json()["last_error_json"])["code"] == "archive_interrupted"


def test_lists_owner_archive_operations_with_active_filter(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    active = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "active.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "active",
        },
    ).json()
    completed = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "completed.zip",
            "plan_json": json.dumps({"source_paths": ["source.txt"]}),
        },
    ).json()
    client.post(
        f"/api/archive/v2/operations/{completed['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "prepared", "next_phase": "cancelled"},
    )

    all_operations = client.get("/api/archive/v2/operations", headers=auth_headers_user)
    active_operations = client.get("/api/archive/v2/operations?active_only=true", headers=auth_headers_user)

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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
        },
    ).json()

    session = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user)

    assert session.status_code == 200
    assert session.json()["expires_in"] == 900
    assert session.json()["operation"]["phase"] == "accepted"
    assert isinstance(session.json()["token"], str)

    repeated = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user)
    assert repeated.status_code == 409

    local_destination = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "backup",
        },
    ).json()
    reverse_session = client.post(f"/api/archive/v2/operations/{local_destination['id']}/companion-session", headers=auth_headers_user)
    assert reverse_session.status_code == 200
    assert reverse_session.json()["operation"]["phase"] == "accepted"

    same_provider = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
        },
    ).json()
    rejected = client.post(f"/api/archive/v2/operations/{same_provider['id']}/companion-session", headers=auth_headers_user)
    assert rejected.status_code == 422


def test_v2_relay_capability_rejects_version_confusion_and_signature_tampering(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "backup",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    confused_claims = decode_access_token(capability["token"])
    confused_claims["contract_version"] = "v1"
    version_confused_token = create_access_token(confused_claims)
    signature_tampered_token = f"{capability['token']}x"

    for token, expected_status in (
        (version_confused_token, status.HTTP_403_FORBIDDEN),
        (signature_tampered_token, status.HTTP_401_UNAUTHORIZED),
    ):
        response = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == expected_status
        assert response.json()["code"] == "capability_invalid"

    operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)
    assert operation.json()["phase"] == "accepted"


@pytest.mark.parametrize(
    ("kind", "source_is_local", "wrong_relay_kind"),
    [
        (
            "extract",
            True,
            "creation",
        ),
        (
            "extract",
            False,
            "creation",
        ),
        (
            "create",
            False,
            "extraction",
        ),
        (
            "create",
            True,
            "extraction",
        ),
    ],
)
def test_companion_relay_failure_requires_its_scoped_purpose(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
    kind: str,
    source_is_local: bool,
    wrong_relay_kind: str,
) -> None:
    source_connection_id = "local-drive:c" if source_is_local else str(test_connection.id)
    destination_connection_id = str(test_connection.id) if source_is_local else "local-drive:c"
    payload: dict[str, object] = {
        "contract_version": "v2",
        "kind": kind,
        "source_connection_id": source_connection_id,
        "source_path": "backup.zip" if kind == "extract" else "",
        "destination_connection_id": destination_connection_id,
        "destination_path": "output" if kind == "extract" else "output.zip",
    }
    if kind == "create":
        payload["plan_json"] = json.dumps({"source_paths": ["source.txt"]})
    prepared = client.post("/api/archive/v2/operations", headers=auth_headers_user, json=payload).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}

    rejected = client.post(
        f"/api/archive/v2/operations/{prepared['id']}/relay/{wrong_relay_kind}/fail",
        headers=relay_headers,
        json={"message": "relay failed"},
    )
    failed = client.post(
        f"/api/archive/v2/operations/{prepared['id']}/relay/{'extraction' if kind == 'extract' else 'creation'}/fail",
        headers=relay_headers,
        json={"message": "relay failed"},
    )

    assert rejected.status_code == status.HTTP_409_CONFLICT
    assert failed.status_code == 200
    assert failed.json()["phase"] == "failed"
    assert json.loads(failed.json()["last_error_json"])["message"] == "relay failed"


def test_companion_relay_writes_scoped_members_and_completes(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
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
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
            json={"entries": [{"path": "nested/readme.txt", "is_directory": False, "uncompressed_size": 5, "modified_at": None}]},
        )
        write = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
            headers=relay_headers,
            params={"member_path": "nested/readme.txt"},
            content=b"hello",
        )
        duplicate = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
            headers=relay_headers,
            params={"member_path": "nested/readme.txt"},
            content=b"hello",
        )
        complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/complete",
            headers=relay_headers,
            json={"destination_root_created": True},
        )

    assert begin.status_code == 200
    assert begin.json()["phase"] == "streaming"
    assert begin.json()["revision"] == 2
    assert write.status_code == 200
    assert write.json()["revision"] == 3
    checkpoint = json.loads(write.json()["checkpoint_json"])
    assert checkpoint["version"] == 2
    assert checkpoint["manifest"] == [{"path": "nested/readme.txt", "is_directory": False, "uncompressed_size": 5, "modified_at": None}]
    assert checkpoint["member_outcomes"] == {
        "nested/readme.txt": {
            "status": "extracted",
            "target_path": "output/nested/readme.txt",
            "extracted_bytes": 5,
            "directories_created": 1,
            "replaced": False,
            "renamed": False,
        }
    }
    assert duplicate.status_code == 409
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    assert complete.json()["revision"] == 6
    backend.write_file_from_stream.assert_awaited_once()


def test_manifest_backed_companion_relay_requires_terminal_member_coverage(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    backend.write_file_from_stream.return_value = 5

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
            json={"entries": [{"path": "readme.txt", "is_directory": False, "uncompressed_size": 5, "modified_at": None}]},
        )
        incomplete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/complete",
            headers=relay_headers,
        )
        write = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
            headers=relay_headers,
            params={"member_path": "readme.txt"},
            content=b"hello",
        )
        complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/complete",
            headers=relay_headers,
        )

    assert begin.status_code == 200
    assert incomplete.status_code == 409
    assert incomplete.json()["message"] == "Archive operation has unfinished members"
    assert write.status_code == 200
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"


def test_companion_local_source_relay_rejects_a_changed_manifest_before_resume(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}", "Idempotency-Key": str(uuid.uuid4())}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    initial_manifest = {"entries": [{"path": "readme.txt", "is_directory": False, "uncompressed_size": 5, "modified_at": None}]}
    changed_manifest = {"entries": [{"path": "readme.txt", "is_directory": False, "uncompressed_size": 6, "modified_at": None}]}

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        initial = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
            json=initial_manifest,
        )
        resumed = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
            json=changed_manifest,
        )
        operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)

    assert initial.status_code == 200
    assert resumed.status_code == 409
    assert resumed.json()["message"] == "Archive extraction source changed after manifest validation"
    assert operation.json()["phase"] == "failed"
    backend.connect.assert_awaited_once()


def test_companion_local_source_relay_requires_a_manifest_before_resume(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    manifest = {"entries": [{"path": "readme.txt", "is_directory": False, "uncompressed_size": 5, "modified_at": None}]}

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        initial = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
            json=manifest,
        )
        resumed = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
        )

    assert initial.status_code == 200
    assert resumed.status_code == 409
    assert resumed.json()["message"] == "Archive extraction source manifest is required to resume"


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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
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
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
            json={
                "entries": [
                    {
                        "path": "readme.txt",
                        "is_directory": False,
                        "uncompressed_size": 5,
                        "modified_at": source_modified_at.isoformat(),
                    }
                ]
            },
        )
        backend.write_file_from_stream.side_effect = FileExistsError
        collision = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
            headers=relay_headers,
            params={"member_path": "readme.txt"},
            content=b"hello",
        )
        decision = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
            headers=auth_headers_user,
            json={"action": "replace_older"},
        )
        backend.write_file_from_stream.side_effect = None
        backend.write_file_from_stream.reset_mock()
        response = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
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
    checkpoint = json.loads(response.json()["checkpoint_json"])
    skipped = sum(1 for outcome in checkpoint["member_outcomes"].values() if outcome["status"] == "skipped")
    assert skipped == expected_skipped
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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
            json={"entries": [{"path": "safe.txt", "is_directory": False, "uncompressed_size": 0, "modified_at": None}]},
        )
        response = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
            json={"entries": [{"path": "empty", "is_directory": True, "uncompressed_size": 0, "modified_at": None}]},
        )
        response = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
            headers=relay_headers,
            params={"member_path": "empty", "is_directory": "true"},
        )

    assert response.status_code == 200
    assert json.loads(response.json()["checkpoint_json"])["member_outcomes"] == {
        "empty": {
            "status": "directory",
            "target_path": "output/empty",
            "extracted_bytes": 0,
            "directories_created": 1,
            "replaced": False,
            "renamed": False,
        }
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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
        )
        member = client.get(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
            headers=relay_headers,
            params={"member_path": "readme.txt"},
        )
        empty_complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member-complete",
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
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member-complete",
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
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/complete",
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
    assert set(checkpoint["member_outcomes"]) == {"empty", "readme.txt"}
    assert checkpoint["member_outcomes"]["readme.txt"]["extracted_bytes"] == 5
    assert checkpoint["source_snapshot"] == {"size": len(archive_bytes), "modified_at": None}
    assert checkpoint["manifest"] == manifest.json()["entries"]


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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        response = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers={"Authorization": f"Bearer {capability['token']}"},
        )
        operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)

    assert response.status_code == 422
    assert response.json()["message"] == "Archive extraction source is invalid"
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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        first_manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
        )
        backend.get_file_info.reset_mock()
        backend.open_random_access_reader.reset_mock()
        repeated_manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
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
    corpus_path = Path(__file__).resolve().parents[2] / "archive-contract" / "v2" / "fixtures" / "extraction-outcome-scenarios-v2.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    scenario = next(scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "collision_skip_is_terminal")
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
        )
        paused = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member-collision",
            headers={**relay_headers, "Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            json={"member_path": "readme.txt", "is_directory": False, "target_size": 8},
        )
        repeated_pause = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member-collision",
            headers={**relay_headers, "Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            json={"member_path": "readme.txt", "is_directory": False, "target_size": 8},
        )
        resumed = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
            headers=auth_headers_user,
            json={"action": scenario["collision_action"], "member_path": "readme.txt"},
        )
        completed_member = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member-complete",
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
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/complete",
            headers=relay_headers,
            json={"destination_root_created": False},
        )

    assert manifest.status_code == 200
    assert paused.status_code == 200
    assert repeated_pause.status_code == 200
    assert repeated_pause.json()["phase"] == "awaiting_user_decision"
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
    assert checkpoint["version"] == 2
    assert checkpoint["member_outcomes"]["readme.txt"]["status"] == "skipped"
    assert (
        sum(1 for outcome in checkpoint["member_outcomes"].values() if outcome["status"] == "skipped")
        == scenario["progress"]["files_skipped"]
    )


def test_companion_local_relay_rename_preserves_the_normalized_destination_result(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    corpus_path = Path(__file__).resolve().parents[2] / "archive-contract" / "v2" / "fixtures" / "extraction-outcome-scenarios-v2.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    scenario = next(
        scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "rename_preserves_terminal_destination_metadata"
    )
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("root.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    target_path = f"output/{scenario['rename_target']}"
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
        )
        paused = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member-collision",
            headers=relay_headers,
            json={"member_path": "root.txt", "is_directory": False, "target_size": 8},
        )
        resumed = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
            headers=auth_headers_user,
            json={"action": "rename", "member_path": "root.txt", "target_path": scenario["rename_target"]},
        )
        completion = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member-complete",
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
    corpus_path = Path(__file__).resolve().parents[2] / "archive-contract" / "v2" / "fixtures" / "extraction-outcome-scenarios-v2.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    scenario = next(scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == scenario_name)
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("source.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
        )
        paused = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member-error",
            headers=relay_headers,
            json={"member_path": scenario["member_path"], "message": "Disk full", "partial_output": True},
        )
        resumed = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
            headers=auth_headers_user,
            json={"action": scenario["member_error_action"], "member_path": scenario["member_path"]},
        )
        member_complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member-complete",
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
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/complete",
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
    summary = extraction_outcome_summary(checkpoint, 0)
    for key, value in scenario["progress"].items():
        assert getattr(summary, key) == value


def test_companion_local_relay_cancels_before_accepting_late_member_completion(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    corpus_path = Path(__file__).resolve().parents[2] / "archive-contract" / "v2" / "fixtures" / "extraction-outcome-scenarios-v2.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    scenario = next(
        scenario for scenario in corpus["behavioral_scenarios"] if scenario["name"] == "cancellation_stops_before_member_completion"
    )
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
        )
        cancellation = client.post(f"/api/archive/v2/operations/{prepared['id']}/cancel", headers=auth_headers_user)
        completion = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member-complete",
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
        operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)

    assert begin.status_code == 200
    assert cancellation.status_code == 200
    assert cancellation.json()["cancellation_requested"] is True
    assert completion.status_code == 409
    assert completion.json()["message"] == "Archive operation was cancelled"
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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
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
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
        )
        member = client.get(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
            headers=relay_headers,
            params={"member_path": "readme.txt"},
        )
        operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)

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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
        )
        backend.open_random_access_reader.reset_mock()
        member = client.get(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    member_relay_headers = {**relay_headers, "Idempotency-Key": str(uuid.uuid4())}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)

    async def source_chunks():
        yield b"hello"

    backend.read_file = lambda _path: source_chunks()
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
        )
        member = client.get(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
        )
        member_complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member-complete",
            headers=member_relay_headers,
            json={"archive_path": "readme.txt", "status": "created", "source_bytes": 5},
        )
        repeated_member_complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member-complete",
            headers=member_relay_headers,
            json={"archive_path": "readme.txt", "status": "created", "source_bytes": 5},
        )
        conflicting_member_complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member-complete",
            headers=member_relay_headers,
            json={"archive_path": "readme.txt", "status": "created", "source_bytes": 4},
        )
        complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/complete",
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
    assert conflicting_member_complete.status_code == status.HTTP_409_CONFLICT
    assert conflicting_member_complete.json()["message"] == "Archive relay idempotency key conflicts with its command"
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    checkpoint = json.loads(complete.json()["checkpoint_json"])
    assert checkpoint["member_outcomes"] == {"readme.txt": {"status": "created", "source_bytes": 5}}
    assert checkpoint["manifest"] == [
        {
            "source_path": "readme.txt",
            "archive_path": "readme.txt",
            "is_directory": False,
            "source_size": 5,
            "modified_at": None,
        }
    ]


def test_companion_creation_relay_rejects_invalid_idempotency_key(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    response = client.post(
        f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member-complete",
        headers={"Authorization": f"Bearer {capability['token']}", "Idempotency-Key": "not-a-uuid"},
        json={"archive_path": "readme.txt", "status": "created", "source_bytes": 5},
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert response.json()["message"] == "Archive relay idempotency key is invalid"


def test_companion_local_creation_relay_reuses_its_persisted_manifest(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}", "Idempotency-Key": str(uuid.uuid4())}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        first_manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
        )
        backend.get_file_info.reset_mock()
        repeated_manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
        )

    assert first_manifest.status_code == 200
    assert repeated_manifest.status_code == 200
    assert repeated_manifest.json()["entries"] == first_manifest.json()["entries"]
    backend.connect.assert_awaited_once()
    backend.get_file_info.assert_not_awaited()


def test_companion_local_creation_relay_accepts_equivalent_canonical_source_timestamps(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.side_effect = [
        FileInfo(
            name="readme.txt",
            path="readme.txt",
            type=FileType.FILE,
            size=5,
            modified_at=datetime(2024, 3, 1, 8, 30, 45, 987654, tzinfo=timezone(timedelta(hours=2))),
        ),
        FileInfo(
            name="readme.txt",
            path="readme.txt",
            type=FileType.FILE,
            size=5,
            modified_at=datetime(2024, 3, 1, 6, 30, 45, tzinfo=timezone.utc),
        ),
    ]

    async def source_chunks():
        yield b"hello"

    backend.read_file = lambda _path: source_chunks()
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
        )
        member = client.get(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
        )

    assert manifest.status_code == 200
    assert datetime.fromisoformat(manifest.json()["entries"][0]["modified_at"].replace("Z", "+00:00")) == datetime(
        2024, 3, 1, 6, 30, 45, tzinfo=timezone.utc
    )
    assert member.status_code == 200
    assert member.content == b"hello"


def test_companion_local_creation_relay_rejects_a_source_changed_after_manifest_preflight(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
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
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
        )
        member = client.get(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
        )
        operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)

    assert manifest.status_code == 200
    assert member.status_code == 409
    assert operation.json()["phase"] == "failed"


def test_companion_local_creation_relay_rejects_an_inconsistent_completion_summary(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
        )
        complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 4},
        )
        operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)

    assert manifest.status_code == 200
    assert complete.status_code == 409
    assert operation.json()["phase"] == "failed"


def test_companion_local_creation_relay_requires_member_outcomes_before_completion(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
        )
        complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 5},
        )
        operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)

    assert manifest.status_code == 200
    assert complete.status_code == 409
    assert operation.json()["phase"] == "failed"


def test_companion_smb_creation_relay_commits_local_members_and_completes(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 9}]},
        )
        member = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
            content=b"zip-bytes",
        )
        checkpoint = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)
        complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 9},
        )
        repeated_complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 9},
        )

    assert begin.status_code == 200
    assert member.status_code == 200
    assert member.json()["phase"] == "streaming"
    assert json.loads(checkpoint.json()["checkpoint_json"])["member_outcomes"] == {"readme.txt": {"status": "created", "source_bytes": 9}}
    writer.write.assert_awaited()
    writer.close.assert_awaited_once()
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    assert repeated_complete.status_code == 200
    assert repeated_complete.json()["phase"] == "completed"
    assert creation_outcome_summary(json.loads(complete.json()["checkpoint_json"])).source_bytes == 9


def test_local_to_smb_creation_relay_commits_directories_and_replays_members_once(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["docs"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
            json={
                "entries": [
                    {"archive_path": "docs", "is_directory": True, "source_size": 0},
                    {"archive_path": "docs/readme.txt", "is_directory": False, "source_size": 5},
                ]
            },
        )
        repeated_begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
            json={
                "entries": [
                    {"archive_path": "docs", "is_directory": True, "source_size": 0},
                    {"archive_path": "docs/readme.txt", "is_directory": False, "source_size": 5},
                ]
            },
        )
        directory = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "docs"},
        )
        file_member = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "docs\\readme.txt"},
            content=b"hello",
        )
        write_count_before_replay = writer.write.await_count
        replay = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "docs\\readme.txt"},
            content=b"hello",
        )
        write_count_after_replay = writer.write.await_count
        complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/complete",
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
    assert json.loads(complete.json()["checkpoint_json"])["member_outcomes"] == {
        "docs": {"status": "directory", "source_bytes": 0},
        "docs/readme.txt": {"status": "created", "source_bytes": 5},
    }


def test_cancelling_local_to_smb_creation_after_a_member_commit_preserves_ledger(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["first.txt", "second.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
            json={
                "entries": [
                    {"archive_path": "first.txt", "is_directory": False, "source_size": 5},
                    {"archive_path": "second.txt", "is_directory": False, "source_size": 6},
                ]
            },
        )
        member = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "first.txt"},
            content=b"first",
        )
        cancelled = client.post(f"/api/archive/v2/operations/{prepared['id']}/cancel", headers=auth_headers_user)

    assert begin.status_code == 200
    assert member.status_code == 200
    assert cancelled.status_code == 200
    assert cancelled.json()["phase"] == "cancelled"
    assert json.loads(cancelled.json()["checkpoint_json"])["member_outcomes"] == {"first.txt": {"status": "created", "source_bytes": 5}}
    writer.abort_and_delete_if_owned.assert_awaited_once()
    backend.disconnect.assert_awaited_once()


def test_local_to_smb_creation_rejects_completion_before_the_manifest_is_reported(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["first.txt", "second.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
            json={
                "entries": [
                    {"archive_path": "first.txt", "is_directory": False, "source_size": 5},
                    {"archive_path": "second.txt", "is_directory": False, "source_size": 6},
                ]
            },
        )
        member = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "first.txt"},
            content=b"first",
        )
        complete = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/complete",
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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        cancelled = client.post(f"/api/archive/v2/operations/{prepared['id']}/cancel", headers=auth_headers_user)
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 9}]},
        )
        operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)

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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers={"Authorization": f"Bearer {capability['token']}"},
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 9}]},
        )
        cancelled = client.post(f"/api/archive/v2/operations/{prepared['id']}/cancel", headers=auth_headers_user)

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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 9}]},
        )
        failed = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/fail",
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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 10}]},
        )
        member = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
            content=b"zip-bytes",
        )

    assert begin.status_code == 200
    assert member.status_code == 409
    assert member.json()["message"] == "Archive creation source changed after manifest validation"
    writer.abort_and_delete_if_owned.assert_awaited_once()


def test_local_to_smb_creation_rejects_members_after_live_writer_interruption(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
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
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/begin",
            headers=relay_headers,
            json={"entries": [{"archive_path": "readme.txt", "is_directory": False, "source_size": 5}]},
        )
        member = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/creation/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
            content=b"hello",
        )

    assert begin.status_code == 200
    assert member.status_code == 409
    assert member.json()["message"] == "Archive creation session was interrupted"
    execution.write_member.assert_not_awaited()


def test_companion_relay_pauses_for_destination_collision(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/v2/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    backend.write_file_from_stream.side_effect = FileExistsError()
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        client.post(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/begin",
            headers=relay_headers,
            json={"entries": [{"path": "existing.txt", "is_directory": False, "uncompressed_size": 7, "modified_at": None}]},
        )
        response = client.put(
            f"/api/archive/v2/operations/{prepared['id']}/relay/extraction/member",
            headers=relay_headers,
            params={"member_path": "existing.txt"},
            content=b"blocked",
        )
        operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "awaiting_user_decision"
    assert json.loads(response.json()["pending_decision_json"])["conflicts"] == [
        {"member_path": "existing.txt", "target_path": "output/existing.txt", "is_directory": False, "source_size": 7}
    ]
    assert operation.json()["phase"] == "awaiting_user_decision"


def test_v2_executes_same_connection_creation_with_strict_ledger(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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
        response = client.post(f"/api/archive/v2/operations/{prepared['id']}/creation/begin", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "completed"
    assert json.loads(response.json()["checkpoint_json"]) == {
        "version": 2,
        "member_outcomes": {
            "first.txt": {"status": "created", "source_bytes": 5},
            "second.txt": {"status": "created", "source_bytes": 6},
        },
        "decisions": {},
        "pending_decision": None,
        "delivery_ids": {},
        "manifest": [
            {
                "source_path": "first.txt",
                "archive_path": "first.txt",
                "is_directory": False,
                "source_size": 5,
                "modified_at": None,
            },
            {
                "source_path": "second.txt",
                "archive_path": "second.txt",
                "is_directory": False,
                "source_size": 6,
                "modified_at": None,
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
        preflight_manifest=ANY,
    )
    manifest = create_archive.await_args.kwargs["preflight_manifest"]
    assert [(member.archive_path, member.source_size, member.source_modified_at) for member in manifest.members] == [
        ("first.txt", 5, None),
        ("second.txt", 6, None),
    ]


def test_executes_same_connection_extraction(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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
                    ArchiveExtractionResult(2, 3, 10),
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
        response = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    assert response.status_code == 200, response.text
    assert response.json()["phase"] == "completed"
    checkpoint = json.loads(response.json()["checkpoint_json"])
    assert checkpoint["version"] == 2
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
        execution_plan=ANY,
        on_member_completed=ANY,
        is_cancelled=ANY,
    )
    execution_plan = extract_archive.await_args.kwargs["execution_plan"]
    assert execution_plan.existing_file_policy is None
    assert execution_plan.collision_actions() == {}
    assert execution_plan.rename_targets() == {}
    assert execution_plan.ignored_member_paths() == []
    assert execution_plan.completed_member_paths() == frozenset()


def test_v2_direct_extraction_persists_strict_checkpoint_envelope(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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
    configure_direct_extraction_archive(backend, {"first.txt": b"12345"})

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(
                side_effect=completed_extraction_runner(
                    ArchiveExtractionResult(1, 0, 5),
                    [ArchiveExtractionDestinationResult("first.txt", "extracted", "output/first.txt", extracted_bytes=5)],
                )
            ),
        ),
    ):
        response = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    assert response.status_code == 200
    checkpoint = json.loads(response.json()["checkpoint_json"])
    assert set(checkpoint) == {
        "version",
        "manifest",
        "source_snapshot",
        "member_outcomes",
        "decisions",
        "pending_decision",
        "delivery_ids",
    }
    assert checkpoint["version"] == 2
    assert checkpoint["member_outcomes"]["first.txt"]["status"] == "extracted"


def test_extraction_conflicts_become_pending_user_decisions(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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
        response = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "awaiting_user_decision"
    assert json.loads(response.json()["pending_decision_json"])["conflicts"] == [
        {"member_path": "root.txt", "target_path": "output/root.txt", "is_directory": False}
    ]

    decision = client.post(
        f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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
        response = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    assert response.status_code == 200
    assert json.loads(response.json()["pending_decision_json"])["allowed_actions"] == ["rename"]

    rejected = client.post(
        f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
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
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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
        client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    response = client.post(
        f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
        headers=auth_headers_user,
        json={"action": "skip", "member_path": "root.txt"},
    )

    assert response.status_code == 200
    assert response.json()["phase"] == "streaming"
    assert response.json()["collision_policy"] is None
    assert json.loads(response.json()["checkpoint_json"])["decisions"]["collision_actions"] == {"root.txt": "skip"}

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(
                side_effect=completed_extraction_runner(
                    ArchiveExtractionResult(1, 1, 6, files_skipped=1, skipped_members=("root.txt",)),
                    [ArchiveExtractionDestinationResult("root.txt", "skipped", "output/root.txt")],
                )
            ),
        ) as extract_archive,
    ):
        resumed = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    assert resumed.status_code == 200
    assert resumed.json()["phase"] == "completed"
    assert json.loads(resumed.json()["checkpoint_json"])["member_outcomes"]["root.txt"]["status"] == "skipped"
    assert extract_archive.await_args.kwargs["execution_plan"].collision_actions() == {"root.txt": "skip"}


def test_direct_smb_extraction_rejects_a_source_changed_after_pause(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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
        paused = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)
    assert paused.status_code == 200

    decision = client.post(
        f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
        headers=auth_headers_user,
        json={"action": "skip", "member_path": "root.txt"},
    )
    assert decision.status_code == 200

    backend.get_file_info.return_value = FileInfo(
        name="input.zip",
        path="input.zip",
        type=FileType.FILE,
        size=999,
    )
    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch("app.api.archive_operations.extract_archive_to_new_paths", new=AsyncMock()) as extract_archive,
    ):
        resumed = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    assert resumed.status_code == 409
    assert resumed.json()["message"] == "Archive extraction source changed after manifest validation"
    extract_archive.assert_not_awaited()
    operation = client.get(f"/api/archive/v2/operations/{prepared['id']}", headers=auth_headers_user)
    assert operation.json()["phase"] == "failed"


def test_individual_rename_decision_persists_a_safe_member_remap(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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
        client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        response = client.post(
            f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
            headers=auth_headers_user,
            json={"action": "rename", "member_path": "root.txt", "target_path": "renamed/root-copy.txt"},
        )

    assert response.status_code == 200
    assert json.loads(response.json()["checkpoint_json"])["decisions"]["rename_targets"] == {"root.txt": "renamed/root-copy.txt"}

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
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
        ) as extract_archive,
    ):
        resumed = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    assert resumed.status_code == 200
    assert json.loads(resumed.json()["checkpoint_json"])["member_outcomes"]["root.txt"]["renamed"] is True
    assert extract_archive.await_args.kwargs["execution_plan"].rename_targets() == {"root.txt": "renamed/root-copy.txt"}


def test_member_write_failure_pauses_for_retry_or_ignore(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    retry_action = "retry"
    ignore_action = "ignore"
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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
        response = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "awaiting_user_decision"
    assert json.loads(response.json()["pending_decision_json"])["allowed_actions"] == ["retry", "ignore"]
    checkpoint = json.loads(response.json()["checkpoint_json"])
    assert checkpoint["version"] == 2
    assert checkpoint["member_outcomes"] == {"root.txt": {"status": "partial", "target_path": "output/root.txt", "message": "Disk full"}}

    retry = client.post(
        f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
        headers=auth_headers_user,
        json={"action": retry_action, "member_path": "root.txt"},
    )
    assert retry.status_code == 200
    assert json.loads(retry.json()["checkpoint_json"])["decisions"]["retry_members"] == ["root.txt"]

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(side_effect=ArchiveExtractionMemberError("root.txt", "output/root.txt", "Disk full")),
        ),
    ):
        response = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "awaiting_user_decision"

    decision = client.post(
        f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
        headers=auth_headers_user,
        json={"action": ignore_action, "member_path": "root.txt"},
    )
    assert decision.status_code == 200
    assert decision.json()["phase"] == "streaming"
    assert json.loads(decision.json()["checkpoint_json"])["decisions"]["ignored_members"] == ["root.txt"]

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(
                side_effect=completed_extraction_runner(
                    ArchiveExtractionResult(1, 1, 4, files_skipped=1, skipped_members=("root.txt",)),
                    [ArchiveExtractionDestinationResult("root.txt", "ignored", "output/root.txt")],
                )
            ),
        ) as extract_archive,
    ):
        resumed = client.post(f"/api/archive/v2/operations/{prepared['id']}/extraction/begin", headers=auth_headers_user)

    assert resumed.status_code == 200
    assert resumed.json()["phase"] == "completed"
    assert json.loads(resumed.json()["checkpoint_json"])["member_outcomes"]["root.txt"]["status"] == "ignored"
    assert extract_archive.await_args.kwargs["execution_plan"].ignored_member_paths() == ["root.txt"]


def test_rejects_malformed_persisted_extraction_decision(
    client: TestClient,
    session,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/v2/operations",
        headers=auth_headers_user,
        json={
            "contract_version": "v2",
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
        f"/api/archive/v2/operations/{prepared['id']}/extraction/decision",
        headers=auth_headers_user,
        json={"action": "skip_all"},
    )

    assert response.status_code == 409
    assert response.json()["message"] == "Archive operation decision state is invalid"
