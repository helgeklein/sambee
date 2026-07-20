+++
title = "Build Companion Release"
+++

This is step 1 of the Companion release flow.

Use this workflow to create Companion release assets for one immutable build version. GitHub Actions displays this workflow as `Release: Build Companion Artifact`. It packages selected platforms privately first, then one finalizer creates and uploads the external draft release.

## Use It When

Run the build workflow when:

- You want to publish a new Companion version.
- You want fresh installer and updater artifacts in the public Companion release repository.
- You are preparing a release that may later be promoted to `test`, `beta`, `stable`, or Sambee download metadata.

Do not use this workflow to change channel visibility.
That is the job of `Release: Promote Companion Release`.

## Input

The manual workflow exposes an optional existing build-version selector plus one checkbox per platform:

| Input | What it means | Typical usage |
|---|---|---|
| `build_version` | Reuse an existing immutable `X.Y.Z` build. Leave empty to reserve the checked-in `VERSION` from `main`. | Use it to publish another component from an already tested build. |
| `build_all_platforms` | Include every supported platform in one run. | Check it for a normal full release. |
| `build_linux_x64` | Include the Linux x64 build. | Check it when you need Linux release assets. |
| `build_macos_arm64` | Include the macOS ARM64 build. | Check it when you need Apple Silicon macOS release assets. |
| `build_windows_x64` | Include the Windows x64 build. | Check it when you need the standard Windows desktop release assets. |
| `build_windows_arm64` | Include the Windows ARM64 build. | Check it when you need Windows on ARM release assets. |

Current platform checkboxes are:

- `build_all_platforms`
- `build_linux_x64`
- `build_macos_arm64`
- `build_windows_x64`
- `build_windows_arm64`

New builds must be dispatched from `main`. The workflow verifies synchronized metadata, reserves `build-vX.Y.Z` for the exact source commit, and rejects any version that is not plain numeric `X.Y.Z`. It never changes an existing build tag.

If you check `build_all_platforms`, the workflow builds the full matrix and ignores the per-platform checkboxes.
If you leave every checkbox cleared, the workflow does not build anything.
Check only the platforms you want when you deliberately need a partial release.

## What It Does

Before packaging, the workflow:

1. Checks out the main repository.
2. Reserves or resolves the canonical `build-vX.Y.Z` source commit.
3. Verifies synchronized version metadata.
4. Builds the platform matrix derived from the checked boxes without contacting the external release repository.
5. Uploads uniquely named private Actions artifacts.
6. Verifies checksums, writes provenance and a completion marker, then creates or resumes the external draft release from one finalizer.

The build matrix is currently configured for:

- Linux x64.
- macOS ARM64.
- Windows x64.
- Windows ARM64.

If you build only a subset, the resulting release exposes only that subset.
Promotion works from the assets actually present in the published release, not from an assumed full matrix.

## Published Output

The finalizer publishes assets into a draft GitHub Release in `helgeklein/sambee-companion`.

That release can contain:

- Installer assets.
- Tauri updater bundles.
- `.sig` files for updater verification.
- Release provenance and a completion marker describing the exact expected assets.

The workflow uses the tag format `companion-v<effective-version>`.

Channel visibility is still unset at this stage.
The build is only a published candidate until a later promotion updates the feed files.

## Review Before Publish

Before you publish the draft release, verify:

- The version metadata is correct.
- The release tag is the distinct version you intended to publish.
- The expected platform assets are present.
- The updater bundle and `.sig` pairs look complete for the platforms you expect to promote.
- The release notes are acceptable for public distribution.

If the draft contents are wrong, fix the release process and produce a new release instead of trying to patch channel metadata around a bad artifact set.

## Run the Workflow

Use this order when you are preparing a Companion release:

1. For an official release, merge the version-sync changes for the checked-in version you want to ship.
2. Start `Release: Build Companion Artifact` from `main`.
3. Leave `build_version` empty to reserve the checked-in version, or select a previously reserved build.
4. Check `build_all_platforms` for a normal full release, or check only the specific platform boxes you want for a partial release.
5. Wait for the finalizer to create the draft release in `helgeklein/sambee-companion`.
6. Review the uploaded assets, provenance, and completion marker, then publish the draft release.
7. Continue with [Promote Companion Release](../promote-companion-release/).
