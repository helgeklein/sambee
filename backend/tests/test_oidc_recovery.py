from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

import app.api.admin_auth as admin_auth_module
from app.models.oidc import OidcProviderConfiguration, SignInMode
from app.models.user import User, UserRole
from app.services.oidc_recovery import OidcRecoveryError, activate_password_only


def test_password_only_recovery_rejects_expired_local_administrator(session: Session) -> None:
    session.add(
        OidcProviderConfiguration(
            display_name="Example",
            issuer_url="https://id.example",
            client_id="sambee",
            sign_in_mode=SignInMode.OIDC_ONLY,
        )
    )
    session.add(
        User(
            username="expired-admin",
            password_hash="hash",
            role=UserRole.ADMIN,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
    )
    session.commit()

    with pytest.raises(OidcRecoveryError, match="active local-password administrator"):
        activate_password_only(session)

    configuration = session.get(OidcProviderConfiguration, 1)
    assert configuration is not None
    assert configuration.sign_in_mode == SignInMode.OIDC_ONLY


def test_password_only_endpoint_revokes_session_and_clears_provider_cache(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clear_cache = Mock()
    monkeypatch.setattr(admin_auth_module, "clear_oidc_provider_cache", clear_cache)
    session.add(
        OidcProviderConfiguration(
            display_name="Example",
            issuer_url="https://id.example",
            client_id="sambee",
            sign_in_mode=SignInMode.OIDC_ONLY,
        )
    )
    session.commit()
    headers = {"Authorization": f"Bearer {admin_token}"}

    response = client.post("/api/admin/auth/password-only", headers=headers)

    assert response.status_code == 200
    assert response.json()["reauthentication_required"] is True
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    session.refresh(admin_user)
    assert admin_user.token_version == 1
    clear_cache.assert_called_once_with()
