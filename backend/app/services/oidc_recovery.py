import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TextIO

from sqlalchemy import update
from sqlmodel import Session, select

from app.models.audit import AuditEvent
from app.models.oidc import OidcFlow, OidcProviderConfiguration, SignInMode
from app.models.user import User, UserRole
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event
from app.services.oidc_configuration import OidcSecretCipher


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


def activate_password_only(
    session: Session,
    *,
    acting_user_id: uuid.UUID | None = None,
    expected_configuration_revision: int | None = None,
    expected_active_passwordless_user_count: int | None = None,
    acknowledge_passwordless_account_loss: bool = False,
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
    local_admins = session.exec(
        select(User).where(User.role == UserRole.ADMIN, User.is_active == True, User.password_hash != None)  # noqa: E711,E712
    ).all()
    local_admin = next(
        (user for user in local_admins if _is_active_unexpired(user, now)),
        None,
    )
    if local_admin is None:
        raise OidcRecoveryError("password_only_no_local_administrator")
    configuration.sign_in_mode = SignInMode.PASSWORD_ONLY
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


def rotate_oidc_secret_key(session: Session, *, old_key: str, new_key: str) -> None:
    old_cipher = OidcSecretCipher(old_key)
    new_cipher = OidcSecretCipher(new_key)
    configuration = session.get(OidcProviderConfiguration, 1)
    if configuration is not None and configuration.encrypted_client_secret is not None:
        plaintext = old_cipher.decrypt(configuration.encrypted_client_secret)
        configuration.encrypted_client_secret = new_cipher.encrypt(plaintext)
        configuration.configuration_revision += 1
        session.add(configuration)
    for flow in session.exec(select(OidcFlow)).all():
        session.delete(flow)
    session.commit()


def export_audit_events(session: Session, output: TextIO) -> int:
    events = list(session.exec(select(AuditEvent)).all())
    events.sort(key=lambda event: (event.created_at, str(event.id)))
    for event in events:
        output.write(json.dumps(event.model_dump(mode="json"), separators=(",", ":"), sort_keys=True))
        output.write("\n")
    return len(events)


def read_secret_file(path: Path) -> str:
    value = path.read_text(encoding="utf-8").strip()
    if not value:
        raise OidcRecoveryError("OIDC key file is empty")
    return value
