"""Strict V2 archive checkpoint contract tests."""

import pytest
from fastapi import HTTPException

from app.services.archive.v2_checkpoint import (
    new_v2_creation_checkpoint,
    new_v2_extraction_checkpoint,
    validate_v2_creation_checkpoint,
    validate_v2_extraction_checkpoint,
)


def valid_checkpoint() -> dict[str, object]:
    return new_v2_extraction_checkpoint(
        manifest=[{"path": "docs/readme.txt", "is_directory": False, "uncompressed_size": 7, "modified_at": None}],
        source_snapshot={"size": 7, "modified_at": None},
    )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda checkpoint: checkpoint.pop("version"),
        lambda checkpoint: checkpoint.__setitem__("written_members", []),
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


def test_v2_checkpoint_rejects_noncanonical_member_paths() -> None:
    checkpoint = valid_checkpoint()
    checkpoint["manifest"] = [{"path": "docs\\readme.txt", "is_directory": False, "uncompressed_size": 7, "modified_at": None}]
    with pytest.raises(HTTPException, match="member path"):
        validate_v2_extraction_checkpoint(checkpoint)


def test_v2_checkpoint_returns_a_defensive_validated_copy() -> None:
    checkpoint = valid_checkpoint()
    validated = validate_v2_extraction_checkpoint(checkpoint)
    assert validated == checkpoint
    assert validated is not checkpoint


def test_v2_checkpoint_rejects_legacy_executor_fields() -> None:
    checkpoint = valid_checkpoint()
    checkpoint["files_extracted"] = 1
    with pytest.raises(HTTPException, match="legacy fields"):
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
