+++
title = "Build Docker Image"
+++

This is step 1 of the Docker release flow ([overview](../docker-release-overview/)).

Use `Release: Create Docker Image` to build one immutable Docker candidate from `main`. It is the only workflow that builds and pushes a new Sambee image to GitHub Container Registry (GHCR).

The workflow reserves the annotated canonical Git tag `build-vX.Y.Z` for the committed, synchronized `VERSION` source. It does not publish a GitHub Release or move `stable` or `beta`.

## Inputs

The workflow accepts only an optional existing candidate selector:

| Input | What it means | Typical usage |
|---|---|---|
| `build_version` | Reuse an existing immutable `X.Y.Z` candidate. | Leave empty for a new candidate. Use an existing value only to verify or repair its immutable aliases. |

The workflow rejects arbitrary source refs, source SHAs, and temporary version overrides. The checked-in, synchronized plain numeric `VERSION` is the only publishable version source.

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
5. Publishes the candidate index under immutable `build-vX.Y.Z`, `X.Y.Z`, and `sha-<full-commit-sha>` markers.
6. Extracts per-platform SBOM and provenance payloads on native runners, then assembles and publishes the metadata bundle under the digest-derived `.meta` tag in `ghcr.io/<owner>/sambee-signatures`.
7. Signs the digest with Cosign using GitHub Actions OIDC and verifies the signature, image labels, and metadata bundle.
8. Moves `test` to that same verified image.

The digest is the real artifact identity. The canonical `build-vX.Y.Z` tag is the candidate source of truth; `test` is only a moving alias.

Later promotion may move `stable`, `beta`, or both channel aliases to that same image, depending on the release type and the current `beta` version.

The workflow uses digest-only platform pushes while assembling the final candidate index. Treat those platform manifests as internal publish artifacts, not release candidates.

Cosign writes the signature artifact into a dedicated signature repository so the main `sambee` package page stays centered on deployable image versions.
That signature repository can still show both digest-derived signature tags and referenced untagged bundle manifests, which are part of Cosign's current storage model rather than extra preview image variants.

## Retry Behavior

Before the late candidate marker is written, a failed run may be retried with the same `Z` version. The run uses a unique `staging-<run>-<attempt>-<platform>` tag and cleans it up after promotion or failure. If that immediate deletion fails, the workflow emits a warning; the Docker package cleanup workflow reclaims the disposable staging tags and their unreferenced signature and metadata artifacts. It runs after successful candidate publication and on Sunday and Tuesday schedules, so stale artifacts are retained for no more than six days.

After a valid candidate marker exists, a matching dispatch takes the repair-only path. It verifies the signed digest and restores only missing matching immutable aliases or the `test` pointer; it does not rebuild the image. A conflicting immutable marker requires incrementing `Z` and publishing a new candidate.

GitHub Actions concurrency is mutual exclusion, not a FIFO queue: only one pending run is retained for the publication lock. Avoid stacking dispatches. A superseded pending dispatch is safe to submit again because it did not reach a publication step.

## Security Scan Behavior

The preview workflow runs Trivy before publish.

For preview publishing, Trivy findings are advisory rather than blocking. That keeps the newest candidate available for testing while still surfacing risk clearly in the workflow output.

The preview scan runs against the same pushed platform digests that are later assembled into the published candidate index, so validation and publication use the same platform manifests.

Those manifests use the same OS-package refresh policy, so the candidate that gets published is rebuilt against current Debian package metadata for that workflow run.

## Metadata

The published image includes OCI labels for the source repository, source ref name, git revision, version, creation time, and license.

The workflow also generates `GIT_COMMIT` in CI before building because GitHub-hosted runners do not run the local git hooks that usually keep that file current. That keeps frontend and backend build metadata aligned inside the container image.
