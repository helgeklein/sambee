import json
import uuid
from dataclasses import asdict
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlmodel import Session, select

from app.core.auth_methods import AuthMethod
from app.core.config import settings
from app.core.logging import get_logger, set_user
from app.core.security import build_user_access_token, get_current_user_with_auth_check, get_password_hash, is_user_expired, verify_password
from app.db.database import get_session
from app.models.oidc import OidcFlowPurpose, OidcProviderConfiguration, SignInMode
from app.models.oidc_api import OidcGrantExchangeRequest
from app.models.user import CurrentUserRead, PasswordChangeRequest, User, build_current_user_read, normalize_utc_datetime
from app.models.user_settings import CurrentUserSettingsRead, CurrentUserSettingsUpdate
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event
from app.services.authentication_config import build_public_auth_configuration, is_password_login_enabled
from app.services.oidc_client import (
    OidcClaimMapping,
    build_authorization_request,
    exchange_and_validate_callback,
    load_provider_metadata,
)
from app.services.oidc_configuration import OidcSecretCipher, decrypt_candidate_snapshot, derive_oidc_redirect_uri
from app.services.oidc_flow import (
    OidcFlowError,
    claim_oidc_callback,
    complete_login_callback,
    complete_test_callback,
    consume_login_grant,
    fail_claimed_callback,
    start_login_flow,
)
from app.services.oidc_http import JWKS_RESPONSE_LIMIT_BYTES, ValidatedOidcHttpClient
from app.services.oidc_identity import resolve_or_provision_oidc_user
from app.services.user_settings import build_current_user_settings_read, update_current_user_settings

router = APIRouter()
logger = get_logger(__name__)
OIDC_ACCESS_TOKEN_EXPIRE_MINUTES = 60
OIDC_ERROR_REDIRECT = "/login#error=oidc_sign_in_failed"


def _build_login_response(user: User, *, expires_minutes: int, return_path: str | None = None) -> dict[str, Any]:
    access_token = build_user_access_token(user, expires_delta=timedelta(minutes=expires_minutes))
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
    }
    if return_path is not None:
        response["return_path"] = return_path
    return response


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

    configuration = build_public_auth_configuration(session)
    if isinstance(configuration, dict):
        return configuration
    return configuration.model_dump(mode="json")


#
# login
#
@router.post("/token")
async def login(
    request: Request,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
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
    return _build_login_response(user, expires_minutes=settings.access_token_expire_minutes)


@router.get("/oidc/authorize")
async def oidc_authorize(
    return_path: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> RedirectResponse:
    configuration = session.get(OidcProviderConfiguration, 1)
    if configuration is None or configuration.sign_in_mode not in (SignInMode.OIDC_OR_PASSWORD, SignInMode.OIDC_ONLY):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OIDC authentication is not enabled")
    try:
        cipher = OidcSecretCipher(settings.oidc_secret_key)
        if configuration.encrypted_client_secret is None:
            raise ValueError("OIDC client secret is unavailable")
        cipher.decrypt(configuration.encrypted_client_secret)
        redirect_uri = derive_oidc_redirect_uri(settings.public_url)
        async with ValidatedOidcHttpClient() as http_client:
            metadata, _ = await load_provider_metadata(http_client, configuration.issuer_url)
        started = start_login_flow(
            session,
            configuration_revision=configuration.configuration_revision,
            cipher=cipher,
            return_path=return_path,
        )
        authorization = build_authorization_request(
            metadata,
            client_id=configuration.client_id,
            redirect_uri=redirect_uri,
            scopes=tuple(json.loads(configuration.scopes_json)),
            state=started.state,
            nonce=started.nonce,
            code_verifier=started.code_verifier,
        )
        write_audit_event(
            session,
            event_name=AuditEventName.AUTHORIZATION_STARTED,
            result=AuditResult.SUCCEEDED,
            provider_configuration_id=configuration.id,
        )
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("OIDC authorization start failed")
        return RedirectResponse(OIDC_ERROR_REDIRECT, status_code=status.HTTP_303_SEE_OTHER)
    return RedirectResponse(authorization.url, status_code=status.HTTP_303_SEE_OTHER)


@router.get("/oidc/callback")
async def oidc_callback(
    request: Request,
    state_value: str = Query(alias="state"),
    code: str | None = Query(default=None),
    provider_error: str | None = Query(default=None, alias="error"),
    session: Session = Depends(get_session),
) -> RedirectResponse:
    claimed_flow_id: uuid.UUID | None = None
    try:
        cipher = OidcSecretCipher(settings.oidc_secret_key)
        claimed = claim_oidc_callback(session, state=state_value, cipher=cipher)
        claimed_flow_id = claimed.flow_id
        if provider_error is not None or code is None:
            raise ValueError("OIDC provider did not return an authorization code")
        active_configuration = session.get(OidcProviderConfiguration, 1)
        active_revision = active_configuration.configuration_revision if active_configuration is not None else None
        if claimed.purpose == OidcFlowPurpose.LOGIN:
            if (
                active_configuration is None
                or active_configuration.sign_in_mode not in (SignInMode.OIDC_OR_PASSWORD, SignInMode.OIDC_ONLY)
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
        redirect_uri = derive_oidc_redirect_uri(settings.public_url)
        async with ValidatedOidcHttpClient() as http_client:
            metadata, jwks = await load_provider_metadata(http_client, issuer_url)

            async def refresh_jwks() -> dict[str, Any]:
                response = await http_client.request_json("GET", metadata.jwks_uri, response_limit=JWKS_RESPONSE_LIMIT_BYTES)
                return response.data

            claims = await exchange_and_validate_callback(
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
        if claimed.purpose == OidcFlowPurpose.TEST:
            complete_test_callback(
                session,
                flow_id=claimed.flow_id,
                encrypted_tested_identity=cipher.encrypt(json.dumps(asdict(claims), separators=(",", ":"), sort_keys=True)),
            )
            response = RedirectResponse(
                f"/settings/admin/authentication#flow={claimed.flow_id}",
                status_code=status.HTTP_303_SEE_OTHER,
            )
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["Cache-Control"] = "no-store"
            return response
        if active_configuration is None:
            raise ValueError("OIDC configuration is unavailable")
        correlation_id = request.headers.get("x-request-id")
        user = resolve_or_provision_oidc_user(
            session,
            configuration=active_configuration,
            claims=claims,
            correlation_id=correlation_id,
        )
        validated = complete_login_callback(session, flow_id=claimed.flow_id, user=user)
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
        write_audit_event(
            session,
            event_name=AuditEventName.LOGIN_FAILED,
            result=AuditResult.FAILED,
            details=AuditDetails(failure_category="oidc_sign_in_failed"),
            correlation_id=request.headers.get("x-request-id"),
        )
        session.commit()
        logger.warning("OIDC callback failed: category=%s", type(error).__name__)
        response = RedirectResponse(OIDC_ERROR_REDIRECT, status_code=status.HTTP_303_SEE_OTHER)
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response


@router.post("/oidc/exchange")
async def oidc_exchange(
    payload: OidcGrantExchangeRequest,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        user, return_path = consume_login_grant(session, grant=payload.grant)
    except OidcFlowError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OIDC login grant is invalid") from error
    return _build_login_response(user, expires_minutes=OIDC_ACCESS_TOKEN_EXPIRE_MINUTES, return_path=return_path)


#
# get_current_user_info
#
@router.get("/me", response_model=CurrentUserRead)
async def get_current_user_info(
    current_user: User = Depends(get_current_user_with_auth_check),
) -> CurrentUserRead:
    """Get current user information"""

    set_user(current_user.username)
    logger.info(f"User info requested: username={current_user.username}")

    return build_current_user_read(current_user)


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
    if settings.auth_method == AuthMethod.NONE:
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
