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
- reserve `stable` for full releases, `beta` for prereleases, and `test` for manually triggered preview builds

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
- `sha-<commit>`

### Beta

`beta` points to the newest published prerelease image.

Recommended inputs:

- GitHub prerelease published from tag `vX.Y.Z-beta.N`
- any valid semver prerelease suffix, used consistently

Recommended tags on publication:

- full prerelease tag such as `0.8.0-beta.1`
- optional moving prerelease series tag such as `0.8-beta`
- `beta`
- `sha-<commit>`

`beta` must not move `stable`.

### Test

`test` points to the newest intentionally published preview image that is not a stable release or beta prerelease.

Recommended inputs:

- manual dispatch for preview validation
- explicit override-based test publish

Recommended tags on publication:

- `test`
- `sha-<commit>`
- optional branch-scoped preview tag if needed in the future

`test` should be treated as volatile and unsupported for production.

## Recommended Tagging Model

### Immutable tags

Immutable tags should continue to exist because they are the basis for rollback, auditability, and human-readable traceability.

Recommended immutable tags:

- `X.Y.Z`
- `X.Y.Z-beta.N`
- `sha-<commit>`

### Moving tags

Recommended moving tags:

- `stable`
- `beta`
- `test`
- `X.Y`
- optional `X.Y-beta`

### Tag meanings

`stable` should be the only moving production-oriented alias.

The plan should explicitly remove `latest` rather than keep two moving tags with overlapping meaning.

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

Even without timestamped `test-*` tags, preview artifacts can still accumulate if each manual test publish creates a new package version behind the mutable `test` tag.

The retention policy therefore needs to be defined at the package-version level, not only at the tag-name level.

## Chosen Workflow Architecture

The chosen workflow architecture is Option A: extend the existing release publish workflow and add one separate test workflow.

Shape:

- keep `Release: Publish Docker Image` for release-driven publication
- extend it to push `beta` for GitHub prereleases and `stable` for full releases
- remove `latest`
- add a separate workflow for `test` publication by manual dispatch only

Advantages:

- minimal conceptual change to current release behavior
- clear separation between release publication and preview publication
- easy to explain in docs
- lower risk of accidental channel crossover

Disadvantages:

- requires maintaining two workflows instead of one

This choice keeps release publication and preview publication intentionally separate. That reduces the risk of accidental channel crossover and keeps the stable and beta release path easier to audit.

## Proposed Publish Rules

### Stable publication rules

- trigger from published GitHub Releases that are not marked prerelease
- require exact match between `VERSION` and tag `vX.Y.Z`
- publish immutable tags and moving tags for stable
- publish `stable`
- block publication on smoke-test or Trivy failure

### Beta publication rules

- trigger from published GitHub Releases marked prerelease
- require exact match between `VERSION` and any valid semver prerelease tag, for example `v0.8.0-beta.1` or `v0.8.0-rc.1`
- publish immutable prerelease tag and `beta`
- optionally publish a series tag like `0.8-beta`
- do not publish `stable`
- keep the same validation gates as stable unless there is a strong reason not to

### Test publication rules

- trigger by manual dispatch only
- use either the checked-in version plus preview metadata or the existing manual override mechanism
- publish `test` and `sha-<commit>`
- allow some gates to be advisory rather than blocking if the intent is preview validation rather than release

## Versioning Strategy for Test Builds

The main design decision for `test` is whether the image metadata should advertise an explicit preview version string or keep the repository `VERSION` unchanged while relying on `sha-<commit>` and the `test` tag.

### Recommended approach

Keep the current override mechanism for explicit manual preview publications, but avoid rewriting version semantics for routine test channel builds.

For normal `test` channel publication, prefer:

- image tag: `test`
- image tag: `sha-<commit>`
- OCI version label: checked-in `VERSION`
- OCI revision label: commit SHA

For manual special-case preview publication, allow:

- `publish_version_override` such as `0.8.0-test1`

This keeps normal preview automation simple while preserving a path for deliberate test-only publication experiments.

## Chosen Promotion Model

The chosen promotion model is Model 2: promote an existing immutable artifact.

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

This is the right long-term shape because it preserves the integrity of validation, signing, and provenance. Stable and beta should identify promotion state of a known artifact, not trigger separate artifact creation.

Implementation note:

- the first shipped implementation should use artifact-promotion mechanics from the start
- the target architecture remains artifact promotion, not rebuild-based promotion
- the workflows should not ship with a temporary rebuild-based compromise

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
- the relationship between `stable`, `beta`, and `test`
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
- `test`: advisory only

This keeps preview throughput reasonable without lowering the bar for anything positioned as releasable.

## Operational Risks

### Risk: channel confusion

Operators may not understand the difference between `stable`, `beta`, and `test`.

Mitigation:

- document clear channel meanings
- use examples that explicitly select a channel

### Risk: accidental production use of `test`

Some users will deploy the easiest tag they see.

Mitigation:

- call out that `test` is unsupported for production
- prefer `stable` in all primary docs
- keep digest pinning in production guidance

### Risk: preview artifact sprawl

Publishing many preview artifacts can clutter the registry.

Mitigation:

- keep the moving `test` tag and `sha-<commit>` tags only
- delete older test-only package versions automatically on a schedule or after each test publish
- document a concrete retention window

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

## Test Build Retention Strategy

The remaining operational question is how to delete older `test` builds automatically.

The cleanest approach is to treat cleanup as a separate registry-maintenance workflow rather than overloading the publish workflow.

### Recommended policy

- keep the current `test` tag pointing at the newest test publish
- keep `sha-<commit>` on the currently published test image for traceability
- automatically delete older test package versions after a short retention window
- do not delete stable or beta package versions through the same cleanup rule

Recommended default retention:

- keep the newest 10 test package versions

This is simpler and more predictable than age-based cleanup.

### Important constraint

With GHCR, cleanup operates on package versions, not on individual tags in isolation.

That means the workflow needs to identify package versions whose tags are exclusively test-related before deletion. It must never delete a package version that is also referenced by a stable or beta tag.

### Safe implementation pattern

Use a dedicated GitHub Actions workflow that:

1. lists package versions for `ghcr.io/<owner>/sambee`
2. inspects the tags attached to each version
3. keeps versions that have any protected tag, such as semantic release tags, prerelease tags, moving tags `stable` or `beta`, or moving minor tags like `0.7`
4. marks versions as deletable only if their tags are test-only, for example `test` and `sha-<commit>`
5. sorts the deletable versions by creation time
6. deletes everything except the newest 10 deletable versions

### Recommended workflow shape

- trigger on successful manual test publication
- optionally also run on a schedule as a safety cleanup pass
- use the GitHub Packages API via `gh api` or the REST API directly
- require package delete permission and log every deleted version ID for auditability

### Why this should be separate from publish

Keeping cleanup separate is safer because:

- the publish workflow stays focused on build, validation, and release
- cleanup logic is easier to test and reason about independently
- an error in cleanup logic is less likely to break publication

### Fallback option

If GHCR package-version filtering turns out to be awkward in practice, the fallback is:

- keep only the moving `test` tag for routine preview use
- stop treating old `sha-<commit>` test versions as long-lived retained artifacts
- run a simple package-version cleanup that preserves only known stable and beta references

This is less flexible but still acceptable if the registry UX becomes too cumbersome.

## Full Implementation Plan

This section converts the rollout direction into an execution-ready plan.

The implementation should be delivered as four workstreams with clear dependencies:

1. release workflow changes for `stable` and `beta`
2. manual preview workflow for `test`
3. GHCR cleanup workflow for old test-only package versions
4. operator and developer documentation updates

The work should be sequenced so that release-path correctness comes first, preview publication comes second, retention automation comes third, and operator-facing docs land after the behavior is real.

### Step 1: Finalize implementation constants

Before editing workflows, lock the constants that workflow code and documentation will depend on.

Constants to encode:

- moving tags: `stable`, `beta`, `test`
- immutable traceability tag: `sha-<commit>`
- no `latest` tag
- prereleases may use any valid semver prerelease suffix
- `test` publication is manual-dispatch only
- `test` vulnerability findings are advisory only
- test retention policy keeps the newest 10 test-only package versions

Expected output:

- the planning doc remains the decision source
- workflow authors can implement without re-litigating naming or behavior

Acceptance criteria:

- there is no remaining workflow or docs language that assumes `latest`
- there is no remaining ambiguity about when `stable`, `beta`, and `test` should move

### Step 2: Update the release publish workflow for stable and beta

Modify `.github/workflows/docker-image-publish.yml` so the existing release workflow becomes the production path for both `stable` and `beta` publication.

Required changes:

- keep publication triggered from GitHub Releases
- if the release is not marked prerelease, publish `stable`
- if the release is marked prerelease, publish `beta`
- remove all logic that publishes or references `latest`
- continue publishing immutable version tags and `sha-<commit>`
- continue publishing `X.Y` for stable releases
- allow valid semver prerelease versions such as `-beta.N` and `-rc.N`

Implementation notes:

- tag selection should happen in one dedicated tag-construction step
- stable and beta behavior should differ only in tag emission and release classification, not in validation quality
- the workflow should keep current smoke-test, Trivy, signing, SBOM, and provenance behavior unless a change is explicitly required

Files likely affected:

- `.github/workflows/docker-image-publish.yml`
- possibly any shared release helper scripts if tag derivation is factored out

Acceptance criteria:

- a full release publishes `stable`, `X.Y.Z`, `X.Y`, and `sha-<commit>`
- a prerelease publishes `beta`, `X.Y.Z-<suffix>`, optional prerelease series tags if kept, and `sha-<commit>`
- neither path publishes `latest`
- the workflow still signs the published digest and emits provenance and SBOM data

### Step 3: Make the release workflow safe for promotion-model staging

The chosen end state is artifact promotion rather than rebuild-based promotion.

The first implementation should use artifact-promotion mechanics from the start rather than treating them as a later refinement.

Required changes:

- keep artifact identity visible in workflow outputs
- make image-tag construction independent from build logic
- avoid baking channel-specific assumptions deep into validation steps
- keep stable and beta channel movement conceptually separate from image construction

Implementation notes:

- do not fall back to rebuilding as a first-release shortcut
- structure the workflow so immutable artifact creation and later channel promotion are explicitly separated

Acceptance criteria:

- the workflow structure clearly separates build, validation, publication, and promotion concerns
- stable and beta movement reuse an existing validated artifact rather than creating a second artifact
- the release process is auditable without requiring a later promotion refactor

### Step 4: Add a dedicated manual test publish workflow

Create a separate GitHub Actions workflow for `test` publication.

The workflow should exist specifically to publish preview images on demand without mixing preview behavior into the stable and beta release path.

Required behavior:

- trigger by `workflow_dispatch` only
- allow publication from an immutable source ref or explicit override flow
- publish `test` and `sha-<commit>`
- not publish `stable` or `beta`
- treat Trivy findings as advisory only for the preview publication lane
- continue producing a signed published digest if technically practical within the existing model

Recommended inputs:

- source ref or release tag to publish from
- optional `publish_version_override`
- optional confirmation-style input that makes preview intent explicit

Files likely affected:

- new workflow under `.github/workflows/`, for example a `docker-image-publish-test.yml`
- possibly release helper scripts if version override handling is shared

Acceptance criteria:

- maintainers can publish a preview image manually without touching the stable or beta channel
- the `test` tag moves only when this workflow succeeds
- the workflow emits enough logs and outputs to identify the published digest and source ref

### Step 5: Add a GHCR cleanup workflow for test-only package versions

Create a separate workflow that deletes older test-only package versions from GHCR.

This should not be merged into the publish workflow. Cleanup is safer and easier to reason about when isolated.

Required behavior:

- inspect package versions for `ghcr.io/<owner>/sambee`
- determine the tags attached to each package version
- preserve any package version that has stable, beta, semantic version, prerelease version, or minor-series tags
- treat versions as deletable only when they are test-only, such as `test` plus `sha-<commit>`
- retain the newest 10 deletable test-only package versions
- delete older deletable versions

Recommended triggers:

- after successful manual test publication
- optional scheduled safety run

Implementation notes:

- use the GitHub Packages API via `gh api` or REST calls
- require package delete permission
- log deleted version IDs and associated tags for auditability
- fail safely: if the workflow cannot confidently classify a package version, it should keep it rather than delete it

Files likely affected:

- new workflow under `.github/workflows/`, for example a `docker-image-cleanup-test-packages.yml`

Acceptance criteria:

- stable and beta package versions are never selected for deletion
- old test-only package versions are pruned automatically according to policy
- cleanup logs are sufficient to reconstruct what was deleted and why

### Step 6: Update operator-facing deployment docs

Once workflow behavior is implemented, update the Docker deployment docs so the recommended operator path uses published images rather than only local builds.

Required doc changes:

- show `image: ghcr.io/<owner>/sambee:stable` as the primary example
- add explicit examples for `beta` and `test`
- explain that production should prefer a digest pin where practical
- remove wording that implies `latest` exists
- explain the support posture of each channel clearly

Files likely affected:

- `docker-compose.example.yml`
- Docker deployment docs under `website/content/docs/`
- update/maintenance docs under `website/content/docs/`

Acceptance criteria:

- the primary operator example uses a published image
- the docs explain the difference between `stable`, `beta`, and `test`
- the docs still recommend digest pinning for production-sensitive deployments

### Step 7: Update developer-facing release documentation

After the workflows exist, update the release and CI documentation to match actual behavior.

Required doc changes:

- explain that the release workflow now handles both `stable` and `beta`
- explain that `test` is published from a separate manual workflow
- explain that `latest` has been removed
- explain the chosen promotion model as artifact reuse from the first implementation
- explain the GHCR cleanup workflow and the retention policy for test-only package versions

Files likely affected:

- release workflow docs under `website/content/docs/0.7/developer-guide/release-and-versioning/`
- CI workflow docs under `website/content/docs/0.7/developer-guide/testing-and-quality-gates/`
- any security or integrity docs that mention current tag behavior

Acceptance criteria:

- docs match the actual workflows and tags produced in CI
- there is no stale mention of `latest`
- there is no stale statement that test publication happens from `main` or nightly automation

### Step 8: Verify end-to-end behavior in a dry-run sequence

Before considering the implementation complete, run an end-to-end verification sequence.

Minimum scenarios:

1. full release publish path
2. prerelease publish path
3. manual test publish path
4. cleanup workflow path for test-only package versions

Verification targets:

- emitted tags are correct
- stable and beta channels never cross
- test publication does not move stable or beta
- no workflow emits `latest`
- signing and provenance outputs still exist where expected
- cleanup never selects a protected package version

Acceptance criteria:

- each scenario completes successfully or fails in an expected, explainable way
- observed registry state matches the plan exactly

### Step 9: Promote the plan into repository truth

After implementation and verification, this planning doc should stop being the only authoritative source.

Required follow-through:

- ensure workflow YAML is the primary behavior definition
- ensure website docs describe the final user-facing and maintainer-facing behavior
- keep this planning document as historical design context unless the team prefers to remove it later

Acceptance criteria:

- the behavior is understandable from the workflows and docs without reading the plan first

## Implementation Sequence

The recommended execution order is:

1. finalize constants and acceptance criteria
2. update the existing release publish workflow for `stable` and `beta`
3. implement release workflow outputs and promotion steps around artifact reuse from day one
4. add the manual `test` publish workflow
5. add the GHCR cleanup workflow for old test-only package versions
6. update operator-facing deployment docs and examples
7. update developer-facing release and CI docs
8. run end-to-end verification across full release, prerelease, test publish, and cleanup paths

## Definition of Done

This effort is complete when all of the following are true:

- full releases move `stable`
- prereleases move `beta`
- manual preview publishes move `test`
- no workflow publishes `latest`
- old test-only package versions are cleaned up automatically according to policy
- operator docs default to published-image examples
- developer docs describe the real workflow behavior accurately
- promotion reuses existing validated artifacts from the first shipped implementation

## Resolved Decisions

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

## Remaining Question

8. How can we implement that older test builds are deleted automatically?

Recommended answer:

- create a dedicated cleanup workflow for GHCR package versions
- keep only test-only package versions in scope for deletion
- protect any version that has stable, beta, or semantic version tags attached
- retain the newest 10 test package versions by default
- run cleanup after each successful manual test publish and optionally on a scheduled safety pass

## Recommendation

Adopt release channels for the Docker image using moving tags that point at the existing single production image stream.

Recommended first implementation:

- `stable` for full releases
- `beta` for GitHub prereleases using any valid semver prerelease suffix
- `test` from a separate preview workflow by manual dispatch only
- keep immutable version tags and `sha-<commit>` tags
- keep digest deployment as the recommended production practice
- remove `latest`
- default compose examples to pulling the published image
- add a dedicated cleanup workflow for old test-only package versions

This gives Sambee a channel model that matches the Companion concept at the operational level without introducing multiple packaging systems or confusing artifact drift.
