+++
title = "Docker Release Overview"
+++

Sambee ships one production container image built from the repository-root Dockerfile.

The release flow builds a candidate once, validates it, and later promotes that same digest to `stable` or `beta`.

Use this page as the entry point for the Docker release path.

## Path To Stable

If you want to take a new version to the `stable` image channel, follow this order:

1. Update `VERSION` and run `./scripts/sync-version`.
2. Merge the reviewed version-sync changes.
3. Run `Preview: Publish Test Docker Image` for the exact commit you want to ship.
4. Validate that preview candidate in an environment appropriate for release.
5. Create the release tag `vX.Y.Z` from that same commit.
6. Publish the GitHub Release.
7. Let `Release: Publish Docker Image` verify and promote the existing candidate digest.
8. Deploy by digest where possible, or use the promoted `stable` tag when you need the moving channel alias.

For prereleases, the flow is the same except the published GitHub Release becomes a `beta` image promotion instead of `stable`.

Read the detailed pages in this order:

1. [Publish Test Docker Candidate](../publish-a-preview-docker-image/)
2. [Promote Docker Candidate](../promote-a-preview-candidate-to-stable-or-beta/)
3. [Docker Backfill And Cleanup](../maintain-docker-release-tags-and-preview-retention/)

## Workflow Map

| Workflow | When to use it | Result |
|---|---|---|
| `CI: Validate Docker Image` | Any pull request, push to `main`, or manual smoke-test run. | Proves the production image still builds and starts, but does not publish anything. |
| `Preview: Publish Test Docker Image` | You want a real candidate image for a specific commit or tag. | Builds, validates, publishes the metadata bundle, marks that digest as the current `test` image, and signs the digest. |
| `Release: Publish Docker Image` | A GitHub Release was published from an approved candidate commit. | Verifies the existing preview-built digest, then attaches release tags and the `stable` or `beta` channel tag. |
| `Maintenance: Backfill Docker Release Tags` | You need to restore or attach release tags for an already approved GitHub Release. | Reapplies release tags and channel aliases to an existing digest without publishing a new runtime image. |
| `Cleanup Test Docker Images` | Preview history needs retention control. | Deletes older test-only GHCR versions while preserving release-tagged artifacts and protected aliases. |

## Channels And Tags

Sambee publishes three moving channel tags:

- `stable` for the current non-prerelease line.
- `beta` for the current prerelease line.
- `test` for the newest manually published preview candidate.

Each preview publish also creates an immutable lookup tag in the `sha-<full-commit-sha>` form.

Release workflows resolve that immutable candidate tag first and then attach the appropriate release tags to the same digest.

`latest` is intentionally not published.

## Published Artifact

The published container artifact is a multi-platform image index in GitHub Container Registry for:

- `linux/amd64`.
- `linux/arm64`.

The repository name is `ghcr.io/<owner>/sambee`.

Each platform variant comes from the same Dockerfile and is published under the same digest.

Cosign signatures for that image digest are stored in a dedicated GHCR signature repository rather than in the main image repository.

SBOM and provenance data for that digest are also published in the dedicated `ghcr.io/<owner>/sambee-signatures` repository under a digest-derived `.meta` tag.

Release and backfill workflows also upload the exact bundle files to the GitHub Release as convenience assets. The GHCR `.meta` artifact remains the canonical metadata bundle.

## Security Model

Preview publication is the only workflow that builds and pushes a new image.

It also:

- publishes an SBOM and provenance metadata bundle under the digest-derived `.meta` tag in `ghcr.io/<owner>/sambee-signatures`.
- signs the digest with Cosign using GitHub Actions OIDC.

Release promotion does not rebuild the image. It verifies candidate image metadata and the published metadata bundle first, then promotes the existing digest.

Use [Publish Test Docker Candidate](../publish-a-preview-docker-image/) for the build-and-publish flow.

Use [Promote Docker Candidate](../promote-a-preview-candidate-to-stable-or-beta/) for the release path.

Use [Docker Backfill And Cleanup](../maintain-docker-release-tags-and-preview-retention/) for recovery, backfill, and cleanup.

Use [Container Image Security and Artifact Integrity](../../security/container-image-security-and-artifact-integrity/) for the deeper signing, SBOM, provenance, and vulnerability-scanning details.

Use [Deploy Sambee with Docker](../../../admin-guide/installation-and-deployment/deploy-sambee-with-docker/) for operator-facing deployment guidance.
