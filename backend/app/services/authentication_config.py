from sqlmodel import Session

from app.core.auth_methods import AuthMethod
from app.core.config import settings
from app.models.oidc import OidcProviderConfiguration, SignInMode
from app.models.oidc_api import PublicAuthConfiguration, PublicOidcConfiguration


def get_database_auth_configuration(session: Session) -> OidcProviderConfiguration | None:
    return session.get(OidcProviderConfiguration, 1)


def build_public_auth_configuration(session: Session) -> PublicAuthConfiguration | dict[str, str]:
    configuration = get_database_auth_configuration(session)
    if configuration is None:
        return {"auth_method": settings.auth_method.value}

    oidc = None
    if configuration.sign_in_mode in (SignInMode.OIDC_OR_PASSWORD, SignInMode.OIDC_ONLY):
        oidc = PublicOidcConfiguration(
            display_name=configuration.display_name,
            authorization_path="/api/auth/oidc/authorize",
        )
    return PublicAuthConfiguration(sign_in_mode=configuration.sign_in_mode, oidc=oidc)


def is_password_login_enabled(session: Session) -> bool:
    configuration = get_database_auth_configuration(session)
    if configuration is None:
        return settings.auth_method == AuthMethod.PASSWORD
    return configuration.sign_in_mode in (SignInMode.PASSWORD_ONLY, SignInMode.OIDC_OR_PASSWORD)
