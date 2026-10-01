from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models.oidc import (
    OidcBrowserSession,
    OidcBrowserSessionStatus,
    OidcIdentity,
    OidcProviderConfiguration,
    OidcSessionCapability,
    OidcSessionCipherKey,
)
from app.models.user import User, UserRole
from app.services.oidc_browser_session import (
    OidcBrowserSessionError,
    OidcRefreshLeaseState,
    acquire_refresh_lease,
    browser_session_cookie_expiry,
    create_pending_browser_session,
    describe_browser_session_client,
    release_refresh_lease,
    shorten_no_refresh_sessions,
    validate_browser_session,
)
from app.services.oidc_configuration import get_oidc_secret_cipher
from app.services.oidc_mapping import claim_mapping_revision, move_identity


def active_browser_session(
    configuration: OidcProviderConfiguration,
    user: User,
    subject: str,
    now: datetime,
) -> OidcBrowserSession:
    return OidcBrowserSession(
        user_id=user.id,
        user_token_version=user.token_version,
        provider_configuration_id=configuration.id,
        configuration_revision=configuration.session_validation_revision,
        identity_mapping_revision=configuration.identity_mapping_revision,
        issuer=configuration.issuer_url,
        subject=subject,
        secret_hash=f"secret-{subject}",
        encrypted_refresh_token="encrypted-token",
        status=OidcBrowserSessionStatus.ACTIVE,
        authenticated_at=now,
        absolute_expires_at=now + timedelta(days=1),
    )


@pytest.mark.parametrize(
    ("user_agent", "expected"),
    (
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
            ("Chrome", "Windows"),
        ),
        (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
            ("Safari", "iOS"),
        ),
        (
            "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A.241005.015.A2; wv) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36",
            ("Android WebView", "Android"),
        ),
        (None, (None, None)),
        ("custom-client/1.0", (None, None)),
    ),
)
def test_describe_browser_session_client_returns_only_coarse_labels(
    user_agent: str | None, expected: tuple[str | None, str | None]
) -> None:
    assert describe_browser_session_client(user_agent) == expected


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
    assert not session.in_transaction()

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


def test_identity_move_revokes_only_affected_oidc_browser_sessions(session: Session) -> None:
    now = datetime.now(timezone.utc)
    configuration = OidcProviderConfiguration(
        display_name="Test provider",
        issuer_url="https://issuer.example",
        client_id="test-client",
    )
    source = User(username="move-source", role=UserRole.VIEWER, password_hash=None)
    target = User(username="move-target", role=UserRole.VIEWER, password_hash=None)
    administrator = User(username="unrelated-admin", role=UserRole.ADMIN, password_hash=None)
    session.add_all([configuration, source, target, administrator])
    session.commit()

    identity = OidcIdentity(user_id=source.id, issuer=configuration.issuer_url, subject="move-subject")
    source_session = active_browser_session(configuration, source, "source-session", now)
    target_session = active_browser_session(configuration, target, "target-session", now)
    administrator_session = active_browser_session(configuration, administrator, "administrator-session", now)
    session.add_all([identity, source_session, target_session, administrator_session])
    session.commit()

    claim_mapping_revision(session, configuration, configuration.identity_mapping_revision)
    move_identity(
        session,
        configuration=configuration,
        identity_id=identity.id,
        target_user_id=target.id,
        acting_user_id=administrator.id,
    )
    session.commit()

    assert validate_browser_session(session, browser_session=administrator_session, now=now) == administrator
    with pytest.raises(OidcBrowserSessionError):
        validate_browser_session(session, browser_session=source_session, now=now)
    with pytest.raises(OidcBrowserSessionError):
        validate_browser_session(session, browser_session=target_session, now=now)
    assert source_session.status == OidcBrowserSessionStatus.REVOKED
    assert target_session.status == OidcBrowserSessionStatus.REVOKED


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


def test_no_refresh_policy_reduction_is_durable_for_pending_and_active_sessions(session: Session) -> None:
    current_time = datetime.now(timezone.utc).replace(microsecond=0)
    configuration = OidcProviderConfiguration(display_name="IdP", issuer_url="https://issuer.example", client_id="client")
    user = User(username="no-refresh-user", role=UserRole.VIEWER, password_hash=None)
    session.add_all([configuration, user])
    session.commit()
    sessions = [
        OidcBrowserSession(
            user_id=user.id,
            user_token_version=user.token_version,
            provider_configuration_id=configuration.id,
            configuration_revision=configuration.session_validation_revision,
            identity_mapping_revision=configuration.identity_mapping_revision,
            issuer=configuration.issuer_url,
            subject=state.value,
            secret_hash=f"secret-{state.value}",
            capability=OidcSessionCapability.REAUTHORIZATION_ONLY,
            authenticated_at=current_time,
            created_at=current_time,
            absolute_expires_at=current_time + timedelta(hours=8),
            status=state,
        )
        for state in (OidcBrowserSessionStatus.PENDING, OidcBrowserSessionStatus.ACTIVE)
    ]
    renewable = active_browser_session(configuration, user, "renewable", current_time)
    session.add_all([*sessions, renewable])
    session.commit()
    configuration.no_refresh_session_limit_hours = 2
    shorten_no_refresh_sessions(session, configuration_id=configuration.id, hours=2)
    session.add(configuration)
    session.commit()
    configuration.no_refresh_session_limit_hours = 12
    session.add(configuration)
    session.commit()
    session.expire_all()

    assert all(session.get(OidcBrowserSession, entry.id).absolute_expires_at == current_time + timedelta(hours=2) for entry in sessions)
    assert session.get(OidcBrowserSession, renewable.id).absolute_expires_at == current_time + timedelta(days=1)
    with pytest.raises(OidcBrowserSessionError):
        validate_browser_session(
            session, browser_session=session.get(OidcBrowserSession, sessions[1].id), now=current_time + timedelta(hours=2)
        )


def test_no_refresh_pending_session_stores_no_provider_token_or_cipher_key(session: Session) -> None:
    configuration = OidcProviderConfiguration(display_name="IdP", issuer_url="https://issuer.example", client_id="client")
    user = User(username="code-only-user", role=UserRole.VIEWER, password_hash=None)
    session.add_all([configuration, user])
    session.commit()
    current_time = datetime.now(timezone.utc)

    pending = create_pending_browser_session(
        session,
        user=user,
        configuration=configuration,
        issuer=configuration.issuer_url,
        subject="code-only",
        authenticated_at=current_time,
        refresh_token=None,
        session_cipher=None,
        session_cipher_key_id="v1",
        flow_cipher=get_oidc_secret_cipher(),
        user_agent=None,
        now=current_time,
    )
    browser_session = session.get(OidcBrowserSession, pending.session_id)

    assert browser_session.capability == OidcSessionCapability.REAUTHORIZATION_ONLY
    assert browser_session.encrypted_refresh_token is None
    assert browser_session.absolute_expires_at == current_time + timedelta(hours=8)
    assert session.exec(select(OidcSessionCipherKey)).all() == []


@pytest.mark.parametrize("invalid_capability", [OidcSessionCapability.RENEWABLE, OidcSessionCapability.REAUTHORIZATION_ONLY])
def test_database_rejects_mismatched_browser_session_capability(session: Session, invalid_capability: OidcSessionCapability) -> None:
    configuration = OidcProviderConfiguration(display_name="IdP", issuer_url="https://issuer.example", client_id="client")
    user = User(username="capability-user", role=UserRole.VIEWER, password_hash=None)
    session.add_all([configuration, user])
    session.commit()
    browser_session = active_browser_session(configuration, user, "subject", datetime.now(timezone.utc))
    session.add(browser_session)
    session.commit()

    if invalid_capability == OidcSessionCapability.RENEWABLE:
        browser_session.encrypted_refresh_token = None
    else:
        browser_session.capability = OidcSessionCapability.REAUTHORIZATION_ONLY
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


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
