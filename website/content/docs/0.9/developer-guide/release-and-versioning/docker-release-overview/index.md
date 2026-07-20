+++
title = "Docker Release Overview"
+++

Sambee ships one production container image built from the repository-root Dockerfile.

The release flow builds a candidate once, validates it, and later promotes that same digest to `stable` or `beta`.

Use this page as the entry point for the Docker release path.

## Summary

If you want to publish a new Docker image:

1. Update `VERSION` to the next committed plain `X.Y.Z` value and run `./scripts/sync-version` on `main`.
1. Run `Release: Create Docker Image`. A new candidate reserves `build-vX.Y.Z`; an existing candidate can only be selected by that version.
1. The workflow builds under unique `staging-<run>-<attempt>-<platform>` tags, validates and signs the final digest, then creates the immutable `build-vX.Y.Z` image marker and moves `test`.
1. Test the exact `test` digest.
1. Run `Release: Create Public Sambee Release` for the canonical candidate, set its component scope, review the draft, and publish it.
1. Release publication verifies the existing signed candidate and moves only the authorized mutable aliases. It never rebuilds an image.

Read the detailed pages in this order:

1. [Publish Test Docker Candidate](../publish-test-docker-candidate/)
2. [Promote Docker Candidate](../promote-docker-candidate/)
3. [Docker Backfill And Cleanup](../docker-backfill-and-cleanup/)

## Workflow Map

| Workflow | When to use it | Result |
|---|---|---|
| `CI: Validate Docker Image` | Any pull request, push to `main`, or manual smoke-test run. | Proves the production image still builds and starts, but does not publish anything. |
| `Release: Create Docker Image` | You want a real candidate image for a specific commit or tag. | Builds, validates, publishes the metadata bundle, marks that digest as the current `test` image, and signs the digest. |
| `Release: Publish Docker Image` | A Git tag was pushed and the matching GitHub Release was published from an approved candidate commit. | Verifies the existing preview-built digest, then attaches release tags, moves `stable` or `beta`, and catches `beta` up during stable publication unless `beta` already points to a higher semver release. |
| `Maintenance: Backfill Docker Release Tags` | You need to restore or attach release tags for an already approved GitHub Release. | Reapplies release tags and channel aliases to an existing digest without publishing a new runtime image. |
| `Maintenance: Clean Up Docker Package Versions` | Preview history and unreferenced GHCR artifacts need cleanup. | Deletes unprotected SHA-tagged preview GHCR versions, prunes stale signature artifacts, and removes unreferenced untagged package versions while preserving release-tagged artifacts and protected aliases including `test`. |

## Channels And Tags

Sambee publishes three moving channel tags:

- `stable` for the approved production digest.
- `beta` for the approved preview digest.
- `test` for the most recently verified candidate digest.

Each candidate creates immutable `build-vX.Y.Z`, `sha-<full-commit-sha>`, and exact-version identities. Existing immutable tags are accepted only when they resolve to the same digest.

During publication, the workflow pushes native platform manifests by digest before it assembles the final multi-platform index.
Those digest-only platform pushes are implementation details of the publish workflow and are not user-facing tags.

Release workflows resolve that immutable candidate tag first and then attach the appropriate release tags to the same digest.

`latest` is intentionally not published.

## Published Artifact

The published container artifact is a multi-platform image index in GitHub Container Registry for:

- `linux/amd64`.
- `linux/arm64`.

The repository name is `ghcr.io/<owner>/sambee`.

Each platform variant comes from the same Dockerfile, is built and validated on a native runner, and is assembled into the same candidate index digest.

Cosign signatures for that image digest are stored in a dedicated GHCR signature repository rather than in the main image repository.
Cosign manages its own digest-derived signature artifact layout in that repository, so GHCR may show both tagged signature entries and referenced untagged bundle manifests for a retained image digest.

SBOM and provenance data for that digest are extracted per platform on native runners, assembled into one metadata bundle, and published in the dedicated `ghcr.io/<owner>/sambee-signatures` repository under a digest-derived `.meta` tag.

Release and backfill workflows also upload the exact bundle files to the GitHub Release as convenience assets. The GHCR `.meta` artifact remains the canonical metadata bundle.

## Security Model

Preview publication is the only workflow that builds and pushes a new image.

That preview build also forces a fresh rebuild of the Dockerfile layer that installs Debian packages for the workflow run, so release candidates pick up the latest Debian package fixes available at build time instead of relying only on a previously cached OS-package layer.

It also:

- publishes an SBOM and provenance metadata bundle under the digest-derived `.meta` tag in `ghcr.io/<owner>/sambee-signatures`.
- signs the digest with Cosign using GitHub Actions OIDC.

Release promotion does not rebuild the image. It verifies candidate image metadata and the published metadata bundle first, then promotes the existing digest.

Use [Publish Test Docker Candidate](../publish-test-docker-candidate/) for the build-and-publish flow.

Use [Promote Docker Candidate](../promote-docker-candidate/) for the release path.

Use [Docker Backfill And Cleanup](../docker-backfill-and-cleanup/) for recovery, backfill, and cleanup.

Use [Container Image Security and Artifact Integrity](../../security/container-image-security-and-artifact-integrity/) for the deeper signing, SBOM, provenance, and vulnerability-scanning details.

Use [Deploy Sambee with Docker](../../../admin-guide/installation-and-deployment/deploy-sambee-with-docker/) for operator-facing deployment guidance.
