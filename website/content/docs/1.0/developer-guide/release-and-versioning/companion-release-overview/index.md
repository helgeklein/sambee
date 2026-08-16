+++
title = "Companion Release Overview"
+++

Sambee Companion releases are built and published once, and later promoted across update channels by changing public feed files.

Key differences between the Companion and Docker release paths:

- Docker releases promote an already published container image.
- Companion releases promote an already published GitHub Release by rewriting feeds read by Companion's auto-updater and by the Sambee frontend.
- Docker images are available for Linux only, whereas Companion is a native app for Windows, Linux, and macOS. Each platform binary needs to be built on the respective OS.

## Summary

If you want to take a new Companion version to the `stable` update channel, follow this order:

1. Increment `VERSION` to the next `X.Y.Z` value and run `./scripts/sync-version`.
1. Run `Release: Build Companion Artifact`:
   - Select target platforms
   - If the workflow's source version field is left blank, the artifact is built from the current commit in `main`, and the Git tag `build-vX.Y.Z` is created to reserve the version for the commit the artifact is built from.
   - If a source version field is specified, the workflow verifies and repairs the artifact associated with the version via the Git tag used for reservation.
1. The workflow:
   - builds Companion
   - signs the build artifacts
   - creates one immutable draft release in in the [Companion GitHub repo](https://github.com/helgeklein/sambee-companion/releases).
   - assigns a `companion-vX.Y.Z` tag to the draft release.
1. Test the draft release.
   - Download the installer from the release's artifacts, install and test.
1. Publish the draft release. This:
   - Makes the release eligible for promotion to the `test`, `beta`, and `stable` channels.
   - Prevents additional build workflow runs changing the published Companion release.
1. To promote the release to the update channels, run `Release: Promote Companion Release`:
   - Select the channels: `test`, `beta`, and/or `stable`.
   - Select whether to update the Sambee download metadata.

One published release can move from `test` to `beta` to `stable` without rebuilding binaries.

Read the detailed pages in this order:

1. [Build Companion Release](../build-companion-release/)
1. [Promote Companion Release](../promote-companion-release/)
1. [Companion Channels, Feeds, And Downloads](../companion-channels-feeds-and-downloads/)

## Workflow Map

| Workflow | When to use it | Result |
|---|---|---|
| Local `npm run check:rust:windows` | You want an early local Windows-target compatibility signal while working in Linux or the devcontainer. | Runs a Windows GNU target `cargo check` only. It does not create signed release assets. |
| `Release: Build Companion Artifact` | You want to create release assets for one canonical version. | Builds the selected platform set and creates, resumes, or reports the immutable draft GitHub Release in [helgeklein/sambee-companion](https://github.com/helgeklein/sambee-companion/). |
| `Release: Promote Companion Release` | A published Companion release is approved for one or more channels or for Sambee download metadata. | Rewrites the selected feed files in `docs/feeds` of the release repository. |

## Main Control Points

| File or system | Role |
|---|---|
| `.github/workflows/build-companion.yml` | Builds platform artifacts from a canonical source and creates or resumes one draft release for its immutable tag. |
| `.github/workflows/promote-companion-release.yml` | Promotes one published release to selected public feeds. |
| `.github/scripts/promote_companion_release.py` | Resolves release assets and writes the feed JSON files. |
| [helgeklein/sambee-companion](https://github.com/helgeklein/sambee-companion/) | Dedicated public release repository for Companion GitHub Releases and committed feed source files. |
| `release-repo/docs/feeds` | Source-controlled feed JSON files that promotion updates and commits ([docs](../companion-channels-feeds-and-downloads/)). |

## Published Artifact

Published Companion releases live in [helgeklein/sambee-companion](https://github.com/helgeklein/sambee-companion/) as GitHub Releases.

Each release may contain:

- Installer assets.
- Tauri updater bundles.
- `.sig` files for updater verification.
- Release notes.
