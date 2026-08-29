"""Durable, scoped state for archive creation and extraction workflows."""

import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal

from sqlmodel import Field, SQLModel


class ArchiveOperationKind(StrEnum):
    CREATE = "create"
    EXTRACT = "extract"


class ArchiveOperationPhase(StrEnum):
    PREPARED = "prepared"
    ACCEPTED = "accepted"
    STREAMING = "streaming"
    AWAITING_USER_DECISION = "awaiting_user_decision"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


TERMINAL_ARCHIVE_OPERATION_PHASES = frozenset(
    {ArchiveOperationPhase.COMPLETED, ArchiveOperationPhase.CANCELLED, ArchiveOperationPhase.FAILED}
)

ARCHIVE_OPERATION_HEARTBEAT_TIMEOUT_SECONDS = 120
ARCHIVE_OPERATION_ORPHAN_CHECK_INTERVAL_SECONDS = 30


class ArchiveOperation(SQLModel, table=True):
    """State that lets direct archive output report progress after a request ends."""

    __tablename__ = "archive_operations"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", index=True)
    kind: ArchiveOperationKind = Field(index=True)
    phase: ArchiveOperationPhase = Field(default=ArchiveOperationPhase.PREPARED, index=True)
    source_connection_id: str = Field(default="", index=True)
    source_path: str = Field(default="")
    destination_connection_id: str = Field(default="", index=True)
    destination_path: str = Field(default="")
    manifest_hash: str = Field(default="", index=True)
    revision: int = Field(default=0, ge=0)
    plan_json: str = Field(default="{}")
    checkpoint_json: str = Field(default="{}")
    pending_decision_json: str | None = Field(default=None)
    collision_policy: str | None = Field(default=None)
    cancellation_requested: bool = Field(default=False, index=True)
    last_error_json: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)
    heartbeat_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)


class ArchiveOperationPrepare(SQLModel):
    kind: ArchiveOperationKind
    source_connection_id: str
    source_path: str
    destination_connection_id: str
    destination_path: str
    manifest_hash: str = ""
    plan_json: str = "{}"


class ArchiveOperationRead(SQLModel):
    id: uuid.UUID
    kind: ArchiveOperationKind
    phase: ArchiveOperationPhase
    source_connection_id: str
    source_path: str
    destination_connection_id: str
    destination_path: str
    manifest_hash: str
    revision: int
    checkpoint_json: str
    pending_decision_json: str | None
    collision_policy: str | None
    cancellation_requested: bool
    last_error_json: str | None
    created_at: datetime
    updated_at: datetime
    heartbeat_at: datetime


class ArchiveOperationTransition(SQLModel):
    expected_phase: ArchiveOperationPhase
    next_phase: ArchiveOperationPhase
    expected_revision: int | None = Field(default=None, ge=0)


class ArchiveCompanionSession(SQLModel):
    """Short-lived backend capability handed to the paired Companion executor."""

    token: str
    expires_in: int
    operation: ArchiveOperationRead


class ArchiveCompanionManifestEntry(SQLModel):
    """One validated ZIP member that Companion may write to its local destination."""

    path: str
    is_directory: bool
    uncompressed_size: int
    modified_at: datetime | None = None


class ArchiveCompanionExtractionManifest(SQLModel):
    """Safe, complete member manifest for one scoped SMB-to-local extraction."""

    operation: ArchiveOperationRead
    entries: list[ArchiveCompanionManifestEntry]


class ArchiveCompanionExtractionSourceManifest(SQLModel):
    """Safe, complete local ZIP manifest supplied before a scoped SMB extraction begins."""

    entries: list[ArchiveCompanionManifestEntry]


class ArchiveCompanionExtractionSummary(SQLModel):
    """Execution-level local destination state reported after member outcomes commit."""

    destination_root_created: bool


class ArchiveCompanionExtractionMemberCompletion(SQLModel):
    """One local output member completed by the scoped Companion executor."""

    member_path: str = Field(min_length=1)
    status: Literal["directory", "extracted", "skipped", "ignored"]
    target_path: str = Field(min_length=1)
    directories_created: int = Field(ge=0)
    extracted_bytes: int = Field(ge=0)
    replaced: bool = False
    renamed: bool = False


class ArchiveCompanionExtractionCollision(SQLModel):
    """An existing local output detected before Companion opens a member target."""

    member_path: str = Field(min_length=1)
    is_directory: bool
    target_size: int | None = Field(default=None, ge=0)
    target_modified_at: datetime | None = None


class ArchiveCompanionExtractionMemberError(SQLModel):
    """A local member write failure that can be retried or explicitly ignored."""

    member_path: str = Field(min_length=1)
    message: str = Field(min_length=1, max_length=500)
    partial_output: bool


class ArchiveCompanionFailure(SQLModel):
    """A bounded executor failure description safe to persist on an operation."""

    message: str = Field(min_length=1, max_length=500)


class ArchiveCompanionCreationManifestEntry(SQLModel):
    """One validated SMB source item that Companion may add to a local ZIP."""

    source_path: str
    archive_path: str
    is_directory: bool
    source_size: int = Field(ge=0)
    modified_at: datetime | None = None


class ArchiveCompanionCreationManifest(SQLModel):
    """Complete portable ZIP creation manifest for a local Companion executor."""

    operation: ArchiveOperationRead
    entries: list[ArchiveCompanionCreationManifestEntry]


class ArchiveCompanionCreationSourceManifestEntry(SQLModel):
    """One validated local source member to be committed by the SMB ZIP writer."""

    archive_path: str = Field(min_length=1)
    is_directory: bool
    source_size: int = Field(ge=0)
    modified_at: datetime | None = None


class ArchiveCompanionCreationSourceManifest(SQLModel):
    """Complete local-source manifest for a member-framed SMB ZIP relay."""

    entries: list[ArchiveCompanionCreationSourceManifestEntry]


class ArchiveCompanionCreationSummary(SQLModel):
    """Counts reported by the paired Companion after writing a local ZIP."""

    files_created: int = Field(ge=0)
    directories_created: int = Field(ge=0)
    source_bytes: int = Field(ge=0)


class ArchiveCompanionCreationMemberCompletion(SQLModel):
    """One local ZIP member durably committed from the validated SMB manifest."""

    archive_path: str = Field(min_length=1)
    status: Literal["directory", "created"]
    source_bytes: int = Field(ge=0)


class ArchiveExtractionDecision(SQLModel):
    action: Literal["skip", "skip_all", "replace", "replace_all", "replace_older", "rename", "retry", "ignore", "cancel"]
    member_path: str | None = None
    target_path: str | None = None
    expected_revision: int | None = Field(default=None, ge=0)
