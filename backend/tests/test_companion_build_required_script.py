import importlib.util
from pathlib import Path

WORKSPACE = Path(__file__).parents[2]
SCRIPT_PATH = WORKSPACE / ".github/scripts/companion_build_required.py"
SPEC = importlib.util.spec_from_file_location("companion_build_required", SCRIPT_PATH)
assert SPEC is not None
assert SPEC.loader is not None
companion_build_required = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(companion_build_required)


def make_reader(files: dict[tuple[str, str], str]):
    def read_file(revision: str, path: str) -> str:
        return files[(revision, path)]

    return read_file


def test_version_sync_only_accepts_version_field_changes() -> None:
    base = "base"
    head = "head"
    path = "companion/src-tauri/Cargo.toml"
    files = {
        (base, path): '[package]\nname = "sambee-companion"\nversion = "0.9.22"\n',
        (head, path): '[package]\nname = "sambee-companion"\nversion = "0.9.23"\n',
    }

    assert companion_build_required.is_version_sync_only({"VERSION", path}, make_reader(files), base, head)


def test_version_sync_only_rejects_non_version_metadata_changes() -> None:
    base = "base"
    head = "head"
    path = "companion/package.json"
    files = {
        (base, path): '{"version": "0.9.22", "scripts": {"test": "vitest"}}',
        (head, path): '{"version": "0.9.23", "scripts": {"test": "vitest --run"}}',
    }

    assert not companion_build_required.is_version_sync_only({"VERSION", path}, make_reader(files), base, head)


def test_version_sync_only_rejects_companion_source_changes() -> None:
    assert not companion_build_required.is_version_sync_only(
        {"VERSION", "companion/src/App.tsx"}, lambda _revision, _path: "", "base", "head"
    )
