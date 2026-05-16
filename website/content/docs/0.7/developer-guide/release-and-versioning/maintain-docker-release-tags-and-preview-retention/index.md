+++
title = "Docker Backfill And Cleanup"
+++

This is the maintenance page for the Docker release flow.

Use these maintenance workflows when you need to repair tags, backfill an older approved release, or keep preview history under control.

## Backfill

GitHub Actions displays the recovery workflow as `Backfill Docker Image Release`.

Use it when you need to reattach release tags and channel aliases for an already approved GitHub Release without rebuilding the image.

Typical cases include:

- Backfilling the Docker release process for an older tagged version.
- Repairing tags after a transient registry or runner failure.

The backfill workflow follows the same core safety rules as normal promotion:

- It resolves an existing candidate digest.
- It verifies image metadata.
- It verifies the preview-built metadata bundle, generating and publishing it first if an older release does not have one yet.
- It reapplies the expected release and channel tags to that same digest.

Use backfill only for already approved releases. It is not an alternate way to publish a new image.

## Cleanup

GitHub Actions displays the retention workflow as `Cleanup Test Docker Images`.

This workflow periodically deletes older test-only GitHub Container Registry versions while preserving:

- release-tagged versions.
- `stable`, `beta`, and series-tagged versions.
- the newest retained set of test-only candidates.

That keeps the `test` channel usable without letting preview history grow without bound.

## Which Workflow To Use

| Need | Workflow |
|---|---|
| Reattach tags for an existing approved release. | `Backfill Docker Image Release` |
| Repair a broken release-tag alias after an operational failure. | `Backfill Docker Image Release` |
| Remove older preview-only GHCR versions automatically. | `Cleanup Test Docker Images` |

## Boundaries

- Do not rebuild in backfill. Recovery should point tags back at an existing digest.
- Do not treat the `test` channel as permanent history. The cleanup workflow is expected to prune it.
- Do not use moving tags such as `stable`, `beta`, or `test` as the only source of deployment truth when a digest is available.

If you are starting from a new candidate commit rather than repairing an existing release path, go back to [Publish Test Docker Candidate](../publish-a-preview-docker-image/) or [Promote Docker Candidate](../promote-a-preview-candidate-to-stable-or-beta/).

