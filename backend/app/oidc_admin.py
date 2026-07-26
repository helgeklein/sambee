import argparse
import sys
from pathlib import Path
from typing import Sequence

from sqlmodel import Session

from app.core.config import settings
from app.db.database import engine
from app.services.oidc_recovery import (
    OidcRecoveryError,
    activate_password_only,
    export_audit_events,
    read_secret_file,
    rotate_oidc_secret_key,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Emergency OIDC administration")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("password-only", help="Activate Password-only mode and revoke all sessions")
    rotate = commands.add_parser("rotate-key", help="Re-encrypt the OIDC client secret and invalidate pending flows")
    rotate.add_argument("--new-key-file", type=Path, required=True)
    export = commands.add_parser("export-audit", help="Export OIDC audit events as JSON Lines")
    export.add_argument("--output", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        with Session(engine) as session:
            if args.command == "password-only":
                activate_password_only(session)
                print("Password-only authentication is active; all sessions were revoked.")
            elif args.command == "rotate-key":
                new_key = read_secret_file(args.new_key_file)
                rotate_oidc_secret_key(session, old_key=settings.oidc_secret_key, new_key=new_key)
                print("OIDC data was re-encrypted. Configure SAMBEE_OIDC_SECRET_KEY with the new key before restarting.")
            else:
                if args.output is None:
                    count = export_audit_events(session, sys.stdout)
                else:
                    with args.output.open("w", encoding="utf-8") as output:
                        count = export_audit_events(session, output)
                print(f"Exported {count} audit events.", file=sys.stderr)
        return 0
    except (OSError, OidcRecoveryError, ValueError) as error:
        print(f"OIDC administration failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
