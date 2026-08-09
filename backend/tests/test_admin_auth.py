import json
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

import app.api.admin_auth as admin_auth_module
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
from app.models.system_settings import SystemSetting
from app.models.user import User, UserRole
from app.services.oidc_client import NormalizedOidcClaims
from app.services.oidc_configuration import (
    NormalizedOidcCandidate,
    decrypt_candidate_snapshot,
    encrypt_candidate_snapshot,
    get_active_oidc_session_cipher,
    get_oidc_secret_cipher,
)
from app.services.oidc_identity import resolve_or_provision_oidc_user
from app.services.oidc_mapping import OidcMappingError, change_identity, claim_mapping_revision, move_identity


def test_no_authentication_mode_requires_acknowledgement_and_persists(
    client: TestClient,
    session: Session,
    admin_token: str,
) -> None:
    headers = {"Authorization": f"Bearer {admin_token}"}

    rejected = client.post("/api/admin/auth/mode", headers=headers, json={"mode": "none"})
    assert rejected.status_code == 400

    activated = client.post(
        "/api/admin/auth/mode",
        headers=headers,
        json={"mode": "none", "acknowledge_no_authentication": True},
    )
    assert activated.status_code == 200
    assert activated.json() == {"auth_mode": "none", "reauthentication_required": True}
    setting = session.get(SystemSetting, "auth.mode")
    assert setting is not None
    assert setting.value == "none"
    assert client.get("/api/auth/config").json() == {"sign_in_mode": "none", "oidc": None}


def test_oidc_test_returns_specific_configuration_validation_error(
    client: TestClient,
    admin_token: str,
) -> None:
    response = client.post(
        "/api/admin/auth/oidc/test",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "issuer_url": "https://idp.example.test",
            "client_id": "sambee",
            "scopes": ["profile"],
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "OIDC scopes must include openid"


def test_get_oidc_configuration_returns_the_admin_configuration(
    client: TestClient,
    admin_token: str,
) -> None:
    response = client.get("/api/admin/auth/oidc", headers={"Authorization": f"Bearer {admin_token}"})

    assert response.status_code == 200
    assert response.json()["configuration"] is None
    assert "health" in response.json()


def test_oidc_session_cipher_key_rotation_is_admin_only_and_audited(
    client: TestClient,
    session: Session,
    admin_token: str,
    user_token: str,
) -> None:
    first = get_active_oidc_session_cipher(session)
    session.commit()

    denied = client.post("/api/admin/auth/oidc/session-cipher-key/rotate", headers={"Authorization": f"Bearer {user_token}"})
    assert denied.status_code == 403

    response = client.post("/api/admin/auth/oidc/session-cipher-key/rotate", headers={"Authorization": f"Bearer {admin_token}"})

    assert response.status_code == 200
    assert response.json()["active_key_id"] != first.key_id
    assert get_active_oidc_session_cipher(session).key_id == response.json()["active_key_id"]
    audit_event = session.exec(select(AuditEvent).order_by(AuditEvent.created_at.desc())).first()
    assert audit_event is not None
    assert audit_event.event_name == "oidc.browser_session.cipher_key_rotated"


def test_client_secret_only_update_preserves_session_validation_revision(session: Session, admin_user: User) -> None:
    cipher = get_oidc_secret_cipher()
    active = OidcProviderConfiguration(
        display_name="Example",
        issuer_url="https://id.example.test",
        client_id="sambee",
        encrypted_client_secret=cipher.encrypt("old-secret"),
        session_validation_revision=4,
    )
    candidate = NormalizedOidcCandidate(
        display_name=active.display_name,
        issuer_url=active.issuer_url,
        client_id=active.client_id,
        client_secret="new-secret",
        scopes=("openid", "profile", "email", "offline_access"),
        username_claim=active.username_claim,
        name_claim=active.name_claim,
        email_claim=active.email_claim,
        groups_claim=active.groups_claim,
        sign_in_mode=active.sign_in_mode,
        admission_mode=active.admission_mode,
        admission_groups=(),
        admin_groups=(),
        editor_groups=(),
        changed_fields=("client_secret",),
        configuration_revision=active.configuration_revision + 1,
        identity_mapping_revision=active.identity_mapping_revision,
        identity_namespace_changed=False,
    )

    proposed = admin_auth_module._proposed_configuration(
        candidate,
        cipher,
        active=active,
        updated_by_user_id=admin_user.id,
        identity_mapping_revision=active.identity_mapping_revision,
    )

    assert proposed.session_validation_revision == active.session_validation_revision


def _create_validated_test_flow(
    session: Session,
    admin_user: User,
    *,
    sign_in_mode: SignInMode = SignInMode.OIDC_OR_PASSWORD,
) -> OidcFlow:
    cipher = get_oidc_secret_cipher()
    candidate = NormalizedOidcCandidate(
        display_name="Example Identity",
        issuer_url="https://id.example.test",
        client_id="sambee",
        client_secret="secret",
        scopes=("openid", "profile", "groups", "offline_access"),
        username_claim="preferred_username",
        name_claim="name",
        email_claim="email",
        groups_claim="groups",
        sign_in_mode=sign_in_mode,
        admission_mode=OidcAdmissionMode.ALL_IDP_USERS,
        admission_groups=(),
        admin_groups=("sambee-admins",),
        editor_groups=(),
        configuration_revision=1,
        identity_mapping_revision=0,
        identity_namespace_changed=False,
        changed_fields=("initial_configuration", "sign_in_mode"),
    )
    claims = NormalizedOidcClaims(
        issuer=candidate.issuer_url,
        subject="admin-subject",
        username=admin_user.username,
        name="Test Admin",
        email="admin@example.test",
        groups=("sambee-admins",),
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
    return flow


def _reviewed_policy_for_flow(flow: OidcFlow) -> dict[str, object]:
    cipher = get_oidc_secret_cipher()
    candidate = decrypt_candidate_snapshot(str(flow.encrypted_candidate_configuration), cipher)
    return {
        "sign_in_mode": candidate.sign_in_mode,
        "admission_mode": candidate.admission_mode,
        "admission_groups": list(candidate.admission_groups),
        "role_mappings": {
            "admin": list(candidate.admin_groups),
            "editor": list(candidate.editor_groups),
            "viewer": list(candidate.viewer_groups),
        },
    }


def test_finalize_oidc_configuration_is_idempotent(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clear_cache = Mock()
    monkeypatch.setattr(admin_auth_module, "clear_oidc_provider_cache", clear_cache)
    cipher = get_oidc_secret_cipher()
    unrelated_user = User(username="unrelated-user", password_hash="hash")
    session.add(unrelated_user)
    session.commit()
    candidate = NormalizedOidcCandidate(
        display_name="Example Identity",
        issuer_url="https://id.example.test",
        client_id="sambee",
        client_secret="secret",
        scopes=("openid", "profile", "groups", "offline_access"),
        username_claim="preferred_username",
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
    reviewed_policy = _reviewed_policy_for_flow(flow)
    tested = client.post(
        f"/api/admin/auth/oidc/test-flows/{flow.id}/preview",
        headers=headers,
        json={"reviewed_policy": reviewed_policy},
    )
    first = client.post(
        "/api/admin/auth/oidc/finalize",
        headers=headers,
        json={
            "flow_id": str(flow.id),
            "reviewed_policy": reviewed_policy,
            "expected_identity_mapping_revision": None,
        },
    )

    assert tested.status_code == 200
    assert tested.json()["candidate"]["display_name"] == "Example Identity"
    assert tested.json()["candidate"]["sign_in_mode"] == "oidc_only"
    assert tested.json()["candidate"]["client_secret_configured"] is True
    assert tested.json()["expected_identity_mapping_revision"] is None
    assert tested.json()["replacement_mappings"] == []
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
    second = client.post(
        "/api/admin/auth/oidc/finalize",
        headers=headers,
        json={"flow_id": str(flow.id), "reviewed_policy": reviewed_policy},
    )
    assert second.status_code == 200
    assert second.json() == first.json()
    clear_cache.assert_called_once_with()
    session.refresh(flow)
    assert flow.status == OidcFlowStatus.CONSUMED
    assert flow.encrypted_candidate_configuration is None
    assert flow.encrypted_tested_identity is None
    identity = session.exec(select(OidcIdentity).where(OidcIdentity.user_id == admin_user.id)).one()
    assert identity.subject == "admin-subject"

    flow.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    session.add(flow)
    session.commit()
    stale_expired_retry = client.post(
        "/api/admin/auth/oidc/finalize",
        headers=headers,
        json={"flow_id": str(flow.id), "reviewed_policy": reviewed_policy},
    )
    assert stale_expired_retry.status_code == 401
    refreshed_headers = {"Authorization": f"Bearer {build_user_access_token(admin_user)}"}
    expired_retry = client.post(
        "/api/admin/auth/oidc/finalize",
        headers=refreshed_headers,
        json={"flow_id": str(flow.id), "reviewed_policy": reviewed_policy},
    )
    assert expired_retry.status_code == 404


def test_oidc_test_preview_is_not_cached_and_includes_identity_evaluation(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    flow = _create_validated_test_flow(session, admin_user)

    response = client.post(
        f"/api/admin/auth/oidc/test-flows/{flow.id}/preview",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"reviewed_policy": _reviewed_policy_for_flow(flow)},
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["admitted"] is True
    assert response.json()["matching_admission_group"] is None
    assert response.json()["affected_account_count"] == 1
    assert response.json()["acting_administrator_affected"] is True


def test_oidc_test_preview_reevaluates_reviewed_policy_and_reports_impact(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    other_user = User(username="preview-impact-user", password_hash="hash")
    session.add(other_user)
    session.commit()
    flow = _create_validated_test_flow(session, admin_user)
    reviewed_policy = _reviewed_policy_for_flow(flow)
    reviewed_policy.update(
        {
            "sign_in_mode": "oidc_only",
            "admission_mode": "selected_groups",
            "admission_groups": ["SAMBEE-ADMINS"],
        }
    )

    response = client.post(
        f"/api/admin/auth/oidc/test-flows/{flow.id}/preview",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"reviewed_policy": reviewed_policy},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["candidate"]["sign_in_mode"] == "oidc_only"
    assert result["candidate"]["admission_mode"] == "selected_groups"
    assert result["matching_admission_group"] == "SAMBEE-ADMINS"
    assert result["affected_account_count"] == 2
    assert result["acting_administrator_affected"] is True


def test_finalize_commits_reviewed_policy_after_interactive_test(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    flow = _create_validated_test_flow(session, admin_user)
    reviewed_policy = _reviewed_policy_for_flow(flow)
    reviewed_policy.update(
        {
            "sign_in_mode": "oidc_only",
            "admission_mode": "selected_groups",
            "admission_groups": ["sambee-admins"],
        }
    )

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "flow_id": str(flow.id),
            "reviewed_policy": reviewed_policy,
            "expected_identity_mapping_revision": None,
        },
    )

    assert response.status_code == 200
    active = session.get(OidcProviderConfiguration, 1)
    assert active is not None
    assert active.sign_in_mode == SignInMode.OIDC_ONLY
    assert active.admission_mode == OidcAdmissionMode.SELECTED_GROUPS
    assert json.loads(active.admission_groups_json) == ["sambee-admins"]


def test_initial_activation_integrity_race_returns_configuration_changed(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    flow = _create_validated_test_flow(session, admin_user)

    def raise_integrity_error() -> None:
        raise IntegrityError("concurrent singleton insert", {}, RuntimeError("conflict"))

    monkeypatch.setattr(session, "commit", raise_integrity_error)
    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "flow_id": str(flow.id),
            "reviewed_policy": _reviewed_policy_for_flow(flow),
            "expected_identity_mapping_revision": None,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "oidc_configuration_changed"


def test_finalize_rejects_password_only_candidate(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    flow = _create_validated_test_flow(session, admin_user, sign_in_mode=SignInMode.PASSWORD_ONLY)

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "flow_id": str(flow.id),
            "reviewed_policy": _reviewed_policy_for_flow(flow),
            "expected_identity_mapping_revision": None,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "oidc_tested_activation_mode_invalid"


def test_finalize_rejects_legacy_bulk_mapping_payloads(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    inactive_target = User(username="inactive-finalization-target", is_active=False)
    session.add(inactive_target)
    session.commit()
    target_id = inactive_target.id
    flow = _create_validated_test_flow(session, admin_user)

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "flow_id": str(flow.id),
            "reviewed_policy": _reviewed_policy_for_flow(flow),
            "expected_identity_mapping_revision": None,
            "replacement_mappings": [{"target_user_id": str(target_id), "expected_username": "provider-user"}],
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "OIDC mapping review is not expected"


def test_finalize_rejects_legacy_pending_mapping_payloads(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    target = User(username="unconfirmed-mapping-target", password_hash="hash")
    session.add(target)
    session.commit()
    flow = _create_validated_test_flow(session, admin_user)
    reviewed_policy = _reviewed_policy_for_flow(flow)

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "flow_id": str(flow.id),
            "reviewed_policy": reviewed_policy,
            "expected_identity_mapping_revision": None,
            "replacement_mappings": [
                {"target_user_id": str(target.id), "expected_username": "provider-target"},
            ],
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "OIDC mapping review is not expected"


def test_change_identity_allows_pending_mapping_without_uniqueness_confirmation(
    client: TestClient,
    session: Session,
    admin_token: str,
) -> None:
    configuration = OidcProviderConfiguration(
        display_name="Provider",
        issuer_url="https://issuer.example",
        client_id="sambee",
        identity_mapping_revision=3,
    )
    target = User(username="linked-target", password_hash="hash")
    session.add(configuration)
    session.add(target)
    session.flush()
    identity = OidcIdentity(user_id=target.id, issuer=configuration.issuer_url, subject="linked-subject")
    session.add(identity)
    session.commit()
    target_id = target.id

    response = client.post(
        f"/api/admin/auth/oidc/mappings/{target_id}/change",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"expected_identity_mapping_revision": 3, "expected_username": "provider-target"},
    )

    assert response.status_code == 200
    pending = session.exec(select(OidcPendingIdentityMapping)).one()
    assert pending.target_user_id == target_id
    assert pending.expected_username == "provider-target"


def test_change_identity_does_not_require_uniqueness_confirmation(session: Session, admin_user: User) -> None:
    configuration = OidcProviderConfiguration(
        display_name="Provider",
        issuer_url="https://issuer.example",
        client_id="sambee",
    )
    target = User(username="service-linked-target", password_hash="hash")
    session.add(configuration)
    session.add(target)
    session.flush()
    identity = OidcIdentity(user_id=target.id, issuer=configuration.issuer_url, subject="service-linked-subject")
    session.add(identity)
    session.commit()

    change_identity(
        session,
        configuration=configuration,
        target_user_id=target.id,
        expected_username="provider-target",
        acting_user_id=admin_user.id,
    )

    pending = session.exec(select(OidcPendingIdentityMapping)).one()
    assert pending.target_user_id == target.id
    assert pending.expected_username == "provider-target"


def test_move_identity_does_not_require_username_uniqueness_confirmation(session: Session, admin_user: User) -> None:
    configuration = OidcProviderConfiguration(
        display_name="Provider",
        issuer_url="https://issuer.example",
        client_id="sambee",
    )
    source = User(username="move-source", password_hash="hash")
    target = User(username="move-target", password_hash="hash")
    session.add(configuration)
    session.add(source)
    session.add(target)
    session.flush()
    identity = OidcIdentity(user_id=source.id, issuer=configuration.issuer_url, subject="move-subject")
    session.add(identity)
    session.commit()

    move_identity(
        session,
        configuration=configuration,
        identity_id=identity.id,
        target_user_id=target.id,
        acting_user_id=admin_user.id,
    )

    assert identity.user_id == target.id
    assert session.exec(select(OidcPendingIdentityMapping)).first() is None


def test_finalize_rechecks_initiating_administrator_after_write_boundary(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    flow = _create_validated_test_flow(session, admin_user)

    def deactivate_initiating_admin(*_args: object, **_kwargs: object) -> UserRole:
        admin_user.is_active = False
        session.add(admin_user)
        session.flush()
        return UserRole.ADMIN

    monkeypatch.setattr(admin_auth_module, "resolve_oidc_role", deactivate_initiating_admin)

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "flow_id": str(flow.id),
            "reviewed_policy": _reviewed_policy_for_flow(flow),
            "expected_identity_mapping_revision": None,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "oidc_initiating_administrator_unavailable"


def test_finalize_flow_claim_rechecks_expiry(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    flow = _create_validated_test_flow(session, admin_user)
    baseline = datetime.now(timezone.utc)
    flow.expires_at = baseline + timedelta(seconds=5)
    session.add(flow)
    session.commit()

    class AdvancingDateTime(datetime):
        calls = 0

        @classmethod
        def now(cls, tz: timezone | None = None) -> datetime:
            cls.calls += 1
            current = baseline if cls.calls == 1 else baseline + timedelta(seconds=10)
            return current if tz is not None else current.replace(tzinfo=None)

    monkeypatch.setattr(admin_auth_module, "datetime", AdvancingDateTime)

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "flow_id": str(flow.id),
            "reviewed_policy": _reviewed_policy_for_flow(flow),
            "expected_identity_mapping_revision": None,
        },
    )

    assert response.status_code == 404, response.json()
    assert response.json()["detail"] == "OIDC test flow was not found"


def test_mapping_revision_claim_is_conditional(session: Session) -> None:
    configuration = OidcProviderConfiguration(
        display_name="Provider",
        issuer_url="https://issuer.example",
        client_id="sambee",
        identity_mapping_revision=4,
    )
    session.add(configuration)
    session.commit()

    assert claim_mapping_revision(session, configuration, 4) == 5
    with pytest.raises(OidcMappingError, match="changed"):
        claim_mapping_revision(session, configuration, 4)
    session.rollback()


def test_pending_mapping_duplicate_targets_return_structured_error(
    client: TestClient,
    session: Session,
    admin_token: str,
) -> None:
    configuration = OidcProviderConfiguration(
        display_name="Provider",
        issuer_url="https://issuer.example",
        client_id="sambee",
        identity_mapping_revision=2,
    )
    target = User(username="mapping-target")
    session.add(configuration)
    session.add(target)
    session.commit()
    target_id = target.id

    response = client.put(
        "/api/admin/auth/oidc/mappings/pending",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "expected_identity_mapping_revision": 2,
            "mappings": [
                {"target_user_id": str(target_id), "expected_username": "first"},
                {"target_user_id": str(target_id), "expected_username": "second"},
            ],
        },
    )

    assert response.status_code == 409
    errors = response.json()["detail"]["errors"]
    assert len(errors) == 2
    assert {error["error_code"] for error in errors} == {"oidc_mapping_duplicate_target"}
    assert {error["target_user_id"] for error in errors} == {str(target_id)}


def test_pending_mapping_batch_returns_all_row_errors(
    client: TestClient,
    session: Session,
    admin_token: str,
) -> None:
    configuration = OidcProviderConfiguration(
        display_name="Provider",
        issuer_url="https://issuer.example",
        client_id="sambee",
        identity_mapping_revision=2,
    )
    inactive_target = User(username="inactive-mapping-target", is_active=False)
    expired_target = User(username="expired-mapping-target", expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    session.add(configuration)
    session.add(inactive_target)
    session.add(expired_target)
    session.commit()
    inactive_target_id = inactive_target.id
    expired_target_id = expired_target.id

    response = client.put(
        "/api/admin/auth/oidc/mappings/pending",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "expected_identity_mapping_revision": 2,
            "mappings": [
                {"target_user_id": str(inactive_target_id), "expected_username": "duplicate"},
                {"target_user_id": str(expired_target_id), "expected_username": "duplicate"},
            ],
        },
    )

    assert response.status_code == 409
    errors = response.json()["detail"]["errors"]
    assert len(errors) == 4
    assert {error["target_user_id"] for error in errors} == {str(inactive_target_id), str(expired_target_id)}
    assert {error["error_code"] for error in errors} == {
        "oidc_mapping_target_unavailable",
        "oidc_mapping_duplicate_username",
    }


def test_cancel_oidc_test_flow_enforces_owner_and_deletes_candidate(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    other_admin = User(username="other-flow-admin", password_hash="hash", role=UserRole.ADMIN)
    session.add(other_admin)
    session.flush()
    other_flow = OidcFlow(
        purpose=OidcFlowPurpose.TEST,
        status=OidcFlowStatus.CALLBACK_VALIDATED,
        initiating_admin_id=other_admin.id,
        encrypted_candidate_configuration="encrypted-candidate",
        encrypted_tested_identity="encrypted-identity",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    owned_flow = OidcFlow(
        purpose=OidcFlowPurpose.TEST,
        status=OidcFlowStatus.CALLBACK_VALIDATED,
        initiating_admin_id=admin_user.id,
        encrypted_candidate_configuration="encrypted-candidate",
        encrypted_tested_identity="encrypted-identity",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    session.add(other_flow)
    session.add(owned_flow)
    session.commit()
    other_flow_id = other_flow.id
    owned_flow_id = owned_flow.id
    headers = {"Authorization": f"Bearer {admin_token}"}

    response = client.delete(f"/api/admin/auth/oidc/test-flows/{owned_flow_id}", headers=headers)
    assert response.status_code == 204
    assert session.get(OidcFlow, owned_flow_id) is None

    denied = client.delete(f"/api/admin/auth/oidc/test-flows/{other_flow_id}", headers=headers)
    assert denied.status_code == 404


def test_changed_issuer_auto_links_matching_local_username(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    cipher = get_oidc_secret_cipher()
    existing_user = User(username="provider-alice", password_hash="hash")
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
        scopes=("openid", "profile", "groups", "offline_access"),
        username_claim="preferred_username",
        name_claim="name",
        email_claim="email",
        groups_claim="groups",
        sign_in_mode=SignInMode.OIDC_ONLY,
        admission_mode=OidcAdmissionMode.ALL_IDP_USERS,
        admission_groups=(),
        admin_groups=("sambee-admins",),
        editor_groups=(),
        viewer_groups=("sambee-users",),
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
            "reviewed_policy": _reviewed_policy_for_flow(flow),
            "expected_identity_mapping_revision": 4,
        },
    )

    assert response.status_code == 200
    session.refresh(active)
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
    identities = session.exec(select(OidcIdentity).where(OidcIdentity.user_id == existing_user.id)).all()
    assert [(identity.issuer, identity.subject) for identity in identities] == [(candidate.issuer_url, "new-user-subject")]
    assert len(session.exec(select(AuditEvent).where(AuditEvent.event_name == "oidc.identity.relinked")).all()) >= 2


def test_finalize_rejects_legacy_namespace_mapping_payloads_without_mutation(
    client: TestClient,
    session: Session,
    admin_user: User,
    admin_token: str,
) -> None:
    cipher = get_oidc_secret_cipher()
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
        scopes=("openid", "offline_access"),
        username_claim="preferred_username",
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

    preview = client.post(
        f"/api/admin/auth/oidc/test-flows/{flow.id}/preview",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"reviewed_policy": _reviewed_policy_for_flow(flow)},
    )
    assert preview.status_code == 200
    assert preview.json()["replacement_mappings"] == []

    response = client.post(
        "/api/admin/auth/oidc/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "flow_id": str(flow.id),
            "reviewed_policy": _reviewed_policy_for_flow(flow),
            "expected_identity_mapping_revision": 4,
            "replacement_mappings": [
                {"target_user_id": str(first_user.id), "expected_username": "duplicate"},
                {"target_user_id": str(second_user.id), "expected_username": "duplicate"},
            ],
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "OIDC mapping review is not expected"
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
    cipher = get_oidc_secret_cipher()
    target = User(username="pending-user", password_hash="hash")
    unrelated_user = User(username="unrelated-user", password_hash="hash")
    active = OidcProviderConfiguration(
        display_name="Example Identity",
        issuer_url="https://id.example.test",
        client_id="sambee",
        encrypted_client_secret=cipher.encrypt("secret"),
        sign_in_mode=SignInMode.OIDC_OR_PASSWORD,
        role_mappings_json=json.dumps({"admin": ["sambee-admins"], "editor": [], "viewer": []}),
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
        scopes=("openid", "profile", "groups", "offline_access"),
        username_claim="email",
        name_claim="name",
        email_claim="email",
        groups_claim="groups",
        sign_in_mode=SignInMode.OIDC_OR_PASSWORD,
        admission_mode=OidcAdmissionMode.ALL_IDP_USERS,
        admission_groups=(),
        admin_groups=("sambee-admins",),
        editor_groups=(),
        viewer_groups=(),
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
        json={
            "flow_id": str(flow.id),
            "reviewed_policy": _reviewed_policy_for_flow(flow),
            "expected_identity_mapping_revision": 3,
        },
    )

    assert response.status_code == 200
    assert session.get(OidcPendingIdentityMapping, pending.id) is None
    assert session.get(OidcIdentity, identity.id) is not None
    session.refresh(active)
    session.refresh(admin_user)
    session.refresh(target)
    session.refresh(unrelated_user)
    assert active.identity_mapping_revision == 4
    assert admin_user.token_version == 2
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
    cipher = get_oidc_secret_cipher()
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
        scopes=("openid", "offline_access"),
        username_claim="email",
        name_claim="name",
        email_claim="email",
        groups_claim="groups",
        sign_in_mode=SignInMode.OIDC_OR_PASSWORD,
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
        json={"flow_id": str(flow.id), "reviewed_policy": _reviewed_policy_for_flow(flow)},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "oidc_mapping_review_stale"
    session.refresh(active)
    assert active.configuration_revision == 7
    assert active.identity_mapping_revision == 4
