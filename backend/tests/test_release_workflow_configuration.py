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


def test_docker_promotion_uses_only_the_verifier_digest_for_aliases() -> None:
    workflow = load_workflow("docker-image-publish.yml")
    verifier_job = workflow["jobs"]["verify-candidate-artifact"]
    assert verifier_job["outputs"]["candidate_digest"] == "${{ steps.verify.outputs.resolved_digest }}"
    assert "sign-and-attest" not in workflow["jobs"]

    alias_jobs = ("publish-release-tags", "promote-channel-tags")
    for job_name in alias_jobs:
        job = workflow["jobs"][job_name]
        assert "verify-candidate-artifact" in job["needs"]
        run_steps = "\n".join(step.get("run", "") for step in job["steps"] if isinstance(step, dict))
        assert "needs.verify-candidate-artifact.outputs.candidate_digest" in run_steps

    repair_step = next(step for step in verifier_job["steps"] if step.get("name") == "Verify candidate repair aliases")
    assert "steps.verify.outputs.resolved_digest" in repair_step["run"]
    assert "build_version=${{ needs.prepare.outputs.version }}" in repair_step["run"]


def test_docker_candidate_aliases_use_the_post_sign_verifier_digest() -> None:
    workflow = load_workflow("docker-image-preview-publish.yml")
    verifier_job = workflow["jobs"]["verify-signed-candidate"]
    assert verifier_job["outputs"]["candidate_digest"] == "${{ steps.verify.outputs.resolved_digest }}"

    verifier_steps = verifier_job["steps"]
    assert any(step.get("name") == "Install Cosign" for step in verifier_steps)
    verification_step = next(step for step in verifier_steps if step.get("name") == "Verify signed candidate")
    assert "verify_published_candidate_image.sh" in verification_step["run"]

    signer_job = workflow["jobs"]["sign-preview"]
    signer_step = next(step for step in signer_job["steps"] if step.get("name") == "Sign preview digest")
    assert "ensure_candidate_signature.sh" in signer_step["run"]

    for job_name in ("publish-immutable-markers", "promote-test-tag"):
        job = workflow["jobs"][job_name]
        assert "verify-signed-candidate" in job["needs"]
        run_steps = "\n".join(step.get("run", "") for step in job["steps"] if isinstance(step, dict))
        assert "needs.verify-signed-candidate.outputs.candidate_digest" in run_steps


def test_docker_candidate_cleanup_and_summary_cover_staging_lifecycle() -> None:
    workflow = load_workflow("docker-image-preview-publish.yml")
    cleanup_job = workflow["jobs"]["cleanup-staging-image"]
    assert cleanup_job["if"] == "${{ always() && needs.prepare.outputs.publication_state == 'build' }}"
    cleanup_step = next(step for step in cleanup_job["steps"] if step.get("name") == "Delete run-scoped staging tags")
    assert "staging-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${platform}" in cleanup_step["run"]
    assert "crane delete" in cleanup_step["run"]

    summary_job = workflow["jobs"]["summarize-candidate"]
    assert summary_job["if"] == "${{ always() }}"
    summary_step = summary_job["steps"][0]
    assert "GITHUB_STEP_SUMMARY" in summary_step["run"]
    for expected_detail in (
        "Canonical source tag",
        "Source SHA",
        "Final digest",
        "Docker version marker",
        "Staging references",
        "Movable test tag",
    ):
        assert expected_detail in summary_step["run"]


def test_docker_backfill_does_not_sign_after_alias_promotion() -> None:
    workflow = load_workflow("docker-image-backfill.yml")
    assert "sign-and-attest" not in workflow["jobs"]
