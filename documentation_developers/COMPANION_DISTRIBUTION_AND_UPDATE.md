# Companion Distribution And Update Plan

## Purpose

This document is the source of truth for how Sambee Companion is built for release, published, promoted across channels, exposed to Sambee for download links, and updated after installation.

It describes the current implementation, not an aspirational future design.

Goals:

- publish Companion binaries through a dedicated public GitHub release repository
- keep Companion binaries out of Sambee deployments
- let Sambee resolve Companion downloads through one dedicated metadata feed, with an optional pin override
- let installed Companion builds update through promoted channel feeds
- keep release promotion explicit and reviewable

## Summary

The implementation has four moving parts:

1. The main `sambee` source repository builds Companion releases.
2. The dedicated public `sambee-companion` repository hosts immutable Companion release assets and the published feed files.
3. Tauri channel manifests under `stable`, `beta`, and `test` decide which published release each installed Companion build sees.
4. A separate Sambee download metadata file tells Sambee which direct download links to render.

Sambee and Companion consume different feed files:

- Sambee reads `feeds/sambee/companion/latest.json`.
- Companion reads one of the Tauri channel manifests under `feeds/companion/tauri/<channel>/latest.json`.

The same published Companion release can be promoted to any combination of channels over time by rewriting those feed files.

## Repositories And Responsibilities

### Main source repository

The main `sambee` repository contains:

- the Companion source code
- the CI workflow that builds tagged Companion releases
- the manual promotion workflow and promotion script

This repository is the control plane for build and promotion logic.

### Dedicated release repository

The public `sambee-companion` repository contains:

- published GitHub Releases for Companion installers and updater artifacts
- the committed feed files under `docs/feeds`

This repository is the distribution surface that users and installed Companion builds consume.

That split is intentional:

- source and automation stay with the main codebase
- release assets and public feed files stay in the dedicated distribution repository
- users do not see Sambee and Companion mixed on one Releases page

## Public Distribution Surface

### GitHub Releases

Companion releases are published as public GitHub Releases in the dedicated release repository.

Current repository:

- `helgeklein/sambee-companion`

Release tags use the format:

- `companion-vX.Y.Z`

Each published release may contain:

- installer assets
- Tauri updater artifacts
- `.sig` files for updater verification
- release notes

Releases do not encode an update channel in the tag or file name. Channel assignment is determined only by the promoted feed files.

### Feed host

The public feed host serves JSON files from the release repository contents.

Current public host:

- `https://release-feeds.sambee.net`

Current feed layout:

```text
feeds/companion/tauri/stable/latest.json
feeds/companion/tauri/beta/latest.json
feeds/companion/tauri/test/latest.json
feeds/sambee/companion/latest.json
```

In the release repository, those files are committed under:

```text
docs/feeds/
```

## Update Channels

Companion uses three runtime-selectable channels:

- `stable`
- `beta`
- `test`

These are mutable feed pointers, not separate binaries.

Implications:

- channel is not baked into the app binary
- channel is not encoded in the release tag
- channel membership is defined only by which `latest.json` file references a release

Example promotion flow:

1. Build Companion `companion-v0.6.0`.
2. CI uploads assets to a draft release in `sambee-companion`.
3. Publish the release.
4. Promote it to `test`.
5. Later promote the same release to `beta`.
6. Later promote the same release to `stable`.

## Release Creation Workflow

Companion release builds are automated in the main repository.

Current workflow shape:

1. A Companion tag matching `companion-v*` triggers the build workflow.
2. CI builds the configured platform matrix.
3. CI signs updater artifacts with the Tauri updater signing key.
4. CI creates or updates a draft release in the dedicated `sambee-companion` repository.
5. CI uploads the produced assets to that draft release.
6. A human reviews and publishes or discards the draft release.

This preserves a review step while keeping artifact production automatic.

## Release Promotion Workflow

Promotion is a separate manual workflow in the main source repository.

That workflow intentionally does not live in the release repository. Instead, it checks out the release repository, rewrites the relevant feed JSON files there, commits them, and pushes the result.

Current `workflow_dispatch` inputs:

- `release_ref`
- `companion_channel_test`
- `companion_channel_beta`
- `companion_channel_stable`
- `sambee`

`release_ref` may be either:

- a tag such as `companion-v0.6.0`
- a GitHub release URL
- a numeric GitHub release ID

Promotion flow:

1. Operator publishes the draft release.
2. Operator runs the promotion workflow from the main repository.
3. Operator enters `release_ref`.
4. Operator selects any combination of Companion channel targets and Sambee metadata.
5. The workflow resolves the release through the GitHub API.
6. The workflow verifies that the release is published and has usable assets.
7. The workflow checks out the dedicated release repository.
8. The workflow rewrites only the selected JSON feed files under `docs/feeds`.
9. The workflow commits and pushes the feed changes to the release repository.

The workflow fails if:

- no promotion target was selected
- `release_ref` does not resolve to a published release
- a selected Tauri feed target would require a signature or updater asset that is missing for an included platform
- no usable installer assets exist for the Sambee metadata file

## Feed Formats

### Tauri channel manifests

Installed Companion builds consume standard Tauri updater JSON.

Current public layout:

```text
feeds/companion/tauri/stable/latest.json
feeds/companion/tauri/beta/latest.json
feeds/companion/tauri/test/latest.json
```

Example shape:

```json
{
  "version": "0.5.1",
  "notes": "See the assets below to download and install.",
  "pub_date": "2026-03-28T21:35:05Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://github.com/helgeklein/sambee-companion/releases/download/companion-v0.5.1/Sambee.Companion_0.5.1_x64-setup.exe",
      "signature": "<sig contents>"
    }
  }
}
```

Important behavior:

- each manifest points at immutable release assets in `sambee-companion`
- the promotion script includes every platform for which it finds a complete bundle and signature pair
- a release does not need to contain every possible platform to be promotable
- installed Companion builds only use the manifest for their currently selected channel

### Sambee download metadata

Sambee consumes a separate JSON file that is not used by the Tauri updater.

Current public layout:

```text
feeds/sambee/companion/latest.json
```

Example shape:

```json
{
  "version": "0.5.1",
  "published_at": "2026-03-28T21:35:05Z",
  "notes": "See the assets below to download and install.",
  "assets": {
    "windows-x64": "https://github.com/helgeklein/sambee-companion/releases/download/companion-v0.5.1/Sambee.Companion_0.5.1_x64-setup.exe"
  }
}
```

Important behavior:

- this file contains only the data Sambee needs for download UI
- the asset map may contain any supported subset of platforms discovered in the selected release
- Sambee does not read the Tauri channel manifests

## Sambee Integration

Sambee does not bundle Companion binaries.

By default, the backend resolves Companion download metadata from:

- `https://release-feeds.sambee.net/feeds/sambee/companion/latest.json`

Sambee also supports a deterministic pin override in configuration. When a pin is configured, the backend returns the pinned version metadata and installer URLs instead of reading the hosted feed.

Flow:

1. The backend resolves Companion download metadata from either the feed or the configured pin.
2. The backend normalizes and validates the returned installer URLs.
3. The frontend requests that metadata from the backend.
4. The frontend renders platform-specific Companion download links from the normalized response.

This keeps distribution control on the server side and avoids hardcoding download URLs in the frontend.

## Companion Update Implementation

### Core updater stack

Companion uses `tauri-plugin-updater`.

The shipped app embeds:

- the Tauri updater public key
- a default updater endpoint in `tauri.conf.json` that points to the `stable` channel

At runtime, the Rust update commands override the endpoint based on the selected channel, so the effective feed URL is:

- `https://release-feeds.sambee.net/feeds/companion/tauri/stable/latest.json`
- `https://release-feeds.sambee.net/feeds/companion/tauri/beta/latest.json`
- `https://release-feeds.sambee.net/feeds/companion/tauri/test/latest.json`

### Stored update preference

Companion stores one self-update preference in the user preferences store:

- `companionUpdateChannel`

Allowed values:

- `stable`
- `beta`
- `test`

Default:

- `stable`

Only one Companion installation is expected on a machine. Changing the selected channel changes the update track for that one installation.

### Automatic update behavior

When the main Companion window starts, it schedules an automatic update check shortly after the UI renders.

Current behavior:

1. Wait briefly after startup before checking.
2. Read the selected update channel from the local preferences store.
3. Ask the Rust updater command to check the matching promoted feed.
4. If no update is available, do nothing.
5. If an update is available and no file operation is active, silently download and install it.
6. If an update is available while file operations are active, defer installation until the app becomes idle.

This means the updater is automatic, but it avoids interrupting active editing sessions.

### Manual update behavior in Preferences

The Preferences UI exposes an Updates section with:

- the current selected channel
- a manual `Check for updates` action
- contextual update status text
- an `Install update` action when a newer version is available through the selected channel

Current UX behavior:

- switching from `stable` to `beta` or `test` requires confirmation
- switching back to `stable` does not require confirmation
- changing channel persists the new preference locally
- the new channel applies to subsequent update checks
- manual checks show whether the app is up to date or which version is available

The channel switch does not force an immediate automatic check. Users can either wait for the next automatic check or run a manual check immediately.

### Runtime update commands

The Rust side exposes channel-aware commands for the UI layer:

- check for updates on the selected channel
- download and install updates on the selected channel

Those commands build the correct feed URL at runtime rather than relying solely on the static `tauri.conf.json` endpoint.

## App Identity

Companion uses one app identity across all channels:

- `app.sambee.companion`

Channel separation is enforced by the promoted feed files and the locally selected update channel, not by separate binaries or separate app identifiers.

## Signing

Companion uses one Tauri updater signing key across all channels.

This is separate from platform-specific installer signing such as Windows Authenticode.

Responsibilities:

- updater artifacts are signed with the Tauri updater private key during release builds
- installed Companion builds verify updates using the embedded updater public key
- channel separation comes from feed selection, not from per-channel keys

Operationally, a release only becomes a stable update when the `stable` feed is promoted to point at it.

## Build Matrix And Artifact Expectations

The release build workflow is configured for these targets:

- Linux x64
- macOS ARM64
- Windows x64
- Windows ARM64

Different release tags may still end up exposing only a subset of assets publicly. Promotion and feed generation operate on the assets actually present in the published release.

## Responsibilities

### Sambee

- reads dedicated Companion download metadata, not Tauri updater feeds
- optionally uses a pin override instead of the hosted feed
- exposes resolved Companion download metadata to the frontend

### Companion

- stores the selected update channel locally
- checks the matching promoted Tauri channel manifest
- installs only updates signed with the configured Tauri updater key
- defers automatic install while editing is active

### Main source repository

- owns Companion source, build automation, and promotion logic

### Dedicated release repository

- hosts immutable release assets
- hosts committed public feed files under `docs/feeds`

## Relationship To Other Docs

This document owns Companion release and update behavior.

`COMPANION_APP_ARCHITECTURE.md` may reference the updater at a high level, but detailed update mechanics, channel behavior, feed formats, release promotion, and Sambee download integration belong here.
