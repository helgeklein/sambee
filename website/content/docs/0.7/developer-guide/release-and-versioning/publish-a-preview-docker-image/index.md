+++
title = "Publish Test Docker Candidate"
+++

This is step 1 of the Docker release flow.

Use this workflow to create a real, deployable Docker image candidate for a specific commit.

GitHub Actions displays this workflow as `Preview: Publish Test Docker Image`.

It is the only workflow that builds and pushes a new Sambee image to GitHub Container Registry.

## Use It When

Run the preview workflow when:

- you want to test a specific commit in a real deployment environment.
- you want a candidate image that can later be promoted to `stable` or `beta` without rebuilding.
- you want to validate a preview-only version label before a formal release.

Do not use this workflow for pull-request smoke testing. That is the job of `CI: Validate Docker Image`.

## Inputs

The manual workflow accepts these inputs:

| Input | What it means | Typical usage |
|---|---|---|
| `source_ref` | The commit SHA or tag to build. If you leave it empty, the workflow uses the commit from which you started the run. | Leave empty when you start the workflow from the exact commit you want. Set it only when you need another immutable ref. |
| `publish_version_override` | A preview-only version label for this run. If you leave it empty, the workflow uses the checked-in `VERSION` value. | Use it for test-only publishes such as `0.8.0-test.1`. Leave it empty for a normal release candidate. |

If `publish_version_override` is set, CI rewrites `VERSION` for that run only and reruns `./scripts/sync-version` before building.

## Pre-Publish Checks

Before it publishes anything, the workflow requires:

- Backend type checks must pass.
- Backend tests must pass.
- Frontend type checks must pass.
- Frontend tests must pass.
- Each supported platform image must build and start successfully.

The published `test` image is therefore already a validated candidate.

## Published Output

After validation, the workflow:

1. Builds the multi-platform image.
2. Publishes it under `sha-<full-commit-sha>`.
3. Moves the `test` tag onto that same digest.
4. Publishes an SBOM and provenance metadata bundle under the digest-derived `.meta` tag in `ghcr.io/<owner>/sambee-signatures`.
5. Signs the digest with Cosign using GitHub Actions OIDC.

The digest is the real artifact identity. The `test` tag is only a moving alias.

Cosign writes the signature artifact into a dedicated signature repository so the main `sambee` package page stays centered on deployable image versions.

## Scan Behavior

The preview workflow runs Trivy before publish.

For preview publishing, Trivy findings are advisory rather than blocking. That keeps the newest candidate available for testing while still surfacing risk clearly in the workflow output.

## Run It

Use this order when you are preparing a release candidate:

1. Merge the commit you may want to ship.
2. Start `Preview: Publish Test Docker Image` from that exact commit.
3. Leave `source_ref` empty unless you deliberately need another immutable ref.
4. Leave `publish_version_override` empty unless this is a preview-only label.
5. Wait for the workflow to publish `sha-<full-commit-sha>` and update `test`.
6. Validate the candidate in the target environment.
7. If the candidate is approved, move on to [Promote Docker Candidate](../promote-a-preview-candidate-to-stable-or-beta/).

## Metadata

The published image includes OCI labels for the source repository, source ref name, git revision, version, creation time, and license.

The workflow also generates `GIT_COMMIT` in CI before building because GitHub-hosted runners do not run the local git hooks that usually keep that file current. That keeps frontend and backend build metadata aligned inside the container image.

