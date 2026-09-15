#!/usr/bin/env python3
"""Append local and registry container image size metrics to a CI summary."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

BYTES_PER_MEBIBYTE = 1024 * 1024
DOCKER_IMAGE_INSPECT_COMMAND = ("docker", "image", "inspect")
DOCKER_REGISTRY_MANIFEST_COMMAND = (
    "docker",
    "buildx",
    "imagetools",
    "inspect",
    "--raw",
)
SUMMARY_ENVIRONMENT_VARIABLE = "GITHUB_STEP_SUMMARY"


def run_command(*command: str) -> str:
    """Run a command and return its standard output, with actionable failures."""
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError as error:
        raise RuntimeError(f"Required command is unavailable: {command[0]}") from error
    except subprocess.CalledProcessError as error:
        details = error.stderr.strip() or error.stdout.strip() or "no command output"
        raise RuntimeError(
            f"Command failed ({' '.join(command)}): {details}"
        ) from error
    return result.stdout.strip()


def read_local_image_size(image: str) -> int:
    """Return Docker's unpacked image size in bytes."""
    output = run_command(*DOCKER_IMAGE_INSPECT_COMMAND, "--format", "{{.Size}}", image)
    try:
        size = int(output)
    except ValueError as error:
        raise RuntimeError(
            f"Docker returned an invalid image size for {image!r}: {output!r}"
        ) from error
    if size < 0:
        raise RuntimeError(
            f"Docker returned a negative image size for {image!r}: {size}"
        )
    return size


def read_registry_layer_size(image: str) -> int:
    """Return the sum of compressed OCI layer sizes for a platform image manifest."""
    try:
        manifest: dict[str, Any] = json.loads(
            run_command(*DOCKER_REGISTRY_MANIFEST_COMMAND, image)
        )
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Registry returned invalid manifest JSON for {image!r}"
        ) from error

    layers = manifest.get("layers")
    if not isinstance(layers, list):
        raise TypeError(
            f"Registry manifest for {image!r} does not contain platform layers"
        )

    total_size = 0
    for layer in layers:
        try:
            layer_size = layer["size"]
        except (KeyError, TypeError) as error:
            raise RuntimeError(
                f"Registry manifest for {image!r} has invalid layer size data"
            ) from error
        if (
            not isinstance(layer_size, int)
            or isinstance(layer_size, bool)
            or layer_size < 0
        ):
            raise RuntimeError(
                f"Registry manifest for {image!r} has invalid layer size data"
            )
        total_size += layer_size
    return total_size


def format_size(size_in_bytes: int) -> str:
    """Format a byte count for the workflow summary without losing precision."""
    return f"{size_in_bytes / BYTES_PER_MEBIBYTE:.2f} MiB ({size_in_bytes:,} bytes)"


def write_summary(
    platform: str, image: str, local_size: int, registry_size: int | None
) -> None:
    """Print and append the size report, when running in GitHub Actions."""
    rows = [("Unpacked image (Docker)", format_size(local_size))]
    if registry_size is not None:
        rows.append(("Compressed OCI layers (registry)", format_size(registry_size)))

    lines = [
        "## Container Image Size",
        "",
        f"Platform: `{platform}`",
        "",
        "| Metric | Size |",
        "| --- | ---: |",
        *(f"| {label} | {value} |" for label, value in rows),
        "",
        f"Image: `{image}`",
        "",
    ]
    report = "\n".join(lines)
    print(report)

    summary_path = os.environ.get(SUMMARY_ENVIRONMENT_VARIABLE)
    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as summary_file:
            summary_file.write(report)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Local Docker image reference")
    parser.add_argument("--platform", required=True, help="OCI platform identifier")
    parser.add_argument(
        "--registry-image",
        help="Pushed platform-manifest reference used to report compressed OCI layer size",
    )
    arguments = parser.parse_args()

    try:
        local_size = read_local_image_size(arguments.image)
        registry_size = (
            read_registry_layer_size(arguments.registry_image)
            if arguments.registry_image
            else None
        )
        write_summary(arguments.platform, arguments.image, local_size, registry_size)
    except (RuntimeError, TypeError) as error:
        print(f"Unable to report container image size: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
