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
    new_extraction_outcome_checkpoint,
    record_creation_member_outcome,
    record_extraction_member_outcome,
    record_extraction_partial_member_outcome,
)
from app.services.archive.creation import ArchiveCreationMemberOutcome
from app.services.archive.extraction import ArchiveExtractionDestinationResult

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
EXTRACTION_OUTCOME_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "extraction-outcome-scenarios-v1.json"
EXTRACTION_TRAJECTORY_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "extraction-trajectory-scenarios-v1.json"
CREATION_OUTCOME_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "creation-outcome-scenarios-v1.json"
CREATION_TRAJECTORY_CORPUS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "creation-trajectory-scenarios-v1.json"


def test_v1_extraction_outcome_conformance_corpus() -> None:
    """Keep checkpoint replay semantics aligned across backend and Companion."""

    corpus: dict[str, Any] = json.loads(EXTRACTION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 1
    for scenario in corpus["scenarios"]:
        if "error" in scenario:
            with pytest.raises(HTTPException):
                completed_extraction_member_paths(scenario["checkpoint"])
            continue
        checkpoint = scenario.get("checkpoint", {})
        if "result_reports" in scenario:
            checkpoint = {}
            for report in scenario["result_reports"]:
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
        for key, value in scenario.get("progress", {}).items():
            assert checkpoint.get(key, 0) == value


def test_v1_extraction_manifest_conformance_corpus() -> None:
    """Keep immutable extraction manifest validation aligned across executors."""

    corpus: dict[str, Any] = json.loads(EXTRACTION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 1
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

    checkpoint: dict[str, object] = {
        "archive_manifest": [
            {"path": "docs", "is_directory": True, "uncompressed_size": 0, "modified_at": None},
            {"path": "docs/readme.txt", "is_directory": False, "uncompressed_size": 7, "modified_at": None},
        ],
        "member_rename_targets": {"docs/readme.txt": "renamed/readme.txt"},
        "member_collision_actions": {},
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
    assert state.execution.completed_member_paths() == frozenset()
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

    assert state.has_complete_terminal_coverage()
    completed_checkpoint = json.loads(state.completion_checkpoint_json(destination_root_created=True))
    assert completed_checkpoint["directories_created"] == 2


def test_extraction_checkpoint_factory_initializes_the_versioned_outcome_ledger() -> None:
    """Keep relay checkpoint initialization independent of individual transport routes."""

    manifest = ArchiveExtractionManifest.from_members([ArchiveExtractionManifestMember("docs/readme.txt", False, 7, None)])

    assert new_extraction_outcome_checkpoint(
        directories_created=1,
        manifest=manifest,
        source_identity={"size": 7, "modified_at": None},
    ) == {
        "files_extracted": 0,
        "directories_created": 1,
        "extracted_bytes": 0,
        "extraction_outcome_checkpoint_version": 1,
        "member_outcomes": {},
        "source_identity": {"size": 7, "modified_at": None},
        "archive_manifest": [{"path": "docs/readme.txt", "is_directory": False, "uncompressed_size": 7, "modified_at": None}],
    }


def test_v1_extraction_trajectory_conformance_corpus() -> None:
    """Replay durable extraction decisions and reports from the shared trajectory corpus."""

    corpus: dict[str, Any] = json.loads(EXTRACTION_TRAJECTORY_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 1
    assert set(corpus["topologies"]) == {"smb_to_smb", "local_to_local", "smb_to_local", "local_to_smb"}
    for scenario in corpus["scenarios"]:
        manifest = ArchiveExtractionManifest.from_members(
            [ArchiveExtractionManifestMember(member_path, False, 0, None) for member_path in scenario["members"]]
        )
        checkpoint = new_extraction_outcome_checkpoint(manifest=manifest)
        for step in scenario["steps"]:
            event = step["event"]
            if event == "decision":
                action = step["action"]
                member_path = step["member_path"]
                if action in {"skip", "replace"}:
                    checkpoint.setdefault("member_collision_actions", {})[member_path] = action
                elif action == "rename":
                    checkpoint.setdefault("member_rename_targets", {})[member_path] = step["target_path"]
                elif action == "retry":
                    checkpoint["retry_members"] = [member_path]
                elif action == "ignore":
                    checkpoint["ignored_members"] = [member_path]
                elif action == "replace_older":
                    assert scenario.get("existing_file_policy") == "replace_older"
            elif event == "partial_write":
                record_extraction_partial_member_outcome(
                    checkpoint,
                    ArchiveExtractionPartialMemberOutcome(step["member_path"], step["target_path"], "partial write"),
                )
            elif event == "report":
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
        plan = ArchiveExtractionExecutionPlan.from_checkpoint(
            checkpoint,
            existing_file_policy=scenario.get("existing_file_policy"),
        )
        assert plan.completed_member_paths() == frozenset(scenario["completed_members"])
        if scenario["terminal_phase"] == "completed":
            assert plan.completion_checkpoint_json(destination_root_created=False)
        for key, value in scenario["progress"].items():
            assert checkpoint.get(key, 0) == value


def test_v1_creation_outcome_conformance_corpus() -> None:
    """Keep normalized creation outcome persistence aligned across executors."""

    corpus: dict[str, Any] = json.loads(CREATION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 1
    for scenario in corpus["scenarios"]:
        checkpoint: dict[str, object] = {}
        if "error" in scenario:
            with pytest.raises(HTTPException):
                for report in scenario["result_reports"]:
                    record_creation_member_outcome(
                        checkpoint,
                        ArchiveCreationMemberOutcome(report["archive_path"], report["status"], report["source_bytes"]),
                    )
            continue
        for report in scenario["result_reports"]:
            record_creation_member_outcome(
                checkpoint,
                ArchiveCreationMemberOutcome(report["archive_path"], report["status"], report["source_bytes"]),
            )
        assert checkpoint["creation_member_outcomes"] == scenario["member_outcomes"]
        for key, value in scenario["progress"].items():
            assert checkpoint[key] == value


def test_v1_creation_manifest_conformance_corpus() -> None:
    """Keep immutable creation manifest validation aligned across executors."""

    corpus: dict[str, Any] = json.loads(CREATION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 1
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


def test_v1_creation_terminal_conformance_corpus() -> None:
    """Keep manifest-backed replay and exact terminal coverage aligned across executors."""

    corpus: dict[str, Any] = json.loads(CREATION_OUTCOME_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 1
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


def test_v1_creation_trajectory_conformance_corpus() -> None:
    """Replay V1 creation trajectories through the immutable manifest and outcome ledger."""

    corpus: dict[str, Any] = json.loads(CREATION_TRAJECTORY_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 1
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
        assert set(checkpoint["creation_member_outcomes"]) == set(scenario["completed_members"])
        if cancelled:
            assert scenario["terminal_phase"] == "cancelled"
        else:
            assert state.terminal_summary().to_checkpoint() == scenario["progress"]
