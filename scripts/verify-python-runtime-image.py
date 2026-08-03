#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PYTHON_BASE_IMAGE_DECLARATION_PATTERN = re.compile(
    r"^ARG PYTHON_BASE_IMAGE=(?P<image>\S+)$", re.MULTILINE
)
PYTHON_BASE_IMAGE_FROM_PATTERN = re.compile(
    r"^FROM(?:\s+--platform=\$BUILDPLATFORM)?\s+\$\{PYTHON_BASE_IMAGE\}\s+AS\s+\S+\s*$",
    re.MULTILINE,
)
PYTHON_IMAGE_PATTERN = re.compile(
    r"^python:(?P<version>\d+\.\d+\.\d+)-slim@sha256:[0-9a-f]{64}$"
)
EXPECTED_PYTHON_STAGE_COUNT = 2


def read_python_runtime_image(dockerfile_path: Path) -> str:
    try:
        dockerfile = dockerfile_path.read_text(encoding="utf-8")
    except OSError as error:
        raise ValueError(f"Unable to read {dockerfile_path}: {error}") from error

    declarations = PYTHON_BASE_IMAGE_DECLARATION_PATTERN.findall(dockerfile)
    if len(declarations) != 1:
        raise ValueError(
            "Dockerfile must declare PYTHON_BASE_IMAGE exactly once before Python stages."
        )

    python_image = declarations[0]
    if not PYTHON_IMAGE_PATTERN.fullmatch(python_image):
        raise ValueError(
            "PYTHON_BASE_IMAGE must be a pinned python:<major>.<minor>.<patch>-slim "
            "image with a sha256 digest."
        )

    python_stage_count = len(PYTHON_BASE_IMAGE_FROM_PATTERN.findall(dockerfile))
    if python_stage_count != EXPECTED_PYTHON_STAGE_COUNT:
        raise ValueError(
            "Both Python Docker stages must reference ${PYTHON_BASE_IMAGE}; "
            f"found {python_stage_count} references."
        )

    return python_image


def read_python_version(python_image: str) -> str:
    match = PYTHON_IMAGE_PATTERN.fullmatch(python_image)
    if not match:
        raise ValueError("Unable to extract a Python version from the runtime image.")
    return match.group("version")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate and query the canonical Python runtime image."
    )
    output_group = parser.add_mutually_exclusive_group()
    output_group.add_argument(
        "--image", action="store_true", help="Print the validated Python image."
    )
    output_group.add_argument(
        "--version", action="store_true", help="Print the Python patch version."
    )
    parser.add_argument("dockerfile", nargs="?", type=Path, default=Path("Dockerfile"))
    arguments = parser.parse_args()

    try:
        python_image = read_python_runtime_image(arguments.dockerfile)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1

    if arguments.image:
        print(python_image)
    elif arguments.version:
        print(read_python_version(python_image))
    else:
        print(f"Python runtime image: {python_image}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
