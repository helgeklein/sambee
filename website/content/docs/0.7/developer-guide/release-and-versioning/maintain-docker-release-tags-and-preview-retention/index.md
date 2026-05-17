+++
title = "Docker Backfill And Cleanup"
+++

This is the maintenance page for the Docker release flow.

Use these maintenance workflows when you need to repair tags, backfill an older approved release, or keep preview history under control.

## Backfill

GitHub Actions displays the recovery workflow as `Maintenance: Backfill Docker Release Tags`.

Use it when you need to reattach release tags and channel aliases for an already approved GitHub Release without publishing a new runtime image.

Typical cases include:

- Backfilling the Docker release process for an older tagged version.
- Repairing tags after a transient registry or runner failure.

The release tag can be either a stable tag such as `v0.7.0` or a prerelease tag such as `v0.7.0-beta.1`, as long as it matches the checked-in base `VERSION` for that release commit.

The backfill workflow follows the same core safety rules as normal promotion:

- It resolves an existing candidate digest.
- It verifies image metadata.
- It verifies the preview-built metadata bundle, generating and publishing it first if an older release does not have one yet.
- It reapplies the expected release and channel tags to that same digest.
- It uploads the metadata bundle files to the GitHub Release as convenience assets.

When an older release does not have the new metadata bundle yet, backfill may create a local attested OCI export from the tagged source to recover SBOM and provenance files. That export is used only to publish the missing metadata bundle; the runtime image digest being promoted does not change.

Use backfill only for already approved releases. It is not an alternate way to publish a new image.

## Cleanup

GitHub Actions displays the retention workflow as `Maintenance: Clean Up Docker Package Versions`.

This workflow periodically deletes unprotected preview and unreferenced GitHub Container Registry versions while preserving:

- release-tagged versions.
- `stable`, `beta`, `test`, and series-tagged versions.

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
| Tagged with a release tag such as `0.7.0` or `0.7.0-beta.1` | Keep |
| Tagged with a protected channel or series tag such as `stable`, `beta`, `test`, `0.7`, or `0.7-beta` | Keep |
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

If you are starting from a new candidate commit rather than repairing an existing release path, go back to [Publish Test Docker Candidate](../publish-a-preview-docker-image/) or [Promote Docker Candidate](../promote-a-preview-candidate-to-stable-or-beta/).

