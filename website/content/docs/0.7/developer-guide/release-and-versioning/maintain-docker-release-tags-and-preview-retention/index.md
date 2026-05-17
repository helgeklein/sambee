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

This workflow periodically deletes older test-only GitHub Container Registry versions while preserving:

- release-tagged versions.
- `stable`, `beta`, and series-tagged versions.
- the newest retained set of test-only candidates.

Test-only candidates include the moving `test` tag and immutable `sha-<full-commit-sha>` preview tags.
Untagged child manifests referenced by retained multi-platform indexes are protected before stale untagged versions are deleted.
The cleanup also prunes stale `ghcr.io/<owner>/sambee-signatures` metadata and Cosign signature tags after their corresponding `sambee` image digest is no longer retained.
The same reference-aware untagged cleanup runs for `sambee-signatures`, where it keeps Cosign signature bundle children referenced by retained signature indexes.

That keeps the `test` channel usable without letting preview history grow without bound.

## Which Workflow To Use

| Need | Workflow |
|---|---|
| Reattach tags for an existing approved release. | `Maintenance: Backfill Docker Release Tags` |
| Repair a broken release-tag alias after an operational failure. | `Maintenance: Backfill Docker Release Tags` |
| Remove older preview-only GHCR versions automatically. | `Maintenance: Clean Up Docker Package Versions` |

## Boundaries

- Do not publish a replacement runtime image in backfill. Recovery should point tags back at an existing digest.
- Do not treat the `test` channel as permanent history. The cleanup workflow is expected to prune it.
- Do not use moving tags such as `stable`, `beta`, or `test` as the only source of deployment truth when a digest is available.

If you are starting from a new candidate commit rather than repairing an existing release path, go back to [Publish Test Docker Candidate](../publish-a-preview-docker-image/) or [Promote Docker Candidate](../promote-a-preview-candidate-to-stable-or-beta/).

