import json
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlmodel import Session, select

import app.core.config as config_module
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
) -> None:
    cipher = OidcSecretCipher(config_module.settings.oidc_secret_key)
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
        changed_fields=("initial_configuration",),
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
    first = client.post("/api/admin/auth/oidc/finalize", headers=headers, json={"flow_id": str(flow.id)})
    second = client.post("/api/admin/auth/oidc/finalize", headers=headers, json={"flow_id": str(flow.id)})

    assert tested.status_code == 200
    assert tested.json()["candidate"]["display_name"] == "Example Identity"
    assert tested.json()["candidate"]["sign_in_mode"] == "oidc_only"
    assert tested.json()["candidate"]["client_secret_configured"] is True
    serialized_tested = json.dumps(tested.json())
    assert '"client_secret":' not in serialized_tested
    assert '"encrypted_client_secret":' not in serialized_tested
    assert '"secret"' not in serialized_tested
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()
    session.refresh(flow)
    assert flow.status == OidcFlowStatus.CONSUMED
    assert flow.encrypted_candidate_configuration is None
    assert flow.encrypted_tested_identity is None
    identity = session.exec(select(OidcIdentity).where(OidcIdentity.user_id == admin_user.id)).one()
    assert identity.subject == "admin-subject"


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
        json={"flow_id": str(flow.id)},
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
