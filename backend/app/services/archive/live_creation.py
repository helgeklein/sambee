"""Live destination-writer ownership for foreground member-framed archive creation."""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from app.services.archive.lifecycle_cleanup import archive_operation_cleanup_registry
from app.services.archive.zip_writer import PortableZipWriter
from app.storage.base import ExclusiveWriter, StorageBackend


class ArchiveCreationWriterSessionNotFound(RuntimeError):
    """Raised when a foreground creation writer is unavailable."""


class ArchiveCreationWriterAlreadyActive(RuntimeError):
    """Raised when another request is already opening or owns an operation writer."""


class ArchiveCreationWriterMemberDataError(ValueError):
    """Raised when a relay provides invalid bytes for a typed ZIP member."""


@dataclass
class _ArchiveCreationWriterSession:
    """One active exclusive destination writer and its ZIP serializer."""

    backend: StorageBackend
    writer: ExclusiveWriter
    archive_writer: PortableZipWriter
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class LiveArchiveCreationWriterManager:
    """Own operation-scoped ZIP writers without owning durable operation state."""

    def __init__(self, logger: logging.Logger | logging.LoggerAdapter[logging.Logger]) -> None:
        self._logger = logger
        self._sessions: dict[uuid.UUID, _ArchiveCreationWriterSession] = {}
        self._opening_operation_ids: set[uuid.UUID] = set()
        self._cancelled_opening_operation_ids: set[uuid.UUID] = set()

    def has_session(self, operation_id: uuid.UUID) -> bool:
        """Return whether the foreground operation still owns a live writer."""

        return operation_id in self._sessions

    def execution(self, operation_id: uuid.UUID) -> "LiveArchiveCreationExecution":
        """Bind direct writer operations to one foreground archive creation."""

        return LiveArchiveCreationExecution(self, operation_id)

    async def open(self, operation_id: uuid.UUID, backend: StorageBackend, target_path: str) -> None:
        """Open and retain one exclusive destination target for a foreground operation."""

        if operation_id in self._sessions or operation_id in self._opening_operation_ids:
            raise ArchiveCreationWriterAlreadyActive("Archive creation writer is already active")
        self._opening_operation_ids.add(operation_id)
        archive_operation_cleanup_registry.register(operation_id, lambda: self.abort(operation_id))
        writer: ExclusiveWriter | None = None
        try:
            writer = await backend.open_exclusive_writer(target_path)
            if operation_id in self._cancelled_opening_operation_ids:
                await writer.abort_and_delete_if_owned()
                writer = None
                raise ArchiveCreationWriterSessionNotFound("Archive creation writer session was interrupted")
            self._sessions[operation_id] = _ArchiveCreationWriterSession(
                backend=backend,
                writer=writer,
                archive_writer=PortableZipWriter(writer),
            )
        except BaseException:
            if writer is not None and operation_id not in self._sessions:
                try:
                    await writer.abort_and_delete_if_owned()
                except Exception:
                    self._logger.exception("Failed to clean up incomplete archive creation target: operation_id=%s", operation_id)
            archive_operation_cleanup_registry.unregister(operation_id)
            await self._disconnect(backend, operation_id)
            raise
        finally:
            self._opening_operation_ids.discard(operation_id)
            self._cancelled_opening_operation_ids.discard(operation_id)

    async def add_directory(self, operation_id: uuid.UUID, archive_path: str) -> None:
        """Commit one explicit directory entry to the operation's ZIP target."""

        session = self._session(operation_id)
        async with session.lock:
            self._ensure_current_session(operation_id, session)
            await session.archive_writer.add_directory(archive_path)

    async def add_file(
        self,
        operation_id: uuid.UUID,
        archive_path: str,
        source: AsyncIterator[bytes],
        *,
        expected_uncompressed_size: int,
    ) -> None:
        """Commit one bounded file stream to the operation's ZIP target."""

        session = self._session(operation_id)
        async with session.lock:
            self._ensure_current_session(operation_id, session)
            await session.archive_writer.add_file(
                archive_path,
                source,
                expected_uncompressed_size=expected_uncompressed_size,
            )

    async def finalize(self, operation_id: uuid.UUID) -> None:
        """Write the ZIP directory, close the target, and release its connection."""

        session = self._session(operation_id)
        async with session.lock:
            self._ensure_current_session(operation_id, session)
            await session.archive_writer.close()
            self._sessions.pop(operation_id)
            archive_operation_cleanup_registry.unregister(operation_id)
        await self._disconnect(session.backend, operation_id)

    async def abort(self, operation_id: uuid.UUID) -> bool:
        """Abort and remove an owned incomplete target, returning whether one existed."""

        session = self._sessions.get(operation_id)
        if session is None:
            if operation_id in self._opening_operation_ids:
                self._cancelled_opening_operation_ids.add(operation_id)
                return True
            return False
        async with session.lock:
            if self._sessions.get(operation_id) is not session:
                return False
            self._sessions.pop(operation_id)
            archive_operation_cleanup_registry.unregister(operation_id)
            try:
                await session.writer.abort_and_delete_if_owned()
            except Exception:
                self._logger.exception("Failed to clean up incomplete archive creation target: operation_id=%s", operation_id)
        await self._disconnect(session.backend, operation_id)
        return True

    async def shutdown(self) -> None:
        """Abort every foreground target still held during application shutdown."""

        for operation_id in list(self._sessions):
            await self.abort(operation_id)
        self._cancelled_opening_operation_ids.update(self._opening_operation_ids)

    def _session(self, operation_id: uuid.UUID) -> _ArchiveCreationWriterSession:
        session = self._sessions.get(operation_id)
        if session is None:
            raise ArchiveCreationWriterSessionNotFound("Archive creation writer session was interrupted")
        return session

    def _ensure_current_session(self, operation_id: uuid.UUID, session: _ArchiveCreationWriterSession) -> None:
        if self._sessions.get(operation_id) is not session:
            raise ArchiveCreationWriterSessionNotFound("Archive creation writer session was interrupted")

    async def _disconnect(self, backend: StorageBackend, operation_id: uuid.UUID) -> None:
        try:
            await backend.disconnect()
        except Exception:
            self._logger.exception("Failed to disconnect archive creation backend: operation_id=%s", operation_id)


@dataclass(frozen=True)
class LiveArchiveCreationExecution:
    """Operation-scoped direct SMB ZIP writer binding for one creation relay."""

    _manager: LiveArchiveCreationWriterManager
    operation_id: uuid.UUID

    def is_active(self) -> bool:
        """Return whether this operation still owns its direct destination target."""

        return self._manager.has_session(self.operation_id)

    async def open(self, backend: StorageBackend, target_path: str) -> None:
        """Claim the operation's exclusive destination target."""

        await self._manager.open(self.operation_id, backend, target_path)

    async def write_member(
        self,
        archive_path: str,
        *,
        is_directory: bool,
        source: AsyncIterator[bytes],
        expected_uncompressed_size: int,
    ) -> None:
        """Commit one approved file or explicit directory directly to the ZIP target."""

        if is_directory:
            async for chunk in source:
                if chunk:
                    raise ArchiveCreationWriterMemberDataError("Archive directory member must not contain data")
            await self._manager.add_directory(self.operation_id, archive_path)
            return
        await self._manager.add_file(
            self.operation_id,
            archive_path,
            source,
            expected_uncompressed_size=expected_uncompressed_size,
        )

    async def finalize(self) -> None:
        """Finalize the ZIP target and release its backend connection."""

        await self._manager.finalize(self.operation_id)

    async def abort(self) -> None:
        """Delete the incomplete target when this operation still owns it."""

        await self._manager.abort(self.operation_id)
