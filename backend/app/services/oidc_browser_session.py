import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from typing import Any, cast

from sqlalchemy import update
from sqlalchemy.engine import CursorResult
from sqlmodel import Session, SQLModel

from app.core.environment import IS_PRODUCTION
from app.models.oidc import OidcBrowserSession, OidcBrowserSessionStatus, OidcProviderConfiguration
from app.models.user import User
from app.services.oidc_configuration import OidcSecretCipher
from app.services.oidc_http import LOGIN_GRANT_LIFETIME_SECONDS

OIDC_BROWSER_SESSION_COOKIE_NAME = "__Host-sambee_oidc_session" if IS_PRODUCTION else "sambee_oidc_session"
OIDC_BROWSER_SESSION_SECRET_BYTES = 32
OIDC_SESSION_CIPHER_KEY_ID = "v1"
OIDC_INTERACTIVE_REAUTHENTICATION_DEFAULT_DAYS = 30
OIDC_INTERACTIVE_REAUTHENTICATION_MIN_DAYS = 1
OIDC_INTERACTIVE_REAUTHENTICATION_MAX_DAYS = 365
OIDC_REFRESH_LEASE_SECONDS = 45
USER_AGENT_CLASSIFICATION_MAX_LENGTH = 512
_OIDC_BROWSER_SESSION_TABLE = SQLModel.metadata.tables["oidcbrowsersession"]


class OidcRefreshLeaseState(StrEnum):
    ACQUIRED = "acquired"
    IN_PROGRESS = "in_progress"
    EXPIRED = "expired"


class OidcBrowserSessionErrorCode(StrEnum):
    MISSING = "missing"
    INVALID = "invalid"
    REAUTHENTICATION_REQUIRED = "reauthentication_required"
    REFRESH_UNCERTAIN = "refresh_uncertain"


class OidcBrowserSessionError(ValueError):
    def __init__(self, code: OidcBrowserSessionErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PendingOidcBrowserSession:
    session_id: uuid.UUID
    encrypted_cookie_secret: str


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("ascii")).hexdigest()


def build_cookie_value(session_id: uuid.UUID, secret: str) -> str:
    return f"{session_id}.{secret}"


def _parse_cookie_value(value: str | None) -> tuple[uuid.UUID, str]:
    if not value:
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.MISSING, "OIDC browser session is missing")
    session_id_text, separator, secret = value.partition(".")
    if not separator or not secret:
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.INVALID, "OIDC browser session is invalid")
    try:
        return uuid.UUID(session_id_text), secret
    except ValueError as error:
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.INVALID, "OIDC browser session is invalid") from error


def _maximum_age_days(configuration: OidcProviderConfiguration) -> int:
    maximum_age_days = configuration.interactive_reauthentication_max_age_days
    if not OIDC_INTERACTIVE_REAUTHENTICATION_MIN_DAYS <= maximum_age_days <= OIDC_INTERACTIVE_REAUTHENTICATION_MAX_DAYS:
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.REAUTHENTICATION_REQUIRED, "OIDC session policy is invalid")
    return maximum_age_days


def browser_session_policy_expiry(browser_session: OidcBrowserSession, configuration: OidcProviderConfiguration) -> datetime:
    """Return the current policy deadline measured from verified IdP auth_time."""

    return _as_utc(browser_session.authenticated_at) + timedelta(days=_maximum_age_days(configuration))


def browser_session_cookie_expiry(browser_session: OidcBrowserSession) -> datetime:
    """Keep the browser cookie no longer than the session's durable deadline."""

    return _as_utc(browser_session.absolute_expires_at)


def describe_browser_session_client(user_agent: str | None) -> tuple[str | None, str | None]:
    """Return coarse browser and OS labels without retaining the User-Agent string."""

    normalized_user_agent = (user_agent or "")[:USER_AGENT_CLASSIFICATION_MAX_LENGTH].lower()
    operating_system = next(
        (
            label
            for token, label in (
                ("iphone", "iOS"),
                ("ipad", "iOS"),
                ("ipod", "iOS"),
                ("android", "Android"),
                ("windows", "Windows"),
                ("cros", "ChromeOS"),
                ("mac os x", "macOS"),
                ("macintosh", "macOS"),
                ("linux", "Linux"),
            )
            if token in normalized_user_agent
        ),
        None,
    )
    browser_name = next(
        (
            label
            for token, label in (
                ("edgios/", "Microsoft Edge"),
                ("edga/", "Microsoft Edge"),
                ("edg/", "Microsoft Edge"),
                ("opr/", "Opera"),
                ("opera/", "Opera"),
                ("fxios/", "Firefox"),
                ("firefox/", "Firefox"),
                (" wv)", "Android WebView"),
                ("crios/", "Chrome"),
                ("chrome/", "Chrome"),
                ("chromium/", "Chromium"),
                ("safari/", "Safari"),
            )
            if token in normalized_user_agent
        ),
        None,
    )
    return browser_name, operating_system


def create_pending_browser_session(
    session: Session,
    *,
    user: User,
    configuration: OidcProviderConfiguration,
    issuer: str,
    subject: str,
    authenticated_at: datetime,
    refresh_token: str,
    session_cipher: OidcSecretCipher,
    session_cipher_key_id: str,
    flow_cipher: OidcSecretCipher,
    user_agent: str | None,
    now: datetime | None = None,
) -> PendingOidcBrowserSession:
    """Persist a callback refresh token without exposing it to the browser or flow."""

    current_time = now or _utc_now()
    authenticated_time = _as_utc(authenticated_at)
    if authenticated_time > current_time + timedelta(minutes=1):
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.REAUTHENTICATION_REQUIRED, "OIDC authentication time is invalid")
    secret = secrets.token_urlsafe(OIDC_BROWSER_SESSION_SECRET_BYTES)
    browser_name, operating_system = describe_browser_session_client(user_agent)
    browser_session = OidcBrowserSession(
        user_id=user.id,
        user_token_version=user.token_version,
        provider_configuration_id=configuration.id,
        configuration_revision=configuration.session_validation_revision,
        identity_mapping_revision=configuration.identity_mapping_revision,
        issuer=issuer,
        subject=subject,
        secret_hash=_hash_secret(secret),
        encrypted_refresh_token=session_cipher.encrypt(refresh_token),
        cipher_key_id=session_cipher_key_id,
        browser_name=browser_name,
        operating_system=operating_system,
        authenticated_at=authenticated_time,
        absolute_expires_at=authenticated_time + timedelta(days=_maximum_age_days(configuration)),
        pending_expires_at=current_time + timedelta(seconds=LOGIN_GRANT_LIFETIME_SECONDS),
    )
    session.add(browser_session)
    session.flush()
    return PendingOidcBrowserSession(
        session_id=browser_session.id,
        encrypted_cookie_secret=flow_cipher.encrypt(secret),
    )


def activate_pending_browser_session(
    session: Session,
    *,
    browser_session_id: uuid.UUID,
    encrypted_cookie_secret: str,
    flow_cipher: OidcSecretCipher,
    now: datetime | None = None,
) -> tuple[OidcBrowserSession, str]:
    current_time = now or _utc_now()
    browser_session = session.get(OidcBrowserSession, browser_session_id)
    if (
        browser_session is None
        or browser_session.status != OidcBrowserSessionStatus.PENDING
        or browser_session.pending_expires_at is None
        or _as_utc(browser_session.pending_expires_at) <= current_time
    ):
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.REAUTHENTICATION_REQUIRED, "OIDC login grant has expired")
    secret = flow_cipher.decrypt(encrypted_cookie_secret)
    if not hmac.compare_digest(browser_session.secret_hash, _hash_secret(secret)):
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.INVALID, "OIDC browser session is invalid")
    browser_session.status = OidcBrowserSessionStatus.ACTIVE
    browser_session.pending_expires_at = None
    browser_session.last_seen_at = current_time
    session.add(browser_session)
    session.flush()
    return browser_session, secret


def resolve_browser_session(
    session: Session,
    *,
    cookie_value: str | None,
    now: datetime | None = None,
) -> OidcBrowserSession:
    current_time = now or _utc_now()
    browser_session = get_browser_session_for_cookie(session, cookie_value=cookie_value)
    validate_browser_session(session, browser_session=browser_session, now=current_time)
    return browser_session


def get_browser_session_for_cookie(session: Session, *, cookie_value: str | None) -> OidcBrowserSession:
    """Resolve a cookie secret without accepting the session for authentication."""

    session_id, secret = _parse_cookie_value(cookie_value)
    browser_session = session.get(OidcBrowserSession, session_id)
    if browser_session is None or not hmac.compare_digest(browser_session.secret_hash, _hash_secret(secret)):
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.INVALID, "OIDC browser session is invalid")
    return browser_session


def validate_browser_session(
    session: Session,
    *,
    browser_session: OidcBrowserSession,
    expected_user_id: uuid.UUID | None = None,
    allow_refresh_uncertain: bool = False,
    now: datetime | None = None,
) -> User:
    current_time = now or _utc_now()
    if browser_session.status == OidcBrowserSessionStatus.REFRESH_UNCERTAIN and not allow_refresh_uncertain:
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.REFRESH_UNCERTAIN, "OIDC refresh outcome is uncertain")
    if browser_session.status not in {OidcBrowserSessionStatus.ACTIVE, OidcBrowserSessionStatus.REFRESH_UNCERTAIN}:
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.REAUTHENTICATION_REQUIRED, "OIDC session requires reauthentication")
    if expected_user_id is not None and browser_session.user_id != expected_user_id:
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.INVALID, "OIDC session user does not match token")
    user = session.get(User, browser_session.user_id)
    configuration = session.get(OidcProviderConfiguration, browser_session.provider_configuration_id)
    expired = user is not None and user.expires_at is not None and _as_utc(user.expires_at) <= current_time
    stored_deadline = _as_utc(browser_session.absolute_expires_at)
    policy_deadline = browser_session_policy_expiry(browser_session, configuration) if configuration is not None else stored_deadline
    effective_deadline = min(stored_deadline, policy_deadline)
    if (
        user is None
        or not user.is_active
        or expired
        or user.token_version != browser_session.user_token_version
        or configuration is None
        or configuration.session_validation_revision != browser_session.configuration_revision
        or effective_deadline <= current_time
    ):
        revoke_browser_session(browser_session, reason="local_authorization_changed", now=current_time)
        session.add(browser_session)
        session.flush()
        raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.REAUTHENTICATION_REQUIRED, "OIDC session requires reauthentication")
    if effective_deadline < stored_deadline:
        browser_session.absolute_expires_at = effective_deadline
    return user


def revoke_expired_pending_browser_sessions(session: Session, *, now: datetime | None = None) -> int:
    """Invalidate callback-created sessions whose single-use grant was never exchanged."""

    current_time = now or _utc_now()
    result = cast(
        CursorResult[Any],
        session.execute(
            update(OidcBrowserSession)
            .where(
                _OIDC_BROWSER_SESSION_TABLE.c.status == OidcBrowserSessionStatus.PENDING,
                _OIDC_BROWSER_SESSION_TABLE.c.pending_expires_at.is_not(None),
                _OIDC_BROWSER_SESSION_TABLE.c.pending_expires_at <= current_time,
            )
            .values(
                status=OidcBrowserSessionStatus.REVOKED,
                revoked_at=current_time,
                revocation_reason="login_grant_expired",
                pending_expires_at=None,
            )
            .execution_options(synchronize_session=False)
        ),
    )
    return int(result.rowcount or 0)


def revoke_browser_session(browser_session: OidcBrowserSession, *, reason: str, now: datetime | None = None) -> None:
    browser_session.status = OidcBrowserSessionStatus.REVOKED
    browser_session.revoked_at = now or _utc_now()
    browser_session.revocation_reason = reason
    browser_session.refresh_lease_until = None


def mark_refresh_uncertain(browser_session: OidcBrowserSession, *, now: datetime | None = None) -> None:
    browser_session.status = OidcBrowserSessionStatus.REFRESH_UNCERTAIN
    browser_session.refresh_lease_until = None
    browser_session.revocation_reason = "refresh_outcome_uncertain"
    browser_session.last_seen_at = now or _utc_now()


def acquire_refresh_lease(
    session: Session,
    *,
    browser_session_id: uuid.UUID,
    now: datetime | None = None,
) -> OidcRefreshLeaseState:
    """Claim the sole right to submit a provider refresh grant for one browser session.

    A lease that expired before recording a result is an unknown provider outcome.
    Reclaiming it could replay a rotated refresh token, so the session is instead
    made unusable until the user completes a new authorization-code login.
    """

    current_time = now or _utc_now()
    statement = (
        update(OidcBrowserSession)
        .where(
            _OIDC_BROWSER_SESSION_TABLE.c.id == browser_session_id,
            _OIDC_BROWSER_SESSION_TABLE.c.status == OidcBrowserSessionStatus.ACTIVE,
            _OIDC_BROWSER_SESSION_TABLE.c.refresh_lease_until.is_(None),
        )
        .values(refresh_lease_until=current_time + timedelta(seconds=OIDC_REFRESH_LEASE_SECONDS))
    )
    result = cast(CursorResult[Any], session.execute(statement.execution_options(synchronize_session=False)))
    if result.rowcount == 1:
        session.commit()
        return OidcRefreshLeaseState.ACQUIRED

    browser_session = session.get(OidcBrowserSession, browser_session_id)
    if (
        browser_session is not None
        and browser_session.status == OidcBrowserSessionStatus.ACTIVE
        and browser_session.refresh_lease_until is not None
        and _as_utc(browser_session.refresh_lease_until) <= current_time
    ):
        expired_result = cast(
            CursorResult[Any],
            session.execute(
                update(OidcBrowserSession)
                .where(
                    _OIDC_BROWSER_SESSION_TABLE.c.id == browser_session_id,
                    _OIDC_BROWSER_SESSION_TABLE.c.status == OidcBrowserSessionStatus.ACTIVE,
                    _OIDC_BROWSER_SESSION_TABLE.c.refresh_lease_until <= current_time,
                )
                .values(
                    status=OidcBrowserSessionStatus.REFRESH_UNCERTAIN,
                    refresh_lease_until=None,
                    revocation_reason="refresh_lease_expired",
                    last_seen_at=current_time,
                )
                .execution_options(synchronize_session=False)
            ),
        )
        if expired_result.rowcount == 1:
            session.commit()
            return OidcRefreshLeaseState.EXPIRED
        session.rollback()
    return OidcRefreshLeaseState.IN_PROGRESS


def release_refresh_lease(browser_session: OidcBrowserSession) -> None:
    browser_session.refresh_lease_until = None
