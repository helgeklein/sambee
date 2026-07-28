import uuid
from dataclasses import dataclass
from typing import Literal

from sqlmodel import Session

from app.core.auth_methods import AuthenticationMode, AuthMethod
from app.core.config import settings
from app.models.oidc import OidcProviderConfiguration
from app.models.oidc_api import PublicAuthConfiguration, PublicOidcConfiguration
from app.models.system_settings import SystemSetting

AUTH_MODE_SETTING_KEY = "auth.mode"


@dataclass(frozen=True)
class EffectiveAuthenticationMode:
    mode: AuthenticationMode
    source: Literal["ui", "config_file"]


def get_effective_authentication_mode(session: Session) -> EffectiveAuthenticationMode:
    persisted = session.get(SystemSetting, AUTH_MODE_SETTING_KEY)
    if persisted is not None:
        try:
            return EffectiveAuthenticationMode(mode=AuthenticationMode(persisted.value), source="ui")
        except ValueError as exc:
            raise ValueError("Persisted authentication mode is invalid") from exc
    return EffectiveAuthenticationMode(
        mode=AuthenticationMode.NONE if settings.auth_method == AuthMethod.NONE else AuthenticationMode.PASSWORD_ONLY,
        source="config_file",
    )


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
    if effective_mode.mode in (AuthenticationMode.OIDC_OR_PASSWORD, AuthenticationMode.OIDC_ONLY) and configuration is not None:
        oidc = PublicOidcConfiguration(
            display_name=configuration.display_name,
            authorization_path="/api/auth/oidc/authorize",
        )
    return PublicAuthConfiguration(sign_in_mode=effective_mode.mode, oidc=oidc)


def is_password_login_enabled(session: Session) -> bool:
    return get_effective_authentication_mode(session).mode in (
        AuthenticationMode.PASSWORD_ONLY,
        AuthenticationMode.OIDC_OR_PASSWORD,
    )
