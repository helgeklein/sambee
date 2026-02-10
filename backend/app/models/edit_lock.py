"""
EditLock model for tracking file edit locks.

Tier 1 of the two-tier locking system: application-level locks stored in the
database, providing user-visible lock status in the web UI and heartbeat-based
orphan detection.

When the companion app opens a file for editing, an EditLock row is created.
The companion must send periodic heartbeats (every HEARTBEAT_INTERVAL_SECONDS)
to prove it is still active. If no heartbeat arrives within
HEARTBEAT_TIMEOUT_SECONDS, a background task (lock_manager) considers the lock
orphaned and deletes it automatically. This prevents stale locks from blocking
other users when the companion crashes or loses connectivity.

Tier 2 (SMB share_access="r" on the open file handle) is enforced at the
storage layer when writing, providing an additional OS-level safeguard against
concurrent writes.
"""

import uuid
from datetime import datetime, timezone
from typing import ClassVar

from sqlmodel import Field, SQLModel


class EditLock(SQLModel, table=True):
    """Tracks active file edit locks.

    Each row represents a file currently being edited through the companion app.
    Locks have no fixed expiry — they survive as long as the companion sends
    heartbeats. If no heartbeat arrives within HEARTBEAT_TIMEOUT_SECONDS, the
    lock is considered orphaned and automatically released.
    """

    __tablename__: ClassVar[str] = "edit_locks"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    file_path: str = Field(index=True)
    connection_id: uuid.UUID = Field(index=True)
    locked_by: str = Field(index=True)
    locked_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    companion_session: str = Field(index=True)
    last_heartbeat: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# --- Lock timing constants ---

# How often the companion sends heartbeats (seconds)
HEARTBEAT_INTERVAL_SECONDS = 30

# How long the backend waits without a heartbeat before releasing the lock (seconds)
HEARTBEAT_TIMEOUT_SECONDS = 120

# How often the background task checks for orphaned locks (seconds)
ORPHAN_CHECK_INTERVAL_SECONDS = 30
