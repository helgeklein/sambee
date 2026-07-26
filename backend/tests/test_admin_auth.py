import json
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

import app.api.admin_auth as admin_auth_module
import app.core.config as config_module
from app.core.security import build_user_access_token
from app.models.audit import AuditEvent
from app.models.oidc import (
    OidcAdmissionMode,
    OidcFlow,
    OidcFlowIntent,
    OidcFlowPurpose,
    OidcFlowStatus,
    OidcIdentity,
    OidcPendingIdentityMapping,
    OidcProviderConfiguration,
    SignInMode,
)
from app.models.user import User
from app.services.oidc_client import NormalizedOidcClaims
from app.services.oidc_configuration import NormalizedOidcCandidate, OidcSecretCipher, encrypt_candidate_snapshot
from app.services.oidc_identity import resolve_or_provision_oidc_user


def test_finalize_oidc_configuration_is_idempotent(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clear_cache = Mock()
    monkeypatch.setattr(admin_auth_module, "clear_oidc_provider_cache", clear_cache)
    cipher = OidcSecretCipher(config_module.settings.oidc_secret_key)
    unrelated_user = User(username="unrelated-user", password_hash="hash")
    session.add(unrelated_user)
    session.commit()
    candidate = NormalizedOidcCandidate(
        display_name="Example Identity",
        issuer_url="https://id.example.test",
        client_id="sambee",
        client_secret="secret",
        scopes=("openid", "profile", "groups"),
        username_claim="preferred_username",
        username_claim_uniqueness_confirmed=True,
        name_claim="name",
        email_claim="email",
        groups_claim="groups",
        sign_in_mode=SignInMode.OIDC_ONLY,
        admission_mode=OidcAdmissionMode.SELECTED_GROUPS,
        admission_groups=("sambee-users",),
        admin_groups=("sambee-admins",),
        editor_groups=(),
        configuration_revision=1,
        identity_mapping_revision=0,
        identity_namespace_changed=False,
        changed_fields=("initial_configuration", "sign_in_mode"),
    )
    claims = NormalizedOidcClaims(
        issuer="https://id.example.test",
        subject="admin-subject",
        username=admin_user.username,
        name="Test Admin",
        email="admin@example.test",
        groups=("sambee-users", "sambee-admins"),
    )
    flow = OidcFlow(
        purpose=OidcFlowPurpose.TEST,
        status=OidcFlowStatus.CALLBACK_VALIDATED,
        initiating_admin_id=admin_user.id,
        encrypted_candidate_configuration=encrypt_candidate_snapshot(candidate, cipher),
        encrypted_tested_identity=cipher.encrypt(json.dumps(asdict(claims))),
        configuration_revision=None,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    session.add(flow)
    session.commit()

    headers = {"Authorization": f"Bearer {admin_token}"}
    tested = client.get(f"/api/admin/auth/oidc/test/{flow.id}", headers=headers)
    first = client.post(
        "/api/admin/auth/oidc/finalize",
        headers=headers,
        json={
            "flow_id": str(flow.id),
            "replacement_mappings": [{"target_user_id": str(unrelated_user.id), "expected_username": "provider-unrelated"}],
            "expected_identity_mapping_revision": None,
        },
    )

    assert tested.status_code == 200
    assert tested.json()["candidate"]["display_name"] == "Example Identity"
    assert tested.json()["candidate"]["sign_in_mode"] == "oidc_only"
    assert tested.json()["candidate"]["client_secret_configured"] is True
    assert tested.json()["expected_identity_mapping_revision"] is None
    assert tested.json()["replacement_mappings"] == [
        {
            "target_user_id": str(unrelated_user.id),
            "local_username": "unrelated-user",
            "local_role": "editor",
            "has_local_password": True,
            "target_state": "active",
            "mapping_state": "unmapped",
            "suggested_username": "unrelated-user",
            "prefill_source": "local",
            "selected_by_default": False,
            "selectable": True,
            "omission_acknowledgement_required": True,
        }
    ]
    serialized_tested = json.dumps(tested.json())
    assert '"client_secret":' not in serialized_tested
    assert '"encrypted_client_secret":' not in serialized_tested
    assert '"secret"' not in serialized_tested
    assert first.status_code == 200
    assert first.json()["reauthentication_required"] is True
    session.refresh(unrelated_user)
    assert unrelated_user.token_version == 1
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    session.refresh(admin_user)
    refreshed_headers = {"Authorization": f"Bearer {build_user_access_token(admin_user)}"}
    second = client.post("/api/admin/auth/oidc/finalize", headers=refreshed_headers, json={"flow_id": str(flow.id)})
    assert second.status_code == 200
    assert second.json() == first.json()
    clear_cache.assert_called_once_with()
    session.refresh(flow)
    assert flow.status == OidcFlowStatus.CONSUMED
    assert flow.encrypted_candidate_configuration is None
    assert flow.encrypted_tested_identity is None
    identity = session.exec(select(OidcIdentity).where(OidcIdentity.user_id == admin_user.id)).one()
    assert identity.subject == "admin-subject"
    pending = session.exec(select(OidcPendingIdentityMapping).where(OidcPendingIdentityMapping.target_user_id == unrelated_user.id)).one()
    assert pending.expected_username == "provider-unrelated"


def test_namespace_replacement_stages_existing_identity_for_exact_relink(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    cipher = OidcSecretCipher(config_module.settings.oidc_secret_key)
    existing_user = User(username="local-alice", password_hash="hash")
    active = OidcProviderConfiguration(
        display_name="Old Identity",
        issuer_url="https://old-id.example.test",
        client_id="old-client",
        encrypted_client_secret=cipher.encrypt("old-secret"),
        configuration_revision=3,
        identity_mapping_revision=4,
    )
    session.add(existing_user)
    session.add(active)
    session.commit()
    session.add(
        OidcIdentity(
            user_id=existing_user.id,
            issuer=active.issuer_url,
            subject="old-subject",
            last_seen_username="provider-alice",
        )
    )
    candidate = NormalizedOidcCandidate(
        display_name="New Identity",
        issuer_url="https://new-id.example.test",
        client_id="new-client",
        client_secret="new-secret",
        scopes=("openid", "profile", "groups"),
        username_claim="preferred_username",
        username_claim_uniqueness_confirmed=True,
        name_claim="name",
        email_claim="email",
        groups_claim="groups",
        sign_in_mode=SignInMode.OIDC_ONLY,
        admission_mode=OidcAdmissionMode.ALL_IDP_USERS,
        admission_groups=(),
        admin_groups=("sambee-admins",),
        editor_groups=(),
        configuration_revision=4,
        identity_mapping_revision=4,
        identity_namespace_changed=True,
        changed_fields=("issuer_url", "client_id"),
    )
    tested_claims = NormalizedOidcClaims(
        issuer=candidate.issuer_url,
        subject="new-admin-subject",
        username=admin_user.username,
        name="Test Admin",
        email="admin@example.test",
        groups=("sambee-admins",),
    )
    flow = OidcFlow(
        purpose=OidcFlowPurpose.TEST,
        intent=OidcFlowIntent.REPLACE_IDENTITY_NAMESPACE,
        status=OidcFlowStatus.CALLBACK_VALIDATED,
        initiating_admin_id=admin_user.id,
        encrypted_candidate_configuration=encrypt_candidate_snapshot(candidate, cipher),
        encrypted_tested_identity=cipher.encrypt(json.dumps(asdict(tested_claims))),
        configuration_revision=active.configuration_revision,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    session.add(flow)
    session.commit()

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "flow_id": str(flow.id),
            "replacement_mappings": [{"target_user_id": str(existing_user.id), "expected_username": "provider-alice"}],
            "expected_identity_mapping_revision": 4,
        },
    )

    assert response.status_code == 200
    pending = session.exec(select(OidcPendingIdentityMapping).where(OidcPendingIdentityMapping.target_user_id == existing_user.id)).one()
    assert pending.expected_username == "provider-alice"
    resolved = resolve_or_provision_oidc_user(
        session,
        configuration=active,
        claims=NormalizedOidcClaims(
            issuer=candidate.issuer_url,
            subject="new-user-subject",
            username="provider-alice",
            name="Alice",
            email="alice@example.test",
            groups=("sambee-users",),
        ),
    )
    assert resolved.id == existing_user.id
    namespace_event = session.exec(select(AuditEvent).where(AuditEvent.event_name == "oidc.provider.identity_namespace_replaced")).one()
    assert json.loads(namespace_event.safe_details_json)["mapping_count"] == 2


def test_namespace_replacement_rejects_duplicate_reviewed_usernames_before_mutation(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    cipher = OidcSecretCipher(config_module.settings.oidc_secret_key)
    first_user = User(username="first-local", password_hash="hash")
    second_user = User(username="second-local", password_hash="hash")
    active = OidcProviderConfiguration(
        display_name="Old Identity",
        issuer_url="https://old-id.example.test",
        client_id="old-client",
        encrypted_client_secret=cipher.encrypt("old-secret"),
        configuration_revision=3,
        identity_mapping_revision=4,
    )
    session.add(first_user)
    session.add(second_user)
    session.add(active)
    session.commit()
    first_identity = OidcIdentity(user_id=first_user.id, issuer=active.issuer_url, subject="first-subject")
    second_identity = OidcIdentity(user_id=second_user.id, issuer=active.issuer_url, subject="second-subject")
    session.add(first_identity)
    session.add(second_identity)
    candidate = NormalizedOidcCandidate(
        display_name="New Identity",
        issuer_url="https://new-id.example.test",
        client_id="new-client",
        client_secret="new-secret",
        scopes=("openid",),
        username_claim="preferred_username",
        username_claim_uniqueness_confirmed=True,
        name_claim=None,
        email_claim=None,
        groups_claim="groups",
        sign_in_mode=SignInMode.OIDC_ONLY,
        admission_mode=OidcAdmissionMode.ALL_IDP_USERS,
        admission_groups=(),
        admin_groups=("sambee-admins",),
        editor_groups=(),
        configuration_revision=4,
        identity_mapping_revision=4,
        identity_namespace_changed=True,
        changed_fields=("issuer_url", "client_id"),
    )
    tested = NormalizedOidcClaims(
        issuer=candidate.issuer_url,
        subject="new-admin-subject",
        username=admin_user.username,
        name=None,
        email=None,
        groups=("sambee-admins",),
    )
    flow = OidcFlow(
        purpose=OidcFlowPurpose.TEST,
        intent=OidcFlowIntent.REPLACE_IDENTITY_NAMESPACE,
        status=OidcFlowStatus.CALLBACK_VALIDATED,
        initiating_admin_id=admin_user.id,
        encrypted_candidate_configuration=encrypt_candidate_snapshot(candidate, cipher),
        encrypted_tested_identity=cipher.encrypt(json.dumps(asdict(tested))),
        configuration_revision=active.configuration_revision,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    session.add(flow)
    session.commit()

    preview = client.get(
        f"/api/admin/auth/oidc/test/{flow.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert preview.status_code == 200
    preview_rows = preview.json()["replacement_mappings"]
    assert {row["local_username"] for row in preview_rows} == {"first-local", "second-local"}

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "flow_id": str(flow.id),
            "expected_identity_mapping_revision": 4,
            "replacement_mappings": [
                {"target_user_id": str(first_user.id), "expected_username": "duplicate"},
                {"target_user_id": str(second_user.id), "expected_username": "duplicate"},
            ],
        },
    )

    assert response.status_code == 409
    assert session.get(OidcIdentity, first_identity.id) is not None
    assert session.get(OidcIdentity, second_identity.id) is not None
    session.refresh(active)
    assert active.issuer_url == "https://old-id.example.test"


def test_username_claim_change_removes_pending_mappings_and_revokes_affected_users(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    cipher = OidcSecretCipher(config_module.settings.oidc_secret_key)
    target = User(username="pending-user", password_hash="hash")
    unrelated_user = User(username="unrelated-user", password_hash="hash")
    active = OidcProviderConfiguration(
        display_name="Example Identity",
        issuer_url="https://id.example.test",
        client_id="sambee",
        encrypted_client_secret=cipher.encrypt("secret"),
        role_mappings_json=json.dumps({"admin": ["sambee-admins"], "editor": []}),
        configuration_revision=7,
        identity_mapping_revision=3,
    )
    session.add(target)
    session.add(unrelated_user)
    session.add(active)
    session.commit()
    identity = OidcIdentity(user_id=admin_user.id, issuer=active.issuer_url, subject="admin-subject")
    pending = OidcPendingIdentityMapping(
        provider_configuration_id=active.id,
        expected_username="provider-user",
        target_user_id=target.id,
        created_by_user_id=admin_user.id,
    )
    session.add(identity)
    session.add(pending)
    candidate = NormalizedOidcCandidate(
        display_name=active.display_name,
        issuer_url=active.issuer_url,
        client_id=active.client_id,
        client_secret="secret",
        scopes=("openid", "profile", "groups"),
        username_claim="email",
        username_claim_uniqueness_confirmed=True,
        name_claim="name",
        email_claim="email",
        groups_claim="groups",
        sign_in_mode=SignInMode.PASSWORD_ONLY,
        admission_mode=OidcAdmissionMode.ALL_IDP_USERS,
        admission_groups=(),
        admin_groups=("sambee-admins",),
        editor_groups=(),
        configuration_revision=8,
        identity_mapping_revision=3,
        identity_namespace_changed=False,
        changed_fields=("username_claim",),
    )
    claims = NormalizedOidcClaims(
        issuer=active.issuer_url,
        subject=identity.subject,
        username="admin@example.test",
        name="Test Admin",
        email="admin@example.test",
        groups=("sambee-admins",),
    )
    flow = OidcFlow(
        purpose=OidcFlowPurpose.TEST,
        intent=OidcFlowIntent.CONFIGURE,
        status=OidcFlowStatus.CALLBACK_VALIDATED,
        initiating_admin_id=admin_user.id,
        encrypted_candidate_configuration=encrypt_candidate_snapshot(candidate, cipher),
        encrypted_tested_identity=cipher.encrypt(json.dumps(asdict(claims))),
        configuration_revision=active.configuration_revision,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    session.add(flow)
    session.commit()

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"flow_id": str(flow.id), "expected_identity_mapping_revision": 3},
    )

    assert response.status_code == 200
    assert session.get(OidcPendingIdentityMapping, pending.id) is None
    assert session.get(OidcIdentity, identity.id) is not None
    session.refresh(active)
    session.refresh(admin_user)
    session.refresh(target)
    session.refresh(unrelated_user)
    assert active.identity_mapping_revision == 4
    assert admin_user.token_version == 1
    assert target.token_version == 0
    assert unrelated_user.token_version == 0
    cancellation_event = session.exec(select(AuditEvent).where(AuditEvent.event_name == "oidc.identity.pending_mapping_canceled")).one()
    assert cancellation_event.affected_user_id == target.id


def test_mapping_context_change_rejects_concurrent_mapping_revision(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    cipher = OidcSecretCipher(config_module.settings.oidc_secret_key)
    active = OidcProviderConfiguration(
        display_name="Example Identity",
        issuer_url="https://id.example.test",
        client_id="sambee",
        encrypted_client_secret=cipher.encrypt("secret"),
        configuration_revision=7,
        identity_mapping_revision=4,
    )
    session.add(active)
    session.commit()
    candidate = NormalizedOidcCandidate(
        display_name=active.display_name,
        issuer_url=active.issuer_url,
        client_id=active.client_id,
        client_secret="secret",
        scopes=("openid",),
        username_claim="email",
        username_claim_uniqueness_confirmed=True,
        name_claim="name",
        email_claim="email",
        groups_claim="groups",
        sign_in_mode=SignInMode.PASSWORD_ONLY,
        admission_mode=OidcAdmissionMode.ALL_IDP_USERS,
        admission_groups=(),
        admin_groups=("sambee-admins",),
        editor_groups=(),
        configuration_revision=8,
        identity_mapping_revision=3,
        identity_namespace_changed=False,
        changed_fields=("username_claim",),
    )
    claims = NormalizedOidcClaims(
        issuer=active.issuer_url,
        subject="admin-subject",
        username="admin@example.test",
        name="Test Admin",
        email="admin@example.test",
        groups=("sambee-admins",),
    )
    flow = OidcFlow(
        purpose=OidcFlowPurpose.TEST,
        intent=OidcFlowIntent.CONFIGURE,
        status=OidcFlowStatus.CALLBACK_VALIDATED,
        initiating_admin_id=admin_user.id,
        encrypted_candidate_configuration=encrypt_candidate_snapshot(candidate, cipher),
        encrypted_tested_identity=cipher.encrypt(json.dumps(asdict(claims))),
        configuration_revision=active.configuration_revision,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    session.add(flow)
    session.commit()

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"flow_id": str(flow.id)},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "OIDC identity mappings changed during testing"
    session.refresh(active)
    assert active.configuration_revision == 7
    assert active.identity_mapping_revision == 4
