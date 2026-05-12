+++
title = "Container Image Security and Artifact Integrity"
+++

Container-image security answers a different question than dependency-manifest auditing.

Sambee uses Trivy and release-artifact integrity controls to validate the final published container image, not just the repository dependency files.

## Main Control Points

| File or system | Role |
|---|---|
| `.github/workflows/docker-image-security-scan.yml` | builds the current `main` image and runs the weekly Trivy scan |
| `.github/workflows/docker-image-publish.yml` | runs the release-candidate Trivy gate before publication and signs the pushed image |
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

### Weekly Image Scan on `main`

`.github/workflows/docker-image-security-scan.yml` builds the current production image from `main` and scans it once per week.

The scan currently:

- uses `.trivyignore.yaml` as the reviewed suppression file
- shows suppressed findings in the output
- checks OS packages and application libraries
- considers only `HIGH` and `CRITICAL` vulnerabilities
- ignores unfixed vulnerabilities
- fails the workflow when matching fixed vulnerabilities remain after suppression

This is the workflow that tells you a shipped runtime stack has picked up a newly disclosed issue even when no new Sambee release is in progress.

### Release Publish Gate

`.github/workflows/docker-image-publish.yml` runs the same Trivy threshold against the release-validation image before publication.

Current publish behavior is intentionally split:

- real releases and tag-based publishes fail on matching `HIGH` or `CRITICAL` findings
- override-based test publishes still show the findings, but treat them as advisory warnings instead of blocking publication

That keeps real releases strict while still allowing test publication runs to exercise the workflow.

## Trivy Ignore Policy

The repository-root `.trivyignore.yaml` file is the shared suppression file for both image-scan workflows.

Keep entries narrow and reviewable.

Each suppression should include:

- the finding ID
- a short statement describing why the risk is accepted temporarily
- an `expired_at` date so the exception must be revisited explicitly

That keeps long-lived silent exceptions from accumulating in the image-security workflows.

## Artifact Integrity

The container publish workflow enables:

- SBOM emission
- build provenance attestation
- Cosign signing of the pushed image digest through GitHub Actions OIDC

Those controls do not replace vulnerability scanning.

They answer a different question: whether a published artifact can be traced and verified after it is built.

## Workflow Pinning Discipline

Security-relevant GitHub Actions in this repository are pinned by commit SHA rather than floating major tags.

That reduces uncontrolled workflow drift in the automation layer itself.

Treat action-version changes in these workflows as reviewed dependency changes, not as incidental cleanup.

## How This Fits with Dependency Security

Use [Dependency Security and Dependabot](../dependency-security-and-dependabot/) for the repository's dependency intake rules, Dependabot grouping, and scheduled dependency vulnerability audits.

