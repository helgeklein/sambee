import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / ".github/scripts/validate_release_scope.py"
SPEC = spec_from_file_location("validate_release_scope", SCRIPT)
assert SPEC and SPEC.loader
MODULE = module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def metadata(scope: str) -> dict:
    return {"schema_version": 1, "component_scope": scope, "version": "1.2.3", "build_tag": "build-v1.2.3", "source_sha": "a" * 40}


@pytest.mark.parametrize("scope,component", [("docker", "docker"), ("companion", "companion"), ("both", "docker"), ("both", "companion")])
def test_validate_scope_accepts_authorized_component(scope: str, component: str) -> None:
    MODULE.validate_scope(metadata(scope), component, "1.2.3", "build-v1.2.3", "a" * 40)


def test_validate_scope_rejects_excluded_component(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        MODULE.validate_scope(metadata("docker"), "companion", "1.2.3", "build-v1.2.3", "a" * 40)
    assert "does not allow companion" in capsys.readouterr().err
