"""Strict V2 archive checkpoint contract tests."""

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.services.archive.v2_checkpoint import (
    canonical_v2_timestamp,
    new_v2_creation_checkpoint,
    new_v2_extraction_checkpoint,
    validate_v2_creation_checkpoint,
    validate_v2_extraction_checkpoint,
)

INVALID_CHECKPOINTS_PATH = Path(__file__).resolve().parents[2] / "archive-contract" / "v2" / "fixtures" / "invalid-checkpoints-v2.json"


def test_canonical_v2_timestamp_uses_utc_z_suffix() -> None:
    assert canonical_v2_timestamp(datetime(2026, 8, 30, 12, 34, 56, tzinfo=timezone.utc)) == "2026-08-30T12:34:56Z"


def valid_checkpoint() -> dict[str, object]:
    return new_v2_extraction_checkpoint(
        manifest=[{"path": "docs/readme.txt", "is_directory": False, "uncompressed_size": 7, "modified_at": None}],
        source_snapshot={"size": 7, "modified_at": None},
    )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda checkpoint: checkpoint.pop("version"),
        lambda checkpoint: checkpoint.__setitem__("files_extracted", 0),
        lambda checkpoint: checkpoint.__setitem__("unexpected", True),
        lambda checkpoint: checkpoint.__setitem__("version", 1),
    ],
)
def test_v2_checkpoint_rejects_legacy_unknown_and_unversioned_shapes(mutate) -> None:
    checkpoint = valid_checkpoint()
    mutate(checkpoint)
    with pytest.raises(HTTPException, match="Archive V2 checkpoint"):
        validate_v2_extraction_checkpoint(checkpoint)


def test_v2_checkpoint_rejects_all_invalid_fixture_cases() -> None:
    fixture = json.loads(INVALID_CHECKPOINTS_PATH.read_text(encoding="utf-8"))
    assert fixture["version"] == 2

    for case in fixture["cases"]:
        with pytest.raises(HTTPException, match="Archive V2 checkpoint"):
            validate_v2_extraction_checkpoint(case["checkpoint"])


def test_v2_checkpoint_rejects_noncanonical_member_paths() -> None:
    checkpoint = valid_checkpoint()
    checkpoint["manifest"] = [{"path": "docs\\readme.txt", "is_directory": False, "uncompressed_size": 7, "modified_at": None}]
    with pytest.raises(HTTPException, match="member path"):
        validate_v2_extraction_checkpoint(checkpoint)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda checkpoint: checkpoint["source_snapshot"].__setitem__("modified_at", "not-a-timestamp"),  # type: ignore[index,union-attr]
        lambda checkpoint: checkpoint.__setitem__("pending_decision", {}),
        lambda checkpoint: checkpoint.__setitem__(
            "pending_decision",
            {"kind": "existing_files", "allowed_actions": ["skip"], "conflicts": []},
        ),
    ],
)
def test_v2_checkpoint_rejects_invalid_canonical_nested_values(mutate) -> None:
    checkpoint = valid_checkpoint()
    mutate(checkpoint)

    with pytest.raises(HTTPException, match="Archive V2 checkpoint"):
        validate_v2_extraction_checkpoint(checkpoint)


def test_v2_checkpoint_returns_a_defensive_validated_copy() -> None:
    checkpoint = valid_checkpoint()
    validated = validate_v2_extraction_checkpoint(checkpoint)
    assert validated == checkpoint
    assert validated is not checkpoint


def test_v2_checkpoint_rejects_disallowed_executor_fields() -> None:
    checkpoint = valid_checkpoint()
    checkpoint["files_extracted"] = 1
    with pytest.raises(HTTPException, match="disallowed fields"):
        validate_v2_extraction_checkpoint(checkpoint)


def test_v2_creation_checkpoint_rejects_aggregate_counters() -> None:
    checkpoint = new_v2_creation_checkpoint(
        manifest=[
            {
                "archive_path": "report.txt",
                "is_directory": False,
                "source_size": 4,
                "source_path": "report.txt",
                "modified_at": None,
            }
        ]
    )

    checkpoint["files_created"] = 1
    with pytest.raises(HTTPException, match="fields are invalid"):
        validate_v2_creation_checkpoint(checkpoint)


def test_v2_creation_checkpoint_rejects_malformed_member_outcomes() -> None:
    checkpoint = new_v2_creation_checkpoint(
        manifest=[
            {
                "archive_path": "report.txt",
                "is_directory": False,
                "source_size": 4,
                "source_path": "report.txt",
                "modified_at": None,
            }
        ]
    )
    checkpoint["member_outcomes"] = {"report.txt": {}}

    with pytest.raises(HTTPException, match="member outcomes are invalid"):
        validate_v2_creation_checkpoint(checkpoint)
