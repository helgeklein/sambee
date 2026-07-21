+++
title = "Docker Release Overview"
+++

Sambee ships one production container image built from the repository-root Dockerfile.

The release flow builds a candidate image once, validates it, and later promotes that same image to `stable` or `beta`.

## Summary

If you want to publish a new Docker image:

1. Increment `VERSION` to the next `X.Y.Z` value and run `./scripts/sync-version`.
1. Run `Release: Create Docker Image`.
   - If the workflow's source version field is left blank, the image is built from the current commit in `main` and the Git tag `build-vX.Y.Z` is created to reserve the version for the commit the image is built from.
   - If a source version field is specified, the workflow verifies and repairs the image associated with the version via the Git tag used for reservation.
1. The workflow:
   - assures concurrency via unique `staging-<run>-<attempt>-<platform>` Docker tags
   - builds the image
   - validates and signs the image
   - creates immutable `build-vX.Y.Z` Git commit and Docker image tags
   - moves the `test` Docker tag to the newly built image
1. Test the new image via the `test` Docker image tag.
1. To move the `beta` Docker tag to the newly built image, run `Release: Publish Docker Image` manually.
1. To publish the newly built image as `stable`, run `Release: Create Public Sambee Release` publish the resulting GitHub release.
   - Release publication verifies the existing signed candidate and moves only the authorized mutable aliases. It never rebuilds an image.

Read the detailed pages in this order:

1. [Build Docker Image](../build-docker-image/)
2. [Promote Docker Image](../promote-docker-image/)
3. [Docker Backfill And Cleanup](../docker-backfill-and-cleanup/)

## Workflow Map

| Workflow | When to use it | Result |
|---|---|---|
| `CI: Validate Docker Image` | Any pull request, push to `main`, or manual smoke-test run. | Proves the production image still builds and starts, but does not publish anything. |
| `Release: Create Docker Image` | To create an image for the current `main` commit or to verify/repair an image for an commit identified by its version tag. | Builds, validates, publishes the metadata bundle, marks that image as the current `test` image, and signs it. |
| `Release: Publish Docker Image` | Run manually: to promote an image to `beta`.<br />Is run automatically when publishing a GitHub Release to promote an image to `stable`. | Verifies the existing preview-built image. Manual beta promotion moves only `beta`; public-release promotion moves `stable`, the minor-series tag, and catches `beta` up unless it already points to a higher version. |
| `Maintenance: Backfill Docker Release Tags` | You need to restore or attach release tags for an already approved GitHub Release. | Reapplies release tags and channel aliases to an existing image without publishing a new runtime image. |
| `Maintenance: Clean Up Docker Package Versions` | Clean up Docker image tag history and remove unreferenced GHCR artifacts. | Deletes unprotected SHA-tagged preview GHCR versions, prunes stale signature artifacts, and removes unreferenced untagged package versions while preserving release-tagged artifacts and protected aliases including `test`. |

## Channels And Tags

Sambee publishes three moving channel tags:

- `stable` for the approved production image.
- `beta` for the approved preview image.
- `test` for the most recently verified candidate image.

Each candidate creates immutable tags:
- Git: `build-vX.Y.Z`
- Docker: `build-vX.Y.Z`, `X.Y.Z`, and `sha-<full-commit-sha>`

During publication, the workflow pushes native platform manifests by digest before it assembles the final multi-platform index. Those digest-only platform pushes are implementation details of the publish workflow and are not user-facing tags.

Release workflows identify the target image by resolving the immutable Docker tag and attaching the appropriate release tags to the same image.

`latest` is intentionally not published.

## Published Artifact

The published container artifact is a multi-platform image index in GitHub Container Registry (GHCR) for:

- `linux/amd64`.
- `linux/arm64`.

The repository name is `ghcr.io/<owner>/sambee`.

Each platform variant comes from the same Dockerfile, is built and validated on a native runner, and is assembled into the same candidate index digest.

Cosign signatures for that image digest are stored in a dedicated GHCR signature repository rather than in the main image repository. Cosign manages its own digest-derived signature artifact layout in that repository, so GHCR may show both tagged signature entries and referenced untagged bundle manifests for a retained image digest.

SBOM and provenance data for that digest are extracted per platform on native runners, assembled into one metadata bundle, and published in the dedicated `ghcr.io/<owner>/sambee-signatures` repository under a digest-derived `.meta` tag.

Release and backfill workflows also upload the exact bundle files to the GitHub Release as convenience assets. The GHCR `.meta` artifact remains the canonical metadata bundle.

## Security Model

A new Docker build forces a fresh rebuild of the Dockerfile layer that installs Debian packages for the workflow run, so release candidates pick up the latest Debian package fixes available at build time instead of relying only on a previously cached OS-package layer.

It also:

- publishes an SBOM and provenance metadata bundle under the digest-derived `.meta` tag in `ghcr.io/<owner>/sambee-signatures`.
- signs the digest with Cosign using GitHub Actions OIDC.
