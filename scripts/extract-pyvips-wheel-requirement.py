#!/usr/bin/env python3
"""Extract the hash-locked pyvips requirement for the wheel build stage."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

_REQUIREMENT_PATTERN = re.compile(r"^pyvips==[^\s\\]+(?: \\)?$")
_HASH_PATTERN = re.compile(r"^\s+--hash=sha256:[0-9a-f]{64}(?: \\)?$")


def extract_pyvips_requirement(lockfile: Path) -> str:
    lines = lockfile.read_text(encoding="utf-8").splitlines()
    requirements: list[str] = []

    for index, line in enumerate(lines):
        if not _REQUIREMENT_PATTERN.fullmatch(line):
            continue

        hashes: list[str] = []
        for hash_line in lines[index + 1 :]:
            if not _HASH_PATTERN.fullmatch(hash_line):
                break
            hashes.append(hash_line)
        if not hashes:
            raise ValueError("The pyvips lockfile entry must include a SHA-256 hash.")
        requirements.append("\n".join([line, *hashes]))

    if len(requirements) != 1:
        raise ValueError(
            f"Expected exactly one hash-locked pyvips requirement, found {len(requirements)}."
        )
    return f"{requirements[0]}\n"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract the pyvips requirement from a hashed lockfile."
    )
    parser.add_argument("lockfile", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    try:
        requirement = extract_pyvips_requirement(args.lockfile)
        args.output.write_text(requirement, encoding="utf-8")
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
