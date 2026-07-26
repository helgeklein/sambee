import json
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlmodel import Session, select

import app.core.config as config_module
from app.models.oidc import OidcAdmissionMode, OidcFlow, OidcFlowPurpose, OidcFlowStatus, OidcIdentity, SignInMode
from app.models.user import User
from app.services.oidc_client import NormalizedOidcClaims
from app.services.oidc_configuration import NormalizedOidcCandidate, OidcSecretCipher, encrypt_candidate_snapshot


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
    first = client.post("/api/admin/auth/oidc/finalize", headers=headers, json={"flow_id": str(flow.id)})
    second = client.post("/api/admin/auth/oidc/finalize", headers=headers, json={"flow_id": str(flow.id)})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()
    session.refresh(flow)
    assert flow.status == OidcFlowStatus.CONSUMED
    assert flow.encrypted_candidate_configuration is None
    assert flow.encrypted_tested_identity is None
    identity = session.exec(select(OidcIdentity).where(OidcIdentity.user_id == admin_user.id)).one()
    assert identity.subject == "admin-subject"
