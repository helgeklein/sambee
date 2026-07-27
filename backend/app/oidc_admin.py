import argparse
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from sqlmodel import Session

from app.db.database import engine
from app.models.oidc import OidcProviderConfiguration
from app.services.oidc_recovery import (
    OidcRecoveryError,
    activate_password_only,
    count_active_local_password_administrators,
    count_active_passwordless_users,
    export_audit_events,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Emergency OIDC administration")
    commands = parser.add_subparsers(dest="command", required=True)
    set_mode = commands.add_parser("set-mode", help="Change the authentication mode for emergency recovery")
    set_mode.add_argument("mode", choices=("password-only",))
    set_mode.add_argument("--force", action="store_true", help="Proceed without a usable local administrator")
    export = commands.add_parser("export-audit", help="Export OIDC audit events as JSON Lines")
    export.add_argument("--output", type=Path)
    return parser


def activate_password_only_interactively(
    session: Session,
    *,
    force: bool,
    read_confirmation: Callable[[str], str] = input,
) -> None:
    configuration = session.get(OidcProviderConfiguration, 1)
    if configuration is None:
        raise OidcRecoveryError("Database authentication configuration was not found")
    local_administrator_count = count_active_local_password_administrators(session)
    passwordless_count = count_active_passwordless_users(session)
    print(f"Active local-password administrators: {local_administrator_count}")
    print(f"Active passwordless accounts that will lose access: {passwordless_count}")
    if local_administrator_count == 0:
        if not force:
            raise OidcRecoveryError("No usable local-password administrator exists; rerun with --force for deliberate containment")
        print("WARNING: Password-only mode will leave no usable administrator.")
    elif force:
        raise OidcRecoveryError("--force is permitted only when no usable local-password administrator exists")
    if read_confirmation("Type 'password-only' to confirm: ").strip() != "password-only":
        raise OidcRecoveryError("Password-only activation was not confirmed")
    activate_password_only(
        session,
        expected_configuration_revision=configuration.configuration_revision,
        expected_active_passwordless_user_count=passwordless_count,
        expected_local_password_administrator_count=local_administrator_count,
        acknowledge_passwordless_account_loss=passwordless_count > 0,
        force_no_local_administrator=force,
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        with Session(engine) as session:
            if args.command == "set-mode":
                activate_password_only_interactively(session, force=args.force)
                print("Password-only authentication is active; all sessions were revoked.")
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
