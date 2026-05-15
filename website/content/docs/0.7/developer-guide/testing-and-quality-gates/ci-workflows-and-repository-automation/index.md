+++
title = "CI Workflows and Repository Automation"
+++

Use this page to understand the GitHub Actions workflows contributors hit most often and to keep the workflow list grouped predictably in the GitHub UI.

## Naming Convention

GitHub lists workflows by the top-level `name` field.

Sambee groups workflow display names by operational purpose using `Area: Subject`.

Current workflow groups are:

- `CI`.
- `Release`.
- `Deploy`.
- `Security`.
- `Admin`.

Keep new names short, stable, and grouped by what the workflow does rather than by how it is triggered.

## Workflow Map

| Display name | File | Role |
|---|---|---|
| `CI: Test` | `.github/workflows/test.yml` | Runs the main backend, frontend, and companion validation suites. |
| `CI: Lint` | `.github/workflows/lint.yml` | Runs repository lint and formatting checks across backend, frontend, and companion. |
| `CI: Check Backend Lockfiles` | `.github/workflows/check-backend-lockfiles.yml` | Verifies that committed backend lockfiles still match the reviewed requirement sources. |
| `CI: Validate Docker Image` | `.github/workflows/docker-image-validate.yml` | Builds and smoke-tests the production container image on pull requests, pushes, and manual runs. |
| `Release: Publish Docker Image` | `.github/workflows/docker-image-publish.yml` | Promotes an existing preview candidate onto release tags and the `stable` or `beta` channel, then signs the digest. |
| `Preview: Publish Test Docker Image` | `.github/workflows/docker-image-preview-publish.yml` | Builds, validates, publishes, and signs a new preview image, then moves the `test` channel tag. |
| `Maintenance: Backfill Docker Release Tags` | `.github/workflows/docker-image-backfill.yml` | Reattaches release tags and release-channel aliases to an already published candidate digest for an existing release. |
| `Maintenance: Clean Up Test Docker Images` | `.github/workflows/docker-image-cleanup-test.yml` | Removes older test-only GHCR package versions while preserving release-tagged and channel-protected versions. |
| `Release: Build Companion Artifact` | `.github/workflows/build-companion.yml` | Builds companion release artifacts for the public distribution repository. |
| `Release: Promote Companion Release` | `.github/workflows/promote-companion-release.yml` | Moves an existing companion release onto one or more update channels. |
| `Deploy: Website` | `.github/workflows/website-deploy.yml` | Builds the website and deploys `website/public/` to Cloudflare Pages. |
| `Security: Dependency Audit` | `.github/workflows/dependency-security.yml` | Runs scheduled and manual dependency vulnerability audits. |
| `Security: Docker Image Scan` | `.github/workflows/docker-image-security-scan.yml` | Builds the current main image and scans it for newly disclosed vulnerabilities. |
| `Admin: Sync Labels` | `.github/workflows/sync-labels.yml` | Synchronizes repository labels from `.github/labels.yml` without deleting unmanaged labels. |

GitHub also shows repository-level features such as `Dependabot updates` and `Dependency graph`.

Those are not repository workflows, so their display names are not controlled by these YAML files.

## CI: Test

`CI: Test` is the main validation workflow for pushes to `main`, pull requests against `main`, and manual dispatch.

It first detects which top-level product areas changed, then fans out only the relevant jobs for:

- backend
- frontend
- companion

Manual dispatch runs all three areas.

The workflow ends with a single gate job so branch protection can depend on one stable required check instead of a changing set of per-area jobs.

### Caching Model

The test workflow uses layered caching to reduce repeated setup work while keeping dependency inputs explicit.

Current cache layers include:

- `backend/.venv` caching keyed by the resolved backend requirement files and Python version.
- `backend/.mypy_cache` caching keyed by backend Python source changes.
- `actions/setup-node` npm download caching for frontend and companion jobs.
- `frontend/node_modules` caching keyed by `frontend/package-lock.json`.
- Rust build caching for `companion/src-tauri`.

Treat those cache keys as reviewed dependency inputs, not as disposable generated noise.

When dependency manifests or lockfiles change, commit the corresponding lockfile updates in the same pull request so cache invalidation and dependency review stay aligned.

### Local Parity

For fast local iteration, use `./scripts/test`.

When you want a closer CI-style pass, run the per-subsystem checks from [Test Strategy Overview](../test-strategy-overview/) and keep lockfile-driven installs intact.

## CI: Lint

`CI: Lint` applies the same change-detection pattern, then runs the repository's static checks for only the affected areas.

Current coverage includes:

- backend Ruff checks and formatting validation.
- frontend Biome validation.
- companion Clippy, Rustfmt, and Biome validation.

The workflow also ends with one gate job so branch protection can depend on a stable result.

## Runner Distro Policy

Sambee does not require every GitHub Actions job to run on the same base distro.

Instead, the rule is:

- jobs that validate production-like runtime behavior or install native runtime dependencies should follow the same Debian family used by the production image and the dev container
- jobs that only run language-level checks, dependency audits, repository automation, or other host-agnostic validation can stay on `ubuntu-latest`

Current Debian-family jobs include:

- the backend job in `CI: Test`
- the `validate-tests` job in `Preview: Publish Test Docker Image`

Those jobs run inside the pinned `python:3.13.12-slim` container because `scripts/install-system-deps` now requires distro-provided ImageMagick 7, while the default Ubuntu GitHub-hosted runner image still resolves `imagemagick` to ImageMagick 6.

Current jobs that intentionally remain on `ubuntu-latest` include:

- change-detection, label-sync, and website deployment workflows
- pure Python lint, lockfile freshness, and dependency-audit workflows
- frontend-only and companion-only validation workflows
- Docker build, smoke-test, and vulnerability-scan workflows, where the distro-sensitive logic runs inside the built image rather than on the host runner

When adding or changing a workflow, treat runner distro as part of the test contract whenever a job installs OS packages or validates native behavior.

## CI: Check Backend Lockfiles

`CI: Check Backend Lockfiles` protects the reviewed Python dependency workflow.

It runs `scripts/refresh-backend-lockfiles --check` on pushes, pull requests, and manual runs that touch backend requirement inputs, generated lockfiles, or the refresh script itself.

Use this as the fast failure signal when requirement files and generated lockfiles drift apart.

For the broader dependency-update workflow, use [Dependency and Release Workflow](../release-and-versioning/dependency-and-release-workflow/).

## Admin: Sync Labels

`Admin: Sync Labels` keeps repository labels aligned with `.github/labels.yml`.

It is intentionally conservative.

- Dependabot-related labels should stay declared in `.github/labels.yml`.
- The workflow uses `skip-delete: true`, so labels not declared there are left alone.

That keeps automation-owned labels deterministic without forcing the repository to delete every manually created label.

## Related Workflow Docs

Use the more specific pages for the workflows that have dedicated operational guidance:

- [Dependency Security and Dependabot](../../security/dependency-security-and-dependabot/)
- [Container Image Build and Publish Workflow](../../release-and-versioning/container-image-build-and-publish-workflow/)
- [Companion Distribution and Update Workflow](../../release-and-versioning/companion-distribution-and-update-workflow/)
- [Set Up Cloudflare Pages Publishing](../../../website-dev-guide/setup-and-operations/set-up-cloudflare-pages-publishing/)

