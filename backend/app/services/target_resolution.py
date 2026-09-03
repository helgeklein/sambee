"""Operation-neutral target-resolution policy.

This module deliberately contains no storage, archive, HTTP, or checkpoint
logic. Callers observe the target and perform any authorized mutation.
"""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from app.models.file import FileInfo, FileType


class TargetResolutionPolicy(StrEnum):
    """Validated user policy for an existing regular target."""

    ASK = "ask"
    SKIP = "skip"
    REPLACE = "replace"
    REPLACE_OLDER = "replace_older"


class TargetResolutionDisposition(StrEnum):
    """The non-I/O result of reducing a policy against a target snapshot."""

    CREATE_NEW = "create_new"
    REPLACE_EXISTING = "replace_existing"
    SKIP = "skip"
    AWAIT_COLLISION = "await_collision"


@dataclass(frozen=True)
class TargetSnapshot:
    """Public target facts used for policy and conflict presentation."""

    exists: bool
    is_regular_file: bool = False
    size: int | None = None
    modified_at: datetime | None = None

    @classmethod
    def missing(cls) -> "TargetSnapshot":
        return cls(exists=False)

    @classmethod
    def from_file_info(cls, file_info: FileInfo) -> "TargetSnapshot":
        return cls(
            exists=True,
            is_regular_file=file_info.type == FileType.FILE,
            size=file_info.size,
            modified_at=file_info.modified_at,
        )


def is_strictly_newer(source_modified_at: object | None, target_modified_at: object | None) -> bool:
    """Compare matching datetime kinds; unknown or mixed-zone times are incomparable."""

    if not isinstance(source_modified_at, datetime) or not isinstance(target_modified_at, datetime):
        return False
    if (source_modified_at.tzinfo is None) != (target_modified_at.tzinfo is None):
        return False
    try:
        return source_modified_at > target_modified_at
    except ValueError:
        return False


def resolve_target_mutation(
    policy: TargetResolutionPolicy,
    source_modified_at: datetime | None,
    target: TargetSnapshot,
) -> TargetResolutionDisposition:
    """Select a target-mutation disposition without performing I/O."""

    if not target.exists:
        return TargetResolutionDisposition.CREATE_NEW
    if not target.is_regular_file:
        return TargetResolutionDisposition.AWAIT_COLLISION
    if policy == TargetResolutionPolicy.SKIP:
        return TargetResolutionDisposition.SKIP
    if policy == TargetResolutionPolicy.REPLACE:
        return TargetResolutionDisposition.REPLACE_EXISTING
    if policy == TargetResolutionPolicy.REPLACE_OLDER:
        return (
            TargetResolutionDisposition.REPLACE_EXISTING
            if is_strictly_newer(source_modified_at, target.modified_at)
            else TargetResolutionDisposition.SKIP
        )
    return TargetResolutionDisposition.AWAIT_COLLISION
