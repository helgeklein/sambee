"""Strict V2 extraction checkpoint envelope validation."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy

from fastapi import HTTPException, status

V2_CHECKPOINT_VERSION = 2
V2_CHECKPOINT_FIELDS = frozenset(
    {
        "version",
        "manifest",
        "source_snapshot",
        "member_outcomes",
        "decisions",
        "pending_decision",
    }
)
V2_DECISION_FIELDS = frozenset({"collision_actions", "rename_targets", "ignored_members", "retry_members"})
V2_CREATION_CHECKPOINT_FIELDS = frozenset({"version", "manifest", "member_outcomes", "decisions", "pending_decision"})
LEGACY_WRITTEN_MEMBERS_FIELD = "written_members"
V1_CHECKPOINT_FIELDS = frozenset(
    {
        LEGACY_WRITTEN_MEMBERS_FIELD,
        "extraction_outcome_checkpoint_version",
        "archive_manifest",
        "source_identity",
        "files_extracted",
        "directories_created",
        "extracted_bytes",
        "files_skipped",
        "skipped_members",
        "replaced_members",
        "renamed_members",
        "member_collision_actions",
        "member_rename_targets",
        "ignored_members",
        "retry_members",
    }
)


def _invalid_checkpoint(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def _canonical_member_path(value: object) -> str:
    if not isinstance(value, str):
        raise _invalid_checkpoint("Archive V2 checkpoint member path is invalid")
    normalized = value.replace("\\", "/").rstrip("/")
    parts = normalized.split("/")
    if (
        not normalized
        or normalized != value
        or normalized.startswith("/")
        or "\x00" in normalized
        or any(not part or part in {".", ".."} or ":" in part for part in parts)
    ):
        raise _invalid_checkpoint("Archive V2 checkpoint member path is invalid")
    return normalized


def _validate_member_paths(values: object) -> list[str]:
    if not isinstance(values, list):
        raise _invalid_checkpoint("Archive V2 checkpoint member paths are invalid")
    return [_canonical_member_path(value) for value in values]


def _validate_member_outcome(value: object) -> None:
    if not isinstance(value, dict):
        raise _invalid_checkpoint("Archive V2 checkpoint member outcomes are invalid")
    status_value = value.get("status")
    if status_value == "partial":
        if frozenset(value) != {"status", "target_path", "message"} or not isinstance(value["message"], str):
            raise _invalid_checkpoint("Archive V2 checkpoint member outcomes are invalid")
    elif status_value in {"directory", "extracted", "skipped", "ignored"}:
        if frozenset(value) != {"status", "target_path", "extracted_bytes", "directories_created", "replaced", "renamed"}:
            raise _invalid_checkpoint("Archive V2 checkpoint member outcomes are invalid")
        if (
            type(value["extracted_bytes"]) is not int
            or value["extracted_bytes"] < 0
            or type(value["directories_created"]) is not int
            or value["directories_created"] < 0
            or type(value["replaced"]) is not bool
            or type(value["renamed"]) is not bool
        ):
            raise _invalid_checkpoint("Archive V2 checkpoint member outcomes are invalid")
    else:
        raise _invalid_checkpoint("Archive V2 checkpoint member outcomes are invalid")
    _canonical_member_path(value.get("target_path"))


def validate_v2_extraction_checkpoint(checkpoint: object) -> dict[str, object]:
    """Return a defensive V2 envelope copy or reject every legacy/unknown shape."""

    if not isinstance(checkpoint, dict):
        raise _invalid_checkpoint("Archive V2 checkpoint must be an object")
    fields = frozenset(checkpoint)
    if fields & V1_CHECKPOINT_FIELDS:
        raise _invalid_checkpoint("Archive V2 checkpoint contains legacy fields")
    if fields != V2_CHECKPOINT_FIELDS:
        raise _invalid_checkpoint("Archive V2 checkpoint fields are invalid")
    if checkpoint.get("version") != V2_CHECKPOINT_VERSION:
        raise _invalid_checkpoint("Archive V2 checkpoint version is invalid")
    manifest = checkpoint.get("manifest")
    source_snapshot = checkpoint.get("source_snapshot")
    outcomes = checkpoint.get("member_outcomes")
    decisions = checkpoint.get("decisions")
    pending_decision = checkpoint.get("pending_decision")
    if not isinstance(manifest, list) or not isinstance(source_snapshot, dict) or not isinstance(outcomes, dict):
        raise _invalid_checkpoint("Archive V2 checkpoint envelope is invalid")
    if frozenset(source_snapshot) != {"size", "modified_at"} or type(source_snapshot["size"]) is not int or source_snapshot["size"] < 0:
        raise _invalid_checkpoint("Archive V2 checkpoint source snapshot is invalid")
    if source_snapshot["modified_at"] is not None and not isinstance(source_snapshot["modified_at"], str):
        raise _invalid_checkpoint("Archive V2 checkpoint source snapshot is invalid")
    manifest_paths: set[str] = set()
    for member in manifest:
        if not isinstance(member, dict) or frozenset(member) != {"path", "is_directory", "uncompressed_size", "modified_at"}:
            raise _invalid_checkpoint("Archive V2 checkpoint manifest is invalid")
        member_path = _canonical_member_path(member["path"])
        if (
            member_path in manifest_paths
            or type(member["is_directory"]) is not bool
            or type(member["uncompressed_size"]) is not int
            or member["uncompressed_size"] < 0
        ):
            raise _invalid_checkpoint("Archive V2 checkpoint manifest is invalid")
        if member["modified_at"] is not None and not isinstance(member["modified_at"], str):
            raise _invalid_checkpoint("Archive V2 checkpoint manifest is invalid")
        manifest_paths.add(member_path)
    for member_path, outcome in outcomes.items():
        if _canonical_member_path(member_path) not in manifest_paths:
            raise _invalid_checkpoint("Archive V2 checkpoint member outcomes are invalid")
        _validate_member_outcome(outcome)
    if not isinstance(decisions, dict) or frozenset(decisions) != V2_DECISION_FIELDS:
        raise _invalid_checkpoint("Archive V2 checkpoint decisions are invalid")
    collision_actions = decisions["collision_actions"]
    rename_targets = decisions["rename_targets"]
    if not isinstance(collision_actions, dict) or not isinstance(rename_targets, dict):
        raise _invalid_checkpoint("Archive V2 checkpoint decisions are invalid")
    for member_path, action in collision_actions.items():
        if _canonical_member_path(member_path) not in manifest_paths or action not in {"skip", "replace"}:
            raise _invalid_checkpoint("Archive V2 checkpoint decisions are invalid")
    for member_path, target_path in rename_targets.items():
        if _canonical_member_path(member_path) not in manifest_paths:
            raise _invalid_checkpoint("Archive V2 checkpoint decisions are invalid")
        _canonical_member_path(target_path)
    for paths in (decisions["ignored_members"], decisions["retry_members"]):
        if any(member_path not in manifest_paths for member_path in _validate_member_paths(paths)):
            raise _invalid_checkpoint("Archive V2 checkpoint decisions are invalid")
    if pending_decision is not None and not isinstance(pending_decision, dict):
        raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")
    return deepcopy(checkpoint)


def new_v2_extraction_checkpoint(*, manifest: list[dict[str, object]], source_snapshot: Mapping[str, object]) -> dict[str, object]:
    """Create a validated V2 envelope before any extraction output is written."""

    return validate_v2_extraction_checkpoint(
        {
            "version": V2_CHECKPOINT_VERSION,
            "manifest": manifest,
            "source_snapshot": dict(source_snapshot),
            "member_outcomes": {},
            "decisions": {
                "collision_actions": {},
                "rename_targets": {},
                "ignored_members": [],
                "retry_members": [],
            },
            "pending_decision": None,
        }
    )


def legacy_execution_checkpoint_from_v2(checkpoint: object) -> dict[str, object]:
    """Project persisted V2 state into the executor's private compatibility shape."""

    validated = validate_v2_extraction_checkpoint(checkpoint)
    decisions = validated["decisions"]
    if not isinstance(decisions, dict):
        raise _invalid_checkpoint("Archive V2 checkpoint decisions are invalid")
    return {
        "extraction_outcome_checkpoint_version": 1,
        "archive_manifest": validated["manifest"],
        "source_identity": validated["source_snapshot"],
        "member_outcomes": validated["member_outcomes"],
        "member_collision_actions": decisions["collision_actions"],
        "member_rename_targets": decisions["rename_targets"],
        "ignored_members": decisions["ignored_members"],
        "retry_members": decisions["retry_members"],
        "pending_decision": validated["pending_decision"],
    }


def v2_checkpoint_from_legacy_execution(checkpoint: object) -> dict[str, object]:
    """Strip executor-only fields before an extraction checkpoint is persisted."""

    if not isinstance(checkpoint, dict):
        raise _invalid_checkpoint("Archive V2 checkpoint must be an object")
    return validate_v2_extraction_checkpoint(
        {
            "version": V2_CHECKPOINT_VERSION,
            "manifest": checkpoint.get("archive_manifest"),
            "source_snapshot": checkpoint.get("source_identity"),
            "member_outcomes": checkpoint.get("member_outcomes", {}),
            "decisions": {
                "collision_actions": checkpoint.get("member_collision_actions", {}),
                "rename_targets": checkpoint.get("member_rename_targets", {}),
                "ignored_members": checkpoint.get("ignored_members", []),
                "retry_members": checkpoint.get("retry_members", []),
            },
            "pending_decision": checkpoint.get("pending_decision"),
        }
    )


def validate_v2_creation_checkpoint(checkpoint: object) -> dict[str, object]:
    """Validate the closed V2 creation ledger without accepting V1 state."""

    if not isinstance(checkpoint, dict) or frozenset(checkpoint) != V2_CREATION_CHECKPOINT_FIELDS:
        raise _invalid_checkpoint("Archive V2 creation checkpoint fields are invalid")
    if checkpoint.get("version") != V2_CHECKPOINT_VERSION:
        raise _invalid_checkpoint("Archive V2 creation checkpoint version is invalid")
    manifest = checkpoint.get("manifest")
    outcomes = checkpoint.get("member_outcomes")
    if not isinstance(manifest, list) or not isinstance(outcomes, dict):
        raise _invalid_checkpoint("Archive V2 creation checkpoint envelope is invalid")
    paths: set[str] = set()
    for member in manifest:
        if not isinstance(member, dict) or frozenset(member) != {
            "archive_path",
            "is_directory",
            "source_size",
            "source_path",
            "modified_at",
        }:
            raise _invalid_checkpoint("Archive V2 creation checkpoint manifest is invalid")
        path = _canonical_member_path(member["archive_path"])
        if path in paths or type(member["is_directory"]) is not bool or type(member["source_size"]) is not int or member["source_size"] < 0:
            raise _invalid_checkpoint("Archive V2 creation checkpoint manifest is invalid")
        if member["source_path"] is not None and not isinstance(member["source_path"], str):
            raise _invalid_checkpoint("Archive V2 creation checkpoint manifest is invalid")
        if member["modified_at"] is not None and not isinstance(member["modified_at"], str):
            raise _invalid_checkpoint("Archive V2 creation checkpoint manifest is invalid")
        paths.add(path)
    if any(_canonical_member_path(path) not in paths or not isinstance(outcome, dict) for path, outcome in outcomes.items()):
        raise _invalid_checkpoint("Archive V2 creation checkpoint member outcomes are invalid")
    if checkpoint.get("decisions") != {} or checkpoint.get("pending_decision") is not None:
        raise _invalid_checkpoint("Archive V2 creation checkpoint decisions are invalid")
    return deepcopy(checkpoint)


def new_v2_creation_checkpoint(*, manifest: list[dict[str, object]]) -> dict[str, object]:
    """Create the empty strict V2 creation ledger before output begins."""

    return validate_v2_creation_checkpoint(
        {"version": V2_CHECKPOINT_VERSION, "manifest": manifest, "member_outcomes": {}, "decisions": {}, "pending_decision": None}
    )


def legacy_creation_execution_checkpoint_from_v2(checkpoint: object) -> dict[str, object]:
    """Project a V2 creation ledger only for the established executor."""

    validated = validate_v2_creation_checkpoint(checkpoint)
    manifest = validated["manifest"]
    if not isinstance(manifest, list):
        raise _invalid_checkpoint("Archive V2 creation checkpoint manifest is invalid")
    return {
        "creation_outcome_checkpoint_version": 1,
        "source_manifest": [
            {
                **({"source_path": member["source_path"]} if member["source_path"] is not None else {}),
                "archive_path": member["archive_path"],
                "is_directory": member["is_directory"],
                "source_identity": {"size": member["source_size"], "modified_at": member["modified_at"]},
            }
            for member in manifest
            if isinstance(member, dict)
        ],
        "creation_member_outcomes": validated["member_outcomes"],
    }


def v2_creation_checkpoint_from_legacy_execution(checkpoint: object) -> dict[str, object]:
    """Remove executor counters and V1 names before persisting V2 creation state."""

    if not isinstance(checkpoint, dict) or not isinstance(checkpoint.get("source_manifest"), list):
        raise _invalid_checkpoint("Archive V2 creation checkpoint is invalid")
    manifest = [
        {
            "archive_path": entry.get("archive_path"),
            "is_directory": entry.get("is_directory"),
            "source_size": entry.get("source_identity", {}).get("size") if isinstance(entry.get("source_identity"), dict) else None,
            "source_path": entry.get("source_path"),
            "modified_at": entry.get("source_identity", {}).get("modified_at") if isinstance(entry.get("source_identity"), dict) else None,
        }
        for entry in checkpoint["source_manifest"]
        if isinstance(entry, dict)
    ]
    return validate_v2_creation_checkpoint(
        {
            "version": V2_CHECKPOINT_VERSION,
            "manifest": manifest,
            "member_outcomes": checkpoint.get("creation_member_outcomes", {}),
            "decisions": {},
            "pending_decision": None,
        }
    )
