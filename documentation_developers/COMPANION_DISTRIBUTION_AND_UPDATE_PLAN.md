# Companion Distribution And Update Plan

## Purpose

This document defines how Sambee Companion is distributed, how Sambee links to it, and how installed Companion builds update.

Goals:

- publish Companion as public GitHub Releases in a dedicated repo
- avoid bundling Companion binaries with Sambee
- let Sambee link to a specific Companion release deterministically
- let installed Companion builds auto-update within a selected channel
- keep the design simple

## Summary

The design has three layers:

1. A dedicated Companion release repository stores immutable Companion releases.
2. Tauri-compatible channel manifests decide which release each update channel currently points to.
3. A separate Sambee download metadata file tells Sambee which release to offer for direct downloads.

Sambee and Companion use those layers differently:

- Sambee reads one dedicated JSON file for download metadata, with the option to pin a specific release when needed.
- Companion auto-updater follows a selected Tauri channel manifest.

## Release Repository

Companion releases should be published in a separate repository dedicated to Companion distribution.

Reason:

- mixing Sambee and Companion on one GitHub Releases page would confuse users

This separate repository is used only for distribution artifacts and release metadata. Sambee can continue to build Companion from the main source repository.

## Core Model

Companion uses three update channels:

- `stable`
- `beta`
- `test`

These channels are not separate build types. They are just three mutable pointers for Tauri updater state:

- `stable/latest.json`
- `beta/latest.json`
- `test/latest.json`

Sambee does not read those files. It reads one separate metadata file intended only for Sambee download UI.

The same Companion release can be promoted across channels over time by updating the corresponding manifest files.

Example:

1. build and publish Companion `v0.6.0` as a draft release in the Companion release repo
2. publish that release when ready
3. point `test/latest.json` to it
4. later point `beta/latest.json` to it
5. later point `stable/latest.json` to it

Advantages:

- channel is not baked into the binary
- channel is not encoded in the tag name or file name
- channel membership is defined only by which manifest references a release

## Release Assets

Public GitHub Releases in the Companion release repository are the canonical home for Companion binaries.

Each release contains:

- normal installer assets
- Tauri updater artifacts where required
- `.sig` files for updater verification
- release notes

GitHub Actions artifacts may still be used temporarily during CI, but Releases are the real distribution channel.

## Release Creation Workflow

Companion should still be built automatically by CI, but release publication should preserve a review step.

Workflow:

1. CI builds Companion normally.
2. CI creates or updates a draft release in the Companion release repository.
3. CI uploads all release assets and updater artifacts to that draft.
4. A human decides whether to delete the draft or publish it.
5. After publication, a separate manual promotion workflow updates the selected Tauri channel manifests and the Sambee download metadata file.

This gives controlled automation:

- asset production and upload are automatic
- final promotion remains deliberate

## Release Promotion Workflow

Promotion should happen in a separate manually triggered GitHub Action that lives in the Companion release repo.

Recommended `workflow_dispatch` inputs:

- `release_ref`: free-text input containing either the Companion tag such as `companion-v0.6.0` or the GitHub release URL
- `companion_channel_test`: boolean
- `companion_channel_beta`: boolean
- `companion_channel_stable`: boolean
- `sambee`: boolean

Reason:

- GitHub Actions cannot provide a reliable dynamic dropdown of available releases
- a free-text release selector plus strict validation is simpler and more robust
- four booleans make the operator intent explicit in the GitHub Action UI

Promotion flow:

1. operator publishes the draft release
2. operator runs the promotion workflow
3. operator enters `release_ref`
4. operator sets any combination of the boolean inputs
5. the workflow resolves the referenced release through the GitHub API
6. the workflow verifies that the release is published and that the required assets and signatures exist
7. the workflow rewrites only the selected JSON files and commits the result

The workflow should fail if:

- `release_ref` does not resolve to a published release
- required installer assets are missing
- required updater signatures are missing
- no boolean was selected

## Versioning And Naming

Companion should be built and tagged normally, as it is today.

Recommended tag format: `companion-vX.Y.Z`

That keeps release production simple and lets the same release move across `test`, `beta`, and `stable` by manifest updates alone.

## Tauri Channel Manifests

Tauri updater supports static JSON feeds. The design uses one static JSON file per channel.

Recommended public layout:

```text
feeds/companion/tauri/stable/latest.json
feeds/companion/tauri/beta/latest.json
feeds/companion/tauri/test/latest.json
```

Each manifest contains only normal Tauri updater JSON and points to immutable release assets in the Companion release repository.

Example:

```json
{
  "version": "0.5.0",
  "notes": "Release notes",
  "pub_date": "2026-03-26T18:20:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://github.com/<owner>/<companion-release-repo>/releases/download/companion-v0.5.0/Sambee-Companion_0.5.0_windows_x86_64-setup.exe",
      "signature": "<sig file contents>"
    }
  }
}
```

These manifests are the only channel mechanism for installed Companion clients.

## Sambee Download Metadata

Sambee should consume a separate JSON file that is not used by Tauri updater.

Recommended public layout:

```text
feeds/sambee/companion/latest.json
```

Recommended contents:

```json
{
  "version": "0.5.0",
  "published_at": "2026-03-26T18:20:00Z",
  "notes": "Release notes",
  "assets": {
    "windows-x64": "https://github.com/<owner>/<companion-release-repo>/releases/download/companion-v0.5.0/Sambee-Companion_0.5.0_windows_x86_64-setup.exe"
  }
}
```

This file should expose only the metadata Sambee needs to render download links.

## Companion Update Behavior

Only one Companion installation is expected on a machine at a time. Side-by-side installs are not part of the design.

Companion stores one runtime setting:

- selected update channel: `stable`, `beta`, or `test`
- the default selected channel is `stable`

At update-check time, Companion should:

1. read the selected channel
2. fetch that channel's `latest.json`
3. install the update if one is available

That means the selected channel is runtime state, not build identity.

## UI Channel Switch

The design supports an update-channel switch in the Companion UI.

Recommended behavior:

- show the current selected channel
- let the user choose `stable`, `beta`, or `test`
- persist the choice locally
- use the newly selected channel for subsequent update checks

Recommended UX:

- treat channel switching as an advanced setting
- warn when moving from `stable` to `beta` or `test`
- provide a clear path back to `stable`
- after changing channel, perform an immediate update check so the effect is clear

Because there is only one installed Companion app, switching channels changes the update track of that installation in place.

## App Identity

Companion uses one app identity across all channels:

- `app.sambee.companion`

Channel isolation is enforced by updater manifests and client behavior, not by separate app identities.

## Signing

Companion already has a Tauri updater signing key. Continue using that one key for all channels.

This is separate from Windows Authenticode:

- Authenticode is OS-level Windows publisher trust
- Tauri updater signing is app-level update verification

Using one updater key for all channels is acceptable because channel separation comes from `stable/latest.json`, `beta/latest.json`, and `test/latest.json`, not from separate keys.

Operationally:

- all updater artifacts must be signed with the existing Tauri updater signing key
- all Companion builds must embed the corresponding updater public key
- a release does not become a stable update unless `stable/latest.json` is explicitly updated to point to it

## CI Responsibilities

Companion CI should stay close to the current build process.

For each release candidate, CI should:

1. build Companion normally
2. create or update a draft release in the Companion release repository
3. upload assets and signatures to that draft

After the draft is reviewed, the release can be either deleted or published.

CI does not need to produce separate channel-specific binaries.

## Sambee Integration

Sambee should not bundle Companion binaries.

By default, Sambee should read `feeds/sambee/companion/latest.json` and use it to render Companion download links.

If a Sambee deployment needs a deterministic override, it may pin a specific Companion release directly instead of using `feeds/sambee/companion/latest.json`.

## Responsibilities

### Sambee

- reads `feeds/sambee/companion/latest.json` to resolve Companion download links by default
- exposes resolved download metadata to the frontend

### Companion

- stores the selected update channel
- checks the correct Tauri channel manifest
- applies signed updates from that manifest

### Companion Release Repository

- hosts immutable release assets and draft releases
- host the release promotion GitHub Action
