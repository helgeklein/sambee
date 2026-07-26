from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

import app.api.admin_auth as admin_auth_module
from app.models.oidc import OidcProviderConfiguration, SignInMode
from app.models.user import User, UserRole
from app.oidc_admin import activate_password_only_interactively
from app.services.oidc_recovery import (
    OidcRecoveryError,
    activate_password_only,
    count_active_local_password_administrators,
    count_active_passwordless_users,
)


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

    with pytest.raises(OidcRecoveryError, match="password_only_no_local_administrator"):
        activate_password_only(session)

    configuration = session.get(OidcProviderConfiguration, 1)
    assert configuration is not None
    assert configuration.sign_in_mode == SignInMode.OIDC_ONLY


def test_password_only_cli_reports_impact_and_requires_exact_confirmation(
    session: Session, admin_user: User, capsys: pytest.CaptureFixture[str]
) -> None:
    session.add(
        OidcProviderConfiguration(
            display_name="Example",
            issuer_url="https://id.example",
            client_id="sambee",
            sign_in_mode=SignInMode.OIDC_ONLY,
        )
    )
    session.add(User(username="passwordless-user", role=UserRole.VIEWER))
    session.commit()

    with pytest.raises(OidcRecoveryError, match="was not confirmed"):
        activate_password_only_interactively(session, force=False, read_confirmation=lambda _prompt: "no")
    assert session.get(OidcProviderConfiguration, 1).sign_in_mode == SignInMode.OIDC_ONLY  # type: ignore[union-attr]

    activate_password_only_interactively(session, force=False, read_confirmation=lambda _prompt: "password-only")

    output = capsys.readouterr().out
    assert "Active local-password administrators: 1" in output
    assert "Active passwordless accounts that will lose access: 1" in output
    assert session.get(OidcProviderConfiguration, 1).sign_in_mode == SignInMode.PASSWORD_ONLY  # type: ignore[union-attr]
    session.refresh(admin_user)
    assert admin_user.token_version == 1


def test_password_only_cli_force_is_limited_to_deliberate_containment(session: Session) -> None:
    session.add(
        OidcProviderConfiguration(
            display_name="Example",
            issuer_url="https://id.example",
            client_id="sambee",
            sign_in_mode=SignInMode.OIDC_ONLY,
        )
    )
    session.commit()

    with pytest.raises(OidcRecoveryError, match="rerun with --force"):
        activate_password_only_interactively(session, force=False, read_confirmation=lambda _prompt: "password-only")

    activate_password_only_interactively(session, force=True, read_confirmation=lambda _prompt: "password-only")
    assert session.get(OidcProviderConfiguration, 1).sign_in_mode == SignInMode.PASSWORD_ONLY  # type: ignore[union-attr]


def test_password_only_rechecks_both_reviewed_counts(session: Session, admin_user: User) -> None:
    configuration = OidcProviderConfiguration(
        display_name="Example",
        issuer_url="https://id.example",
        client_id="sambee",
        sign_in_mode=SignInMode.OIDC_ONLY,
    )
    session.add(configuration)
    session.commit()

    with pytest.raises(OidcRecoveryError, match="local_password_administrator_count_changed"):
        activate_password_only(
            session,
            expected_configuration_revision=configuration.configuration_revision,
            expected_active_passwordless_user_count=0,
            expected_local_password_administrator_count=count_active_local_password_administrators(session) + 1,
        )


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
    session.add(User(username="passwordless-user", role=UserRole.VIEWER))
    session.commit()
    headers = {"Authorization": f"Bearer {admin_token}"}

    response = client.post(
        "/api/admin/auth/password-only",
        headers=headers,
        json={
            "expected_configuration_revision": 0,
            "expected_active_passwordless_user_count": count_active_passwordless_users(session),
            "acknowledge_passwordless_account_loss": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["reauthentication_required"] is True
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    session.refresh(admin_user)
    assert admin_user.token_version == 1
    clear_cache.assert_called_once_with()


def test_password_only_endpoint_rejects_stale_passwordless_count(
    client: TestClient,
    session: Session,
    admin_token: str,
) -> None:
    configuration = OidcProviderConfiguration(
        display_name="Example",
        issuer_url="https://id.example",
        client_id="sambee",
        sign_in_mode=SignInMode.OIDC_ONLY,
    )
    session.add(configuration)
    session.commit()

    response = client.post(
        "/api/admin/auth/password-only",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "expected_configuration_revision": 0,
            "expected_active_passwordless_user_count": count_active_passwordless_users(session) + 1,
            "acknowledge_passwordless_account_loss": True,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "passwordless_account_count_changed"


def test_password_only_endpoint_requires_passwordless_account_loss_acknowledgement(
    client: TestClient,
    session: Session,
    admin_token: str,
) -> None:
    session.add(
        OidcProviderConfiguration(
            display_name="Example",
            issuer_url="https://id.example",
            client_id="sambee",
            sign_in_mode=SignInMode.OIDC_ONLY,
        )
    )
    session.add(User(username="passwordless-acknowledgement-user", role=UserRole.VIEWER))
    session.commit()

    response = client.post(
        "/api/admin/auth/password-only",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "expected_configuration_revision": 0,
            "expected_active_passwordless_user_count": count_active_passwordless_users(session),
            "acknowledge_passwordless_account_loss": False,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "passwordless_account_loss_not_acknowledged"
