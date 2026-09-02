"""Tests for source-owned incremental ZIP extraction state."""

import io
import zipfile

import pytest

from app.services.archive.live_extraction import (
    DestinationWriteResult,
    LiveExtractionAggregate,
    LiveSourceSession,
    LiveSourceSessionError,
    LiveSourceSessionPhase,
)
from app.services.archive.zip_reader import ZipReader


class MemoryRandomAccessReader:
    def __init__(self, data: bytes) -> None:
        self.data = data

    async def read_at(self, offset: int, length: int) -> bytes:
        return self.data[offset : offset + length]

    async def close(self) -> None:
        return None


def _zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("first.txt", b"one")
        archive.writestr("second.txt", b"two")
    return buffer.getvalue()


def _unsupported_member_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("blocked.txt", b"blocked", compress_type=zipfile.ZIP_LZMA)
        archive.writestr("available.txt", b"available")
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_live_source_session_advances_only_after_accepted_results() -> None:
    data = _zip_bytes()
    session = LiveSourceSession(ZipReader(MemoryRandomAccessReader(data), len(data)))

    first = await session.next_member()
    assert first is not None
    assert first.delivery_sequence == 1
    assert b"".join([chunk async for chunk in session.stream_current_member(first.source_session_id, first.delivery_sequence)]) == b"one"

    await session.apply_destination_write_result(
        DestinationWriteResult(first.source_session_id, first.delivery_sequence, first.path, "extracted", extracted_bytes=3)
    )
    second = await session.next_member()

    assert second is not None
    assert second.path == "second.txt"
    assert second.delivery_sequence == 2


@pytest.mark.asyncio
async def test_live_source_session_rejects_stale_delivery_results() -> None:
    data = _zip_bytes()
    session = LiveSourceSession(ZipReader(MemoryRandomAccessReader(data), len(data)))
    member = await session.next_member()
    assert member is not None
    _ = [chunk async for chunk in session.stream_current_member(member.source_session_id, member.delivery_sequence)]

    with pytest.raises(LiveSourceSessionError, match="delivery sequence"):
        await session.apply_destination_write_result(
            DestinationWriteResult(member.source_session_id, member.delivery_sequence + 1, member.path, "extracted", extracted_bytes=3)
        )

    assert session.aggregate.members_processed == 0
    assert session.phase == LiveSourceSessionPhase.AWAITING_RESULT


@pytest.mark.asyncio
async def test_live_source_session_skips_known_unsupported_entries_without_delivery() -> None:
    data = _unsupported_member_zip_bytes()
    session = LiveSourceSession(ZipReader(MemoryRandomAccessReader(data), len(data)))

    member = await session.next_member()

    assert member is not None
    assert member.path == "available.txt"
    assert member.delivery_sequence == 1
    assert session.aggregate.members_processed == 1
    assert session.aggregate.members_skipped == 1


@pytest.mark.asyncio
async def test_unknown_destination_outcome_terminalizes_without_counting_current_member() -> None:
    data = _zip_bytes()
    session = LiveSourceSession(ZipReader(MemoryRandomAccessReader(data), len(data)))
    member = await session.next_member()
    assert member is not None

    await session.destination_outcome_unknown(member.source_session_id, member.delivery_sequence)

    assert session.phase == LiveSourceSessionPhase.FAILED
    assert session.aggregate.members_processed == 0


@pytest.mark.asyncio
async def test_abandoned_member_stream_terminalizes_without_counting_current_member() -> None:
    data = _zip_bytes()
    session = LiveSourceSession(ZipReader(MemoryRandomAccessReader(data), len(data)))
    member = await session.next_member()
    assert member is not None
    stream = session.stream_current_member(member.source_session_id, member.delivery_sequence)

    assert await anext(stream) == b"one"
    await stream.aclose()

    assert session.phase == LiveSourceSessionPhase.FAILED
    assert session.aggregate.members_processed == 0


@pytest.mark.asyncio
async def test_collision_decision_redelivers_current_member_with_a_new_sequence() -> None:
    data = _zip_bytes()
    session = LiveSourceSession(ZipReader(MemoryRandomAccessReader(data), len(data)))
    member = await session.next_member()
    assert member is not None
    _ = [chunk async for chunk in session.stream_current_member(member.source_session_id, member.delivery_sequence)]
    await session.apply_destination_write_result(
        DestinationWriteResult(
            member.source_session_id,
            member.delivery_sequence,
            member.path,
            "awaiting_collision",
            target_path="output/first.txt",
        )
    )

    decision = await session.pending_decision()
    assert decision is not None
    redelivery = await session.resolve_decision(
        member.source_session_id,
        member.delivery_sequence,
        decision.revision,
        "replace",
    )

    assert redelivery is not None
    assert redelivery.path == member.path
    assert redelivery.delivery_sequence == member.delivery_sequence + 1
    assert session.aggregate.members_processed == 0
    with pytest.raises(LiveSourceSessionError, match="delivery sequence"):
        await session.apply_destination_write_result(
            DestinationWriteResult(member.source_session_id, member.delivery_sequence, member.path, "extracted", extracted_bytes=3)
        )


@pytest.mark.asyncio
async def test_stale_decision_revision_does_not_change_current_member() -> None:
    data = _zip_bytes()
    session = LiveSourceSession(ZipReader(MemoryRandomAccessReader(data), len(data)))
    member = await session.next_member()
    assert member is not None
    _ = [chunk async for chunk in session.stream_current_member(member.source_session_id, member.delivery_sequence)]
    await session.apply_destination_write_result(
        DestinationWriteResult(member.source_session_id, member.delivery_sequence, member.path, "awaiting_retry")
    )
    decision = await session.pending_decision()
    assert decision is not None

    with pytest.raises(LiveSourceSessionError, match="decision revision"):
        await session.resolve_decision(member.source_session_id, member.delivery_sequence, decision.revision + 1, "retry")

    assert session.phase == LiveSourceSessionPhase.AWAITING_DECISION
    assert session.aggregate.members_processed == 0


def test_aggregate_rejects_counter_overflow() -> None:
    aggregate = LiveExtractionAggregate(members_processed=(1 << 63) - 1)

    with pytest.raises(LiveSourceSessionError, match="counter"):
        aggregate.record("skipped")
