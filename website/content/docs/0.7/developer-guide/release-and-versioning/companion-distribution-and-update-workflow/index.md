+++
title = "Companion Distribution And Update Workflow"
description = "Understand how Companion builds become draft releases, how feeds are promoted, and why Sambee and Companion read different public metadata."
+++

Companion distribution is intentionally split between build control in the main repository and public distribution in a dedicated release repository.

That separation keeps Companion binaries out of normal Sambee deployments while still letting Sambee surface Companion downloads and installed Companion builds fetch updates.

## Main Control Points

| File or system | Role |
|---|---|
| `.github/workflows/build-companion.yml` | builds platform artifacts and updates a draft release |
| `.github/workflows/promote-companion-release.yml` | promotes one published release to selected public feeds |
| `.github/scripts/promote_companion_release.py` | resolves release assets and writes the feed JSON files |
| `helgeklein/sambee-companion` | dedicated public release repository |
| `docs/feeds/` in the release repository | committed public feed files |

## Build Flow

The build workflow creates the release artifacts but does not decide which update channels see them.

1. an operator runs the `Build Companion` workflow
2. CI syncs and verifies version metadata before building
3. the workflow builds the selected platform matrix
4. Tauri packaging uploads assets to a draft release in `helgeklein/sambee-companion`
5. a human reviews and publishes that draft release

Release tags follow the `companion-vX.Y.Z` pattern.

## Promotion Flow

Channel promotion is a separate manual workflow.

1. an operator runs `Promote Companion Release`
2. the workflow accepts a `release_ref` plus booleans for `test`, `beta`, `stable`, and Sambee metadata targets
3. the workflow checks out both the main repository and the dedicated release repository
4. `promote_companion_release.py` resolves the release by tag, release URL, or numeric release ID
5. the script verifies the needed assets and signatures, then rewrites only the selected feed JSON files
6. the workflow commits and pushes the feed updates in the release repository

This keeps publishing immutable release assets separate from mutable channel pointers.

## Feed Split

Sambee and Companion do not read the same public feed.

- installed Companion builds read Tauri updater manifests under `feeds/companion/tauri/<channel>/latest.json`
- Sambee reads `feeds/sambee/companion/latest.json` to render Companion download links

That distinction is important.

- promoting a release to a Companion channel affects auto-update visibility for installed apps
- promoting the Sambee metadata affects which direct downloads the product surfaces
- the same published Companion release can move across `test`, `beta`, and `stable` over time without rebuilding binaries

## Asset And Signature Rules

Promotion is intentionally strict about release completeness.

- Tauri channel feeds require usable updater bundles and matching signatures for the included platforms
- Sambee metadata requires downloadable installer assets
- a platform can be absent from a release, but any platform that is included must have the assets required for the selected feed type

If the selected feed target cannot be built from the published assets, promotion should fail instead of silently publishing a broken pointer.

## Contributor Rules

- do not treat update channels as different binaries; channels are feed pointers
- do not patch broken published assets in place; build and publish a new release instead
- review the feed target you are changing, because Sambee-download metadata and Companion auto-update metadata serve different consumers
- keep release automation changes aligned with asset naming conventions, because promotion depends on asset-pattern matching

## When To Use This Page

Use this page when you are changing Companion release automation, feed generation, update-channel behavior, or the assumptions Sambee makes about Companion downloads.

## Related Pages

- [Dependency And Release Workflow](../dependency-and-release-workflow/): keep Companion release work aligned with the broader version-sensitive workflow
- [Companion Overview](../../companion-architecture/companion-overview/): place the release pipeline in the wider Companion architecture
