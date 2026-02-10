"""
Companion app API endpoints.

Provides all endpoints needed by the Sambee Companion desktop application:
- URI token generation (short-lived token embedded in sambee:// URIs)
- Companion token exchange (exchange URI token for session JWT)
- Edit lock management (acquire, heartbeat, release, force-unlock)
- Lock status query (for web UI display)
- Version compatibility check

Authentication flow:
  1. User clicks "Open in app…" in the web UI.
  2. The frontend requests a short-lived, single-use URI token (POST /uri-token).
  3. The token is embedded in a sambee:// deep-link URI and opened.
  4. The companion app receives the URI, extracts the token, and exchanges it
     for a longer-lived session JWT (POST /token).
  5. All subsequent companion requests use the session JWT.

Edit locking:
  The companion acquires a Tier 1 application-level lock (POST /{connection_id}/lock)
  when it opens a file for editing. While the file is open, the companion sends
  heartbeats every 30 seconds. If heartbeats stop (crash, network loss), a
  background task releases the orphaned lock after a timeout. Admins and lock
  holders can force-unlock via DELETE /{connection_id}/lock/force.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.config import settings, static
from app.core.logging import get_logger, set_user
from app.core.security import (
    create_access_token,
    get_current_user_with_auth_check,
)
from app.db.database import get_session
from app.models.edit_lock import HEARTBEAT_TIMEOUT_SECONDS, EditLock
from app.models.user import User

router = APIRouter()
logger = get_logger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

# URI tokens are single-use and expire quickly
URI_TOKEN_EXPIRE_SECONDS = 60

# Companion session tokens live longer
COMPANION_TOKEN_EXPIRE_MINUTES = 60

# JWT claim key that marks a token as a companion URI token
URI_TOKEN_CLAIM = "companion_uri"

# JWT claim key that marks a token as a companion session token
COMPANION_TOKEN_CLAIM = "companion_session"


# ──────────────────────────────────────────────────────────────────────────────
# In-memory store for single-use URI token enforcement
# ──────────────────────────────────────────────────────────────────────────────

# Maps token JTI → expiry time.  Consumed tokens are added here so they
# cannot be replayed.  Entries are lazily cleaned up on each access.
_used_uri_tokens: dict[str, datetime] = {}


#
# _cleanup_expired_tokens
#
def _cleanup_expired_tokens() -> None:
    """Remove expired entries from the used-token set."""

    now = datetime.now(timezone.utc)
    expired = [jti for jti, exp in _used_uri_tokens.items() if exp < now]
    for jti in expired:
        del _used_uri_tokens[jti]


#
# _mark_token_used
#
def _mark_token_used(jti: str, expires: datetime) -> bool:
    """Mark a URI token as consumed.  Returns False if already used."""

    _cleanup_expired_tokens()
    if jti in _used_uri_tokens:
        return False
    _used_uri_tokens[jti] = expires
    return True


# ──────────────────────────────────────────────────────────────────────────────
# Request / Response schemas
# ──────────────────────────────────────────────────────────────────────────────


class URITokenRequest(BaseModel):
    """Request body for generating a URI token."""

    connection_id: str
    path: str


class URITokenResponse(BaseModel):
    """Response for URI token generation."""

    uri_token: str
    expires_in: int


class CompanionTokenResponse(BaseModel):
    """Response for companion token exchange."""

    token: str
    expires_in: int


class LockRequest(BaseModel):
    """Request body for acquiring a lock."""

    companion_session: str


class LockResponse(BaseModel):
    """Response for lock operations."""

    lock_id: str
    file_path: str
    locked_by: str
    locked_at: str


class LockStatusResponse(BaseModel):
    """Response for lock status queries."""

    locked: bool
    locked_by: str | None = None
    locked_at: str | None = None
    companion_session: str | None = None


class VersionCheckResponse(BaseModel):
    """Response for companion version compatibility check."""

    compatible: bool
    min_companion_version: str
    latest_version: str


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


#
# _get_active_lock
#
def _get_active_lock(connection_id: uuid.UUID, path: str, session: Session) -> EditLock | None:
    """Return the active (non-expired) lock for a file, or None."""

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS)
    statement = (
        select(EditLock)
        .where(EditLock.connection_id == connection_id)
        .where(EditLock.file_path == path)
        .where(EditLock.last_heartbeat >= cutoff)
    )
    return session.exec(statement).first()


# ──────────────────────────────────────────────────────────────────────────────
# 1. URI token generation (called by the web frontend)
# ──────────────────────────────────────────────────────────────────────────────


@router.post("/uri-token", response_model=URITokenResponse)
async def create_uri_token(
    body: URITokenRequest,
    current_user: User = Depends(get_current_user_with_auth_check),
) -> URITokenResponse:
    """Generate a short-lived, single-use token for embedding in sambee:// URIs.

    The web frontend calls this when the user clicks "Open in app…". The token
    is placed in the URI and the companion exchanges it for a session JWT.
    """

    set_user(current_user.username)
    jti = uuid.uuid4().hex
    expires_delta = timedelta(seconds=URI_TOKEN_EXPIRE_SECONDS)
    token = create_access_token(
        data={
            "sub": current_user.username,
            URI_TOKEN_CLAIM: True,
            "jti": jti,
            "conn_id": body.connection_id,
            "path": body.path,
        },
        expires_delta=expires_delta,
    )

    logger.info(f"URI token created: user={current_user.username}, connection_id={body.connection_id}, path='{body.path}'")
    return URITokenResponse(uri_token=token, expires_in=URI_TOKEN_EXPIRE_SECONDS)


# ──────────────────────────────────────────────────────────────────────────────
# 2. Companion token exchange
# ──────────────────────────────────────────────────────────────────────────────


@router.post("/token", response_model=CompanionTokenResponse)
async def exchange_companion_token(
    session: Session = Depends(get_session),
    token: str = Query(..., description="The short-lived URI token to exchange"),
) -> CompanionTokenResponse:
    """Exchange a short-lived URI token for a longer-lived companion session JWT.

    The companion calls this immediately after receiving a sambee:// URI.
    The URI token is validated, marked as consumed (single-use), and a new
    session JWT is returned.
    """

    from jose import JWTError
    from jose import jwt as jose_jwt

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired URI token",
    )

    try:
        payload = jose_jwt.decode(token, settings.secret_key, algorithms=[static.algorithm])
    except JWTError:
        logger.warning("Companion token exchange failed: invalid JWT")
        raise credentials_exception

    # Validate this is actually a URI token (not a regular session token)
    if not payload.get(URI_TOKEN_CLAIM):
        logger.warning("Companion token exchange failed: not a URI token")
        raise credentials_exception

    username: str | None = payload.get("sub")
    jti: str | None = payload.get("jti")
    if not username or not jti:
        logger.warning("Companion token exchange failed: missing claims")
        raise credentials_exception

    # Verify user still exists
    statement = select(User).where(User.username == username)
    user = session.exec(statement).first()
    if not user:
        logger.warning(f"Companion token exchange failed: user '{username}' not found")
        raise credentials_exception

    # Enforce single-use
    exp_timestamp = payload.get("exp", 0)
    token_expiry = datetime.fromtimestamp(exp_timestamp, tz=timezone.utc)
    if not _mark_token_used(jti, token_expiry):
        logger.warning(f"Companion token exchange failed: token already used (jti={jti})")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has already been used",
        )

    # Issue companion session token
    expires_delta = timedelta(minutes=COMPANION_TOKEN_EXPIRE_MINUTES)
    session_token = create_access_token(
        data={
            "sub": username,
            COMPANION_TOKEN_CLAIM: True,
            "conn_id": payload.get("conn_id"),
            "path": payload.get("path"),
        },
        expires_delta=expires_delta,
    )

    logger.info(f"Companion token exchanged: user={username}")
    return CompanionTokenResponse(
        token=session_token,
        expires_in=COMPANION_TOKEN_EXPIRE_MINUTES * 60,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 3. Lock management endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.post("/{connection_id}/lock", response_model=LockResponse)
async def acquire_lock(
    connection_id: uuid.UUID,
    body: LockRequest,
    path: str = Query(..., description="Path to the file to lock"),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> LockResponse:
    """Acquire an edit lock on a file.

    Creates a Tier 1 (application-level) lock in the database. The companion
    must send heartbeats to keep the lock alive. If another user already holds
    an active lock, returns 409 Conflict.
    """

    set_user(current_user.username)
    logger.info(f"Lock acquire: connection_id={connection_id}, path='{path}', user={current_user.username}")

    # Check for existing active lock
    existing = _get_active_lock(connection_id, path, session)
    if existing:
        if existing.locked_by == current_user.username:
            # Same user re-locking — update the existing lock
            existing.companion_session = body.companion_session
            existing.last_heartbeat = datetime.now(timezone.utc)
            session.add(existing)
            session.commit()
            session.refresh(existing)
            logger.info(f"Lock refreshed (same user): connection_id={connection_id}, path='{path}', user={current_user.username}")
            return LockResponse(
                lock_id=str(existing.id),
                file_path=existing.file_path,
                locked_by=existing.locked_by,
                locked_at=existing.locked_at.isoformat(),
            )
        else:
            logger.warning(f"Lock conflict: path='{path}' already locked by '{existing.locked_by}'")
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"File is locked for editing by {existing.locked_by}",
            )

    # Create new lock
    lock = EditLock(
        file_path=path,
        connection_id=connection_id,
        locked_by=current_user.username,
        companion_session=body.companion_session,
    )
    session.add(lock)
    session.commit()
    session.refresh(lock)

    logger.info(f"Lock acquired: connection_id={connection_id}, path='{path}', user={current_user.username}, lock_id={lock.id}")
    return LockResponse(
        lock_id=str(lock.id),
        file_path=lock.file_path,
        locked_by=lock.locked_by,
        locked_at=lock.locked_at.isoformat(),
    )


@router.post("/{connection_id}/lock/heartbeat")
async def heartbeat_lock(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the locked file"),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    """Refresh the heartbeat on an active edit lock.

    The companion calls this every 30 seconds to keep the lock alive.
    Returns 404 if the lock no longer exists (e.g., force-unlocked by admin).
    """

    set_user(current_user.username)

    lock = _get_active_lock(connection_id, path, session)
    if not lock:
        logger.warning(f"Heartbeat for non-existent lock: connection_id={connection_id}, path='{path}', user={current_user.username}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lock not found or expired",
        )

    if lock.locked_by != current_user.username:
        logger.warning(f"Heartbeat from wrong user: path='{path}', lock_owner={lock.locked_by}, requester={current_user.username}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Lock is held by another user",
        )

    lock.last_heartbeat = datetime.now(timezone.utc)
    session.add(lock)
    session.commit()

    return {"status": "ok"}


@router.delete("/{connection_id}/lock")
async def release_lock(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the locked file"),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    """Release an edit lock on a file.

    Called by the companion when the user clicks "Done Editing" or
    "Discard Changes".  Only the lock holder can release their own lock.
    """

    set_user(current_user.username)
    logger.info(f"Lock release: connection_id={connection_id}, path='{path}', user={current_user.username}")

    lock = _get_active_lock(connection_id, path, session)
    if not lock:
        # Lock already gone — idempotent success
        return {"status": "ok"}

    if lock.locked_by != current_user.username:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Lock is held by another user",
        )

    session.delete(lock)
    session.commit()

    logger.info(f"Lock released: connection_id={connection_id}, path='{path}', user={current_user.username}")
    return {"status": "ok"}


@router.delete("/{connection_id}/lock/force")
async def force_unlock(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the locked file"),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    """Force-unlock a file, bypassing ownership check.

    Only the lock holder and admin users can force-unlock.  This is the
    escape hatch for erroneously locked files.
    """

    set_user(current_user.username)
    logger.info(f"Force unlock: connection_id={connection_id}, path='{path}', user={current_user.username}")

    lock = _get_active_lock(connection_id, path, session)
    if not lock:
        return {"status": "ok"}

    # Only admins and the lock holder can force-unlock
    is_owner = lock.locked_by == current_user.username
    if not is_owner and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins and the lock holder can force-unlock",
        )

    former_holder = lock.locked_by
    session.delete(lock)
    session.commit()

    logger.info(
        f"Lock force-released: connection_id={connection_id}, path='{path}', "
        f"former_holder={former_holder}, released_by={current_user.username}"
    )
    return {"status": "ok"}


# ──────────────────────────────────────────────────────────────────────────────
# 4. Lock status query (for web UI)
# ──────────────────────────────────────────────────────────────────────────────


@router.get("/{connection_id}/lock-status", response_model=LockStatusResponse)
async def get_lock_status(
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to check"),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> LockStatusResponse:
    """Check whether a file is currently locked for editing.

    Used by the web UI to show lock indicators in the file browser.
    """

    set_user(current_user.username)

    lock = _get_active_lock(connection_id, path, session)
    if not lock:
        return LockStatusResponse(locked=False)

    return LockStatusResponse(
        locked=True,
        locked_by=lock.locked_by,
        locked_at=lock.locked_at.isoformat(),
        companion_session=lock.companion_session,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 5. Version compatibility check
# ──────────────────────────────────────────────────────────────────────────────

# Minimum companion version that this backend supports
MIN_COMPANION_VERSION = "0.1.0"

# Latest companion version available (updated during releases)
LATEST_COMPANION_VERSION = "0.1.0"


@router.get("/version-check", response_model=VersionCheckResponse)
async def version_check(
    companion_version: str = Query(..., description="Companion app version"),
) -> VersionCheckResponse:
    """Check companion version compatibility with this backend.

    The companion calls this on startup to verify it can work with this
    backend version and to check for available updates.
    """

    compatible = _is_version_compatible(companion_version, MIN_COMPANION_VERSION)

    if not compatible:
        logger.warning(f"Incompatible companion version: {companion_version} (minimum: {MIN_COMPANION_VERSION})")

    return VersionCheckResponse(
        compatible=compatible,
        min_companion_version=MIN_COMPANION_VERSION,
        latest_version=LATEST_COMPANION_VERSION,
    )


#
# _is_version_compatible
#
def _is_version_compatible(version: str, min_version: str) -> bool:
    """Check if a version string meets the minimum requirement.

    Simple semver comparison (major.minor.patch).  Returns True if
    *version* >= *min_version*.
    """

    try:
        v_parts = [int(p) for p in version.split(".")]
        m_parts = [int(p) for p in min_version.split(".")]
        return v_parts >= m_parts
    except (ValueError, AttributeError):
        return False
