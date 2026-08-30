"""Read-only deployment preflight for the Archive V2 breaking cutover."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

ARCHIVE_OPERATION_TABLE = "archive_operations"
LEGACY_OPERATION_FIELDS = ("id", "user_id", "kind", "phase", "created_at", "updated_at")


@dataclass(frozen=True)
class ArchiveOperationPreflight:
    """Safe metadata sufficient for an operator to identify archive state to reset."""

    id: str | None
    user_id: str | None
    kind: str | None
    phase: str | None
    created_at: str | None
    updated_at: str | None


def legacy_archive_operations(engine: Engine) -> list[ArchiveOperationPreflight]:
    """List archive rows that cannot be retained across the V2 cutover."""

    inspector = inspect(engine)
    if not inspector.has_table(ARCHIVE_OPERATION_TABLE):
        return []
    columns = {column["name"] for column in inspector.get_columns(ARCHIVE_OPERATION_TABLE)}
    fields = tuple(field for field in LEGACY_OPERATION_FIELDS if field in columns)
    if not fields:
        return [ArchiveOperationPreflight(None, None, None, None, None, None)]
    select_fields = ", ".join(fields)
    where = "" if "contract_version" not in columns else " WHERE contract_version IS NULL OR contract_version != 'V2'"
    with engine.connect() as connection:
        rows = connection.execute(text(f"SELECT {select_fields} FROM {ARCHIVE_OPERATION_TABLE}{where}")).mappings().all()
    return [
        ArchiveOperationPreflight(
            **{field: str(row[field]) if field in row and row[field] is not None else None for field in LEGACY_OPERATION_FIELDS}
        )
        for row in rows
    ]


def preflight_result(engine: Engine) -> dict[str, object]:
    """Return a stable operator-facing V2 readiness result without mutating the database."""

    legacy_operations = legacy_archive_operations(engine)
    return {
        "archive_contract_version": "v2",
        "ready": not legacy_operations,
        "legacy_operations": [asdict(operation) for operation in legacy_operations],
    }


def main() -> None:
    """Print cutover readiness and fail deployment when legacy archive state exists."""

    from app.db.database import engine

    result = preflight_result(engine)
    print(json.dumps(result, sort_keys=True))
    if not result["ready"]:
        raise SystemExit("Archive V2 cutover is blocked: explicitly reset or discard the listed archive operations before migrating")


if __name__ == "__main__":
    main()
