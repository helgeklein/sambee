# Docker Image Release Channels Technical Design

## Purpose

This document translates the approved Docker image release-channel plan into a concrete technical design.

It specifies how Sambee should implement:

- `stable`
- `beta`
- `test`

using artifact promotion from the first shipped implementation.

This document focuses on mechanics, workflow boundaries, artifact flow, permissions, failure handling, and verification. Policy decisions and broader rationale remain in `DOCKER_IMAGE_RELEASE_CHANNELS_PLAN.md`.

## Scope

This design covers:

- GitHub Actions workflow design for release publication
- manual preview publication for `test`
- artifact reuse and promotion behavior for `stable` and `beta`
- GHCR tagging strategy
- GHCR cleanup of old test-only package versions
- required documentation updates
- end-to-end verification behavior

This design does not cover:

- broader application feature-flag strategy
- multi-repository or multi-registry release distribution
- non-GHCR registries
- application runtime behavior differences by channel

## Design Summary

The implementation will use three workflows:

1. `Release: Publish Docker Image`
2. `Preview: Publish Test Docker Image`
3. `Maintenance: Clean Up Test Docker Images`

The central rule is:

- build and validate one immutable multi-platform image artifact
- capture its published digest
- attach channel tags to that artifact without rebuilding it

That means:

- `stable` points to a validated release digest
- `beta` points to a validated prerelease digest
- `test` points to a manually published preview digest

The release workflow and preview workflow may both build and publish immutable artifacts, but channel movement inside each workflow must happen by digest reuse, not by a second build.

## Core Constraints

The implementation must satisfy all of the following:

- no `latest` tag is published
- `stable` and `beta` are moved only by release events
- `test` is moved only by manual preview publication
- `stable` and `beta` promotion reuse an already-built validated artifact
- release publication must fail if no previously published candidate artifact exists for the release commit
- candidate artifact lookup uses the full git commit SHA, not a shortened SHA
- `test` publication does not affect `stable` or `beta`
- cleanup never deletes package versions referenced by stable, beta, semantic version, prerelease, or minor-series tags
- production guidance continues to prefer digest pinning

## Artifact Lifecycle

### Stable release lifecycle

1. maintainer manually publishes a preview artifact from commit `C`
2. preview workflow builds, validates, and publishes one immutable multi-platform image artifact
3. preview workflow publishes `sha-<full-commit-sha>` and moves `test` to that digest
4. maintainer validates that candidate artifact
5. maintainer creates or publishes GitHub Release `vX.Y.Z` from the same commit `C`
6. release workflow resolves the existing candidate digest through `sha-<full-commit-sha>`
7. release workflow verifies that the candidate artifact matches the release commit and version contract
8. release workflow promotes that digest to `X.Y.Z`, `X.Y`, and `stable`
9. release workflow verifies that the promoted tags resolve to the same digest
10. release workflow signs or verifies signatures and attestation state for the promoted digest according to the final implementation choice

Result:

- the same digest is reachable via `X.Y.Z`, `X.Y`, `stable`, and `sha-<full-commit-sha>`

### Beta release lifecycle

1. maintainer manually publishes a preview artifact from commit `C`
2. preview workflow builds, validates, and publishes one immutable multi-platform image artifact
3. preview workflow publishes `sha-<full-commit-sha>` and moves `test` to that digest
4. maintainer validates that candidate artifact for prerelease use
5. maintainer creates or publishes GitHub prerelease `vX.Y.Z-<suffix>` from the same commit `C`
6. release workflow resolves the existing candidate digest through `sha-<full-commit-sha>`
7. release workflow verifies that the candidate artifact matches the prerelease commit and version contract
8. release workflow promotes that digest to `X.Y.Z-<suffix>` and `beta`
9. release workflow promotes that digest to a prerelease series tag such as `X.Y-beta`
11. release workflow verifies that the promoted tags resolve to the same digest
12. release workflow signs and attests the promoted digest

Result:

- the same digest is reachable via `X.Y.Z-<suffix>`, `X.Y-beta`, `beta`, and `sha-<full-commit-sha>`

### Test lifecycle

1. maintainer manually dispatches preview workflow
2. workflow resolves the source ref and optional override version
3. workflow runs preview validation path
4. workflow builds and pushes one immutable preview artifact
5. workflow captures the pushed manifest-list digest
6. workflow promotes that digest to `test`
7. workflow signs and attests the digest
8. cleanup workflow later prunes old test-only package versions

Result:

- the newest preview digest is reachable via `test` and `sha-<full-commit-sha>`

## Registry and Tagging Model

All images are published to:

- `ghcr.io/<owner>/sambee`

### Immutable tags

Stable release:

- `X.Y.Z`
- `sha-<full-commit-sha>`

Beta release:

- `X.Y.Z-<prerelease>`
- `sha-<full-commit-sha>`

Test publish:

- `sha-<full-commit-sha>`

### Moving tags

Stable release:

- `stable`
- `X.Y`

Beta release:

- `beta`
- `X.Y-beta`

Test publish:

- `test`

### Tagging rules

- `stable` must only ever point to a full release digest
- `beta` must only ever point to a prerelease digest
- `test` must only ever point to a manually published preview digest
- `sha-<full-commit-sha>` may coexist with any of the above if they reference the same artifact

That coexistence is intentional and correct.

## Workflow Architecture

### Workflow 1: Release: Publish Docker Image

This remains the primary production release workflow.

#### Triggers

- `release.published`

Manual backfill should be handled by a separate maintenance workflow rather than by adding dispatch-time branching to the main release workflow.

#### Responsibilities

- validate release metadata
- resolve an existing candidate artifact for the release commit
- verify that the candidate artifact matches the tagged source and version metadata
- publish immutable release tags by attaching them to the existing digest
- promote to `stable` or `beta`
- sign and attest the promoted digest
- preserve provenance and SBOM linkage for the promoted digest

#### Jobs

Recommended job structure:

1. `prepare`
2. `resolve-candidate-artifact`
3. `verify-candidate-artifact`
4. `publish-release-tags`
5. `promote-channel-tags`
6. `sign-and-attest`

If manual backfill remains necessary, it should live in a separate maintenance workflow that reuses the same promotion logic without widening the trigger surface of the main release workflow.

#### Design intent

The current workflow likely combines build, publish, and tag selection in one publish step. Under this design, release publication should not build a new image at all. It should resolve an existing candidate digest and then attach release and channel tags to that digest.

#### Required outputs

`prepare` should emit:

- resolved version
- release type: stable or beta
- image name
- checkout ref
- full commit sha
- optional minor-series tag
- optional prerelease-series tag

`resolve-candidate-artifact` should emit:

- candidate manifest-list digest
- candidate source tag, normally `sha-<full-commit-sha>`
- candidate package/version identifier if needed for auditability

`promote-channel-tags` should consume:

- candidate digest
- release classification
- channel tags to attach

### Workflow 2: Preview: Publish Test Docker Image

This is a dedicated preview workflow for `test` publication.

#### Triggers

- `workflow_dispatch`

#### Responsibilities

- resolve source ref or tag
- optionally apply `publish_version_override`
- validate preview image candidate
- build and publish immutable preview artifact
- promote artifact to `test`
- emit digest and source metadata

#### Jobs

Recommended job structure:

1. `prepare`
2. `validate-tests`
3. `validate-image`
4. `build-and-publish-immutable`
5. `promote-test-tag`
6. `sign-preview`

#### Design intent

This workflow should reuse as much shared logic as possible with the release workflow, but must remain a separate workflow file so preview behavior does not complicate stable and beta release logic.

## Workflow 3: Maintenance: Clean Up Test Docker Images

This workflow removes old test-only package versions from GHCR.

#### Triggers

- `workflow_run` after successful preview publication, if reliable in this repository setup
- optional `schedule`
- optional `workflow_dispatch` for manual recovery

#### Responsibilities

- list package versions from GHCR
- inspect tags per package version
- classify protected versus deletable versions
- delete old test-only versions beyond retention threshold
- emit an audit log of deletion actions

### Workflow 4: Maintenance: Backfill Docker Release Tags

This workflow exists only for recovery or catch-up publication of already approved artifacts.

#### Triggers

- `workflow_dispatch`

#### Responsibilities

- accept an explicit release tag or commit input
- resolve an existing candidate artifact via `sha-<full-commit-sha>`
- verify that the candidate artifact matches the requested release metadata
- attach any missing immutable release tags and moving channel tags to the existing digest
- verify the final promoted tags resolve to the expected digest
- sign and attest the promoted digest if required by the release lane

#### Safety rules

- it must not build a new image
- it must not publish from a branch head without an explicit immutable source ref
- it must fail if no existing candidate artifact is found
- it must reuse the same promotion and verification logic as the main release workflow

## Promotion Mechanics

### Principle

Promotion must happen by referencing an existing published digest, not by rebuilding the image.

### Required mechanism

The workflow needs a registry-level tag attachment mechanism for existing digests.

There are two practical families of implementation:

1. Docker Buildx manifest tooling, for example `docker buildx imagetools create`
2. OCI registry copy or retag tooling such as `crane`

The design requirement is outcome-based:

- a previously published digest must receive additional tags
- the digest must not change
- release publication must not create the candidate artifact it promotes

### Candidate artifact discovery

The release workflow should discover the candidate artifact via the immutable `sha-<full-commit-sha>` tag.

That tag is the canonical lookup key for release promotion because it is:

- immutable for a given source commit
- already part of the approved tagging model
- independent from the moving `test` channel tag
- sufficient to locate the candidate digest in GHCR without relying on expiring workflow artifacts

The release workflow must not use `test` itself as the promotion lookup source.

Required lookup flow:

1. resolve the commit behind the GitHub release tag
2. construct the candidate lookup tag `sha-<full-commit-sha>`
3. resolve that tag in GHCR to a manifest-list digest
4. verify that the resolved candidate matches the release commit and version metadata

If `sha-<full-commit-sha>` does not exist or the resolved artifact fails validation, release publication must fail.

The design intentionally uses the full git commit SHA rather than a shortened SHA to avoid ambiguity or future collisions in long-lived repositories.

### Candidate artifact verification

Before promotion, the release workflow should verify all of the following against the candidate artifact:

- OCI revision label matches the expected git commit SHA
- OCI version label matches the release version from `VERSION`
- source repository label matches this repository
- resolved digest is the one that will receive the release and channel tags

If provenance or attestation metadata is available at this stage, the workflow should also verify that the attested subject matches the resolved digest.

### Worked example

Example candidate flow:

1. preview workflow builds from git commit `8f3c2d11b7f1c6d4a99d4a8f3ef2a1e5c7d9ab42`
2. preview workflow publishes:
	- `ghcr.io/<owner>/sambee:sha-8f3c2d11b7f1c6d4a99d4a8f3ef2a1e5c7d9ab42`
	- `ghcr.io/<owner>/sambee:test`
3. both tags resolve to manifest-list digest `sha256:abcd...`
4. maintainer validates that image
5. maintainer creates GitHub Release `v0.8.0` from commit `8f3c2d11b7f1c6d4a99d4a8f3ef2a1e5c7d9ab42`
6. release workflow reads the release commit SHA and constructs:
	- `ghcr.io/<owner>/sambee:sha-8f3c2d11b7f1c6d4a99d4a8f3ef2a1e5c7d9ab42`
7. release workflow resolves that tag to `sha256:abcd...`
8. release workflow verifies OCI labels and any available provenance against the same commit and version
9. release workflow attaches:
	- `ghcr.io/<owner>/sambee:0.8.0`
	- `ghcr.io/<owner>/sambee:0.8`
	- `ghcr.io/<owner>/sambee:stable`
10. release workflow verifies that all of those tags still resolve to `sha256:abcd...`

The important relationship is therefore:

- git commit identifies the source state
- `sha-<full-commit-sha>` identifies the candidate image derived from that source state
- the registry digest identifies the actual immutable artifact that gets promoted

### Recommended implementation approach

Prefer registry-side digest tagging with purpose-built tooling rather than rebuilding through `docker/build-push-action` a second time.

The recommended promotion tool is `crane`.

`crane` is the preferred default because promotion is a registry operation rather than a build operation, and `crane` expresses that intent more directly than build-oriented tooling.

Benefits of `crane` in this design:

- it operates directly against OCI registries
- it keeps promotion logic separate from image-build logic
- it reduces the risk of accidentally rebuilding while promoting
- it is well-suited to digest resolution, tag attachment, and post-promotion verification

The workflow should therefore follow this sequence:

1. resolve the previously published candidate digest
2. attach immutable release tags to that digest
3. attach channel tags to that digest
4. verify the release and channel tags resolve to the same digest

If `crane` proves unreliable in GitHub-hosted runners for a concrete technical reason, the fallback is registry-side manifest tooling such as `docker buildx imagetools`, but the behavioral contract must remain the same.

### Required verification after promotion

After attaching a channel tag, the workflow should verify:

- `stable` resolves to the expected digest for full releases
- `beta` resolves to the expected digest for prereleases
- `test` resolves to the expected digest for preview publishes

If digest verification fails, the workflow should fail.

## Release Classification Logic

The release workflow needs deterministic classification.

### Stable classification

- GitHub Release is not prerelease
- tag format is `vX.Y.Z`
- `VERSION` matches `X.Y.Z`

### Beta classification

- GitHub Release is prerelease
- tag format is `vX.Y.Z-<prerelease>`
- `VERSION` matches `X.Y.Z-<prerelease>`
- prerelease suffix is semver-valid

### Test classification

- manual workflow only
- source ref is explicit
- optional override value is semver-valid if provided

## Version Handling

### Stable and beta

Stable and beta must remain tied to checked-in version metadata.

Required behavior:

- release tags must match `VERSION`
- no ad hoc version synthesis for actual releases

### Test

Test may use either:

- checked-in `VERSION`
- explicit `publish_version_override`

But regardless of version label, traceability must still rely on:

- source ref
- git commit SHA
- published digest

## Resolved Implementation Decisions

### Preview signing

Preview digests should be signed in the same way as stable and beta digests.

Rationale:

- the preview artifact is the candidate that may later become `stable` or `beta`
- signing the preview artifact preserves trust continuity across promotion
- identical signing behavior reduces branching and ambiguity in the workflow design
- verification logic becomes simpler because all promoted artifacts originate from the same signed candidate model

Design consequence:

- `Preview: Publish Test Docker Image` signs the published preview digest
- release promotion reuses the same signed digest rather than introducing a separate signing model for preview artifacts

### Manual backfill support

Manual backfill support should be split into a separate maintenance workflow rather than kept inside the main release workflow.

Rationale:

- the main release workflow should stay narrow and event-driven
- release publication logic is easier to audit when it only handles actual release events
- maintenance and recovery paths should not widen the trigger surface or increase branching in the primary release workflow

Design consequence:

- `Release: Publish Docker Image` remains triggered by `release.published`
- any backfill or recovery flow should call the same promotion logic from a separate maintenance-oriented workflow

### Prerelease series tags

Prerelease series tags such as `X.Y-beta` should be implemented in phase 1.

Rationale:

- they are already part of the chosen beta-channel design language
- adding them later would create avoidable migration and documentation churn
- their implementation is straightforward once digest-based promotion is in place

Design consequence:

- beta promotion attaches `X.Y-beta` in phase 1
- cleanup rules must continue treating prerelease series tags as protected

## Permissions Model

### Release workflow permissions

Required minimum:

- `contents: read`
- `packages: write`
- `id-token: write`

Optional additional permissions only if needed by promotion tooling.

### Test workflow permissions

Required minimum:

- `contents: read`
- `packages: write`
- `id-token: write` if signing preview digests

### Cleanup workflow permissions

Required minimum:

- `packages: write` or delete-capable package permission as required by GHCR API behavior
- `contents: read` only if repository checkout or helper scripts are needed

The cleanup workflow must not require broader permissions than necessary.

## Failure Handling

### Release workflow failures

#### Failure during candidate resolution

Outcome:

- no release or channel tags are attached
- workflow fails normally

Required handling:

- log the expected `sha-<full-commit-sha>` lookup tag
- log that no promotable candidate artifact was found or resolved

#### Failure during candidate verification

Outcome:

- no release or channel tags are attached
- workflow fails loudly because the candidate artifact does not match release metadata expectations

Required handling:

- log the resolved candidate digest
- log which verification check failed, for example revision, version, or source-repository mismatch
- do not continue to promotion

#### Failure after release-tag attachment but before channel promotion

Outcome:

- immutable release tags may exist
- moving channel tag may not exist
- workflow must fail loudly and report promoted partial state

Required handling:

- log the candidate digest
- log which immutable release tags were already attached
- do not silently retry with a rebuild

#### Failure after promotion but before signing

Outcome:

- digest and channel tags may exist
- signing or attestation may be missing

Required handling:

- fail the workflow
- keep enough output for maintainers to identify whether re-signing or re-running the relevant stage is safe

### Test workflow failures

#### Failure during preview publish

Outcome:

- `test` must not move unless immutable publish and promotion both succeed

Required handling:

- do not update `test` early
- fail without mutating the moving preview tag when validation, immutable publish, or signing fails

### Cleanup workflow failures

#### Failure to classify a package version confidently

Required handling:

- keep the package version
- emit a warning
- do not delete on uncertainty

This workflow must fail safe.

## GHCR Cleanup Design

### Classification rules

A package version is protected if any attached tag matches one of these patterns:

- stable semantic version, for example `0.7.0`
- prerelease semantic version, for example `0.8.0-rc.1`
- moving stable tag `stable`
- moving beta tag `beta`
- stable minor-series tag such as `0.7`
- optional prerelease series tag such as `0.8-beta`

A package version is deletable only if all attached tags are preview-only, for example:

- `test`
- `sha-<full-commit-sha>`

### Retention rule

- retain the newest 10 deletable test-only package versions
- delete older deletable test-only package versions

### API strategy

The workflow should:

1. list package versions
2. fetch metadata for each candidate version
3. inspect attached tags
4. classify protected versus deletable
5. sort deletable versions by creation timestamp
6. delete only versions outside the retention window

### Audit requirements

Cleanup logs should record:

- package version ID
- creation time
- attached tags
- classification result
- deletion decision

## Documentation Impact

### Operator docs

Must be updated to show:

- `stable` as the default deployment tag
- `beta` as preview-release tag
- `test` as manual preview tag
- digest pinning for production-sensitive use

### Developer docs

Must be updated to explain:

- stable and beta release publication flow
- manual preview publication flow
- artifact promotion mechanics
- cleanup workflow and retention policy
- absence of `latest`

## Verification Plan

### Scenario 1: Stable release

Verify:

- full release resolves a previously published candidate artifact
- full release publishes immutable release tags by reusing that candidate digest
- `stable` and `X.Y` resolve to the same digest
- signed digest and attestation exist

### Scenario 2: Beta release

Verify:

- prerelease resolves a previously published candidate artifact
- prerelease publishes immutable prerelease tags by reusing that candidate digest
- `beta` resolves to the same digest
- `stable` does not move

### Scenario 3: Test publish

Verify:

- manual preview workflow publishes a preview artifact
- `test` resolves to the expected digest
- `stable` and `beta` do not move

### Scenario 4: Cleanup

Verify:

- protected versions are not deleted
- older test-only versions are deleted beyond retention threshold
- the newest 10 test-only versions remain

## Migration Strategy

Implementation should be staged carefully so the existing release workflow is not destabilized unnecessarily.

Recommended sequence:

1. add or refactor preview publication so it produces the candidate artifact that release promotion will consume
2. refactor the release workflow to resolve an existing candidate artifact instead of building a new one
3. verify stable-release path promotes the existing artifact correctly
4. add beta channel movement to the same workflow
5. add cleanup workflow
6. update docs after behavior is proven

## Definition of Technical Completion

The technical design is fully implemented when:

- release publication resolves and promotes an existing candidate artifact rather than building a new one
- stable and beta tags are attached to an existing digest rather than rebuilt
- preview publication moves `test` only from the dedicated manual workflow
- cleanup prunes old test-only package versions safely
- docs and examples match the actual workflow behavior
- end-to-end verification confirms the digest behind each moving tag is exactly the intended artifact
