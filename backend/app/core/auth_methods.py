"""Authentication mode types for Sambee."""

from enum import StrEnum


class AuthenticationMode(StrEnum):
    """Canonical runtime authentication modes."""

    NONE = "none"
    PASSWORD_ONLY = "password_only"
    OIDC_OR_PASSWORD = "oidc_or_password"
    OIDC_ONLY = "oidc_only"
