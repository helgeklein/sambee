"""Regression tests for CI component selection."""

import json
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import ci_change_detector
from ci_change_detector import ARCHIVE_TOPOLOGY_PATHS, FULL_TREE_DIFF_BASE, classify_paths


@pytest.mark.parametrize(
    "path",
    [
        "archive-contract/v1/topology-execution-traces-v1.json",
        "backend/app/services/archive/coordinator.py",
        "backend/tests/test_archive_future.py",
        "companion/src-tauri/src/server/archive_new_adapter.rs",
        *sorted(ARCHIVE_TOPOLOGY_PATHS),
    ],
)
def test_archive_topology_paths_schedule_both_runtime_jobs(path: str) -> None:
    selections = classify_paths([path])

    assert selections["backend"]
    assert selections["companion"]


def test_non_topology_component_changes_remain_selective() -> None:
    assert classify_paths(["backend/app/api/auth.py"]) == {
        "backend": True,
        "frontend": False,
        "companion": False,
        "website": False,
    }
    assert classify_paths(["companion/src/lib.rs"]) == {
        "backend": False,
        "frontend": False,
        "companion": True,
        "website": False,
    }
    assert classify_paths(["frontend/src/App.tsx"]) == {
        "backend": False,
        "frontend": True,
        "companion": False,
        "website": False,
    }


def _run_detector(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    *,
    event_name: str,
    event: dict[str, Any] | None = None,
    api_responses: list[object] | None = None,
) -> dict[str, str]:
    output_path = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_path))
    monkeypatch.setenv("GITHUB_EVENT_NAME", event_name)
    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    monkeypatch.setenv("GITHUB_REPOSITORY", "sambee/sambee")
    monkeypatch.setenv("GITHUB_SHA", "head-sha")
    if event is not None:
        event_path = tmp_path / "event.json"
        event_path.write_text(json.dumps(event), encoding="utf-8")
        monkeypatch.setenv("GITHUB_EVENT_PATH", str(event_path))
    responses = iter(api_responses or [])
    monkeypatch.setattr(ci_change_detector, "github_api_request", lambda _url, _headers: next(responses))

    assert ci_change_detector.main() == 0
    return dict(line.split("=", 1) for line in output_path.read_text(encoding="utf-8").splitlines())


def test_manual_dispatch_runs_all_components_and_checks_the_full_tree(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    assert _run_detector(monkeypatch, tmp_path, event_name="workflow_dispatch") == {
        "backend": "true",
        "frontend": "true",
        "companion": "true",
        "website": "true",
        "diff_base": FULL_TREE_DIFF_BASE,
    }


def test_push_uses_comparison_paths_and_before_sha(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    outputs = _run_detector(
        monkeypatch,
        tmp_path,
        event_name="push",
        event={"before": "base-sha"},
        api_responses=[{"files": [{"filename": "archive-contract/v1/topology-execution-traces-v1.json"}]}],
    )

    assert outputs == {
        "backend": "true",
        "frontend": "false",
        "companion": "true",
        "website": "false",
        "diff_base": "base-sha",
    }


def test_zero_base_push_runs_all_components_and_checks_the_full_tree(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    outputs = _run_detector(monkeypatch, tmp_path, event_name="push", event={"before": "0" * 40})

    assert outputs == {
        "backend": "true",
        "frontend": "true",
        "companion": "true",
        "website": "true",
        "diff_base": FULL_TREE_DIFF_BASE,
    }


def test_pull_request_paginates_changed_paths_and_uses_the_base_sha(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    outputs = _run_detector(
        monkeypatch,
        tmp_path,
        event_name="pull_request",
        event={"pull_request": {"number": 42, "base": {"sha": "base-sha"}}},
        api_responses=[
            [{"filename": "frontend/src/App.tsx"}] * 100,
            [{"filename": "companion/src-tauri/src/server/archive_future.rs"}],
        ],
    )

    assert outputs == {
        "backend": "true",
        "frontend": "true",
        "companion": "true",
        "website": "false",
        "diff_base": "base-sha",
    }
