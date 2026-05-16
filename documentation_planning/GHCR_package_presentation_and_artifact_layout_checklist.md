# GHCR Package Presentation And Artifact Layout Checklist

Purpose: improve the GHCR package UX without weakening artifact integrity, and leave room for a later user-facing image catalog if GHCR remains too noisy.

## Target State

- [ ] Keep the main `ghcr.io/<owner>/sambee` package focused on deployable multi-arch images
- [ ] Keep Cosign signatures out of the main package
- [ ] Show complete metadata on the tagged GHCR image page
- [ ] Preserve strong verification for release promotion
- [ ] Treat any later custom UI as additive, not a replacement for registry truth

## Phase 1: Fix GHCR Presentation

- [ ] Update `.github/workflows/docker-image-preview-publish.yml` to add OCI annotations for the multi-arch image index and image manifests, not just config labels
- [ ] Ensure the preview image exposes at least title, description, source URL, revision, and version in the form GHCR actually renders
- [ ] Mirror the same metadata behavior in `.github/workflows/docker-image-publish.yml`
- [ ] Confirm the tagged GHCR package page now shows meaningful metadata for the multi-arch image

## Phase 2: Classify Artifacts By Mobility

- [ ] Keep Cosign signatures in the dedicated signature repository
- [ ] Inventory all artifacts currently emitted into `ghcr.io/<owner>/sambee`
- [ ] Mark each artifact as one of:
  - [ ] required deployable image content
  - [ ] movable with low complexity
  - [ ] structurally tied to the multi-arch image layout
- [ ] Explicitly record that multi-arch child manifests are required and should not be treated as cleanup candidates

## Phase 3: Decide SBOM And Provenance Strategy

- [ ] Compare current Buildx inline SBOM/provenance publication against an out-of-band publication model
- [ ] Evaluate each option for:
  - [ ] GHCR UX improvement
  - [ ] verification strength
  - [ ] operational complexity
  - [ ] compatibility with existing promotion flow
- [ ] Choose one path:
  - [ ] keep inline SBOM/provenance and accept residual GHCR clutter
  - [ ] move SBOM/provenance out of band and disable inline attachment
- [ ] Record the decision before changing release verification

## Phase 4: Update Verification

- [ ] Extend `.github/scripts/verify_candidate_image.sh` so it validates the metadata users are expected to see in GHCR, not only current config labels
- [ ] If SBOM/provenance move out of band, update the release verification flow to verify the new location and format
- [ ] Re-check `.github/workflows/docker-image-publish.yml` to ensure promotion still verifies the intended trust chain

## Phase 5: Update Documentation

- [ ] Update `website/content/docs/0.7/developer-guide/security/container-image-security-and-artifact-integrity/index.md` to match the final publication model
- [ ] Document where images, signatures, SBOMs, and provenance are published
- [ ] Document the UX policy clearly: main package optimized for deployable images, security artifacts placed where appropriate

## Phase 6: Reassess Need For A Custom UI

- [ ] Review the GHCR result after phases 1 through 5
- [ ] Decide whether the remaining GHCR package view is acceptable
- [ ] Only if needed, scope a separate user-facing image catalog that presents deployable images more clearly
- [ ] Keep GHCR as the canonical registry source even if a custom UI is later introduced

## Done Criteria

- [ ] The tagged GHCR image shows complete metadata
- [ ] Only artifacts that must remain in the main package remain there
- [ ] Release verification still proves what was built and promoted
- [ ] The docs accurately describe the final artifact layout
- [ ] Any remaining GHCR clutter is understood and intentionally accepted
