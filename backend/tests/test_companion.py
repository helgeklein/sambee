"""
Tests for the companion app API endpoints.

Covers:
- URI token generation and exchange
- Edit lock lifecycle (acquire, heartbeat, release, force-unlock)
- Lock status queries
- Version compatibility check
- Orphaned lock cleanup
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.companion import (
    URI_TOKEN_CLAIM,
    URI_TOKEN_EXPIRE_SECONDS,
    _is_version_compatible,
    _used_uri_tokens,
)
from app.core.security import create_access_token
from app.models.connection import Connection
from app.models.edit_lock import HEARTBEAT_TIMEOUT_SECONDS, EditLock
from app.models.user import User
from app.services.companion_downloads import CompanionDownloadResolutionError, ResolvedCompanionDownloadMetadata

# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def clear_used_tokens():
    """Clear the in-memory used-token store between tests."""

    _used_uri_tokens.clear()
    yield
    _used_uri_tokens.clear()


@pytest.fixture(name="companion_session_id")
def companion_session_id_fixture() -> str:
    """A unique companion session ID for tests."""

    return uuid.uuid4().hex


@pytest.fixture(name="uri_token")
def uri_token_fixture(admin_user: User, test_connection: Connection) -> str:
    """Create a valid URI token for the admin user."""

    return create_access_token(
        data={
            "sub": admin_user.username,
            URI_TOKEN_CLAIM: True,
            "jti": uuid.uuid4().hex,
            "conn_id": str(test_connection.id),
            "path": "/docs/report.docx",
        },
        expires_delta=timedelta(seconds=URI_TOKEN_EXPIRE_SECONDS),
    )


# ──────────────────────────────────────────────────────────────────────────────
# URI Token Generation
# ──────────────────────────────────────────────────────────────────────────────


class TestURIToken:
    """Tests for POST /api/companion/uri-token"""

    #
    # test_create_uri_token
    #
    def test_create_uri_token(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
    ):
        """URI token generation returns a valid token."""

        response = client.post(
            "/api/companion/uri-token",
            json={"connection_id": str(test_connection.id), "path": "/docs/report.docx"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200
        data = response.json()
        assert "uri_token" in data
        assert data["expires_in"] == URI_TOKEN_EXPIRE_SECONDS

    #
    # test_create_uri_token_requires_auth
    #
    def test_create_uri_token_requires_auth(
        self,
        client: TestClient,
        test_connection: Connection,
    ):
        """URI token generation requires authentication."""

        response = client.post(
            "/api/companion/uri-token",
            json={"connection_id": str(test_connection.id), "path": "/test"},
        )
        assert response.status_code == 401


# ──────────────────────────────────────────────────────────────────────────────
# Companion Token Exchange
# ──────────────────────────────────────────────────────────────────────────────


class TestCompanionTokenExchange:
    """Tests for POST /api/companion/token"""

    #
    # test_exchange_success
    #
    def test_exchange_success(
        self,
        client: TestClient,
        uri_token: str,
    ):
        """Valid URI token is exchanged for a companion session token."""

        response = client.post(
            "/api/companion/token",
            params={"token": uri_token},
        )
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["expires_in"] > 0

    #
    # test_exchange_single_use
    #
    def test_exchange_single_use(
        self,
        client: TestClient,
        uri_token: str,
    ):
        """URI token can only be exchanged once."""

        # First exchange succeeds
        response1 = client.post(
            "/api/companion/token",
            params={"token": uri_token},
        )
        assert response1.status_code == 200

        # Second exchange fails
        response2 = client.post(
            "/api/companion/token",
            params={"token": uri_token},
        )
        assert response2.status_code == 401

    #
    # test_exchange_invalid_token
    #
    def test_exchange_invalid_token(self, client: TestClient):
        """Invalid JWT is rejected."""

        response = client.post(
            "/api/companion/token",
            params={"token": "not-a-jwt"},
        )
        assert response.status_code == 401

    #
    # test_exchange_regular_token_rejected
    #
    def test_exchange_regular_token_rejected(
        self,
        client: TestClient,
        admin_token: str,
    ):
        """A regular session token (not a URI token) is rejected."""

        response = client.post(
            "/api/companion/token",
            params={"token": admin_token},
        )
        assert response.status_code == 401


# ──────────────────────────────────────────────────────────────────────────────
# Lock Lifecycle
# ──────────────────────────────────────────────────────────────────────────────


class TestLockLifecycle:
    """Tests for lock acquire, heartbeat, release, and force-unlock."""

    #
    # test_acquire_lock
    #
    def test_acquire_lock(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        companion_session_id: str,
    ):
        """Lock can be acquired on a file."""

        response = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": companion_session_id},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["file_path"] == "/docs/report.docx"
        assert data["locked_by"] == "testadmin"

    def test_acquire_lock_read_only_connection_blocked(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        read_only_connection: Connection,
        companion_session_id: str,
        session: Session,
    ):
        """Read-only connections should not allow new companion edit locks."""

        response = client.post(
            f"/api/companion/{read_only_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": companion_session_id},
            headers=auth_headers_admin,
        )
        assert response.status_code == 403
        assert response.json()["detail"] == "Connection is read-only"
        assert session.exec(select(EditLock).where(EditLock.connection_id == read_only_connection.id)).first() is None

    #
    # test_acquire_lock_conflict
    #
    def test_acquire_lock_conflict(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        auth_headers_user: dict,
        test_connection: Connection,
        companion_session_id: str,
    ):
        """Lock acquisition fails with 409 when another user holds the lock."""

        # Admin acquires lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": companion_session_id},
            headers=auth_headers_admin,
        )

        # Regular user tries to acquire the same lock
        response = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": "other-session"},
            headers=auth_headers_user,
        )
        assert response.status_code == 409

    #
    # test_same_user_relock
    #
    def test_same_user_relock(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        companion_session_id: str,
    ):
        """Same user can re-lock a file they already hold."""

        # First lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": companion_session_id},
            headers=auth_headers_admin,
        )

        # Re-lock by same user
        response = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": "new-session"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200

    #
    # test_heartbeat
    #
    def test_heartbeat(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        companion_session_id: str,
    ):
        """Heartbeat updates the lock timestamp."""

        # Acquire lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": companion_session_id},
            headers=auth_headers_admin,
        )

        # Send heartbeat
        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    #
    # test_heartbeat_nonexistent_lock
    #
    def test_heartbeat_nonexistent_lock(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
    ):
        """Heartbeat returns 404 when no lock exists."""

        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            params={"path": "/docs/no-lock.docx"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 404

    #
    # test_heartbeat_wrong_user
    #
    def test_heartbeat_wrong_user(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        auth_headers_user: dict,
        test_connection: Connection,
        companion_session_id: str,
    ):
        """Heartbeat from a different user returns 403."""

        # Admin acquires lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": companion_session_id},
            headers=auth_headers_admin,
        )

        # Regular user sends heartbeat
        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_user,
        )
        assert response.status_code == 403

    #
    # test_release_lock
    #
    def test_release_lock(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        companion_session_id: str,
    ):
        """Lock holder can release their lock."""

        # Acquire
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": companion_session_id},
            headers=auth_headers_admin,
        )

        # Release
        response = client.delete(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200

        # Verify lock is gone
        status_resp = client.get(
            f"/api/companion/{test_connection.id}/lock-status",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_admin,
        )
        assert status_resp.json()["locked"] is False

    #
    # test_release_nonexistent_lock_idempotent
    #
    def test_release_nonexistent_lock_idempotent(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
    ):
        """Releasing a nonexistent lock returns success (idempotent)."""

        response = client.delete(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/no-lock.docx"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200

    #
    # test_release_wrong_user
    #
    def test_release_wrong_user(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        auth_headers_user: dict,
        test_connection: Connection,
        companion_session_id: str,
    ):
        """Lock release by a different user returns 403."""

        # Admin acquires lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": companion_session_id},
            headers=auth_headers_admin,
        )

        # Regular user tries to release
        response = client.delete(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_user,
        )
        assert response.status_code == 403

    #
    # test_force_unlock_by_admin
    #
    def test_force_unlock_by_admin(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        auth_headers_user: dict,
        test_connection: Connection,
        session: Session,
        regular_user: User,
    ):
        """Admin can force-unlock a file locked by another user."""

        # Regular user acquires lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": "user-session"},
            headers=auth_headers_user,
        )

        # Admin force-unlocks
        response = client.delete(
            f"/api/companion/{test_connection.id}/lock/force",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200

    #
    # test_force_unlock_by_non_admin_non_owner
    #
    def test_force_unlock_by_non_admin_non_owner(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        auth_headers_user: dict,
        test_connection: Connection,
        companion_session_id: str,
    ):
        """Non-admin, non-owner user cannot force-unlock."""

        # Admin acquires lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": companion_session_id},
            headers=auth_headers_admin,
        )

        # Regular user tries to force-unlock
        response = client.delete(
            f"/api/companion/{test_connection.id}/lock/force",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_user,
        )
        assert response.status_code == 403


# ──────────────────────────────────────────────────────────────────────────────
# Lock Status
# ──────────────────────────────────────────────────────────────────────────────


class TestLockStatus:
    """Tests for GET /api/companion/{connection_id}/lock-status"""

    #
    # test_lock_status_unlocked
    #
    def test_lock_status_unlocked(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
    ):
        """Lock status returns unlocked when no lock exists."""

        response = client.get(
            f"/api/companion/{test_connection.id}/lock-status",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["locked"] is False
        assert data["locked_by"] is None

    #
    # test_lock_status_locked
    #
    def test_lock_status_locked(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        companion_session_id: str,
    ):
        """Lock status returns locked with holder details."""

        # Acquire lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            json={"companion_session": companion_session_id},
            headers=auth_headers_admin,
        )

        response = client.get(
            f"/api/companion/{test_connection.id}/lock-status",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["locked"] is True
        assert data["locked_by"] == "testadmin"

    #
    # test_lock_status_expired_not_shown
    #
    def test_lock_status_expired_not_shown(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        session: Session,
    ):
        """Expired locks (no heartbeat) are not shown as active."""

        # Manually create an expired lock
        expired_lock = EditLock(
            file_path="/docs/report.docx",
            connection_id=test_connection.id,
            locked_by="testadmin",
            companion_session="expired-session",
            last_heartbeat=datetime.now(timezone.utc) - timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 60),
        )
        session.add(expired_lock)
        session.commit()

        response = client.get(
            f"/api/companion/{test_connection.id}/lock-status",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200
        assert response.json()["locked"] is False


# ──────────────────────────────────────────────────────────────────────────────
# Version Check
# ──────────────────────────────────────────────────────────────────────────────


class TestVersionCheck:
    """Tests for GET /api/companion/version-check"""

    #
    # test_compatible_version
    #
    def test_compatible_version(self, client: TestClient):
        """Compatible version returns compatible=true."""

        response = client.get(
            "/api/companion/version-check",
            params={"companion_version": "0.1.0"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["compatible"] is True

    #
    # test_newer_version_compatible
    #
    def test_newer_version_compatible(self, client: TestClient):
        """Newer companion version is still compatible."""

        response = client.get(
            "/api/companion/version-check",
            params={"companion_version": "1.0.0"},
        )
        assert response.status_code == 200
        assert response.json()["compatible"] is True

    #
    # test_incompatible_version
    #
    def test_incompatible_version(self, client: TestClient):
        """Older companion version is incompatible."""

        response = client.get(
            "/api/companion/version-check",
            params={"companion_version": "0.0.1"},
        )
        assert response.status_code == 200
        assert response.json()["compatible"] is False

    #
    # test_invalid_version_string
    #
    def test_invalid_version_string(self, client: TestClient):
        """Malformed version string returns incompatible."""

        response = client.get(
            "/api/companion/version-check",
            params={"companion_version": "not-a-version"},
        )
        assert response.status_code == 200
        assert response.json()["compatible"] is False


# ──────────────────────────────────────────────────────────────────────────────
# Companion download metadata
# ──────────────────────────────────────────────────────────────────────────────


class TestCompanionDownloads:
    """Tests for GET /api/companion/downloads"""

    def test_downloads_require_auth(self, client: TestClient):
        response = client.get("/api/companion/downloads")
        assert response.status_code == 401

    def test_downloads_returns_resolved_metadata(self, client: TestClient, auth_headers_admin: dict):
        resolved = ResolvedCompanionDownloadMetadata(
            source="feed",
            version="0.5.0",
            published_at="2026-03-27T12:00:00Z",
            notes="Release notes",
            assets={"windows-x64": "https://downloads.example.test/Sambee-Companion.exe"},
        )

        with patch("app.api.companion.resolve_companion_download_metadata", return_value=resolved):
            response = client.get("/api/companion/downloads", headers=auth_headers_admin)

        assert response.status_code == 200
        assert response.json() == {
            "source": "feed",
            "version": "0.5.0",
            "published_at": "2026-03-27T12:00:00Z",
            "notes": "Release notes",
            "assets": {"windows-x64": "https://downloads.example.test/Sambee-Companion.exe"},
        }

    def test_downloads_surfaces_resolution_errors(self, client: TestClient, auth_headers_admin: dict):
        with patch(
            "app.api.companion.resolve_companion_download_metadata",
            side_effect=CompanionDownloadResolutionError("Companion download metadata feed request timed out."),
        ):
            response = client.get("/api/companion/downloads", headers=auth_headers_admin)

        assert response.status_code == 502
        assert response.json()["detail"] == "Companion download metadata feed request timed out."


# ──────────────────────────────────────────────────────────────────────────────
# Version comparison utility
# ──────────────────────────────────────────────────────────────────────────────


class TestVersionComparison:
    """Unit tests for the _is_version_compatible helper."""

    #
    # test_equal_versions
    #
    def test_equal_versions(self):
        assert _is_version_compatible("1.2.3", "1.2.3") is True

    #
    # test_newer_patch
    #
    def test_newer_patch(self):
        assert _is_version_compatible("1.2.4", "1.2.3") is True

    #
    # test_newer_minor
    #
    def test_newer_minor(self):
        assert _is_version_compatible("1.3.0", "1.2.3") is True

    #
    # test_newer_major
    #
    def test_newer_major(self):
        assert _is_version_compatible("2.0.0", "1.2.3") is True

    #
    # test_older_patch
    #
    def test_older_patch(self):
        assert _is_version_compatible("1.2.2", "1.2.3") is False

    #
    # test_older_minor
    #
    def test_older_minor(self):
        assert _is_version_compatible("1.1.9", "1.2.3") is False

    #
    # test_older_major
    #
    def test_older_major(self):
        assert _is_version_compatible("0.9.9", "1.2.3") is False

    #
    # test_invalid_version
    #
    def test_invalid_version(self):
        assert _is_version_compatible("abc", "1.0.0") is False

    #
    # test_empty_version
    #
    def test_empty_version(self):
        assert _is_version_compatible("", "1.0.0") is False


# ──────────────────────────────────────────────────────────────────────────────
# Orphan Lock Cleanup
# ──────────────────────────────────────────────────────────────────────────────


class TestOrphanLockCleanup:
    """Tests for the lock orphan detection logic."""

    #
    # test_release_orphaned_locks
    #
    def test_release_orphaned_locks(self, session: Session, test_connection: Connection):
        """Orphaned locks (heartbeat expired) are released by the cleanup function."""

        from app.services.lock_manager import _release_orphaned_locks

        # Patch the engine used by lock_manager to use the test session's connection
        # Create an orphaned lock (heartbeat way in the past)
        orphaned = EditLock(
            file_path="/docs/stale.docx",
            connection_id=test_connection.id,
            locked_by="crashed_user",
            companion_session="dead-session",
            last_heartbeat=datetime.now(timezone.utc) - timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 300),
        )
        session.add(orphaned)
        session.commit()

        with patch("app.services.lock_manager.engine", session.get_bind()):
            released = _release_orphaned_locks()

        assert released >= 1

    #
    # test_active_locks_not_released
    #
    def test_active_locks_not_released(self, session: Session, test_connection: Connection):
        """Active locks (recent heartbeat) are NOT released by cleanup."""

        from app.services.lock_manager import _release_orphaned_locks

        active = EditLock(
            file_path="/docs/active.docx",
            connection_id=test_connection.id,
            locked_by="active_user",
            companion_session="alive-session",
            last_heartbeat=datetime.now(timezone.utc),
        )
        session.add(active)
        session.commit()

        with patch("app.services.lock_manager.engine", session.get_bind()):
            released = _release_orphaned_locks()

        assert released == 0
