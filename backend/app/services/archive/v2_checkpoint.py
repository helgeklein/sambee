"""Strict V2 extraction checkpoint envelope validation."""

from __future__ import annotations

import re
from collections.abc import Mapping
from copy import deepcopy
from datetime import datetime, timezone
from uuid import UUID

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
        "delivery_ids",
    }
)
V2_DECISION_FIELDS = frozenset({"collision_actions", "rename_targets", "ignored_members", "retry_members"})
V2_CREATION_CHECKPOINT_FIELDS = frozenset({"version", "manifest", "member_outcomes", "decisions", "pending_decision", "delivery_ids"})
V2_TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
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


def _validate_timestamp(value: object, *, detail: str) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not V2_TIMESTAMP_PATTERN.fullmatch(value):
        raise _invalid_checkpoint(detail)
    try:
        datetime.fromisoformat(f"{value[:-1]}+00:00")
    except ValueError as exc:
        raise _invalid_checkpoint(detail) from exc


def canonical_v2_timestamp(value: datetime | str | None) -> str | None:
    """Serialize metadata timestamps in the one V2 wire representation."""

    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(f"{value[:-1]}+00:00" if value.endswith("Z") else value)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


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


def _validate_pending_decision(value: object, manifest_paths: set[str]) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")
    if value.get("kind") == "existing_files":
        if frozenset(value) != {"kind", "allowed_actions", "conflicts"}:
            raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")
        allowed_actions = value["allowed_actions"]
        conflicts = value["conflicts"]
        valid_actions = {"skip", "skip_all", "replace", "replace_all", "replace_older", "rename", "retry", "ignore", "cancel"}
        if (
            not isinstance(allowed_actions, list)
            or not allowed_actions
            or len(set(allowed_actions)) != len(allowed_actions)
            or any(action not in valid_actions for action in allowed_actions)
            or not isinstance(conflicts, list)
            or not conflicts
        ):
            raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")
        for conflict in conflicts:
            if not isinstance(conflict, dict) or not {"member_path", "target_path", "is_directory"}.issubset(conflict):
                raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")
            if frozenset(conflict) - {
                "member_path",
                "target_path",
                "is_directory",
                "source_size",
                "source_modified_at",
                "target_size",
                "target_modified_at",
            }:
                raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")
            _canonical_member_path(conflict["member_path"])
            if type(conflict["is_directory"]) is not bool:
                raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")
            _canonical_member_path(conflict["target_path"])
            for size_field in ("source_size", "target_size"):
                if size_field in conflict and (type(conflict[size_field]) is not int or conflict[size_field] < 0):
                    raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")
            for timestamp_field in ("source_modified_at", "target_modified_at"):
                if timestamp_field in conflict:
                    _validate_timestamp(conflict[timestamp_field], detail="Archive V2 checkpoint pending decision is invalid")
        return
    if value.get("kind") == "member_error":
        if frozenset(value) != {"kind", "member_path", "target_path", "message", "partial_output", "allowed_actions"}:
            raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")
        if (
            _canonical_member_path(value["member_path"]) not in manifest_paths
            or not isinstance(value["message"], str)
            or not 1 <= len(value["message"]) <= 500
            or type(value["partial_output"]) is not bool
            or value["allowed_actions"] != ["retry", "ignore"]
        ):
            raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")
        _canonical_member_path(value["target_path"])
        return
    raise _invalid_checkpoint("Archive V2 checkpoint pending decision is invalid")


def _validate_delivery_ids(value: object) -> None:
    if not isinstance(value, dict) or len(value) > 1024:
        raise _invalid_checkpoint("Archive V2 checkpoint delivery IDs are invalid")
    for delivery_id, fingerprint in value.items():
        try:
            UUID(delivery_id) if isinstance(delivery_id, str) else None
        except ValueError as exc:
            raise _invalid_checkpoint("Archive V2 checkpoint delivery IDs are invalid") from exc
        if not isinstance(delivery_id, str) or not isinstance(fingerprint, str) or not fingerprint or len(fingerprint) > 4096:
            raise _invalid_checkpoint("Archive V2 checkpoint delivery IDs are invalid")


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
    _validate_timestamp(source_snapshot["modified_at"], detail="Archive V2 checkpoint source snapshot is invalid")
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
        _validate_timestamp(member["modified_at"], detail="Archive V2 checkpoint manifest is invalid")
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
    _validate_pending_decision(pending_decision, manifest_paths)
    _validate_delivery_ids(checkpoint.get("delivery_ids"))
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
            "delivery_ids": {},
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
        _validate_timestamp(member["modified_at"], detail="Archive V2 creation checkpoint manifest is invalid")
        paths.add(path)
    for path, outcome in outcomes.items():
        if _canonical_member_path(path) not in paths or not isinstance(outcome, dict):
            raise _invalid_checkpoint("Archive V2 creation checkpoint member outcomes are invalid")
        if (
            frozenset(outcome) != {"status", "source_bytes"}
            or outcome["status"] not in {"directory", "created"}
            or type(outcome["source_bytes"]) is not int
            or outcome["source_bytes"] < 0
        ):
            raise _invalid_checkpoint("Archive V2 creation checkpoint member outcomes are invalid")
    if checkpoint.get("decisions") != {} or checkpoint.get("pending_decision") is not None:
        raise _invalid_checkpoint("Archive V2 creation checkpoint decisions are invalid")
    _validate_delivery_ids(checkpoint.get("delivery_ids"))
    return deepcopy(checkpoint)


def new_v2_creation_checkpoint(*, manifest: list[dict[str, object]]) -> dict[str, object]:
    """Create the empty strict V2 creation ledger before output begins."""

    return validate_v2_creation_checkpoint(
        {
            "version": V2_CHECKPOINT_VERSION,
            "manifest": manifest,
            "member_outcomes": {},
            "decisions": {},
            "pending_decision": None,
            "delivery_ids": {},
        }
    )
