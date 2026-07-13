+++
title = "Companion Release Overview"
+++

Sambee Companion releases are built and published once, and later promoted across update channels by changing public feed files.

Key differences between the Companion and Docker release paths:

- Docker releases promote an already published container digest.
- Companion releases promote an already published GitHub Release by rewriting feeds read by Companion's auto-updater and by the Sambee frontend.
- Local Linux-hosted cross-checks can validate Windows-target compatibility, but they do not replace the Windows CI release build.

## Summary

If you want to take a new Companion version to the `stable` update channel, follow this order:

1. Update `VERSION` and run `./scripts/sync-version`.
   - Git merge the reviewed `version-sync` changes.
1. If you need a prerelease or test build before the official version, choose a distinct override version such as `0.8.0-beta.1` or `0.8.0-rc.1`.
1. Run `Release: Build Companion Artifact` and select the target platforms.
   - Leave `publish_version_override` empty for the checked-in version, or set it to the temporary prerelease version for this run.
   - This creates draft release in the GitHub repo `helgeklein/sambee-companion`.
1. Test the draft release.
   - Download the installer from the releases artifacts, install and test.
1. Publish the draft release.
1. Run `Release: Promote Companion Release` for `test`.
   - Validate both update behavior and direct-download metadata against the promoted feeds.
1. Rerun `Release: Promote Companion Release` for `beta`, `stable`, and Sambee download metadata.

Companion release tags follow the `companion-v<version>` pattern.

The build workflow refuses to reuse an existing Companion release tag, whether that release is still a draft or already published.
When you need another pre-release candidate, assign a distinct suffix instead of rebuilding the same tag.

One published release can move from `test` to `beta` to `stable` without rebuilding binaries.

Read the detailed pages in this order:

1. [Build Companion Release](../build-companion-release/)
1. [Promote Companion Release](../promote-companion-release/)
1. [Companion Channels, Feeds, And Downloads](../companion-channels-feeds-and-downloads/)

## Workflow Map

| Workflow or system | When to use it | Result |
|---|---|---|
| Local `npm run check:rust:windows` | You want an early local Windows-target compatibility signal while working in Linux or the devcontainer. | Runs a Windows GNU target `cargo check` only. It does not create signed release assets. |
| `Release: Build Companion Artifact` | You want to create release assets for one new Companion version or prerelease candidate. | Builds the selected platform set and creates a draft GitHub Release in `helgeklein/sambee-companion`, failing early if that tag already exists. |
| `Release: Promote Companion Release` | A published Companion release is approved for one or more channels or for Sambee download metadata. | Rewrites the selected feed files in `docs/feeds` of the release repository and publishes the updates at `https://release-feeds.sambee.net`. |
| `helgeklein/sambee-companion` | You need the release repository that owns public Companion release artifacts. | Hosts immutable GitHub Release assets and stores the committed feed files under `docs/feeds` to be served by GitHub Pages. |
| `https://release-feeds.sambee.net` | You need the public feed host that installed Companion builds and Sambee read. | Serves the promoted feed JSON files from GitHub Pages (not from the main `sambee.net` website deployment). |

## Main Control Points

| File or system | Role |
|---|---|
| `.github/workflows/build-companion.yml` | Builds platform artifacts, supports a one-run version override, and creates a draft release for a unique tag. |
| `.github/workflows/promote-companion-release.yml` | Promotes one published release to selected public feeds. |
| `.github/scripts/promote_companion_release.py` | Resolves release assets and writes the feed JSON files. |
| `helgeklein/sambee-companion` | Dedicated public release repository for Companion GitHub Releases and committed feed source files. |
| `release-repo/docs/feeds` | Source-controlled feed JSON files that promotion updates and commits. |
| `https://release-feeds.sambee.net` | Public host that serves the promoted feed JSON files to Companion and Sambee. |

## Channels And Consumers

Companion does not use separate binaries per channel. It uses one published release plus multiple mutable feed pointers.

| Consumer | Public file | Purpose |
|---|---|---|
| Installed Companion builds | `feeds/companion/tauri/<channel>/latest.json` | Tells the updater which published release is visible on `stable`, `beta`, or `test`. |
| Sambee backend | `feeds/sambee/companion/latest.json` | Tells Sambee which Companion installers and release notes to show in the UI. |

Changing a Companion channel feed affects auto-update visibility for installed apps.
Changing the Sambee metadata feed affects which direct downloads Sambee surfaces.

Those are separate decisions and can be promoted independently.

The current public feed host is not the same deployment surface as the main `sambee.net` website built from this repository.
The live feed host responds separately from the Cloudflare Pages deployment used by `sambee.net`.

## Published Artifact

Published Companion releases live in `helgeklein/sambee-companion` as GitHub Releases.

Each release may contain:

- Installer assets.
- Tauri updater bundles.
- `.sig` files for updater verification.
- Release notes.

Release tags do not encode a channel.
Channel visibility is decided only by the promoted feed files.

## Operating Rules

- Do not treat update channels as different binaries.
- Do not patch broken published assets in place.
- Build and publish a new release instead of replacing assets on an existing tag.
- Assign a distinct prerelease suffix when you need another build before the official release.
- Review whether you are changing Companion updater visibility, Sambee download visibility, or both.
- Treat local Windows GNU cross-checks as compatibility validation only.
- Keep actual Windows artifact creation and signing in the CI release workflow.

Use [Companion Channels, Feeds, And Downloads](../companion-channels-feeds-and-downloads/) for the system model behind those rules.
