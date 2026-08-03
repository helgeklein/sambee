import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / "scripts/verify-python-runtime-image.py"
SPEC = spec_from_file_location("verify_python_runtime_image", SCRIPT)
assert SPEC and SPEC.loader
MODULE = module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

PYTHON_IMAGE = "python:3.13.12-slim@sha256:" + "a" * 64
PYTHON_VERSION = "3.13.12"


def dockerfile_contents(base_image: str = PYTHON_IMAGE, stage_references: int = 2) -> str:
    stages = ["FROM ${PYTHON_BASE_IMAGE} AS runtime-base"]
    if stage_references == 2:
        stages.append("FROM --platform=$BUILDPLATFORM ${PYTHON_BASE_IMAGE} AS pyvips-wheel-builder")

    return "\n".join([f"ARG PYTHON_BASE_IMAGE={base_image}", *stages])


def test_reads_canonical_runtime_image(tmp_path: Path) -> None:
    dockerfile_path = tmp_path / "Dockerfile"
    dockerfile_path.write_text(dockerfile_contents(), encoding="utf-8")

    assert MODULE.read_python_runtime_image(dockerfile_path) == PYTHON_IMAGE
    assert MODULE.read_python_version(PYTHON_IMAGE) == PYTHON_VERSION


def test_rejects_unpinned_runtime_image(tmp_path: Path) -> None:
    dockerfile_path = tmp_path / "Dockerfile"
    dockerfile_path.write_text(dockerfile_contents(base_image="python:3.13-slim"), encoding="utf-8")

    with pytest.raises(ValueError, match="pinned"):
        MODULE.read_python_runtime_image(dockerfile_path)


def test_rejects_duplicate_runtime_image_declarations(tmp_path: Path) -> None:
    dockerfile_path = tmp_path / "Dockerfile"
    dockerfile_path.write_text(
        "\n".join([dockerfile_contents(), f"ARG PYTHON_BASE_IMAGE={PYTHON_IMAGE}"]),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="exactly once"):
        MODULE.read_python_runtime_image(dockerfile_path)


def test_rejects_missing_python_stage_reference(tmp_path: Path) -> None:
    dockerfile_path = tmp_path / "Dockerfile"
    dockerfile_path.write_text(dockerfile_contents(stage_references=1), encoding="utf-8")

    with pytest.raises(ValueError, match="found 1 references"):
        MODULE.read_python_runtime_image(dockerfile_path)
