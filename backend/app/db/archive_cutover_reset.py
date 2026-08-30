"""Explicitly discard legacy archive state before the Archive V2 cutover."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from app.db.archive_cutover_preflight import ARCHIVE_OPERATION_TABLE, preflight_result

RESET_CONFIRMATION_FLAG = "--confirm-discard-legacy-archive-state"


def _legacy_archive_where_clause(engine: Engine) -> str | None:
    """Return the legacy-row predicate, or None when no archive table exists."""

    inspector = inspect(engine)
    if not inspector.has_table(ARCHIVE_OPERATION_TABLE):
        return None
    column_names = {column["name"] for column in inspector.get_columns(ARCHIVE_OPERATION_TABLE)}
    return "" if "contract_version" not in column_names else " WHERE contract_version IS NULL OR contract_version != 'V2'"


def discard_legacy_archive_operations(engine: Engine) -> int:
    """Delete only archive operations that cannot cross the V2 contract boundary."""

    where_clause = _legacy_archive_where_clause(engine)
    if where_clause is None:
        return 0
    with engine.begin() as connection:
        result = connection.execute(text(f"DELETE FROM {ARCHIVE_OPERATION_TABLE}{where_clause}"))
    return max(result.rowcount, 0)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Discard legacy archive operations before the Archive V2 cutover")
    parser.add_argument(
        RESET_CONFIRMATION_FLAG,
        action="store_true",
        help="Discard the archive operations listed by the V2 preflight",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Require explicit confirmation before discarding legacy archive operations."""

    args = _parser().parse_args(argv)
    from app.db.database import engine

    try:
        before = preflight_result(engine)
        if before["ready"]:
            print(json.dumps({**before, "discarded_legacy_operations": 0}, sort_keys=True))
            return 0
        if not args.confirm_discard_legacy_archive_state:
            print(json.dumps({**before, "discarded_legacy_operations": 0}, sort_keys=True))
            print(
                f"Archive V2 cutover reset is dry-run only; rerun with {RESET_CONFIRMATION_FLAG} to discard the listed operations",
                file=sys.stderr,
            )
            return 2

        discarded_operation_count = discard_legacy_archive_operations(engine)
        after = preflight_result(engine)
        if not after["ready"]:
            print(json.dumps(after, sort_keys=True))
            print("Archive V2 cutover reset could not clear all legacy archive operations", file=sys.stderr)
            return 1
        print(json.dumps({**after, "discarded_legacy_operations": discarded_operation_count}, sort_keys=True))
        return 0
    except SQLAlchemyError as error:
        print(f"Archive V2 cutover reset failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
