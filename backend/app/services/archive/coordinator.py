"""Common coordinator lifecycle for archive execution bindings."""

import json
import mimetypes
import unicodedata
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Literal, Protocol

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.archive import ArchiveDirectoryListing, ArchiveEntryInfo, ArchiveIdentity
from app.models.archive_operation import (
    ArchiveContractVersion,
    ArchiveOperation,
    ArchiveOperationError,
    ArchiveOperationErrorCode,
    ArchiveOperationPhase,
)
from app.models.file import FileType
from app.services.archive.creation import ArchiveCreationCancelled, ArchiveCreationMemberOutcome, ArchiveCreationResult
from app.services.archive.execution import (
    ArchiveExecutionDriver,
    ArchiveInspectionBinding,
    ArchiveInspectionOperationKind,
    ArchiveInspectionTopologyPlan,
)
from app.services.archive.operations import (
    fail_operation,
    heartbeat_operation,
    update_operation_checkpoint,
    update_operation_phase,
)
from app.services.archive.v2_checkpoint import (
    canonical_v2_timestamp,
    new_v2_creation_checkpoint,
    validate_v2_operation_checkpoint,
)
from app.services.archive.zip_reader import (
    ArchiveInspectionManifest,
    ArchiveInspectionManifestMember,
    ValidatedZipEntry,
    ZipReader,
)
from app.utils.content_disposition import build_content_disposition
from app.utils.file_type_registry import needs_processing

ArchiveCreationRunner = Callable[
    [Callable[[ArchiveCreationMemberOutcome], Awaitable[None]], Callable[[], Awaitable[bool]]],
    Awaitable[ArchiveCreationResult],
]
_CREATION_MEMBER_OUTCOME_STATUSES = frozenset({"directory", "created"})


def _validate_archive_member_hierarchy(
    members: list[tuple[str, bool]],
    *,
    error_message: str,
    exact_member_identity: bool = False,
) -> None:
    """Reject duplicate member identities and portable file/directory collisions."""

    member_path_keys: set[str] = set()
    portable_file_path_keys: set[str] = set()
    directory_path_keys: set[str] = set()
    for member_path, is_directory in members:
        member_path_key = member_path if exact_member_identity else unicodedata.normalize("NFC", member_path).casefold()
        if member_path_key in member_path_keys:
            raise ValueError(error_message)
        member_path_keys.add(member_path_key)
        path_parts = member_path.split("/")
        directory_part_count = len(path_parts) if is_directory else len(path_parts) - 1
        for index in range(1, directory_part_count + 1):
            directory_path_keys.add(unicodedata.normalize("NFC", "/".join(path_parts[:index])).casefold())
        if not is_directory:
            portable_file_path_keys.add(unicodedata.normalize("NFC", member_path).casefold())
    if not portable_file_path_keys.isdisjoint(directory_path_keys):
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

    def fail(
        self,
        operation: ArchiveOperation,
        message: str,
        *,
        error_code: ArchiveOperationErrorCode | None = None,
    ) -> ArchiveOperation: ...

    def cancellation_requested(self, operation: ArchiveOperation) -> bool: ...

    def heartbeat(self, operation: ArchiveOperation) -> None: ...

    async def is_cancelled(self, operation: ArchiveOperation) -> bool: ...


class ArchiveInspectionSource(Protocol):
    """Provide a normalized manifest for one request-scoped archive inspection."""

    @property
    def binding(self) -> ArchiveInspectionBinding: ...

    async def inspection_manifest(self) -> ArchiveInspectionManifest: ...


@dataclass(frozen=True)
class SmbArchiveInspectionSource:
    """Bind the existing SMB-backed ZIP reader to one inspection request."""

    zip_reader: ZipReader

    @property
    def binding(self) -> ArchiveInspectionBinding:
        return ArchiveInspectionBinding.BACKEND_SMB

    async def inspection_manifest(self) -> ArchiveInspectionManifest:
        return await self.zip_reader.inspection_manifest()

    async def validate_member(self, path: str) -> ValidatedZipEntry:
        return await self.zip_reader.validate_member(path)

    async def validate_member_in_record_order(self, path: str) -> ValidatedZipEntry:
        return await self.zip_reader.validate_member_in_record_order(path)

    def stream_member(self, path: str) -> AsyncIterator[bytes]:
        return self.zip_reader.stream_member(path)

    def stream_validated_member(self, member: ValidatedZipEntry) -> AsyncIterator[bytes]:
        return self.zip_reader.stream_validated_entry(member)


class ArchiveInspectionPresentation:
    """Immutable existing-V1 response presenter selected for one inspection request."""


@dataclass(frozen=True)
class ArchiveDirectoryListingPresentation(ArchiveInspectionPresentation):
    """Project one normalized manifest into the V1 directory-listing DTO."""

    archive_path: str
    archive_size: int
    archive_modified_at: datetime | None
    virtual_path: str
    cursor: str | None
    page_size: int

    def project(self, manifest: ArchiveInspectionManifest) -> ArchiveDirectoryListing:
        page = manifest.list_directory(self.virtual_path, self.cursor, self.page_size)
        return ArchiveDirectoryListing(
            archive=ArchiveIdentity(path=self.archive_path, size=self.archive_size, modified_at=self.archive_modified_at),
            path=self.virtual_path.rstrip("/"),
            items=[
                ArchiveEntryInfo(
                    name=entry.name,
                    path=entry.path,
                    type=FileType.DIRECTORY if entry.is_directory else FileType.FILE,
                    size=entry.uncompressed_size,
                    compressed_size=entry.compressed_size,
                    compression_method=entry.compression_method,
                    crc32=entry.crc32,
                    modified_at=entry.modified_at,
                    state=entry.preview_state,
                    is_hidden=entry.name.startswith("."),
                )
                for entry in page.entries
            ],
            total=page.total,
            next_cursor=page.next_cursor,
            page_size=self.page_size,
        )


@dataclass(frozen=True)
class ArchiveMemberReadProjection:
    """V1 member response shape projected independently of HTTP transport."""

    member: ArchiveInspectionManifestMember
    content_type: str
    content_disposition: str
    delivery: Literal["raw", "image", "normalized_pdf", "preview_unavailable"]
    viewport_width: int | None
    viewport_height: int | None
    no_resizing: bool
    screen_width: int | None
    screen_height: int | None
    screen_zoom_percent: int


@dataclass(frozen=True)
class ArchiveMemberReadPresentation(ArchiveInspectionPresentation):
    """Project one normalized manifest member into V1 streaming response metadata."""

    member_path: str
    download: bool
    view_kind: Literal["raw", "text", "image", "pdf"] = "raw"
    pdf_variant: Literal["original", "normalized"] = "original"
    viewport_width: int | None = None
    viewport_height: int | None = None
    no_resizing: bool = False
    screen_width: int | None = None
    screen_height: int | None = None
    screen_zoom_percent: int = 200

    def project(self, manifest: ArchiveInspectionManifest) -> ArchiveMemberReadProjection:
        return self.project_member(manifest.member(self.member_path))

    def project_member(self, member: ArchiveInspectionManifestMember) -> ArchiveMemberReadProjection:
        member_name = member.path.rsplit("/", 1)[-1]
        preview_requested = not self.download and self.view_kind != "raw"
        if preview_requested and not member.is_inline_preview_eligible():
            delivery: Literal["raw", "image", "normalized_pdf", "preview_unavailable"] = "preview_unavailable"
        elif not self.download and self.view_kind == "image" and needs_processing(member_name, member.uncompressed_size):
            delivery = "image"
        elif not self.download and self.view_kind == "pdf" and self.pdf_variant == "normalized":
            delivery = "normalized_pdf"
        else:
            delivery = "raw"
        return ArchiveMemberReadProjection(
            member=member,
            content_type=mimetypes.guess_type(member_name)[0] or "application/octet-stream",
            content_disposition=build_content_disposition("attachment" if self.download else "inline", member_name),
            delivery=delivery,
            viewport_width=self.viewport_width,
            viewport_height=self.viewport_height,
            no_resizing=self.no_resizing,
            screen_width=self.screen_width,
            screen_height=self.screen_height,
            screen_zoom_percent=self.screen_zoom_percent,
        )


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

    async def directory_listing(self) -> ArchiveDirectoryListing:
        """Project the bound normalized manifest into the V1 directory-listing DTO."""

        if not isinstance(self.plan.presentation, ArchiveDirectoryListingPresentation):
            raise ValueError("Archive inspection plan does not support a directory-listing response")
        return self.plan.presentation.project(await self.manifest())

    async def member_read(self) -> ArchiveMemberReadProjection:
        """Project the bound normalized manifest into V1 member response metadata."""

        if not isinstance(self.plan.presentation, ArchiveMemberReadPresentation):
            raise ValueError("Archive inspection plan does not support a member-read response")
        return self.plan.presentation.project(await self.manifest())


def resolve_archive_inspection_coordinator(plan: ArchiveInspectionPlan) -> ArchiveInspectionCoordinator:
    """Construct the backend coordinator only for an SMB-owned inspection plan."""

    if (
        plan.topology.kind != ArchiveInspectionOperationKind.INSPECT
        or plan.topology.driver != ArchiveExecutionDriver.BACKEND
        or plan.topology.source_is_local
        or plan.topology.binding != ArchiveInspectionBinding.BACKEND_SMB
        or plan.source.binding != plan.topology.binding
    ):
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
        if additional_changes is not None and "checkpoint_json" in additional_changes:
            checkpoint_json = additional_changes["checkpoint_json"]
            if not isinstance(checkpoint_json, str):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
            additional_changes = {**additional_changes, "checkpoint_json": _validated_checkpoint_json(operation, checkpoint_json)}
        return update_operation_phase(
            self.session,
            operation,
            expected_phase=expected_phase,
            next_phase=next_phase,
            additional_changes=additional_changes,
        )

    def update_checkpoint(self, operation: ArchiveOperation, checkpoint_json: str) -> ArchiveOperation:
        return update_operation_checkpoint(self.session, operation, _validated_checkpoint_json(operation, checkpoint_json))

    def fail(
        self,
        operation: ArchiveOperation,
        message: str,
        *,
        error_code: ArchiveOperationErrorCode | None = None,
    ) -> ArchiveOperation:
        return fail_operation(self.session, operation, message, error_code=error_code)

    def cancellation_requested(self, operation: ArchiveOperation) -> bool:
        self.session.refresh(operation)
        return operation.cancellation_requested

    def heartbeat(self, operation: ArchiveOperation) -> None:
        heartbeat_operation(self.session, operation)

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

    def fail(
        self,
        operation: ArchiveOperation,
        message: str,
        *,
        error_code: ArchiveOperationErrorCode | None = None,
    ) -> ArchiveOperation:
        operation.phase = ArchiveOperationPhase.FAILED
        operation.last_error_json = ArchiveOperationError(
            code=error_code or ArchiveOperationErrorCode.TRANSPORT_FAILURE,
            message=message[:500] or "Archive operation failed",
        ).model_dump_json()
        return operation

    def cancellation_requested(self, operation: ArchiveOperation) -> bool:
        return operation.cancellation_requested

    def heartbeat(self, operation: ArchiveOperation) -> None:
        return None

    async def is_cancelled(self, operation: ArchiveOperation) -> bool:
        return operation.cancellation_requested


def load_archive_checkpoint(operation: ArchiveOperation) -> dict[str, object]:
    """Load one durable archive checkpoint without accepting malformed state."""

    if operation.checkpoint_json is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is not initialized")
    try:
        checkpoint = json.loads(operation.checkpoint_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
    return _validate_operation_checkpoint(operation, checkpoint)


def _validated_checkpoint_json(operation: ArchiveOperation, checkpoint_json: str) -> str:
    """Normalize one checkpoint before it crosses a durable state-store boundary."""

    try:
        checkpoint = json.loads(checkpoint_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
    return json.dumps(_validate_operation_checkpoint(operation, checkpoint))


def _validate_operation_checkpoint(operation: ArchiveOperation, checkpoint: object) -> dict[str, object]:
    """Validate an initialized checkpoint from the operation's authoritative V2 metadata."""

    if operation.contract_version != ArchiveContractVersion.V2:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation contract version is incompatible with V2")
    try:
        return validate_v2_operation_checkpoint(operation.kind, checkpoint)
    except HTTPException as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc


def _normalize_v2_archive_member_path(member_path: str, *, error_message: str) -> str:
    """Return one canonical safe V2 archive member path for any operation manifest."""

    normalized = member_path.replace("\\", "/").rstrip("/")
    parts = normalized.split("/")
    if (
        not normalized
        or normalized.startswith("/")
        or "\x00" in normalized
        or any(not part or part in {".", ".."} or ":" in part for part in parts)
    ):
        raise ValueError(error_message)
    return normalized


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

        manifest = checkpoint.get("manifest")
        if not isinstance(manifest, list):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        try:
            members = []
            for entry in manifest:
                archive_path = entry.get("archive_path") if isinstance(entry, dict) else None
                is_directory = entry.get("is_directory") if isinstance(entry, dict) else None
                source_size = entry.get("source_size") if isinstance(entry, dict) else None
                source_path = entry.get("source_path") if isinstance(entry, dict) else None
                source_modified_at = entry.get("modified_at") if isinstance(entry, dict) else None
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
        """Serialize this immutable manifest with an empty strict V2 creation ledger."""

        return new_v2_creation_checkpoint(
            manifest=[
                {
                    "archive_path": member.archive_path,
                    "is_directory": member.is_directory,
                    "source_size": member.source_size,
                    "source_path": member.source_path,
                    "modified_at": member.source_modified_at,
                }
                for member in self.members
            ]
        )


@dataclass(frozen=True)
class ArchiveCreationExecutionPlan:
    """Immutable creation manifest consumed by every creation coordinator."""

    manifest: ArchiveCreationManifest


def _normalize_creation_manifest_path(archive_path: str) -> str:
    return _normalize_v2_archive_member_path(archive_path, error_message="Archive creation member is invalid or unavailable")


def _normalize_creation_manifest_timestamp(source_modified_at: str | None) -> str | None:
    if source_modified_at is None:
        return None
    try:
        timestamp = datetime.fromisoformat(source_modified_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Archive creation manifest is invalid") from exc
    if timestamp.tzinfo is None:
        raise ValueError("Archive creation manifest is invalid")
    return canonical_v2_timestamp(timestamp.replace(microsecond=0))


@dataclass(frozen=True)
class ArchiveCreationState:
    """Validated creation manifest and outcome ledger projection for one checkpoint."""

    checkpoint: dict[str, object]
    manifest: ArchiveCreationManifest

    @classmethod
    def from_checkpoint(cls, checkpoint: dict[str, object]) -> "ArchiveCreationState":
        """Validate the immutable source manifest and its V2 outcome ledger."""

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
        state_store.fail(
            operation,
            validation_failure_message,
            error_code=ArchiveOperationErrorCode.INVALID_OPERATION_STATE,
        )
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
    outcomes = checkpoint.get("member_outcomes")
    if not isinstance(outcomes, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    return outcomes


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
        checkpoint = new_v2_creation_checkpoint(
            manifest=[
                {
                    "archive_path": member.archive_path,
                    "is_directory": member.is_directory,
                    "source_size": member.source_size,
                    "source_path": member.source_path,
                    "modified_at": member.source_modified_at,
                }
                for member in execution_plan.manifest.members
            ]
        )
        return start_archive_execution(
            self.state_store,
            self.operation,
            checkpoint_json=json.dumps(checkpoint),
            allow_streaming=False,
        )
