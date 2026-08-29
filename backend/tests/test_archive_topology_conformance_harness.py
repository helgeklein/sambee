"""Actual-coordinator archive conformance checks using deterministic test adapters."""

import asyncio
import json
import uuid
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

import pytest
from fastapi import HTTPException

from app.models.archive_operation import ArchiveOperation, ArchiveOperationKind, ArchiveOperationPhase
from app.services.archive.coordinator import (
    ArchiveCreationCoordinator,
    ArchiveCreationExecutionPlan,
    ArchiveCreationManifest,
    ArchiveCreationManifestMember,
    ArchiveExtractionCoordinator,
    ArchiveExtractionManifest,
    ArchiveExtractionManifestMember,
    InMemoryArchiveExecutionStateStore,
    new_extraction_outcome_checkpoint,
)
from app.services.archive.creation import ArchiveCreationCancelled, ArchiveCreationMemberOutcome, ArchiveCreationResult
from app.services.archive.execution import ArchiveExecutionDriver, resolve_archive_operation_topology_plan
from app.services.archive.extraction import (
    ArchiveExtractionCancelled,
    ArchiveExtractionConflict,
    ArchiveExtractionConflicts,
    ArchiveExtractionDestinationResult,
    ArchiveExtractionMemberError,
    ArchiveExtractionResult,
)


class AdapterFault(StrEnum):
    COLLISION = "collision"
    PARTIAL_WRITE = "partial_write"
    CANCELLATION = "cancellation"
    SOURCE_CHANGED = "source_changed"
    TRANSPORT_FAILURE = "transport_failure"


@dataclass(frozen=True)
class TopologyCase:
    name: str
    source_connection_id: str
    destination_connection_id: str
    driver: ArchiveExecutionDriver


TOPOLOGY_CASES = (
    TopologyCase("smb_to_smb", "connection-1", "connection-1", ArchiveExecutionDriver.BACKEND),
    TopologyCase("local_to_local", "local-drive:c", "local-drive:c", ArchiveExecutionDriver.COMPANION),
    TopologyCase("smb_to_local", "connection-1", "local-drive:c", ArchiveExecutionDriver.COMPANION),
    TopologyCase("local_to_smb", "local-drive:c", "connection-1", ArchiveExecutionDriver.COMPANION),
)
WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
EXTRACTION_TRAJECTORY_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "extraction-trajectory-scenarios-v1.json"
CREATION_TRAJECTORY_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "creation-trajectory-scenarios-v1.json"


def _load_trajectory_scenarios(path: Path) -> tuple[dict[str, Any], ...]:
    corpus: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    assert corpus["version"] == 1
    assert {case.name for case in TOPOLOGY_CASES} == set(corpus["topologies"])
    return tuple(corpus["scenarios"])


EXTRACTION_TRAJECTORIES = _load_trajectory_scenarios(EXTRACTION_TRAJECTORY_CORPUS_PATH)
CREATION_TRAJECTORIES = _load_trajectory_scenarios(CREATION_TRAJECTORY_CORPUS_PATH)


@dataclass(frozen=True)
class FaultInjectingExtractionAdapter:
    """Test-only extraction adapter that reports observations without lifecycle mutations."""

    fault: AdapterFault | None = None

    async def run(self, execution_plan, on_member_completed, is_cancelled) -> ArchiveExtractionResult:
        member = execution_plan.member("entry.txt")
        assert member.uncompressed_size == 5
        if self.fault == AdapterFault.COLLISION:
            raise ArchiveExtractionConflicts([ArchiveExtractionConflict("entry.txt", "output/entry.txt", source_size=5)])
        if self.fault == AdapterFault.PARTIAL_WRITE:
            raise ArchiveExtractionMemberError("entry.txt", "output/entry.txt", "injected partial write")
        if self.fault == AdapterFault.CANCELLATION:
            raise ArchiveExtractionCancelled()
        if self.fault == AdapterFault.SOURCE_CHANGED:
            raise RuntimeError("injected source changed")
        if self.fault == AdapterFault.TRANSPORT_FAILURE:
            raise RuntimeError("injected relay transport failure")
        assert await is_cancelled() is False
        await on_member_completed(ArchiveExtractionDestinationResult("entry.txt", "extracted", "output/entry.txt", extracted_bytes=5))
        return ArchiveExtractionResult(files_extracted=1, directories_created=0, extracted_bytes=5)


@dataclass(frozen=True)
class DeterministicCreationAdapter:
    """Test-only creation adapter that commits only manifest-backed observations."""

    async def run(self, on_member_completed, is_cancelled) -> ArchiveCreationResult:
        assert await is_cancelled() is False
        await on_member_completed(ArchiveCreationMemberOutcome("entry.txt", "created", 5))
        return ArchiveCreationResult(files_created=1, directories_created=0, source_bytes=5)


def _extraction_operation(case: TopologyCase) -> ArchiveOperation:
    manifest = ArchiveExtractionManifest.from_members([ArchiveExtractionManifestMember("entry.txt", False, 5, None)])
    return ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.EXTRACT,
        source_connection_id=case.source_connection_id,
        destination_connection_id=case.destination_connection_id,
        checkpoint_json=json.dumps(new_extraction_outcome_checkpoint(manifest=manifest)),
    )


@pytest.mark.parametrize("case", TOPOLOGY_CASES, ids=lambda case: case.name)
def test_cross_topology_extraction_harness_runs_resolved_coordinator(case: TopologyCase) -> None:
    plan = resolve_archive_operation_topology_plan(
        kind=ArchiveOperationKind.EXTRACT,
        source_connection_id=case.source_connection_id,
        destination_connection_id=case.destination_connection_id,
    )
    assert plan.topology.driver == case.driver
    operation = _extraction_operation(case)

    completed = asyncio.run(
        ArchiveExtractionCoordinator(operation, InMemoryArchiveExecutionStateStore()).run(FaultInjectingExtractionAdapter().run)
    )

    assert completed.phase == ArchiveOperationPhase.COMPLETED


@pytest.mark.parametrize("case", TOPOLOGY_CASES, ids=lambda case: case.name)
def test_cross_topology_creation_harness_runs_resolved_coordinator(case: TopologyCase) -> None:
    plan = resolve_archive_operation_topology_plan(
        kind=ArchiveOperationKind.CREATE,
        source_connection_id=case.source_connection_id,
        destination_connection_id=case.destination_connection_id,
    )
    assert plan.topology.driver == case.driver
    operation = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.CREATE,
        source_connection_id=case.source_connection_id,
        destination_connection_id=case.destination_connection_id,
    )
    creation_plan = ArchiveCreationExecutionPlan(
        ArchiveCreationManifest.from_members([ArchiveCreationManifestMember("entry.txt", False, 5, "entry.txt", None)])
    )

    completed = asyncio.run(
        ArchiveCreationCoordinator(operation, InMemoryArchiveExecutionStateStore()).run(
            DeterministicCreationAdapter().run,
            execution_plan=creation_plan,
        )
    )

    assert completed.phase == ArchiveOperationPhase.COMPLETED


@pytest.mark.parametrize("case", TOPOLOGY_CASES, ids=lambda case: case.name)
@pytest.mark.parametrize("scenario", EXTRACTION_TRAJECTORIES, ids=lambda scenario: scenario["name"])
def test_cross_topology_extraction_harness_replays_shared_trajectory(
    case: TopologyCase,
    scenario: dict[str, Any],
) -> None:
    manifest = ArchiveExtractionManifest.from_members(
        [ArchiveExtractionManifestMember(member_path, False, 0, None) for member_path in scenario["members"]]
    )
    operation = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.EXTRACT,
        source_connection_id=case.source_connection_id,
        destination_connection_id=case.destination_connection_id,
        collision_policy=scenario.get("existing_file_policy"),
        checkpoint_json=json.dumps(new_extraction_outcome_checkpoint(manifest=manifest)),
    )
    state_store = InMemoryArchiveExecutionStateStore()
    steps = scenario["steps"]
    assert steps[0]["event"] == "initialize"
    step_index = 1

    while step_index < len(steps):
        reports: list[dict[str, Any]] = []
        while step_index < len(steps) and steps[step_index]["event"] == "report":
            reports.append(steps[step_index])
            step_index += 1
        event = steps[step_index]["event"]

        async def run(execution_plan, on_member_completed, is_cancelled) -> ArchiveExtractionResult:
            for report in reports:
                execution_plan.member(report["member_path"])
                await on_member_completed(
                    ArchiveExtractionDestinationResult(
                        report["member_path"],
                        report["status"],
                        report["target_path"],
                        extracted_bytes=report.get("extracted_bytes", 0),
                        replaced=report.get("replaced", False),
                        renamed=report.get("renamed", False),
                    )
                )
            if event == "collision_pause":
                raise ArchiveExtractionConflicts(
                    [ArchiveExtractionConflict(steps[step_index]["member_path"], "output/injected-collision.txt")]
                )
            if event == "partial_write":
                raise ArchiveExtractionMemberError(
                    steps[step_index]["member_path"],
                    steps[step_index]["target_path"],
                    "injected partial write",
                )
            if event == "cancel":
                raise ArchiveExtractionCancelled()
            assert event == "terminal_summary"
            assert await is_cancelled() is False
            return ArchiveExtractionResult(0, 0, 0)

        operation = asyncio.run(ArchiveExtractionCoordinator(operation, state_store).run(run))
        if event in {"collision_pause", "partial_write"}:
            assert operation.phase == ArchiveOperationPhase.AWAITING_USER_DECISION
            decision = steps[step_index + 1]
            assert decision["event"] == "decision"
            operation = ArchiveExtractionCoordinator(operation, state_store).apply_decision(
                decision["action"],
                member_path=decision.get("member_path"),
                target_path=decision.get("target_path"),
            )
            assert steps[step_index + 2]["event"] == "resume"
            step_index += 3
        else:
            step_index += 1

    assert operation.phase.value == scenario["terminal_phase"]
    checkpoint: dict[str, Any] = json.loads(operation.checkpoint_json)
    assert set(checkpoint["member_outcomes"]) == set(scenario["completed_members"])
    for key, value in scenario["progress"].items():
        assert checkpoint.get(key, 0) == value


@pytest.mark.parametrize("case", TOPOLOGY_CASES, ids=lambda case: case.name)
@pytest.mark.parametrize("scenario", CREATION_TRAJECTORIES, ids=lambda scenario: scenario["name"])
def test_cross_topology_creation_harness_replays_shared_trajectory(
    case: TopologyCase,
    scenario: dict[str, Any],
) -> None:
    operation = ArchiveOperation(
        user_id=uuid.uuid4(),
        kind=ArchiveOperationKind.CREATE,
        source_connection_id=case.source_connection_id,
        destination_connection_id=case.destination_connection_id,
    )
    creation_plan = ArchiveCreationExecutionPlan(
        ArchiveCreationManifest.from_members(
            [
                ArchiveCreationManifestMember(entry["archive_path"], entry["is_directory"], entry["source_size"], None, None)
                for entry in scenario["entries"]
            ]
        )
    )
    reports = [step for step in scenario["steps"] if step["event"] == "report"]
    cancelled = any(step["event"] == "cancel" for step in scenario["steps"])

    async def run(on_member_completed, is_cancelled) -> ArchiveCreationResult:
        for report in reports:
            await on_member_completed(ArchiveCreationMemberOutcome(report["archive_path"], report["status"], report["source_bytes"]))
        if cancelled:
            raise ArchiveCreationCancelled()
        assert await is_cancelled() is False
        return ArchiveCreationResult(**scenario["progress"])

    completed = asyncio.run(
        ArchiveCreationCoordinator(operation, InMemoryArchiveExecutionStateStore()).run(run, execution_plan=creation_plan)
    )

    assert completed.phase.value == scenario["terminal_phase"]


@pytest.mark.parametrize("case", TOPOLOGY_CASES, ids=lambda case: case.name)
@pytest.mark.parametrize("fault", list(AdapterFault))
def test_fault_injecting_extraction_adapter_leaves_lifecycle_to_coordinator(
    case: TopologyCase,
    fault: AdapterFault,
) -> None:
    operation = _extraction_operation(case)
    coordinator = ArchiveExtractionCoordinator(operation, InMemoryArchiveExecutionStateStore())

    if fault in {AdapterFault.SOURCE_CHANGED, AdapterFault.TRANSPORT_FAILURE}:
        with pytest.raises(HTTPException, match="Archive extraction failed"):
            asyncio.run(coordinator.run(FaultInjectingExtractionAdapter(fault).run))
        assert operation.phase == ArchiveOperationPhase.FAILED
        return

    result = asyncio.run(coordinator.run(FaultInjectingExtractionAdapter(fault).run))
    if fault == AdapterFault.CANCELLATION:
        assert result.phase == ArchiveOperationPhase.CANCELLED
    else:
        assert result.phase == ArchiveOperationPhase.AWAITING_USER_DECISION
