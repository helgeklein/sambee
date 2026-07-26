from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.models.oidc import (
    OidcFlow,
    OidcFlowPurpose,
    OidcIdentity,
    OidcPendingIdentityMapping,
    OidcProviderConfiguration,
    SignInMode,
)
from app.models.user import User, UserRole


@pytest.mark.integration
class TestOidcModels:
    def test_passwordless_user_persists(self, session: Session) -> None:
        user = User(username="oidc-passwordless", role=UserRole.VIEWER)
        session.add(user)
        session.commit()
        session.refresh(user)

        assert user.password_hash is None

    def test_provider_configuration_is_singleton(self, session: Session) -> None:
        first = OidcProviderConfiguration(
            display_name="Company SSO",
            issuer_url="https://idp.example.com",
            client_id="sambee",
            sign_in_mode=SignInMode.PASSWORD_ONLY,
        )
        session.add(first)
        session.commit()

        session.add(
            OidcProviderConfiguration(
                id=2,
                display_name="Other SSO",
                issuer_url="https://other.example.com",
                client_id="other",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

    def test_identity_pair_and_user_issuer_are_unique(self, session: Session) -> None:
        first_user = User(username="oidc-first", role=UserRole.VIEWER)
        second_user = User(username="oidc-second", role=UserRole.VIEWER)
        session.add(first_user)
        session.add(second_user)
        session.commit()
        first_user_id = first_user.id
        second_user_id = second_user.id
        issuer = "https://idp.example.com"
        subject = "subject-1"

        identity = OidcIdentity(user_id=first_user_id, issuer=issuer, subject=subject)
        session.add(identity)
        session.commit()

        session.add(OidcIdentity(user_id=second_user_id, issuer=issuer, subject=subject))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(OidcIdentity(user_id=first_user_id, issuer=issuer, subject="subject-2"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

    def test_pending_mapping_is_unique_by_username_and_target(self, session: Session, admin_user: User) -> None:
        first_target = User(username="pending-first", role=UserRole.VIEWER)
        second_target = User(username="pending-second", role=UserRole.VIEWER)
        session.add(first_target)
        session.add(second_target)
        session.add(
            OidcProviderConfiguration(
                display_name="Company SSO",
                issuer_url="https://idp.example.com",
                client_id="sambee",
            )
        )
        session.commit()

        mapping = OidcPendingIdentityMapping(
            provider_configuration_id=1,
            expected_username="first@example.com",
            target_user_id=first_target.id,
            created_by_user_id=admin_user.id,
        )
        session.add(mapping)
        session.commit()

        session.add(
            OidcPendingIdentityMapping(
                provider_configuration_id=1,
                expected_username=mapping.expected_username,
                target_user_id=second_target.id,
                created_by_user_id=admin_user.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

    def test_flow_defaults_to_started(self, session: Session) -> None:
        flow = OidcFlow(
            purpose=OidcFlowPurpose.LOGIN,
            state_hash="state-hash",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        )
        session.add(flow)
        session.commit()
        session.refresh(flow)

        assert flow.status.value == "started"
