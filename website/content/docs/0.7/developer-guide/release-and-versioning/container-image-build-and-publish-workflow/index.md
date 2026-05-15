+++
title = "Container Image Build and Publish Workflow"
+++

Sambee ships as one production container image built from the repository-root Dockerfile.

That image compiles the frontend, installs the backend and system dependencies, and serves the built frontend from the Python backend at runtime.

The workflow now separates image creation from release promotion so GitHub Releases promote an already validated artifact instead of rebuilding from scratch.

## Purpose and Current Model

The container release workflow exists to make four things true at the same time:

- pull requests prove the production image still builds and starts correctly
- preview publishing produces a real deployable candidate from an immutable source ref
- release publication promotes an already published candidate digest instead of creating a second artifact
- operators get stable channel tags, immutable release tags, and a signed digest they can deploy safely

The production packaging remains one runtime image, not separate frontend and backend images.

## Main Control Points

| File or system | Role |
|---|---|
| `Dockerfile` | builds the production image |
| `.github/workflows/docker-image-validate.yml` | builds the image on `main`, pull requests, and manual dispatch, then smoke-tests it |
| `.github/workflows/docker-image-preview-publish.yml` | validates, builds, publishes, and signs preview candidates for the `test` channel |
| `.github/workflows/docker-image-publish.yml` | promotes an existing preview candidate onto release tags and the `stable` or `beta` channel |
| `.github/workflows/docker-image-backfill.yml` | reattaches release tags and channel aliases for an existing GitHub Release without rebuilding |
| `.github/workflows/docker-image-cleanup-test.yml` | deletes older test-only GHCR package versions |
| `VERSION` | source of truth for the product version |
| `GIT_COMMIT` | build metadata file copied into the image during CI |

## Release Channels

Sambee publishes three moving channel tags:

- `stable` for the current non-prerelease release line
- `beta` for the current prerelease release line
- `test` for the newest manually published preview candidate

These tags are convenience aliases.

The canonical artifact identity is always the registry digest.

Every preview publish also writes an immutable candidate lookup tag in this format:

- `sha-<full-commit-sha>`

Release promotion resolves that immutable candidate tag first, verifies its metadata, and then attaches the release tags and channel tag to the same digest.

`latest` is intentionally not published.

## Artifact Shape

The published image is:

- platforms: `linux/amd64` and `linux/arm64`
- registry: GitHub Container Registry
- repository name: `ghcr.io/<owner>/sambee`

The published artifact is a multi-platform image index.

Each platform variant is built from the same Dockerfile and published under the same digest, so operators can pull the same image tag on either supported Linux architecture.

## Validation Workflow

The validation workflow runs on pull requests, pushes to `main`, and manual dispatch.

GitHub Actions displays it as `CI: Validate Docker Image`.

Its contract remains:

1. check out the repository
2. run the existing version-sync verification
3. generate `GIT_COMMIT` directly in CI because local git hooks are not present on GitHub runners
4. build each supported platform variant locally with Buildx
5. start each built container variant with test-only secrets
6. wait for `/api/health` to respond successfully for each platform variant

This stays separate from publishing and exists to catch Docker packaging regressions early.

## Preview Publish Workflow

The preview publish workflow runs only by manual dispatch.

GitHub Actions displays it as `Preview: Publish Test Docker Image`.

It is the only workflow that builds and pushes a new Sambee image to GHCR.

Its contract is intentionally strict before publication:

- backend type checks pass
- backend tests pass
- frontend type checks pass
- frontend tests pass
- each supported platform image builds and starts successfully

After validation, it:

1. builds the multi-platform image
2. publishes it under `sha-<full-commit-sha>`
3. moves the `test` tag onto that same digest
4. emits SBOM and provenance attestations
5. signs the digest with Cosign using GitHub Actions OIDC

The preview workflow also runs Trivy before publish.

For the `test` channel, Trivy findings remain visible but are advisory rather than blocking.

That lets developers publish the newest preview candidate while still surfacing security risk clearly.

### Preview Inputs

Manual preview publishing accepts:

- `source_ref`: the immutable commit SHA or tag to build from. If omitted, the dispatched commit SHA is used.
- `publish_version_override`: an optional test-only version string to publish instead of the checked-out `VERSION` value

If `publish_version_override` is set:

- CI rewrites `VERSION` for that run only
- CI reruns `./scripts/sync-version` so frontend and companion metadata stay aligned
- invalid values such as `0.1-test1` are rejected before the build starts
- the run is treated as a preview publish, not as a normal release artifact

## Release Promotion Workflow

The release workflow runs only from `release.published`.

GitHub Actions displays it as `Release: Publish Docker Image`.

It does not build a new image.

Instead it:

1. checks out the published release tag
2. verifies that the release tag matches `v$(cat VERSION)` exactly
3. resolves the existing candidate image tag `sha-<full-commit-sha>` in GHCR
4. verifies the candidate image labels for revision, version, and source repository
5. verifies that the preview-built provenance and SBOM attestations are still attached to the candidate image index for each runnable platform manifest
6. attaches the correct release tags and channel tag to that same digest
7. signs the promoted digest with Cosign using GitHub Actions OIDC

If candidate resolution fails or the metadata does not match, release promotion stops immediately instead of silently rebuilding or publishing a mismatched artifact.

## Tagging Contract

Release tags are expected to use this format:

- `vX.Y.Z`

That tag must match the plain version string in `VERSION`.

For example:

- `VERSION` contains `0.7.0`
- the release tag must be `v0.7.0`

If those values drift apart, promotion fails instead of silently publishing a misleading image.

## Published Image Tags

Stable releases publish:

- full version tag such as `0.7.0`
- moving minor-series tag such as `0.7`
- moving channel tag `stable`

Prereleases publish:

- full prerelease version tag such as `0.8.0-beta.1`
- moving prerelease-series tag such as `0.8-beta`
- moving channel tag `beta`

Preview publishes write:

- immutable candidate tag such as `sha-<full-commit-sha>`
- moving channel tag `test`

Operationally, the digest remains the canonical deployment target.

## Metadata, SBOM, Provenance, and Signing

The published image includes OCI metadata labels for:

- source repository
- source ref name
- git revision
- version
- creation time
- license

Preview publication emits:

- SBOM attestations
- build provenance attestations

Because release workflows promote the same digest instead of rebuilding it, those attestations stay attached to the exact artifact that later becomes `stable` or `beta`.

Release promotion and manual backfill now verify that those BuildKit attestation manifests are present and still linked to the candidate image index before any release or channel tags are attached.

After preview publish or release promotion, the workflows sign the digest with Cosign using GitHub Actions OIDC identity.

That avoids repository-managed signing keys while still producing a verifiable signature trail.

## Operator Flow

The intended release flow is:

1. update `VERSION`
2. run `./scripts/sync-version`
3. review and merge the version-sync metadata changes emitted by `./scripts/sync-version`
4. manually run `Preview: Publish Test Docker Image` for the immutable commit you want to ship
5. validate that preview candidate in an environment appropriate for the target channel
6. create the immutable release tag `vX.Y.Z`
7. publish the GitHub Release
8. let `Release: Publish Docker Image` resolve, verify, promote, and sign the existing candidate digest
9. deploy by digest rather than by mutable tag where possible

## Manual Backfill and Cleanup

Backfill is a separate maintenance workflow.

Use `.github/workflows/docker-image-backfill.yml` only when you need to reattach release tags and channel aliases for an already approved GitHub Release, for example:

- backfilling the container release process for an older tagged version
- repairing tags after a transient registry or runner failure

Cleanup is also separate.

`.github/workflows/docker-image-cleanup-test.yml` periodically deletes older test-only GHCR package versions while keeping:

- release-tagged versions
- `stable`, `beta`, and series-tagged versions
- the newest retained set of test-only candidates

That keeps the `test` channel usable without letting preview history grow without bound.

## Why the Workflow Generates `GIT_COMMIT`

The Dockerfile copies `GIT_COMMIT` into both the frontend build stage and the runtime image.

Local development usually keeps that file current through git hooks.

GitHub-hosted runners do not run those hooks during checkout, so the workflows create `GIT_COMMIT` explicitly before building.

That keeps backend version reporting and frontend build metadata aligned inside the container image.

## Best-Practice Boundaries

This workflow intentionally follows these release rules:

- validate on pull requests without pushing images
- build new images only in the preview workflow
- promote released images only from immutable preview candidates
- keep `VERSION` as the single version source of truth
- publish stable semantic version tags, prerelease series tags, and signed digests without a `latest` alias
- treat channel tags as convenience aliases, not as the canonical artifact
- verify candidate metadata before attaching release or channel tags
- block release promotion when candidate resolution or metadata verification fails
- keep preview publishes informative by surfacing Trivy findings without turning them into a release gate
- use the weekly image scan on `main` to catch newly disclosed image vulnerabilities between releases
