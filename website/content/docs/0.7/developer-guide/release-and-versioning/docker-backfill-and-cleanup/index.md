+++
title = "Docker Backfill And Cleanup"
+++

This is the maintenance page for the Docker release flow.

Use these maintenance workflows when you need to repair tags, backfill an older approved release, or keep preview history under control.

## Summary

Use this page when you are not publishing a new Docker image, but instead need to maintain existing release artifacts in GitHub Container Registry.

| Workflow | What it does | Required input | Use it when... |
|---|---|---|---|
| `Maintenance: Backfill Docker Release Tags` | Reattaches release tags and channel aliases to an already approved digest and republishes missing metadata bundle assets when needed. | One existing Git tag in release form, such as `v0.7.0` or `v0.7.0-beta.1`. | A release already exists, but its GHCR tags or release assets are missing, wrong, or need to be reconstructed without building a new image. |
| `Maintenance: Clean Up Docker Package Versions` | Deletes unprotected preview versions, stale signature artifacts, and unreferenced untagged GHCR package versions. | None. | Preview history and dangling GHCR artifacts have accumulated and you want the repository cleaned up without touching protected release artifacts. |

## Backfill Docker Release Tags

GitHub Actions displays the recovery workflow as `Maintenance: Backfill Docker Release Tags`.

### What it does

Use it to repair or reconstruct the publish side of an already approved Docker release without publishing a new runtime image.

The workflow:

- resolves the digest that already belongs to the approved release
- verifies image metadata
- verifies the preview-built metadata bundle, generating and publishing it first if an older release does not have one yet
- reapplies the expected release tags to that same digest
- updates channel aliases with the same semver rules as normal promotion
- uploads the metadata bundle files to the GitHub Release as convenience assets

For stable releases, that means backfill also moves `beta` forward unless `beta` already points to the same digest or to a higher semver release line.

### Required input

The workflow takes one manual input:

| Input | What it means | Required |
|---|---|---|
| `release_tag` | An existing immutable Git tag for the approved release, for example `v0.7.0` or `v0.7.0-beta.1`. The tag must match the checked-in `VERSION` value for that tagged commit. | Yes |

### When to use it

Use backfill in specific repair scenarios such as:

- The GitHub Release exists, but the expected GHCR release tags were not attached.
- A stable release was approved earlier, and you need to restore `stable`, version tags, or `beta` catch-up behavior to the correct existing digest.
- A prerelease was approved earlier, and you need to restore the `beta` alias to the already approved digest.
- A transient runner or registry failure interrupted release publication after the candidate image had already been built successfully.
- An older approved release predates the current metadata-bundle flow, and you need to reconstruct the release assets without rebuilding the runtime image.

Do not use backfill when you want to ship a new candidate commit. In that case, go back to [Publish Test Docker Candidate](../publish-test-docker-candidate/) and then [Promote Docker Candidate](../promote-docker-candidate/).

### Tag requirements

The release tag can be either a stable tag such as `v0.7.0` or a prerelease tag such as `vX.Y.Z-beta.N`, as long as it matches the checked-in base `VERSION` for that release commit.

When an older release does not have the new metadata bundle yet, backfill may create a local attested OCI export from the tagged source to recover SBOM and provenance files. That export is used only to publish the missing metadata bundle; the runtime image digest being promoted does not change.

Use backfill only for already approved releases. It is not an alternate way to publish a new image.

## Clean Up Docker Package Versions

GitHub Actions displays the retention workflow as `Maintenance: Clean Up Docker Package Versions`.

### What it does

This workflow removes disposable GHCR history while preserving artifacts that are still in use.

It:

- deletes unprotected preview package versions
- prunes stale metadata and Cosign signature artifacts
- removes unreferenced untagged package versions
- preserves release-tagged versions, protected channel aliases, and graph-referenced child manifests

### Required input

This workflow has no manual inputs.

It runs automatically after successful preview publication, on a schedule, or manually when you want to force a cleanup pass.

### When to use it

Use cleanup in specific maintenance scenarios such as:

- Preview publishing has created many old `sha-<full-commit-sha>` versions that are no longer needed.
- GHCR package pages have accumulated stale signature or metadata artifacts from deleted image digests.
- You want to verify that retention behavior is working after changes to release-tagging or cleanup logic.
- You want an immediate cleanup run instead of waiting for the next scheduled pass.

Do not use cleanup to repair a missing release tag or channel alias. Use `Maintenance: Backfill Docker Release Tags` for that.

### What cleanup preserves

This workflow periodically deletes unprotected preview and unreferenced GitHub Container Registry versions while preserving:

- release-tagged versions.
- `stable`, `beta`, `test`, and stable minor-series tags.

The moving `test` tag is protected like the other channel aliases.
Immutable `sha-<full-commit-sha>` preview tags are deleted when they are no longer protected by another retained tag.
Untagged child manifests referenced by retained multi-platform indexes are protected before stale untagged versions are deleted.
The cleanup also prunes stale `ghcr.io/<owner>/sambee-signatures` metadata and Cosign signature tags after their corresponding `sambee` image digest is no longer retained.
The same reference-aware untagged cleanup runs for `sambee-signatures`, where it keeps Cosign signature bundle children referenced by retained signature indexes.

That keeps the `test` channel usable while aggressively removing disposable preview history.

## Cleanup Rules

Use this quick reference when deciding what the cleanup workflow will keep versus delete.

| If a package version is... | Cleanup action |
|---|---|
| Tagged with a release tag, whether stable or prerelease | Keep |
| Tagged with a protected channel or series tag such as `stable`, `beta`, `test`, or `0.7` | Keep |
| Tagged only with an immutable preview tag such as `sha-<full-commit-sha>` | Delete |
| Untagged but still referenced by a retained multi-platform image index | Keep |
| Untagged and not referenced by any retained index | Delete |
| A signature or metadata artifact for a retained image digest | Keep |
| A signature or metadata artifact for a deleted image digest | Delete |

There is no retention count anymore. The workflow deletes every package version that is not protected by tags or by graph references.

## Examples

- `ghcr.io/<owner>/sambee:test` stays because `test` is a protected channel tag.
- `ghcr.io/<owner>/sambee:sha-<full-commit-sha>` is deleted if that digest is not also kept by another protected tag.
- An untagged platform manifest stays if a retained multi-platform index still points to it.
- A stale `ghcr.io/<owner>/sambee-signatures` artifact is deleted after its corresponding image digest is no longer retained.

## Which Workflow To Use

| Need | Workflow |
|---|---|
| Reattach tags for an existing approved release. | `Maintenance: Backfill Docker Release Tags` |
| Repair a broken release-tag alias after an operational failure. | `Maintenance: Backfill Docker Release Tags` |
| Remove unprotected preview versions and unreferenced artifacts automatically. | `Maintenance: Clean Up Docker Package Versions` |

## Boundaries

- Do not publish a replacement runtime image in backfill. Recovery should point tags back at an existing digest.
- Do not treat immutable `sha-<full-commit-sha>` preview tags as permanent history. The cleanup workflow is expected to prune them.
- Do not use moving tags such as `stable`, `beta`, or `test` as the only source of deployment truth when a digest is available.

If you are starting from a new candidate commit rather than repairing an existing release path, go back to [Publish Test Docker Candidate](../publish-test-docker-candidate/) or [Promote Docker Candidate](../promote-docker-candidate/).
