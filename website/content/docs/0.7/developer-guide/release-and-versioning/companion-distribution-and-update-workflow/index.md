+++
title = "Companion Distribution and Update Workflow"
description = "Understand how Companion builds become draft releases, how feeds are promoted, and why Sambee and Companion read different public metadata."
+++

Companion distribution is intentionally split between build control in the main repository and public distribution in a dedicated release repository.

That separation keeps Companion binaries out of normal Sambee deployments while still letting Sambee surface Companion downloads and installed Companion builds fetch updates.

## Purpose and Current Model

This workflow is the source of truth for how Companion builds are:

- produced for release
- published as immutable public assets
- promoted across update channels
- exposed to Sambee for direct download links
- consumed by installed Companion builds through promoted updater feeds

The current implementation is not based on separate binaries per channel.

Instead, it uses four moving parts:

1. the main `sambee` repository builds Companion releases
2. the dedicated public `sambee-companion` repository hosts release assets and committed feed files
3. channel manifests under `stable`, `beta`, and `test` decide which published release each installed build sees
4. a separate Sambee download-metadata file decides which installer links Sambee renders in the product UI

That split is what keeps distribution reviewable while avoiding any need to bundle Companion binaries into Sambee deployments.

## Main Control Points

| File or system | Role |
|---|---|
| `.github/workflows/build-companion.yml` | builds platform artifacts and updates a draft release |
| `.github/workflows/promote-companion-release.yml` | promotes one published release to selected public feeds |
| `.github/scripts/promote_companion_release.py` | resolves release assets and writes the feed JSON files |
| `helgeklein/sambee-companion` | dedicated public release repository |
| public feed files in the release repository | committed channel metadata |

## Repositories and Responsibilities

### Main Source Repository

The main repository owns:

- Companion source code
- release build automation
- promotion workflow logic
- the script that rewrites public feed files

This repository is the control plane for build and promotion.

### Dedicated Release Repository

The public release repository owns:

- immutable GitHub Releases for Companion installers and updater artifacts
- committed feed files under `docs/feeds`
- the public distribution surface consumed by Sambee and installed Companion builds

Current public repository:

- `helgeklein/sambee-companion`

That split is deliberate.

- source and automation stay with the main codebase
- public release assets and feed pointers stay in the dedicated distribution repository
- users do not have to navigate mixed Sambee and Companion release pages

## Build Flow

The build workflow creates the release artifacts but does not decide which update channels see them.

1. an operator runs the `Build Companion` workflow
2. CI syncs and verifies version metadata before building
3. the workflow builds the selected platform matrix
4. Tauri packaging uploads assets to a draft release in `helgeklein/sambee-companion`
5. a human reviews and publishes that draft release

Release tags follow the `companion-vX.Y.Z` pattern.

Current build targets are configured as:

- Linux x64
- macOS ARM64
- Windows x64
- Windows ARM64

Release assets may still expose only a subset of those platforms if that is what the published release actually contains. Promotion works from the assets present in the release, not from an assumed full matrix.

## Public Distribution Surface

### Github Releases

Published Companion releases live in the dedicated release repository as GitHub Releases.

Each release may contain:

- installer assets
- Tauri updater bundles
- `.sig` files for updater verification
- release notes

Release tags do not encode a channel. Channel visibility is determined only by the promoted feed files.

### Public Feed Host

The public feed host serves JSON files from the release repository contents.

Current host:

- `https://release-feeds.sambee.net`

Current public layout:

```text
feeds/companion/tauri/stable/latest.json
feeds/companion/tauri/beta/latest.json
feeds/companion/tauri/test/latest.json
feeds/sambee/companion/latest.json
```

Within the release repository, those files are committed under:

```text
docs/feeds/
```

## Promotion Flow

Channel promotion is a separate manual workflow.

1. an operator runs `Promote Companion Release`
2. the workflow accepts a `release_ref` plus booleans for `test`, `beta`, `stable`, and Sambee metadata targets
3. the workflow checks out both the main repository and the dedicated release repository
4. `promote_companion_release.py` resolves the release by tag, release URL, or numeric release ID
5. the script verifies the needed assets and signatures, then rewrites only the selected feed JSON files
6. the workflow commits and pushes the feed updates in the release repository

This keeps publishing immutable release assets separate from mutable channel pointers.

Current workflow inputs are:

- `release_ref`
- `companion_channel_test`
- `companion_channel_beta`
- `companion_channel_stable`
- `sambee`

`release_ref` can be:

- a Companion tag such as `companion-v0.6.0`
- a GitHub release URL
- a numeric GitHub release ID

Promotion should fail rather than silently producing broken metadata when:

- no target was selected
- the referenced release is still a draft
- selected updater feeds do not have the asset-plus-signature pairs they require
- Sambee metadata would have no usable downloadable installer assets

## Feed Split

Sambee and Companion do not read the same public feed.

- installed Companion builds read Tauri updater manifests under `feeds/companion/tauri/<channel>/latest.json`
- Sambee reads `feeds/sambee/companion/latest.json` to render Companion download links

That distinction is important.

- promoting a release to a Companion channel affects auto-update visibility for installed apps
- promoting the Sambee metadata affects which direct downloads the product surfaces
- the same published Companion release can move across `test`, `beta`, and `stable` over time without rebuilding binaries

These channels are mutable feed pointers, not separate application identities or separately built binaries.

Implications:

- channel is not baked into the binary
- channel is not encoded in the release tag
- one published release can later be promoted from `test` to `beta` to `stable`

## Feed Formats

### Tauri Channel Manifests

Installed Companion builds consume standard Tauri updater JSON.

Important behavior:

- each manifest points to immutable release assets in `sambee-companion`
- feed files can move between releases over time, but published asset URLs should not be patched in place
- the promotion script includes every platform for which it finds a complete bundle-and-signature pair
- a release does not need to include every platform to be promotable
- installed Companion builds only read the manifest for their currently selected channel

### Sambee Download Metadata

Sambee uses a different JSON document that is not consumed by the Tauri updater.

Important behavior:

- this file contains only what Sambee needs to render download UI
- the asset map can contain any supported subset of discovered installers
- Sambee does not read the Tauri channel manifests directly

## Sambee Integration

Sambee does not bundle Companion binaries.

By default, the backend resolves Companion download metadata from:

- `https://release-feeds.sambee.net/feeds/sambee/companion/latest.json`

That behavior is implemented in the backend metadata resolver, which:

- fetches hosted Companion download metadata
- normalizes and validates installer URLs
- exposes the result through the backend API to the frontend

Sambee also supports a deterministic pin override in configuration.

When a pin is configured:

- the backend stops using the hosted feed for Companion download links
- version, notes, and installer URLs come from the configured pin values instead

This is why Companion download URLs are not hardcoded in the frontend.

The server remains the source of truth for what the product offers users as the current Companion download.

## Runtime Companion Updater Behavior

Companion uses `tauri-plugin-updater` for self-update checks.

The runtime updater behavior is channel-aware.

- the Rust update commands build the effective feed URL from the selected channel at runtime
- the frontend stores the local update preference as `companionUpdateChannel`
- the allowed channel values are `stable`, `beta`, and `test`
- the default channel is `stable`

At startup, the frontend schedules an automatic update check shortly after the UI renders.

Current behavior is:

1. wait briefly after startup
2. read the selected update channel from local preferences
3. ask the Rust updater command to check the matching promoted feed
4. do nothing if no update is available
5. if an update is available and no file operation is active, download and install it silently
6. if editing is active, defer installation until the companion becomes idle

That means updates are automatic, but active editing sessions are treated as higher priority than immediate installation.

## Manual Update Behavior in Preferences

The Preferences UI exposes update controls for:

- current update channel
- manual check-for-updates action
- contextual update status
- explicit installation when a newer version is available

Current UX rules include:

- switching from `stable` to `beta` or `test` requires confirmation
- switching back to `stable` does not
- channel changes persist locally for future checks
- channel changes do not force an immediate automatic check on their own

Users can either wait for the next automatic check or trigger a manual check immediately.

## Asset and Signature Rules

Promotion is intentionally strict about release completeness.

- Tauri channel feeds require usable updater bundles and matching signatures for the included platforms
- Sambee metadata requires downloadable installer assets
- a platform can be absent from a release, but any platform that is included must have the assets required for the selected feed type

If the selected feed target cannot be built from the published assets, promotion should fail instead of silently publishing a broken pointer.

## App Identity and Signing

Companion uses one app identity across all update channels.

Channel separation comes from feed selection, not from separate binaries or per-channel app identifiers.

Companion also uses one Tauri updater signing key across all channels.

Responsibilities are split like this:

- updater artifacts are signed during release builds
- installed Companion builds verify updates using the embedded updater public key
- platform-specific installer signing remains a separate concern from the Tauri updater signature

Operationally, a build only becomes a stable update when the `stable` feed is promoted to point to it.

## Contributor Rules

- do not treat update channels as different binaries; channels are feed pointers
- do not patch broken published assets in place; build and publish a new release instead
- review the feed target you are changing, because Sambee-download metadata and Companion auto-update metadata serve different consumers
- keep release automation changes aligned with asset naming conventions, because promotion depends on asset-pattern matching

Additional operator rules that matter in practice:

- publish draft releases only after verifying the uploaded assets and signatures are the intended ones
- never replace assets on an existing published release tag; cut a new release instead
- treat feed updates as pointer changes only, not as a place to repair bad artifacts retroactively

## When to Use This Page

Use this page when you are changing Companion release automation, feed generation, update-channel behavior, or the assumptions Sambee makes about Companion downloads.

## Related Pages

- [Dependency and Release Workflow](../dependency-and-release-workflow/): keep Companion release work aligned with the broader version-sensitive workflow
- [Companion Overview](../../companion-architecture/companion-overview/): place the release pipeline in the wider Companion architecture
