+++
title = "Build Companion Release"
+++

This is step 1 of the Companion release flow.

Use this workflow to create Companion release assets for one immutable build version. GitHub Actions displays this workflow as `Release: Build Companion Artifact`. It creates builds for the selected platforms, which are then uploaded to the GitHub draft release by a finalizer.

## Input

The manual workflow exposes an optional existing build-version selector plus one checkbox per platform:

| Input | What it means |
|---|---|
| `build_version` | Build the commit with the `build-vX.Y.Z` tag. Leave empty to build the latest commit and set the `build-vX.Y.Z` tag on that commit. |
| `build_all_platforms` | Include every supported platform in one run. |
| `build_linux_x64` | Include the Linux x64 build. |
| `build_macos_arm64` | Include the macOS ARM64 build. |
| `build_windows_x64` | Include the Windows x64 build. |
| `build_windows_arm64` | Include the Windows ARM64 build. |

New builds must be dispatched from `main`. The workflow verifies synchronized metadata, reserves `build-vX.Y.Z` for the exact source commit, and rejects any version that is not plain numeric `X.Y.Z`. It never changes an existing build tag.

If you check `build_all_platforms`, the workflow builds the full matrix and ignores the per-platform checkboxes.
If you leave every checkbox cleared, the workflow does not build anything.
Check only the platforms you want when you deliberately need a partial release.

## What It Does

Before packaging, the workflow:

1. Checks out the main repository.
2. Resolves the canonical `build-vX.Y.Z` source commit or assigns it to the latest commit.
3. Verifies synchronized version metadata.
4. Builds the platform matrix derived from the checked boxes.
5. Writes a per-platform artifact manifest with package names, SHA-256 checksums, installer/updater/signature roles, platform, and target; then uploads uniquely named private Actions artifacts.
6. The finalizer downloads every retained artifact, verifies the manifests and complete package sets, writes a public aggregate manifest, provenance, and completion marker, then creates or resumes the external draft release.

If you build only a subset, the resulting release exposes only that subset.
Promotion works from the assets actually present in the published release, not from an assumed full matrix.

## Build Output

The finalizer uploads assets into a draft GitHub Release in `helgeklein/sambee-companion`.

That release can contain:

- Installer assets.
- Tauri updater bundles.
- `.sig` files for updater verification.
- A public aggregate artifact manifest, uploaded before all package assets.
- Release provenance and a completion marker binding the release tag, aggregate-manifest digest, provenance digest, and exact expected assets.

### Recovery And Immutability

The draft GitHub release is immutable once any asset is present: the finalizer uploads a missing asset or accepts an existing byte-identical asset, and rejects a conflicting replacement.

If a finalizer is interrupted, a later run uses the exact retained Actions artifact IDs, digests, originating run ID, run attempt, platform, and target recorded in draft provenance. It does not rebuild matrix artifacts. Expired, missing, ambiguous, or mismatched retained artifacts require a new `Z` candidate.

GitHub Actions concurrency is mutual exclusion, not a FIFO queue: only one pending run is retained for the `companion-release-publication` lock. Avoid stacking dispatches. A superseded pending dispatch is safe to submit again because it never reached a publication step.

## Review and Publish

Review the draft GitHub release created or updated by this workflow. Then publish it.

Publishing assigns the tag `companion-vX.Y.Z`.
