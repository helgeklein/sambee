import json
import uuid
from datetime import datetime, timezone
from typing import TextIO

from sqlalchemy import update
from sqlmodel import Session, select

from app.core.auth_methods import AuthenticationMode
from app.models.audit import AuditEvent
from app.models.oidc import OidcProviderConfiguration, SignInMode
from app.models.user import User, UserRole
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event
from app.services.authentication_config import set_ui_authentication_mode


class OidcRecoveryError(ValueError):
    pass


def _is_active_unexpired(user: User, now: datetime) -> bool:
    expires_at = user.expires_at
    normalized_expiry = expires_at.replace(tzinfo=timezone.utc) if expires_at is not None and expires_at.tzinfo is None else expires_at
    return user.is_active and (normalized_expiry is None or normalized_expiry > now)


def count_active_passwordless_users(session: Session, *, now: datetime | None = None) -> int:
    current_time = now or datetime.now(timezone.utc)
    return sum(
        1
        for user in session.exec(select(User).where(User.password_hash == None)).all()  # noqa: E711
        if _is_active_unexpired(user, current_time)
    )


def count_active_local_password_administrators(session: Session, *, now: datetime | None = None) -> int:
    current_time = now or datetime.now(timezone.utc)
    return sum(
        1
        for user in session.exec(
            select(User).where(User.role == UserRole.ADMIN, User.password_hash != None)  # noqa: E711
        ).all()
        if _is_active_unexpired(user, current_time)
    )


def activate_password_only(
    session: Session,
    *,
    acting_user_id: uuid.UUID | None = None,
    expected_configuration_revision: int | None = None,
    expected_active_passwordless_user_count: int | None = None,
    expected_local_password_administrator_count: int | None = None,
    acknowledge_passwordless_account_loss: bool = False,
    force_no_local_administrator: bool = False,
) -> OidcProviderConfiguration:
    configuration = session.get(OidcProviderConfiguration, 1)
    if configuration is None:
        raise OidcRecoveryError("Database authentication configuration was not found")
    now = datetime.now(timezone.utc)
    if expected_configuration_revision is not None:
        table = OidcProviderConfiguration.__table__  # type: ignore[attr-defined]
        result = session.connection().execute(
            update(table)
            .where(table.c.id == configuration.id, table.c.configuration_revision == expected_configuration_revision)
            .values(configuration_revision=expected_configuration_revision + 1)
        )
        if result.rowcount != 1:
            raise OidcRecoveryError("oidc_configuration_changed")
        session.expire(configuration, ["configuration_revision"])
        actual_passwordless_count = count_active_passwordless_users(session, now=now)
        if expected_active_passwordless_user_count != actual_passwordless_count:
            raise OidcRecoveryError("passwordless_account_count_changed")
        if actual_passwordless_count > 0 and not acknowledge_passwordless_account_loss:
            raise OidcRecoveryError("passwordless_account_loss_not_acknowledged")
    local_administrator_count = count_active_local_password_administrators(session, now=now)
    if expected_local_password_administrator_count is not None and expected_local_password_administrator_count != local_administrator_count:
        raise OidcRecoveryError("local_password_administrator_count_changed")
    if local_administrator_count == 0 and not force_no_local_administrator:
        raise OidcRecoveryError("password_only_no_local_administrator")
    configuration.sign_in_mode = SignInMode.PASSWORD_ONLY
    set_ui_authentication_mode(
        session,
        mode=AuthenticationMode.PASSWORD_ONLY,
        updated_by_user_id=acting_user_id,
    )
    if expected_configuration_revision is None:
        configuration.configuration_revision += 1
    configuration.updated_by_user_id = acting_user_id
    for user in session.exec(select(User)).all():
        user.token_version += 1
        session.add(user)
    write_audit_event(
        session,
        event_name=AuditEventName.CONFIG_UPDATED,
        result=AuditResult.SUCCEEDED,
        details=AuditDetails(changed_fields=("sign_in_mode",)),
        acting_user_id=acting_user_id,
        provider_configuration_id=configuration.id,
    )
    session.add(configuration)
    session.commit()
    return configuration


def export_audit_events(session: Session, output: TextIO) -> int:
    events = list(session.exec(select(AuditEvent)).all())
    events.sort(key=lambda event: (event.created_at, str(event.id)))
    for event in events:
        output.write(json.dumps(event.model_dump(mode="json"), separators=(",", ":"), sort_keys=True))
        output.write("\n")
    return len(events)
