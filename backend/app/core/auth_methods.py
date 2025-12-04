"""
Authentication method types for Sambee.

Defines the available authentication methods and utilities for working with them.
"""

from enum import StrEnum


#
# AuthMethod
#
class AuthMethod(StrEnum):
    """Available authentication methods"""

    NONE = "none"
    PASSWORD = "password"


#
# parse_auth_method
#
def parse_auth_method(value: str) -> AuthMethod:
    """Parse string to AuthMethod enum.

    Args:
        value: String representation of auth method

    Returns:
        AuthMethod enum value

    Raises:
        ValueError: If value is not a valid auth method
    """

    try:
        return AuthMethod(value.lower())
    except ValueError as e:
        valid_methods = ", ".join([m.value for m in AuthMethod])
        raise ValueError(f"Invalid auth_method '{value}'. Must be one of: {valid_methods}") from e
