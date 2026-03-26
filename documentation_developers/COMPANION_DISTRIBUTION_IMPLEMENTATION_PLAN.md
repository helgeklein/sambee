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

## Phase 1: Release Repository And Access

### Manual

- create the dedicated Companion release repository if it does not already exist
  - ✅: https://github.com/helgeklein/sambee-companion
- enable GitHub Releases in that repository
  - ✅
- decide whether feed files live on the default branch or a dedicated Pages branch
  - simplest: keep feed files in the default branch and let GitHub Pages publish directly from that branch
  - cleaner separation: keep release automation on the default branch and publish feed files from a dedicated Pages branch
  - choose the default-branch option unless you already expect stricter review or separate publishing controls for the feed content
  - ✅: on the default branch
- enable GitHub Pages if Pages is part of the final hosting setup
  - configure the repository to publish from the chosen branch and folder
    - ✅: `main` and `/docs`
  - attach the public Sambee domain under `sambee.net`
  - decide the exact production host and path under that domain, for example a subdomain such as `downloads.sambee.net` or a path such as `sambee.net/feeds`
    - ✅: release-feeds.sambee.net
  - verify that the published site serves JSON with stable public URLs
    - ✅
- configure credentials so source-repo automation can create and update releases in the release repository
  - create a fine-grained personal access token owned by your personal GitHub account
    - ✅
  - restrict the token to the single target repository: `helgeklein/sambee-companion`
    - ✅
  - grant only the repository permissions needed for this workflow:
    - `Contents: Read and write`
    - `Metadata: Read`
    - ✅
  - store the token as a secret in the source repository, using a clear name such as `COMPANION_RELEASE_REPO_TOKEN`
    - ✅: `COMPANION_RELEASE_REPO_TOKEN`
  - update the source-repo workflow to use that secret for release creation and asset upload instead of assuming the default `GITHUB_TOKEN` can write cross-repo
    - ✅: `.github/workflows/build-companion.yml` now uses `COMPANION_RELEASE_REPO_TOKEN` for the Tauri release step and targets `helgeklein/sambee-companion`
  - validate the token with a small test workflow or temporary script that creates and then deletes a draft release in `helgeklein/sambee-companion`
    - ✅
- configure credentials so the promotion workflow in `sambee` can commit feed updates to the release repository
  - because all workflows stay in `sambee`, the default repository `GITHUB_TOKEN` is not sufficient for writing to `helgeklein/sambee-companion`
  - reuse `COMPANION_RELEASE_REPO_TOKEN` for feed updates as well
    - ✅
  - check out `helgeklein/sambee-companion` into a subdirectory using the cross-repo token
    - ✅: `.github/workflows/promote-companion-release.yml`
  - configure the workflow git identity explicitly before committing, for example `github-actions[bot]` with the standard noreply email
    - ✅: `.github/workflows/promote-companion-release.yml`
  - commit the changed feed files in the checked-out release repository working tree and push them back to `main`
    - ✅: direct push
  - branch protection does not block direct pushes for this automation path
    - ✅

### AI can do

- document the expected repository layout
- prepare workflow changes once the target repository name and auth mechanism are known
- add or update developer documentation that describes the required secrets and permissions

### Exit Criteria

- source repo automation can write draft releases to the release repo
- release repo automation can commit feed changes

## Phase 2: Release Build Pipeline

### AI can do

- update the existing Companion build workflow so draft releases are created in the dedicated release repository
- preserve the current build structure and tag format `companion-vX.Y.Z`
- ensure installer assets, updater artifacts, and `.sig` files continue to be uploaded
- define the expected asset contract that the promotion workflow will validate
- update related documentation and CI comments as needed

### Manual

- confirm the final target repository name and release ownership model
- run the updated workflow in GitHub
- inspect the produced draft release and confirm the expected assets are present
  - verify that the release is created in the dedicated release repository, not the source repository
  - verify that the tag name matches `companion-vX.Y.Z`
  - verify that each intended platform asset is present with the expected filename pattern
  - verify that required `.sig` files are attached for updater-managed platforms
  - verify that release notes are populated and usable for feed generation
  - verify that the release remains a draft until a human publishes it

### Exit Criteria

- creating a Companion tag produces a draft release in the release repo with all required assets

## Phase 3: Feed Layout And Promotion Workflow

### AI can do

- add the feed file layout in the release repository:
  - `feeds/companion/tauri/test/latest.json`
  - `feeds/companion/tauri/beta/latest.json`
  - `feeds/companion/tauri/stable/latest.json`
  - `feeds/sambee/companion/latest.json`
- implement the manual `workflow_dispatch` promotion workflow in the `sambee` repository
  - ✅: `.github/workflows/promote-companion-release.yml`
- add the required inputs:
  - `release_ref`
  - `companion_channel_test`
  - `companion_channel_beta`
  - `companion_channel_stable`
  - `sambee`
  - ✅: `.github/workflows/promote-companion-release.yml`
- resolve `release_ref` as either a tag or GitHub release URL
- fail if no booleans are selected
- fail if the resolved release is missing, unpublished, or still a draft
- fail if required assets or `.sig` files are missing
- generate strict Tauri-compatible JSON for each selected Companion channel
- generate separate Sambee download metadata JSON when `sambee=true`
- ensure Sambee-specific fields never appear in Tauri feed files
- make generation idempotent and log exactly which files will change

### Manual

- decide whether feed files are pushed directly or updated through pull requests
  - direct push is simpler and usually appropriate if the promotion workflow is already manual and limited to trusted operators
  - pull requests are safer if you want review history or if branch protection blocks workflow pushes
  - decide this before the workflow is implemented because it changes how the workflow writes files and how operators complete promotions
  - ✅: direct push
- run the promotion workflow in GitHub after a release is published
- confirm the updated feed files point at the intended release
  - verify that only the selected feed files changed
  - verify that each changed Tauri feed contains the expected `version`, `pub_date`, `notes`, platform URLs, and signatures
  - verify that the Sambee metadata file contains only the intended download fields and no Tauri-only structure
  - verify that all generated URLs point to immutable assets in the published release
  - rerun the workflow with the same inputs once to confirm idempotent behavior

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

### AI can do

- add or update operator-facing documentation for draft publication, release promotion, rollback, and pinning
- assist with dry-run execution by checking generated files, workflow definitions, and code paths
- adjust implementation details based on dry-run findings

### Manual

- build a test Companion release
- verify a draft release appears in the release repo
- publish the release manually
- run the promotion workflow with only `companion_channel_test=true`
- verify Companion on the `test` channel discovers the update
- run the promotion workflow again with `sambee=true`
- verify Sambee displays the expected download link
- rehearse promotion through `test`, then `beta`, then `stable`
- confirm `feeds/sambee/companion/latest.json` is updated only when intended
  - record the exact release used for the dry run so future regressions can be compared against it
  - verify that promoting to `test` does not implicitly change `beta`, `stable`, or the Sambee metadata file
  - verify that promoting to `sambee=true` does not implicitly change any Tauri channel feed
  - verify rollback by repointing one feed to the previous known-good release

### Exit Criteria

- the end-to-end publishing and promotion flow has been exercised successfully once

## Suggested Implementation Order

1. Complete the manual repository, secret, and hosting prerequisites.
2. Have AI update the Companion build workflow to publish draft releases there.
3. Have AI implement the promotion workflow and feed generation.
4. Run a manual release-pipeline test in GitHub.
5. Have AI update Companion to use the new Tauri feed URLs.
6. Have AI update Sambee to use the new download metadata feed and pin override.
7. Perform a manual end-to-end dry run before enabling stable rollout.

## Open Implementation Decisions

These are remaining product or operational decisions that may still be open after implementation starts. They should be tracked explicitly, but they do not all block the first coding steps.

- the exact Sambee pin configuration schema and storage location
- whether Linux installers should also be exposed in Sambee UI or only desktop platforms that Sambee officially supports

## Manual Prerequisites Before Asking AI To Implement

These are the decisions and setup tasks that should be completed before asking AI to implement the first non-placeholder version.

- create or confirm the dedicated release repository
- decide the feed-hosting model
  - choose between default-branch Pages publishing and dedicated-branch Pages publishing
  - use `sambee.net` as the public domain namespace
  - decide the exact subdomain or path that will host the feeds
- configure the required GitHub secrets and permissions
- decide the base URLs for production and development
  - write down the exact URLs, not just the hosting approach
- decide whether workflow-generated feed changes push directly or go through pull requests

The goal of this section is to establish the concrete repo names, auth model, feed host, and write path so the initial implementation does not need placeholders.

Without those decisions, AI can still draft code and workflow files, but the implementation will contain placeholders that must be reconciled later.

## Completion Checklist

- [ ] release repository exists and is writable by automation
- [ ] Companion build workflow publishes draft releases to the release repository
- [ ] release assets and signatures are complete and validated
- [ ] promotion workflow exists with `release_ref` and four booleans
- [ ] promotion workflow generates Tauri feed JSON correctly
- [ ] promotion workflow generates Sambee metadata JSON correctly
- [ ] Companion updater uses the new feed layout
- [ ] Companion channel selection works end-to-end
- [ ] Sambee resolves download metadata from the new source
- [ ] Sambee optional pin override works
- [ ] one full dry run has been completed
- [ ] operator-facing documentation has been updated