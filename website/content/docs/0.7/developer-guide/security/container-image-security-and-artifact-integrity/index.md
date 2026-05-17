+++
title = "Container Image Security and Artifact Integrity"
+++

Container-image security answers a different question than dependency-manifest auditing.

Sambee uses Trivy and release-artifact integrity controls to validate the final published container image, not just the repository dependency files.

## Main Control Points

| File or system | Role |
|---|---|
| `.github/workflows/docker-image-security-scan.yml` | builds the current `main` image and runs the weekly Trivy scan |
| `.github/workflows/docker-image-preview-publish.yml` | runs the preview-candidate Trivy scan before publishing to the `test` channel |
| `.github/workflows/docker-image-publish.yml` | promotes a verified candidate digest onto release tags after checking image metadata and the published metadata bundle |
| `.github/scripts/verify_candidate_metadata_bundle.sh` | verifies that the preview-built SBOM and provenance bundle exists under the expected digest-derived metadata tag |
| `.github/tools/trivy/Dockerfile` | pins the Trivy container image version that both scan workflows use |
| `.trivyignore.yaml` | holds reviewed Trivy suppressions for the image scans |
| `Dockerfile` | defines the runtime artifact that is actually scanned and published |

## Why Trivy Exists Alongside Dependency Audits

Dependency audits help with application dependency drift.

Trivy adds coverage for the built runtime artifact itself, especially:

- vulnerabilities inherited from the pinned base image
- vulnerabilities in OS packages installed during the Docker build
- the final package set that actually ships in the container

That matters for Sambee because the final image includes native tooling and runtime libraries that are outside the normal `pip`, `npm`, and `cargo` manifest audits.

## Trivy Setup

Sambee currently uses Trivy in two places.

Both workflows resolve the Trivy runtime image from `.github/tools/trivy/Dockerfile`, so the pin is reviewed once and Dependabot can update it through the `docker` ecosystem.

Both workflows also force a fresh rebuild of the Dockerfile layer that installs Debian packages.

They do that with a workflow-provided refresh key passed into the image build, so `apt-get update`, `apt-get upgrade`, and package installation rerun against the latest repository state available at build time while the rest of the image can still benefit from BuildKit caching.

### Weekly Image Scan on `main`

`.github/workflows/docker-image-security-scan.yml` builds the current production image from `main` and scans it once per week.

The scan currently:

- builds and scans the supported `linux/amd64` and `linux/arm64` image variants separately
- forces a fresh rebuild of the Debian package-install layer for each workflow run
- uses `.trivyignore.yaml` as the reviewed suppression file
- shows suppressed findings in the output
- checks OS packages and application libraries
- considers only `HIGH` and `CRITICAL` vulnerabilities
- ignores unfixed vulnerabilities
- fails the workflow when matching fixed vulnerabilities remain after suppression

This is the workflow that tells you a shipped runtime stack has picked up a newly disclosed issue even when no new Sambee release is in progress.

### Preview Publish Scan

`.github/workflows/docker-image-preview-publish.yml` runs Trivy against each pushed preview platform image before those platform manifests are assembled into the preview candidate index.

Current preview behavior is intentionally advisory:

- the preview build forces a fresh rebuild of the Debian package-install layer before Trivy runs and before the candidate is published
- Trivy scans the same pushed platform digests that are later assembled into the final preview candidate
- preview publishes still show matching `HIGH` or `CRITICAL` findings
- the findings do not block publication to the `test` channel

That keeps the newest preview candidate available for validation while still surfacing image risk clearly in CI.

## Trivy Ignore Policy

The repository-root `.trivyignore.yaml` file is the shared suppression file for both Trivy workflows.

Keep entries narrow and reviewable.

Each suppression should include:

- the finding ID
- a short statement describing why the risk is accepted temporarily
- an `expired_at` date so the exception must be revisited explicitly

That keeps long-lived silent exceptions from accumulating in the image-security workflows.

## Artifact Integrity

The preview publish and release promotion workflows enable:

- SBOM and provenance bundle publication in a dedicated metadata repository
- Cosign signing of the pushed image digest through GitHub Actions OIDC

Release promotion also verifies that the preview-built metadata bundle matches the candidate digest before channel tags are moved.

Release and backfill workflows mirror the exact metadata bundle files to the GitHub Release as convenience assets. The digest-derived `.meta` artifact in GHCR remains the canonical store.

Cosign signatures are stored in a dedicated GHCR repository instead of the main image repository.

Current split:

- deployable images and multi-arch manifests stay under `ghcr.io/<owner>/sambee`
- SBOM and provenance metadata bundles and Cosign signature artifacts are written under `ghcr.io/<owner>/sambee-signatures`

For Cosign-managed signatures, GHCR can display a digest-derived tagged signature artifact together with an untagged referenced bundle manifest for the same retained image digest.

That keeps the main package page focused on deployable image versions instead of showing non-runnable attestation content there.

Those controls do not replace vulnerability scanning.

They answer a different question: whether a published artifact can be traced and verified after it is built.

## Workflow Pinning Discipline

Security-relevant GitHub Actions in this repository are pinned by commit SHA rather than floating major tags.

That reduces uncontrolled workflow drift in the automation layer itself.

Treat action-version changes in these workflows as reviewed dependency changes, not as incidental cleanup.

## How This Fits with Dependency Security

Use [Dependency Security and Dependabot](../dependency-security-and-dependabot/) for the repository's dependency intake rules, Dependabot grouping, and scheduled dependency vulnerability audits.

