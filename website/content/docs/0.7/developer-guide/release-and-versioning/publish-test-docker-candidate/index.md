+++
title = "Publish Test Docker Candidate"
+++

This is step 1 of the Docker release flow.

Use this `Release: Create Docker Image` workflow to create a deployable Docker image from a specific commit. It is the only workflow that builds and pushes a new Sambee image to GitHub Container Registry.

This workflow does not publish a GitHub Release, and it does not move anything to `stable` or `beta`. It builds a candidate image, validates it, publishes it under an immutable `sha-<full-commit-sha>` tag, and moves the `test` tag to that same digest.

## Use It When

Run the preview workflow when:

- you want to test a specific commit in a real deployment environment.
- you want a candidate image that can later be promoted to `stable` or `beta` without rebuilding.
- you want the candidate to identify itself with a preview-only version label before a formal release.

Do not use this workflow for pull-request smoke testing. That is the job of `CI: Validate Docker Image`.

## Inputs

The manual workflow accepts these inputs:

| Input | What it means | Typical usage |
|---|---|---|
| `source_ref` | Which code to build. Use a commit SHA or tag. | Leave empty to build from the latest commit of the branch you selected when starting the run. Set it only when you need to point the run at a different commit. |
| `publish_version_override` | Which version label to bake into the image. This is **not** the image tag used by Docker Compose. If you leave it empty, the workflow uses the checked-in `VERSION` value. | Use it for preview-only labels such as `0.8.0-test.1`. Leave it empty for a normal release candidate. |

If `publish_version_override` is set, CI rewrites `VERSION` for that run only and reruns `./scripts/sync-version` before building.

That version value is written into the image metadata and the generated metadata bundle. It is not the main preview lookup tag. The candidate is still published under `sha-<full-commit-sha>` and then exposed through the moving `test` tag.

## Validation

Before it publishes anything, the workflow runs the following validation checks:

- Backend type checks must pass.
- Backend tests must pass.
- Frontend type checks must pass.
- Frontend tests must pass.
- Each supported platform image must build, publish by digest, and start successfully.

The workflow forces a fresh rebuild of the Dockerfile layer that installs Debian packages for that run. That keeps preview candidates aligned with the latest package fixes available from the Debian repositories at build time while still letting the rest of the image reuse BuildKit cache.

## Published Output

After validation, the workflow:

1. Builds and pushes native `linux/amd64` and `linux/arm64` platform manifests.
2. Starts those same images and waits for the health endpoint to succeed.
3. Scans those same images with Trivy.
4. Assembles the platform manifests into one multi-platform candidate index.
5. Publishes that candidate index under `sha-<full-commit-sha>`.
6. Extracts per-platform SBOM and provenance payloads on native runners, then assembles and publishes the metadata bundle under the digest-derived `.meta` tag in `ghcr.io/<owner>/sambee-signatures`.
7. Moves the `test` tag onto that same digest after metadata bundle publication succeeds.
8. Signs the digest with Cosign using GitHub Actions OIDC.

The digest is the real artifact identity. The `test` tag is only a moving alias.

The workflow uses digest-only platform pushes while assembling the final candidate index. Treat those platform manifests as internal publish artifacts, not release candidates.

Cosign writes the signature artifact into a dedicated signature repository so the main `sambee` package page stays centered on deployable image versions.
That signature repository can still show both digest-derived signature tags and referenced untagged bundle manifests, which are part of Cosign's current storage model rather than extra preview image variants.

## Security Scan Behavior

The preview workflow runs Trivy before publish.

For preview publishing, Trivy findings are advisory rather than blocking. That keeps the newest candidate available for testing while still surfacing risk clearly in the workflow output.

The preview scan runs against the same pushed platform digests that are later assembled into the published candidate index, so validation and publication use the same platform manifests.

Those manifests use the same OS-package refresh policy, so the candidate that gets published is rebuilt against current Debian package metadata for that workflow run.

## Run the Workflow

Use this order when you are preparing a release candidate:

1. Merge the commit you may want to ship.
2. Start `Release: Create Docker Image` from that exact commit.
3. Leave `source_ref` empty unless you deliberately need another immutable ref.
4. Leave `publish_version_override` empty unless this is a preview-only label.
5. Wait for the workflow to publish `sha-<full-commit-sha>` and update `test`.
6. Validate the candidate in the target environment.
7. If the candidate is approved, move on to [Promote Docker Candidate](../promote-docker-candidate/).

## Metadata

The published image includes OCI labels for the source repository, source ref name, git revision, version, creation time, and license.

The workflow also generates `GIT_COMMIT` in CI before building because GitHub-hosted runners do not run the local git hooks that usually keep that file current. That keeps frontend and backend build metadata aligned inside the container image.
