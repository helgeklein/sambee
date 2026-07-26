import json
import uuid
from datetime import datetime, timezone
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.config import settings
from app.core.security import get_current_admin_user
from app.db.database import get_session
from app.models.oidc import (
    OidcFlow,
    OidcFlowIntent,
    OidcFlowPurpose,
    OidcFlowStatus,
    OidcIdentity,
    OidcPendingIdentityMapping,
    OidcProviderConfiguration,
)
from app.models.oidc_api import (
    OidcAdminConfigurationRead,
    OidcConfigurationCandidate,
    OidcFinalizeRequest,
    OidcFinalizeResponse,
    OidcIdentityMoveRequest,
    OidcMappingChangeRequest,
    OidcMappingMutationResponse,
    OidcPendingMappingBatchRequest,
    OidcTestedIdentityRead,
    OidcTestStartResponse,
)
from app.models.user import User, UserRole
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event
from app.services.oidc_client import (
    NormalizedOidcClaims,
    build_authorization_request,
    clear_oidc_provider_cache,
    load_provider_metadata,
)
from app.services.oidc_configuration import (
    OidcConfigurationError,
    OidcSecretCipher,
    build_authentication_health,
    decrypt_candidate_snapshot,
    derive_oidc_redirect_uri,
    encrypt_candidate_snapshot,
    normalize_candidate,
    redacted_candidate,
    redacted_configuration,
)
from app.services.oidc_flow import start_test_flow
from app.services.oidc_http import ValidatedOidcHttpClient
from app.services.oidc_identity import OidcIdentityError, resolve_oidc_role
from app.services.oidc_mapping import (
    OidcMappingError,
    cancel_pending_mapping,
    change_identity,
    create_pending_mappings,
    derive_mapping_plan,
    detach_identity,
    move_identity,
    replace_pending_mappings,
    require_mapping_revision,
    validate_reviewed_mapping_plan,
)
from app.services.oidc_recovery import OidcRecoveryError, activate_password_only

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
        "role_mappings",
    }
)


def _active_oidc_configuration(session: Session) -> OidcProviderConfiguration:
    configuration = session.get(OidcProviderConfiguration, 1)
    if configuration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OIDC configuration was not found")
    return configuration


def _commit_mapping_mutation(session: Session, configuration: OidcProviderConfiguration) -> OidcMappingMutationResponse:
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC mapping changed concurrently") from error
    return OidcMappingMutationResponse(identity_mapping_revision=configuration.identity_mapping_revision)


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


@router.get("/auth/oidc", response_model=OidcAdminConfigurationRead)
async def get_oidc_configuration(
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcAdminConfigurationRead:
    configuration = session.get(OidcProviderConfiguration, 1)
    health = build_authentication_health(
        oidc_secret_key=settings.oidc_secret_key,
        public_url=settings.public_url,
        encrypted_client_secret=configuration.encrypted_client_secret if configuration else None,
        has_active_administrator=_has_active_admin(session),
    )
    return OidcAdminConfigurationRead(
        configuration=redacted_configuration(configuration) if configuration is not None else None,
        health=health,
    )


@router.post("/auth/oidc/test", response_model=OidcTestStartResponse)
async def start_oidc_test(
    candidate: OidcConfigurationCandidate,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcTestStartResponse:
    active = session.get(OidcProviderConfiguration, 1)
    try:
        cipher = OidcSecretCipher(settings.oidc_secret_key)
        normalized = normalize_candidate(candidate, active, cipher)
        if normalized.client_secret is None:
            raise OidcConfigurationError("OIDC test requires a client secret")
        redirect_uri = derive_oidc_redirect_uri(settings.public_url)
        async with ValidatedOidcHttpClient() as http_client:
            metadata, _ = await load_provider_metadata(http_client, normalized.issuer_url)
        started = start_test_flow(
            session,
            initiating_admin_id=current_user.id,
            encrypted_candidate_configuration=encrypt_candidate_snapshot(normalized, cipher),
            active_configuration_revision=active.configuration_revision if active is not None else None,
            replace_identity_namespace=normalized.identity_namespace_changed,
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
    except (OidcConfigurationError, ValueError) as error:
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


@router.get("/auth/oidc/test/{flow_id}", response_model=OidcTestedIdentityRead)
async def get_oidc_test_result(
    flow_id: uuid.UUID,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcTestedIdentityRead:
    flow = _get_owned_validated_test_flow(session, flow_id, current_user)
    cipher = OidcSecretCipher(settings.oidc_secret_key)
    claims = _tested_claims(cast(str, flow.encrypted_tested_identity), cipher)
    candidate = decrypt_candidate_snapshot(cast(str, flow.encrypted_candidate_configuration), cipher)
    active = session.get(OidcProviderConfiguration, 1)
    needs_mapping_review = active is None or flow.intent == OidcFlowIntent.REPLACE_IDENTITY_NAMESPACE
    replacement_mappings = (
        derive_mapping_plan(
            session,
            configuration=active,
            acting_user_id=current_user.id,
            sign_in_mode=candidate.sign_in_mode,
        )
        if needs_mapping_review
        else []
    )
    return OidcTestedIdentityRead(
        flow_id=flow.id,
        candidate=redacted_candidate(candidate),
        replacement_mappings=replacement_mappings,
        expected_identity_mapping_revision=active.identity_mapping_revision if active is not None else None,
        username=claims.username,
        name=claims.name,
        email=claims.email,
        groups=list(claims.groups),
        expires_at=flow.expires_at,
    )


@router.post("/auth/oidc/finalize", response_model=OidcFinalizeResponse)
async def finalize_oidc_configuration(
    payload: OidcFinalizeRequest,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcFinalizeResponse:
    existing_flow = session.get(OidcFlow, payload.flow_id)
    if (
        existing_flow is not None
        and existing_flow.purpose == OidcFlowPurpose.TEST
        and existing_flow.status == OidcFlowStatus.CONSUMED
        and existing_flow.initiating_admin_id == current_user.id
        and existing_flow.finalized_configuration_revision is not None
        and existing_flow.finalized_identity_mapping_revision is not None
    ):
        return OidcFinalizeResponse(
            configuration_revision=existing_flow.finalized_configuration_revision,
            identity_mapping_revision=existing_flow.finalized_identity_mapping_revision,
            reauthentication_required=bool(existing_flow.finalized_reauthentication_required),
        )
    flow = _get_owned_validated_test_flow(session, payload.flow_id, current_user)
    cipher = OidcSecretCipher(settings.oidc_secret_key)
    candidate = decrypt_candidate_snapshot(cast(str, flow.encrypted_candidate_configuration), cipher)
    tested = _tested_claims(cast(str, flow.encrypted_tested_identity), cipher)
    active = session.get(OidcProviderConfiguration, 1)
    active_revision = active.configuration_revision if active is not None else None
    if active_revision != flow.configuration_revision:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC configuration changed during testing")
    replacing_namespace = flow.intent == OidcFlowIntent.REPLACE_IDENTITY_NAMESPACE and active is not None
    username_claim_changed = active is not None and candidate.username_claim != active.username_claim
    if (
        active is not None
        and (replacing_namespace or username_claim_changed)
        and active.identity_mapping_revision != candidate.identity_mapping_revision
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC identity mappings changed during testing")
    if candidate.client_secret is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC client secret is unavailable")

    needs_mapping_review = active is None or replacing_namespace
    expected_mapping_revision = active.identity_mapping_revision if active is not None else None
    if payload.expected_identity_mapping_revision != expected_mapping_revision:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC identity mappings changed during review")
    reviewed_replacement_mappings: dict[uuid.UUID, str] = {}
    if needs_mapping_review:
        plan = derive_mapping_plan(
            session,
            configuration=active,
            acting_user_id=current_user.id,
            sign_in_mode=candidate.sign_in_mode,
        )
        try:
            reviewed_replacement_mappings = validate_reviewed_mapping_plan(
                plan,
                payload.replacement_mappings,
                payload.omitted_account_acknowledgements,
                tested_username=tested.username.strip(),
                replacing_namespace=replacing_namespace,
            )
        except OidcMappingError as error:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    elif payload.replacement_mappings or payload.omitted_account_acknowledgements:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC mapping review is not expected")

    previous_identity_user_ids = {identity.user_id for identity in session.exec(select(OidcIdentity)).all()}

    proposed = OidcProviderConfiguration(
        display_name=candidate.display_name,
        issuer_url=candidate.issuer_url,
        client_id=candidate.client_id,
        encrypted_client_secret=cipher.encrypt(candidate.client_secret),
        scopes_json=json.dumps(candidate.scopes),
        username_claim=candidate.username_claim,
        username_claim_uniqueness_confirmed=candidate.username_claim_uniqueness_confirmed,
        name_claim=candidate.name_claim,
        email_claim=candidate.email_claim,
        groups_claim=candidate.groups_claim,
        sign_in_mode=candidate.sign_in_mode,
        admission_mode=candidate.admission_mode,
        admission_groups_json=json.dumps(candidate.admission_groups),
        role_mappings_json=json.dumps({"admin": candidate.admin_groups, "editor": candidate.editor_groups}),
        configuration_revision=candidate.configuration_revision,
        identity_mapping_revision=active.identity_mapping_revision if active is not None else 0,
        updated_by_user_id=current_user.id,
    )
    try:
        role = resolve_oidc_role(proposed, tested.groups)
    except OidcIdentityError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tested administrator is not admitted") from error
    if role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tested administrator does not resolve to administrator")

    existing_subject = session.exec(
        select(OidcIdentity).where(OidcIdentity.issuer == tested.issuer, OidcIdentity.subject == tested.subject)
    ).first()
    existing_user_identity = session.exec(
        select(OidcIdentity).where(OidcIdentity.user_id == current_user.id, OidcIdentity.issuer == tested.issuer)
    ).first()
    if not replacing_namespace and existing_subject is not None and existing_subject.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tested OIDC identity is already mapped")
    if not replacing_namespace and existing_user_identity is not None and existing_user_identity.subject != tested.subject:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Administrator already has a different OIDC identity")

    flow_table = OidcFlow.__table__  # type: ignore[attr-defined]
    claim_result = session.connection().execute(
        update(flow_table)
        .where(flow_table.c.id == flow.id, flow_table.c.status == OidcFlowStatus.CALLBACK_VALIDATED)
        .values(status=OidcFlowStatus.FINALIZING)
    )
    if claim_result.rowcount != 1:
        session.rollback()
        completed_flow = session.get(OidcFlow, payload.flow_id)
        if (
            completed_flow is not None
            and completed_flow.status == OidcFlowStatus.CONSUMED
            and completed_flow.initiating_admin_id == current_user.id
            and completed_flow.finalized_configuration_revision is not None
            and completed_flow.finalized_identity_mapping_revision is not None
        ):
            return OidcFinalizeResponse(
                configuration_revision=completed_flow.finalized_configuration_revision,
                identity_mapping_revision=completed_flow.finalized_identity_mapping_revision,
                reauthentication_required=bool(completed_flow.finalized_reauthentication_required),
            )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC finalization is already in progress")
    flow.status = OidcFlowStatus.FINALIZING

    immutable_mapping_affected_user_ids: set[uuid.UUID] = set()
    mappings_changed = False
    canceled_pending_count = 0
    if replacing_namespace and active is not None:
        for identity in session.exec(select(OidcIdentity).where(OidcIdentity.issuer == active.issuer_url)).all():
            immutable_mapping_affected_user_ids.add(identity.user_id)
            mappings_changed = True
            write_audit_event(
                session,
                event_name=AuditEventName.IDENTITY_UNMAPPED,
                result=AuditResult.SUCCEEDED,
                acting_user_id=current_user.id,
                affected_user_id=identity.user_id,
                provider_configuration_id=active.id,
            )
            session.delete(identity)
        for pending in session.exec(
            select(OidcPendingIdentityMapping).where(OidcPendingIdentityMapping.provider_configuration_id == active.id)
        ).all():
            canceled_pending_count += 1
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
        existing_subject = None
        existing_user_identity = None
    elif username_claim_changed and active is not None:
        for pending in session.exec(
            select(OidcPendingIdentityMapping).where(OidcPendingIdentityMapping.provider_configuration_id == active.id)
        ).all():
            canceled_pending_count += 1
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
    create_pending_mappings(
        session,
        configuration=active,
        mappings=reviewed_replacement_mappings,
        acting_user_id=current_user.id,
    )
    if reviewed_replacement_mappings:
        mappings_changed = True
    if existing_subject is None and existing_user_identity is None:
        mappings_changed = True
        immutable_mapping_affected_user_ids.add(current_user.id)
        session.add(
            OidcIdentity(
                user_id=current_user.id,
                issuer=tested.issuer,
                subject=tested.subject,
                last_seen_username=tested.username.strip(),
                last_login_at=datetime.now(timezone.utc),
            )
        )
    if mappings_changed:
        active.identity_mapping_revision += 1

    if replacing_namespace:
        write_audit_event(
            session,
            event_name=AuditEventName.IDENTITY_NAMESPACE_REPLACED,
            result=AuditResult.SUCCEEDED,
            details=AuditDetails(mapping_count=len(immutable_mapping_affected_user_ids) + canceled_pending_count),
            acting_user_id=current_user.id,
            provider_configuration_id=active.id,
        )

    changed_fields = set(candidate.changed_fields)
    revoked_user_ids = set(immutable_mapping_affected_user_ids)
    if "sign_in_mode" in changed_fields:
        revoked_user_ids.update(user.id for user in session.exec(select(User)).all())
    elif changed_fields.intersection(OIDC_SESSION_INVALIDATING_FIELDS):
        revoked_user_ids.update(previous_identity_user_ids)
    for user_id in revoked_user_ids:
        user = session.get(User, user_id)
        if user is not None:
            user.token_version += 1
            session.add(user)
    reauthentication_required = current_user.id in revoked_user_ids
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
    session.commit()
    clear_oidc_provider_cache()
    return OidcFinalizeResponse(
        configuration_revision=active.configuration_revision,
        identity_mapping_revision=active.identity_mapping_revision,
        reauthentication_required=reauthentication_required,
    )


@router.post("/auth/password-only", response_model=OidcFinalizeResponse)
async def set_password_only(
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcFinalizeResponse:
    try:
        configuration = activate_password_only(session, acting_user_id=current_user.id)
    except OidcRecoveryError as error:
        status_code = status.HTTP_404_NOT_FOUND if "not found" in str(error) else status.HTTP_409_CONFLICT
        raise HTTPException(status_code=status_code, detail=str(error)) from error
    clear_oidc_provider_cache()
    return OidcFinalizeResponse(
        configuration_revision=configuration.configuration_revision,
        identity_mapping_revision=configuration.identity_mapping_revision,
        reauthentication_required=True,
    )


@router.put("/auth/oidc/mappings/pending", response_model=OidcMappingMutationResponse)
async def put_pending_oidc_mappings(
    payload: OidcPendingMappingBatchRequest,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcMappingMutationResponse:
    configuration = _active_oidc_configuration(session)
    if not configuration.username_claim_uniqueness_confirmed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC username claim uniqueness is not confirmed")
    try:
        require_mapping_revision(configuration, payload.expected_identity_mapping_revision)
        target_ids = [row.target_user_id for row in payload.mappings]
        if len(set(target_ids)) != len(target_ids):
            raise OidcMappingError("OIDC mapping targets must be unique")
        replace_pending_mappings(
            session,
            configuration=configuration,
            mappings={row.target_user_id: row.expected_username for row in payload.mappings},
            acting_user_id=current_user.id,
        )
    except OidcMappingError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    return _commit_mapping_mutation(session, configuration)


@router.delete("/auth/oidc/mappings/{user_id}/pending", response_model=OidcMappingMutationResponse)
async def delete_pending_oidc_mapping(
    user_id: uuid.UUID,
    expected_identity_mapping_revision: int,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcMappingMutationResponse:
    configuration = _active_oidc_configuration(session)
    try:
        require_mapping_revision(configuration, expected_identity_mapping_revision)
        cancel_pending_mapping(
            session,
            configuration=configuration,
            target_user_id=user_id,
            acting_user_id=current_user.id,
        )
    except OidcMappingError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    return _commit_mapping_mutation(session, configuration)


@router.post("/auth/oidc/mappings/{identity_id}/move", response_model=OidcMappingMutationResponse)
async def move_oidc_identity(
    identity_id: uuid.UUID,
    payload: OidcIdentityMoveRequest,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcMappingMutationResponse:
    configuration = _active_oidc_configuration(session)
    try:
        require_mapping_revision(configuration, payload.expected_identity_mapping_revision)
        move_identity(
            session,
            configuration=configuration,
            identity_id=identity_id,
            target_user_id=payload.target_user_id,
            acting_user_id=current_user.id,
        )
    except OidcMappingError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    return _commit_mapping_mutation(session, configuration)


@router.post("/auth/oidc/mappings/{user_id}/change", response_model=OidcMappingMutationResponse)
async def change_oidc_identity(
    user_id: uuid.UUID,
    payload: OidcMappingChangeRequest,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcMappingMutationResponse:
    configuration = _active_oidc_configuration(session)
    try:
        require_mapping_revision(configuration, payload.expected_identity_mapping_revision)
        change_identity(
            session,
            configuration=configuration,
            target_user_id=user_id,
            expected_username=payload.expected_username,
            acting_user_id=current_user.id,
        )
    except OidcMappingError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    return _commit_mapping_mutation(session, configuration)


@router.delete("/auth/oidc/mappings/{user_id}", response_model=OidcMappingMutationResponse)
async def delete_oidc_identity(
    user_id: uuid.UUID,
    expected_identity_mapping_revision: int,
    current_user: User = Depends(get_current_admin_user),
    session: Session = Depends(get_session),
) -> OidcMappingMutationResponse:
    configuration = _active_oidc_configuration(session)
    try:
        require_mapping_revision(configuration, expected_identity_mapping_revision)
        detach_identity(
            session,
            configuration=configuration,
            target_user_id=user_id,
            acting_user_id=current_user.id,
        )
    except OidcMappingError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    return _commit_mapping_mutation(session, configuration)
