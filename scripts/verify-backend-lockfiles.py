#!/usr/bin/env python3
"""Validate direct backend dependency pins against hash-locked requirements."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIRECTORY = "backend"
RUNTIME_REQUIREMENTS_FILE = "requirements.txt"
DEVELOPMENT_REQUIREMENTS_FILE = "requirements-dev.txt"
RUNTIME_LOCKFILE = "requirements.lock.txt"
DEVELOPMENT_LOCKFILE = "requirements-dev.lock.txt"
SOURCE_REQUIREMENT_PATTERN = re.compile(
    r"^(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[A-Za-z0-9][A-Za-z0-9._,-]*\])?==(?P<version>[^\s;\\]+)$"
)
LOCK_REQUIREMENT_PATTERN = re.compile(
    r"^(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[A-Za-z0-9][A-Za-z0-9._,-]*\])?==(?P<version>[^\s\\]+)\s*(?:\\)?$"
)
HASH_PATTERN = re.compile(r"--hash=sha256:[0-9a-f]{64}", re.IGNORECASE)
NORMALIZE_NAME_PATTERN = re.compile(r"[-_.]+")


@dataclass(frozen=True)
class RequirementPin:
    name: str
    version: str
    source_path: Path


@dataclass
class LockEntry:
    name: str
    version: str
    line_number: int
    has_hash: bool = False


def canonicalize_name(name: str) -> str:
    """Return a PEP 503-compatible distribution name."""

    return NORMALIZE_NAME_PATTERN.sub("-", name).lower()


def parse_source_requirements(path: Path) -> dict[str, RequirementPin]:
    """Parse the restricted exact-pin format used by backend requirement sources."""

    pins: dict[str, RequirementPin] = {}
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        match = SOURCE_REQUIREMENT_PATTERN.fullmatch(line)
        if match is None:
            raise ValueError(
                f"{path}:{line_number}: unsupported source requirement {line!r}; "
                "use an exact name==version pin or extend the verifier deliberately"
            )

        name = canonicalize_name(match["name"])
        if name in pins:
            raise ValueError(
                f"{path}:{line_number}: duplicate direct requirement {name!r}"
            )
        pins[name] = RequirementPin(
            name=name, version=match["version"], source_path=path
        )

    return pins


def parse_lockfile(path: Path) -> dict[str, LockEntry]:
    """Parse pip-compile package entries and require a SHA-256 hash for each."""

    entries: dict[str, LockEntry] = {}
    current_entry: LockEntry | None = None

    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if raw_line[0].isspace():
            if current_entry is None:
                raise ValueError(
                    f"{path}:{line_number}: unexpected lockfile continuation"
                )
            if HASH_PATTERN.search(line):
                current_entry.has_hash = True
            continue

        if line.startswith("-"):
            current_entry = None
            continue

        match = LOCK_REQUIREMENT_PATTERN.fullmatch(line)
        if match is None:
            raise ValueError(
                f"{path}:{line_number}: unsupported lockfile entry {line!r}"
            )

        name = canonicalize_name(match["name"])
        if name in entries:
            raise ValueError(f"{path}:{line_number}: duplicate lockfile entry {name!r}")
        current_entry = LockEntry(
            name=name,
            version=match["version"],
            line_number=line_number,
        )
        entries[name] = current_entry

    if not entries:
        raise ValueError(f"{path}: contains no package entries")

    for entry in entries.values():
        if not entry.has_hash:
            raise ValueError(
                f"{path}:{entry.line_number}: {entry.name}=={entry.version} "
                "must include a SHA-256 hash"
            )

    return entries


def verify_pins(
    source_pins: dict[str, RequirementPin],
    lock_entries: dict[str, LockEntry],
    lockfile_path: Path,
) -> None:
    """Ensure every direct source pin is represented by the expected lock entry."""

    for name, pin in source_pins.items():
        lock_entry = lock_entries.get(name)
        if lock_entry is None:
            raise ValueError(
                f"{lockfile_path}: missing {name}=={pin.version} required by {pin.source_path}"
            )
        if lock_entry.version != pin.version:
            raise ValueError(
                f"{lockfile_path}:{lock_entry.line_number}: {name} is {lock_entry.version}; "
                f"{pin.source_path} requires {pin.version}"
            )


def verify_lockfiles(repository_root: Path) -> None:
    """Validate backend runtime and development source-to-lock relationships."""

    backend_directory = repository_root / BACKEND_DIRECTORY
    runtime_source_path = backend_directory / RUNTIME_REQUIREMENTS_FILE
    development_source_path = backend_directory / DEVELOPMENT_REQUIREMENTS_FILE
    runtime_lockfile_path = backend_directory / RUNTIME_LOCKFILE
    development_lockfile_path = backend_directory / DEVELOPMENT_LOCKFILE

    runtime_pins = parse_source_requirements(runtime_source_path)
    development_pins = parse_source_requirements(development_source_path)
    runtime_lock_entries = parse_lockfile(runtime_lockfile_path)
    development_lock_entries = parse_lockfile(development_lockfile_path)

    verify_pins(runtime_pins, runtime_lock_entries, runtime_lockfile_path)
    verify_pins(runtime_pins, development_lock_entries, development_lockfile_path)
    verify_pins(development_pins, development_lock_entries, development_lockfile_path)


def main() -> int:
    repository_root = Path(__file__).resolve().parents[1]
    try:
        verify_lockfiles(repository_root)
    except (OSError, ValueError) as error:
        print(f"Backend lockfile validation failed: {error}", file=sys.stderr)
        return 1
    print(
        "Backend lockfiles match the direct dependency pins and include SHA-256 hashes."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
