+++
title = "Build Companion Release"
+++

This is step 1 of the Companion release flow.

Use this workflow to create the published Companion release assets for one version. GitHub Actions displays this workflow as `Release: Build Companion Artifact`. It builds release artifacts and creates a draft GitHub Release for a new, unique Companion tag, but it does not decide which update channels see that release.

## Use It When

Run the build workflow when:

- You want to publish a new Companion version.
- You want fresh installer and updater artifacts in the public Companion release repository.
- You are preparing a release that may later be promoted to `test`, `beta`, `stable`, or Sambee download metadata.

Do not use this workflow to change channel visibility.
That is the job of `Release: Promote Companion Release`.

## Input

The manual workflow exposes one optional version override plus one checkbox per platform:

| Input | What it means | Typical usage |
|---|---|---|
| `publish_version_override` | Use a temporary version for this run instead of the checked-in `VERSION` value. | Set it for prerelease, beta, rc, or test builds such as `0.8.0-beta.1` without changing the repository version. |
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

If you leave `publish_version_override` empty, the workflow uses the checked-in `VERSION` value and verifies that all synced metadata files are already committed.
If you set `publish_version_override`, the workflow writes that value into the synced Companion metadata files for this run only.

The workflow fails early if the resulting release tag already exists in `helgeklein/sambee-companion`, whether that release is still a draft or already published.
Choose a distinct prerelease suffix such as `-beta.1` or `-rc.1` when you need another build before the official release.

If you check `build_all_platforms`, the workflow builds the full matrix and ignores the per-platform checkboxes.
If you leave every checkbox cleared, the workflow does not build anything.
Check only the platforms you want when you deliberately need a partial release.

## What It Does

Before packaging, the workflow:

1. Checks out the main repository.
2. Resolves the effective Companion version from either the checked-in `VERSION` file or `publish_version_override`.
3. Fails early if the resulting release tag already exists in `helgeklein/sambee-companion` as either a draft or a published release.
4. Either runs version-sync verification or applies the temporary override version for this run.
5. Builds the platform matrix derived from the checked boxes.
6. Uses Tauri packaging to upload assets into a draft release in `helgeklein/sambee-companion`.

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

The workflow uses the tag format `companion-v<effective-version>`.

That means an override such as `0.8.0-beta.1` produces the tag `companion-v0.8.0-beta.1`.

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
2. For a prerelease or test build, decide the distinct override version you want to use for this run, for example `0.8.0-beta.1`.
3. Start `Release: Build Companion Artifact` from the commit you want to release.
4. Leave `publish_version_override` empty for the checked-in version, or set it to the temporary prerelease version you want for this run.
5. Check `build_all_platforms` for a normal full release, or check only the specific platform boxes you want for a partial release. If you leave all boxes cleared, the workflow skips artifact builds.
6. Wait for the workflow to create the draft release in `helgeklein/sambee-companion`.
7. Review the uploaded assets and publish the draft release.
8. Continue with [Promote Companion Release](../promote-companion-release/).
