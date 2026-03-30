import logging
import uuid
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.authorization import Capability, user_has_capability
from app.models.connection import Connection, ConnectionAccessMode, ConnectionRead, ConnectionScope, ConnectionVisibilityOptionRead
from app.models.user import User

logger = logging.getLogger(__name__)

VISIBILITY_OPTION_METADATA: dict[ConnectionScope, dict[str, str]] = {
    ConnectionScope.PRIVATE: {
        "label": "Private to me",
        "description": "Visible only to your account. You can fully manage it.",
    },
    ConnectionScope.SHARED: {
        "label": "Shared with everyone",
        "description": "Visible to all users. Only admins can manage it.",
    },
}

SHARED_VISIBILITY_UNAVAILABLE_REASON = "Shared connections can only be created or updated by admins."
READ_ONLY_CONNECTION_DETAIL = "Connection is read-only"


@dataclass(frozen=True)
class EffectiveConnectionAccess:
    access_mode: ConnectionAccessMode
    allows_write: bool
    source: str


def can_view_connection(current_user: User, connection: Connection) -> bool:
    """Return whether the current user may see the connection."""

    return connection.scope == ConnectionScope.SHARED or connection.owner_user_id == current_user.id


def list_accessible_connections(session: Session, current_user: User) -> list[Connection]:
    """Return all connections visible to the current user."""

    connections = [connection for connection in session.exec(select(Connection)).all() if can_view_connection(current_user, connection)]
    return sorted(
        connections,
        key=lambda connection: (
            connection.scope != ConnectionScope.SHARED,
            connection.name.lower(),
            str(connection.id),
        ),
    )


def get_accessible_connection_or_404(session: Session, current_user: User, connection_id: uuid.UUID) -> Connection:
    """Return a visible connection or raise 404 when it is not accessible."""

    connection = session.get(Connection, connection_id)
    if not connection or not can_view_connection(current_user, connection):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
    return connection


def can_manage_connection(current_user: User, connection: Connection) -> bool:
    """Return whether the current user may modify or test the connection."""

    if connection.scope == ConnectionScope.SHARED:
        return user_has_capability(current_user, Capability.MANAGE_CONNECTIONS)
    return connection.owner_user_id == current_user.id


def get_effective_connection_access(current_user: User, connection: Connection) -> EffectiveConnectionAccess:
    """Return the effective access mode for a connection in the current request context."""

    del current_user

    if connection.access_mode == ConnectionAccessMode.READ_ONLY:
        return EffectiveConnectionAccess(
            access_mode=ConnectionAccessMode.READ_ONLY,
            allows_write=False,
            source="connection_access_mode",
        )

    return EffectiveConnectionAccess(
        access_mode=ConnectionAccessMode.READ_WRITE,
        allows_write=True,
        source="connection_access_mode",
    )


def require_connection_write_access(
    current_user: User,
    connection: Connection,
    *,
    action: str,
    path: str | None = None,
) -> EffectiveConnectionAccess:
    """Raise 403 when the current request is not allowed to mutate connection contents."""

    access = get_effective_connection_access(current_user, connection)
    if access.allows_write:
        return access

    logger.warning(
        "Blocked read-only write attempt: user=%s connection_id=%s action=%s path=%r source=%s",
        current_user.username,
        connection.id,
        action,
        path,
        access.source,
    )
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=READ_ONLY_CONNECTION_DETAIL)


def list_connection_visibility_options(current_user: User) -> list[ConnectionVisibilityOptionRead]:
    """Return all supported visibility options with per-user availability metadata."""

    can_manage_shared_connections = user_has_capability(current_user, Capability.MANAGE_CONNECTIONS)
    options: list[ConnectionVisibilityOptionRead] = []

    for scope in ConnectionScope:
        metadata = VISIBILITY_OPTION_METADATA[scope]
        is_available = scope != ConnectionScope.SHARED or can_manage_shared_connections
        options.append(
            ConnectionVisibilityOptionRead(
                value=scope,
                label=metadata["label"],
                description=metadata["description"],
                available=is_available,
                unavailable_reason=None if is_available else SHARED_VISIBILITY_UNAVAILABLE_REASON,
            )
        )

    return options


def require_manageable_connection(connection: Connection, current_user: User) -> None:
    """Raise 403 if the current user may not modify the given connection."""

    if can_manage_connection(current_user, connection):
        return

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")


def resolve_connection_scope_for_create(current_user: User, requested_scope: ConnectionScope) -> tuple[ConnectionScope, uuid.UUID | None]:
    """Resolve persisted scope/owner for a newly created connection."""

    if requested_scope == ConnectionScope.SHARED and user_has_capability(current_user, Capability.MANAGE_CONNECTIONS):
        return ConnectionScope.SHARED, None
    return ConnectionScope.PRIVATE, current_user.id


def resolve_connection_scope_for_update(
    current_user: User,
    existing_connection: Connection,
    requested_scope: ConnectionScope | None,
) -> tuple[ConnectionScope, uuid.UUID | None]:
    """Resolve persisted scope/owner after applying an update request."""

    if requested_scope is None or requested_scope == existing_connection.scope:
        return existing_connection.scope, existing_connection.owner_user_id

    if requested_scope == ConnectionScope.SHARED:
        if not user_has_capability(current_user, Capability.MANAGE_CONNECTIONS):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return ConnectionScope.SHARED, None

    return ConnectionScope.PRIVATE, current_user.id


def build_connection_read(connection: Connection, current_user: User) -> ConnectionRead:
    """Shape a connection response with per-user management metadata."""

    return ConnectionRead(
        id=connection.id,
        name=connection.name,
        slug=connection.slug,
        type=connection.type,
        host=connection.host,
        port=connection.port,
        share_name=connection.share_name,
        username=connection.username,
        path_prefix=connection.path_prefix,
        scope=connection.scope,
        access_mode=connection.access_mode,
        can_manage=can_manage_connection(current_user, connection),
        created_at=connection.created_at,
        updated_at=connection.updated_at,
    )
