from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session

from app.models.oidc import OidcBrowserSession, OidcBrowserSessionStatus, OidcProviderConfiguration
from app.models.user import User, UserRole
from app.services.oidc_browser_session import (
    OidcBrowserSessionError,
    OidcRefreshLeaseState,
    acquire_refresh_lease,
    browser_session_cookie_expiry,
    release_refresh_lease,
    validate_browser_session,
)


def test_refresh_lease_allows_only_one_concurrent_provider_refresh(session: Session) -> None:
    configuration = OidcProviderConfiguration(
        display_name="Test provider",
        issuer_url="https://issuer.example",
        client_id="test-client",
    )
    user = User(username="oidc-session-user", role=UserRole.VIEWER, password_hash=None)
    session.add_all([configuration, user])
    session.commit()
    browser_session = OidcBrowserSession(
        user_id=user.id,
        user_token_version=user.token_version,
        provider_configuration_id=configuration.id,
        configuration_revision=1,
        identity_mapping_revision=1,
        issuer="https://issuer.example",
        subject="subject",
        secret_hash="secret-hash",
        encrypted_refresh_token="encrypted-token",
        status=OidcBrowserSessionStatus.ACTIVE,
        authenticated_at=datetime.now(timezone.utc),
        absolute_expires_at=datetime.now(timezone.utc),
    )
    session.add(browser_session)
    session.commit()

    assert acquire_refresh_lease(session, browser_session_id=browser_session.id) == OidcRefreshLeaseState.ACQUIRED
    assert acquire_refresh_lease(session, browser_session_id=browser_session.id) == OidcRefreshLeaseState.IN_PROGRESS

    session.refresh(browser_session)
    release_refresh_lease(browser_session)
    session.add(browser_session)
    session.commit()

    assert acquire_refresh_lease(session, browser_session_id=browser_session.id) == OidcRefreshLeaseState.ACQUIRED


def test_expired_refresh_lease_marks_session_uncertain_instead_of_replaying_token(session: Session) -> None:
    configuration = OidcProviderConfiguration(
        display_name="Test provider",
        issuer_url="https://issuer.example",
        client_id="test-client",
    )
    user = User(username="expired-lease-user", role=UserRole.VIEWER, password_hash=None)
    session.add_all([configuration, user])
    session.commit()
    current_time = datetime.now(timezone.utc)
    browser_session = OidcBrowserSession(
        user_id=user.id,
        user_token_version=user.token_version,
        provider_configuration_id=configuration.id,
        configuration_revision=1,
        identity_mapping_revision=1,
        issuer="https://issuer.example",
        subject="subject",
        secret_hash="secret-hash",
        encrypted_refresh_token="encrypted-token",
        status=OidcBrowserSessionStatus.ACTIVE,
        authenticated_at=current_time,
        absolute_expires_at=current_time + timedelta(days=1),
        refresh_lease_until=current_time - timedelta(seconds=1),
    )
    session.add(browser_session)
    session.commit()

    assert acquire_refresh_lease(session, browser_session_id=browser_session.id, now=current_time) == OidcRefreshLeaseState.EXPIRED

    session.refresh(browser_session)
    assert browser_session.status == OidcBrowserSessionStatus.REFRESH_UNCERTAIN
    assert browser_session.refresh_lease_until is None


def test_policy_increase_does_not_extend_a_session_deadline(session: Session) -> None:
    current_time = datetime.now(timezone.utc)
    configuration = OidcProviderConfiguration(
        display_name="Test provider",
        issuer_url="https://issuer.example",
        client_id="test-client",
        interactive_reauthentication_max_age_days=60,
    )
    user = User(username="deadline-user", role=UserRole.VIEWER, password_hash=None)
    session.add_all([configuration, user])
    session.commit()
    authenticated_at = current_time - timedelta(days=10)
    browser_session = OidcBrowserSession(
        user_id=user.id,
        user_token_version=user.token_version,
        provider_configuration_id=configuration.id,
        configuration_revision=configuration.session_validation_revision,
        identity_mapping_revision=configuration.identity_mapping_revision,
        issuer=configuration.issuer_url,
        subject="subject",
        secret_hash="secret-hash",
        encrypted_refresh_token="encrypted-token",
        status=OidcBrowserSessionStatus.ACTIVE,
        authenticated_at=authenticated_at,
        absolute_expires_at=authenticated_at + timedelta(days=30),
    )
    session.add(browser_session)
    session.commit()

    assert validate_browser_session(session, browser_session=browser_session, now=current_time) == user
    assert browser_session_cookie_expiry(browser_session) == authenticated_at + timedelta(days=30)
    assert browser_session.last_seen_at is None
    assert not session.is_modified(browser_session)

    browser_session.absolute_expires_at = current_time - timedelta(seconds=1)
    session.add(browser_session)
    session.commit()

    with pytest.raises(OidcBrowserSessionError):
        validate_browser_session(session, browser_session=browser_session, now=current_time)
    assert browser_session.status == OidcBrowserSessionStatus.REVOKED


def test_policy_decrease_shortens_a_session_deadline_without_future_extension(session: Session) -> None:
    current_time = datetime.now(timezone.utc)
    configuration = OidcProviderConfiguration(
        display_name="Test provider",
        issuer_url="https://issuer.example",
        client_id="test-client",
        interactive_reauthentication_max_age_days=15,
    )
    user = User(username="shortened-deadline-user", role=UserRole.VIEWER, password_hash=None)
    session.add_all([configuration, user])
    session.commit()
    authenticated_at = current_time - timedelta(days=10)
    browser_session = OidcBrowserSession(
        user_id=user.id,
        user_token_version=user.token_version,
        provider_configuration_id=configuration.id,
        configuration_revision=configuration.session_validation_revision,
        identity_mapping_revision=configuration.identity_mapping_revision,
        issuer=configuration.issuer_url,
        subject="subject",
        secret_hash="secret-hash",
        encrypted_refresh_token="encrypted-token",
        status=OidcBrowserSessionStatus.ACTIVE,
        authenticated_at=authenticated_at,
        absolute_expires_at=authenticated_at + timedelta(days=30),
    )
    session.add(browser_session)
    session.commit()

    assert validate_browser_session(session, browser_session=browser_session, now=current_time) == user
    assert browser_session_cookie_expiry(browser_session) == authenticated_at + timedelta(days=15)

    configuration.interactive_reauthentication_max_age_days = 60
    session.add(configuration)
    session.commit()

    assert validate_browser_session(session, browser_session=browser_session, now=current_time) == user
    assert browser_session_cookie_expiry(browser_session) == authenticated_at + timedelta(days=15)
