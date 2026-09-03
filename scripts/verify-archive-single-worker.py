#!/usr/bin/env python3
"""Verify that the production image preserves process-local archive ownership."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PRODUCTION_COMMAND_PATTERN = re.compile(r"^CMD\s+\[(?P<command>.+)\]$", re.MULTILINE)


def verify_single_worker_command(dockerfile_path: Path) -> None:
    try:
        dockerfile = dockerfile_path.read_text(encoding="utf-8")
    except OSError as error:
        raise ValueError(f"Unable to read {dockerfile_path}: {error}") from error
    commands = PRODUCTION_COMMAND_PATTERN.findall(dockerfile)
    if not commands:
        raise ValueError("Dockerfile must define a production CMD.")
    if not re.search(r"\buvicorn\b.*\s--workers\s+1(?:\s|$)", commands[-1]):
        raise ValueError(
            "Production Uvicorn CMD must explicitly set --workers 1 for live archive source sessions."
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify the production archive live-session worker contract."
    )
    parser.add_argument("dockerfile", nargs="?", type=Path, default=Path("Dockerfile"))
    arguments = parser.parse_args()
    try:
        verify_single_worker_command(arguments.dockerfile)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
