"""Durable state for backend-owned physical transfer operations."""

import json
import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal

from pydantic import computed_field
from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.file import ContentTransferResult


class TransferOperationPhase(StrEnum):
    """Observable lifecycle phases for one physical transfer."""

    PREPARED = "prepared"
    STREAMING = "streaming"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TransferOperation(SQLModel, table=True):
    """A durable, user-owned SMB transfer plan and its factual receipt."""

    __tablename__ = "transfer_operations"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_transfer_operations_user_idempotency_key"),
        CheckConstraint("protocol_version = 'v1'", name="ck_transfer_operations_protocol_version_v1"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", index=True)
    protocol_version: str = Field(default="v1", min_length=1, max_length=8)
    idempotency_key: str = Field(index=True, min_length=1, max_length=64)
    request_fingerprint: str = Field(min_length=1, max_length=128)
    kind: str = Field(min_length=1, max_length=8)
    phase: TransferOperationPhase = Field(default=TransferOperationPhase.PREPARED, index=True)
    source_connection_id: str = Field(index=True, min_length=1, max_length=256)
    source_path: str = Field(max_length=4096)
    destination_connection_id: str = Field(index=True, min_length=1, max_length=256)
    destination_path: str = Field(max_length=4096)
    target_resolution_policy: str = Field(default="ask", min_length=1, max_length=32)
    source_size: int = Field(ge=0)
    source_modified_at: datetime | None = Field(default=None)
    source_stable_id: str = Field(min_length=1, max_length=512)
    bytes_transferred: int = Field(default=0, ge=0)
    result_json: str | None = Field(default=None)
    cancellation_requested: bool = Field(default=False, index=True)
    expires_at: datetime = Field(index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)


class TransferOperationCreate(SQLModel):
    """The immutable request used to reserve one backend-owned transfer."""

    protocol_version: Literal["v1"]
    idempotency_key: str = Field(min_length=1, max_length=64)
    kind: Literal["copy", "move"]
    source_connection_id: str = Field(min_length=1, max_length=256)
    source_path: str = Field(max_length=4096)
    destination_path: str = Field(max_length=4096)
    target_resolution_policy: Literal["ask", "skip", "replace", "replace_older"] = "ask"


class TransferOperationRead(SQLModel):
    """A safe durable receipt exposed to the transfer coordinator."""

    id: uuid.UUID
    protocol_version: Literal["v1"]
    kind: Literal["copy", "move"]
    phase: TransferOperationPhase
    source_connection_id: str
    source_path: str
    destination_connection_id: str
    destination_path: str
    target_resolution_policy: Literal["ask", "skip", "replace", "replace_older"]
    source_size: int
    bytes_transferred: int
    cancellation_requested: bool
    expires_at: datetime
    created_at: datetime
    updated_at: datetime
    result_json: str | None = None

    @computed_field
    def result(self) -> ContentTransferResult | None:
        """Decode only a valid factual result from the durable receipt."""

        if self.result_json is None:
            return None
        try:
            return ContentTransferResult.model_validate(json.loads(self.result_json))
        except (json.JSONDecodeError, ValueError):
            return None
