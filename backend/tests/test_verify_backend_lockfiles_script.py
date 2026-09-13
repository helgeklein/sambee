import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / "scripts/verify-backend-lockfiles.py"
SPEC = spec_from_file_location("verify_backend_lockfiles", SCRIPT)
assert SPEC and SPEC.loader
MODULE = module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

HASH = "a" * 64


def lock_entry(name: str, version: str, *, include_hash: bool = True) -> str:
    entry = f"{name}=={version} \\\n"
    if include_hash:
        entry += f"    --hash=sha256:{HASH}\n"
    return entry


def write_backend_files(
    tmp_path: Path,
    *,
    runtime_source: str = "Example-Package[feature]==1.2.3\n",
    development_source: str = "Dev.Tool==4.5.6\n",
    runtime_lock: str | None = None,
    development_lock: str | None = None,
) -> Path:
    backend_directory = tmp_path / "backend"
    backend_directory.mkdir()
    (backend_directory / "requirements.txt").write_text(runtime_source, encoding="utf-8")
    (backend_directory / "requirements-dev.txt").write_text(development_source, encoding="utf-8")
    (backend_directory / "requirements.lock.txt").write_text(runtime_lock or lock_entry("example_package", "1.2.3"), encoding="utf-8")
    (backend_directory / "requirements-dev.lock.txt").write_text(
        development_lock or "".join([lock_entry("example-package", "1.2.3"), lock_entry("dev-tool", "4.5.6")]),
        encoding="utf-8",
    )
    return tmp_path


def test_accepts_exact_pins_with_extras_and_normalized_names(tmp_path: Path) -> None:
    repository_root = write_backend_files(tmp_path)

    MODULE.verify_lockfiles(repository_root)


def test_rejects_missing_direct_package_entry(tmp_path: Path) -> None:
    repository_root = write_backend_files(tmp_path, runtime_lock=lock_entry("other-package", "1.2.3"))

    with pytest.raises(ValueError, match=r"requirements\.lock\.txt: missing example-package==1.2.3"):
        MODULE.verify_lockfiles(repository_root)


def test_rejects_mismatched_direct_package_version(tmp_path: Path) -> None:
    repository_root = write_backend_files(tmp_path, runtime_lock=lock_entry("example-package", "1.2.2"))

    with pytest.raises(ValueError, match=r"example-package is 1.2.2.*requires 1.2.3"):
        MODULE.verify_lockfiles(repository_root)


def test_rejects_runtime_package_missing_from_development_lock(tmp_path: Path) -> None:
    repository_root = write_backend_files(tmp_path, development_lock=lock_entry("dev-tool", "4.5.6"))

    with pytest.raises(ValueError, match=r"requirements-dev\.lock\.txt: missing example-package==1.2.3"):
        MODULE.verify_lockfiles(repository_root)


def test_rejects_lock_entry_without_sha256_hash(tmp_path: Path) -> None:
    repository_root = write_backend_files(
        tmp_path,
        runtime_lock=lock_entry("example-package", "1.2.3", include_hash=False),
    )

    with pytest.raises(ValueError, match="must include a SHA-256 hash"):
        MODULE.verify_lockfiles(repository_root)


def test_rejects_unsupported_source_requirement_syntax(tmp_path: Path) -> None:
    repository_root = write_backend_files(tmp_path, runtime_source="example-package>=1.2.3\n")

    with pytest.raises(ValueError, match="unsupported source requirement"):
        MODULE.verify_lockfiles(repository_root)
