import json
import uuid
from pathlib import Path
from typing import TextIO

from sqlmodel import Session, select

from app.models.audit import AuditEvent
from app.models.oidc import OidcFlow, OidcProviderConfiguration, SignInMode
from app.models.user import User, UserRole
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event
from app.services.oidc_configuration import OidcSecretCipher


class OidcRecoveryError(ValueError):
    pass


def activate_password_only(session: Session, *, acting_user_id: uuid.UUID | None = None) -> OidcProviderConfiguration:
    configuration = session.get(OidcProviderConfiguration, 1)
    if configuration is None:
        raise OidcRecoveryError("Database authentication configuration was not found")
    local_admin = session.exec(
        select(User.id).where(User.role == UserRole.ADMIN, User.is_active == True, User.password_hash != None)  # noqa: E711,E712
    ).first()
    if local_admin is None:
        raise OidcRecoveryError("Password-only mode requires an active local-password administrator")
    configuration.sign_in_mode = SignInMode.PASSWORD_ONLY
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
