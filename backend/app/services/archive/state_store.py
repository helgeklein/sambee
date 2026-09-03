"""Durable state-store binding for archive execution lifecycle state."""

from collections.abc import Mapping
from typing import Any, Protocol

from fastapi import HTTPException, status
from sqlalchemy import update
from sqlmodel import Session, col

from app.models.archive_operation import ArchiveOperation


class ArchiveStateStore(Protocol):
    """Atomically persist one archive execution state at an expected revision."""

    def compare_and_swap(
        self,
        session: Session,
        operation: ArchiveOperation,
        *,
        expected_revision: int,
        changes: Mapping[str, Any],
    ) -> ArchiveOperation: ...


class ArchiveOperationStateStore(ArchiveStateStore):
    """Atomically mutate one durable archive execution at an expected revision."""

    def compare_and_swap(
        self,
        session: Session,
        operation: ArchiveOperation,
        *,
        expected_revision: int,
        changes: Mapping[str, Any],
    ) -> ArchiveOperation:
        """Persist changes only when the execution has not advanced concurrently."""

        updated_operation_id = session.execute(
            update(ArchiveOperation)
            .where(col(ArchiveOperation.id) == operation.id, col(ArchiveOperation.revision) == expected_revision)
            .values(**changes, revision=expected_revision + 1)
            .returning(col(ArchiveOperation.id))
        ).scalar_one_or_none()
        if updated_operation_id is None:
            session.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation revision is stale")
        session.refresh(operation)
        return operation
