+++
title = "Companion Release Overview"
+++

Sambee Companion ships one binary line that is built once, published once, and later promoted across update channels by changing public feed files.

That is the key difference between the Companion and Docker release paths.

Docker releases promote an already published container digest.
Companion releases promote an already published GitHub Release by rewriting feeds that different consumers read.

Use this page as the entry point for the Companion release path.

## Path To Stable

If you want to take a new Companion version to the `stable` update channel, follow this order:

1. Update `VERSION` and run `./scripts/sync-version`.
2. Merge the reviewed version-sync changes.
3. Run `Release: Build Companion Artifact` for the platforms you want to publish.
4. Review the draft release in `helgeklein/sambee-companion` and publish it.
5. Run `Release: Promote Companion Release` for `test` and any other targets you want exposed first.
6. Validate both update behavior and direct-download metadata against the promoted feeds.
7. Rerun `Release: Promote Companion Release` for `beta`, `stable`, or Sambee download metadata when that same published release is approved for broader use.

Companion release tags follow the `companion-vX.Y.Z` pattern.

One published release can later move from `test` to `beta` to `stable` without rebuilding binaries.

Read the detailed pages in this order:

1. [Build Companion Release](../build-companion-release/)
2. [Promote Companion Release](../promote-companion-release/)
3. [Companion Channels, Feeds, And Downloads](../companion-channels-feeds-and-downloads/)

## Workflow Map

| Workflow or system | When to use it | Result |
|---|---|---|
| `Release: Build Companion Artifact` | You want to create release assets for one Companion version. | Builds the selected platform set and updates a draft GitHub Release in `helgeklein/sambee-companion`. |
| `Release: Promote Companion Release` | A published Companion release is approved for one or more channels or for Sambee download metadata. | Rewrites only the selected feed files in the release repository and pushes those pointer updates. |
| `helgeklein/sambee-companion` | You need the public distribution surface. | Hosts immutable release assets and committed feed files under `docs/feeds`. |

## Main Control Points

| File or system | Role |
|---|---|
| `.github/workflows/build-companion.yml` | Builds platform artifacts and updates a draft release. |
| `.github/workflows/promote-companion-release.yml` | Promotes one published release to selected public feeds. |
| `.github/scripts/promote_companion_release.py` | Resolves release assets and writes the feed JSON files. |
| `helgeklein/sambee-companion` | Dedicated public release repository. |
| `release-repo/docs/feeds` | Committed channel metadata and Sambee download metadata. |

## Channels And Consumers

Companion does not use separate binaries per channel.

It uses one published release plus multiple mutable feed pointers.

| Consumer | Public file | Purpose |
|---|---|---|
| Installed Companion builds | `feeds/companion/tauri/<channel>/latest.json` | Tells the updater which published release is visible on `stable`, `beta`, or `test`. |
| Sambee backend | `feeds/sambee/companion/latest.json` | Tells Sambee which Companion installers and release notes to show in the UI. |

Changing a Companion channel feed affects auto-update visibility for installed apps.
Changing the Sambee metadata feed affects which direct downloads Sambee surfaces.

Those are separate decisions and can be promoted independently.

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
- Review whether you are changing Companion updater visibility, Sambee download visibility, or both.

Use [Companion Channels, Feeds, And Downloads](../companion-channels-feeds-and-downloads/) for the system model behind those rules.
