import json

import pytest
from sqlmodel import Session, select

from app.models.audit import AuditEvent
from app.models.oidc import OidcAdmissionMode, OidcIdentity, OidcPendingIdentityMapping, OidcProviderConfiguration
from app.models.user import User, UserRole
from app.services.oidc_client import NormalizedOidcClaims
from app.services.oidc_identity import (
    OidcIdentityError,
    OidcIdentityErrorCode,
    resolve_oidc_role,
    resolve_or_provision_oidc_user,
)


def _configuration(
    session: Session,
    *,
    admission_groups: list[str] | None = None,
    admin_groups: list[str] | None = None,
    editor_groups: list[str] | None = None,
) -> OidcProviderConfiguration:
    configuration = OidcProviderConfiguration(
        display_name="Example IDP",
        issuer_url="https://idp.example.test",
        client_id="sambee",
        admission_mode=OidcAdmissionMode.SELECTED_GROUPS,
        admission_groups_json=json.dumps(admission_groups or ["Sambee Users"]),
        role_mappings_json=json.dumps({"admin": admin_groups or [], "editor": editor_groups or []}),
    )
    session.add(configuration)
    session.commit()
    session.refresh(configuration)
    return configuration


def _claims(*, subject: str = "subject-1", username: str = "alice", groups: tuple[str, ...] = ("sambee users",)) -> NormalizedOidcClaims:
    return NormalizedOidcClaims(
        issuer="https://idp.example.test",
        subject=subject,
        username=username,
        groups=groups,
        name="Alice Example",
        email="alice@example.test",
    )


def test_role_resolution_normalizes_groups_and_uses_highest_privilege(session: Session) -> None:
    configuration = _configuration(
        session,
        admission_groups=["Ｓａｍｂｅｅ Ｕｓｅｒｓ"],
        admin_groups=["Platform Admins"],
        editor_groups=["Editors"],
    )

    role = resolve_oidc_role(configuration, ("sambee users", "editors", "PLATFORM ADMINS"))

    assert role == UserRole.ADMIN


def test_unmapped_identity_provisions_passwordless_user_and_audits(session: Session) -> None:
    configuration = _configuration(session, editor_groups=["Sambee Users"])

    user = resolve_or_provision_oidc_user(session, configuration=configuration, claims=_claims(), correlation_id="request-id")

    assert user.password_hash is None
    assert user.role == UserRole.EDITOR
    identity = session.exec(select(OidcIdentity).where(OidcIdentity.user_id == user.id)).one()
    assert identity.subject == "subject-1"
    assert configuration.identity_mapping_revision == 1
    event_names = {event.event_name for event in session.exec(select(AuditEvent)).all()}
    assert "oidc.user.provisioned" in event_names
    assert "oidc.login.succeeded" in event_names


def test_unmapped_identity_never_auto_links_username_collision(session: Session) -> None:
    configuration = _configuration(session)
    session.add(User(username="alice", password_hash="local-password-hash"))
    session.commit()

    with pytest.raises(OidcIdentityError) as error:
        resolve_or_provision_oidc_user(session, configuration=configuration, claims=_claims())

    assert error.value.code == OidcIdentityErrorCode.USERNAME_COLLISION
    assert session.exec(select(OidcIdentity)).first() is None


def test_pending_mapping_consumes_exact_username_and_preserves_local_password(session: Session) -> None:
    configuration = _configuration(session, admin_groups=["Sambee Users"])
    target = User(username="local-admin", password_hash="existing-hash", role=UserRole.ADMIN)
    actor = User(username="mapping-admin", password_hash="actor-hash", role=UserRole.ADMIN)
    session.add(target)
    session.add(actor)
    session.commit()
    pending = OidcPendingIdentityMapping(
        provider_configuration_id=configuration.id,
        expected_username="alice",
        target_user_id=target.id,
        created_by_user_id=actor.id,
    )
    session.add(pending)
    session.commit()

    resolved = resolve_or_provision_oidc_user(session, configuration=configuration, claims=_claims())

    assert resolved.id == target.id
    assert resolved.password_hash == "existing-hash"
    assert resolved.token_version == 1
    assert session.get(OidcPendingIdentityMapping, pending.id) is None
    assert session.exec(select(OidcIdentity).where(OidcIdentity.user_id == target.id)).one().subject == "subject-1"


def test_last_admin_role_sync_is_blocked_and_revokes_sessions(session: Session) -> None:
    configuration = _configuration(session, editor_groups=["Sambee Users"])
    administrator = User(username="alice", password_hash=None, role=UserRole.ADMIN)
    session.add(administrator)
    session.commit()
    identity = OidcIdentity(
        user_id=administrator.id,
        issuer=configuration.issuer_url,
        subject="subject-1",
    )
    session.add(identity)
    session.commit()

    with pytest.raises(OidcIdentityError) as error:
        resolve_or_provision_oidc_user(session, configuration=configuration, claims=_claims())

    session.refresh(administrator)
    assert error.value.code == OidcIdentityErrorCode.LAST_ADMIN_ROLE_CONFLICT_NO_PASSWORD
    assert administrator.role == UserRole.ADMIN
    assert administrator.token_version == 1
    blocked_event = session.exec(select(AuditEvent).where(AuditEvent.event_name == "oidc.user.role_sync_blocked")).one()
    assert blocked_event.result == "blocked"
