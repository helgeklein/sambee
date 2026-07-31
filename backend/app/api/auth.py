import asyncio
import json
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Any, cast
from urllib.parse import urlsplit

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, select

from app.core.config import settings
from app.core.environment import IS_PRODUCTION
from app.core.logging import get_logger, set_user
from app.core.security import build_user_access_token, get_current_user_with_auth_check, get_password_hash, is_user_expired, verify_password
from app.db.database import get_session
from app.models.oidc import OidcBrowserSession, OidcBrowserSessionStatus, OidcFlowPurpose, OidcProviderConfiguration
from app.models.oidc_api import OidcBrowserSessionListRead, OidcBrowserSessionRead, OidcBrowserSessionRevokeRead, OidcGrantExchangeRequest
from app.models.user import (
    CurrentAccountRead,
    CurrentUserRead,
    PasswordChangeRequest,
    User,
    build_current_user_read,
    normalize_utc_datetime,
)
from app.models.user_settings import CurrentUserSettingsRead, CurrentUserSettingsUpdate
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event
from app.services.authentication_config import (
    build_public_auth_configuration,
    get_effective_authentication_mode,
    is_password_login_enabled,
)
from app.services.authentication_rate_limit import RateLimitDecision, authentication_rate_limiter, resolve_source_ip
from app.services.oidc_browser_session import (
    OIDC_BROWSER_SESSION_COOKIE_NAME,
    OidcBrowserSessionError,
    OidcBrowserSessionErrorCode,
    OidcRefreshLeaseState,
    acquire_refresh_lease,
    activate_pending_browser_session,
    browser_session_cookie_expiry,
    browser_session_policy_expiry,
    build_cookie_value,
    create_pending_browser_session,
    get_browser_session_for_cookie,
    mark_refresh_uncertain,
    release_refresh_lease,
    resolve_browser_session,
    revoke_browser_session,
    revoke_expired_pending_browser_sessions,
    validate_browser_session,
)
from app.services.oidc_client import (
    OidcClaimMapping,
    OidcClientError,
    OidcClientErrorCode,
    build_authorization_request,
    exchange_and_validate_callback,
    exchange_and_validate_refresh_token,
    load_provider_metadata,
    refresh_provider_jwks,
)
from app.services.oidc_configuration import (
    OidcSecretDecryptionError,
    OidcSessionCipherKeyError,
    decrypt_candidate_snapshot,
    derive_oidc_redirect_uri,
    get_active_oidc_session_cipher,
    get_oidc_secret_cipher,
    get_oidc_session_cipher_for_key,
)
from app.services.oidc_flow import (
    OidcFlowError,
    claim_oidc_callback,
    complete_login_callback,
    complete_test_callback,
    consume_login_grant,
    fail_claimed_callback,
    start_login_flow,
)
from app.services.oidc_http import ID_TOKEN_CLOCK_SKEW_SECONDS, OidcHttpError, ValidatedOidcHttpClient
from app.services.oidc_identity import OidcIdentityError, OidcIdentityErrorCode, resolve_or_provision_oidc_user
from app.services.system_settings import build_network_settings_read
from app.services.user_settings import build_current_user_settings_read, update_current_user_settings

router = APIRouter()
logger = get_logger(__name__)
OIDC_ACCESS_TOKEN_EXPIRE_MINUTES = 60
OIDC_REFRESH_WAIT_SECONDS = 2
OIDC_REFRESH_WAIT_INTERVAL_SECONDS = 0.1
OIDC_REFRESH_RECENT_COMPLETION_SECONDS = 5
OIDC_REFRESH_GENERATION_HEADER = "x-sambee-oidc-refresh-generation"
OIDC_RATE_LIMIT_REDIRECT = "/login#error=oidc_rate_limited"
OIDC_RENEWABLE_SESSION_SCOPE = "offline_access"
_OIDC_BROWSER_SESSION_TABLE = SQLModel.metadata.tables["oidcbrowsersession"]
OIDC_PUBLIC_ERROR_CODES = frozenset(
    {
        "oidc_authorization_state_invalid",
        "oidc_provider_unavailable",
        "oidc_required_claim_missing",
        "oidc_user_not_admitted",
        "oidc_username_collision",
        "oidc_mapping_conflict",
        "oidc_configuration_changed",
        "oidc_last_administrator_role_conflict",
        "oidc_last_administrator_role_conflict_no_password",
    }
)


def _build_login_response(
    user: User,
    *,
    expires_minutes: int,
    return_path: str | None = None,
    oidc_browser_session_id: uuid.UUID | None = None,
    oidc_refresh_generation: int | None = None,
) -> dict[str, Any]:
    access_token = build_user_access_token(
        user,
        expires_delta=timedelta(minutes=expires_minutes),
        oidc_browser_session_id=oidc_browser_session_id,
    )
    response: dict[str, Any] = {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": str(user.id),
        "username": user.username,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "expires_at": normalize_utc_datetime(user.expires_at),
        "must_change_password": user.must_change_password,
        "access_token_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)).isoformat(),
    }
    if return_path is not None:
        response["return_path"] = return_path
    if oidc_refresh_generation is not None:
        response["oidc_refresh_generation"] = oidc_refresh_generation
    return response


def _token_response(payload: dict[str, Any]) -> JSONResponse:
    response = JSONResponse(payload)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


def _clear_oidc_browser_session_cookie(response: Response) -> None:
    response.delete_cookie(OIDC_BROWSER_SESSION_COOKIE_NAME, path="/", secure=IS_PRODUCTION, httponly=True, samesite="strict")


def _set_oidc_browser_session_cookie(response: Response, *, session_id: uuid.UUID, secret: str, expires_at: datetime) -> None:
    max_age = max(1, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
    response.set_cookie(
        OIDC_BROWSER_SESSION_COOKIE_NAME,
        build_cookie_value(session_id, secret),
        max_age=max_age,
        path="/",
        secure=IS_PRODUCTION,
        httponly=True,
        samesite="strict",
    )


def _renew_oidc_browser_session_cookie(response: Response, request: Request, *, expires_at: datetime) -> None:
    cookie_value = request.cookies.get(OIDC_BROWSER_SESSION_COOKIE_NAME)
    if cookie_value is None:
        return
    max_age = max(1, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
    response.set_cookie(
        OIDC_BROWSER_SESSION_COOKIE_NAME,
        cookie_value,
        max_age=max_age,
        path="/",
        secure=IS_PRODUCTION,
        httponly=True,
        samesite="strict",
    )


def _require_same_origin(request: Request, session: Session) -> None:
    configured_public_url = build_network_settings_read(session).public_url
    expected_url = configured_public_url or str(request.base_url)
    expected_origin = _normalized_origin(expected_url)
    origin = request.headers.get("origin")
    if _normalized_origin(origin) == expected_origin:
        return
    referer = request.headers.get("referer")
    if _normalized_origin(referer) == expected_origin:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid request origin")


def _normalized_origin(value: str | None) -> tuple[str, str, int] | None:
    if value is None:
        return None
    parsed = urlsplit(value)
    if not parsed.scheme or parsed.hostname is None:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    default_port = 443 if parsed.scheme.lower() == "https" else 80 if parsed.scheme.lower() == "http" else None
    if default_port is None:
        return None
    return parsed.scheme.lower(), parsed.hostname.lower(), port if port is not None else default_port


def _oidc_refresh_exception(code: str, *, status_code: int = status.HTTP_401_UNAUTHORIZED) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code})


def oidc_reauthentication_required_exception() -> HTTPException:
    """Return the stable error payload consumed by renewable OIDC clients."""

    return _oidc_refresh_exception("oidc_reauthentication_required")


def _known_refresh_generation(request: Request) -> int | None:
    value = request.headers.get(OIDC_REFRESH_GENERATION_HEADER)
    if value is None:
        return None
    try:
        generation = int(value)
    except ValueError:
        return None
    return generation if generation >= 0 else None


def _release_refresh_lease_after_transient_failure(session: Session, browser_session_id: uuid.UUID) -> None:
    session.expire_all()
    browser_session = session.get(OidcBrowserSession, browser_session_id)
    if browser_session is not None:
        release_refresh_lease(browser_session)
        session.commit()


async def _wait_for_refresh_generation(
    session: Session,
    *,
    browser_session_id: uuid.UUID,
    observed_generation: int,
) -> tuple[OidcBrowserSessionStatus | None, User | None, uuid.UUID | None]:
    """Wait briefly for another request to finish the same server-side refresh."""

    attempts = int(OIDC_REFRESH_WAIT_SECONDS / OIDC_REFRESH_WAIT_INTERVAL_SECONDS)
    for _ in range(attempts):
        await asyncio.sleep(OIDC_REFRESH_WAIT_INTERVAL_SECONDS)
        session.expire_all()
        browser_session = session.get(OidcBrowserSession, browser_session_id)
        if browser_session is None:
            return None, None, None
        if browser_session.status != OidcBrowserSessionStatus.ACTIVE:
            return browser_session.status, None, browser_session.id
        if browser_session.refresh_generation > observed_generation:
            try:
                user = validate_browser_session(session, browser_session=browser_session)
                session.commit()
            except OidcBrowserSessionError:
                session.rollback()
                return OidcBrowserSessionStatus.REVOKED, None, browser_session.id
            return OidcBrowserSessionStatus.ACTIVE, user, browser_session.id
    return OidcBrowserSessionStatus.ACTIVE, None, browser_session_id


def _request_source_ip(request: Request, session: Session) -> str:
    direct_peer = request.client.host if request.client is not None else None
    network = build_network_settings_read(session)
    return resolve_source_ip(direct_peer, request.headers.get("x-forwarded-for"), ",".join(network.trusted_proxy_cidrs))


def _rate_limited_response(decision: RateLimitDecision, *, detail: str) -> None:
    if decision.allowed:
        return
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=detail,
        headers={"Retry-After": str(decision.retry_after_seconds)},
    )


def _rate_limited_redirect(decision: RateLimitDecision) -> RedirectResponse | None:
    if decision.allowed:
        return None
    response = RedirectResponse(OIDC_RATE_LIMIT_REDIRECT, status_code=status.HTTP_303_SEE_OTHER)
    response.headers["Retry-After"] = str(decision.retry_after_seconds)
    return response


def _oidc_error_code(error: Exception) -> str:
    if isinstance(error, OidcFlowError):
        return "oidc_authorization_state_invalid"
    if isinstance(error, OidcClientError):
        if error.code == OidcClientErrorCode.REQUIRED_CLAIM_MISSING:
            return "oidc_required_claim_missing"
        return "oidc_provider_unavailable"
    if isinstance(error, OidcIdentityError):
        return {
            OidcIdentityErrorCode.NOT_ADMITTED: "oidc_user_not_admitted",
            OidcIdentityErrorCode.USERNAME_COLLISION: "oidc_username_collision",
            OidcIdentityErrorCode.ACCOUNT_UNAVAILABLE: "oidc_mapping_conflict",
            OidcIdentityErrorCode.LAST_ADMIN_ROLE_CONFLICT: "oidc_last_administrator_role_conflict",
            OidcIdentityErrorCode.LAST_ADMIN_ROLE_CONFLICT_NO_PASSWORD: "oidc_last_administrator_role_conflict_no_password",
        }[error.code]
    if isinstance(error, IntegrityError):
        return "oidc_mapping_conflict"
    if "configuration changed" in str(error).lower():
        return "oidc_configuration_changed"
    return "oidc_provider_unavailable"


def _oidc_failure_category(error: Exception) -> str:
    if isinstance(error, OidcClientError):
        return {
            OidcClientErrorCode.USERINFO_UNAVAILABLE: "user_info_unavailable",
            OidcClientErrorCode.USERINFO_SUBJECT_MISMATCH: "user_info_subject_mismatch",
            OidcClientErrorCode.REQUIRED_CLAIM_MISSING: "required_claim_missing_after_user_info",
        }.get(error.code, "oidc_sign_in_failed")
    return "oidc_sign_in_failed"


def _oidc_error_redirect(error: Exception) -> RedirectResponse:
    code = _oidc_error_code(error)
    if code not in OIDC_PUBLIC_ERROR_CODES:
        code = "oidc_provider_unavailable"
    response = RedirectResponse(f"/login#error={code}", status_code=status.HTTP_303_SEE_OTHER)
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


def _authorization_scopes(scopes_json: str) -> tuple[str, ...]:
    try:
        stored_scopes = json.loads(scopes_json)
    except json.JSONDecodeError as error:
        raise ValueError("OIDC configuration contains invalid scopes") from error
    if not isinstance(stored_scopes, list) or any(not isinstance(scope, str) or not scope for scope in stored_scopes):
        raise ValueError("OIDC configuration contains invalid scopes")
    scopes = tuple(stored_scopes)
    return scopes if OIDC_RENEWABLE_SESSION_SCOPE in scopes else (*scopes, OIDC_RENEWABLE_SESSION_SCOPE)


#
# get_auth_config
#
@router.get("/config")
async def get_auth_config(
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Get authentication configuration.

    Public endpoint that returns the current authentication method.
    Frontend uses this to determine whether to show login form.
    """

    return build_public_auth_configuration(session).model_dump(mode="json")


#
# login
#
@router.post("/token")
async def login(
    request: Request,
    session: Session = Depends(get_session),
) -> JSONResponse:
    """Login endpoint for OAuth2 password flow"""

    if not is_password_login_enabled(session):
        logger.warning("Password login attempt rejected: password authentication is disabled")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Password authentication is not enabled",
        )

    form_data = await request.form()
    username = form_data.get("username")
    password = form_data.get("password")
    if not isinstance(username, str) or not isinstance(password, str) or not username or not password:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Username and password are required")

    _rate_limited_response(
        authentication_rate_limiter.check_password(_request_source_ip(request, session), username),
        detail="Incorrect username or password",
    )

    logger.info(f"Login attempt: username={username}")

    statement = select(User).where(User.username == username)
    user = session.exec(statement).first()

    if (
        not user
        or not user.is_active
        or is_user_expired(user)
        or user.password_hash is None
        or not verify_password(password, user.password_hash)
    ):
        logger.warning(f"Failed login attempt: username={username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    logger.info(f"Successful login: username={user.username}, role={user.role}")
    return _token_response(_build_login_response(user, expires_minutes=settings.access_token_expire_minutes))


@router.get("/oidc/authorize")
async def oidc_authorize(
    request: Request,
    return_path: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> RedirectResponse:
    limited = _rate_limited_redirect(authentication_rate_limiter.check_authorization(_request_source_ip(request, session)))
    if limited is not None:
        return limited
    configuration = session.get(OidcProviderConfiguration, 1)
    effective_mode = get_effective_authentication_mode(session).mode
    if configuration is None or effective_mode.value not in {"oidc_or_password", "oidc_only"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OIDC authentication is not enabled")
    try:
        revoke_expired_pending_browser_sessions(session)
        interactive_reauthentication_required = False
        try:
            existing_browser_session = get_browser_session_for_cookie(
                session,
                cookie_value=request.cookies.get(OIDC_BROWSER_SESSION_COOKIE_NAME),
            )
            interactive_reauthentication_required = (
                existing_browser_session.status != OidcBrowserSessionStatus.ACTIVE
                or browser_session_policy_expiry(existing_browser_session, configuration) <= datetime.now(timezone.utc)
            )
        except OidcBrowserSessionError:
            pass
        cipher = get_oidc_secret_cipher()
        if configuration.encrypted_client_secret is None:
            raise ValueError("OIDC client secret is unavailable")
        cipher.decrypt(configuration.encrypted_client_secret)
        redirect_uri = derive_oidc_redirect_uri(build_network_settings_read(session).public_url)
        async with ValidatedOidcHttpClient() as http_client:
            metadata, _ = await load_provider_metadata(http_client, configuration.issuer_url)
        started = start_login_flow(
            session,
            configuration_revision=configuration.configuration_revision,
            cipher=cipher,
            return_path=return_path,
            interactive_reauthentication_required=interactive_reauthentication_required,
        )
        authorization = build_authorization_request(
            metadata,
            client_id=configuration.client_id,
            redirect_uri=redirect_uri,
            scopes=_authorization_scopes(configuration.scopes_json),
            state=started.state,
            nonce=started.nonce,
            code_verifier=started.code_verifier,
            max_age=0 if interactive_reauthentication_required else configuration.interactive_reauthentication_max_age_days * 24 * 60 * 60,
            prompt="login" if interactive_reauthentication_required else None,
        )
        write_audit_event(
            session,
            event_name=AuditEventName.AUTHORIZATION_STARTED,
            result=AuditResult.SUCCEEDED,
            provider_configuration_id=configuration.id,
        )
        session.commit()
    except Exception as error:
        session.rollback()
        logger.warning("OIDC authorization start failed: category=%s", type(error).__name__)
        return _oidc_error_redirect(error)
    return RedirectResponse(authorization.url, status_code=status.HTTP_303_SEE_OTHER)


@router.get("/oidc/callback")
async def oidc_callback(
    request: Request,
    state_value: str = Query(alias="state"),
    code: str | None = Query(default=None),
    provider_error: str | None = Query(default=None, alias="error"),
    session: Session = Depends(get_session),
) -> RedirectResponse:
    limited = _rate_limited_redirect(authentication_rate_limiter.check_callback(_request_source_ip(request, session)))
    if limited is not None:
        return limited
    claimed_flow_id: uuid.UUID | None = None
    try:
        cipher = get_oidc_secret_cipher()
        claimed = claim_oidc_callback(session, state=state_value, cipher=cipher)
        claimed_flow_id = claimed.flow_id
        if provider_error is not None or code is None:
            raise ValueError("OIDC provider did not return an authorization code")
        active_configuration = session.get(OidcProviderConfiguration, 1)
        active_revision = active_configuration.configuration_revision if active_configuration is not None else None
        if claimed.purpose == OidcFlowPurpose.LOGIN:
            if (
                active_configuration is None
                or get_effective_authentication_mode(session).mode.value not in {"oidc_or_password", "oidc_only"}
                or active_configuration.configuration_revision != claimed.configuration_revision
                or active_configuration.encrypted_client_secret is None
            ):
                raise ValueError("OIDC configuration changed during authorization")
            issuer_url = active_configuration.issuer_url
            client_id = active_configuration.client_id
            client_secret = cipher.decrypt(active_configuration.encrypted_client_secret)
            claim_mapping = OidcClaimMapping(
                username=active_configuration.username_claim,
                groups=active_configuration.groups_claim,
                name=active_configuration.name_claim,
                email=active_configuration.email_claim,
            )
        else:
            if claimed.encrypted_candidate_configuration is None or active_revision != claimed.configuration_revision:
                raise ValueError("OIDC configuration changed during testing")
            candidate = decrypt_candidate_snapshot(claimed.encrypted_candidate_configuration, cipher)
            if candidate.client_secret is None:
                raise ValueError("OIDC client secret is unavailable")
            issuer_url = candidate.issuer_url
            client_id = candidate.client_id
            client_secret = candidate.client_secret
            claim_mapping = OidcClaimMapping(
                username=candidate.username_claim,
                groups=candidate.groups_claim,
                name=candidate.name_claim,
                email=candidate.email_claim,
            )
        redirect_uri = derive_oidc_redirect_uri(build_network_settings_read(session).public_url)
        async with ValidatedOidcHttpClient() as http_client:
            metadata, jwks = await load_provider_metadata(http_client, issuer_url)

            async def refresh_jwks() -> dict[str, Any]:
                return await refresh_provider_jwks(http_client, metadata)

            token_set = await exchange_and_validate_callback(
                http_client,
                metadata,
                jwks,
                client_id=client_id,
                client_secret=client_secret,
                redirect_uri=redirect_uri,
                code=code,
                code_verifier=claimed.code_verifier,
                nonce=claimed.nonce,
                mapping=claim_mapping,
                refresh_jwks=refresh_jwks,
            )
        claims = token_set.claims
        if claimed.purpose == OidcFlowPurpose.TEST:
            if token_set.refresh_token is None or token_set.authenticated_at is None:
                raise ValueError("OIDC provider did not return renewable-session claims")
            complete_test_callback(
                session,
                flow_id=claimed.flow_id,
                encrypted_tested_identity=cipher.encrypt(json.dumps(asdict(claims), separators=(",", ":"), sort_keys=True)),
            )
            response = RedirectResponse(
                f"/browse?settings=admin-authentication#flow={claimed.flow_id}",
                status_code=status.HTTP_303_SEE_OTHER,
            )
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["Cache-Control"] = "no-store"
            return response
        if active_configuration is None:
            raise ValueError("OIDC configuration is unavailable")
        if token_set.authenticated_at is None:
            raise ValueError("OIDC login did not return renewable-session claims")
        if claimed.interactive_reauthentication_required:
            if token_set.authenticated_at < int(claimed.created_at.timestamp()) - ID_TOKEN_CLOCK_SKEW_SECONDS:
                raise ValueError("OIDC provider did not complete the required interactive reauthentication")
        else:
            maximum_age_seconds = active_configuration.interactive_reauthentication_max_age_days * 24 * 60 * 60
            oldest_allowed_authentication = int(datetime.now(timezone.utc).timestamp()) - maximum_age_seconds - ID_TOKEN_CLOCK_SKEW_SECONDS
            if token_set.authenticated_at < oldest_allowed_authentication:
                raise ValueError("OIDC provider returned an authentication older than the requested maximum age")
        correlation_id = request.headers.get("x-request-id")
        user = resolve_or_provision_oidc_user(
            session,
            configuration=active_configuration,
            claims=claims,
            correlation_id=correlation_id,
        )
        if token_set.refresh_token is None:
            raise ValueError("OIDC login did not return renewable-session claims")
        session_cipher = get_active_oidc_session_cipher(session)
        pending_browser_session = create_pending_browser_session(
            session,
            user=user,
            configuration=active_configuration,
            issuer=claims.issuer,
            subject=claims.subject,
            authenticated_at=datetime.fromtimestamp(token_set.authenticated_at, timezone.utc),
            refresh_token=token_set.refresh_token,
            session_cipher=session_cipher.cipher,
            session_cipher_key_id=session_cipher.key_id,
            flow_cipher=cipher,
        )
        validated = complete_login_callback(
            session,
            flow_id=claimed.flow_id,
            user=user,
            oidc_browser_session_id=pending_browser_session.session_id,
            encrypted_browser_session_secret=pending_browser_session.encrypted_cookie_secret,
        )
        write_audit_event(
            session,
            event_name=AuditEventName.BROWSER_SESSION_CREATED,
            result=AuditResult.SUCCEEDED,
            affected_user_id=user.id,
            provider_configuration_id=active_configuration.id,
            correlation_id=correlation_id,
        )
        session.commit()
        response = RedirectResponse(
            f"/login/oidc/callback#grant={validated.grant}",
            status_code=status.HTTP_303_SEE_OTHER,
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception as error:
        session.rollback()
        if claimed_flow_id is not None:
            fail_claimed_callback(session, claimed_flow_id)
        failure_category = _oidc_failure_category(error)
        write_audit_event(
            session,
            event_name=AuditEventName.LOGIN_FAILED,
            result=AuditResult.FAILED,
            details=AuditDetails(failure_category=failure_category),
            correlation_id=request.headers.get("x-request-id"),
        )
        session.commit()
        logger.warning("OIDC callback failed: reason=%s", failure_category)
        return _oidc_error_redirect(error)


@router.post("/oidc/exchange")
async def oidc_exchange(
    payload: OidcGrantExchangeRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> JSONResponse:
    _rate_limited_response(
        authentication_rate_limiter.check_exchange(_request_source_ip(request, session)),
        detail="OIDC login grant is invalid",
    )
    previous_browser_session: OidcBrowserSession | None = None
    try:
        try:
            previous_browser_session = get_browser_session_for_cookie(
                session,
                cookie_value=request.cookies.get(OIDC_BROWSER_SESSION_COOKIE_NAME),
            )
        except OidcBrowserSessionError:
            pass
        revoke_expired_pending_browser_sessions(session)
        consumed = consume_login_grant(session, grant=payload.grant)
        if consumed.oidc_browser_session_id is None or consumed.encrypted_browser_session_secret is None:
            raise OidcFlowError("OIDC login grant is invalid")
        browser_session, secret = activate_pending_browser_session(
            session,
            browser_session_id=consumed.oidc_browser_session_id,
            encrypted_cookie_secret=consumed.encrypted_browser_session_secret,
            flow_cipher=get_oidc_secret_cipher(),
        )
        if previous_browser_session is not None and previous_browser_session.id != browser_session.id:
            revoke_browser_session(previous_browser_session, reason="replaced_by_new_login")
            write_audit_event(
                session,
                event_name=AuditEventName.BROWSER_SESSION_REVOKED,
                result=AuditResult.SUCCEEDED,
                affected_user_id=previous_browser_session.user_id,
                provider_configuration_id=previous_browser_session.provider_configuration_id,
            )
        session.commit()
    except OidcFlowError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OIDC login grant is invalid") from error
    except OidcBrowserSessionError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OIDC login grant is invalid") from error
    response = _token_response(
        _build_login_response(
            consumed.user,
            expires_minutes=OIDC_ACCESS_TOKEN_EXPIRE_MINUTES,
            return_path=consumed.return_path,
            oidc_browser_session_id=browser_session.id,
            oidc_refresh_generation=browser_session.refresh_generation,
        )
    )
    _set_oidc_browser_session_cookie(
        response,
        session_id=browser_session.id,
        secret=secret,
        expires_at=browser_session_cookie_expiry(browser_session),
    )
    return response


@router.post("/oidc/refresh")
async def oidc_refresh(request: Request, session: Session = Depends(get_session)) -> JSONResponse:
    _require_same_origin(request, session)
    _rate_limited_response(
        authentication_rate_limiter.check_refresh(_request_source_ip(request, session)),
        detail="OIDC refresh is temporarily unavailable",
    )
    try:
        browser_session = resolve_browser_session(
            session,
            cookie_value=request.cookies.get(OIDC_BROWSER_SESSION_COOKIE_NAME),
        )
    except OidcBrowserSessionError as error:
        code = "oidc_refresh_uncertain" if error.code == OidcBrowserSessionErrorCode.REFRESH_UNCERTAIN else "oidc_reauthentication_required"
        raise _oidc_refresh_exception(code) from error

    configuration = session.get(OidcProviderConfiguration, browser_session.provider_configuration_id)
    if configuration is None or configuration.encrypted_client_secret is None:
        revoke_browser_session(browser_session, reason="configuration_unavailable")
        session.commit()
        raise _oidc_refresh_exception("oidc_reauthentication_required")
    browser_session_id = browser_session.id
    observed_generation = browser_session.refresh_generation
    known_generation = _known_refresh_generation(request)
    last_refreshed_at = normalize_utc_datetime(browser_session.last_refreshed_at)
    completed_recently = (
        last_refreshed_at is not None
        and (datetime.now(timezone.utc) - last_refreshed_at).total_seconds() <= OIDC_REFRESH_RECENT_COMPLETION_SECONDS
    )
    if (known_generation is not None and observed_generation > known_generation) or (known_generation is None and completed_recently):
        user = validate_browser_session(session, browser_session=browser_session)
        session.commit()
        response = _token_response(
            _build_login_response(
                user,
                expires_minutes=OIDC_ACCESS_TOKEN_EXPIRE_MINUTES,
                oidc_browser_session_id=browser_session.id,
                oidc_refresh_generation=observed_generation,
            )
        )
        _renew_oidc_browser_session_cookie(response, request, expires_at=browser_session_cookie_expiry(browser_session))
        return response
    lease_state = acquire_refresh_lease(session, browser_session_id=browser_session.id)
    if lease_state == OidcRefreshLeaseState.EXPIRED:
        raise _oidc_refresh_exception("oidc_refresh_uncertain")
    if lease_state == OidcRefreshLeaseState.IN_PROGRESS:
        refresh_status, completed_user, completed_session_id = await _wait_for_refresh_generation(
            session,
            browser_session_id=browser_session.id,
            observed_generation=observed_generation,
        )
        if refresh_status == OidcBrowserSessionStatus.REFRESH_UNCERTAIN:
            raise _oidc_refresh_exception("oidc_refresh_uncertain")
        if refresh_status != OidcBrowserSessionStatus.ACTIVE or completed_user is None or completed_session_id is None:
            if refresh_status == OidcBrowserSessionStatus.ACTIVE:
                raise _oidc_refresh_exception("oidc_refresh_in_progress", status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
            raise _oidc_refresh_exception("oidc_reauthentication_required")
        response = _token_response(
            _build_login_response(
                completed_user,
                expires_minutes=OIDC_ACCESS_TOKEN_EXPIRE_MINUTES,
                oidc_browser_session_id=completed_session_id,
                oidc_refresh_generation=observed_generation + 1,
            )
        )
        completed_session = session.get(OidcBrowserSession, completed_session_id)
        if completed_session is not None:
            _renew_oidc_browser_session_cookie(response, request, expires_at=browser_session_cookie_expiry(completed_session))
        return response

    try:
        cipher = get_oidc_secret_cipher()
        session_cipher = get_oidc_session_cipher_for_key(session, browser_session.cipher_key_id)
        active_session_cipher = get_active_oidc_session_cipher(session)
        refresh_token = session_cipher.decrypt(browser_session.encrypted_refresh_token)
        claim_mapping = OidcClaimMapping(
            username=configuration.username_claim,
            groups=configuration.groups_claim,
            name=configuration.name_claim,
            email=configuration.email_claim,
        )
        async with ValidatedOidcHttpClient() as http_client:
            metadata, jwks = await load_provider_metadata(http_client, configuration.issuer_url)

            async def refresh_jwks() -> dict[str, Any]:
                return await refresh_provider_jwks(http_client, metadata)

            token_set = await exchange_and_validate_refresh_token(
                http_client,
                metadata,
                jwks,
                client_id=configuration.client_id,
                client_secret=cipher.decrypt(configuration.encrypted_client_secret),
                refresh_token=refresh_token,
                expected_issuer=browser_session.issuer,
                expected_subject=browser_session.subject,
                mapping=claim_mapping,
                refresh_jwks=refresh_jwks,
            )
        refreshed_user = resolve_or_provision_oidc_user(session, configuration=configuration, claims=token_set.claims)
        if refreshed_user.id != browser_session.user_id:
            raise OidcBrowserSessionError(
                OidcBrowserSessionErrorCode.REAUTHENTICATION_REQUIRED,
                "OIDC refreshed identity does not match its browser session",
            )
        validate_browser_session(session, browser_session=browser_session)
        encrypted_refresh_token = active_session_cipher.cipher.encrypt(token_set.refresh_token or refresh_token)
        completed = cast(
            CursorResult[Any],
            session.execute(
                update(OidcBrowserSession)
                .where(
                    _OIDC_BROWSER_SESSION_TABLE.c.id == browser_session.id,
                    _OIDC_BROWSER_SESSION_TABLE.c.status == OidcBrowserSessionStatus.ACTIVE,
                    _OIDC_BROWSER_SESSION_TABLE.c.refresh_generation == observed_generation,
                    _OIDC_BROWSER_SESSION_TABLE.c.refresh_lease_until.is_not(None),
                )
                .values(
                    encrypted_refresh_token=encrypted_refresh_token,
                    cipher_key_id=active_session_cipher.key_id,
                    refresh_generation=observed_generation + 1,
                    last_refreshed_at=datetime.now(timezone.utc),
                    last_seen_at=datetime.now(timezone.utc),
                    refresh_lease_until=None,
                )
                .execution_options(synchronize_session=False)
            ),
        )
        if completed.rowcount != 1:
            session.rollback()
            raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.REFRESH_UNCERTAIN, "OIDC refresh lease was lost")
        session.expire_all()
        refreshed_browser_session = session.get(OidcBrowserSession, browser_session_id)
        if refreshed_browser_session is None:
            session.rollback()
            raise OidcBrowserSessionError(OidcBrowserSessionErrorCode.REAUTHENTICATION_REQUIRED, "OIDC session is unavailable")
        write_audit_event(
            session,
            event_name=AuditEventName.BROWSER_SESSION_REFRESHED,
            result=AuditResult.SUCCEEDED,
            affected_user_id=refreshed_user.id,
            provider_configuration_id=configuration.id,
        )
        session.commit()
        response = _token_response(
            _build_login_response(
                refreshed_user,
                expires_minutes=OIDC_ACCESS_TOKEN_EXPIRE_MINUTES,
                oidc_browser_session_id=refreshed_browser_session.id,
                oidc_refresh_generation=refreshed_browser_session.refresh_generation,
            )
        )
        _renew_oidc_browser_session_cookie(
            response,
            request,
            expires_at=browser_session_cookie_expiry(refreshed_browser_session),
        )
        return response
    except (OidcClientError, OidcHttpError) as error:
        from app.services.oidc_client import OidcRefreshError, OidcRefreshErrorCode

        if isinstance(error, OidcRefreshError) and error.refresh_code == OidcRefreshErrorCode.PERMANENT:
            revoke_browser_session(browser_session, reason="provider_refresh_rejected")
            session.commit()
            raise _oidc_refresh_exception("oidc_reauthentication_required") from error
        if isinstance(error, OidcRefreshError):
            mark_refresh_uncertain(browser_session)
            write_audit_event(
                session,
                event_name=AuditEventName.BROWSER_SESSION_REFRESH_UNCERTAIN,
                result=AuditResult.BLOCKED,
                affected_user_id=browser_session.user_id,
                provider_configuration_id=browser_session.provider_configuration_id,
            )
            session.commit()
            raise _oidc_refresh_exception("oidc_refresh_uncertain") from error
        _release_refresh_lease_after_transient_failure(session, browser_session_id)
        raise _oidc_refresh_exception("oidc_refresh_temporarily_unavailable", status_code=status.HTTP_503_SERVICE_UNAVAILABLE) from error
    except (OidcBrowserSessionError, OidcIdentityError, OidcSecretDecryptionError, OidcSessionCipherKeyError):
        session.rollback()
        failed_browser_session = session.get(OidcBrowserSession, browser_session_id)
        if failed_browser_session is not None:
            revoke_browser_session(failed_browser_session, reason="local_refresh_validation_failed")
            session.commit()
        raise _oidc_refresh_exception("oidc_reauthentication_required")
    except ValueError as error:
        _release_refresh_lease_after_transient_failure(session, browser_session_id)
        raise _oidc_refresh_exception("oidc_refresh_temporarily_unavailable", status_code=status.HTTP_503_SERVICE_UNAVAILABLE) from error


@router.post("/oidc/logout", status_code=status.HTTP_204_NO_CONTENT)
async def oidc_logout(request: Request, session: Session = Depends(get_session)) -> Response:
    _require_same_origin(request, session)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    try:
        browser_session = resolve_browser_session(session, cookie_value=request.cookies.get(OIDC_BROWSER_SESSION_COOKIE_NAME))
        revoke_browser_session(browser_session, reason="user_logout")
        write_audit_event(
            session,
            event_name=AuditEventName.BROWSER_SESSION_REVOKED,
            result=AuditResult.SUCCEEDED,
            affected_user_id=browser_session.user_id,
            provider_configuration_id=browser_session.provider_configuration_id,
        )
        session.commit()
    except OidcBrowserSessionError:
        session.rollback()
    _clear_oidc_browser_session_cookie(response)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


def _current_browser_session_id(request: Request, session: Session, *, user_id: uuid.UUID) -> uuid.UUID | None:
    try:
        browser_session = get_browser_session_for_cookie(
            session,
            cookie_value=request.cookies.get(OIDC_BROWSER_SESSION_COOKIE_NAME),
        )
    except OidcBrowserSessionError:
        return None
    return browser_session.id if browser_session.user_id == user_id else None


@router.get("/oidc/sessions", response_model=OidcBrowserSessionListRead)
async def list_oidc_browser_sessions(
    request: Request,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> OidcBrowserSessionListRead:
    current_session_id = _current_browser_session_id(request, session, user_id=current_user.id)
    browser_sessions = session.exec(
        select(OidcBrowserSession)
        .where(_OIDC_BROWSER_SESSION_TABLE.c.user_id == current_user.id)
        .where(_OIDC_BROWSER_SESSION_TABLE.c.status != OidcBrowserSessionStatus.REVOKED)
        .order_by(_OIDC_BROWSER_SESSION_TABLE.c.last_seen_at.desc(), _OIDC_BROWSER_SESSION_TABLE.c.created_at.desc())
    ).all()
    return OidcBrowserSessionListRead(
        sessions=[
            OidcBrowserSessionRead(
                id=browser_session.id,
                status=browser_session.status.value,
                created_at=browser_session.created_at,
                authenticated_at=browser_session.authenticated_at,
                last_seen_at=browser_session.last_seen_at,
                last_refreshed_at=browser_session.last_refreshed_at,
                current=browser_session.id == current_session_id,
            )
            for browser_session in browser_sessions
        ]
    )


def _revoke_oidc_browser_sessions(
    request: Request,
    session: Session,
    *,
    current_user: User,
    target_ids: set[uuid.UUID],
    reason: str,
) -> OidcBrowserSessionRevokeRead:
    current_session_id = _current_browser_session_id(request, session, user_id=current_user.id)
    targets = session.exec(
        select(OidcBrowserSession).where(
            _OIDC_BROWSER_SESSION_TABLE.c.user_id == current_user.id,
            _OIDC_BROWSER_SESSION_TABLE.c.id.in_(target_ids),
            _OIDC_BROWSER_SESSION_TABLE.c.status != OidcBrowserSessionStatus.REVOKED,
        )
    ).all()
    for browser_session in targets:
        revoke_browser_session(browser_session, reason=reason)
        write_audit_event(
            session,
            event_name=AuditEventName.BROWSER_SESSION_REVOKED,
            result=AuditResult.SUCCEEDED,
            acting_user_id=current_user.id,
            affected_user_id=current_user.id,
            provider_configuration_id=browser_session.provider_configuration_id,
        )
    session.commit()
    response = OidcBrowserSessionRevokeRead(revoked_count=len(targets))
    if current_session_id in target_ids:
        # The caller receives the response with an expired cookie below.
        request.state.clear_oidc_browser_session_cookie = True
    return response


@router.post("/oidc/sessions/revoke-others", response_model=OidcBrowserSessionRevokeRead)
async def revoke_other_oidc_browser_sessions(
    request: Request,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> OidcBrowserSessionRevokeRead:
    current_session_id = _current_browser_session_id(request, session, user_id=current_user.id)
    targets = session.exec(
        select(OidcBrowserSession.id).where(
            OidcBrowserSession.user_id == current_user.id,
            OidcBrowserSession.status != OidcBrowserSessionStatus.REVOKED,
            OidcBrowserSession.id != current_session_id,
        )
    ).all()
    return _revoke_oidc_browser_sessions(
        request,
        session,
        current_user=current_user,
        target_ids=set(targets),
        reason="user_revoked_other_session",
    )


@router.post("/oidc/sessions/{browser_session_id}/revoke", response_model=OidcBrowserSessionRevokeRead)
async def revoke_oidc_browser_session(
    browser_session_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> Response:
    result = _revoke_oidc_browser_sessions(
        request,
        session,
        current_user=current_user,
        target_ids={browser_session_id},
        reason="user_revoked_session",
    )
    response = _token_response(result.model_dump(mode="json"))
    if getattr(request.state, "clear_oidc_browser_session_cookie", False):
        _clear_oidc_browser_session_cookie(response)
    return response


#
# get_current_user_info
#
@router.get("/me", response_model=CurrentUserRead)
async def get_current_user_info(
    current_user: User = Depends(get_current_user_with_auth_check),
) -> CurrentUserRead:
    """Get current user information"""

    set_user(current_user.username)
    logger.debug(f"User info requested: username={current_user.username}")

    return build_current_user_read(current_user)


@router.get("/account", response_model=CurrentAccountRead)
async def get_current_account(
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> CurrentAccountRead:
    authentication_mode = get_effective_authentication_mode(session).mode
    oidc_enabled = authentication_mode.value in {"oidc_or_password", "oidc_only"}
    configuration = session.get(OidcProviderConfiguration, 1) if oidc_enabled else None
    current_user_data = build_current_user_read(current_user).model_dump()
    return CurrentAccountRead(
        **current_user_data,
        has_local_password=current_user.password_hash is not None,
        password_change_available=current_user.password_hash is not None and is_password_login_enabled(session),
        browser_session_management_available=configuration is not None,
        oidc_provider_name=configuration.display_name if configuration is not None else None,
    )


@router.get("/me/settings", response_model=CurrentUserSettingsRead)
async def get_current_user_settings(
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> CurrentUserSettingsRead:
    set_user(current_user.username)
    return build_current_user_settings_read(user_id=current_user.id, session=session)


@router.put("/me/settings", response_model=CurrentUserSettingsRead)
async def put_current_user_settings(
    payload: CurrentUserSettingsUpdate,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> CurrentUserSettingsRead:
    set_user(current_user.username)
    try:
        update_current_user_settings(user_id=current_user.id, payload=payload, session=session)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return build_current_user_settings_read(user_id=current_user.id, session=session)


#
# change_password
#
@router.post("/change-password")
async def change_password(
    payload: PasswordChangeRequest | None = Body(default=None),
    current_password: str | None = Query(default=None),
    new_password: str | None = Query(default=None),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    """Change current user's password"""

    effective_current_password = payload.current_password if payload else current_password
    effective_new_password = payload.new_password if payload else new_password

    if not effective_current_password or not effective_new_password:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Current and new passwords are required")

    # Reject password changes when auth_method is "none"
    if get_effective_authentication_mode(session).mode.value == "none":
        logger.warning("Password change rejected: auth_method is 'none' (reverse proxy handles auth)")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password changes are not available when authentication is handled by reverse proxy",
        )

    set_user(current_user.username)
    logger.info(f"Password change requested: username={current_user.username}")

    if current_user.password_hash is None:
        logger.warning(f"Password change rejected - no local password: username={current_user.username}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password changes require an existing local password",
        )

    if not verify_password(effective_current_password, current_user.password_hash):
        logger.warning(f"Password change failed - incorrect current password: username={current_user.username}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    current_user.password_hash = get_password_hash(effective_new_password)
    current_user.must_change_password = False
    current_user.token_version += 1
    session.add(current_user)
    session.commit()

    logger.info(f"Password changed successfully: username={current_user.username}")

    return {"message": "Password changed successfully. Please sign in again."}
