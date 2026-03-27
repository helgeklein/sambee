# Companion Distribution Implementation Plan

## Purpose

This document turns the finalized distribution design into an implementation checklist.

It is intentionally execution-oriented and can be deleted after the work is complete.

The long-term reference remains [COMPANION_DISTRIBUTION_AND_UPDATE_PLAN.md](documentation_developers/COMPANION_DISTRIBUTION_AND_UPDATE_PLAN.md).

## Scope

This plan covers:

- publishing Companion releases to a dedicated release repository
- hosting Tauri channel feeds and Sambee download metadata under the agreed feed layout
- adding a manual promotion workflow with one release selector and four booleans
- updating Companion to consume Tauri channel feeds
- updating Sambee to consume the separate download metadata feed

This plan does not cover:

- redesigning the release architecture
- bundling Companion with Sambee
- side-by-side installation support

## Ownership Model

This plan separates work into two categories:

- `AI can do`: work that can be implemented directly in the repositories, including code changes, workflow files, generated file layouts, tests, and documentation updates
- `Manual`: work that requires repository creation, GitHub admin access, secret management, release publication, or operator judgment

In practice, implementation will often alternate between the two. Manual prerequisites should be completed before the dependent AI tasks are started.

## Target Outcomes

When this work is complete:

- Companion builds create draft releases in the dedicated release repository
- published releases can be promoted through a manual workflow
- the workflow can update any combination of:
  - `feeds/companion/tauri/test/latest.json`
  - `feeds/companion/tauri/beta/latest.json`
  - `feeds/companion/tauri/stable/latest.json`
  - `feeds/sambee/companion/latest.json`
- Companion reads only the Tauri channel feed for updates
- Sambee reads only the Sambee download metadata feed for download links by default
- Sambee can still support an optional explicit pin override

## Current Status

- Phase 1 completed: release repository, Pages hosting, cross-repo auth, and updater key setup are in place
- Phase 2 completed: Companion tags build draft releases in `helgeklein/sambee-companion`
- Phase 3 completed: manual promotion generates and publishes the four feed JSON files correctly
- Phase 4 not started: Companion still needs to consume the new promoted Tauri feeds in app code
- Phase 5 not started: Sambee still needs to consume the separate metadata feed in app code
- Phase 6 partially completed: the build and promotion flow has been validated end to end for the current Windows x64 release

## Phase 1: Release Repository And Access

Status: completed

### Manual

- completed
- release repo: `helgeklein/sambee-companion`
- Pages host: `https://release-feeds.sambee.net` from `main:/docs`
- cross-repo automation secret: `COMPANION_RELEASE_REPO_TOKEN`
- updater public key is committed in Companion config
- updater private key secret still must remain configured in GitHub for future builds

### AI can do

- completed

### Exit Criteria

- source repo automation can write draft releases to the release repo
- release repo automation can commit feed changes

## Phase 2: Release Build Pipeline

Status: completed

### AI can do

- completed
- draft releases are published cross-repo to `helgeklein/sambee-companion`
- tag format remains `companion-vX.Y.Z`
- updater artifacts and `.sig` uploads are enabled

### Manual

- completed for the current validated release flow
- future releases still need normal operator inspection before publication

### Exit Criteria

- creating a Companion tag produces a draft release in the release repo with all required assets

## Phase 3: Feed Layout And Promotion Workflow

Status: completed

### AI can do

- completed
- implemented in `.github/workflows/promote-companion-release.yml` and `.github/scripts/promote_companion_release.py`
- generated feeds:
  - `feeds/companion/tauri/test/latest.json`
  - `feeds/companion/tauri/beta/latest.json`
  - `feeds/companion/tauri/stable/latest.json`
  - `feeds/sambee/companion/latest.json`
- promotion supports tag or release URL input, validates release state, and writes idempotent JSON
- Tauri feeds now tolerate partial platform coverage as long as each included platform has both bundle and signature

### Manual

- completed
- direct push was chosen and validated
- published feeds at `release-feeds.sambee.net` were verified against `companion-v0.5.0`

### Exit Criteria

- an operator can promote a published release into any combination of test, beta, stable, and Sambee metadata through one manual workflow

## Phase 4: Companion Application Changes

### AI can do

- point Companion at the new Tauri feed base URL
- derive the final updater URL from the selected channel at runtime
- default the selected channel to `stable`
- preserve the single app identity `app.sambee.companion`
- add or finalize the update-channel UI and persistence
- warn when switching away from `stable`
- optionally trigger an immediate update check after a channel change
- add or update tests and docs for the new updater behavior

### Manual

- confirm the final production, staging, and local feed base URLs
  - production should be the stable public URL under `sambee.net` that both Sambee and Companion can reach
  - decide the exact host and path before implementation so constants and configuration names are final on first rollout
  - staging should be a separate feed location if you want pre-production verification without touching production feeds
  - local development should either use a local static server, a checked-in test feed, or a staging feed override
  - write down the exact URLs before implementation so code and config do not need follow-up renames
- run the built Companion app against the promoted feeds
- verify signed updates work correctly on real target platforms
  - verify no update is offered when the installed version already matches the channel feed
  - verify an update is offered after promoting a newer release into the selected channel
  - verify switching channels changes which feed is queried
  - verify a broken or unreachable feed fails cleanly and surfaces actionable logs

### Exit Criteria

- Companion updates successfully from the new feed layout and respects the selected channel

## Phase 5: Sambee Application Changes

### AI can do

- add backend configuration for the Sambee metadata feed URL
- add backend configuration for an optional explicit Companion pin override
- implement the logic that fetches `feeds/sambee/companion/latest.json` when no pin is configured
- implement the logic that uses pinned release data when a pin is configured
- validate and normalize asset URLs before exposing them to the frontend
- surface Companion download actions in the Local Drives settings flow
- ensure the frontend uses backend-provided metadata rather than constructing GitHub URLs
- show actionable errors if download metadata cannot be resolved
- document local-development behavior and test overrides

### Manual

- decide the exact base URL used in production, staging, and local development
  - keep this aligned with the Companion decision above so both products point at the same feed host by environment
  - use `sambee.net` for production-facing URLs unless there is a deliberate reason to keep feeds on a different public domain
- decide the exact pin schema and where it is configured
  - minimum recommendation: store fully resolved asset URLs in config so Sambee does not reconstruct GitHub URLs at runtime
  - decide whether the pin lives in `config.toml`, environment-specific config, or backend settings storage
  - decide whether pinning replaces only the default download link or also disables normal feed refresh behavior entirely
- verify the UI behavior against a real or staging feed
  - verify the Local Drives UI shows the expected Companion download actions
  - verify the backend returns normalized asset URLs from the Sambee metadata file
  - verify pinned configuration overrides the feed when enabled
  - verify feed fetch failures produce understandable user-facing errors

### Exit Criteria

- Sambee can show Companion download links from the new metadata source in both normal and development environments

## Phase 6: Validation, Rollout, And Operations

Status: partially completed

### AI can do

- add or update operator-facing documentation for draft publication, release promotion, rollback, and pinning
- assist with dry-run execution by checking generated files, workflow definitions, and code paths
- adjust implementation details based on dry-run findings

### Manual

- completed so far
- build, publication, promotion, and hosted feed verification succeeded for `companion-v0.5.0`
- remaining validation is in-product behavior inside Companion and Sambee after their application changes are implemented

### Exit Criteria

- the end-to-end publishing and promotion flow has been exercised successfully once

## Suggested Implementation Order

1. Update Companion to use the promoted Tauri feed URLs.
2. Update Sambee to use the separate download metadata feed and pin override.
3. Verify Companion update behavior against promoted test, beta, and stable feeds.
4. Verify Sambee download-link behavior against the promoted metadata feed.
5. Perform a final end-to-end rollout rehearsal after the app changes are complete.

## Open Implementation Decisions

These are remaining product or operational decisions that may still be open after implementation starts. They should be tracked explicitly, but they do not all block the first coding steps.

- the exact Sambee pin configuration schema and storage location
- whether Linux installers should also be exposed in Sambee UI or only desktop platforms that Sambee officially supports

## Remaining Manual Prerequisites

These are the remaining operator decisions needed before the application-integration phases are implemented.

- confirm the production and development feed base URLs that Companion and Sambee should use in code
- decide the Sambee pin schema and where that override is configured
- decide whether Linux download links should appear in Sambee UI once Linux assets are published

## Completion Checklist

- [x] release repository exists and is writable by automation
- [x] Companion build workflow publishes draft releases to the release repository
- [x] release assets and signatures are complete and validated for the current tested release
- [x] promotion workflow exists with `release_ref` and four booleans
- [x] promotion workflow generates Tauri feed JSON correctly
- [x] promotion workflow generates Sambee metadata JSON correctly
- [ ] Companion updater uses the new feed layout
- [ ] Companion channel selection works end-to-end
- [ ] Sambee resolves download metadata from the new source
- [ ] Sambee optional pin override works
- [x] one infrastructure dry run has been completed
- [ ] operator-facing documentation has been updated
