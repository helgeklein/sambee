# GHCR SBOM And Provenance Decision Matrix

Purpose: choose how Sambee should publish SBOM and provenance data after confirming that GHCR surfaces inline Buildx attestation manifests as an `unknown` `os/arch` row.

## Current State

- Preview publishing enables inline Buildx provenance and SBOM attestations in the main image package.
- Release promotion verifies that those attestations remain attached before tags are moved.
- GHCR shows the attestation manifest as `os/arch = unknown` on per-version pages.
- Cosign signatures already use a separate GHCR repository and do not create that same main-package visibility problem.

## Decision Options

## Option A: Keep Inline Buildx SBOM And Provenance

What changes:

- no change to attestation storage model
- keep `provenance: true` and `sbom: true` in the preview workflow
- keep current release attestation verification flow

Benefits:

- strongest continuity with the current trust chain
- lowest implementation risk
- no new verification system to design

Costs:

- GHCR continues to show the attestation manifest on per-version pages
- the `unknown` row remains expected UI noise

Assessment:

- best option if security continuity is the priority and the remaining GHCR noise is acceptable

## Option B: Move SBOM And Provenance Out Of Band

What changes:

- disable inline Buildx SBOM and provenance attachment in the main image package
- publish replacement attestations or metadata outside the main package
- redesign release verification to validate the new artifact location and format

Recommended exact placement:

- Canonical machine-readable store: either:
	- the existing dedicated signatures repository, expanded into a shared non-runnable-artifacts store
	- or a separate dedicated metadata repository if stricter separation is desired
- Address metadata by the promoted image digest, not by mutable tags
- Publish one metadata bundle per image digest under a digest-derived tag such as `sha256-<image-digest>.meta`
- Store the bundle contents with a stable internal layout:
	- `metadata.json`
	- `provenance/intoto.jsonl`
	- `sbom/linux-amd64.spdx.json`
	- `sbom/linux-arm64.spdx.json`
- Put the source image digest, version, revision, and source URL into `metadata.json` so release verification can resolve the bundle unambiguously

Recommended repository count:

- Two GHCR repos are sufficient:
	- `ghcr.io/<owner>/sambee` for runnable images only
	- one dedicated non-runnable-artifacts repo for signatures and metadata bundles
- A third GHCR repo is optional, not required

Selected naming if combined:

- Use `ghcr.io/<owner>/sambee-signatures` for the shared signatures and metadata repository
- Reserve distinct tag namespaces so custom metadata does not collide with Cosign-managed tags
- Example split inside one shared repo:
	- Cosign signatures: `sha256-<digest>.sig`
	- Cosign attestations, if ever used there: `sha256-<digest>.att`
	- Custom metadata bundle tags: `sha256-<digest>.meta`

Important constraint:

- If metadata is moved out of band, it should be treated as bundle lookup by digest-derived tag, not as standard image referrers attached to the main image
- OCI referrer discovery is repository-local, so attached referrers in a separate repository would not behave like normal same-repository attached artifacts

Recommended human-facing mirror for releases:

- Attach the same generated files to the GitHub release as assets for the version tag
- Treat release assets as a convenience copy, not the primary verification source

Avoid:

- GitHub Actions workflow artifacts as the canonical store, because they are retention-bound and awkward for long-term promotion verification
- committing generated SBOM or provenance files into the git repository
- storing the bundle in the main `ghcr.io/<owner>/sambee` package, which would reintroduce the same UX problem under a different form

Benefits:

- main package view becomes cleaner
- aligns with the existing pattern used for Cosign signatures

Costs:

- highest implementation complexity
- requires a new verification contract for promotion
- easy to weaken guarantees if the replacement path is underspecified

Assessment:

- best option if main-package cleanliness is a hard requirement and the team is willing to redesign verification carefully

## Option C: Change Attestation Formatting Only

What changes:

- experiment with BuildKit attestation formatting options such as OCI artifact mode
- keep attestations attached to the image package

Benefits:

- may improve interoperability details
- smaller workflow delta than a full out-of-band redesign

Costs:

- not a reliable path to eliminating the GHCR `unknown` row
- still keeps non-runnable attestation content attached to the main image package

Assessment:

- useful only as an experiment; do not treat it as the primary UX fix

## Recommendation

- Decision: choose Option B and use the two-repo layout.
- Keep `ghcr.io/<owner>/sambee` for runnable images only.
- Publish signatures and metadata bundles in one dedicated non-runnable-artifacts repo.
- Use digest-derived metadata tags with an explicit suffix, such as `sha256-<digest>.meta`.
- Design and review the replacement promotion verification path before removing inline attestations from the main image package.
- Do not rely on Option C as the main strategy.

## Decision Gate

- [x] Choose the two-repo layout for runnable images versus non-runnable security metadata
- [x] Use digest-derived metadata bundle tags with an explicit `.meta` suffix
- [x] Design the out-of-band attestation publication and verification model before changing workflows
	See `documentation_planning/GHCR_sbom_provenance_implementation_spec.md`.
- [ ] Do not remove inline attestations until the replacement verification path is specified and reviewable
