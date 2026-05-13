# Docker Image Release Channels Plan

## Purpose

This document proposes a release-channel model for the Sambee Docker image that mirrors the existing Companion channel concept:

- `stable`
- `beta`
- `test`

The goal is to give operators and internal testers a clear, predictable way to consume different levels of release maturity without creating multiple independent packaging systems.

This is a planning document for review. It is not an implementation spec yet, but it is intended to be concrete enough to drive workflow and documentation changes with minimal rework.

## Executive Summary

The recommended model is:

- keep building one production image from the existing repository-root `Dockerfile`
- keep immutable version tags and digest-based deployment as the source of truth
- add moving channel tags as promoted aliases: `stable`, `beta`, and `test`
- promote channels by re-tagging or pushing the same already-validated digest, not by rebuilding different channel-specific images
- reserve `stable` for full releases, `beta` for prereleases, and `test` for main-branch or manually triggered preview builds

This preserves reproducibility, avoids operational drift, and matches the Companion concept of channels as promoted feeds rather than as separate build products.

## Goals

- Give Docker users a simple channel-based way to choose release maturity.
- Keep the current version discipline centered on `VERSION` and immutable Git refs.
- Avoid creating separate Dockerfiles, separate container repositories, or channel-specific runtime differences.
- Preserve signed, multi-arch, reproducible images.
- Make channel promotion operationally safe and easy to understand.
- Keep production guidance centered on image digests, even when channel tags exist.

## Non-Goals

- Replacing immutable version tags with channel tags.
- Making `stable`, `beta`, or `test` the canonical deployment target for production.
- Creating different application behavior by channel inside the Docker image.
- Creating separate registries or separate repositories such as `sambee-beta` or `sambee-test`.
- Solving a broader application feature-flag or release-train strategy beyond container publication.

## Current State

The repository already has a strong container release foundation:

- one runtime image built from the root `Dockerfile`
- publication to `ghcr.io/<owner>/sambee`
- multi-arch output for `linux/amd64` and `linux/arm64`
- immutable semantic version tags
- moving `major.minor` tags
- moving `latest` only for full releases
- a `sha-<commit>` tag for traceability
- smoke-tested validation before publish
- vulnerability scanning before real release publication
- Cosign signing, SBOM generation, and provenance attestation

The main workflow behavior is documented in:

- `.github/workflows/docker-image-publish.yml`
- `website/content/docs/0.7/developer-guide/release-and-versioning/container-image-build-and-publish-workflow/index.md`

The current model already includes a useful precursor to a `test` channel:

- manual dispatch supports `publish_version_override`
- override-based test publishes surface Trivy findings as advisory rather than blocking

That makes the current system a good base for first-class channel tags.

## Design Principles

### One artifact, multiple promoted aliases

There should be one Sambee production image shape.

Channels should identify promotion level, not artifact type.

### Immutable first

Immutable version tags and digests remain the authoritative artifacts.

Moving channel tags should always point to a previously validated immutable artifact.

### No rebuild on promotion

Promoting a build from `beta` to `stable` should not rebuild the image. Rebuilding creates a different artifact and weakens auditability.

### Stable operator expectations

The meaning of each channel must remain stable over time.

- `stable` means recommended for normal production use
- `beta` means preview release candidate quality, with possible regressions
- `test` means short-lived preview builds for validation and internal use

### Digest remains canonical

Even after adding channels, production docs should continue recommending deployment by digest wherever practical.

## Recommended Channel Semantics

### Stable

`stable` points to the newest published non-prerelease Sambee release image.

Recommended inputs:

- GitHub Release published from tag `vX.Y.Z`
- `github.event.release.prerelease == false`

Recommended tags on publication:

- `X.Y.Z`
- `X.Y`
- `stable`
- optionally `latest`
- `sha-<commit>`

### Beta

`beta` points to the newest published prerelease image.

Recommended inputs:

- GitHub prerelease published from tag `vX.Y.Z-beta.N`
- possibly other semver prerelease suffixes if the project wants to allow them consistently

Recommended tags on publication:

- full prerelease tag such as `0.8.0-beta.1`
- optional moving prerelease series tag such as `0.8-beta`
- `beta`
- `sha-<commit>`

`beta` must not move `stable` or `latest`.

### Test

`test` points to the newest intentionally published preview image that is not a stable release or beta prerelease.

Recommended inputs:

- push to `main`
- scheduled nightly build from `main`
- manual dispatch for preview validation
- explicit override-based test publish

Recommended tags on publication:

- `test`
- `sha-<commit>`
- optional timestamped tag such as `test-20260513-abc1234`
- optional branch-scoped preview tag if needed in the future

`test` should be treated as volatile and unsupported for production.

## Recommended Tagging Model

### Immutable tags

Immutable tags should continue to exist because they are the basis for rollback, auditability, and human-readable traceability.

Recommended immutable tags:

- `X.Y.Z`
- `X.Y.Z-beta.N`
- `sha-<commit>`
- optional timestamped preview tags for `test`

### Moving tags

Recommended moving tags:

- `stable`
- `beta`
- `test`
- `X.Y`
- optional `X.Y-beta`
- optional `latest`, if retained as an alias of `stable`

### Tag meanings

`latest` should not have a meaning separate from `stable`.

If both exist, they should move together on the same full-release publish event. If the team wants to simplify operator messaging later, `latest` can be deprecated in favor of `stable`.

## Best Practices

### Promote the same digest

The highest-value rule is that promotion should reuse the exact same image digest.

That means:

- build once
- validate once
- sign once per published artifact event if needed by tooling
- point channel tags at that artifact

### Keep channel tags mutable but narrow in scope

Channel tags are expected to move. That is fine, but they should move only within their defined release lane.

- `stable` only moves on full releases
- `beta` only moves on prereleases
- `test` only moves on preview publishes

### Do not make channel tags the primary rollback tool

Rollback should use a known good digest or immutable version tag.

Channel tags are too coarse and too mutable for incident response.

### Keep the same image contents across channels

Do not put channel-specific code paths into the Docker image unless there is a hard product requirement later.

If feature exposure differs by release maturity, that should be controlled by release selection and normal application versioning, not by channel-specific build logic.

### Keep validation strong for stable and beta

Stable and beta should both go through the same core build and smoke-test path.

The main difference should be publication policy and operator messaging, not lower engineering standards for beta.

### Be explicit about support level

The docs should clearly state:

- `stable` is production-oriented
- `beta` is preview quality and may change or regress
- `test` is for validation and short-lived experimentation only

### Consider retention for preview tags

If timestamped `test-*` tags are published, define whether they are retained indefinitely or cleaned up on a schedule.

Without an explicit retention policy, preview artifacts can create registry noise and operator confusion.

## Proposed Workflow Architecture

## Option A: Extend the existing publish workflow and add one test workflow

This is the recommended option.

Shape:

- keep `Release: Publish Docker Image` for release-driven publication
- extend it to push `beta` for GitHub prereleases and `stable` for full releases
- keep `latest` tied only to `stable` releases
- add a separate workflow for `test` publication from `main`, schedule, and manual dispatch

Advantages:

- minimal conceptual change to current release behavior
- clear separation between release publication and preview publication
- easy to explain in docs
- lower risk of accidental channel crossover

Disadvantages:

- requires maintaining two workflows instead of one

## Option B: One unified workflow with channel-aware inputs and branching logic

Shape:

- one workflow handles stable, beta, and test publication modes
- event type or input determines channel and allowed tags

Advantages:

- less duplicated YAML

Disadvantages:

- more branching complexity in one workflow
- greater risk of mistakes in permission and tagging logic
- harder to review and audit over time

Recommendation: prefer Option A unless duplication becomes materially painful.

## Proposed Publish Rules

### Stable publication rules

- trigger from published GitHub Releases that are not marked prerelease
- require exact match between `VERSION` and tag `vX.Y.Z`
- publish immutable tags and moving tags for stable
- publish `stable`
- publish `latest` only if the project keeps it
- block publication on smoke-test or Trivy failure

### Beta publication rules

- trigger from published GitHub Releases marked prerelease
- require exact match between `VERSION` and prerelease tag, for example `v0.8.0-beta.1`
- publish immutable prerelease tag and `beta`
- optionally publish a series tag like `0.8-beta`
- do not publish `stable` or `latest`
- keep the same validation gates as stable unless there is a strong reason not to

### Test publication rules

- trigger from `main`, schedule, or manual dispatch
- use either the checked-in version plus preview metadata or the existing manual override mechanism
- publish `test` and `sha-<commit>`
- optionally publish a timestamped preview tag for traceability
- allow some gates to be advisory rather than blocking if the intent is preview validation rather than release

## Versioning Strategy for Test Builds

The main design decision for `test` is whether the image metadata should advertise an explicit preview version string or keep the repository `VERSION` unchanged while relying on `sha-<commit>` and the `test` tag.

### Recommended approach

Keep the current override mechanism for explicit manual preview publications, but avoid rewriting version semantics for routine `main`-branch test channel builds.

For normal `test` channel publication, prefer:

- image tag: `test`
- image tag: `sha-<commit>`
- OCI version label: checked-in `VERSION`
- OCI revision label: commit SHA

For manual special-case preview publication, allow:

- `publish_version_override` such as `0.8.0-test1`

This keeps normal preview automation simple while preserving a path for deliberate test-only publication experiments.

## Promotion Model

There are two viable promotion models.

### Model 1: Publish per lane

Each lane builds and publishes independently.

Examples:

- stable release event builds and publishes stable
- prerelease event builds and publishes beta
- main push builds and publishes test

Pros:

- simple mental model
- easy to automate from GitHub events

Cons:

- promotion from beta to stable involves rebuilding on the stable release event unless the workflow is deliberately structured around existing digests

### Model 2: Promote existing immutable artifact

One published immutable artifact can later be promoted by applying additional tags.

Example:

- prerelease publishes `0.8.0-beta.2` and `beta`
- full release for the same build lineage points `stable` at the validated release artifact without creating channel divergence

Pros:

- strongest reproducibility story
- clean audit trail

Cons:

- slightly more complex workflow implementation
- requires careful handling of manifest lists and tagging in GHCR

Recommendation: move toward Model 2 where practical, but do not block the first channel implementation on perfect digest-promotion mechanics if that meaningfully delays delivery.

The first implementation can still be acceptable if each event rebuilds from the immutable tagged source, because the source ref remains fixed and validation remains strong. Long term, true digest promotion is better.

## Documentation Changes Needed

If channel support is implemented, the following operator-facing and developer-facing documentation should change.

### Admin-facing Docker deployment docs

Update deployment docs so operators can pull published images by channel rather than assuming local `docker compose build` as the default path.

Likely areas:

- Docker deployment guide
- update guide
- any compose examples that currently use `build: .`

### Release and container workflow docs

Update the release workflow docs to explain:

- channel semantics
- which events move which tags
- the relationship between `stable`, `beta`, `test`, and `latest`
- why digests remain the preferred deployment target

### Support and warning language

Add explicit wording for:

- `beta` may contain unfinished work or regressions
- `test` is not a production support channel

## Compose and Operator UX Recommendations

If channels are added, the example compose file should eventually prefer pulling a published image.

Recommended operator-facing examples:

```yaml
services:
  sambee:
    image: ghcr.io/<owner>/sambee:stable
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
```

Alternative preview examples can then use:

- `ghcr.io/<owner>/sambee:beta`
- `ghcr.io/<owner>/sambee:test`

The docs should still explain that the safest production pin is a digest, for example:

```yaml
services:
  sambee:
    image: ghcr.io/<owner>/sambee@sha256:<digest>
```

## Security and Supply Chain Considerations

### Signing

Published channel artifacts should continue to be signed.

If the workflow publishes channel tags in the same push event as immutable tags, the existing signing flow can usually remain digest-centered.

### Provenance and SBOM

Do not weaken SBOM or provenance generation for preview channels unless there is a concrete infrastructure constraint.

The more preview channels exist, the more useful provenance becomes.

### Vulnerability gates

Recommended gate posture:

- `stable`: blocking
- `beta`: blocking
- `test`: configurable, ideally advisory when used for experimental preview publication

This keeps preview throughput reasonable without lowering the bar for anything positioned as releasable.

## Operational Risks

### Risk: channel confusion

Operators may not understand the difference between `stable`, `latest`, `beta`, and `test`.

Mitigation:

- keep `latest` equal to `stable` if retained
- document clear channel meanings
- use examples that explicitly select a channel

### Risk: accidental production use of `test`

Some users will deploy the easiest tag they see.

Mitigation:

- call out that `test` is unsupported for production
- prefer `stable` in all primary docs
- keep digest pinning in production guidance

### Risk: preview artifact sprawl

Publishing many preview tags can clutter the registry.

Mitigation:

- define retention behavior for timestamped `test` tags
- keep the moving `test` tag but limit additional preview aliases

### Risk: workflow complexity leaks into release management

Too many event combinations can make publication harder to reason about.

Mitigation:

- keep stable, beta, and test rules narrow and explicit
- prefer separate workflows where separation reduces risk

### Risk: rebuild-based promotion weakens provenance

If promotion is implemented by rebuilding instead of reusing an existing digest, provenance becomes harder to reason about.

Mitigation:

- treat digest promotion as the long-term target
- document clearly if phase 1 still rebuilds from immutable refs

## Phased Rollout Plan

## Phase 0: Agreement and naming

Decide and document:

- exact tag names: `stable`, `beta`, `test`
- whether `latest` remains
- whether prerelease series tags like `0.8-beta` are wanted
- whether timestamped `test-*` tags are wanted

Exit criteria:

- channel naming and semantics approved

## Phase 1: Stable and beta release publication

Change the release publication workflow so:

- full releases publish `stable`
- prereleases publish `beta`
- `latest` remains tied only to stable if retained

Exit criteria:

- stable release event moves `stable`
- prerelease event moves `beta`
- docs describe both correctly

## Phase 2: Test channel publication

Add a preview publication workflow for:

- `main`
- manual dispatch
- optional scheduled nightly publication

Exit criteria:

- `test` updates automatically from preview publication inputs
- docs describe intended use and support posture

## Phase 3: Digest promotion refinement

Improve implementation so promotion uses already-built immutable artifacts where feasible.

Exit criteria:

- promotion avoids unnecessary rebuilds
- audit trail is clear and documented

## Phase 4: Operator guidance hardening

Update compose examples, upgrade docs, and support docs to normalize channel-aware usage.

Exit criteria:

- primary deployment docs use published images
- production guidance still recommends digests

## Suggested Implementation Checklist

- update release workflow tagging logic for stable and beta
- decide whether `latest` remains and document it explicitly
- create a separate workflow for `test` publication
- define allowed triggers for `test`
- decide whether timestamped preview tags are needed
- update operator docs to show `image:` examples instead of only `build:` examples
- update release workflow docs
- document support expectations for each channel
- verify signing, provenance, and SBOM behavior across all channel publishes
- verify registry UI and discoverability are acceptable

## Open Questions

These should be resolved before implementation begins.

1. Should `latest` remain, or should `stable` become the only moving production-oriented alias?
   A: latest should not remain
2. Should beta accept only `-beta.N`, or any semver prerelease suffix such as `-rc.N`?
   A: accept any semver prerelease suffix
3. Should `test` publish on every `main` push, nightly only, or only by manual dispatch?
   A: only on manual dispatch
4. Should `test` vulnerabilities be advisory only, or should there still be a blocking severity threshold?
   A: advisory only
5. Do we want timestamped `test-*` tags for traceability, or is `sha-<commit>` sufficient?
   A: no, sha-commit is sufficient
6. Is phase 1 allowed to rebuild from immutable refs, or does the team want true digest-promotion mechanics from the start?
   A: don't care
7. Do we want compose examples in the repo to default to pulling the published image instead of building locally?
   A: yes

Additional questions:

8. How can we implement deleting older test builds?

## Recommendation

Adopt release channels for the Docker image using moving tags that point at the existing single production image stream.

Recommended first implementation:

- `stable` for full releases
- `beta` for GitHub prereleases
- `test` from a separate preview workflow
- keep immutable version tags and `sha-<commit>` tags
- keep digest deployment as the recommended production practice
- keep `latest` only if it remains exactly equivalent to `stable`

This gives Sambee a channel model that matches the Companion concept at the operational level without introducing multiple packaging systems or confusing artifact drift.
