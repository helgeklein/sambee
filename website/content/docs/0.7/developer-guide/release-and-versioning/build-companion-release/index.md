+++
title = "Build Companion Release"
+++

This is step 1 of the Companion release flow.

Use this workflow to create the published Companion release assets for one version. GitHub Actions displays this workflow as `Release: Build Companion Artifact`. It builds release artifacts and updates a draft GitHub Release, but it does not decide which update channels see that release.

## Use It When

Run the build workflow when:

- You want to publish a new Companion version.
- You want fresh installer and updater artifacts in the public Companion release repository.
- You are preparing a release that may later be promoted to `test`, `beta`, `stable`, or Sambee download metadata.

Do not use this workflow to change channel visibility.
That is the job of `Release: Promote Companion Release`.

## Input

The manual workflow accepts one input:

| Input | What it means | Typical usage |
|---|---|---|
| `platforms` | Which platform set to build. | Leave it at `all` for a normal release. Use a single platform only when you deliberately need a partial release. |

Current choices are:

- `all`
- `linux-x64`
- `macos-arm64`
- `windows-x64`
- `windows-arm64`

## What It Does

Before packaging, the workflow:

1. Checks out the main repository.
2. Runs version-sync verification.
3. Builds the selected platform matrix.
4. Uses Tauri packaging to upload assets into a draft release in `helgeklein/sambee-companion`.

The build matrix is currently configured for:

- Linux x64.
- macOS ARM64.
- Windows x64.
- Windows ARM64.

If you build only a subset, the resulting release exposes only that subset.
Promotion works from the assets actually present in the published release, not from an assumed full matrix.

## Published Output

The workflow publishes assets into a draft GitHub Release in `helgeklein/sambee-companion`.

That release can contain:

- Installer assets.
- Tauri updater bundles.
- `.sig` files for updater verification.
- Release notes.

The workflow uses the tag format `companion-vX.Y.Z`.

Channel visibility is still unset at this stage.
The build is only a published candidate until a later promotion updates the feed files.

## Review Before Publish

Before you publish the draft release, verify:

- The version metadata is correct.
- The expected platform assets are present.
- The updater bundle and `.sig` pairs look complete for the platforms you expect to promote.
- The release notes are acceptable for public distribution.

If the draft contents are wrong, fix the release process and produce a new release instead of trying to patch channel metadata around a bad artifact set.

## Run the Workflow

Use this order when you are preparing a Companion release:

1. Merge the version-sync changes for the release you want to ship.
2. Start `Release: Build Companion Artifact` from the commit you want to release.
3. Leave `platforms` at `all` unless you intentionally want a partial platform release.
4. Wait for the workflow to update the draft release in `helgeklein/sambee-companion`.
5. Review the uploaded assets and publish the draft release.
6. Continue with [Promote Companion Release](../promote-companion-release/).
