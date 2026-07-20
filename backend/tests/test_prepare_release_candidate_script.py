import os
import shutil
import subprocess
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / ".github/scripts/prepare_release_candidate.py"
GIT_EXECUTABLE = shutil.which("git")
assert GIT_EXECUTABLE is not None
SPEC = spec_from_file_location("prepare_release_candidate", SCRIPT)
assert SPEC and SPEC.loader
MODULE = module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


@pytest.mark.parametrize("version", ["0.0.0", "1.2.3", "10.20.30"])
def test_validate_version_accepts_plain_numeric_versions(version: str) -> None:
    assert MODULE.validate_version(version) == version


@pytest.mark.parametrize("version", ["01.2.3", "1.02.3", "1.2.03", "1.2", "v1.2.3", "1.2.3-rc.1", "1.2.3+1"])
def test_validate_version_rejects_non_publishable_versions(version: str) -> None:
    with pytest.raises(MODULE.CandidateError):
        MODULE.validate_version(version)


def test_require_main_dispatch_rejects_other_refs() -> None:
    with pytest.raises(MODULE.CandidateError, match="refs/heads/main"):
        MODULE.require_main_dispatch("refs/heads/feature")


def git(repository: Path, *arguments: str) -> str:
    return subprocess.run(["git", *arguments], cwd=repository, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repository(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    git_directory = str(Path(GIT_EXECUTABLE).parent)
    monkeypatch.setenv("PATH", f"{git_directory}:{os.environ.get('PATH', '')}")
    remote = tmp_path / "remote.git"
    local = tmp_path / "local"
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    subprocess.run(["git", "init", "--initial-branch=main", str(local)], check=True, capture_output=True)
    git(local, "config", "user.name", "Test User")
    git(local, "config", "user.email", "test@example.com")
    (local / "VERSION").write_text("1.2.3\n", encoding="ascii")
    git(local, "add", "VERSION")
    git(local, "commit", "-m", "Initial version")
    git(local, "remote", "add", "origin", str(remote))
    git(local, "push", "-u", "origin", "main")
    monkeypatch.chdir(local)
    return local


def test_reserve_or_resolve_creates_annotated_build_tag(repository: Path) -> None:
    source_sha = git(repository, "rev-parse", "HEAD")

    candidate = MODULE.reserve_or_resolve(
        dispatch_ref="refs/heads/main",
        dispatch_sha=source_sha,
        build_version=None,
        run_url="https://example.test/runs/1",
    )

    assert candidate.version == "1.2.3"
    assert candidate.tag == "build-v1.2.3"
    assert candidate.source_sha == source_sha
    assert candidate.reserved is True
    assert git(repository, "cat-file", "-t", "build-v1.2.3") == "tag"
    assert git(repository, "ls-remote", "--tags", "origin", "build-v1.2.3^{}")


def test_resolve_existing_build_checks_out_its_canonical_commit(repository: Path) -> None:
    source_sha = git(repository, "rev-parse", "HEAD")
    MODULE.reserve_or_resolve(
        dispatch_ref="refs/heads/main",
        dispatch_sha=source_sha,
        build_version=None,
        run_url="https://example.test/runs/1",
    )
    (repository / "VERSION").write_text("1.2.4\n", encoding="ascii")
    git(repository, "commit", "-am", "Next build")
    git(repository, "push", "origin", "main")

    candidate = MODULE.reserve_or_resolve(
        dispatch_ref="refs/heads/main",
        dispatch_sha=git(repository, "rev-parse", "HEAD"),
        build_version="1.2.3",
        run_url="https://example.test/runs/2",
    )

    assert candidate.source_sha == source_sha
    assert candidate.reserved is False
    assert git(repository, "rev-parse", "HEAD") == source_sha


def test_reservation_rejects_existing_tag_for_different_source(repository: Path) -> None:
    first_sha = git(repository, "rev-parse", "HEAD")
    MODULE.reserve_or_resolve(
        dispatch_ref="refs/heads/main",
        dispatch_sha=first_sha,
        build_version=None,
        run_url="https://example.test/runs/1",
    )
    (repository / "README").write_text("changed\n", encoding="ascii")
    git(repository, "add", "README")
    git(repository, "commit", "-m", "Different source")
    git(repository, "push", "origin", "main")

    with pytest.raises(MODULE.CandidateError, match="already bound"):
        MODULE.reserve_or_resolve(
            dispatch_ref="refs/heads/main",
            dispatch_sha=git(repository, "rev-parse", "HEAD"),
            build_version=None,
            run_url="https://example.test/runs/2",
        )


def test_reservation_accepts_same_source_concurrent_tag_push(repository: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source_sha = git(repository, "rev-parse", "HEAD")
    competitor = tmp_path / "competitor"
    subprocess.run(
        ["git", "clone", str(repository.parent / "remote.git"), str(competitor)],
        check=True,
        capture_output=True,
    )
    git(competitor, "config", "user.name", "Competing Test User")
    git(competitor, "config", "user.email", "competitor@example.com")

    original_run = MODULE.subprocess.run
    pushed_by_competitor = False

    def race_push(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        nonlocal pushed_by_competitor
        if command == ["git", "push", "origin", "refs/tags/build-v1.2.3"] and not pushed_by_competitor:
            pushed_by_competitor = True
            git(competitor, "tag", "-a", "build-v1.2.3", source_sha, "-m", "Concurrent reservation")
            git(competitor, "push", "origin", "refs/tags/build-v1.2.3")
        return original_run(command, **kwargs)

    monkeypatch.setattr(MODULE.subprocess, "run", race_push)

    candidate = MODULE.reserve_or_resolve(
        dispatch_ref="refs/heads/main",
        dispatch_sha=source_sha,
        build_version=None,
        run_url="https://example.test/runs/1",
    )

    assert pushed_by_competitor
    assert candidate.source_sha == source_sha
    assert candidate.reserved is False


def test_reservation_reports_remote_fetch_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def failing_fetch(*arguments: str, check: bool = True) -> str:
        assert arguments == ("fetch", "origin", "main", "--tags")
        assert check is True
        raise MODULE.CandidateError("git fetch origin main --tags failed: network unavailable")

    monkeypatch.setattr(MODULE, "run_git", failing_fetch)

    with pytest.raises(MODULE.CandidateError, match="network unavailable"):
        MODULE.reserve_or_resolve(
            dispatch_ref="refs/heads/main",
            dispatch_sha="a" * 40,
            build_version=None,
            run_url="https://example.test/runs/1",
        )
