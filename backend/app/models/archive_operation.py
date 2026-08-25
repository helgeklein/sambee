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


class ArchiveCompanionSession(SQLModel):
    """Short-lived backend capability handed to the paired Companion executor."""

    token: str
    expires_in: int
    operation: ArchiveOperationRead


class ArchiveExtractionDecision(SQLModel):
    action: Literal["skip", "skip_all", "replace", "replace_all", "replace_older", "rename", "cancel"]
    member_path: str | None = None
    target_path: str | None = None
