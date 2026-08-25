+++
title = "Build Companion Release"
+++

This is step 1 of the Companion release flow.

Use `Release: Build Companion Artifact` to create one immutable Companion release from a canonical build version. The workflow builds the selected platforms, verifies their manifests, publishes the GitHub Release automatically, promotes it to the `test` updater channel, and removes obsolete releases.

## Input

The workflow accepts an optional existing build version and platform checkboxes.

| Input | What it means |
|---|---|
| `build_version` | Build the commit reserved by `build-vX.Y.Z`. Leave it empty to reserve the current `main` commit. |
| `build_all_platforms` | Include every supported platform. |
| Platform checkboxes | Build only the selected platforms. |

New builds must start from `main`. The workflow verifies synchronized version metadata, reserves the exact source commit, and accepts only plain numeric `X.Y.Z` versions. It never changes an existing build tag.

If no platform is selected, the workflow does not create or promote a release.

## What It Does

The workflow:

1. Resolves the canonical `build-vX.Y.Z` source commit.
1. Builds, signs, and records a manifest for every selected platform.
1. Downloads and verifies the retained build artifacts in the finalizer.
1. Creates a private provisional GitHub Release while assets are uploaded.
1. Verifies the aggregate manifest, provenance, completion marker, and every release asset.
1. Publishes `companion-vX.Y.Z` automatically after verification succeeds.
1. Promotes only the Companion `test` updater feed to the published release.
1. Cleans up obsolete Companion GitHub Releases.

The temporary draft is an upload and recovery boundary, not a review step. A release becomes public only after its complete verified asset set is present.

## Recovery And Immutability

Once an asset is present, the provisional release accepts only a missing asset or an existing byte-identical asset. A conflicting replacement fails.

If finalization is interrupted, a later run uses the exact retained Actions artifact IDs, digests, run ID, attempt, platform, and target recorded in provenance. It does not rebuild the artifact matrix. Expired, missing, ambiguous, or mismatched retained artifacts require a new `Z` candidate.

If publication succeeds but the `test` feed push fails, rerun the build workflow with the same build version. It verifies the already published immutable release and retries promotion without rebuilding binaries.

GitHub Actions concurrency is mutual exclusion, not a FIFO queue: only one pending run is retained for `companion-release-publication`. Avoid stacking dispatches.

## What Happens Next

The automatic flow changes only `test`. Use [Promote Companion Release](../promote-companion-release/) later when the same published release is approved for `beta`, `stable`, or Sambee download metadata.

See [Companion Release Cleanup](../companion-release-cleanup/) for the retention policy.