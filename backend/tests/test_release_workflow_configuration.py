from pathlib import Path

import yaml

WORKSPACE = Path(__file__).parents[2]


def load_workflow(name: str) -> dict:
    with (WORKSPACE / ".github/workflows" / name).open(encoding="utf-8") as file:
        payload = yaml.safe_load(file)
    assert isinstance(payload, dict)
    return payload


def workflow_inputs(workflow: dict) -> dict:
    trigger = workflow.get("on", workflow.get(True, {}))
    assert isinstance(trigger, dict)
    dispatch = trigger.get("workflow_dispatch", {})
    assert isinstance(dispatch, dict)
    inputs = dispatch.get("inputs", {})
    assert isinstance(inputs, dict)
    return inputs


def step_uses(steps: list[dict], action: str) -> bool:
    return any(step.get("uses") == action for step in steps if isinstance(step, dict))


def test_candidate_workflows_do_not_expose_source_or_version_overrides() -> None:
    docker = load_workflow("docker-image-preview-publish.yml")
    companion = load_workflow("build-companion.yml")

    forbidden_inputs = {"source_ref", "publish_version_override"}
    assert not forbidden_inputs & set(workflow_inputs(docker))
    assert not forbidden_inputs & set(workflow_inputs(companion))
    assert "build_version" in workflow_inputs(docker)
    assert "build_version" in workflow_inputs(companion)


def test_candidate_matrix_builds_depend_on_shared_preflight() -> None:
    for workflow_name in ("docker-image-preview-publish.yml", "build-companion.yml"):
        workflow = load_workflow(workflow_name)
        jobs = workflow["jobs"]
        prepare = jobs["prepare"]
        assert step_uses(prepare["steps"], "./.github/actions/release-candidate-preflight")
        build_jobs = [job for name, job in jobs.items() if name.startswith("build")]
        assert build_jobs
        for job in build_jobs:
            needs = job.get("needs", [])
            if isinstance(needs, str):
                needs = [needs]
            assert "prepare" in needs


def test_release_mutation_workflows_share_the_expected_locks() -> None:
    docker_candidate = load_workflow("docker-image-preview-publish.yml")
    docker_promotion = load_workflow("docker-image-publish.yml")
    companion = load_workflow("build-companion.yml")

    assert docker_candidate["concurrency"]["group"] == "docker-release-publication"
    assert docker_promotion["concurrency"]["group"] == "docker-release-publication"
    assert companion["concurrency"]["group"] == "companion-release-publication"


def test_coordinated_companion_promotion_uses_signed_docker_verifier() -> None:
    workflow = load_workflow("promote-companion-release.yml")
    steps = workflow["jobs"]["promote"]["steps"]
    coordinated_step = next(step for step in steps if step.get("name") == "Verify coordinated Docker candidate")
    assert "verify_published_candidate_image.sh" in coordinated_step["run"]
    assert any(step.get("name") == "Install Cosign" for step in steps)


def test_docker_backfill_uses_signed_candidate_verifier() -> None:
    workflow = load_workflow("docker-image-backfill.yml")
    steps = workflow["jobs"]["verify-candidate-artifact"]["steps"]

    assert any(step.get("name") == "Install Cosign" for step in steps)
    verifier_step = next(step for step in steps if step.get("name") == "Verify signed published candidate")
    assert "verify_published_candidate_image.sh" in verifier_step["run"]
