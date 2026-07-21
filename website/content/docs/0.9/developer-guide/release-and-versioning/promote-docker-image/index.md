+++
title = "Promote Docker Image"
+++

This is step 2 of the Docker release flow ([overview](../docker-release-overview/)).

Use this `Release: Publish Docker Image` workflow to move Docker channel pointers to an already signed, immutable build. It has separate beta and stable paths.

## How To Trigger the Workflow

### Promote Beta

To promote an approved candidate to `beta`, run the workflow manually from `main` and enter its canonical build version, `X.Y.Z`.

The workflow resolves and verifies `build-vX.Y.Z`, then moves only the `beta` pointer. It does not create a public Git tag or GitHub Release, move `stable`, or add a minor-series tag. Normal beta promotion never moves the channel to an older version.

### Promote Stable

Use this order to promote a candidate to `stable`:

1. Identify the approved canonical build tag, `build-vX.Y.Z`.
1. Create the public Git tag `vX.Y.Z` on that same commit.
1. Add `sambee-release.json` to the draft public release with `schema_version`, `version`, `build_tag`, `source_sha`, and `component_scope`.
1. Set `component_scope` to `docker` or `both`, then publish the GitHub Release.

For example, if the approved commit is `89378a28b18ba6532571e62734a6a9aefac6c99a` and `VERSION` is `0.7.0`:

```bash
git tag -a v0.7.0 89378a28b18ba6532571e62734a6a9aefac6c99a -m "Sambee 0.7.0"
git push origin v0.7.0
```

In the GitHub web UI, create a release from the existing tag. Avoid the branch selection.

## Validation

### Beta Validation

Before beta promotion, the workflow checks all of the following:

1. The workflow was dispatched from `main` with a plain numeric `X.Y.Z` build version.
1. The corresponding `build-v<version>` Git tag exists, is reachable from `main`, and identifies a source whose checked-in `VERSION` matches the requested version.

### Stable Validation

Before stable promotion, the workflow checks all of the following:

1. The release tag is exactly `v$(cat VERSION)` and is not a prerelease.
1. The corresponding `build-v<version>` Git and GHCR markers identify the same source and image.
1. `sambee-release.json` authorizes Docker or both components and matches the version, build tag, and source SHA.

### Common Validation

Both promotion paths check all of the following:

1. The candidate image labels match the expected revision, checked-in product version, and source repository.
1. The preview-built SBOM and provenance metadata bundle exists under the expected digest-derived `.meta` tag and matches the candidate digest.
1. The candidate digest has the expected Cosign signature from the preview-build workflow.

If any of those checks fail, promotion stops.

## Published Tags

Beta promotion moves only the `beta` pointer.

Stable promotion moves these mutable pointers:

- The moving minor-series tag, such as `0.7`.
- The moving channel tag `stable`.
- The `beta` tag when it is absent or does not point to a higher version.

The exact `X.Y.Z`, source-SHA, and `build-vX.Y.Z` tags were created by the build workflow and are immutable.

After the tag-promotion steps finish, the workflow uploads `metadata.json`, `provenance/intoto.jsonl`, and the platform SPDX SBOM files to the GitHub Release as convenience assets. The digest-derived `.meta` artifact in `ghcr.io/<owner>/sambee-signatures` remains the canonical metadata bundle.

The build workflow signs the digest with Cosign before it assigns immutable registry markers. Promotion only moves pointers after verifying that published artifact.

## Why No Rebuild

This model avoids rebuilding at release time.

The image tested as a preview candidate is therefore the exact same image that later becomes `stable` or `beta`. The preview-generated SBOM and provenance bundle is also verified against that same image during promotion.

## Tag Contract

Docker image promotion expects a plain release tag matching the checked-in version from `VERSION`.

Examples:

- `VERSION` contains `0.7.0`.
- A stable Git tag and GitHub Release must be `v0.7.0`.
If those values drift apart, promotion fails.
