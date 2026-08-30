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


def _apply_companion_uri_token_jti_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if inspector.has_table("companion_uri_token_jti"):
        return

    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS companion_uri_token_jti (
                jti VARCHAR PRIMARY KEY,
                user_id CHAR(32),
                connection_id CHAR(32),
                path VARCHAR NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                consumed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_companion_uri_token_jti_user_id ON companion_uri_token_jti (user_id)"))
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_companion_uri_token_jti_connection_id ON companion_uri_token_jti (connection_id)")
    )
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_companion_uri_token_jti_path ON companion_uri_token_jti (path)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_companion_uri_token_jti_expires_at ON companion_uri_token_jti (expires_at)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_companion_uri_token_jti_consumed_at ON companion_uri_token_jti (consumed_at)"))


def _apply_edit_lock_capability_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("edit_locks"):
        return

    lock_columns = {column["name"] for column in inspector.get_columns("edit_locks")}

    if "lock_capability" not in lock_columns:
        connection.execute(text("ALTER TABLE edit_locks ADD COLUMN lock_capability VARCHAR DEFAULT ''"))

    connection.execute(text("UPDATE edit_locks SET lock_capability = COALESCE(lock_capability, '')"))

    if "companion_session" in lock_columns:
        # Remove persisted bearer material from legacy locks during the cutover.
        connection.execute(text("UPDATE edit_locks SET companion_session = '' WHERE companion_session IS NOT NULL"))

    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_edit_locks_lock_capability ON edit_locks (lock_capability)"))


def _apply_edit_lock_operation_id_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("edit_locks"):
        return

    lock_columns = {column["name"] for column in inspector.get_columns("edit_locks")}

    if "operation_id" not in lock_columns:
        connection.execute(text("ALTER TABLE edit_locks ADD COLUMN operation_id VARCHAR DEFAULT ''"))

    connection.execute(text("UPDATE edit_locks SET operation_id = COALESCE(operation_id, '')"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_edit_locks_operation_id ON edit_locks (operation_id)"))


def _apply_edit_lock_companion_session_drop_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("edit_locks"):
        return

    lock_columns = {column["name"] for column in inspector.get_columns("edit_locks")}
    if "companion_session" not in lock_columns:
        return

    connection.execute(text("DROP TABLE IF EXISTS edit_locks__cutover"))
    connection.execute(
        text(
            """
            CREATE TABLE edit_locks__cutover (
                id CHAR(32) NOT NULL,
                file_path VARCHAR NOT NULL,
                connection_id CHAR(32) NOT NULL,
                locked_by VARCHAR NOT NULL,
                operation_id VARCHAR NOT NULL DEFAULT '',
                locked_at DATETIME NOT NULL,
                lock_capability VARCHAR NOT NULL DEFAULT '',
                last_heartbeat DATETIME NOT NULL,
                PRIMARY KEY (id)
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT INTO edit_locks__cutover (
                id,
                file_path,
                connection_id,
                locked_by,
                operation_id,
                locked_at,
                lock_capability,
                last_heartbeat
            )
            SELECT
                id,
                file_path,
                connection_id,
                locked_by,
                operation_id,
                locked_at,
                lock_capability,
                last_heartbeat
            FROM edit_locks
            """
        )
    )
    connection.execute(text("DROP TABLE edit_locks"))
    connection.execute(text("ALTER TABLE edit_locks__cutover RENAME TO edit_locks"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_edit_locks_file_path ON edit_locks (file_path)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_edit_locks_connection_id ON edit_locks (connection_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_edit_locks_locked_by ON edit_locks (locked_by)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_edit_locks_operation_id ON edit_locks (operation_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_edit_locks_lock_capability ON edit_locks (lock_capability)"))


def _apply_edit_lock_target_uniqueness_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("edit_locks"):
        return

    index_name = "uq_edit_locks_connection_path"
    if any(index["name"] == index_name for index in inspector.get_indexes("edit_locks")):
        return

    rows = connection.execute(
        text(
            """
            SELECT id, connection_id, file_path
            FROM edit_locks
            ORDER BY connection_id, file_path, last_heartbeat DESC, locked_at DESC, id DESC
            """
        )
    ).mappings()
    seen_targets: set[tuple[str, str]] = set()
    duplicate_ids: list[str] = []
    for row in rows:
        target = (str(row["connection_id"]), str(row["file_path"]))
        if target in seen_targets:
            duplicate_ids.append(str(row["id"]))
        else:
            seen_targets.add(target)

    if duplicate_ids:
        connection.execute(text("DELETE FROM edit_locks WHERE id = :id"), [{"id": lock_id} for lock_id in duplicate_ids])

    connection.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON edit_locks (connection_id, file_path)"))


def _apply_nullable_user_password_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("user"):
        return

    password_column = next(
        (column for column in inspector.get_columns("user") if column["name"] == "password_hash"),
        None,
    )
    if password_column is None or password_column["nullable"]:
        return

    connection.execute(text('DROP TABLE IF EXISTS "user__nullable_password"'))
    connection.execute(
        text(
            """
            CREATE TABLE "user__nullable_password" (
                id CHAR(32) NOT NULL,
                username VARCHAR NOT NULL,
                name VARCHAR,
                email VARCHAR,
                password_hash VARCHAR,
                role VARCHAR NOT NULL DEFAULT 'editor',
                is_active BOOLEAN NOT NULL DEFAULT 1,
                must_change_password BOOLEAN NOT NULL DEFAULT 0,
                token_version INTEGER NOT NULL DEFAULT 0,
                expires_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL,
                PRIMARY KEY (id)
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT INTO "user__nullable_password" (
                id, username, name, email, password_hash, role, is_active,
                must_change_password, token_version, expires_at, created_at, updated_at
            )
            SELECT
                id, username, name, email, password_hash, role, is_active,
                must_change_password, token_version, expires_at, created_at, updated_at
            FROM "user"
            """
        )
    )
    connection.execute(text('DROP TABLE "user"'))
    connection.execute(text('ALTER TABLE "user__nullable_password" RENAME TO "user"'))
    connection.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS ix_user_username ON "user" (username)'))
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_user_email ON "user" (email)'))
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_user_role ON "user" (role)'))
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_user_is_active ON "user" (is_active)'))
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_user_expires_at ON "user" (expires_at)'))


def _apply_oidc_schema_migration(connection: Connection) -> None:
    from sqlmodel import SQLModel

    from app.models.audit import AuditEvent  # noqa: F401 - Registers metadata
    from app.models.oidc import (  # noqa: F401 - Registers metadata
        OidcBrowserSession,
        OidcFlow,
        OidcIdentity,
        OidcPendingIdentityMapping,
        OidcProviderConfiguration,
    )

    table_names = (
        "oidcproviderconfiguration",
        "oidcidentity",
        "oidcpendingidentitymapping",
        "oidcflow",
        "auditevent",
    )
    for table_name in table_names:
        SQLModel.metadata.tables[table_name].create(bind=connection, checkfirst=True)


def _apply_oidc_browser_session_migration(connection: Connection) -> None:
    from sqlmodel import SQLModel

    from app.models.oidc import OidcBrowserSession  # noqa: F401 - Registers metadata

    SQLModel.metadata.tables["oidcbrowsersession"].create(bind=connection, checkfirst=True)


def _apply_oidc_browser_session_fields_migration(connection: Connection) -> None:
    if inspect(connection).has_table("oidcproviderconfiguration"):
        configuration_columns = {column[1] for column in connection.execute(text("PRAGMA table_info('oidcproviderconfiguration')"))}
        if "interactive_reauthentication_max_age_days" not in configuration_columns:
            connection.execute(
                text(
                    "ALTER TABLE oidcproviderconfiguration ADD COLUMN interactive_reauthentication_max_age_days INTEGER NOT NULL DEFAULT 30"
                )
            )

    if not inspect(connection).has_table("oidcbrowsersession"):
        return
    session_columns = {column[1] for column in connection.execute(text("PRAGMA table_info('oidcbrowsersession')"))}
    additions = (
        ("user_token_version", "INTEGER NOT NULL DEFAULT 0"),
        ("configuration_revision", "INTEGER NOT NULL DEFAULT 0"),
        ("identity_mapping_revision", "INTEGER NOT NULL DEFAULT 0"),
        ("pending_expires_at", "DATETIME"),
    )
    for column_name, definition in additions:
        if column_name not in session_columns:
            connection.execute(text(f"ALTER TABLE oidcbrowsersession ADD COLUMN {column_name} {definition}"))

    if not inspect(connection).has_table("oidcflow"):
        return
    flow_columns = {column[1] for column in connection.execute(text("PRAGMA table_info('oidcflow')"))}
    if "oidc_browser_session_id" not in flow_columns:
        connection.execute(text("ALTER TABLE oidcflow ADD COLUMN oidc_browser_session_id CHAR(32)"))
    if "encrypted_browser_session_secret" not in flow_columns:
        connection.execute(text("ALTER TABLE oidcflow ADD COLUMN encrypted_browser_session_secret VARCHAR"))


def _apply_oidc_reauthentication_receipt_migration(connection: Connection) -> None:
    columns = {column[1] for column in connection.execute(text("PRAGMA table_info('oidcflow')"))}
    if "finalized_reauthentication_required" not in columns:
        connection.execute(text("ALTER TABLE oidcflow ADD COLUMN finalized_reauthentication_required BOOLEAN"))


def _apply_oidc_forced_reauthentication_migration(connection: Connection) -> None:
    if not inspect(connection).has_table("oidcflow"):
        return
    columns = {column[1] for column in connection.execute(text("PRAGMA table_info('oidcflow')"))}
    if "interactive_reauthentication_required" not in columns:
        connection.execute(text("ALTER TABLE oidcflow ADD COLUMN interactive_reauthentication_required BOOLEAN NOT NULL DEFAULT 0"))


def _apply_oidc_session_validation_revision_migration(connection: Connection) -> None:
    if not inspect(connection).has_table("oidcproviderconfiguration"):
        return
    columns = {column[1] for column in connection.execute(text("PRAGMA table_info('oidcproviderconfiguration')"))}
    if "session_validation_revision" in columns:
        return
    connection.execute(text("ALTER TABLE oidcproviderconfiguration ADD COLUMN session_validation_revision INTEGER NOT NULL DEFAULT 0"))
    if "configuration_revision" not in columns:
        return
    connection.execute(
        text(
            "UPDATE oidcproviderconfiguration "
            "SET session_validation_revision = configuration_revision "
            "WHERE session_validation_revision = 0"
        )
    )


def _apply_oidc_session_cipher_keyring_migration(connection: Connection) -> None:
    from sqlmodel import SQLModel

    from app.models.oidc import OidcSessionCipherKey  # noqa: F401 - Registers metadata

    SQLModel.metadata.tables["oidcsessioncipherkey"].create(bind=connection, checkfirst=True)


def _apply_oidc_browser_session_client_metadata_migration(connection: Connection) -> None:
    if not inspect(connection).has_table("oidcbrowsersession"):
        return
    session_columns = {column[1] for column in connection.execute(text("PRAGMA table_info('oidcbrowsersession')"))}
    additions = (
        ("browser_name", "VARCHAR"),
        ("operating_system", "VARCHAR"),
    )
    for column_name, definition in additions:
        if column_name not in session_columns:
            connection.execute(text(f"ALTER TABLE oidcbrowsersession ADD COLUMN {column_name} {definition}"))


def _apply_nullable_oidc_mapping_creator_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("oidcpendingidentitymapping"):
        return
    creator_column = next(
        (column for column in inspector.get_columns("oidcpendingidentitymapping") if column["name"] == "created_by_user_id"),
        None,
    )
    if creator_column is None or creator_column["nullable"]:
        return

    connection.execute(text("DROP TABLE IF EXISTS oidcpendingidentitymapping__nullable_creator"))
    connection.execute(
        text(
            """
            CREATE TABLE oidcpendingidentitymapping__nullable_creator (
                id CHAR(32) NOT NULL,
                provider_configuration_id INTEGER NOT NULL,
                expected_username VARCHAR NOT NULL,
                target_user_id CHAR(32) NOT NULL,
                created_by_user_id CHAR(32),
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                CONSTRAINT uq_oidc_pending_provider_username UNIQUE (provider_configuration_id, expected_username),
                CONSTRAINT uq_oidc_pending_provider_target UNIQUE (provider_configuration_id, target_user_id),
                FOREIGN KEY(provider_configuration_id) REFERENCES oidcproviderconfiguration (id),
                FOREIGN KEY(target_user_id) REFERENCES "user" (id),
                FOREIGN KEY(created_by_user_id) REFERENCES "user" (id)
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT INTO oidcpendingidentitymapping__nullable_creator (
                id, provider_configuration_id, expected_username, target_user_id,
                created_by_user_id, created_at, updated_at
            )
            SELECT
                id, provider_configuration_id, expected_username, target_user_id,
                created_by_user_id, created_at, updated_at
            FROM oidcpendingidentitymapping
            """
        )
    )
    connection.execute(text("DROP TABLE oidcpendingidentitymapping"))
    connection.execute(text("ALTER TABLE oidcpendingidentitymapping__nullable_creator RENAME TO oidcpendingidentitymapping"))
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_oidcpendingidentitymapping_provider_configuration_id "
            "ON oidcpendingidentitymapping (provider_configuration_id)"
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_oidcpendingidentitymapping_target_user_id ON oidcpendingidentitymapping (target_user_id)")
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_oidcpendingidentitymapping_created_by_user_id ON oidcpendingidentitymapping (created_by_user_id)"
        )
    )


def _apply_oidc_individual_role_assignment_migration(connection: Connection) -> None:
    if not inspect(connection).has_table("user"):
        return
    columns = {column[1] for column in connection.execute(text("PRAGMA table_info('user')"))}
    if "oidc_role_assignment" not in columns:
        connection.execute(text('ALTER TABLE "user" ADD COLUMN oidc_role_assignment VARCHAR'))


def _apply_oidc_role_assignment_mode_migration(connection: Connection) -> None:
    if not inspect(connection).has_table("oidcproviderconfiguration"):
        return
    columns = {column[1] for column in connection.execute(text("PRAGMA table_info('oidcproviderconfiguration')"))}
    if "role_assignment_mode" not in columns:
        connection.execute(text("ALTER TABLE oidcproviderconfiguration ADD COLUMN role_assignment_mode VARCHAR NOT NULL DEFAULT 'uniform'"))
    if "uniform_role" not in columns:
        connection.execute(text("ALTER TABLE oidcproviderconfiguration ADD COLUMN uniform_role VARCHAR NOT NULL DEFAULT 'editor'"))


def _apply_oidc_identity_group_history_migration(connection: Connection) -> None:
    if not inspect(connection).has_table("oidcidentity"):
        return
    columns = {column[1] for column in connection.execute(text("PRAGMA table_info('oidcidentity')"))}
    if "last_groups_json" not in columns:
        connection.execute(text("ALTER TABLE oidcidentity ADD COLUMN last_groups_json VARCHAR NOT NULL DEFAULT '[]'"))


def _apply_oidc_auto_link_by_username_migration(connection: Connection) -> None:
    if not inspect(connection).has_table("oidcproviderconfiguration"):
        return
    columns = {column[1] for column in connection.execute(text("PRAGMA table_info('oidcproviderconfiguration')"))}
    if "auto_link_by_username" not in columns:
        connection.execute(text("ALTER TABLE oidcproviderconfiguration ADD COLUMN auto_link_by_username BOOLEAN NOT NULL DEFAULT 1"))


def _apply_recent_files_migration(connection: Connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS recentfile (
                id CHAR(32) PRIMARY KEY NOT NULL,
                user_id CHAR(32) NOT NULL,
                connection_id VARCHAR(256) NOT NULL,
                path VARCHAR(4096) NOT NULL,
                file_name VARCHAR(1024) NOT NULL,
                last_opened_at DATETIME NOT NULL,
                created_at DATETIME NOT NULL,
                CONSTRAINT uq_recentfile_user_connection_path UNIQUE (user_id, connection_id, path),
                FOREIGN KEY(user_id) REFERENCES user (id)
            )
            """
        )
    )
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_recentfile_user_id ON recentfile (user_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_recentfile_connection_id ON recentfile (connection_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_recentfile_last_opened_at ON recentfile (last_opened_at)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_recentfile_user_last_opened ON recentfile (user_id, last_opened_at)"))


def _apply_recent_directories_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if inspector.has_table("recentdirectory"):
        return

    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS recentdirectory (
                id CHAR(32) NOT NULL PRIMARY KEY,
                user_id CHAR(32) NOT NULL,
                connection_id VARCHAR(256) NOT NULL,
                path VARCHAR(4096) NOT NULL,
                last_visited_at DATETIME NOT NULL,
                created_at DATETIME NOT NULL,
                CONSTRAINT uq_recentdirectory_user_connection_path UNIQUE (user_id, connection_id, path),
                FOREIGN KEY(user_id) REFERENCES user (id)
            )
            """
        )
    )
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_recentdirectory_user_id ON recentdirectory (user_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_recentdirectory_connection_id ON recentdirectory (connection_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_recentdirectory_last_visited_at ON recentdirectory (last_visited_at)"))
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_recentdirectory_user_last_visited ON recentdirectory (user_id, last_visited_at)")
    )


def _apply_archive_operations_migration(connection: Connection) -> None:
    inspector = inspect(connection)
    if inspector.has_table("archive_operations"):
        return
    connection.execute(
        text(
            """
            CREATE TABLE archive_operations (
                id CHAR(32) NOT NULL PRIMARY KEY,
                user_id CHAR(32) NOT NULL,
                contract_version VARCHAR(8) NOT NULL DEFAULT 'V2'
                    CONSTRAINT ck_archive_operations_contract_version_v2 CHECK (contract_version = 'V2'),
                kind VARCHAR(32) NOT NULL,
                phase VARCHAR(64) NOT NULL,
                source_connection_id VARCHAR(256) NOT NULL,
                source_path VARCHAR(4096) NOT NULL,
                destination_connection_id VARCHAR(256) NOT NULL,
                destination_path VARCHAR(4096) NOT NULL,
                manifest_hash VARCHAR(128) NOT NULL,
                plan_json TEXT NOT NULL,
                checkpoint_json TEXT NOT NULL,
                pending_decision_json TEXT,
                collision_policy VARCHAR(64),
                cancellation_requested BOOLEAN NOT NULL DEFAULT 0,
                last_error_json TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                heartbeat_at DATETIME NOT NULL,
                FOREIGN KEY(user_id) REFERENCES user (id)
            )
            """
        )
    )
    for column in (
        "user_id",
        "kind",
        "phase",
        "source_connection_id",
        "destination_connection_id",
        "manifest_hash",
        "cancellation_requested",
    ):
        connection.execute(text(f"CREATE INDEX IF NOT EXISTS ix_archive_operations_{column} ON archive_operations ({column})"))


def _apply_archive_operation_revision_migration(connection: Connection) -> None:
    """Add the optimistic-concurrency revision to existing archive operations."""

    inspector = inspect(connection)
    if not inspector.has_table("archive_operations"):
        return
    column_names = {column["name"] for column in inspector.get_columns("archive_operations")}
    if "revision" not in column_names:
        connection.execute(text("ALTER TABLE archive_operations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0"))


def _apply_archive_operation_contract_version_migration(connection: Connection) -> None:
    """Add V2 versioning only after legacy archive state was explicitly cleared."""

    inspector = inspect(connection)
    if not inspector.has_table("archive_operations"):
        return
    column_names = {column["name"] for column in inspector.get_columns("archive_operations")}
    if "contract_version" in column_names:
        return
    legacy_operation_count = connection.execute(text("SELECT COUNT(*) FROM archive_operations")).scalar_one()
    if legacy_operation_count:
        raise RuntimeError(
            "Archive V2 cutover requires an empty archive_operations table; "
            "explicitly reset legacy archive state before applying this migration"
        )
    connection.execute(
        text("ALTER TABLE archive_operations ADD COLUMN contract_version VARCHAR(8) NOT NULL DEFAULT 'V2' CHECK (contract_version = 'V2')")
    )
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_archive_operations_contract_version ON archive_operations (contract_version)"))


MIGRATIONS: tuple[Migration, ...] = (
    Migration(version=1, name="ensure_connection_slugs", apply=_apply_connection_slug_migration),
    Migration(version=2, name="add_user_role_and_session_fields", apply=_apply_user_role_migration),
    Migration(version=3, name="add_connection_scope_and_ownership", apply=_apply_connection_scope_migration),
    Migration(version=4, name="add_system_settings_table", apply=_apply_system_settings_migration),
    Migration(version=5, name="add_user_settings_table", apply=_apply_user_settings_migration),
    Migration(version=6, name="add_connection_access_mode", apply=_apply_connection_access_mode_migration),
    Migration(version=7, name="refresh_user_identity_and_roles", apply=_apply_user_identity_and_role_refresh_migration),
    Migration(version=8, name="add_companion_uri_token_jti_registry", apply=_apply_companion_uri_token_jti_migration),
    Migration(version=9, name="add_edit_lock_capability", apply=_apply_edit_lock_capability_migration),
    Migration(version=10, name="add_edit_lock_operation_id", apply=_apply_edit_lock_operation_id_migration),
    Migration(version=11, name="drop_edit_lock_companion_session", apply=_apply_edit_lock_companion_session_drop_migration),
    Migration(version=12, name="allow_nullable_user_password", apply=_apply_nullable_user_password_migration),
    Migration(version=13, name="add_oidc_and_audit_schema", apply=_apply_oidc_schema_migration),
    Migration(version=14, name="add_oidc_reauthentication_receipt", apply=_apply_oidc_reauthentication_receipt_migration),
    Migration(version=15, name="allow_nullable_oidc_mapping_creator", apply=_apply_nullable_oidc_mapping_creator_migration),
    Migration(version=16, name="add_oidc_individual_role_assignment", apply=_apply_oidc_individual_role_assignment_migration),
    Migration(version=17, name="add_oidc_role_assignment_mode", apply=_apply_oidc_role_assignment_mode_migration),
    Migration(version=18, name="add_oidc_browser_sessions", apply=_apply_oidc_browser_session_migration),
    Migration(version=19, name="add_oidc_renewable_session_fields", apply=_apply_oidc_browser_session_fields_migration),
    Migration(version=20, name="add_oidc_forced_reauthentication", apply=_apply_oidc_forced_reauthentication_migration),
    Migration(version=21, name="add_oidc_session_validation_revision", apply=_apply_oidc_session_validation_revision_migration),
    Migration(version=22, name="add_oidc_session_cipher_keyring", apply=_apply_oidc_session_cipher_keyring_migration),
    Migration(version=23, name="add_oidc_browser_session_client_metadata", apply=_apply_oidc_browser_session_client_metadata_migration),
    Migration(version=24, name="add_oidc_identity_group_history", apply=_apply_oidc_identity_group_history_migration),
    Migration(version=25, name="add_oidc_auto_link_by_username", apply=_apply_oidc_auto_link_by_username_migration),
    Migration(version=26, name="add_recent_files", apply=_apply_recent_files_migration),
    Migration(version=27, name="add_recent_directories", apply=_apply_recent_directories_migration),
    Migration(version=28, name="add_archive_operations", apply=_apply_archive_operations_migration),
    Migration(version=29, name="enforce_unique_edit_lock_targets", apply=_apply_edit_lock_target_uniqueness_migration),
    Migration(version=30, name="add_archive_operation_revision", apply=_apply_archive_operation_revision_migration),
    Migration(version=31, name="add_archive_operation_contract_version", apply=_apply_archive_operation_contract_version_migration),
)


def run_migrations(engine: Engine) -> None:
    with engine.connect() as connection:
        applied_versions = _get_applied_versions(connection)
        connection.commit()

        for migration in MIGRATIONS:
            if migration.version in applied_versions:
                continue

            logger.info(f"Applying schema migration {migration.version}: {migration.name}")
            rebuilds_referenced_table = migration.version in {12, 15} and connection.dialect.name == "sqlite"
            if rebuilds_referenced_table:
                connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
                connection.commit()
            try:
                with connection.begin():
                    migration.apply(connection)
                    _record_migration(connection, migration)
                if rebuilds_referenced_table:
                    violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
                    connection.commit()
                    if violations:
                        raise RuntimeError(f"Foreign-key validation failed after schema migration {migration.version}")
            finally:
                if connection.in_transaction():
                    connection.rollback()
                if rebuilds_referenced_table:
                    connection.exec_driver_sql("PRAGMA foreign_keys=ON")
                    connection.commit()
            logger.info(f"Applied schema migration {migration.version}: {migration.name}")
