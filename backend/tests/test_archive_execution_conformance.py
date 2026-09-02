"""Language-neutral archive execution conformance checks."""

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import HTTPException

from app.services.archive.coordinator import (
    ArchiveCreationManifest,
    ArchiveCreationManifestMember,
    ArchiveCreationState,
    creation_outcome_summary,
    record_creation_member_outcome,
)
from app.services.archive.creation import ArchiveCreationMemberOutcome
from app.services.archive.v2_checkpoint import new_v2_extraction_checkpoint, validate_v2_extraction_checkpoint

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
INVALID_CHECKPOINT_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "invalid-checkpoints-v2.json"
CREATION_OUTCOME_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "creation-outcome-scenarios-v2.json"
CREATION_TRAJECTORY_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "creation-trajectory-scenarios-v2.json"


def creation_manifest_for_reports(reports: list[dict[str, Any]]) -> ArchiveCreationManifest:
    members: dict[str, ArchiveCreationManifestMember] = {}
    for report in reports:
        archive_path = report["archive_path"]
        if archive_path not in members:
            members[archive_path] = ArchiveCreationManifestMember(
                archive_path,
                report["status"] == "directory",
                0 if report["status"] == "directory" else report["source_bytes"],
                None,
                None,
            )
    return ArchiveCreationManifest.from_members(list(members.values()))


def test_v2_extraction_checkpoint_is_aggregate_only() -> None:
    """S1 extraction persistence cannot retain a manifest, decision, or member outcome."""

    checkpoint = new_v2_extraction_checkpoint()
    validate_v2_extraction_checkpoint(checkpoint)
    assert checkpoint == {
        "version": 2,
        "aggregate_counters": {
            "members_processed": 0,
            "members_completed": 0,
            "members_skipped": 0,
            "members_failed": 0,
            "files_extracted": 0,
            "directories_created": 0,
            "extracted_bytes": 0,
            "files_replaced": 0,
        },
    }


def test_v2_invalid_checkpoint_corpus_is_rejected() -> None:
    """Keep legacy and malformed checkpoints isolated as explicit V2 negatives."""

    corpus: dict[str, Any] = json.loads(INVALID_CHECKPOINT_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 2
    for case in corpus["cases"]:
        with pytest.raises(HTTPException):
            validate_v2_extraction_checkpoint(case["checkpoint"])


def test_v2_extraction_checkpoint_rejects_persisted_decisions() -> None:
    """Collision decisions remain only in the retained live source session."""

    checkpoint = new_v2_extraction_checkpoint()
    checkpoint["decisions"] = {"collision_actions": {}}
    with pytest.raises(HTTPException):
        validate_v2_extraction_checkpoint(checkpoint)


def test_v2_extraction_checkpoint_rejects_all_member_state_fields() -> None:
    """No source snapshot, manifest, delivery ledger, or member result is durable in S1."""

    for field, value in {
        "manifest": [],
        "source_snapshot": {},
        "member_outcomes": {},
        "pending_decision": None,
        "delivery_ids": {},
    }.items():
        checkpoint = new_v2_extraction_checkpoint()
        checkpoint[field] = value
        with pytest.raises(HTTPException):
            validate_v2_extraction_checkpoint(checkpoint)


def test_v2_creation_outcome_conformance_corpus() -> None:
    """Keep normalized creation outcome persistence aligned across executors."""

    corpus: dict[str, Any] = json.loads(CREATION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 2
    for scenario in corpus["scenarios"]:
        reports = scenario["result_reports"]
        manifest = creation_manifest_for_reports(reports)
        checkpoint = manifest.empty_checkpoint()
        if "error" in scenario:
            with pytest.raises(HTTPException):
                for report in reports:
                    record_creation_member_outcome(
                        checkpoint,
                        ArchiveCreationMemberOutcome(report["archive_path"], report["status"], report["source_bytes"]),
                    )
            continue
        for report in reports:
            record_creation_member_outcome(
                checkpoint,
                ArchiveCreationMemberOutcome(report["archive_path"], report["status"], report["source_bytes"]),
            )
        assert checkpoint["member_outcomes"] == scenario["member_outcomes"]
        summary = creation_outcome_summary(checkpoint)
        for key, value in scenario["progress"].items():
            assert getattr(summary, key) == value


def test_v2_creation_manifest_conformance_corpus() -> None:
    """Keep immutable creation manifest validation aligned across executors."""

    corpus: dict[str, Any] = json.loads(CREATION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 2
    for scenario in corpus["manifest_scenarios"]:
        entries = [
            ArchiveCreationManifestMember(entry["archive_path"], entry["is_directory"], entry["source_size"], None, None)
            for entry in scenario["entries"]
        ]
        if "error" in scenario:
            with pytest.raises(HTTPException):
                ArchiveCreationManifest.from_members(entries)
            continue
        manifest = ArchiveCreationManifest.from_members(entries)
        assert [
            {"archive_path": entry.archive_path, "is_directory": entry.is_directory, "source_size": entry.source_size}
            for entry in manifest.members
        ] == scenario["normalized_entries"]
        checkpoint = manifest.empty_checkpoint()
        state = ArchiveCreationState.from_checkpoint(checkpoint)
        for entry in manifest.members:
            record_creation_member_outcome(checkpoint, state.expected_outcome(entry.archive_path))
        assert creation_outcome_summary(checkpoint).to_checkpoint() == scenario["progress"]


def test_v2_creation_terminal_conformance_corpus() -> None:
    """Keep manifest-backed replay and exact terminal coverage aligned across executors."""

    corpus: dict[str, Any] = json.loads(CREATION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 2
    for scenario in corpus["terminal_scenarios"]:
        manifest = ArchiveCreationManifest.from_members(
            [
                ArchiveCreationManifestMember(entry["archive_path"], entry["is_directory"], entry["source_size"], None, None)
                for entry in scenario["entries"]
            ]
        )
        checkpoint = manifest.empty_checkpoint()
        state = ArchiveCreationState.from_checkpoint(checkpoint)
        if "error" in scenario:
            with pytest.raises(HTTPException):
                for report in scenario["result_reports"]:
                    outcome = state.validate_report(
                        ArchiveCreationMemberOutcome(report["archive_path"], report["status"], report["source_bytes"])
                    )
                    record_creation_member_outcome(checkpoint, outcome)
                state.terminal_summary()
            continue
        for report in scenario["result_reports"]:
            outcome = state.validate_report(ArchiveCreationMemberOutcome(report["archive_path"], report["status"], report["source_bytes"]))
            record_creation_member_outcome(checkpoint, outcome)
        assert state.terminal_summary().to_checkpoint() == scenario["progress"]


def test_v2_creation_trajectory_conformance_corpus() -> None:
    """Replay V2 creation trajectories through the immutable manifest and outcome ledger."""

    corpus: dict[str, Any] = json.loads(CREATION_TRAJECTORY_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 2
    assert set(corpus["topologies"]) == {"smb_to_smb", "local_to_local", "smb_to_local", "local_to_smb"}
    for scenario in corpus["scenarios"]:
        manifest = ArchiveCreationManifest.from_members(
            [
                ArchiveCreationManifestMember(entry["archive_path"], entry["is_directory"], entry["source_size"], None, None)
                for entry in scenario["entries"]
            ]
        )
        checkpoint = manifest.empty_checkpoint()
        state = ArchiveCreationState.from_checkpoint(checkpoint)
        cancelled = False
        for step in scenario["steps"]:
            if step["event"] == "cancel":
                cancelled = True
            elif step["event"] == "report":
                outcome = state.validate_report(ArchiveCreationMemberOutcome(step["archive_path"], step["status"], step["source_bytes"]))
                record_creation_member_outcome(checkpoint, outcome)
        member_outcomes = checkpoint["member_outcomes"]
        assert isinstance(member_outcomes, dict)
        assert set(member_outcomes) == set(scenario["completed_members"])
        if cancelled:
            assert scenario["terminal_phase"] == "cancelled"
        else:
            assert state.terminal_summary().to_checkpoint() == scenario["progress"]
