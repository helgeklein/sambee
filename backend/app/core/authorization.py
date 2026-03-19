from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING

from app.models.user import UserRole

if TYPE_CHECKING:
    from app.models.user import User


class Capability(StrEnum):
    ACCESS_ADMIN_SETTINGS = "access_admin_settings"
    MANAGE_CONNECTIONS = "manage_connections"
    MANAGE_USERS = "manage_users"


ROLE_CAPABILITIES: dict[UserRole, frozenset[Capability]] = {
    UserRole.REGULAR: frozenset(),
    UserRole.ADMIN: frozenset(
        {
            Capability.ACCESS_ADMIN_SETTINGS,
            Capability.MANAGE_CONNECTIONS,
            Capability.MANAGE_USERS,
        }
    ),
}


def get_capabilities_for_role(role: UserRole) -> frozenset[Capability]:
    return ROLE_CAPABILITIES.get(role, frozenset())


def user_has_capability(user: User, capability: Capability) -> bool:
    return capability in get_capabilities_for_role(user.role)
