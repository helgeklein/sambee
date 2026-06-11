from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "should_promote_beta_tag.py"


def load_module():
    spec = importlib.util.spec_from_file_location("should_promote_beta_tag", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.mark.unit
def test_parse_semver_rejects_invalid_versions() -> None:
    module = load_module()

    with pytest.raises(ValueError):
        module.parse_semver("0.7")

    with pytest.raises(ValueError):
        module.parse_semver("0.7.0-beta.01")

    with pytest.raises(ValueError):
        module.parse_semver("01.7.0")

    with pytest.raises(ValueError):
        module.parse_semver("0.07.0")

    with pytest.raises(ValueError):
        module.parse_semver("0.7.00")


@pytest.mark.unit
def test_release_beats_matching_prerelease() -> None:
    module = load_module()

    stable = module.parse_semver("0.7.0")
    beta = module.parse_semver("0.7.0-beta.1")

    assert module.compare_semver(beta, stable) < 0


@pytest.mark.unit
def test_higher_minor_prerelease_stays_on_beta() -> None:
    module = load_module()

    assert not module.should_promote_beta_tag("0.7.0", "0.7.1-beta.1")


@pytest.mark.unit
def test_build_metadata_does_not_make_beta_newer() -> None:
    module = load_module()

    assert module.should_promote_beta_tag("0.7.0", "0.7.0+build.5")


@pytest.mark.unit
def test_missing_or_invalid_beta_version_promotes() -> None:
    module = load_module()

    assert module.should_promote_beta_tag("0.7.0", None)
    assert module.should_promote_beta_tag("0.7.0", "not-a-version")
