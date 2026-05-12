+++
title = "Container Image Build and Publish Workflow"
+++

Sambee ships as one production container image built from the repository-root Dockerfile.

That image compiles the frontend, installs the backend and system dependencies, and serves the built frontend from the Python backend at runtime.

This workflow keeps image publication aligned with the repository's existing version discipline instead of creating a second release path just for containers.

## Purpose and Current Model

The container release workflow exists to make three things true at the same time:

- pull requests prove the production image still builds and starts correctly
- published images derive their version from `VERSION`, not from ad hoc workflow inputs
- operators get immutable release tags plus a signed digest they can deploy safely

The current model intentionally publishes a single runtime image, not separate frontend and backend images.

That matches the actual production packaging in the current Dockerfile.

## Main Control Points

| File or system | Role |
|---|---|
| `Dockerfile` | builds the production image |
| `.github/workflows/docker-image-validate.yml` | builds the image on `main`, pull requests, and manual dispatch, then smoke-tests it |
| `.github/workflows/docker-image-publish.yml` | validates a tagged release, publishes to GHCR, and signs the pushed digest |
| `VERSION` | source of truth for the product version |
| `GIT_COMMIT` | build metadata file copied into the image during CI |

## Artifact Shape

The published image is currently:

- platforms: `linux/amd64` and `linux/arm64`
- registry: GitHub Container Registry
- repository name: `ghcr.io/<owner>/sambee`

The published artifact is a multi-platform image index.

Each platform variant is built from the same Dockerfile and published under the same tags, so operators can pull the same image tag on either supported Linux architecture.

## Validation Workflow

The validation workflow runs on pull requests, on pushes to `main`, and on manual dispatch.

GitHub Actions displays it as `CI: Validate Docker Image`.

Current behavior:

1. check out the repository
2. run the existing version-sync verification
3. generate `GIT_COMMIT` directly in CI because local git hooks are not present on GitHub runners
4. build each supported platform variant locally with Buildx
5. start each built container variant with test-only secrets
6. wait for `/api/health` to respond successfully for each platform variant

This catches production-image breakage that unit and integration tests alone can miss, especially around:

- missing files in the Docker build context
- broken frontend build integration
- missing runtime system dependencies
- startup regressions that only appear in the containerized environment
- platform-specific regressions that only appear in one published architecture

## Publish Workflow

The publish workflow runs from a released Git tag or from manual dispatch against an existing immutable tag.

GitHub Actions displays it as `Release: Publish Docker Image`.

Its contract is intentionally strict.

Before publication, it verifies that:

- the selected tag matches `v$(cat VERSION)` exactly
- version-synced frontend and companion metadata are already committed
- backend type checks pass
- backend tests pass
- frontend type checks pass
- frontend tests pass
- each supported platform image builds and starts successfully
- each local platform image passes a Trivy scan for high and critical vulnerabilities in both OS packages and application libraries

Only after those checks pass does the workflow push the image.

The broader Trivy policy, weekly image scan, `.trivyignore.yaml` suppression rules, and image-integrity controls now live in [Container Image Security and Artifact Integrity](../../security/container-image-security-and-artifact-integrity/).

This page keeps only the release-specific part of that behavior: the publish workflow must pass the release-candidate image scan before a real release or tag-based publish can continue.

### Testing the Publishing Workflow

On normal release events, the published version must match `VERSION` exactly.

Manual dispatch also supports an explicit test-only override that rewrites `VERSION` and runs `./scripts/sync-version` inside CI before validation and build steps run.

That override exists only for non-release test publishing. It must not be used with `latest`.

When that override is active, the manual run does not require an existing git tag. If no tag is provided, the workflow uses the dispatched commit SHA as the immutable source ref for checkout and image source metadata.

## Tagging Contract

Release tags are expected to use this format:

- `vX.Y.Z`

That tag must match the plain version string in `VERSION`.

For example:

- `VERSION` contains `0.7.0`
- the release tag must be `v0.7.0`

If those values drift apart, publication fails instead of silently pushing a misleading image.

## Published Image Tags

The publish workflow currently writes these tags:

- full version tag such as `0.7.0`
- moving minor-series tag such as `0.7`
- immutable commit tag such as `sha-abc1234`
- `latest` only for published GitHub Releases that are not marked as prereleases, or when explicitly requested in a manual publish run

Operationally, the digest is the canonical deployment target.

The human-friendly tags exist for discoverability and promotion, not as a replacement for digest-based deployments.

## Metadata, SBOM, Provenance, and Signing

The published image includes OCI metadata labels for:

- source repository
- release tag
- git revision
- version
- creation time
- license

The push step also enables:

- SBOM emission
- build provenance attestation

Those attestations are emitted for the published multi-platform image output.

After the image is pushed, the workflow signs the digest with Cosign using GitHub Actions OIDC identity.

That avoids repository-managed signing keys while still producing a verifiable signature trail.

## Operator Flow

The intended release flow is:

1. update `VERSION`
2. run `./scripts/sync-version`
3. review and merge the version-sync metadata changes emitted by `./scripts/sync-version`
4. create the immutable release tag `vX.Y.Z`
5. publish the GitHub Release
6. let `Release: Publish Docker Image` validate, push, and sign the image
7. deploy by digest rather than by mutable tag where possible

## Manual Backfill or Re-Publish

The publish workflow also supports manual dispatch.

Use that only when you need to publish from an already existing immutable tag, for example:

- backfilling the container release process for an older tagged version
- re-running publication after a transient registry or runner failure

Manual dispatch accepts:

- `release_tag`: the existing immutable tag to publish. Optional when `publish_version_override` is set.
- `publish_version_override`: an optional test-only version string to publish instead of the checked-out `VERSION` value. It must use `major.minor.patch` with an optional prerelease or build suffix, for example `0.1.0-test1`.
- `push_latest`: whether that manual run should also move the `latest` tag

Do not use manual dispatch from a branch head as a substitute for the tag-based release path.

If `publish_version_override` is set:

- CI rewrites `VERSION` to the override value for that run only
- CI reruns `./scripts/sync-version` so embedded frontend and companion metadata stay aligned with the published image tags
- if `release_tag` is omitted, CI uses the dispatched commit SHA as the immutable source ref for that run
- invalid values such as `0.1-test1` are rejected before the build starts
- the override cannot be combined with `push_latest=true`
- Trivy findings remain visible, but they are advisory for that override-based test publish instead of blocking publication
- the run is best treated as a test publication rather than a normal release artifact

## Why the Workflow Generates `GIT_COMMIT`

The Dockerfile copies `GIT_COMMIT` into both the frontend build stage and the runtime image.

Local development usually keeps that file current through git hooks.

GitHub-hosted runners do not run those hooks during checkout, so the workflows create `GIT_COMMIT` explicitly before building.

That keeps backend version reporting and frontend build metadata aligned inside the container image.

## Best-Practice Boundaries

This workflow intentionally follows these release rules:

- validate on pull requests without pushing images
- publish only from immutable tags or released versions
- keep `VERSION` as the single version source of truth
- publish a stable semantic version tag and a signed digest
- treat `latest` as a convenience alias, not the canonical artifact
- block release and tag-based publication on container smoke-test failures and vulnerability findings
- keep override-based test publishes informative by surfacing Trivy findings without turning them into a release gate
- use the weekly image scan on `main` to catch newly disclosed image vulnerabilities between releases

