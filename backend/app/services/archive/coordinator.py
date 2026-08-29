"""Common coordinator lifecycle for archive execution bindings."""

import json
import unicodedata
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from types import MappingProxyType
from typing import Protocol

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.archive_operation import ArchiveOperation, ArchiveOperationPhase
from app.services.archive.creation import ArchiveCreationCancelled, ArchiveCreationMemberOutcome, ArchiveCreationResult
from app.services.archive.execution import ArchiveExecutionDriver, ArchiveInspectionTopologyPlan
from app.services.archive.extraction import (
    ArchiveExtractionCancelled,
    ArchiveExtractionConflict,
    ArchiveExtractionConflicts,
    ArchiveExtractionDestinationResult,
    ArchiveExtractionMemberError,
    ArchiveExtractionProgress,
    ArchiveExtractionResult,
)
from app.services.archive.operations import (
    await_operation_decision,
    fail_operation,
    heartbeat_operation,
    update_operation_checkpoint,
    update_operation_phase,
)
from app.services.archive.zip_reader import (
    ArchiveInspectionDirectoryPage,
    ArchiveInspectionManifest,
    ArchiveInspectionManifestMember,
)

ArchiveExtractionRunner = Callable[
    ["ArchiveExtractionExecutionPlan", Callable[[ArchiveExtractionDestinationResult], Awaitable[None]], Callable[[], Awaitable[bool]]],
    Awaitable[ArchiveExtractionResult],
]
ArchiveCreationRunner = Callable[
    [Callable[[ArchiveCreationMemberOutcome], Awaitable[None]], Callable[[], Awaitable[bool]]],
    Awaitable[ArchiveCreationResult],
]
_EXTRACTION_MEMBER_OUTCOME_STATUSES = frozenset({"directory", "extracted", "skipped", "ignored", "partial"})
_CREATION_MEMBER_OUTCOME_STATUSES = frozenset({"directory", "created"})
EXTRACTION_OUTCOME_CHECKPOINT_VERSION = 1
_EXTRACTION_OUTCOME_CHECKPOINT_VERSION_KEY = "extraction_outcome_checkpoint_version"
CREATION_OUTCOME_CHECKPOINT_VERSION = 1
_CREATION_OUTCOME_CHECKPOINT_VERSION_KEY = "creation_outcome_checkpoint_version"


def _validate_archive_member_hierarchy(
    members: list[tuple[str, bool]],
    *,
    error_message: str,
) -> None:
    """Reject normalized duplicate members and file/directory path collisions."""

    member_path_keys: set[str] = set()
    file_path_keys: set[str] = set()
    directory_path_keys: set[str] = set()
    for member_path, is_directory in members:
        member_path_key = unicodedata.normalize("NFC", member_path).casefold()
        if member_path_key in member_path_keys:
            raise ValueError(error_message)
        member_path_keys.add(member_path_key)
        path_parts = member_path.split("/")
        directory_part_count = len(path_parts) if is_directory else len(path_parts) - 1
        for index in range(1, directory_part_count + 1):
            directory_path_keys.add(unicodedata.normalize("NFC", "/".join(path_parts[:index])).casefold())
        if not is_directory:
            file_path_keys.add(member_path_key)
    if not file_path_keys.isdisjoint(directory_path_keys):
        raise ValueError(error_message)


class ArchiveExecutionStateStore(Protocol):
    """Persist coordinator lifecycle mutations for one archive execution binding."""

    def transition(
        self,
        operation: ArchiveOperation,
        *,
        expected_phase: ArchiveOperationPhase,
        next_phase: ArchiveOperationPhase,
        additional_changes: dict[str, object] | None = None,
    ) -> ArchiveOperation: ...

    def update_checkpoint(self, operation: ArchiveOperation, checkpoint_json: str) -> ArchiveOperation: ...

    def await_decision(self, operation: ArchiveOperation, decision: dict[str, object]) -> ArchiveOperation: ...

    def fail(self, operation: ArchiveOperation, message: str) -> ArchiveOperation: ...

    def cancellation_requested(self, operation: ArchiveOperation) -> bool: ...

    def heartbeat(self, operation: ArchiveOperation) -> None: ...

    def apply_extraction_decision(
        self,
        operation: ArchiveOperation,
        action: str,
        member_path: str | None,
        target_path: str | None,
    ) -> ArchiveOperation: ...

    async def is_cancelled(self, operation: ArchiveOperation) -> bool: ...


class ArchiveInspectionSource(Protocol):
    """Provide a normalized manifest for one request-scoped archive inspection."""

    async def inspection_manifest(self) -> ArchiveInspectionManifest: ...


class ArchiveInspectionPresentation(StrEnum):
    """Existing V1 response projection selected for one inspection request."""

    DIRECTORY_LISTING = "directory_listing"
    MEMBER_READ = "member_read"


@dataclass(frozen=True)
class ArchiveInspectionPlan:
    """Immutable, non-durable source binding for one archive inspection request."""

    source: ArchiveInspectionSource
    topology: ArchiveInspectionTopologyPlan
    presentation: ArchiveInspectionPresentation


@dataclass(frozen=True)
class ArchiveInspectionCoordinator:
    """Resolve a request-scoped inspection plan without owning transport or HTTP projection."""

    plan: ArchiveInspectionPlan

    async def manifest(self) -> ArchiveInspectionManifest:
        """Load the normalized inspection manifest through the bound source adapter."""

        return await self.plan.source.inspection_manifest()

    async def list_directory(
        self,
        path: str,
        cursor: str | None,
        page_size: int,
    ) -> ArchiveInspectionDirectoryPage:
        """List one bounded archive directory page from the normalized manifest."""

        if self.plan.presentation != ArchiveInspectionPresentation.DIRECTORY_LISTING:
            raise ValueError("Archive inspection plan does not support a directory-listing response")
        return (await self.manifest()).list_directory(path, cursor, page_size)

    async def member(self, path: str) -> ArchiveInspectionManifestMember:
        """Resolve one read-eligible archive member from the normalized manifest."""

        if self.plan.presentation != ArchiveInspectionPresentation.MEMBER_READ:
            raise ValueError("Archive inspection plan does not support a member-read response")
        return (await self.manifest()).member(path)


def resolve_archive_inspection_coordinator(plan: ArchiveInspectionPlan) -> ArchiveInspectionCoordinator:
    """Construct the backend coordinator only for an SMB-owned inspection plan."""

    if plan.topology.driver != ArchiveExecutionDriver.BACKEND or plan.topology.source_is_local:
        raise ValueError("Archive inspection topology did not resolve to a compatible backend binding")
    return ArchiveInspectionCoordinator(plan)


@dataclass(frozen=True)
class DurableArchiveExecutionStateStore:
    """Bind coordinator lifecycle calls to the durable audited operation store."""

    session: Session

    def transition(
        self,
        operation: ArchiveOperation,
        *,
        expected_phase: ArchiveOperationPhase,
        next_phase: ArchiveOperationPhase,
        additional_changes: dict[str, object] | None = None,
    ) -> ArchiveOperation:
        return update_operation_phase(
            self.session,
            operation,
            expected_phase=expected_phase,
            next_phase=next_phase,
            additional_changes=additional_changes,
        )

    def update_checkpoint(self, operation: ArchiveOperation, checkpoint_json: str) -> ArchiveOperation:
        return update_operation_checkpoint(self.session, operation, checkpoint_json)

    def await_decision(self, operation: ArchiveOperation, decision: dict[str, object]) -> ArchiveOperation:
        return await_operation_decision(self.session, operation, decision)

    def fail(self, operation: ArchiveOperation, message: str) -> ArchiveOperation:
        return fail_operation(self.session, operation, message)

    def cancellation_requested(self, operation: ArchiveOperation) -> bool:
        self.session.refresh(operation)
        return operation.cancellation_requested

    def heartbeat(self, operation: ArchiveOperation) -> None:
        heartbeat_operation(self.session, operation)

    def apply_extraction_decision(
        self,
        operation: ArchiveOperation,
        action: str,
        member_path: str | None,
        target_path: str | None,
    ) -> ArchiveOperation:
        """Apply a durable decision through the existing atomic audited mutation."""

        from app.services.archive.operations import apply_existing_file_decision

        return apply_existing_file_decision(self.session, operation, action, member_path, target_path)

    async def is_cancelled(self, operation: ArchiveOperation) -> bool:
        if self.cancellation_requested(operation):
            return True
        self.heartbeat(operation)
        return False


@dataclass
class InMemoryArchiveExecutionStateStore:
    """Provide deterministic non-durable lifecycle state for coordinator tests."""

    transitions: list[tuple[ArchiveOperationPhase, ArchiveOperationPhase]] = field(default_factory=list)

    def transition(
        self,
        operation: ArchiveOperation,
        *,
        expected_phase: ArchiveOperationPhase,
        next_phase: ArchiveOperationPhase,
        additional_changes: dict[str, object] | None = None,
    ) -> ArchiveOperation:
        if operation.phase != expected_phase:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Archive operation phase does not match the requested transition"
            )
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

    def apply_extraction_decision(
        self,
        operation: ArchiveOperation,
        action: str,
        member_path: str | None,
        target_path: str | None,
    ) -> ArchiveOperation:
        """Apply an in-memory decision for deterministic coordinator execution."""

        if operation.phase != ArchiveOperationPhase.AWAITING_USER_DECISION:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not awaiting a decision")
        checkpoint = load_archive_checkpoint(operation)
        if action in {"skip", "replace"}:
            if not isinstance(member_path, str):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member decision requires a pending member"
                )
            member_collision_actions = checkpoint.setdefault("member_collision_actions", {})
            if not isinstance(member_collision_actions, dict):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
            member_collision_actions[member_path] = action
        elif action == "rename":
            if not isinstance(member_path, str) or not isinstance(target_path, str):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive rename target path is invalid")
            member_rename_targets = checkpoint.setdefault("member_rename_targets", {})
            if not isinstance(member_rename_targets, dict):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
            member_rename_targets[member_path] = target_path
        elif action == "retry":
            if not isinstance(member_path, str):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member error decision is not allowed"
                )
            checkpoint["retry_members"] = [member_path]
        elif action == "ignore":
            if not isinstance(member_path, str):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member error decision is not allowed"
                )
            checkpoint["ignored_members"] = [member_path]
        elif action not in {"skip_all", "replace_all", "replace_older"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive operation decision is not allowed")
        operation.checkpoint_json = json.dumps(checkpoint)
        operation.collision_policy = action if action in {"skip_all", "replace_all", "replace_older"} else operation.collision_policy
        operation.pending_decision_json = None
        operation.phase = ArchiveOperationPhase.STREAMING
        return operation

    async def is_cancelled(self, operation: ArchiveOperation) -> bool:
        return operation.cancellation_requested


def load_archive_checkpoint(operation: ArchiveOperation) -> dict[str, object]:
    """Load one durable archive checkpoint without accepting malformed state."""

    try:
        checkpoint = json.loads(operation.checkpoint_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
    if not isinstance(checkpoint, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    return checkpoint


@dataclass(frozen=True)
class ArchiveExtractionDecisionState:
    """Validated extraction choices persisted in an operation checkpoint."""

    _member_collision_actions: dict[str, str]
    _member_rename_targets: dict[str, str]
    _ignored_members: list[str]
    _retry_members: list[str]

    @classmethod
    def from_checkpoint(cls, checkpoint: dict[str, object]) -> "ArchiveExtractionDecisionState":
        member_collision_actions = checkpoint.get("member_collision_actions", {})
        member_rename_targets = checkpoint.get("member_rename_targets", {})
        ignored_members = checkpoint.get("ignored_members", [])
        retry_members = checkpoint.get("retry_members", [])
        if (
            not isinstance(member_collision_actions, dict)
            or not all(isinstance(member_path, str) and isinstance(action, str) for member_path, action in member_collision_actions.items())
            or not isinstance(member_rename_targets, dict)
            or not all(
                isinstance(member_path, str) and isinstance(target_path, str) for member_path, target_path in member_rename_targets.items()
            )
            or not isinstance(ignored_members, list)
            or not all(isinstance(member_path, str) for member_path in ignored_members)
            or not isinstance(retry_members, list)
            or not all(isinstance(member_path, str) for member_path in retry_members)
        ):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        return cls(member_collision_actions, member_rename_targets, ignored_members, retry_members)

    def collision_actions_for_execution(self) -> dict[str, str]:
        """Return valid per-member collision choices for a direct extractor."""

        if not all(member_path and action in {"skip", "replace"} for member_path, action in self._member_collision_actions.items()):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        return dict(self._member_collision_actions)

    def collision_action(self, member_path: str, default_action: str | None) -> str | None:
        """Resolve one member's collision action against the operation default."""

        return self.collision_actions_for_execution().get(member_path, default_action)

    def rename_targets(self) -> dict[str, str]:
        """Return a copy of persisted member rename targets for structural validation."""

        return dict(self._member_rename_targets)

    def target_member_path(self, member_path: str) -> str:
        """Return one persisted member target or its original relative path."""

        return self._member_rename_targets.get(member_path, member_path)

    def ignored_member_paths(self) -> list[str]:
        """Return validated members that were explicitly ignored after an error."""

        if not all(self._ignored_members):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        return list(self._ignored_members)

    def retry_members_after_completion(self, member_path: str) -> list[str]:
        """Return retry state after one member obtains a terminal outcome."""

        return [retry_member for retry_member in self._retry_members if retry_member != member_path]


@dataclass(frozen=True)
class ArchiveExtractionManifestMember:
    """One immutable ZIP member expected by the local extraction relay."""

    member_path: str
    is_directory: bool
    uncompressed_size: int
    source_modified_at: str | None


@dataclass(frozen=True)
class ArchiveExtractionManifest:
    """Validated immutable ZIP manifest shared by the SMB-to-local relay."""

    members: tuple[ArchiveExtractionManifestMember, ...]
    _member_index: Mapping[str, ArchiveExtractionManifestMember] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        member_index = {member.member_path: member for member in self.members}
        if len(member_index) != len(self.members):
            raise ValueError("Archive extraction manifest is invalid")
        object.__setattr__(self, "_member_index", MappingProxyType(member_index))

    @classmethod
    def from_members(cls, members: list[ArchiveExtractionManifestMember]) -> "ArchiveExtractionManifest":
        """Normalize and validate preflight ZIP members before relay output begins."""

        try:
            return cls(cls._validate_members(members, normalize_member_paths=True))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive extraction manifest is invalid") from exc

    @classmethod
    def from_checkpoint(cls, checkpoint: dict[str, object]) -> "ArchiveExtractionManifest":
        """Load a strict immutable extraction manifest from durable state."""

        archive_manifest = checkpoint.get("archive_manifest")
        if not isinstance(archive_manifest, list):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        try:
            members = []
            for entry in archive_manifest:
                if not isinstance(entry, dict):
                    raise ValueError
                member_path = entry.get("path")
                is_directory = entry.get("is_directory")
                uncompressed_size = entry.get("uncompressed_size")
                source_modified_at = entry.get("modified_at")
                if (
                    not isinstance(member_path, str)
                    or type(is_directory) is not bool
                    or type(uncompressed_size) is not int
                    or uncompressed_size < 0
                    or (source_modified_at is not None and not isinstance(source_modified_at, str))
                ):
                    raise ValueError
                members.append(ArchiveExtractionManifestMember(member_path, is_directory, uncompressed_size, source_modified_at))
            return cls(cls._validate_members(members, normalize_member_paths=False))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc

    @staticmethod
    def _validate_members(
        members: list[ArchiveExtractionManifestMember], *, normalize_member_paths: bool
    ) -> tuple[ArchiveExtractionManifestMember, ...]:
        validated_members: list[ArchiveExtractionManifestMember] = []
        for member in members:
            normalized_member_path = _normalize_extraction_manifest_path(member.member_path)
            if not normalize_member_paths and normalized_member_path != member.member_path:
                raise ValueError
            validated_members.append(
                ArchiveExtractionManifestMember(
                    normalized_member_path,
                    member.is_directory,
                    member.uncompressed_size,
                    member.source_modified_at,
                )
            )
        _validate_archive_member_hierarchy(
            [(member.member_path, member.is_directory) for member in validated_members],
            error_message="Archive extraction manifest is invalid",
        )
        return tuple(validated_members)

    def member(self, member_path: str, *, is_directory: bool | None = None) -> ArchiveExtractionManifestMember:
        """Return one approved member without accepting arbitrary executor paths."""

        try:
            normalized_member_path = _normalize_extraction_manifest_path(member_path)
        except (AttributeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Archive member is invalid or unavailable",
            ) from exc
        member = self._member_index.get(normalized_member_path)
        if member is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member is invalid or unavailable")
        if is_directory is not None and member.is_directory is not is_directory:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member type is invalid")
        return member

    def checkpoint_entries(self) -> list[dict[str, object]]:
        """Serialize the immutable manifest into the durable relay checkpoint."""

        return [
            {
                "path": member.member_path,
                "is_directory": member.is_directory,
                "uncompressed_size": member.uncompressed_size,
                "modified_at": member.source_modified_at,
            }
            for member in self.members
        ]


def new_extraction_outcome_checkpoint(
    *,
    directories_created: int = 0,
    manifest: ArchiveExtractionManifest | None = None,
    source_identity: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Build the versioned V1 extraction ledger before any destination member commits."""

    if directories_created < 0:
        raise ValueError("Initial extraction directory count cannot be negative")
    checkpoint: dict[str, object] = {
        "files_extracted": 0,
        "directories_created": directories_created,
        "extracted_bytes": 0,
        _EXTRACTION_OUTCOME_CHECKPOINT_VERSION_KEY: EXTRACTION_OUTCOME_CHECKPOINT_VERSION,
        "member_outcomes": {},
    }
    if source_identity is not None:
        checkpoint["source_identity"] = dict(source_identity)
    if manifest is not None:
        checkpoint["archive_manifest"] = manifest.checkpoint_entries()
    return checkpoint


def _normalize_extraction_manifest_path(member_path: str) -> str:
    normalized = member_path.replace("\\", "/").rstrip("/")
    parts = normalized.split("/")
    if (
        not normalized
        or normalized.startswith("/")
        or "\x00" in normalized
        or any(not part or part in {".", ".."} or ":" in part for part in parts)
    ):
        raise ValueError
    return normalized


@dataclass(frozen=True)
class ArchiveExtractionExecutionState:
    """Validated outcome and decision projection for one extraction checkpoint."""

    checkpoint: dict[str, object]
    decisions: ArchiveExtractionDecisionState

    @classmethod
    def from_checkpoint(cls, checkpoint: dict[str, object]) -> "ArchiveExtractionExecutionState":
        """Load one extraction checkpoint for a coordinator or direct execution binding."""

        return cls(checkpoint, ArchiveExtractionDecisionState.from_checkpoint(checkpoint))

    def completed_member_paths(self) -> frozenset[str]:
        """Return terminal member paths from this validated checkpoint projection."""

        return frozenset(completed_extraction_member_paths(self.checkpoint))

    def has_complete_terminal_coverage(self, expected_member_paths: set[str]) -> bool:
        """Return whether every expected member has a terminal durable outcome."""

        return self.completed_member_paths() == expected_member_paths


@dataclass(frozen=True)
class ArchiveExtractionState:
    """Validated immutable manifest and common execution projection for one checkpoint."""

    execution: ArchiveExtractionExecutionState
    manifest: ArchiveExtractionManifest

    @property
    def checkpoint(self) -> dict[str, object]:
        """Return the durable checkpoint used to build this projection."""

        return self.execution.checkpoint

    @property
    def decisions(self) -> ArchiveExtractionDecisionState:
        """Return validated persisted extraction decisions."""

        return self.execution.decisions

    @classmethod
    def from_checkpoint(cls, checkpoint: dict[str, object]) -> "ArchiveExtractionState":
        """Load immutable manifest and shared execution state from one checkpoint."""

        return cls(
            ArchiveExtractionExecutionState.from_checkpoint(checkpoint),
            ArchiveExtractionManifest.from_checkpoint(checkpoint),
        )

    def member(self, member_path: str, *, is_directory: bool | None = None) -> ArchiveExtractionManifestMember:
        """Return one approved immutable extraction member."""

        return self.manifest.member(member_path, is_directory=is_directory)

    def target_member_path(self, member_path: str) -> str:
        """Return the decided local-relative output member path."""

        member = self.member(member_path)
        target_member_path = self.decisions.target_member_path(member.member_path)
        try:
            return _normalize_extraction_manifest_path(target_member_path)
        except (AttributeError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc

    def has_complete_terminal_coverage(self) -> bool:
        """Return whether every immutable member has one terminal durable outcome."""

        return self.execution.has_complete_terminal_coverage({member.member_path for member in self.manifest.members})

    def completion_checkpoint_json(self, *, destination_root_created: bool) -> str:
        """Validate terminal coverage and serialize the final extraction checkpoint."""

        if not self.has_complete_terminal_coverage():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation has unfinished members")
        current_directories_created = self.checkpoint.get("directories_created", 0)
        if type(current_directories_created) is not int or current_directories_created < 0:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        ledger_directories_created = extraction_outcome_summary(self.checkpoint, 0).directories_created
        root_directories_created = current_directories_created - ledger_directories_created
        if root_directories_created < 0:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        summary = extraction_outcome_summary(self.checkpoint, root_directories_created + int(destination_root_created))
        summary.write_to(self.checkpoint, preserve_absent_zero=False)
        outcomes = _extraction_member_outcomes(self.checkpoint, migrate_legacy_members=False)
        self.checkpoint["skipped_members"] = [
            member_path
            for member_path, outcome in outcomes.items()
            if isinstance(outcome, dict) and outcome.get("status") in {"skipped", "ignored"}
        ]
        self.checkpoint["replaced_members"] = [
            member_path for member_path, outcome in outcomes.items() if isinstance(outcome, dict) and outcome.get("replaced") is True
        ]
        self.checkpoint["renamed_members"] = [
            member_path for member_path, outcome in outcomes.items() if isinstance(outcome, dict) and outcome.get("renamed") is True
        ]
        return json.dumps(self.checkpoint)


@dataclass(frozen=True)
class ArchiveExtractionExecutionPlan:
    """Immutable manifest plus persisted decisions consumed by every extraction executor."""

    manifest: ArchiveExtractionManifest
    execution: ArchiveExtractionExecutionState
    existing_file_policy: str | None

    @classmethod
    def from_checkpoint(
        cls,
        checkpoint: dict[str, object],
        *,
        existing_file_policy: str | None = None,
    ) -> "ArchiveExtractionExecutionPlan":
        if existing_file_policy not in {None, "skip_all", "replace_all", "replace_older"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation collision policy is invalid")
        state = ArchiveExtractionState.from_checkpoint(checkpoint)
        return cls(state.manifest, state.execution, existing_file_policy)

    def completed_member_paths(self) -> frozenset[str]:
        return self.execution.completed_member_paths()

    def collision_actions(self) -> dict[str, str]:
        return self.execution.decisions.collision_actions_for_execution()

    def rename_targets(self) -> dict[str, str]:
        return self.execution.decisions.rename_targets()

    def ignored_member_paths(self) -> list[str]:
        return self.execution.decisions.ignored_member_paths()

    def member(self, member_path: str, *, is_directory: bool | None = None) -> ArchiveExtractionManifestMember:
        return self.manifest.member(member_path, is_directory=is_directory)

    def target_member_path(self, member_path: str) -> str:
        return ArchiveExtractionState(self.execution, self.manifest).target_member_path(member_path)

    def collision_action(self, member_path: str) -> str | None:
        return self.execution.decisions.collision_action(member_path, self.existing_file_policy)

    def completion_checkpoint_json(self, *, destination_root_created: bool) -> str:
        return ArchiveExtractionState(self.execution, self.manifest).completion_checkpoint_json(
            destination_root_created=destination_root_created
        )


@dataclass(frozen=True)
class ArchiveExtractionPartialMemberOutcome:
    """One nonterminal member output that may be retried or explicitly ignored."""

    member_path: str
    target_path: str
    message: str


def record_extraction_partial_member_outcome(checkpoint: dict[str, object], outcome: ArchiveExtractionPartialMemberOutcome) -> None:
    """Record a retryable partial output without allowing it to replace a terminal result."""

    outcomes = _extraction_member_outcomes(checkpoint, migrate_legacy_members=True)
    existing_outcome = outcomes.get(outcome.member_path)
    if existing_outcome is not None:
        if not isinstance(existing_outcome, dict):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        if existing_outcome.get("status") != "partial":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive member outcome conflicts with its checkpoint")
    outcomes[outcome.member_path] = {
        "status": "partial",
        "target_path": outcome.target_path,
        "message": outcome.message,
    }


def persist_extraction_partial_member_outcome(
    state_store: ArchiveExecutionStateStore,
    operation: ArchiveOperation,
    outcome: ArchiveExtractionPartialMemberOutcome,
) -> ArchiveOperation:
    """Persist one retryable partial output through the common extraction ledger."""

    checkpoint = load_archive_checkpoint(operation)
    record_extraction_partial_member_outcome(checkpoint, outcome)
    return state_store.update_checkpoint(operation, json.dumps(checkpoint))


def record_extraction_member_outcome(
    checkpoint: dict[str, object],
    outcome: ArchiveExtractionDestinationResult,
    *,
    preserve_absent_zero: bool,
) -> None:
    """Record one detailed member outcome and its counters in a durable checkpoint."""

    outcomes = _extraction_member_outcomes(checkpoint, migrate_legacy_members=True)
    if not isinstance(outcomes, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    outcome_payload = {
        "status": outcome.status,
        "target_path": outcome.target_path,
        "extracted_bytes": outcome.extracted_bytes,
        "directories_created": outcome.directories_created,
        "replaced": outcome.replaced,
        "renamed": outcome.renamed,
    }
    existing_outcome = outcomes.get(outcome.member_path)
    if existing_outcome is not None:
        if not isinstance(existing_outcome, dict):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        if existing_outcome.get("status") != "partial":
            if existing_outcome == outcome_payload:
                return
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive member outcome conflicts with its checkpoint")
    outcomes[outcome.member_path] = outcome_payload

    try:
        progress = ArchiveExtractionProgress.from_checkpoint(checkpoint)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
    progress.record(outcome)
    progress.write_to(checkpoint, preserve_absent_zero=preserve_absent_zero)


def extraction_outcome_summary(checkpoint: dict[str, object], root_directories_created: int) -> ArchiveExtractionProgress:
    """Derive terminal extraction counters exclusively from durable member outcomes."""

    if type(root_directories_created) is not int or root_directories_created < 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    outcomes = _extraction_member_outcomes(checkpoint, migrate_legacy_members=False)
    progress = ArchiveExtractionProgress(directories_created=root_directories_created)
    for member_path, raw_outcome in outcomes.items():
        if not isinstance(raw_outcome, dict):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        status_value = raw_outcome.get("status")
        if status_value == "partial":
            continue
        target_path = raw_outcome.get("target_path")
        extracted_bytes = raw_outcome.get("extracted_bytes", 0)
        directories_created = raw_outcome.get("directories_created", 0)
        replaced = raw_outcome.get("replaced", False)
        renamed = raw_outcome.get("renamed", False)
        if (
            not isinstance(member_path, str)
            or status_value not in _EXTRACTION_MEMBER_OUTCOME_STATUSES - {"partial"}
            or not isinstance(target_path, str)
            or type(extracted_bytes) is not int
            or extracted_bytes < 0
            or type(directories_created) is not int
            or directories_created < 0
            or type(replaced) is not bool
            or type(renamed) is not bool
        ):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        progress.record(
            ArchiveExtractionDestinationResult(
                member_path,
                status_value,
                target_path,
                extracted_bytes,
                directories_created,
                replaced,
                renamed,
            )
        )
    return progress


def persist_extraction_member_outcome(
    state_store: ArchiveExecutionStateStore,
    operation: ArchiveOperation,
    outcome: ArchiveExtractionDestinationResult,
    *,
    checkpoint: dict[str, object] | None = None,
    preserve_absent_zero: bool = True,
) -> ArchiveOperation:
    """Record one outcome and atomically persist its shared checkpoint shape."""

    if checkpoint is None:
        checkpoint = load_archive_checkpoint(operation)
    record_extraction_member_outcome(checkpoint, outcome, preserve_absent_zero=preserve_absent_zero)
    return state_store.update_checkpoint(operation, json.dumps(checkpoint))


@dataclass(frozen=True)
class ArchiveCreationOutcomeSummary:
    """Terminal creation counts derived from an immutable manifest and its outcome ledger."""

    files_created: int
    directories_created: int
    source_bytes: int

    def to_checkpoint(self) -> dict[str, int]:
        return {
            "files_created": self.files_created,
            "directories_created": self.directories_created,
            "source_bytes": self.source_bytes,
        }


@dataclass(frozen=True)
class ArchiveCreationManifestMember:
    """One immutable source member expected in a creation outcome ledger."""

    archive_path: str
    is_directory: bool
    source_size: int
    source_path: str | None
    source_modified_at: str | None


@dataclass(frozen=True)
class ArchiveCreationManifest:
    """One validated immutable source manifest shared by creation relay directions."""

    members: tuple[ArchiveCreationManifestMember, ...]
    _member_index: Mapping[str, ArchiveCreationManifestMember] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        member_index = {member.archive_path: member for member in self.members}
        if len(member_index) != len(self.members):
            raise ValueError("Archive creation sources have duplicate entry names")
        object.__setattr__(self, "_member_index", MappingProxyType(member_index))

    @classmethod
    def from_members(cls, members: list[ArchiveCreationManifestMember]) -> "ArchiveCreationManifest":
        """Normalize and validate untrusted preflight members before output begins."""

        try:
            return cls(cls._validate_members(members, normalize_archive_paths=True))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    @classmethod
    def from_checkpoint(cls, checkpoint: dict[str, object]) -> "ArchiveCreationManifest":
        """Load an already-normalized immutable manifest from durable state."""

        source_manifest = checkpoint.get("source_manifest")
        if not isinstance(source_manifest, list):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        try:
            members = []
            for entry in source_manifest:
                source_identity = entry.get("source_identity") if isinstance(entry, dict) else None
                archive_path = entry.get("archive_path") if isinstance(entry, dict) else None
                is_directory = entry.get("is_directory") if isinstance(entry, dict) else None
                source_size = source_identity.get("size") if isinstance(source_identity, dict) else None
                source_path = entry.get("source_path") if isinstance(entry, dict) else None
                source_modified_at = source_identity.get("modified_at") if isinstance(source_identity, dict) else None
                if (
                    not isinstance(archive_path, str)
                    or type(is_directory) is not bool
                    or type(source_size) is not int
                    or (source_path is not None and not isinstance(source_path, str))
                    or (source_modified_at is not None and not isinstance(source_modified_at, str))
                ):
                    raise ValueError
                members.append(
                    ArchiveCreationManifestMember(
                        archive_path,
                        is_directory,
                        source_size,
                        source_path,
                        source_modified_at,
                    )
                )
            return cls(cls._validate_members(members, normalize_archive_paths=False))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc

    @staticmethod
    def _validate_members(
        members: list[ArchiveCreationManifestMember],
        *,
        normalize_archive_paths: bool,
    ) -> tuple[ArchiveCreationManifestMember, ...]:
        validated_members: list[ArchiveCreationManifestMember] = []
        for member in members:
            if (
                not isinstance(member.archive_path, str)
                or type(member.is_directory) is not bool
                or type(member.source_size) is not int
                or member.source_size < 0
                or (member.source_path is not None and not isinstance(member.source_path, str))
                or (member.source_modified_at is not None and not isinstance(member.source_modified_at, str))
            ):
                raise ValueError("Archive creation manifest is invalid")
            source_modified_at = _normalize_creation_manifest_timestamp(member.source_modified_at)
            normalized_archive_path = _normalize_creation_manifest_path(member.archive_path)
            if not normalize_archive_paths and normalized_archive_path != member.archive_path:
                raise ValueError("Archive creation manifest is invalid")
            if member.is_directory and member.source_size != 0:
                raise ValueError("Archive directory source size must be zero")
            validated_members.append(
                ArchiveCreationManifestMember(
                    normalized_archive_path,
                    member.is_directory,
                    member.source_size,
                    member.source_path,
                    source_modified_at,
                )
            )
        _validate_archive_member_hierarchy(
            [(member.archive_path, member.is_directory) for member in validated_members],
            error_message="Archive creation sources have duplicate entry names",
        )
        if not validated_members:
            raise ValueError("Archive creation manifest is empty")
        return tuple(validated_members)

    def member(self, archive_path: str) -> ArchiveCreationManifestMember:
        """Return one approved member without accepting an arbitrary source path."""

        try:
            normalized_archive_path = _normalize_creation_manifest_path(archive_path)
        except (AttributeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Archive creation member is invalid or unavailable",
            ) from exc
        member = self._member_index.get(normalized_archive_path)
        if member is not None:
            return member
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Archive creation member is invalid or unavailable",
        )

    def empty_checkpoint(self) -> dict[str, object]:
        """Serialize this immutable manifest with an empty V1 creation ledger."""

        return {
            "files_created": 0,
            "directories_created": 0,
            "source_bytes": 0,
            _CREATION_OUTCOME_CHECKPOINT_VERSION_KEY: CREATION_OUTCOME_CHECKPOINT_VERSION,
            "creation_member_outcomes": {},
            "source_manifest": [
                {
                    **({"source_path": member.source_path} if member.source_path is not None else {}),
                    "archive_path": member.archive_path,
                    "is_directory": member.is_directory,
                    "source_identity": {"size": member.source_size, "modified_at": member.source_modified_at},
                }
                for member in self.members
            ],
        }


@dataclass(frozen=True)
class ArchiveCreationExecutionPlan:
    """Immutable creation manifest consumed by every creation coordinator."""

    manifest: ArchiveCreationManifest


def _normalize_creation_manifest_path(archive_path: str) -> str:
    normalized = archive_path.replace("\\", "/").rstrip("/")
    parts = normalized.split("/")
    if (
        not normalized
        or normalized.startswith("/")
        or "\x00" in normalized
        or any(not part or part in {".", ".."} or ":" in part for part in parts)
    ):
        raise ValueError("Archive creation member is invalid or unavailable")
    return normalized


def _normalize_creation_manifest_timestamp(source_modified_at: str | None) -> str | None:
    if source_modified_at is None:
        return None
    try:
        timestamp = datetime.fromisoformat(source_modified_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Archive creation manifest is invalid") from exc
    if timestamp.tzinfo is None:
        raise ValueError("Archive creation manifest is invalid")
    return timestamp.astimezone(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class ArchiveCreationState:
    """Validated creation manifest and outcome ledger projection for one checkpoint."""

    checkpoint: dict[str, object]
    manifest: ArchiveCreationManifest

    @classmethod
    def from_checkpoint(cls, checkpoint: dict[str, object]) -> "ArchiveCreationState":
        """Validate the immutable source manifest and prepare its V1 outcome ledger."""

        _creation_member_outcomes(checkpoint, initialize=True)
        return cls(checkpoint, ArchiveCreationManifest.from_checkpoint(checkpoint))

    def member(self, archive_path: str) -> ArchiveCreationManifestMember:
        """Return one approved manifest member without accepting arbitrary source paths."""

        return self.manifest.member(archive_path)

    def expected_outcome(self, archive_path: str) -> ArchiveCreationMemberOutcome:
        """Derive the only ledger result accepted for one immutable manifest member."""

        member = self.member(archive_path)
        return ArchiveCreationMemberOutcome(
            member.archive_path,
            "directory" if member.is_directory else "created",
            0 if member.is_directory else member.source_size,
        )

    def validate_report(self, reported_outcome: ArchiveCreationMemberOutcome) -> ArchiveCreationMemberOutcome:
        """Validate an executor acknowledgement and return its normalized expected outcome."""

        expected_outcome = self.expected_outcome(reported_outcome.archive_path)
        if reported_outcome.status != expected_outcome.status or reported_outcome.source_bytes != expected_outcome.source_bytes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Archive creation member completion counts are invalid",
            )
        return expected_outcome

    def has_committed_outcome(self, outcome: ArchiveCreationMemberOutcome) -> bool:
        """Return whether an exact approved outcome was already durably committed."""

        expected_outcome = self.validate_report(outcome)
        outcomes = _creation_member_outcomes(self.checkpoint, initialize=True)
        existing_outcome = outcomes.get(expected_outcome.archive_path)
        if existing_outcome is None:
            return False
        expected_payload = {"status": expected_outcome.status, "source_bytes": expected_outcome.source_bytes}
        if existing_outcome == expected_payload:
            return True
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation member outcome conflicts with its checkpoint")

    def terminal_summary(self) -> ArchiveCreationOutcomeSummary:
        """Require exact manifest coverage and derive terminal counters from the ledger."""

        outcomes = _creation_member_outcomes(self.checkpoint, initialize=True)
        for member in self.manifest.members:
            expected_member_outcome = self.expected_outcome(member.archive_path)
            expected_outcome = {
                "status": expected_member_outcome.status,
                "source_bytes": expected_member_outcome.source_bytes,
            }
            if outcomes.get(member.archive_path) != expected_outcome:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Archive creation member outcomes did not match the preflight manifest",
                )
        if set(outcomes) != {member.archive_path for member in self.manifest.members}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Archive creation member outcomes did not match the preflight manifest",
            )
        return creation_outcome_progress(self.checkpoint)


def creation_outcome_summary(checkpoint: dict[str, object]) -> ArchiveCreationOutcomeSummary:
    """Validate complete creation ledger coverage and derive its terminal summary."""

    return ArchiveCreationState.from_checkpoint(checkpoint).terminal_summary()


def creation_outcome_progress(checkpoint: dict[str, object]) -> ArchiveCreationOutcomeSummary:
    """Derive durable creation progress from committed member outcomes only."""

    outcomes = _creation_member_outcomes(checkpoint, initialize=True)
    files_created = 0
    directories_created = 0
    source_bytes = 0
    for archive_path, outcome in outcomes.items():
        if not isinstance(archive_path, str) or not isinstance(outcome, dict):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        status_value = outcome.get("status")
        outcome_source_bytes = outcome.get("source_bytes")
        if status_value not in _CREATION_MEMBER_OUTCOME_STATUSES or type(outcome_source_bytes) is not int or outcome_source_bytes < 0:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        if status_value == "directory":
            if outcome_source_bytes != 0:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
            directories_created += 1
        else:
            files_created += 1
            source_bytes += outcome_source_bytes
    return ArchiveCreationOutcomeSummary(files_created, directories_created, source_bytes)


async def complete_creation_relay_execution(
    state_store: ArchiveExecutionStateStore,
    operation: ArchiveOperation,
    result: ArchiveCreationResult,
    *,
    finalize: Callable[[], Awaitable[None]] | None = None,
    abort: Callable[[], Awaitable[None]] | None = None,
) -> ArchiveOperation:
    """Complete a member-reported creation relay using its ledger-derived summary."""

    async def prepare_checkpoint_json() -> str:
        checkpoint = load_archive_checkpoint(operation)
        summary = creation_outcome_summary(checkpoint)
        if result != ArchiveCreationResult(**summary.to_checkpoint()):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Archive creation completion did not match the preflight manifest",
            )
        if finalize is not None:
            await finalize()
        return json.dumps(checkpoint)

    return await complete_checked_relay_execution(
        state_store,
        operation,
        prepare_checkpoint_json=prepare_checkpoint_json,
        abort=abort,
        validation_failure_message="Archive creation member outcomes did not match the preflight manifest",
        finalization_failure_detail="Archive creation finalization failed",
    )


async def complete_checked_relay_execution(
    state_store: ArchiveExecutionStateStore,
    operation: ArchiveOperation,
    *,
    prepare_checkpoint_json: Callable[[], Awaitable[str | None]],
    abort: Callable[[], Awaitable[None]] | None = None,
    validation_failure_message: str,
    finalization_failure_detail: str,
) -> ArchiveOperation:
    """Complete after asynchronous validation or finalization prepares a terminal checkpoint."""

    if operation.phase == ArchiveOperationPhase.COMPLETED:
        return operation
    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready to complete")
    if state_store.cancellation_requested(operation):
        if abort is not None:
            await abort()
        return complete_relay_execution(state_store, operation)
    try:
        checkpoint_json = await prepare_checkpoint_json()
    except HTTPException:
        if abort is not None:
            await abort()
        state_store.fail(operation, validation_failure_message)
        raise
    except Exception as exc:
        if abort is not None:
            await abort()
        state_store.fail(operation, str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=finalization_failure_detail) from exc
    return complete_relay_execution(state_store, operation, checkpoint_json=checkpoint_json)


def record_creation_member_outcome(checkpoint: dict[str, object], outcome: ArchiveCreationMemberOutcome) -> None:
    """Record one committed ZIP member and derive its durable progress from the ledger."""

    if outcome.status not in _CREATION_MEMBER_OUTCOME_STATUSES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation member status is invalid")
    if outcome.status == "directory" and outcome.source_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive directory result must not contain source bytes"
        )
    outcomes = _creation_member_outcomes(checkpoint, initialize=True)
    outcome_payload = {"status": outcome.status, "source_bytes": outcome.source_bytes}
    existing_outcome = outcomes.get(outcome.archive_path)
    if existing_outcome is not None:
        if not isinstance(existing_outcome, dict):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        if existing_outcome == outcome_payload:
            return
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation member outcome conflicts with its checkpoint")
    outcomes[outcome.archive_path] = outcome_payload
    checkpoint.update(creation_outcome_progress(checkpoint).to_checkpoint())


def persist_creation_member_outcome(
    state_store: ArchiveExecutionStateStore,
    operation: ArchiveOperation,
    outcome: ArchiveCreationMemberOutcome,
    *,
    checkpoint: dict[str, object] | None = None,
) -> ArchiveOperation:
    """Record and persist a normalized ZIP member result atomically."""

    if checkpoint is None:
        checkpoint = load_archive_checkpoint(operation)
    record_creation_member_outcome(checkpoint, outcome)
    return state_store.update_checkpoint(operation, json.dumps(checkpoint))


def commit_creation_member_outcome(
    state_store: ArchiveExecutionStateStore,
    operation: ArchiveOperation,
    reported_outcome: ArchiveCreationMemberOutcome,
) -> ArchiveOperation:
    """Validate a committed member against its manifest and persist its normalized outcome."""

    checkpoint = load_archive_checkpoint(operation)
    outcome = ArchiveCreationState.from_checkpoint(checkpoint).validate_report(reported_outcome)
    return persist_creation_member_outcome(state_store, operation, outcome, checkpoint=checkpoint)


def _creation_member_outcomes(checkpoint: dict[str, object], *, initialize: bool) -> dict[str, object]:
    checkpoint_version = checkpoint.get(_CREATION_OUTCOME_CHECKPOINT_VERSION_KEY)
    if checkpoint_version is None:
        if not initialize:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        checkpoint[_CREATION_OUTCOME_CHECKPOINT_VERSION_KEY] = CREATION_OUTCOME_CHECKPOINT_VERSION
    elif checkpoint_version != CREATION_OUTCOME_CHECKPOINT_VERSION:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    outcomes = checkpoint.get("creation_member_outcomes")
    if outcomes is None and initialize:
        outcomes = {}
        checkpoint["creation_member_outcomes"] = outcomes
    if not isinstance(outcomes, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    return outcomes


def completed_extraction_member_paths(checkpoint: dict[str, object]) -> list[str]:
    """Return members with terminal durable output while rejecting malformed ledgers."""

    if _EXTRACTION_OUTCOME_CHECKPOINT_VERSION_KEY not in checkpoint and "member_outcomes" not in checkpoint:
        return legacy_v1_written_member_paths(checkpoint)
    outcomes = _extraction_member_outcomes(checkpoint, migrate_legacy_members=False)
    completed: list[str] = []
    for member_path, outcome in outcomes.items():
        if (
            not isinstance(member_path, str)
            or not isinstance(outcome, dict)
            or outcome.get("status") not in _EXTRACTION_MEMBER_OUTCOME_STATUSES
        ):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        if outcome["status"] != "partial":
            completed.append(member_path)
    return completed


def legacy_v1_written_member_paths(checkpoint: dict[str, object]) -> list[str]:
    """Read unversioned V1 members; retire this sole compatibility boundary with the V1 reader after V2 retention ends."""

    written_members = checkpoint.get("written_members", [])
    if not isinstance(written_members, list) or not all(isinstance(member_path, str) for member_path in written_members):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    return written_members


def _extraction_member_outcomes(checkpoint: dict[str, object], *, migrate_legacy_members: bool) -> dict[str, object]:
    checkpoint_version = checkpoint.get(_EXTRACTION_OUTCOME_CHECKPOINT_VERSION_KEY)
    if checkpoint_version is None:
        if "member_outcomes" not in checkpoint:
            if not migrate_legacy_members:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
            written_members = legacy_v1_written_member_paths(checkpoint)
            checkpoint["member_outcomes"] = {member_path: {"status": "extracted"} for member_path in written_members}
        if migrate_legacy_members:
            checkpoint[_EXTRACTION_OUTCOME_CHECKPOINT_VERSION_KEY] = EXTRACTION_OUTCOME_CHECKPOINT_VERSION
            checkpoint.pop("written_members", None)
    elif checkpoint_version != EXTRACTION_OUTCOME_CHECKPOINT_VERSION:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    outcomes = checkpoint.get("member_outcomes")
    if not isinstance(outcomes, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    return outcomes


def existing_files_decision(conflicts: list[ArchiveExtractionConflict]) -> dict[str, object]:
    """Build the common collision decision payload for every extraction binding."""

    has_directory_conflict = any(conflict.is_directory for conflict in conflicts)
    return {
        "kind": "existing_files",
        "allowed_actions": ["rename"]
        if has_directory_conflict
        else ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
        "conflicts": [
            {
                "member_path": conflict.member_path,
                "target_path": conflict.target_path,
                "is_directory": conflict.is_directory,
                **({"source_size": conflict.source_size} if conflict.source_size is not None else {}),
                **(
                    {
                        "source_modified_at": conflict.source_modified_at.isoformat()
                        if isinstance(conflict.source_modified_at, datetime)
                        else conflict.source_modified_at
                    }
                    if conflict.source_modified_at is not None
                    else {}
                ),
                **({"target_size": conflict.target_size} if conflict.target_size is not None else {}),
                **({"target_modified_at": conflict.target_modified_at.isoformat()} if conflict.target_modified_at is not None else {}),
            }
            for conflict in conflicts
        ],
    }


def archive_member_target(destination_root: str, member_path: str) -> str:
    """Join a validated archive member beneath its operation-owned output root."""

    normalized_member = member_path.replace("\\", "/")
    if (
        not normalized_member
        or normalized_member.startswith("/")
        or "\x00" in normalized_member
        or any(part in {"", ".", ".."} for part in normalized_member.split("/"))
    ):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member path is invalid")
    root = destination_root.replace("\\", "/").strip("/")
    if not root:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive destination path is invalid")
    return f"{root}/{normalized_member}"


def member_error_decision(
    member_path: str,
    target_path: str,
    message: str,
    *,
    partial_output: bool,
) -> dict[str, object]:
    """Build the common retry-or-ignore decision payload for one failed member."""

    return {
        "kind": "member_error",
        "member_path": member_path,
        "target_path": target_path,
        "message": message,
        "partial_output": partial_output,
        "allowed_actions": ["retry", "ignore"],
    }


def begin_relay_execution(
    state_store: ArchiveExecutionStateStore,
    operation: ArchiveOperation,
    *,
    checkpoint_json: str | None = None,
    allow_streaming: bool = True,
    not_ready_detail: str = "Archive operation is not ready for Companion execution",
) -> ArchiveOperation:
    """Begin a Companion relay after its route-specific preflight work succeeds."""

    if allow_streaming and operation.phase == ArchiveOperationPhase.STREAMING:
        return operation
    if operation.phase != ArchiveOperationPhase.ACCEPTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=not_ready_detail)
    if operation.cancellation_requested:
        return state_store.transition(
            operation,
            expected_phase=ArchiveOperationPhase.ACCEPTED,
            next_phase=ArchiveOperationPhase.CANCELLED,
        )
    additional_changes: dict[str, object] | None = {"checkpoint_json": checkpoint_json} if checkpoint_json is not None else None
    return state_store.transition(
        operation,
        expected_phase=ArchiveOperationPhase.ACCEPTED,
        next_phase=ArchiveOperationPhase.STREAMING,
        additional_changes=additional_changes,
    )


def complete_relay_execution(
    state_store: ArchiveExecutionStateStore,
    operation: ArchiveOperation,
    *,
    checkpoint_json: str | None = None,
    prepare_checkpoint_json: Callable[[], str | None] | None = None,
) -> ArchiveOperation:
    """Persist an optional relay result and complete its shared terminal lifecycle."""

    if checkpoint_json is not None and prepare_checkpoint_json is not None:
        raise ValueError("Relay completion accepts either a checkpoint or a checkpoint preparation callback")
    if operation.phase == ArchiveOperationPhase.COMPLETED:
        return operation
    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready to complete")
    if operation.cancellation_requested:
        return state_store.transition(
            operation,
            expected_phase=ArchiveOperationPhase.STREAMING,
            next_phase=ArchiveOperationPhase.CANCELLED,
        )
    if prepare_checkpoint_json is not None:
        checkpoint_json = prepare_checkpoint_json()
    if checkpoint_json is not None:
        operation = state_store.update_checkpoint(operation, checkpoint_json)
    state_store.transition(
        operation,
        expected_phase=ArchiveOperationPhase.STREAMING,
        next_phase=ArchiveOperationPhase.VERIFYING,
    )
    return state_store.transition(
        operation,
        expected_phase=ArchiveOperationPhase.VERIFYING,
        next_phase=ArchiveOperationPhase.COMPLETED,
    )


def advance_relay_transfer(state_store: ArchiveExecutionStateStore, operation: ArchiveOperation) -> bool:
    """Refresh a relay lease and stop its active stream when cancellation is requested."""

    if state_store.cancellation_requested(operation):
        state_store.transition(
            operation,
            expected_phase=ArchiveOperationPhase.STREAMING,
            next_phase=ArchiveOperationPhase.CANCELLED,
        )
        return False
    state_store.heartbeat(operation)
    return True


def start_archive_execution(
    state_store: ArchiveExecutionStateStore,
    operation: ArchiveOperation,
    *,
    checkpoint_json: str | None = None,
    allow_streaming: bool,
) -> ArchiveOperation:
    """Start one direct execution with optional checkpoint initialization and resume policy."""

    if operation.phase == ArchiveOperationPhase.PREPARED:
        operation = state_store.transition(
            operation,
            expected_phase=ArchiveOperationPhase.PREPARED,
            next_phase=ArchiveOperationPhase.ACCEPTED,
        )
    return begin_relay_execution(
        state_store,
        operation,
        checkpoint_json=checkpoint_json,
        allow_streaming=allow_streaming,
        not_ready_detail="Archive operation is not ready to execute",
    )


@dataclass(frozen=True)
class ArchiveExtractionCoordinator:
    """Drive one durable extraction without owning source or destination I/O."""

    operation: ArchiveOperation
    state_store: ArchiveExecutionStateStore

    def begin(self, *, checkpoint_json: str | None = None, allow_streaming: bool = True) -> ArchiveOperation:
        """Start a direct or relay extraction after its adapter-specific preflight succeeds."""

        return start_archive_execution(
            self.state_store,
            self.operation,
            checkpoint_json=checkpoint_json,
            allow_streaming=allow_streaming,
        )

    def advance(self) -> bool:
        """Refresh an active adapter lease and transition cancellation through the common lifecycle."""

        return advance_relay_transfer(self.state_store, self.operation)

    def complete(self, *, destination_root_created: bool) -> ArchiveOperation:
        """Validate terminal ledger coverage and complete a direct or relay extraction."""

        return complete_relay_execution(
            self.state_store,
            self.operation,
            prepare_checkpoint_json=lambda: ArchiveExtractionState.from_checkpoint(
                load_archive_checkpoint(self.operation)
            ).completion_checkpoint_json(destination_root_created=destination_root_created),
        )

    def fail(self, message: str) -> ArchiveOperation:
        """Persist an adapter-detected terminal failure through the coordinator state store."""

        return self.state_store.fail(self.operation, message)

    async def run(self, runner: ArchiveExtractionRunner) -> ArchiveOperation:
        """Advance an extraction adapter from its current lifecycle phase."""

        operation = self._start_streaming()
        execution_plan = ArchiveExtractionExecutionPlan.from_checkpoint(
            load_archive_checkpoint(operation),
            existing_file_policy=operation.collision_policy,
        )

        async def is_cancelled() -> bool:
            return await self.state_store.is_cancelled(operation)

        async def record_member_completed(outcome: ArchiveExtractionDestinationResult) -> None:
            nonlocal operation
            operation = persist_extraction_member_outcome(self.state_store, operation, outcome)

        try:
            await runner(execution_plan, record_member_completed, is_cancelled)
            checkpoint = load_archive_checkpoint(operation)
            completed_checkpoint_json = ArchiveExtractionExecutionPlan.from_checkpoint(checkpoint).completion_checkpoint_json(
                destination_root_created=False
            )
            operation = self.state_store.update_checkpoint(operation, completed_checkpoint_json)
            self.state_store.transition(
                operation,
                expected_phase=ArchiveOperationPhase.STREAMING,
                next_phase=ArchiveOperationPhase.VERIFYING,
            )
            return self.state_store.transition(
                operation,
                expected_phase=ArchiveOperationPhase.VERIFYING,
                next_phase=ArchiveOperationPhase.COMPLETED,
            )
        except ArchiveExtractionCancelled:
            return self.state_store.transition(
                operation,
                expected_phase=ArchiveOperationPhase.STREAMING,
                next_phase=ArchiveOperationPhase.CANCELLED,
            )
        except ArchiveExtractionConflicts as exc:
            return self.state_store.await_decision(operation, existing_files_decision(exc.conflicts))
        except ArchiveExtractionMemberError as exc:
            operation = persist_extraction_partial_member_outcome(
                self.state_store,
                operation,
                ArchiveExtractionPartialMemberOutcome(exc.member_path, exc.target_path, exc.message),
            )
            return self.state_store.await_decision(
                operation,
                member_error_decision(exc.member_path, exc.target_path, exc.message, partial_output=True),
            )
        except HTTPException:
            raise
        except Exception as exc:
            self.state_store.fail(operation, str(exc))
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive extraction failed") from exc

    def _start_streaming(self) -> ArchiveOperation:
        return self.begin()

    def apply_decision(
        self,
        action: str,
        *,
        member_path: str | None = None,
        target_path: str | None = None,
    ) -> ArchiveOperation:
        """Apply one validated pause decision through the coordinator's state store."""

        return self.state_store.apply_extraction_decision(self.operation, action, member_path, target_path)

    def record_member_completed(self, reported_outcome: ArchiveExtractionDestinationResult) -> ArchiveOperation:
        """Validate and persist one terminal result reported by any execution adapter."""

        checkpoint = load_archive_checkpoint(self.operation)
        execution_plan = ArchiveExtractionExecutionPlan.from_checkpoint(
            checkpoint,
            existing_file_policy=self.operation.collision_policy,
        )
        member_path = reported_outcome.member_path
        entry = execution_plan.member(member_path, is_directory=reported_outcome.status == "directory")
        target_path = archive_member_target(self.operation.destination_path, execution_plan.target_member_path(member_path))
        if reported_outcome.target_path != target_path:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member target path is invalid")
        renamed = target_path != archive_member_target(self.operation.destination_path, member_path)
        if reported_outcome.renamed != renamed:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member rename state is invalid")
        if member_path in completed_extraction_member_paths(checkpoint):
            return self.operation
        if reported_outcome.status == "directory":
            if not entry.is_directory or reported_outcome.extracted_bytes or reported_outcome.replaced:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Archive directory completion counts are invalid",
                )
        elif reported_outcome.status in {"skipped", "ignored"}:
            if entry.is_directory or any(
                (reported_outcome.directories_created, reported_outcome.extracted_bytes, reported_outcome.replaced)
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Archive skipped member counts are invalid",
                )
        elif entry.is_directory or reported_outcome.extracted_bytes != entry.uncompressed_size:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Archive member completion counts are invalid",
            )
        checkpoint["retry_members"] = ArchiveExtractionDecisionState.from_checkpoint(checkpoint).retry_members_after_completion(member_path)
        return persist_extraction_member_outcome(self.state_store, self.operation, reported_outcome, checkpoint=checkpoint)

    def pause_for_collision(
        self,
        *,
        member_path: str,
        is_directory: bool,
        target_size: int | None,
        target_modified_at: datetime | None,
    ) -> ArchiveOperation:
        """Convert an adapter-observed collision to a normalized persisted pause."""

        execution_plan = ArchiveExtractionExecutionPlan.from_checkpoint(
            load_archive_checkpoint(self.operation),
            existing_file_policy=self.operation.collision_policy,
        )
        entry = execution_plan.member(member_path, is_directory=is_directory)
        target_path = archive_member_target(self.operation.destination_path, execution_plan.target_member_path(member_path))
        return self.state_store.await_decision(
            self.operation,
            existing_files_decision(
                [
                    ArchiveExtractionConflict(
                        member_path,
                        target_path,
                        is_directory=is_directory,
                        source_size=entry.uncompressed_size if not is_directory else None,
                        source_modified_at=entry.source_modified_at,
                        target_size=target_size,
                        target_modified_at=target_modified_at,
                    )
                ]
            ),
        )

    def pause_for_member_error(self, *, member_path: str, message: str, partial_output: bool) -> ArchiveOperation:
        """Persist an adapter-observed partial write before awaiting a coordinator decision."""

        execution_plan = ArchiveExtractionExecutionPlan.from_checkpoint(
            load_archive_checkpoint(self.operation),
            existing_file_policy=self.operation.collision_policy,
        )
        execution_plan.member(member_path)
        target_path = archive_member_target(self.operation.destination_path, execution_plan.target_member_path(member_path))
        operation = persist_extraction_partial_member_outcome(
            self.state_store,
            self.operation,
            ArchiveExtractionPartialMemberOutcome(member_path, target_path, message),
        )
        return self.state_store.await_decision(
            operation,
            member_error_decision(member_path, target_path, message, partial_output=partial_output),
        )


@dataclass(frozen=True)
class ArchiveCreationCoordinator:
    """Drive one durable archive creation without owning source or target I/O."""

    operation: ArchiveOperation
    state_store: ArchiveExecutionStateStore

    async def run(self, runner: ArchiveCreationRunner, *, execution_plan: ArchiveCreationExecutionPlan) -> ArchiveOperation:
        """Advance a creation adapter through its shared lifecycle."""

        operation = self._start_streaming(execution_plan)
        try:

            async def record_member_completed(outcome: ArchiveCreationMemberOutcome) -> None:
                nonlocal operation
                operation = commit_creation_member_outcome(self.state_store, operation, outcome)

            result = await runner(record_member_completed, lambda: self.state_store.is_cancelled(operation))
            return await complete_creation_relay_execution(self.state_store, operation, result)
        except ArchiveCreationCancelled:
            return self.state_store.transition(
                operation,
                expected_phase=ArchiveOperationPhase.STREAMING,
                next_phase=ArchiveOperationPhase.CANCELLED,
            )
        except HTTPException:
            raise
        except Exception as exc:
            self.state_store.fail(operation, str(exc))
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive creation failed") from exc

    def _start_streaming(self, execution_plan: ArchiveCreationExecutionPlan) -> ArchiveOperation:
        return start_archive_execution(
            self.state_store,
            self.operation,
            checkpoint_json=json.dumps(execution_plan.manifest.empty_checkpoint()),
            allow_streaming=False,
        )
