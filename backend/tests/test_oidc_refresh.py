import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

import app.api.auth as auth_module
from app.core.security import build_user_access_token
from app.models.oidc import OidcBrowserSession, OidcBrowserSessionStatus, OidcProviderConfiguration
from app.models.user import User, UserRole
from app.services.oidc_browser_session import OIDC_BROWSER_SESSION_COOKIE_NAME, build_cookie_value
from app.services.oidc_client import NormalizedOidcClaims, ValidatedOidcTokenSet
from app.services.oidc_configuration import get_active_oidc_session_cipher, get_oidc_secret_cipher
from app.services.oidc_http import OidcHttpError, OidcHttpErrorCode


def _create_browser_session(session: Session, *, last_refreshed_at: datetime | None = None) -> tuple[User, OidcBrowserSession, str]:
    user = User(username="renewable-session-user", role=UserRole.EDITOR)
    configuration = OidcProviderConfiguration(
        display_name="Test provider",
        issuer_url="https://issuer.example",
        client_id="test-client",
        encrypted_client_secret=get_oidc_secret_cipher().encrypt("client-secret"),
    )
    session.add_all([user, configuration])
    session.commit()

    session_cipher = get_active_oidc_session_cipher(session)
    secret = "test-browser-session-secret"
    current_time = datetime.now(timezone.utc)
    browser_session = OidcBrowserSession(
        user_id=user.id,
        user_token_version=user.token_version,
        provider_configuration_id=configuration.id,
        configuration_revision=configuration.session_validation_revision,
        identity_mapping_revision=configuration.identity_mapping_revision,
        issuer=configuration.issuer_url,
        subject="subject",
        secret_hash=hashlib.sha256(secret.encode("ascii")).hexdigest(),
        encrypted_refresh_token=session_cipher.cipher.encrypt("refresh-token"),
        cipher_key_id=session_cipher.key_id,
        status=OidcBrowserSessionStatus.ACTIVE,
        authenticated_at=current_time,
        absolute_expires_at=current_time + timedelta(days=1),
        last_refreshed_at=last_refreshed_at,
    )
    session.add(browser_session)
    session.commit()
    return user, browser_session, build_cookie_value(browser_session.id, secret)


def test_refresh_releases_lease_when_provider_discovery_is_temporarily_unavailable(
    client: TestClient,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, browser_session, cookie_value = _create_browser_session(session)

    async def unavailable_provider(*_args: object, **_kwargs: object) -> object:
        raise OidcHttpError(OidcHttpErrorCode.REQUEST_FAILED, "OIDC provider is unavailable")

    monkeypatch.setattr(auth_module, "load_provider_metadata", unavailable_provider)
    monkeypatch.setattr(auth_module, "derive_oidc_redirect_uri", lambda _public_url: "http://testserver/api/auth/oidc/callback")
    client.cookies.set(OIDC_BROWSER_SESSION_COOKIE_NAME, cookie_value)

    response = client.post("/api/auth/oidc/refresh", headers={"Origin": "http://testserver"})

    assert response.status_code == 503
    assert response.json()["detail"] == {"code": "oidc_refresh_temporarily_unavailable"}
    session.refresh(browser_session)
    assert browser_session.status == OidcBrowserSessionStatus.ACTIVE
    assert browser_session.refresh_lease_until is None


def test_refresh_deduplicates_a_naive_sqlite_timestamp_and_accepts_normalized_origin(
    client: TestClient,
    session: Session,
) -> None:
    _, browser_session, cookie_value = _create_browser_session(session, last_refreshed_at=datetime.now())
    client.cookies.set(OIDC_BROWSER_SESSION_COOKIE_NAME, cookie_value)

    response = client.post("/api/auth/oidc/refresh", headers={"Origin": "HTTP://TESTSERVER"})

    assert response.status_code == 200
    assert response.json()["oidc_refresh_generation"] == browser_session.refresh_generation


def test_refresh_rotates_the_provider_token_and_advances_the_generation(
    client: TestClient,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, browser_session, cookie_value = _create_browser_session(session)

    async def provider_metadata(*_args: object, **_kwargs: object) -> tuple[object, dict[str, object]]:
        return object(), {}

    async def refreshed_token(*_args: object, **_kwargs: object) -> ValidatedOidcTokenSet:
        return ValidatedOidcTokenSet(
            claims=NormalizedOidcClaims(
                issuer=browser_session.issuer,
                subject=browser_session.subject,
                username=user.username,
                groups=(),
                name=None,
                email=None,
            ),
            authenticated_at=int(datetime.now(timezone.utc).timestamp()),
            provider_access_token=None,
            refresh_token="rotated-refresh-token",
        )

    monkeypatch.setattr(auth_module, "derive_oidc_redirect_uri", lambda _public_url: "http://testserver/api/auth/oidc/callback")
    monkeypatch.setattr(auth_module, "load_provider_metadata", provider_metadata)
    monkeypatch.setattr(auth_module, "exchange_and_validate_refresh_token", refreshed_token)
    monkeypatch.setattr(auth_module, "resolve_or_provision_oidc_user", lambda _session, **_kwargs: user)
    client.cookies.set(OIDC_BROWSER_SESSION_COOKIE_NAME, cookie_value)

    response = client.post("/api/auth/oidc/refresh", headers={"Origin": "http://testserver"})

    assert response.status_code == 200
    assert response.json()["oidc_refresh_generation"] == 1
    session.refresh(browser_session)
    assert browser_session.refresh_generation == 1
    assert browser_session.last_refreshed_at is not None
    assert get_active_oidc_session_cipher(session).cipher.decrypt(browser_session.encrypted_refresh_token) == "rotated-refresh-token"


def test_invalidated_oidc_browser_session_returns_machine_readable_reauthentication(
    client: TestClient,
    session: Session,
) -> None:
    user, browser_session, _ = _create_browser_session(session)
    browser_session.status = OidcBrowserSessionStatus.REVOKED
    session.add(browser_session)
    session.commit()
    access_token = build_user_access_token(user, oidc_browser_session_id=browser_session.id)

    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {access_token}"})

    assert response.status_code == 401
    assert response.json()["detail"] == {"code": "oidc_reauthentication_required"}


def test_refresh_uncertain_session_allows_an_existing_oidc_access_token_until_expiry(
    client: TestClient,
    session: Session,
) -> None:
    user, browser_session, _ = _create_browser_session(session)
    browser_session.status = OidcBrowserSessionStatus.REFRESH_UNCERTAIN
    session.add(browser_session)
    session.commit()
    access_token = build_user_access_token(user, oidc_browser_session_id=browser_session.id)

    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {access_token}"})

    assert response.status_code == 200
    assert response.json()["username"] == user.username


def test_refresh_requires_reauthentication_when_its_cipher_key_is_unavailable(
    client: TestClient,
    session: Session,
) -> None:
    _, browser_session, cookie_value = _create_browser_session(session)
    browser_session.cipher_key_id = "missing-key"
    session.add(browser_session)
    session.commit()
    client.cookies.set(OIDC_BROWSER_SESSION_COOKIE_NAME, cookie_value)

    response = client.post("/api/auth/oidc/refresh", headers={"Origin": "http://testserver"})

    assert response.status_code == 401
    assert response.json()["detail"] == {"code": "oidc_reauthentication_required"}
