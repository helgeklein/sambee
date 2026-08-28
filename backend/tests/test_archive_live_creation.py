"""Lifecycle tests for live foreground archive creation writers."""

import logging
import uuid
from unittest.mock import AsyncMock

import pytest

from app.services.archive.live_creation import LiveArchiveCreationWriterManager


async def _chunks(data: bytes):
    yield data


@pytest.mark.asyncio
async def test_open_failure_disconnects_backend_without_retaining_a_session() -> None:
    manager = LiveArchiveCreationWriterManager(logging.getLogger(__name__))
    backend = AsyncMock()
    operation_id = uuid.uuid4()
    backend.open_exclusive_writer.side_effect = OSError("share unavailable")

    with pytest.raises(OSError, match="share unavailable"):
        await manager.open(operation_id, backend, "archive.zip")

    assert manager.has_session(operation_id) is False
    backend.disconnect.assert_awaited_once()


@pytest.mark.asyncio
async def test_abort_removes_the_session_and_is_idempotent() -> None:
    manager = LiveArchiveCreationWriterManager(logging.getLogger(__name__))
    backend = AsyncMock()
    writer = AsyncMock()
    operation_id = uuid.uuid4()
    backend.open_exclusive_writer.return_value = writer

    await manager.open(operation_id, backend, "archive.zip")

    assert await manager.abort(operation_id) is True
    assert await manager.abort(operation_id) is False
    assert manager.has_session(operation_id) is False
    writer.abort_and_delete_if_owned.assert_awaited_once()
    backend.disconnect.assert_awaited_once()


@pytest.mark.asyncio
async def test_finalize_closes_writer_and_disconnects_once() -> None:
    manager = LiveArchiveCreationWriterManager(logging.getLogger(__name__))
    backend = AsyncMock()
    writer = AsyncMock()
    operation_id = uuid.uuid4()
    writer.write.side_effect = lambda chunk: len(chunk)
    backend.open_exclusive_writer.return_value = writer

    await manager.open(operation_id, backend, "archive.zip")
    await manager.finalize(operation_id)

    assert manager.has_session(operation_id) is False
    writer.close.assert_awaited_once()
    backend.disconnect.assert_awaited_once()


@pytest.mark.asyncio
async def test_operation_scoped_execution_validates_directory_data_and_finalizes() -> None:
    manager = LiveArchiveCreationWriterManager(logging.getLogger(__name__))
    backend = AsyncMock()
    writer = AsyncMock()
    operation_id = uuid.uuid4()
    writer.write.side_effect = lambda chunk: len(chunk)
    backend.open_exclusive_writer.return_value = writer
    execution = manager.execution(operation_id)

    await execution.open(backend, "archive.zip")
    assert execution.is_active() is True
    with pytest.raises(ValueError, match="directory member must not contain data"):
        await execution.write_member(
            "docs",
            is_directory=True,
            source=_chunks(b"unexpected"),
            expected_uncompressed_size=0,
        )
    await execution.write_member("docs", is_directory=True, source=_chunks(b""), expected_uncompressed_size=0)
    await execution.finalize()

    assert execution.is_active() is False
    writer.close.assert_awaited_once()
    backend.disconnect.assert_awaited_once()
