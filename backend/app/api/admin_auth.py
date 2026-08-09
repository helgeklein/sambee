import json
import uuid
from datetime import datetime, timezone
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.auth_methods import AuthenticationMode
from app.core.security import (
    BrowserAuthentication,
    get_admin_browser_authentication_allowing_stale_token,
    get_current_admin_user,
    is_user_expired,
)
from app.db.database import get_session
from app.models.oidc import (
    OidcFlow,
    OidcFlowPurpose,
    OidcFlowStatus,
    OidcIdentity,
    OidcPendingIdentityMapping,
    OidcProviderConfiguration,
    SignInMode,
)
from app.models.oidc_api import (
    AuthenticationModeActivationRequest,
    AuthenticationModeActivationResponse,
    OidcAdminConfigurationRead,
    OidcConfigurationCandidate,
    OidcFinalizeRequest,
    OidcFinalizeResponse,
    OidcIdentityMoveRequest,
    OidcMappingChangeRequest,
    OidcMappingMutationResponse,
    OidcPendingMappingBatchRequest,
    OidcPendingMappingRead,
    OidcReviewedPolicy,
    OidcSessionCipherKeyRotationRead,
    OidcTestedIdentityRead,
    OidcTestPreviewRequest,
    OidcTestStartResponse,
    PasswordOnlyActivationRequest,
)
from app.models.user import User, UserRole
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event
from app.services.authentication_config import (
    get_configured_authentication_mode,
    is_authentication_enforcement_disabled,
    set_ui_authentication_mode,
)
from app.services.oidc_client import (
    NormalizedOidcClaims,
    OidcClientError,
    build_authorization_request,
    clear_oidc_provider_cache,
    load_provider_metadata,
)
from app.services.oidc_configuration import (
    NormalizedOidcCandidate,
    OidcConfigurationError,
    OidcSecretCipher,
    apply_reviewed_policy,
    build_authentication_health,
    decrypt_candidate_snapshot,
    derive_oidc_redirect_uri,
    encrypt_candidate_snapshot,
    get_oidc_secret_cipher,
    normalize_candidate,
    redacted_candidate,
    redacted_configuration,
    rotate_oidc_session_cipher_key,
)
from app.services.oidc_flow import start_test_flow
from app.services.oidc_http import OidcHttpError, ValidatedOidcHttpClient
from app.services.oidc_identity import OidcIdentityError, evaluate_oidc_access, resolve_oidc_role
from app.services.oidc_mapping import (
    OidcMappingError,
    cancel_pending_mapping,
    change_identity,
    claim_mapping_revision,
    detach_identity,
    move_identity,
    replace_pending_mappings,
    validate_pending_mapping_batch,
)
from app.services.oidc_recovery import OidcRecoveryError, activate_password_only, count_active_passwordless_users
from app.services.system_settings import build_network_settings_read

router = APIRouter()
OIDC_SESSION_INVALIDATING_FIELDS = frozenset(
    {
        "issuer_url",
        "client_id",
        "scopes",
        "username_claim",
        "name_claim",
        "email_claim",
        "groups_claim",
        "admission_mode",
        "admission_groups",
        "role_assignment_mode",
        "uniform_role",
        "role_mappings",
    }
)


def _active_oidc_configuration(session: Session) -> OidcProviderConfiguration:
    configuration = session.get(OidcProviderConfiguration, 1)
    if configuration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OIDC configuration was not found")
    return configuration


def _mapping_http_exception(error: OidcMappingError) -> HTTPException:
    errors = error.validation_errors or (error,)
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "errors": [
                {
                    "target_user_id": str(item.target_user_id) if item.target_user_id is not None else None,
                    "field": item.field,
                    "error_code": item.error_code,
                    "message": str(item),
                }
                for item in errors
            ]
        },
    )


def _commit_mapping_mutation(
    session: Session,
    identity_mapping_revision: int,
    configuration: OidcProviderConfiguration,
) -> OidcMappingMutationResponse:
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC mapping changed concurrently") from error
    pending_mappings = session.exec(
        select(OidcPendingIdentityMapping).where(OidcPendingIdentityMapping.provider_configuration_id == configuration.id)
    ).all()
    return OidcMappingMutationResponse(
        identity_mapping_revision=identity_mapping_revision,
        pending_mappings=[
            OidcPendingMappingRead(
                target_user_id=mapping.target_user_id,
                expected_username=mapping.expected_username,
                created_at=mapping.created_at,
            )
            for mapping in pending_mappings
        ],
    )


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _has_active_admin(session: Session) -> bool:
    now = datetime.now(timezone.utc)
    administrators = session.exec(select(User).where(User.role == UserRole.ADMIN, User.is_active == True)).all()  # noqa: E712
    return any(user.expires_at is None or _as_utc(user.expires_at) > now for user in administrators)


def _tested_claims(ciphertext: str, cipher: OidcSecretCipher) -> NormalizedOidcClaims:
    try:
        data = json.loads(cipher.decrypt(ciphertext))
        data["groups"] = tuple(data["groups"])
        return NormalizedOidcClaims(**data)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC test result is invalid") from error


def _proposed_configuration(
    candidate: NormalizedOidcCandidate,
    cipher: OidcSecretCipher,
    *,
    active: OidcProviderConfiguration | None,
    updated_by_user_id: uuid.UUID,
    identity_mapping_revision: int,
) -> OidcProviderConfiguration:
    if candidate.client_secret is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC client secret is unavailable")
    return OidcProviderConfiguration(
        display_name=candidate.display_name,
        issuer_url=candidate.issuer_url,
        client_id=candidate.client_id,
        encrypted_client_secret=cipher.encrypt(candidate.client_secret),
        scopes_json=json.dumps(candidate.scopes),
        username_claim=candidate.username_claim,
        name_claim=candidate.name_claim,
        email_claim=candidate.email_claim,
        groups_claim=candidate.groups_claim,
        sign_in_mode=candidate.sign_in_mode,
        interactive_reauthentication_max_age_days=candidate.interactive_reauthentication_max_age_days,
        admission_mode=candidate.admission_mode,
        admission_groups_json=json.dumps(candidate.admission_groups),
        role_assignment_mode=candidate.role_assignment_mode,
        uniform_role=candidate.uniform_role,
        role_mappings_json=json.dumps(
            {"admin": candidate.admin_groups, "editor": candidate.editor_groups, "viewer": candidate.viewer_groups}
        ),
        auto_link_by_username=candidate.auto_link_by_username,
        configuration_revision=candidate.configuration_revision,
        session_validation_revision=(
            (active.session_validation_revision if active is not None else 0) + 1
            if active is None or set(candidate.changed_fields).intersection(OIDC_SESSION_INVALIDATING_FIELDS)
            else active.session_validation_revision
        ),
        identity_mapping_revision=identity_mapping_revision,
        updated_by_user_id=updated_by_user_id,
    )


def _reviewed_candidate(
    tested_candidate: NormalizedOidcCandidate,
    reviewed_policy: OidcReviewedPolicy,
    active: OidcProviderConfiguration | None,
    cipher: OidcSecretCipher,
) -> NormalizedOidcCandidate:
    if reviewed_policy.sign_in_mode == SignInMode.PASSWORD_ONLY:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="oidc_tested_activation_mode_invalid")
    try:
        return apply_reviewed_policy(tested_candidate, reviewed_policy, active, cipher)
    except OidcConfigurationError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error


def _affected_user_ids(
    session: Session,
    *,
    candidate: NormalizedOidcCandidate,
    active: OidcProviderConfiguration | None,
    tested: NormalizedOidcClaims,
    acting_user_id: uuid.UUID,
) -> set[uuid.UUID]:
    identities = session.exec(select(OidcIdentity)).all()
    identity_user_ids = {identity.user_id for identity in identities}
    affected: set[uuid.UUID] = set()
    if "sign_in_mode" in candidate.changed_fields:
        affected.update(user.id for user in session.exec(select(User)).all())
    elif set(candidate.changed_fields).intersection(OIDC_SESSION_INVALIDATING_FIELDS):
        affected.update(identity_user_ids)
    existing_subject = next(
        (identity for identity in identities if identity.issuer == tested.issuer and identity.subject == tested.subject),
        None,
    )
    if existing_subject is None or existing_subject.user_id != acting_user_id:
        affected.add(acting_user_id)
    return affected


@router.get("/auth/oidc", response_model=OidcAdminConfigurationRead)
async def get_oidc_configuration(
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcAdminConfigurationRead:
    configuration = session.get(OidcProviderConfiguration, 1)
    configured_mode = get_configured_authentication_mode(session)
    network = build_network_settings_read(session)
    health = build_authentication_health(
        public_url=network.public_url,
        encrypted_client_secret=configuration.encrypted_client_secret if configuration else None,
        has_active_administrator=_has_active_admin(session),
    )
    return OidcAdminConfigurationRead(
        configuration=redacted_configuration(configuration) if configuration is not None else None,
        health=health,
        active_passwordless_user_count=count_active_passwordless_users(session),
        auth_mode=configured_mode,
        auth_enforcement_disabled=is_authentication_enforcement_disabled(),
    )


@router.post("/auth/oidc/session-cipher-key/rotate", response_model=OidcSessionCipherKeyRotationRead)
async def rotate_oidc_session_cipher_key_endpoint(
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcSessionCipherKeyRotationRead:
    """Rotate the active session-secret key while retaining retired decrypt-only keys."""

    active_key = rotate_oidc_session_cipher_key(session)
    write_audit_event(
        session,
        event_name=AuditEventName.BROWSER_SESSION_CIPHER_KEY_ROTATED,
        result=AuditResult.SUCCEEDED,
        acting_user_id=current_user.id,
    )
    session.commit()
    return OidcSessionCipherKeyRotationRead(active_key_id=active_key.key_id)


@router.post("/auth/oidc/test", response_model=OidcTestStartResponse)
async def start_oidc_test(
    candidate: OidcConfigurationCandidate,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcTestStartResponse:
    active = session.get(OidcProviderConfiguration, 1)
    try:
        cipher = get_oidc_secret_cipher()
        normalized = normalize_candidate(candidate, active, cipher)
        if normalized.client_secret is None:
            raise OidcConfigurationError("OIDC test requires a client secret")
        redirect_uri = derive_oidc_redirect_uri(build_network_settings_read(session).public_url)
        async with ValidatedOidcHttpClient() as http_client:
            metadata, _ = await load_provider_metadata(http_client, normalized.issuer_url)
        started = start_test_flow(
            session,
            initiating_admin_id=current_user.id,
            encrypted_candidate_configuration=encrypt_candidate_snapshot(normalized, cipher),
            active_configuration_revision=active.configuration_revision if active is not None else None,
            cipher=cipher,
        )
        authorization = build_authorization_request(
            metadata,
            client_id=normalized.client_id,
            redirect_uri=redirect_uri,
            scopes=normalized.scopes,
            state=started.state,
            nonce=started.nonce,
            code_verifier=started.code_verifier,
        )
        write_audit_event(
            session,
            event_name=AuditEventName.CONFIG_VALIDATED,
            result=AuditResult.SUCCEEDED,
            details=AuditDetails(changed_fields=normalized.changed_fields),
            acting_user_id=current_user.id,
            provider_configuration_id=active.id if active is not None else None,
        )
        session.commit()
        return OidcTestStartResponse(flow_id=started.flow_id, authorization_url=authorization.url)
    except (OidcConfigurationError, OidcClientError, OidcHttpError) as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    except ValueError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC configuration validation failed") from error


def _get_owned_validated_test_flow(session: Session, flow_id: uuid.UUID, current_user: User) -> OidcFlow:
    flow = session.get(OidcFlow, flow_id)
    now = datetime.now(timezone.utc)
    if (
        flow is None
        or flow.purpose != OidcFlowPurpose.TEST
        or flow.status != OidcFlowStatus.CALLBACK_VALIDATED
        or flow.initiating_admin_id != current_user.id
        or flow.encrypted_candidate_configuration is None
        or flow.encrypted_tested_identity is None
        or _as_utc(flow.expires_at) <= now
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OIDC test flow was not found")
    return flow


@router.post("/auth/oidc/test-flows/{flow_id}/preview", response_model=OidcTestedIdentityRead)
async def get_oidc_test_result(
    flow_id: uuid.UUID,
    payload: OidcTestPreviewRequest,
    response: Response,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcTestedIdentityRead:
    response.headers["Cache-Control"] = "no-store"
    flow = _get_owned_validated_test_flow(session, flow_id, current_user)
    cipher = get_oidc_secret_cipher()
    claims = _tested_claims(cast(str, flow.encrypted_tested_identity), cipher)
    tested_candidate = decrypt_candidate_snapshot(cast(str, flow.encrypted_candidate_configuration), cipher)
    active = session.get(OidcProviderConfiguration, 1)
    active_revision = active.configuration_revision if active is not None else None
    if active_revision != flow.configuration_revision:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="oidc_configuration_changed")
    candidate = (
        _reviewed_candidate(tested_candidate, payload.reviewed_policy, active, cipher)
        if payload.reviewed_policy is not None
        else tested_candidate
    )
    proposed = _proposed_configuration(
        candidate,
        cipher,
        active=active,
        updated_by_user_id=current_user.id,
        identity_mapping_revision=active.identity_mapping_revision if active is not None else 0,
    )
    try:
        evaluation = evaluate_oidc_access(proposed, claims.groups, individual_role=UserRole.ADMIN)
    except OidcIdentityError:
        evaluation = None
    affected_user_ids = _affected_user_ids(
        session,
        candidate=candidate,
        active=active,
        tested=claims,
        acting_user_id=current_user.id,
    )
    return OidcTestedIdentityRead(
        flow_id=flow.id,
        candidate=redacted_candidate(candidate),
        replacement_mappings=[],
        expected_identity_mapping_revision=active.identity_mapping_revision if active is not None else None,
        username=claims.username,
        name=claims.name,
        email=claims.email,
        groups=list(claims.groups),
        admitted=evaluation is not None,
        matching_admission_group=evaluation.matching_admission_group if evaluation is not None else None,
        affected_account_count=len(affected_user_ids),
        acting_administrator_affected=current_user.id in affected_user_ids,
        expires_at=flow.expires_at,
    )


@router.delete("/auth/oidc/test-flows/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_oidc_test_flow(
    flow_id: uuid.UUID,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> None:
    table = OidcFlow.__table__  # type: ignore[attr-defined]
    result = session.connection().execute(
        delete(table).where(
            table.c.id == flow_id,
            table.c.purpose == OidcFlowPurpose.TEST,
            table.c.initiating_admin_id == current_user.id,
            table.c.status.in_(
                (
                    OidcFlowStatus.STARTED,
                    OidcFlowStatus.CALLBACK_PROCESSING,
                    OidcFlowStatus.CALLBACK_VALIDATED,
                )
            ),
            table.c.expires_at > datetime.now(timezone.utc),
        )
    )
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OIDC test flow was not found")
    session.commit()


@router.post("/auth/oidc/finalize", response_model=OidcFinalizeResponse)
async def finalize_oidc_configuration(
    payload: OidcFinalizeRequest,
    authentication: BrowserAuthentication = Depends(get_admin_browser_authentication_allowing_stale_token),
    session: Session = Depends(get_session),
) -> OidcFinalizeResponse:
    current_user = authentication.user
    existing_flow = session.get(OidcFlow, payload.flow_id)
    now = datetime.now(timezone.utc)
    if (
        existing_flow is not None
        and existing_flow.purpose == OidcFlowPurpose.TEST
        and existing_flow.status == OidcFlowStatus.CONSUMED
        and existing_flow.initiating_admin_id == current_user.id
        and existing_flow.finalized_configuration_revision is not None
        and existing_flow.finalized_identity_mapping_revision is not None
        and _as_utc(existing_flow.expires_at) > now
    ):
        return OidcFinalizeResponse(
            configuration_revision=existing_flow.finalized_configuration_revision,
            identity_mapping_revision=existing_flow.finalized_identity_mapping_revision,
            reauthentication_required=bool(existing_flow.finalized_reauthentication_required),
        )
    if not authentication.token_version_current:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    flow = _get_owned_validated_test_flow(session, payload.flow_id, current_user)
    cipher = get_oidc_secret_cipher()
    tested_candidate = decrypt_candidate_snapshot(cast(str, flow.encrypted_candidate_configuration), cipher)
    tested = _tested_claims(cast(str, flow.encrypted_tested_identity), cipher)
    active = session.get(OidcProviderConfiguration, 1)
    active_revision = active.configuration_revision if active is not None else None
    if active_revision != flow.configuration_revision:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="oidc_configuration_changed")
    candidate = _reviewed_candidate(tested_candidate, payload.reviewed_policy, active, cipher)
    username_claim_changed = active is not None and candidate.username_claim != active.username_claim
    if active is not None and username_claim_changed and active.identity_mapping_revision != candidate.identity_mapping_revision:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="oidc_mapping_review_stale")

    expected_mapping_revision = active.identity_mapping_revision if active is not None else None
    if payload.expected_identity_mapping_revision != expected_mapping_revision:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="oidc_mapping_review_stale")
    if payload.replacement_mappings or payload.omitted_account_acknowledgements:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC mapping review is not expected")

    proposed = _proposed_configuration(
        candidate,
        cipher,
        active=active,
        updated_by_user_id=current_user.id,
        identity_mapping_revision=active.identity_mapping_revision if active is not None else 0,
    )
    try:
        role = resolve_oidc_role(proposed, tested.groups, individual_role=UserRole.ADMIN)
    except OidcIdentityError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tested administrator is not admitted") from error
    if role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tested administrator does not resolve to administrator")

    if active is not None:
        configuration_table = OidcProviderConfiguration.__table__  # type: ignore[attr-defined]
        configuration_claim = session.connection().execute(
            update(configuration_table)
            .where(
                configuration_table.c.id == active.id,
                configuration_table.c.configuration_revision == flow.configuration_revision,
                configuration_table.c.identity_mapping_revision == expected_mapping_revision,
            )
            .values(configuration_revision=candidate.configuration_revision)
        )
        if configuration_claim.rowcount != 1:
            session.rollback()
            latest = session.get(OidcProviderConfiguration, active.id)
            detail = (
                "oidc_configuration_changed"
                if latest is None or latest.configuration_revision != flow.configuration_revision
                else "oidc_mapping_review_stale"
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
        session.expire(active, ["configuration_revision", "identity_mapping_revision"])

    existing_subject = session.exec(
        select(OidcIdentity).where(OidcIdentity.issuer == tested.issuer, OidcIdentity.subject == tested.subject)
    ).first()
    existing_user_identities = session.exec(select(OidcIdentity).where(OidcIdentity.user_id == current_user.id)).all()
    if existing_subject is not None and existing_subject.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tested OIDC identity is already mapped")
    affected_user_ids = _affected_user_ids(
        session,
        candidate=candidate,
        active=active,
        tested=tested,
        acting_user_id=current_user.id,
    )

    flow_table = OidcFlow.__table__  # type: ignore[attr-defined]
    claim_result = session.connection().execute(
        update(flow_table)
        .where(
            flow_table.c.id == flow.id,
            flow_table.c.purpose == OidcFlowPurpose.TEST,
            flow_table.c.status == OidcFlowStatus.CALLBACK_VALIDATED,
            flow_table.c.initiating_admin_id == current_user.id,
            flow_table.c.expires_at > datetime.now(timezone.utc),
        )
        .values(status=OidcFlowStatus.FINALIZING)
    )
    if claim_result.rowcount != 1:
        session.rollback()
        completed_flow = session.get(OidcFlow, payload.flow_id, populate_existing=True)
        if (
            completed_flow is not None
            and completed_flow.status == OidcFlowStatus.CONSUMED
            and completed_flow.initiating_admin_id == current_user.id
            and completed_flow.finalized_configuration_revision is not None
            and completed_flow.finalized_identity_mapping_revision is not None
            and _as_utc(completed_flow.expires_at) > datetime.now(timezone.utc)
        ):
            return OidcFinalizeResponse(
                configuration_revision=completed_flow.finalized_configuration_revision,
                identity_mapping_revision=completed_flow.finalized_identity_mapping_revision,
                reauthentication_required=bool(completed_flow.finalized_reauthentication_required),
            )
        if completed_flow is not None and _as_utc(completed_flow.expires_at) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OIDC test flow was not found")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC finalization is already in progress")
    flow.status = OidcFlowStatus.FINALIZING
    initiating_admin = session.exec(select(User).where(User.id == current_user.id).execution_options(populate_existing=True)).first()
    if (
        initiating_admin is None
        or initiating_admin.role != UserRole.ADMIN
        or not initiating_admin.is_active
        or is_user_expired(initiating_admin)
    ):
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="oidc_initiating_administrator_unavailable")
    if initiating_admin.oidc_role_assignment != UserRole.ADMIN:
        previous_assignment = initiating_admin.oidc_role_assignment
        initiating_admin.oidc_role_assignment = UserRole.ADMIN
        initiating_admin.token_version += 1
        session.add(initiating_admin)
        write_audit_event(
            session,
            event_name=AuditEventName.USER_ROLE_ASSIGNMENT_CHANGED,
            result=AuditResult.SUCCEEDED,
            details=AuditDetails(
                selected_role=UserRole.ADMIN.value,
                changed_fields=(previous_assignment.value if previous_assignment is not None else "group_based",),
            ),
            acting_user_id=current_user.id,
            affected_user_id=current_user.id,
            provider_configuration_id=active.id if active is not None else None,
        )

    mappings_changed = False
    if username_claim_changed and active is not None:
        for pending in session.exec(
            select(OidcPendingIdentityMapping).where(OidcPendingIdentityMapping.provider_configuration_id == active.id)
        ).all():
            mappings_changed = True
            write_audit_event(
                session,
                event_name=AuditEventName.PENDING_MAPPING_CANCELED,
                result=AuditResult.SUCCEEDED,
                details=AuditDetails(username=pending.expected_username),
                acting_user_id=current_user.id,
                affected_user_id=pending.target_user_id,
                provider_configuration_id=active.id,
            )
            session.delete(pending)

    if active is None:
        active = proposed
        session.add(active)
    else:
        for key, value in proposed.model_dump(exclude={"id", "created_at"}).items():
            setattr(active, key, value)
        session.add(active)
    session.flush()
    identities_to_remove = [identity for identity in existing_user_identities if identity is not existing_subject]
    if existing_subject is None or identities_to_remove:
        mappings_changed = True
        for identity in identities_to_remove:
            session.delete(identity)
        if existing_subject is None:
            session.add(
                OidcIdentity(
                    user_id=current_user.id,
                    issuer=tested.issuer,
                    subject=tested.subject,
                    last_seen_username=tested.username.strip(),
                    last_groups_json=json.dumps(tested.groups),
                    last_login_at=datetime.now(timezone.utc),
                )
            )
        write_audit_event(
            session,
            event_name=AuditEventName.IDENTITY_RELINKED,
            result=AuditResult.SUCCEEDED,
            details=AuditDetails(
                username=initiating_admin.username,
                selected_role=UserRole.ADMIN.value,
            ),
            acting_user_id=current_user.id,
            affected_user_id=current_user.id,
            provider_configuration_id=active.id,
        )
    if mappings_changed:
        active.identity_mapping_revision += 1

    revoked_user_ids = affected_user_ids
    for user_id in revoked_user_ids:
        user = session.get(User, user_id)
        if user is not None:
            user.token_version += 1
            session.add(user)
    reauthentication_required = current_user.id in revoked_user_ids
    set_ui_authentication_mode(
        session,
        mode=AuthenticationMode(candidate.sign_in_mode.value),
        updated_by_user_id=current_user.id,
    )
    write_audit_event(
        session,
        event_name=AuditEventName.CONFIG_UPDATED,
        result=AuditResult.SUCCEEDED,
        details=AuditDetails(changed_fields=candidate.changed_fields),
        acting_user_id=current_user.id,
        affected_user_id=current_user.id,
        provider_configuration_id=1,
    )
    flow.status = OidcFlowStatus.CONSUMED
    flow.encrypted_candidate_configuration = None
    flow.encrypted_tested_identity = None
    flow.finalized_at = datetime.now(timezone.utc)
    flow.finalized_configuration_revision = active.configuration_revision
    flow.finalized_identity_mapping_revision = active.identity_mapping_revision
    flow.finalized_reauthentication_required = reauthentication_required
    session.add(flow)
    initial_activation = flow.configuration_revision is None
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        detail = "oidc_configuration_changed" if initial_activation else "oidc_mapping_review_stale"
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from error
    clear_oidc_provider_cache()
    return OidcFinalizeResponse(
        configuration_revision=active.configuration_revision,
        identity_mapping_revision=active.identity_mapping_revision,
        reauthentication_required=reauthentication_required,
    )


@router.post("/auth/password-only", response_model=OidcFinalizeResponse)
async def set_password_only(
    payload: PasswordOnlyActivationRequest,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcFinalizeResponse:
    try:
        configuration = activate_password_only(
            session,
            acting_user_id=current_user.id,
            expected_configuration_revision=payload.expected_configuration_revision,
            expected_active_passwordless_user_count=payload.expected_active_passwordless_user_count,
            acknowledge_passwordless_account_loss=payload.acknowledge_passwordless_account_loss,
        )
    except OidcRecoveryError as error:
        session.rollback()
        status_code = status.HTTP_404_NOT_FOUND if "not found" in str(error) else status.HTTP_409_CONFLICT
        raise HTTPException(status_code=status_code, detail=str(error)) from error
    clear_oidc_provider_cache()
    return OidcFinalizeResponse(
        configuration_revision=configuration.configuration_revision,
        identity_mapping_revision=configuration.identity_mapping_revision,
        reauthentication_required=True,
    )


@router.post("/auth/mode", response_model=AuthenticationModeActivationResponse)
async def activate_non_oidc_mode(
    payload: AuthenticationModeActivationRequest,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> AuthenticationModeActivationResponse:
    if payload.mode in (AuthenticationMode.OIDC_OR_PASSWORD, AuthenticationMode.OIDC_ONLY):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC modes require provider testing")
    if payload.mode == AuthenticationMode.NONE and not payload.acknowledge_no_authentication:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Acknowledge reverse-proxy authentication before activating this mode"
        )
    if payload.mode == AuthenticationMode.PASSWORD_ONLY and session.get(OidcProviderConfiguration, 1) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Use Password-only recovery for an existing OIDC configuration")
    if payload.mode == AuthenticationMode.PASSWORD_ONLY and current_user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Password-only mode requires an administrator with a local password"
        )

    set_ui_authentication_mode(session, mode=payload.mode, updated_by_user_id=current_user.id)
    for user in session.exec(select(User)).all():
        user.token_version += 1
        session.add(user)
    write_audit_event(
        session,
        event_name=AuditEventName.CONFIG_UPDATED,
        result=AuditResult.SUCCEEDED,
        details=AuditDetails(changed_fields=("auth_mode",)),
        acting_user_id=current_user.id,
        affected_user_id=current_user.id,
    )
    session.commit()
    return AuthenticationModeActivationResponse(auth_mode=payload.mode, reauthentication_required=True)


@router.put("/auth/oidc/mappings/pending", response_model=OidcMappingMutationResponse)
async def put_pending_oidc_mappings(
    payload: OidcPendingMappingBatchRequest,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcMappingMutationResponse:
    configuration = _active_oidc_configuration(session)
    try:
        identity_mapping_revision = claim_mapping_revision(session, configuration, payload.expected_identity_mapping_revision)
        mappings = validate_pending_mapping_batch(session, configuration=configuration, mappings=payload.mappings)
        replace_pending_mappings(
            session,
            configuration=configuration,
            mappings=mappings,
            acting_user_id=current_user.id,
        )
    except OidcMappingError as error:
        session.rollback()
        raise _mapping_http_exception(error) from error
    return _commit_mapping_mutation(session, identity_mapping_revision, configuration)


@router.delete("/auth/oidc/mappings/{user_id}/pending", response_model=OidcMappingMutationResponse)
async def delete_pending_oidc_mapping(
    user_id: uuid.UUID,
    expected_identity_mapping_revision: int,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcMappingMutationResponse:
    configuration = _active_oidc_configuration(session)
    try:
        identity_mapping_revision = claim_mapping_revision(session, configuration, expected_identity_mapping_revision)
        cancel_pending_mapping(
            session,
            configuration=configuration,
            target_user_id=user_id,
            acting_user_id=current_user.id,
        )
    except OidcMappingError as error:
        session.rollback()
        raise _mapping_http_exception(error) from error
    return _commit_mapping_mutation(session, identity_mapping_revision, configuration)


@router.post("/auth/oidc/mappings/{identity_id}/move", response_model=OidcMappingMutationResponse)
async def move_oidc_identity(
    identity_id: uuid.UUID,
    payload: OidcIdentityMoveRequest,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcMappingMutationResponse:
    configuration = _active_oidc_configuration(session)
    try:
        identity_mapping_revision = claim_mapping_revision(session, configuration, payload.expected_identity_mapping_revision)
        move_identity(
            session,
            configuration=configuration,
            identity_id=identity_id,
            target_user_id=payload.target_user_id,
            acting_user_id=current_user.id,
        )
    except OidcMappingError as error:
        session.rollback()
        raise _mapping_http_exception(error) from error
    return _commit_mapping_mutation(session, identity_mapping_revision, configuration)


@router.post("/auth/oidc/mappings/{user_id}/change", response_model=OidcMappingMutationResponse)
async def change_oidc_identity(
    user_id: uuid.UUID,
    payload: OidcMappingChangeRequest,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcMappingMutationResponse:
    configuration = _active_oidc_configuration(session)
    try:
        identity_mapping_revision = claim_mapping_revision(session, configuration, payload.expected_identity_mapping_revision)
        change_identity(
            session,
            configuration=configuration,
            target_user_id=user_id,
            expected_username=payload.expected_username,
            acting_user_id=current_user.id,
        )
    except OidcMappingError as error:
        session.rollback()
        raise _mapping_http_exception(error) from error
    return _commit_mapping_mutation(session, identity_mapping_revision, configuration)


@router.delete("/auth/oidc/mappings/{user_id}", response_model=OidcMappingMutationResponse)
async def delete_oidc_identity(
    user_id: uuid.UUID,
    expected_identity_mapping_revision: int,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcMappingMutationResponse:
    configuration = _active_oidc_configuration(session)
    try:
        identity_mapping_revision = claim_mapping_revision(session, configuration, expected_identity_mapping_revision)
        detach_identity(
            session,
            configuration=configuration,
            target_user_id=user_id,
            acting_user_id=current_user.id,
        )
    except OidcMappingError as error:
        session.rollback()
        raise _mapping_http_exception(error) from error
    return _commit_mapping_mutation(session, identity_mapping_revision, configuration)
