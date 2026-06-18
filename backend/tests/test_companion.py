"""
Tests for the companion app API endpoints.

Covers:
- URI token generation and exchange
- Edit lock lifecycle (acquire, heartbeat, release, force-unlock)
- Lock status queries
- Version compatibility check
- Orphaned lock cleanup
"""

import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any, cast
from unittest.mock import AsyncMock, patch

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.companion import (
    COMPANION_BOOTSTRAP_PURPOSE,
    COMPANION_ERROR_CAPABILITY_MISMATCH,
    COMPANION_OPERATION_PURPOSE,
    COMPANION_TOKEN_CLAIM,
    COMPANION_TOKEN_CLASS,
    COMPANION_TOKEN_EXPIRE_MINUTES,
    OPERATION_TOKEN_EXPIRE_MINUTES,
    OPERATION_TOKEN_RENEW_AFTER_SECONDS,
    URI_TOKEN_CLAIM,
    URI_TOKEN_CLASS,
    URI_TOKEN_EXPIRE_SECONDS,
    URI_TOKEN_PURPOSE,
    _is_version_compatible,
)
from app.core.security import create_access_token
from app.models.companion_uri_token_jti import CompanionUriTokenJti
from app.models.connection import Connection
from app.models.edit_lock import HEARTBEAT_TIMEOUT_SECONDS, EditLock
from app.models.file import FileInfo, FileType
from app.models.user import User
from app.services.companion_downloads import CompanionDownloadResolutionError, ResolvedCompanionDownloadMetadata

# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def clear_used_tokens(session: Session):
    """Clear the durable used-token registry between tests."""

    for record in session.exec(select(CompanionUriTokenJti)).all():
        session.delete(record)
    session.commit()
    yield
    for record in session.exec(select(CompanionUriTokenJti)).all():
        session.delete(record)
    session.commit()


@pytest.fixture(name="companion_session_token_factory")
def companion_session_token_factory_fixture() -> Callable[..., str]:
    """Build a companion bootstrap token for a given user, connection, and path."""

    def factory(user: User, connection: Connection, path: str = "/docs/report.docx") -> str:
        return create_access_token(
            data={
                "sub": user.username,
                "tv": user.token_version,
                COMPANION_TOKEN_CLAIM: True,
                "token_class": COMPANION_TOKEN_CLASS,
                "purpose": COMPANION_BOOTSTRAP_PURPOSE,
                "conn_id": str(connection.id),
                "path": path,
            },
            expires_delta=timedelta(minutes=COMPANION_TOKEN_EXPIRE_MINUTES),
        )

    return factory


@pytest.fixture(name="admin_companion_session")
def admin_companion_session_fixture(
    admin_user: User,
    test_connection: Connection,
    companion_session_token_factory: Any,
) -> str:
    return cast(str, companion_session_token_factory(admin_user, test_connection))


@pytest.fixture(name="user_companion_session")
def user_companion_session_fixture(
    regular_user: User,
    test_connection: Connection,
    companion_session_token_factory: Any,
) -> str:
    return cast(str, companion_session_token_factory(regular_user, test_connection))


@pytest.fixture(name="admin_companion_headers")
def admin_companion_headers_fixture(admin_companion_session: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {admin_companion_session}"}


@pytest.fixture(name="user_companion_headers")
def user_companion_headers_fixture(user_companion_session: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {user_companion_session}"}


@pytest.fixture(name="operation_session_token_factory")
def operation_session_token_factory_fixture():
    """Build an operation-scoped companion token for a given lock context."""

    def factory(
        user: User,
        connection: Connection,
        *,
        path: str = "/docs/report.docx",
        operation_id: str = "op-test",
        lock_id: str = "lock-test",
        expires_delta: timedelta | None = None,
    ) -> str:
        return create_access_token(
            data={
                "sub": user.username,
                "tv": user.token_version,
                "jti": uuid.uuid4().hex,
                COMPANION_TOKEN_CLAIM: True,
                "token_class": COMPANION_TOKEN_CLASS,
                "purpose": COMPANION_OPERATION_PURPOSE,
                "conn_id": str(connection.id),
                "path": path,
                "op_id": operation_id,
                "lock_id": lock_id,
            },
            expires_delta=expires_delta or timedelta(minutes=OPERATION_TOKEN_EXPIRE_MINUTES),
        )

    return factory


def build_lock_control_payload(
    lock_data: dict[str, str], *, lock_id: str | None = None, lock_capability: str | None = None
) -> dict[str, str]:
    """Build the request payload for lock-control endpoints."""

    return {
        "operation_id": lock_data["operation_id"],
        "lock_id": lock_id or lock_data["lock_id"],
        "lock_capability": lock_capability or lock_data["lock_capability"],
    }


def build_operation_headers(lock_data: dict[str, str]) -> dict[str, str]:
    """Build Authorization headers for operation-session requests."""

    return {"Authorization": f"Bearer {lock_data['operation_token']}"}


def build_bootstrap_headers(companion_session: str) -> dict[str, str]:
    """Build Authorization headers for companion bootstrap-session requests."""

    return {"Authorization": f"Bearer {companion_session}"}


def build_operation_query(lock_data: dict[str, str]) -> dict[str, str]:
    """Build query parameters for operation-scoped file transfer requests."""

    return {
        "operation_id": lock_data["operation_id"],
        "lock_id": lock_data["lock_id"],
        "lock_capability": lock_data["lock_capability"],
    }


@pytest.fixture(name="uri_token")
def uri_token_fixture(admin_user: User, test_connection: Connection) -> str:
    """Create a valid URI token for the admin user."""

    return create_access_token(
        data={
            "sub": admin_user.username,
            URI_TOKEN_CLAIM: True,
            "token_class": URI_TOKEN_CLASS,
            "purpose": URI_TOKEN_PURPOSE,
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
        session: Session,
    ):
        """Valid URI token is exchanged for a companion session token."""

        response = client.post(
            "/api/companion/token",
            json={"token": uri_token},
        )
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["expires_in"] == COMPANION_TOKEN_EXPIRE_MINUTES * 60
        assert data["token_class"] == COMPANION_TOKEN_CLASS
        assert data["purpose"] == COMPANION_BOOTSTRAP_PURPOSE
        assert data["connection_id"]
        assert data["path"] == "/docs/report.docx"

        payload = jwt.decode(data["token"], options={"verify_signature": False})
        assert payload[COMPANION_TOKEN_CLAIM] is True
        assert payload["token_class"] == COMPANION_TOKEN_CLASS
        assert payload["purpose"] == COMPANION_BOOTSTRAP_PURPOSE

        consumed = session.exec(select(CompanionUriTokenJti)).all()
        assert len(consumed) == 1

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
            json={"token": uri_token},
        )
        assert response1.status_code == 200

        # Second exchange fails
        response2 = client.post(
            "/api/companion/token",
            json={"token": uri_token},
        )
        assert response2.status_code == 409

    #
    # test_exchange_invalid_token
    #
    def test_exchange_invalid_token(self, client: TestClient):
        """Invalid JWT is rejected."""

        response = client.post(
            "/api/companion/token",
            json={"token": "not-a-jwt"},
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
            json={"token": admin_token},
        )
        assert response.status_code == 401


class TestProxyAuthProbe:
    """Tests for GET /api/companion/proxy-auth-check."""

    def test_proxy_auth_check_requires_auth(self, client: TestClient):
        """The probe endpoint should be protected like normal backend routes."""

        response = client.get("/api/companion/proxy-auth-check")
        assert response.status_code == 401

    def test_proxy_auth_check_returns_ok(self, client: TestClient, auth_headers_admin: dict):
        """Authenticated callers get a tiny success response for the auth webview."""

        response = client.get("/api/companion/proxy-auth-check", headers=auth_headers_admin)
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


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
        test_connection: Connection,
        admin_companion_session: str,
        caplog: pytest.LogCaptureFixture,
    ):
        """Lock can be acquired on a file."""

        with caplog.at_level(logging.INFO, logger="app.api.companion"):
            response = client.post(
                f"/api/companion/{test_connection.id}/lock",
                params={"path": "/docs/report.docx"},
                headers=build_bootstrap_headers(admin_companion_session),
            )
        assert response.status_code == 200
        data = response.json()
        assert data["file_path"] == "/docs/report.docx"
        assert data["locked_by"] == "testadmin"
        assert data["lock_capability"]
        assert data["operation_id"]
        assert data["operation_token"]
        assert data["operation_expires_in"] == OPERATION_TOKEN_EXPIRE_MINUTES * 60

        payload = jwt.decode(data["operation_token"], options={"verify_signature": False})
        assert payload[COMPANION_TOKEN_CLAIM] is True
        assert payload["token_class"] == COMPANION_TOKEN_CLASS
        assert payload["purpose"] == COMPANION_OPERATION_PURPOSE
        assert payload["op_id"] == data["operation_id"]
        assert payload["lock_id"] == data["lock_id"]
        assert "Lock acquired:" in caplog.text
        assert f"connection_id='{test_connection.id}'" in caplog.text
        assert "path='/docs/report.docx'" in caplog.text
        assert "operation_id='" in caplog.text
        assert "lock_id='" in caplog.text
        assert admin_companion_session not in caplog.text
        assert data["operation_token"] not in caplog.text

    def test_acquire_lock_read_only_connection_blocked(
        self,
        client: TestClient,
        admin_user: User,
        read_only_connection: Connection,
        companion_session_token_factory,
        session: Session,
    ):
        """Read-only connections should not allow new companion edit locks."""

        companion_session = companion_session_token_factory(admin_user, read_only_connection)

        response = client.post(
            f"/api/companion/{read_only_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(companion_session),
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
        test_connection: Connection,
        admin_companion_session: str,
        user_companion_session: str,
    ):
        """Lock acquisition fails with 409 when another user holds the lock."""

        # Admin acquires lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        )

        # Regular user tries to acquire the same lock
        response = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(user_companion_session),
        )
        assert response.status_code == 409

    #
    # test_same_user_relock
    #
    def test_same_user_relock(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Same user can re-lock a file they already hold."""

        # First lock
        first_response = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        )

        # Re-lock by same user
        response = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        )
        assert response.status_code == 200
        assert response.json()["lock_capability"] == first_response.json()["lock_capability"]
        assert response.json()["operation_id"] == first_response.json()["operation_id"]

    def test_same_user_relock_replaces_malformed_legacy_lock(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
        session: Session,
    ):
        """Same-user re-lock replaces a malformed legacy lock row with a fresh final-protocol lock."""

        legacy_lock = EditLock(
            file_path="/docs/report.docx",
            connection_id=test_connection.id,
            locked_by="testadmin",
            operation_id="",
            lock_capability="",
        )
        session.add(legacy_lock)
        session.commit()
        legacy_lock_id = str(legacy_lock.id)

        response = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        )

        assert response.status_code == 200
        data = response.json()
        assert data["lock_id"] != legacy_lock_id
        assert data["lock_capability"]
        assert data["operation_id"]

        replacement_lock = session.exec(select(EditLock).where(EditLock.id == uuid.UUID(data["lock_id"]))).first()
        assert replacement_lock is not None

        removed_legacy_lock = session.exec(select(EditLock).where(EditLock.id == uuid.UUID(legacy_lock_id))).first()
        assert removed_legacy_lock is None

    def test_acquire_lock_rejects_regular_browser_token(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_token: str,
    ):
        """Lock acquisition rejects a normal browser access token in Authorization."""

        response = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert response.status_code == 401

    def test_acquire_lock_rejects_revoked_bootstrap_token(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        companion_session_token_factory,
        session: Session,
    ):
        """Lock acquisition rejects companion bootstrap tokens after token-version revocation."""

        revoked_token = companion_session_token_factory(admin_user, test_connection)
        admin_user.token_version += 1
        session.add(admin_user)
        session.commit()

        response = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(revoked_token),
        )

        assert response.status_code == 401

    def test_acquire_lock_rejects_scope_mismatch(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        companion_session_token_factory,
    ):
        """Lock acquisition rejects companion tokens scoped to a different path."""

        mismatched_token = companion_session_token_factory(admin_user, test_connection, path="/docs/other.docx")

        response = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(mismatched_token),
        )
        assert response.status_code == 403

    #
    # test_heartbeat
    #
    def test_heartbeat(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Heartbeat updates the lock timestamp."""

        # Acquire lock
        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        # Send heartbeat
        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=build_operation_headers(lock_data),
            json=build_lock_control_payload(lock_data),
        )
        assert response.status_code == 200
        assert response.json()["ok"] is True
        assert response.json()["lock_expires_in"] > 0
        assert response.json()["operation_expires_in"] > 0

    #
    # test_heartbeat_nonexistent_lock
    #
    def test_heartbeat_nonexistent_lock(
        self,
        client: TestClient,
        admin_user: User,
        companion_session_token_factory,
        operation_session_token_factory,
        test_connection: Connection,
    ):
        """Heartbeat returns 404 when no lock exists."""

        missing_path_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, path='/docs/no-lock.docx', operation_id='missing-op', lock_id=str(uuid.uuid4()))}"
        }

        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=missing_path_headers,
            json={"operation_id": "missing-op", "lock_id": str(uuid.uuid4()), "lock_capability": "missing-capability"},
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "lock_lost"

    #
    # test_heartbeat_wrong_user
    #
    def test_heartbeat_wrong_user(
        self,
        client: TestClient,
        regular_user: User,
        test_connection: Connection,
        admin_companion_session: str,
        operation_session_token_factory,
    ):
        """Heartbeat from a different user returns 403."""

        # Admin acquires lock
        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        # Regular user sends heartbeat
        user_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(regular_user, test_connection, operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'])}"
        }
        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=user_headers,
            json=build_lock_control_payload(lock_data),
        )
        assert response.status_code == 403

    def test_heartbeat_rejects_regular_browser_token(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Heartbeat rejects a normal browser access token."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=auth_headers_admin,
            json=build_lock_control_payload(lock_data),
        )
        assert response.status_code == 401

    def test_heartbeat_rejects_revoked_operation_token(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        admin_companion_session: str,
        operation_session_token_factory,
        session: Session,
    ):
        """Heartbeat rejects operation tokens after token-version revocation."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        revoked_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'])}"
        }
        admin_user.token_version += 1
        session.add(admin_user)
        session.commit()

        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=revoked_headers,
            json=build_lock_control_payload(lock_data),
        )

        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "auth_failed"

    def test_heartbeat_rejects_bootstrap_companion_token(
        self,
        client: TestClient,
        admin_companion_headers: dict[str, str],
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Heartbeat rejects the bootstrap companion session after lock acquisition."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=admin_companion_headers,
            json=build_lock_control_payload(lock_data),
        )
        assert response.status_code == 401

    def test_heartbeat_rejects_scope_mismatch(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        companion_session_token_factory,
        operation_session_token_factory,
        admin_companion_session: str,
    ):
        """Heartbeat rejects a companion token scoped to a different path."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        mismatched_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, path='/docs/other.docx', operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'])}"
        }

        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=mismatched_headers,
            json=build_lock_control_payload(lock_data),
        )
        assert response.status_code == 403

    def test_heartbeat_rejects_wrong_lock_capability(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Heartbeat rejects requests with the wrong lock capability."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=build_operation_headers(lock_data),
            json=build_lock_control_payload(lock_data, lock_capability="wrong-capability"),
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == COMPANION_ERROR_CAPABILITY_MISMATCH

    def test_heartbeat_rejects_wrong_lock_id(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Heartbeat rejects requests with the wrong lock ID."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=build_operation_headers(lock_data),
            json=build_lock_control_payload(lock_data, lock_id=str(uuid.uuid4())),
        )
        assert response.status_code == 404

    def test_heartbeat_rejects_wrong_operation_id(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Heartbeat rejects requests with the wrong operation ID."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        payload = build_lock_control_payload(lock_data)
        payload["operation_id"] = "wrong-operation"

        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=build_operation_headers(lock_data),
            json=payload,
        )
        assert response.status_code == 403

    def test_heartbeat_requires_renewal_near_expiry(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        admin_companion_session: str,
        operation_session_token_factory,
    ):
        """Heartbeat returns renewal-required inside the final server threshold."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        renewable_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'], expires_delta=timedelta(seconds=120))}"
        }

        response = client.post(
            f"/api/companion/{test_connection.id}/lock/heartbeat",
            headers=renewable_headers,
            json=build_lock_control_payload(lock_data),
        )

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "renewal_required"

    #
    # test_release_lock
    #
    def test_release_lock(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Lock holder can release their lock."""

        # Acquire
        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        # Release
        response = client.request(
            "DELETE",
            f"/api/companion/{test_connection.id}/lock",
            headers=build_operation_headers(lock_data),
            json=build_lock_control_payload(lock_data),
        )
        assert response.status_code == 200
        assert response.json()["released"] is True

        # Verify lock is gone
        status_resp = client.get(
            f"/api/companion/{test_connection.id}/lock-status",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_admin,
        )
        assert status_resp.json()["lock_active"] is False
        assert status_resp.json()["lock_id"] is None
        assert status_resp.json()["operation_id"] is None

    #
    # test_release_nonexistent_lock_idempotent
    #
    def test_release_nonexistent_lock_idempotent(
        self,
        client: TestClient,
        admin_user: User,
        companion_session_token_factory,
        operation_session_token_factory,
        test_connection: Connection,
    ):
        """Releasing a nonexistent lock returns success (idempotent)."""

        missing_lock_id = str(uuid.uuid4())

        missing_path_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, path='/docs/no-lock.docx', operation_id='missing-op', lock_id=missing_lock_id)}"
        }

        response = client.request(
            "DELETE",
            f"/api/companion/{test_connection.id}/lock",
            headers=missing_path_headers,
            json={"operation_id": "missing-op", "lock_id": missing_lock_id, "lock_capability": "missing-capability"},
        )
        assert response.status_code == 200
        assert response.json()["released"] is True

    #
    # test_release_wrong_user
    #
    def test_release_wrong_user(
        self,
        client: TestClient,
        regular_user: User,
        test_connection: Connection,
        admin_companion_session: str,
        operation_session_token_factory,
    ):
        """Lock release by a different user returns 403."""

        # Admin acquires lock
        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        # Regular user tries to release
        user_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(regular_user, test_connection, operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'])}"
        }
        response = client.request(
            "DELETE",
            f"/api/companion/{test_connection.id}/lock",
            headers=user_headers,
            json=build_lock_control_payload(lock_data),
        )
        assert response.status_code == 403

    def test_release_rejects_regular_browser_token(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Release rejects a normal browser access token."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.request(
            "DELETE",
            f"/api/companion/{test_connection.id}/lock",
            headers=auth_headers_admin,
            json=build_lock_control_payload(lock_data),
        )
        assert response.status_code == 401

    def test_release_rejects_bootstrap_companion_token(
        self,
        client: TestClient,
        admin_companion_headers: dict[str, str],
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Release rejects the bootstrap companion session after lock acquisition."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.request(
            "DELETE",
            f"/api/companion/{test_connection.id}/lock",
            headers=admin_companion_headers,
            json=build_lock_control_payload(lock_data),
        )
        assert response.status_code == 401

    def test_release_rejects_scope_mismatch(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        companion_session_token_factory,
        operation_session_token_factory,
        admin_companion_session: str,
    ):
        """Release rejects a companion token scoped to a different path."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        mismatched_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, path='/docs/other.docx', operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'])}"
        }

        response = client.request(
            "DELETE",
            f"/api/companion/{test_connection.id}/lock",
            headers=mismatched_headers,
            json=build_lock_control_payload(lock_data),
        )
        assert response.status_code == 403

    def test_release_rejects_wrong_lock_capability(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Release rejects requests with the wrong lock capability."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.request(
            "DELETE",
            f"/api/companion/{test_connection.id}/lock",
            headers=build_operation_headers(lock_data),
            json=build_lock_control_payload(lock_data, lock_capability="wrong-capability"),
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == COMPANION_ERROR_CAPABILITY_MISMATCH

    def test_release_rejects_wrong_lock_id(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Release rejects requests with the wrong lock ID."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.request(
            "DELETE",
            f"/api/companion/{test_connection.id}/lock",
            headers=build_operation_headers(lock_data),
            json=build_lock_control_payload(lock_data, lock_id=str(uuid.uuid4())),
        )
        assert response.status_code == 404

    def test_release_rejects_wrong_operation_id(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Release rejects requests with the wrong operation ID."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        payload = build_lock_control_payload(lock_data)
        payload["operation_id"] = "wrong-operation"

        response = client.request(
            "DELETE",
            f"/api/companion/{test_connection.id}/lock",
            headers=build_operation_headers(lock_data),
            json=payload,
        )
        assert response.status_code == 403

    def test_renew_operation_session(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        admin_companion_session: str,
        operation_session_token_factory,
    ):
        """Renewal returns a fresh operation token for an active lock in the renewal window."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        renewable_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'], expires_delta=timedelta(seconds=240))}"
        }

        response = client.post(
            f"/api/companion/{test_connection.id}/session/renew",
            headers=renewable_headers,
            json=build_lock_control_payload(lock_data),
        )

        assert response.status_code == 200
        data = response.json()
        assert data["token"]
        assert data["expires_in"] == OPERATION_TOKEN_EXPIRE_MINUTES * 60
        assert data["renew_after_seconds"] == OPERATION_TOKEN_RENEW_AFTER_SECONDS

        payload = jwt.decode(data["token"], options={"verify_signature": False})
        assert payload["purpose"] == COMPANION_OPERATION_PURPOSE
        assert payload["op_id"] == lock_data["operation_id"]
        assert payload["lock_id"] == lock_data["lock_id"]

    def test_renew_operation_session_rejects_too_early(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Renewal is rejected before the operation token enters its renewable window."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.post(
            f"/api/companion/{test_connection.id}/session/renew",
            headers=build_operation_headers(lock_data),
            json=build_lock_control_payload(lock_data),
        )

        assert response.status_code == 409

    def test_renew_operation_session_rejects_regular_browser_token(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Renewal rejects a normal browser access token."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.post(
            f"/api/companion/{test_connection.id}/session/renew",
            headers=auth_headers_admin,
            json=build_lock_control_payload(lock_data),
        )

        assert response.status_code == 401

    def test_renew_operation_session_rejects_wrong_lock_capability(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        admin_companion_session: str,
        operation_session_token_factory,
    ):
        """Renewal rejects requests with the wrong lock capability."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        renewable_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'], expires_delta=timedelta(seconds=240))}"
        }

        response = client.post(
            f"/api/companion/{test_connection.id}/session/renew",
            headers=renewable_headers,
            json=build_lock_control_payload(lock_data, lock_capability="wrong-capability"),
        )

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == COMPANION_ERROR_CAPABILITY_MISMATCH

    def test_renew_operation_session_requires_renewal_after_expiry(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        admin_companion_session: str,
        operation_session_token_factory,
    ):
        """Expired operation tokens return a structured recovery-required error."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        expired_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'], expires_delta=timedelta(seconds=-5))}"
        }

        response = client.post(
            f"/api/companion/{test_connection.id}/session/renew",
            headers=expired_headers,
            json=build_lock_control_payload(lock_data),
        )

        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "recovery_required"

    def test_renew_operation_session_returns_auth_failed_for_wrong_token_purpose(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        admin_companion_session: str,
        operation_session_token_factory,
    ):
        """Operation endpoints return auth-failed when they receive the wrong companion token purpose."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        wrong_purpose_token = create_access_token(
            data={
                "sub": admin_user.username,
                "tv": admin_user.token_version,
                "jti": uuid.uuid4().hex,
                COMPANION_TOKEN_CLAIM: True,
                "token_class": COMPANION_TOKEN_CLASS,
                "purpose": COMPANION_BOOTSTRAP_PURPOSE,
                "conn_id": str(test_connection.id),
                "path": "/docs/report.docx",
                "op_id": lock_data["operation_id"],
                "lock_id": lock_data["lock_id"],
            },
            expires_delta=timedelta(minutes=OPERATION_TOKEN_EXPIRE_MINUTES),
        )
        wrong_purpose_headers = {"Authorization": f"Bearer {wrong_purpose_token}"}

        response = client.post(
            f"/api/companion/{test_connection.id}/session/renew",
            headers=wrong_purpose_headers,
            json=build_lock_control_payload(lock_data),
        )

        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "auth_failed"

    #
    # test_force_unlock_by_admin
    #
    def test_force_unlock_by_admin(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        session: Session,
        regular_user: User,
        user_companion_session: str,
    ):
        """Admin can force-unlock a file locked by another user."""

        # Regular user acquires lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(user_companion_session),
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
        admin_companion_session: str,
    ):
        """Non-admin, non-owner user cannot force-unlock."""

        # Admin acquires lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
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
        assert data["lock_active"] is False
        assert data["lock_id"] is None
        assert data["operation_id"] is None
        assert data["locked_by_current_user"] is False
        assert data["expires_in"] == 0

    #
    # test_lock_status_locked
    #
    def test_lock_status_locked(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Lock status returns locked with holder details."""

        # Acquire lock
        client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        )

        response = client.get(
            f"/api/companion/{test_connection.id}/lock-status",
            params={"path": "/docs/report.docx"},
            headers=auth_headers_admin,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["lock_active"] is True
        assert data["locked_by_current_user"] is True
        assert data["lock_id"]
        assert data["operation_id"]
        assert data["expires_in"] > 0
        assert "lock_capability" not in data
        assert "operation_token" not in data
        assert "companion_session" not in data
        assert "token" not in data

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
            operation_id="expired-op",
            lock_capability="expired-capability",
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
        assert response.json()["lock_active"] is False


# ──────────────────────────────────────────────────────────────────────────────
# Operation-scoped file transfer
# ──────────────────────────────────────────────────────────────────────────────


class TestOperationScopedFileTransfer:
    """Tests for operation-scoped companion download and upload endpoints."""

    def test_download_accepts_operation_session(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Download succeeds when the active operation session matches the lock."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        with patch("app.api.companion.SMBBackend") as mock_backend:
            backend_instance = AsyncMock()
            backend_instance.get_file_info.return_value = type(
                "FileInfoStub",
                (),
                {"name": "report.docx", "size": 14, "type": "file", "mime_type": "application/octet-stream"},
            )()

            async def read_file(_path, **_kwargs):
                yield b"download bytes"

            backend_instance.read_file = read_file
            backend_instance.connect.return_value = None
            backend_instance.disconnect.return_value = None
            mock_backend.return_value = backend_instance

            response = client.get(
                f"/api/companion/{test_connection.id}/download",
                headers=build_operation_headers(lock_data),
                params={
                    "path": "/docs/report.docx",
                    "operation_id": lock_data["operation_id"],
                    "lock_id": lock_data["lock_id"],
                },
            )

        assert response.status_code == 200
        assert response.content == b"download bytes"

    def test_download_rejects_browser_token_for_operation_scope(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Download rejects a normal browser token when operation context is provided."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.get(
            f"/api/companion/{test_connection.id}/download",
            headers=auth_headers_admin,
            params={
                "path": "/docs/report.docx",
                "operation_id": lock_data["operation_id"],
                "lock_id": lock_data["lock_id"],
            },
        )

        assert response.status_code == 401

    def test_download_rejects_operation_token_without_operation_scope(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Download rejects operation tokens when the generic viewer path is used."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.get(
            f"/api/companion/{test_connection.id}/download",
            headers=build_operation_headers(lock_data),
            params={"path": "/docs/report.docx"},
        )

        assert response.status_code == 422

    def test_download_requires_renewal_near_expiry(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        admin_companion_session: str,
        operation_session_token_factory,
    ):
        """Companion download returns renewal-required inside the final server threshold."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        renewable_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'], expires_delta=timedelta(seconds=120))}"
        }

        response = client.get(
            f"/api/companion/{test_connection.id}/download",
            headers=renewable_headers,
            params={
                "path": "/docs/report.docx",
                "operation_id": lock_data["operation_id"],
                "lock_id": lock_data["lock_id"],
            },
        )

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "renewal_required"

    def test_download_rejects_path_scope_mismatch(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Companion download rejects operation requests for a different file path."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.get(
            f"/api/companion/{test_connection.id}/download",
            headers=build_operation_headers(lock_data),
            params={
                "path": "/docs/other.docx",
                "operation_id": lock_data["operation_id"],
                "lock_id": lock_data["lock_id"],
            },
        )

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "lock_lost"

    def test_upload_accepts_operation_session(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Upload succeeds when the active operation session matches the lock."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        mock_info = FileInfo(
            name="report.docx",
            path="/docs/report.docx",
            type=FileType.FILE,
            size=100,
            modified_at=datetime(2026, 2, 9, 14, 0, 0),
        )

        with patch("app.api.companion.SMBBackend") as mock_backend:
            backend_instance = AsyncMock()
            backend_instance.write_file = AsyncMock(return_value=100)
            backend_instance.get_file_info = AsyncMock(return_value=mock_info)
            mock_backend.return_value = backend_instance

            response = client.post(
                f"/api/companion/{test_connection.id}/upload",
                headers=build_operation_headers(lock_data),
                files={
                    "operation_id": (None, lock_data["operation_id"]),
                    "lock_id": (None, lock_data["lock_id"]),
                    "lock_capability": (None, lock_data["lock_capability"]),
                    "file": ("report.docx", b"updated content", "application/octet-stream"),
                },
            )

        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_upload_rejects_browser_token_for_operation_scope(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Upload rejects a normal browser token when operation context is provided."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.post(
            f"/api/companion/{test_connection.id}/upload",
            headers=auth_headers_admin,
            files={
                "operation_id": (None, lock_data["operation_id"]),
                "lock_id": (None, lock_data["lock_id"]),
                "lock_capability": (None, lock_data["lock_capability"]),
                "file": ("report.docx", b"updated content", "application/octet-stream"),
            },
        )

        assert response.status_code == 401

    def test_upload_returns_lock_lost_when_active_lock_is_gone(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Operation-scoped upload returns a structured lock-lost error after force unlock."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        force_response = client.delete(
            f"/api/companion/{test_connection.id}/lock/force",
            headers=auth_headers_admin,
            params={"path": "/docs/report.docx"},
        )
        assert force_response.status_code == 200

        response = client.post(
            f"/api/companion/{test_connection.id}/upload",
            headers=build_operation_headers(lock_data),
            files={
                "operation_id": (None, lock_data["operation_id"]),
                "lock_id": (None, lock_data["lock_id"]),
                "lock_capability": (None, lock_data["lock_capability"]),
                "file": ("report.docx", b"updated content", "application/octet-stream"),
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "lock_lost"

    def test_upload_requires_renewal_near_expiry(
        self,
        client: TestClient,
        admin_user: User,
        test_connection: Connection,
        admin_companion_session: str,
        operation_session_token_factory,
    ):
        """Companion upload returns renewal-required inside the final server threshold."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        renewable_headers = {
            "Authorization": f"Bearer {operation_session_token_factory(admin_user, test_connection, operation_id=lock_data['operation_id'], lock_id=lock_data['lock_id'], expires_delta=timedelta(seconds=120))}"
        }

        response = client.post(
            f"/api/companion/{test_connection.id}/upload",
            headers=renewable_headers,
            files={
                "operation_id": (None, lock_data["operation_id"]),
                "lock_id": (None, lock_data["lock_id"]),
                "lock_capability": (None, lock_data["lock_capability"]),
                "file": ("report.docx", b"updated content", "application/octet-stream"),
            },
        )

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "renewal_required"

    def test_upload_rejects_wrong_operation_id(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Operation-scoped upload rejects a mismatched operation ID."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.post(
            f"/api/companion/{test_connection.id}/upload",
            headers=build_operation_headers(lock_data),
            files={
                "operation_id": (None, "wrong-operation"),
                "lock_id": (None, lock_data["lock_id"]),
                "lock_capability": (None, lock_data["lock_capability"]),
                "file": ("report.docx", b"updated content", "application/octet-stream"),
            },
        )

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "lock_lost"

    def test_upload_rejects_wrong_lock_id(
        self,
        client: TestClient,
        test_connection: Connection,
        admin_companion_session: str,
    ):
        """Operation-scoped upload rejects a mismatched lock ID."""

        lock_data = client.post(
            f"/api/companion/{test_connection.id}/lock",
            params={"path": "/docs/report.docx"},
            headers=build_bootstrap_headers(admin_companion_session),
        ).json()

        response = client.post(
            f"/api/companion/{test_connection.id}/upload",
            headers=build_operation_headers(lock_data),
            files={
                "operation_id": (None, lock_data["operation_id"]),
                "lock_id": (None, str(uuid.uuid4())),
                "lock_capability": (None, lock_data["lock_capability"]),
                "file": ("report.docx", b"updated content", "application/octet-stream"),
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "lock_lost"


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
    def test_release_orphaned_locks(self, session: Session, test_connection: Connection, caplog: pytest.LogCaptureFixture):
        """Orphaned locks (heartbeat expired) are released by the cleanup function."""

        from app.services.lock_manager import _release_orphaned_locks

        # Patch the engine used by lock_manager to use the test session's connection
        # Create an orphaned lock (heartbeat way in the past)
        orphaned = EditLock(
            file_path="/docs/stale.docx",
            connection_id=test_connection.id,
            locked_by="crashed_user",
            operation_id="orphan-op",
            lock_capability="top-secret-capability",
            last_heartbeat=datetime.now(timezone.utc) - timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 300),
        )
        session.add(orphaned)
        session.commit()

        with caplog.at_level(logging.WARNING, logger="app.services.lock_manager"):
            with patch("app.services.lock_manager.engine", session.get_bind()):
                released = _release_orphaned_locks()

        assert released >= 1
        assert "Releasing orphaned lock:" in caplog.text
        assert f"connection_id='{test_connection.id}'" in caplog.text
        assert "operation_id='orphan-op'" in caplog.text
        assert "path='/docs/stale.docx'" in caplog.text
        assert "dead-session" not in caplog.text
        assert "top-secret-capability" not in caplog.text

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
            last_heartbeat=datetime.now(timezone.utc),
        )
        session.add(active)
        session.commit()

        with patch("app.services.lock_manager.engine", session.get_bind()):
            released = _release_orphaned_locks()

        assert released == 0
