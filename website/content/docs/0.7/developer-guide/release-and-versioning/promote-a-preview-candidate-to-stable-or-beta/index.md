+++
title = "Promote Docker Candidate"
+++

This is step 2 of the Docker release flow.

Use this workflow when an already tested preview candidate should become an official Docker release.

GitHub Actions displays this workflow as `Release: Publish Docker Image`.

It runs from `release.published` and promotes an existing image digest. It does not build a new image.

## Path To Stable

To take a version to `stable`, follow this sequence:

1. Update `VERSION`.
2. Run `./scripts/sync-version`.
3. Review and merge the resulting version-sync changes.
4. Run [Publish Test Docker Candidate](../publish-a-preview-docker-image/) for the exact commit you want to ship.
5. Validate that preview candidate.
6. Create the Git tag `vX.Y.Z` from that same commit.
7. Publish the GitHub Release.
8. Let `Release: Publish Docker Image` verify and promote the already published candidate digest.

For prereleases, the same flow promotes the candidate to `beta` instead of `stable`.

## Promotion Checks

Before promotion, the workflow checks all of the following:

1. The published release tag matches `v$(cat VERSION)` exactly.
2. The corresponding immutable preview candidate tag `sha-<full-commit-sha>` exists in GitHub Container Registry.
3. The candidate image labels match the expected revision, version, and source repository.
4. The preview-built SBOM and provenance metadata bundle exists under the expected digest-derived `.meta` tag and matches the candidate digest.

If any of those checks fail, promotion stops.

## Published Tags

Stable releases publish:

- The full version tag, such as `0.7.0`.
- The moving minor-series tag, such as `0.7`.
- The moving channel tag `stable`.

Prereleases publish:

- The full prerelease tag, such as `0.8.0-beta.1`.
- The moving prerelease-series tag, such as `0.8-beta`.
- The moving channel tag `beta`.

The digest stays the canonical deployment target.

After the release tags are attached, the workflow uploads `metadata.json`, `provenance/intoto.jsonl`, and the platform SPDX SBOM files to the GitHub Release as convenience assets. The digest-derived `.meta` artifact in `ghcr.io/<owner>/sambee-signatures` remains the canonical metadata bundle.

## Why No Rebuild

This model avoids rebuilding at release time.

The thing tested as a preview candidate is therefore the exact thing that later becomes `stable` or `beta`. The preview-generated SBOM and provenance bundle is also verified against that same digest during promotion.

## Tag Contract

Docker image promotion expects Git tags in the `vX.Y.Z` form.

Examples:

- `VERSION` contains `0.7.0`.
- The Git tag and GitHub Release must be `v0.7.0`.

If those values drift apart, promotion fails.

## After Promotion

Once the release workflow succeeds:

1. Deploy by digest where possible.
2. Use `stable` or `beta` only when you intentionally want the moving channel alias.
3. Use the admin deployment guidance if you are updating operator-facing examples or deployment instructions.

See [Deploy Sambee with Docker](../../../admin-guide/installation-and-deployment/deploy-sambee-with-docker/) for the operator view.

See [Container Image Security and Artifact Integrity](../../security/container-image-security-and-artifact-integrity/) for the signing and metadata-bundle details.

