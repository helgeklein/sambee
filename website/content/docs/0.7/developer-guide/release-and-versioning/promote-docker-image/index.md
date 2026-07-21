+++
title = "Promote Docker Image"
+++

This is step 2 of the Docker release flow.

Use this `Release: Publish Docker Image` workflow to move the `beta` or `stable` tags to an existing Docker image, and to apply version tags to the image (stable releases only).

## How To Trigger the Workflow

Use this order:

1. Identify the commit whose preview image you validated from the tag on the GHCR Docker image (`sha-<commit>`).
1. Create the release Git tag on that exact commit.
1. Push the tag to GitHub.
1. Publish the GitHub Release from that tag.

For example, if the approved commit is `89378a28b18ba6532571e62734a6a9aefac6c99a` and `VERSION` is `0.7.0`:

### Beta Example

```bash
git tag -a v0.7.0-beta.1 89378a28b18ba6532571e62734a6a9aefac6c99a -m "Sambee 0.7.0 beta 1"
git push origin v0.7.0-beta.1
```

### Stable Example

```bash
git tag -a v0.7.0 89378a28b18ba6532571e62734a6a9aefac6c99a -m "Sambee 0.7.0"
git push origin v0.7.0
```

In the GitHub web UI, create a release from the existing tag. Avoid the branch selection.

## Validation

Before promotion, the workflow checks all of the following:

1. Stable releases must use the tag `v$(cat VERSION)`. Prereleases must start with that same base version and add a prerelease suffix, for example `v0.8.0-beta.1`.
1. The corresponding immutable preview candidate tag `sha-<full-commit-sha>` exists in GitHub Container Registry.
1. The candidate image labels match the expected revision, checked-in product version, and source repository.
1. The preview-built SBOM and provenance metadata bundle exists under the expected digest-derived `.meta` tag and matches the candidate digest.

If any of those checks fail, promotion stops.

## Published Tags

Stable releases publish:

- The full version tag, such as `0.7.0`.
- The moving minor-series tag, such as `0.7`.
- The moving channel tag `stable`.
- The moving channel tag `beta`, unless `beta` already points to a higher semver release.

Prereleases publish:

- The moving channel tag `beta`.

That stable-release `beta` catch-up rule uses standard semver precedence. Build metadata does not make a version newer for ordering purposes.

After the tag-promotion steps finish, the workflow uploads `metadata.json`, `provenance/intoto.jsonl`, and the platform SPDX SBOM files to the GitHub Release as convenience assets. The digest-derived `.meta` artifact in `ghcr.io/<owner>/sambee-signatures` remains the canonical metadata bundle.

The workflow then signs the promoted digest with Cosign. That signing step covers the same image digest that was validated and promoted.

## Why No Rebuild

This model avoids rebuilding at release time.

The image tested as a preview candidate is therefore the exact same image that later becomes `stable` or `beta`. The preview-generated SBOM and provenance bundle is also verified against that same digest during promotion.

## Tag Contract

Docker image promotion expects release tags to use the checked-in base version from `VERSION`.

Examples:

- `VERSION` contains `0.7.0`.
- A stable Git tag and GitHub Release must be `v0.7.0`.
- A prerelease Git tag and GitHub Release may be `v0.7.0-beta.1`.

If those values drift apart, promotion fails.
