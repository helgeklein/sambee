from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection, Engine

from app.core.logging import get_logger
from app.models.connection import generate_unique_connection_slug

logger = get_logger(__name__)

MIGRATION_TABLE_NAME = "schema_migration"


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    apply: Callable[[Connection], None]


def _ensure_migration_table(connection: Connection) -> None:
    connection.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {MIGRATION_TABLE_NAME} (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )


def _get_applied_versions(connection: Connection) -> set[int]:
    _ensure_migration_table(connection)
    rows = connection.execute(text(f"SELECT version FROM {MIGRATION_TABLE_NAME}")).scalars().all()
    return {int(version) for version in rows}


def _record_migration(connection: Connection, migration: Migration) -> None:
    connection.execute(
        text(f"INSERT INTO {MIGRATION_TABLE_NAME} (version, name) VALUES (:version, :name)"),
        {"version": migration.version, "name": migration.name},
    )


def _apply_connection_slug_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("connection"):
        return

    connection_columns = {column["name"] for column in inspector.get_columns("connection")}
    if "slug" not in connection_columns:
        connection.execute(text("ALTER TABLE connection ADD COLUMN slug VARCHAR"))

    rows = connection.execute(text("SELECT id, name, slug FROM connection ORDER BY created_at, id")).mappings().all()
    existing_slugs: set[str] = set()

    for row in rows:
        row_slug = row["slug"]
        if row_slug:
            existing_slugs.add(str(row_slug))

    for row in rows:
        if row["slug"]:
            continue

        next_slug = generate_unique_connection_slug(str(row["name"]), existing_slugs)
        connection.execute(
            text("UPDATE connection SET slug = :slug WHERE id = :connection_id"),
            {"slug": next_slug, "connection_id": row["id"]},
        )
        existing_slugs.add(next_slug)

    connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_connection_slug ON connection (slug)"))


def _apply_user_role_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("user"):
        return

    user_columns = {column["name"] for column in inspector.get_columns("user")}

    if "role" not in user_columns:
        connection.execute(text('ALTER TABLE "user" ADD COLUMN role VARCHAR DEFAULT "editor"'))
        user_columns.add("role")

    if "is_active" not in user_columns:
        connection.execute(text('ALTER TABLE "user" ADD COLUMN is_active BOOLEAN DEFAULT 1'))
        user_columns.add("is_active")

    if "must_change_password" not in user_columns:
        connection.execute(text('ALTER TABLE "user" ADD COLUMN must_change_password BOOLEAN DEFAULT 0'))
        user_columns.add("must_change_password")

    if "token_version" not in user_columns:
        connection.execute(text('ALTER TABLE "user" ADD COLUMN token_version INTEGER DEFAULT 0'))
        user_columns.add("token_version")

    if "updated_at" not in user_columns:
        connection.execute(text('ALTER TABLE "user" ADD COLUMN updated_at TIMESTAMP'))
        user_columns.add("updated_at")

    connection.execute(text('UPDATE "user" SET role = COALESCE(role, "editor")'))
    connection.execute(text('UPDATE "user" SET is_active = COALESCE(is_active, 1)'))
    connection.execute(text('UPDATE "user" SET must_change_password = COALESCE(must_change_password, 0)'))
    connection.execute(text('UPDATE "user" SET token_version = COALESCE(token_version, 0)'))
    connection.execute(text('UPDATE "user" SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)'))
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_user_role ON "user" (role)'))
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_user_is_active ON "user" (is_active)'))


def _apply_connection_scope_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("connection"):
        return

    connection_columns = {column["name"] for column in inspector.get_columns("connection")}

    if "scope" not in connection_columns:
        connection.execute(text("ALTER TABLE connection ADD COLUMN scope VARCHAR DEFAULT 'shared'"))
        connection_columns.add("scope")

    if "owner_user_id" not in connection_columns:
        connection.execute(text("ALTER TABLE connection ADD COLUMN owner_user_id CHAR(32)"))
        connection_columns.add("owner_user_id")

    connection.execute(text("UPDATE connection SET scope = COALESCE(scope, 'shared')"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_connection_scope ON connection (scope)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_connection_owner_user_id ON connection (owner_user_id)"))


def _apply_system_settings_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if inspector.has_table("systemsetting"):
        return

    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS systemsetting (
                key VARCHAR PRIMARY KEY,
                value VARCHAR NOT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_by_user_id CHAR(32)
            )
            """
        )
    )
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_systemsetting_updated_by_user_id ON systemsetting (updated_by_user_id)"))


def _apply_user_settings_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if inspector.has_table("usersetting"):
        return

    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS usersetting (
                user_id CHAR(32) NOT NULL,
                key VARCHAR NOT NULL,
                value VARCHAR NOT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, key),
                FOREIGN KEY(user_id) REFERENCES user (id)
            )
            """
        )
    )
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_usersetting_user_id ON usersetting (user_id)"))


def _apply_connection_access_mode_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("connection"):
        return

    connection_columns = {column["name"] for column in inspector.get_columns("connection")}

    if "access_mode" not in connection_columns:
        connection.execute(text("ALTER TABLE connection ADD COLUMN access_mode VARCHAR DEFAULT 'read_write'"))

    connection.execute(text("UPDATE connection SET access_mode = COALESCE(access_mode, 'read_write')"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_connection_access_mode ON connection (access_mode)"))


def _apply_user_identity_and_role_refresh_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("user"):
        return

    user_columns = {column["name"] for column in inspector.get_columns("user")}

    if "name" not in user_columns:
        connection.execute(text('ALTER TABLE "user" ADD COLUMN name VARCHAR'))

    if "email" not in user_columns:
        connection.execute(text('ALTER TABLE "user" ADD COLUMN email VARCHAR'))

    if "expires_at" not in user_columns:
        connection.execute(text('ALTER TABLE "user" ADD COLUMN expires_at TIMESTAMP'))

    connection.execute(text('UPDATE "user" SET role = COALESCE(role, "editor")'))
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_user_email ON "user" (email)'))
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_user_expires_at ON "user" (expires_at)'))


MIGRATIONS: tuple[Migration, ...] = (
    Migration(version=1, name="ensure_connection_slugs", apply=_apply_connection_slug_migration),
    Migration(version=2, name="add_user_role_and_session_fields", apply=_apply_user_role_migration),
    Migration(version=3, name="add_connection_scope_and_ownership", apply=_apply_connection_scope_migration),
    Migration(version=4, name="add_system_settings_table", apply=_apply_system_settings_migration),
    Migration(version=5, name="add_user_settings_table", apply=_apply_user_settings_migration),
    Migration(version=6, name="add_connection_access_mode", apply=_apply_connection_access_mode_migration),
    Migration(version=7, name="refresh_user_identity_and_roles", apply=_apply_user_identity_and_role_refresh_migration),
)


def run_migrations(engine: Engine) -> None:
    with engine.begin() as connection:
        applied_versions = _get_applied_versions(connection)

        for migration in MIGRATIONS:
            if migration.version in applied_versions:
                continue

            logger.info(f"Applying schema migration {migration.version}: {migration.name}")
            migration.apply(connection)
            _record_migration(connection, migration)
            logger.info(f"Applied schema migration {migration.version}: {migration.name}")
