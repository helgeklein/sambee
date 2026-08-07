import uuid

from sqlmodel import Session

from app.core.auth_methods import AuthenticationMode
from app.core.config import settings
from app.models.oidc import OidcProviderConfiguration
from app.models.oidc_api import PublicAuthConfiguration, PublicOidcConfiguration
from app.models.system_settings import SystemSetting

AUTH_MODE_SETTING_KEY = "auth.mode"


def get_configured_authentication_mode(session: Session) -> AuthenticationMode:
    persisted = session.get(SystemSetting, AUTH_MODE_SETTING_KEY)
    if persisted is not None:
        try:
            return AuthenticationMode(persisted.value)
        except ValueError as exc:
            raise ValueError("Persisted authentication mode is invalid") from exc
    return AuthenticationMode.PASSWORD_ONLY


def is_authentication_enforcement_disabled() -> bool:
    return settings.disable_auth_enforcement


def get_effective_authentication_mode(session: Session) -> AuthenticationMode:
    if is_authentication_enforcement_disabled():
        return AuthenticationMode.NONE
    return get_configured_authentication_mode(session)


def set_ui_authentication_mode(
    session: Session,
    *,
    mode: AuthenticationMode,
    updated_by_user_id: uuid.UUID | None,
) -> None:
    setting = session.get(SystemSetting, AUTH_MODE_SETTING_KEY)
    if setting is None:
        session.add(SystemSetting(key=AUTH_MODE_SETTING_KEY, value=mode.value, updated_by_user_id=updated_by_user_id))
        return
    setting.value = mode.value
    setting.updated_by_user_id = updated_by_user_id
    session.add(setting)


def get_database_auth_configuration(session: Session) -> OidcProviderConfiguration | None:
    return session.get(OidcProviderConfiguration, 1)


def build_public_auth_configuration(session: Session) -> PublicAuthConfiguration:
    effective_mode = get_effective_authentication_mode(session)
    configuration = get_database_auth_configuration(session)
    oidc = None
    if effective_mode in (AuthenticationMode.OIDC_OR_PASSWORD, AuthenticationMode.OIDC_ONLY) and configuration is not None:
        oidc = PublicOidcConfiguration(
            display_name=configuration.display_name,
            authorization_path="/api/auth/oidc/authorize",
        )
    return PublicAuthConfiguration(sign_in_mode=effective_mode, oidc=oidc)


def is_password_login_enabled(session: Session) -> bool:
    return get_effective_authentication_mode(session) in (
        AuthenticationMode.PASSWORD_ONLY,
        AuthenticationMode.OIDC_OR_PASSWORD,
    )


def is_local_password_management_available(session: Session) -> bool:
    return get_configured_authentication_mode(session) in (
        AuthenticationMode.PASSWORD_ONLY,
        AuthenticationMode.OIDC_OR_PASSWORD,
    )


def is_password_change_available(session: Session) -> bool:
    return is_local_password_management_available(session)
