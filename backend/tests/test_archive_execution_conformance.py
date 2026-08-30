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
    ArchiveExtractionExecutionPlan,
    ArchiveExtractionManifest,
    ArchiveExtractionManifestMember,
    ArchiveExtractionPartialMemberOutcome,
    ArchiveExtractionState,
    completed_extraction_member_paths,
    creation_outcome_summary,
    extraction_outcome_summary,
    record_creation_member_outcome,
    record_extraction_member_outcome,
    record_extraction_partial_member_outcome,
)
from app.services.archive.creation import ArchiveCreationMemberOutcome
from app.services.archive.extraction import ArchiveExtractionDestinationResult
from app.services.archive.v2_checkpoint import new_v2_extraction_checkpoint, validate_v2_extraction_checkpoint

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
EXTRACTION_OUTCOME_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "extraction-outcome-scenarios-v2.json"
INVALID_CHECKPOINT_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "invalid-checkpoints-v2.json"
EXTRACTION_TRAJECTORY_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "extraction-trajectory-scenarios-v2.json"
CREATION_OUTCOME_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "creation-outcome-scenarios-v2.json"
CREATION_TRAJECTORY_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "fixtures" / "creation-trajectory-scenarios-v2.json"


def new_v2_test_extraction_checkpoint(manifest: ArchiveExtractionManifest) -> dict[str, object]:
    return new_v2_extraction_checkpoint(
        manifest=manifest.checkpoint_entries(),
        source_snapshot={"size": sum(member.uncompressed_size for member in manifest.members), "modified_at": None},
    )


def extraction_manifest_for_reports(reports: list[dict[str, Any]]) -> ArchiveExtractionManifest:
    members: dict[str, ArchiveExtractionManifestMember] = {}
    for report in reports:
        member_path = report["member_path"]
        if member_path not in members:
            members[member_path] = ArchiveExtractionManifestMember(
                member_path,
                report["status"] == "directory",
                report.get("extracted_bytes", 0),
                None,
            )
    return ArchiveExtractionManifest.from_members(list(members.values()))


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


def test_v2_extraction_outcome_conformance_corpus() -> None:
    """Keep checkpoint replay semantics aligned across backend and Companion."""

    corpus: dict[str, Any] = json.loads(EXTRACTION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 2
    for scenario in corpus["scenarios"]:
        reports = scenario["result_reports"]
        manifest = extraction_manifest_for_reports(reports)
        checkpoint = new_v2_test_extraction_checkpoint(manifest)
        for report in reports:
            record_extraction_member_outcome(
                checkpoint,
                ArchiveExtractionDestinationResult(
                    member_path=report["member_path"],
                    status=report["status"],
                    target_path=report["target_path"],
                    extracted_bytes=report.get("extracted_bytes", 0),
                    directories_created=report.get("directories_created", 0),
                    replaced=report.get("replaced", False),
                    renamed=report.get("renamed", False),
                ),
                preserve_absent_zero=True,
            )
        assert checkpoint["member_outcomes"] == scenario["member_outcomes"]
        assert completed_extraction_member_paths(checkpoint) == scenario["completed_members"]
        summary = extraction_outcome_summary(checkpoint, 0)
        for key, value in scenario.get("progress", {}).items():
            assert getattr(summary, key) == value


def test_v2_invalid_checkpoint_corpus_is_rejected() -> None:
    """Keep legacy and malformed checkpoints isolated as explicit V2 negatives."""

    corpus: dict[str, Any] = json.loads(INVALID_CHECKPOINT_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 2
    for case in corpus["cases"]:
        with pytest.raises(HTTPException):
            validate_v2_extraction_checkpoint(case["checkpoint"])


def test_v2_extraction_manifest_conformance_corpus() -> None:
    """Keep immutable extraction manifest validation aligned across executors."""

    corpus: dict[str, Any] = json.loads(EXTRACTION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 2
    for scenario in corpus["manifest_scenarios"]:
        entries = [
            ArchiveExtractionManifestMember(entry["path"], entry["is_directory"], entry["uncompressed_size"], None)
            for entry in scenario["entries"]
        ]
        if "error" in scenario:
            with pytest.raises(HTTPException):
                ArchiveExtractionManifest.from_members(entries)
            continue
        manifest = ArchiveExtractionManifest.from_members(entries)
        assert [
            {"path": entry.member_path, "is_directory": entry.is_directory, "uncompressed_size": entry.uncompressed_size}
            for entry in manifest.members
        ] == scenario["normalized_entries"]


def test_extraction_state_resolves_decided_target_and_terminal_coverage() -> None:
    """Keep persisted extraction manifest lookups and completion coverage typed."""

    manifest = ArchiveExtractionManifest.from_members(
        [
            ArchiveExtractionManifestMember("docs", True, 0, None),
            ArchiveExtractionManifestMember("docs/readme.txt", False, 7, None),
        ]
    )
    checkpoint = new_v2_test_extraction_checkpoint(manifest)
    checkpoint["decisions"] = {
        "collision_actions": {},
        "rename_targets": {"docs/readme.txt": "renamed/readme.txt"},
        "ignored_members": [],
        "retry_members": [],
    }
    state = ArchiveExtractionState.from_checkpoint(checkpoint)

    assert state.member("docs\\readme.txt").uncompressed_size == 7
    assert state.target_member_path("docs/readme.txt") == "renamed/readme.txt"
    assert state.decisions.collision_action("docs/readme.txt", "replace_all") == "replace_all"
    assert state.decisions.rename_targets() == {"docs/readme.txt": "renamed/readme.txt"}
    assert state.decisions.ignored_member_paths() == []
    assert state.decisions.retry_members_after_completion("docs/readme.txt") == []
    assert state.completed_member_paths() == frozenset()
    assert not state.has_complete_terminal_coverage()

    record_extraction_member_outcome(
        checkpoint,
        ArchiveExtractionDestinationResult("docs", "directory", "output/docs", directories_created=1),
        preserve_absent_zero=True,
    )
    record_extraction_member_outcome(
        checkpoint,
        ArchiveExtractionDestinationResult("docs/readme.txt", "extracted", "output/renamed/readme.txt", extracted_bytes=7),
        preserve_absent_zero=True,
    )

    state = ArchiveExtractionState.from_checkpoint(checkpoint)
    assert state.has_complete_terminal_coverage()
    completed_checkpoint = json.loads(state.completion_checkpoint_json(destination_root_created=True))
    assert "directories_created" not in completed_checkpoint
    assert extraction_outcome_summary(completed_checkpoint, 1).directories_created == 2


def test_extraction_checkpoint_factory_initializes_the_v2_outcome_ledger() -> None:
    """Keep relay checkpoint initialization independent of individual transport routes."""

    manifest = ArchiveExtractionManifest.from_members([ArchiveExtractionManifestMember("docs/readme.txt", False, 7, None)])

    assert new_v2_test_extraction_checkpoint(manifest) == {
        "version": 2,
        "manifest": [{"path": "docs/readme.txt", "is_directory": False, "uncompressed_size": 7, "modified_at": None}],
        "source_snapshot": {"size": 7, "modified_at": None},
        "member_outcomes": {},
        "decisions": {"collision_actions": {}, "rename_targets": {}, "ignored_members": [], "retry_members": []},
        "pending_decision": None,
        "delivery_ids": {},
    }


def test_v2_extraction_trajectory_conformance_corpus() -> None:
    """Execute every shared extraction trajectory through each topology's common lifecycle plan."""

    corpus: dict[str, Any] = json.loads(EXTRACTION_TRAJECTORY_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 2
    assert set(corpus["topologies"]) == {"smb_to_smb", "local_to_local", "smb_to_local", "local_to_smb"}
    for topology in corpus["topologies"]:
        for scenario in corpus["scenarios"]:
            manifest = ArchiveExtractionManifest.from_members(
                [ArchiveExtractionManifestMember(member_path, False, 0, None) for member_path in scenario["members"]]
            )
            checkpoint = new_v2_test_extraction_checkpoint(manifest)
            decisions = checkpoint["decisions"]
            assert isinstance(decisions, dict)
            collision_actions = decisions["collision_actions"]
            rename_targets = decisions["rename_targets"]
            assert isinstance(collision_actions, dict)
            assert isinstance(rename_targets, dict)
            phase = "prepared"
            for step in scenario["steps"]:
                event = step["event"]
                if event == "initialize":
                    assert phase == "prepared", f"{topology}: {scenario['name']}"
                    phase = "streaming"
                elif event == "collision_pause":
                    assert phase == "streaming", f"{topology}: {scenario['name']}"
                    ArchiveExtractionExecutionPlan.from_checkpoint(
                        checkpoint,
                        existing_file_policy=scenario.get("existing_file_policy"),
                    ).member(step["member_path"])
                    phase = "awaiting_user_decision"
                elif event == "decision":
                    assert phase == "awaiting_user_decision", f"{topology}: {scenario['name']}"
                    action = step["action"]
                    member_path = step["member_path"]
                    if action in {"skip", "replace"}:
                        collision_actions[member_path] = action
                    elif action == "rename":
                        rename_targets[member_path] = step["target_path"]
                    elif action == "retry":
                        decisions["retry_members"] = [member_path]
                    elif action == "ignore":
                        decisions["ignored_members"] = [member_path]
                    elif action == "replace_older":
                        assert scenario.get("existing_file_policy") == "replace_older"
                    phase = "streaming"
                elif event == "partial_write":
                    assert phase == "streaming", f"{topology}: {scenario['name']}"
                    record_extraction_partial_member_outcome(
                        checkpoint,
                        ArchiveExtractionPartialMemberOutcome(step["member_path"], step["target_path"], "partial write"),
                    )
                    phase = "awaiting_user_decision"
                elif event == "resume":
                    assert phase == "streaming", f"{topology}: {scenario['name']}"
                    ArchiveExtractionExecutionPlan.from_checkpoint(
                        checkpoint,
                        existing_file_policy=scenario.get("existing_file_policy"),
                    )
                elif event == "report":
                    assert phase == "streaming", f"{topology}: {scenario['name']}"
                    record_extraction_member_outcome(
                        checkpoint,
                        ArchiveExtractionDestinationResult(
                            step["member_path"],
                            step["status"],
                            step["target_path"],
                            extracted_bytes=step.get("extracted_bytes", 0),
                            replaced=step.get("replaced", False),
                            renamed=step.get("renamed", False),
                        ),
                        preserve_absent_zero=True,
                    )
                elif event == "cancel":
                    assert phase == "streaming", f"{topology}: {scenario['name']}"
                    phase = "cancelled"
                elif event == "terminal_summary":
                    assert phase == "streaming", f"{topology}: {scenario['name']}"
                    plan = ArchiveExtractionExecutionPlan.from_checkpoint(
                        checkpoint,
                        existing_file_policy=scenario.get("existing_file_policy"),
                    )
                    assert plan.completion_checkpoint_json(destination_root_created=False)
                    phase = "completed"
                else:
                    pytest.fail(f"{topology}: unsupported extraction trajectory event {event!r}")
            plan = ArchiveExtractionExecutionPlan.from_checkpoint(
                checkpoint,
                existing_file_policy=scenario.get("existing_file_policy"),
            )
            assert phase == scenario["terminal_phase"], f"{topology}: {scenario['name']}"
            assert plan.completed_member_paths() == frozenset(scenario["completed_members"])
            summary = extraction_outcome_summary(checkpoint, 0)
            for key, value in scenario["progress"].items():
                assert getattr(summary, key) == value


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
