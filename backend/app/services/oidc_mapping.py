import uuid
from datetime import datetime, timezone

from sqlmodel import Session, select

from app.models.oidc import OidcIdentity, OidcPendingIdentityMapping, OidcProviderConfiguration, SignInMode
from app.models.oidc_api import OidcReplacementMappingInput, OidcReplacementMappingRead
from app.models.user import User, UserRole, normalize_utc_datetime
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event


class OidcMappingError(ValueError):
    pass


def _target_state(user: User, now: datetime) -> str:
    if not user.is_active:
        return "inactive"
    expires_at = normalize_utc_datetime(user.expires_at)
    if expires_at is not None and expires_at <= now:
        return "expired"
    return "active"


def derive_mapping_plan(
    session: Session,
    *,
    configuration: OidcProviderConfiguration | None,
    acting_user_id: uuid.UUID,
    sign_in_mode: SignInMode,
    now: datetime | None = None,
) -> list[OidcReplacementMappingRead]:
    current_time = now or datetime.now(timezone.utc)
    identities = {
        identity.user_id: identity
        for identity in session.exec(
            select(OidcIdentity).where(OidcIdentity.issuer == configuration.issuer_url)
            if configuration is not None
            else select(OidcIdentity).where(False)
        ).all()
    }
    pending = {
        mapping.target_user_id: mapping
        for mapping in session.exec(
            select(OidcPendingIdentityMapping).where(OidcPendingIdentityMapping.provider_configuration_id == configuration.id)
            if configuration is not None
            else select(OidcPendingIdentityMapping).where(False)
        ).all()
    }
    rows: list[OidcReplacementMappingRead] = []
    for user in session.exec(select(User).where(User.id != acting_user_id).order_by(User.username)).all():
        state = _target_state(user, current_time)
        identity = identities.get(user.id)
        pending_mapping = pending.get(user.id)
        if pending_mapping is not None:
            mapping_state = "pending"
            suggested_username = pending_mapping.expected_username
            prefill_source = "pending"
            selected_by_default = state == "active"
        elif identity is not None:
            mapping_state = "established"
            suggested_username = identity.last_seen_username or user.username
            prefill_source = "last_seen" if identity.last_seen_username else "local"
            selected_by_default = False
        else:
            mapping_state = "unmapped"
            suggested_username = user.username
            prefill_source = "local"
            selected_by_default = False
        selectable = state == "active"
        rows.append(
            OidcReplacementMappingRead(
                target_user_id=user.id,
                local_username=user.username,
                local_role=user.role,
                has_local_password=user.password_hash is not None,
                target_state=state,
                mapping_state=mapping_state,
                suggested_username=suggested_username,
                prefill_source=prefill_source,
                selected_by_default=selected_by_default,
                selectable=selectable,
                omission_acknowledgement_required=selectable and sign_in_mode == SignInMode.OIDC_ONLY,
            )
        )
    return rows


def validate_reviewed_mapping_plan(
    plan: list[OidcReplacementMappingRead],
    submitted: list[OidcReplacementMappingInput],
    omitted_acknowledgements: list[uuid.UUID],
    *,
    tested_username: str,
    replacing_namespace: bool,
) -> dict[uuid.UUID, str]:
    rows_by_id = {row.target_user_id: row for row in plan}
    submitted_ids = [row.target_user_id for row in submitted]
    if len(set(submitted_ids)) != len(submitted_ids):
        raise OidcMappingError("OIDC mapping targets must be unique")
    selected: dict[uuid.UUID, str] = {}
    usernames = {tested_username.strip()}
    for submitted_row in submitted:
        plan_row = rows_by_id.get(submitted_row.target_user_id)
        if plan_row is None or not plan_row.selectable:
            raise OidcMappingError("OIDC mapping target is unavailable")
        if plan_row.mapping_state == "established" and not replacing_namespace:
            raise OidcMappingError("OIDC mapping target is already linked")
        expected_username = submitted_row.expected_username.strip()
        if not expected_username or expected_username in usernames:
            raise OidcMappingError("OIDC mapping usernames must be non-empty and unique")
        usernames.add(expected_username)
        selected[submitted_row.target_user_id] = expected_username

    acknowledgement_ids = set(omitted_acknowledgements)
    if len(acknowledgement_ids) != len(omitted_acknowledgements):
        raise OidcMappingError("OIDC omission acknowledgements must be unique")
    required_omissions = {
        row.target_user_id for row in plan if row.omission_acknowledgement_required and row.target_user_id not in selected
    }
    if acknowledgement_ids != required_omissions:
        raise OidcMappingError("OIDC omitted accounts require explicit acknowledgement")
    return selected


def require_mapping_revision(configuration: OidcProviderConfiguration, expected_revision: int) -> None:
    if configuration.identity_mapping_revision != expected_revision:
        raise OidcMappingError("OIDC identity mappings changed")


def create_pending_mappings(
    session: Session,
    *,
    configuration: OidcProviderConfiguration,
    mappings: dict[uuid.UUID, str],
    acting_user_id: uuid.UUID,
) -> None:
    for user_id, expected_username in mappings.items():
        session.add(
            OidcPendingIdentityMapping(
                provider_configuration_id=configuration.id,
                expected_username=expected_username,
                target_user_id=user_id,
                created_by_user_id=acting_user_id,
            )
        )
        write_audit_event(
            session,
            event_name=AuditEventName.PENDING_MAPPING_CREATED,
            result=AuditResult.SUCCEEDED,
            details=AuditDetails(username=expected_username),
            acting_user_id=acting_user_id,
            affected_user_id=user_id,
            provider_configuration_id=configuration.id,
        )
    if len(mappings) > 1:
        write_audit_event(
            session,
            event_name=AuditEventName.PENDING_MAPPING_BATCH_CREATED,
            result=AuditResult.SUCCEEDED,
            details=AuditDetails(mapping_count=len(mappings)),
            acting_user_id=acting_user_id,
            provider_configuration_id=configuration.id,
        )


def replace_pending_mappings(
    session: Session,
    *,
    configuration: OidcProviderConfiguration,
    mappings: dict[uuid.UUID, str],
    acting_user_id: uuid.UUID,
) -> None:
    selected_ids = set(mappings)
    existing_pending = session.exec(
        select(OidcPendingIdentityMapping).where(OidcPendingIdentityMapping.provider_configuration_id == configuration.id)
    ).all()
    existing_by_target = {mapping.target_user_id: mapping for mapping in existing_pending}
    established_targets = {
        identity.user_id for identity in session.exec(select(OidcIdentity).where(OidcIdentity.issuer == configuration.issuer_url)).all()
    }
    if selected_ids.intersection(established_targets):
        raise OidcMappingError("OIDC mapping target is already linked")
    retained_usernames = {mapping.expected_username for mapping in existing_pending if mapping.target_user_id not in selected_ids}
    normalized = {user_id: username.strip() for user_id, username in mappings.items()}
    if any(not username for username in normalized.values()) or len(set(normalized.values())) != len(normalized):
        raise OidcMappingError("OIDC mapping usernames must be non-empty and unique")
    if retained_usernames.intersection(normalized.values()):
        raise OidcMappingError("OIDC mapping username is already pending")
    for user_id in selected_ids:
        user = session.get(User, user_id)
        if user is None or _target_state(user, datetime.now(timezone.utc)) != "active":
            raise OidcMappingError("OIDC mapping target is unavailable")
        old_mapping = existing_by_target.get(user_id)
        if old_mapping is not None:
            write_audit_event(
                session,
                event_name=AuditEventName.PENDING_MAPPING_CANCELED,
                result=AuditResult.SUCCEEDED,
                details=AuditDetails(username=old_mapping.expected_username),
                acting_user_id=acting_user_id,
                affected_user_id=user_id,
                provider_configuration_id=configuration.id,
            )
            session.delete(old_mapping)
    create_pending_mappings(
        session,
        configuration=configuration,
        mappings=normalized,
        acting_user_id=acting_user_id,
    )
    if mappings:
        configuration.identity_mapping_revision += 1
        session.add(configuration)


def cancel_pending_mapping(
    session: Session,
    *,
    configuration: OidcProviderConfiguration,
    target_user_id: uuid.UUID,
    acting_user_id: uuid.UUID,
) -> None:
    mapping = session.exec(
        select(OidcPendingIdentityMapping).where(
            OidcPendingIdentityMapping.provider_configuration_id == configuration.id,
            OidcPendingIdentityMapping.target_user_id == target_user_id,
        )
    ).first()
    if mapping is None:
        raise OidcMappingError("OIDC pending mapping was not found")
    session.delete(mapping)
    configuration.identity_mapping_revision += 1
    session.add(configuration)
    write_audit_event(
        session,
        event_name=AuditEventName.PENDING_MAPPING_CANCELED,
        result=AuditResult.SUCCEEDED,
        details=AuditDetails(username=mapping.expected_username),
        acting_user_id=acting_user_id,
        affected_user_id=target_user_id,
        provider_configuration_id=configuration.id,
    )


def _active_mapped_admin_ids(session: Session, configuration: OidcProviderConfiguration) -> set[uuid.UUID]:
    mapped_ids = {
        identity.user_id for identity in session.exec(select(OidcIdentity).where(OidcIdentity.issuer == configuration.issuer_url)).all()
    }
    now = datetime.now(timezone.utc)
    return {
        user.id
        for user in session.exec(select(User).where(User.role == UserRole.ADMIN)).all()
        if user.id in mapped_ids and _target_state(user, now) == "active"
    }


def _guard_last_oidc_admin(
    session: Session,
    configuration: OidcProviderConfiguration,
    source_user_id: uuid.UUID,
    replacement_user_id: uuid.UUID | None = None,
) -> None:
    if configuration.sign_in_mode != SignInMode.OIDC_ONLY:
        return
    admin_ids = _active_mapped_admin_ids(session, configuration)
    if source_user_id not in admin_ids:
        return
    if replacement_user_id is not None:
        replacement = session.get(User, replacement_user_id)
        if (
            replacement is not None
            and replacement.role == UserRole.ADMIN
            and _target_state(replacement, datetime.now(timezone.utc)) == "active"
        ):
            return
    if admin_ids == {source_user_id}:
        raise OidcMappingError("The last active OIDC administrator mapping cannot be removed")


def move_identity(
    session: Session,
    *,
    configuration: OidcProviderConfiguration,
    identity_id: uuid.UUID,
    target_user_id: uuid.UUID,
    acting_user_id: uuid.UUID,
) -> None:
    identity = session.get(OidcIdentity, identity_id)
    target = session.get(User, target_user_id)
    if identity is None or identity.issuer != configuration.issuer_url:
        raise OidcMappingError("OIDC identity was not found")
    if target is None or _target_state(target, datetime.now(timezone.utc)) != "active":
        raise OidcMappingError("OIDC mapping target is unavailable")
    if (
        session.exec(select(OidcIdentity).where(OidcIdentity.issuer == configuration.issuer_url, OidcIdentity.user_id == target.id)).first()
        is not None
    ):
        raise OidcMappingError("OIDC mapping target is already linked")
    if (
        session.exec(
            select(OidcPendingIdentityMapping).where(
                OidcPendingIdentityMapping.provider_configuration_id == configuration.id,
                OidcPendingIdentityMapping.target_user_id == target.id,
            )
        ).first()
        is not None
    ):
        raise OidcMappingError("OIDC mapping target already has a pending mapping")
    source_user_id = identity.user_id
    _guard_last_oidc_admin(session, configuration, source_user_id, target.id)
    source = session.get(User, source_user_id)
    if source is None:
        raise OidcMappingError("OIDC mapping source is unavailable")
    identity.user_id = target.id
    source.token_version += 1
    target.token_version += 1
    configuration.identity_mapping_revision += 1
    session.add(identity)
    session.add(source)
    session.add(target)
    session.add(configuration)
    write_audit_event(
        session,
        event_name=AuditEventName.IDENTITY_REASSIGNED,
        result=AuditResult.SUCCEEDED,
        details=AuditDetails(mapping_count=2),
        acting_user_id=acting_user_id,
        affected_user_id=target.id,
        provider_configuration_id=configuration.id,
    )


def change_identity(
    session: Session,
    *,
    configuration: OidcProviderConfiguration,
    target_user_id: uuid.UUID,
    expected_username: str,
    acting_user_id: uuid.UUID,
) -> None:
    identity = session.exec(
        select(OidcIdentity).where(OidcIdentity.issuer == configuration.issuer_url, OidcIdentity.user_id == target_user_id)
    ).first()
    if identity is None:
        raise OidcMappingError("OIDC identity was not found")
    _guard_last_oidc_admin(session, configuration, target_user_id)
    normalized_username = expected_username.strip()
    if not normalized_username:
        raise OidcMappingError("OIDC mapping username is required")
    if (
        session.exec(
            select(OidcPendingIdentityMapping).where(
                OidcPendingIdentityMapping.provider_configuration_id == configuration.id,
                OidcPendingIdentityMapping.expected_username == normalized_username,
            )
        ).first()
        is not None
    ):
        raise OidcMappingError("OIDC mapping username is already pending")
    user = session.get(User, target_user_id)
    if user is None or _target_state(user, datetime.now(timezone.utc)) != "active":
        raise OidcMappingError("OIDC mapping target is unavailable")
    session.delete(identity)
    session.add(
        OidcPendingIdentityMapping(
            provider_configuration_id=configuration.id,
            expected_username=normalized_username,
            target_user_id=target_user_id,
            created_by_user_id=acting_user_id,
        )
    )
    user.token_version += 1
    configuration.identity_mapping_revision += 1
    session.add(user)
    session.add(configuration)
    write_audit_event(
        session,
        event_name=AuditEventName.IDENTITY_MAPPING_CHANGED,
        result=AuditResult.SUCCEEDED,
        details=AuditDetails(username=normalized_username),
        acting_user_id=acting_user_id,
        affected_user_id=target_user_id,
        provider_configuration_id=configuration.id,
    )


def detach_identity(
    session: Session,
    *,
    configuration: OidcProviderConfiguration,
    target_user_id: uuid.UUID,
    acting_user_id: uuid.UUID,
) -> None:
    identity = session.exec(
        select(OidcIdentity).where(OidcIdentity.issuer == configuration.issuer_url, OidcIdentity.user_id == target_user_id)
    ).first()
    if identity is None:
        raise OidcMappingError("OIDC identity was not found")
    _guard_last_oidc_admin(session, configuration, target_user_id)
    user = session.get(User, target_user_id)
    if user is None:
        raise OidcMappingError("OIDC mapping target is unavailable")
    session.delete(identity)
    user.token_version += 1
    configuration.identity_mapping_revision += 1
    session.add(user)
    session.add(configuration)
    write_audit_event(
        session,
        event_name=AuditEventName.IDENTITY_UNMAPPED,
        result=AuditResult.SUCCEEDED,
        acting_user_id=acting_user_id,
        affected_user_id=target_user_id,
        provider_configuration_id=configuration.id,
    )
