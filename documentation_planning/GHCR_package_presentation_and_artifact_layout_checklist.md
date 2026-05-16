# GHCR Package Presentation And Artifact Layout Checklist

Purpose: improve the GHCR package UX without weakening artifact integrity, and leave room for a later user-facing image catalog if GHCR remains too noisy.

## Target State

- [ ] Keep the main `ghcr.io/<owner>/sambee` package focused on deployable multi-arch images
- [ ] Keep Cosign signatures out of the main package
- [ ] Show complete metadata on the tagged GHCR image page
- [ ] Preserve strong verification for release promotion
- [ ] Treat any later custom UI as additive, not a replacement for registry truth

## Phase 1: Fix GHCR Presentation

- [x] Update `.github/workflows/docker-image-preview-publish.yml` to add OCI annotations for the multi-arch image index and image manifests, not just config labels
- [x] Ensure the preview image exposes at least title, description, source URL, revision, and version in the form GHCR actually renders
- [ ] Mirror the same metadata behavior in `.github/workflows/docker-image-publish.yml`
- [ ] Confirm the tagged GHCR package page now shows meaningful metadata for the multi-arch image

## Phase 2: Classify Artifacts By Mobility

- [x] Keep Cosign signatures in the dedicated signature repository
- [x] Inventory all artifacts currently emitted into `ghcr.io/<owner>/sambee`
- [x] Mark each artifact as one of:
  - [x] required deployable image content
  - [x] movable with low complexity
  - [x] structurally tied to the multi-arch image layout
- [x] Explicitly record that multi-arch child manifests are required and should not be treated as cleanup candidates

Current inventory and classification:

- [x] Multi-arch image index for the tagged image: required deployable image content
- [x] Runnable platform manifest for `linux/amd64`: required deployable image content
- [x] Runnable platform manifest for `linux/arm64`: required deployable image content
- [x] Buildx attestation manifest(s) attached to the image index: structurally tied to the current inline SBOM and provenance publication model
- [x] GHCR `os/arch = unknown` row on the per-version page: expected rendering of the attached Buildx attestation manifest, not a broken runnable image entry
- [x] Cosign signatures in `ghcr.io/<owner>/sambee-signatures`: movable with low complexity and already moved out of the main package

Decision baseline for the next phase:

- [x] Do not try to remove or clean up the `linux/amd64` and `linux/arm64` manifests; they are required for the multi-arch image to function
- [x] Do not treat the `unknown` GHCR row as a metadata bug; it is a visibility side effect of inline Buildx attestations
- [x] Treat Cosign signature storage as the already-successful pattern for artifacts that can live outside the main package
- [x] Use Phase 3 to decide whether SBOM and provenance should stay inline or move out of band

## Phase 3: Decide SBOM And Provenance Strategy

- [x] Capture the decision inputs in `documentation_planning/GHCR_sbom_provenance_decision_matrix.md`
- [x] Compare current Buildx inline SBOM/provenance publication against an out-of-band publication model
- [x] Evaluate each option for:
  - [x] GHCR UX improvement
  - [x] verification strength
  - [x] operational complexity
  - [x] compatibility with existing promotion flow
- [x] Choose one path:
  - [ ] keep inline SBOM/provenance and accept residual GHCR clutter
  - [x] move SBOM/provenance out of band and disable inline attachment
- [x] Record the decision before changing release verification
- [x] Write a concrete implementation spec in `documentation_planning/GHCR_sbom_provenance_implementation_spec.md`

## Phase 4: Update Verification

- [x] Extend `.github/scripts/verify_candidate_image.sh` so it validates the metadata users are expected to see in GHCR, not only current config labels
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
