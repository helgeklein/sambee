from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session

from app.models.oidc import OidcProviderConfiguration, SignInMode
from app.models.user import User, UserRole
from app.services.oidc_recovery import OidcRecoveryError, activate_password_only


def test_password_only_recovery_rejects_expired_local_administrator(session: Session) -> None:
    session.add(
        OidcProviderConfiguration(
            display_name="Example",
            issuer_url="https://id.example",
            client_id="sambee",
            sign_in_mode=SignInMode.OIDC_ONLY,
        )
    )
    session.add(
        User(
            username="expired-admin",
            password_hash="hash",
            role=UserRole.ADMIN,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
    )
    session.commit()

    with pytest.raises(OidcRecoveryError, match="active local-password administrator"):
        activate_password_only(session)

    configuration = session.get(OidcProviderConfiguration, 1)
    assert configuration is not None
    assert configuration.sign_in_mode == SignInMode.OIDC_ONLY
