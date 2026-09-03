"""Pure target-write policy for archive extraction."""

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Mapping

from app.models.file import FileInfo
from app.services.target_resolution import (
    TargetResolutionDisposition,
    TargetResolutionPolicy,
    TargetSnapshot,
    resolve_target_mutation,
)


class TargetExistsBeforeContent(FileExistsError):
    """An exclusive target collision observed before a stream accepted content."""


class TargetWriteFailure(OSError):
    """A target write failed after the destination may have changed."""

    def __init__(self, error: BaseException, bytes_written: int, *, output_may_exist: bool = True) -> None:
        self.bytes_written = bytes_written
        self.output_may_exist = output_may_exist
        super().__init__(str(error))


class TargetWriteResult(int):
    """Successful native write facts without changing the storage byte-count API."""

    replaced: bool

    def __new__(cls, bytes_written: int, *, replaced: bool = False) -> "TargetWriteResult":
        result = super().__new__(cls, bytes_written)
        result.replaced = replaced
        return result


ResolvedCollisionPolicy = TargetResolutionPolicy
TargetWriteDisposition = TargetResolutionDisposition


@dataclass(frozen=True)
class TargetWriteReady:
    """One native write that completed successfully."""

    written: int
    replaced: bool


@dataclass(frozen=True)
class TargetWriteTargetExistsBeforeContent:
    """One native exclusive-create collision before content consumption."""


@dataclass(frozen=True)
class TargetWriteAttemptFailure:
    """One native write failure that is not an overwrite collision."""

    error: Exception


TargetWriteAttempt = TargetWriteReady | TargetWriteTargetExistsBeforeContent | TargetWriteAttemptFailure


@dataclass(frozen=True)
class TargetWriteControllerResult:
    """The policy result and native facts for one bounded target-write attempt."""

    disposition: TargetWriteDisposition
    target: FileInfo | None
    bytes_written: int = 0
    replaced: bool = False


def resolved_collision_policy(
    member_path: str,
    existing_file_policy: ResolvedCollisionPolicy,
    member_collision_actions: Mapping[str, ResolvedCollisionPolicy],
) -> ResolvedCollisionPolicy:
    """Select one member override or the validated operation policy."""

    return member_collision_actions.get(member_path, existing_file_policy)


def collision_policy_from_action(action: str | None) -> ResolvedCollisionPolicy:
    """Normalize one validated checkpoint action to a target-write policy."""

    if action in {"skip", "skip_all"}:
        return ResolvedCollisionPolicy.SKIP
    if action in {"replace", "replace_all"}:
        return ResolvedCollisionPolicy.REPLACE
    if action == "replace_older":
        return ResolvedCollisionPolicy.REPLACE_OLDER
    if action is None:
        return ResolvedCollisionPolicy.ASK
    raise ValueError("Archive extraction collision policy is invalid")


def resolve_target_write(
    policy: ResolvedCollisionPolicy,
    source_modified_at: datetime | None,
    target: TargetSnapshot,
) -> TargetWriteDisposition:
    """Select a target-write disposition without performing I/O."""

    return resolve_target_mutation(policy, source_modified_at, target)


async def target_write_attempt(
    write_target: Callable[[str, AsyncIterator[bytes], bool, datetime | None], Awaitable[int]],
    target_path: str,
    stream: AsyncIterator[bytes],
    overwrite: bool,
    source_modified_at: datetime | None,
) -> TargetWriteAttempt:
    """Translate adapter-native outcomes into the controller's typed attempt boundary."""

    try:
        written = await write_target(target_path, stream, overwrite, source_modified_at)
    except TargetExistsBeforeContent:
        return TargetWriteTargetExistsBeforeContent()
    except Exception as exc:
        return TargetWriteAttemptFailure(exc)
    return TargetWriteReady(int(written), getattr(written, "replaced", False))


async def resolve_target_write_attempt(
    *,
    target_path: str,
    policy: ResolvedCollisionPolicy,
    source_modified_at: datetime | None,
    observe_target: Callable[[str], Awaitable[FileInfo]],
    stream_factory: Callable[[], AsyncIterator[bytes]],
    write_target: Callable[[str, AsyncIterator[bytes], bool, datetime | None], Awaitable[int]],
) -> TargetWriteControllerResult:
    """Observe, reduce, exclusively write, and re-observe one target at most once.

    The stream factory is invoked only after policy resolution authorizes a write.
    A typed pre-content collision therefore leaves a relay request body unpolled.
    """

    for attempt in range(2):
        try:
            target = await observe_target(target_path)
        except FileNotFoundError:
            target = None

        disposition = resolve_target_write(
            policy,
            source_modified_at,
            TargetSnapshot.missing() if target is None else TargetSnapshot.from_file_info(target),
        )
        if disposition in {TargetWriteDisposition.SKIP, TargetWriteDisposition.AWAIT_COLLISION}:
            return TargetWriteControllerResult(disposition, target)

        attempt_result = await target_write_attempt(
            write_target,
            target_path,
            stream_factory(),
            disposition == TargetWriteDisposition.REPLACE_EXISTING,
            source_modified_at,
        )
        if isinstance(attempt_result, TargetWriteTargetExistsBeforeContent):
            if attempt == 1:
                try:
                    target = await observe_target(target_path)
                except FileNotFoundError:
                    target = None
                return TargetWriteControllerResult(TargetWriteDisposition.AWAIT_COLLISION, target)
            continue
        if isinstance(attempt_result, TargetWriteAttemptFailure):
            raise attempt_result.error

        return TargetWriteControllerResult(
            disposition,
            target,
            bytes_written=attempt_result.written,
            replaced=attempt_result.replaced,
        )

    raise AssertionError("target-write attempts must return or raise")
