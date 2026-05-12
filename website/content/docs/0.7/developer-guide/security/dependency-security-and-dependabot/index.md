+++
title = "Dependency Security and Dependabot"
+++

Sambee treats dependency intake and dependency vulnerability audits as separate workflows.

Dependabot helps bring reviewed update proposals into the repository.

The dependency audit workflow checks the current manifests and lockfiles for known published vulnerabilities.

In GitHub Actions, the repository-defined audit workflow appears as `Security: Dependency Audit`.

Dependabot activity still appears under GitHub-managed `Dependabot updates`, which is not renamed from this repository.

## Main Control Points

| File or system | Role |
|---|---|
| `.github/dependabot.yml` | schedules and groups automated dependency update pull requests |
| `.github/workflows/dependency-security.yml` | runs scheduled and manual dependency vulnerability audits |
| local dev container setup | installs the same core audit tools used in CI for local verification |

## Dependabot Setup

Dependabot is configured in `.github/dependabot.yml`.

Current coverage includes:

- GitHub Actions dependencies.
- Backend Python dependencies under `backend/`.
- Frontend npm dependencies under `frontend/`.
- Companion npm dependencies under `companion/`.
- Companion Rust dependencies under `companion/src-tauri/`.
- Docker image dependencies from the repository root.

The configuration is intentionally grouped and filtered instead of allowing every update to arrive as an isolated pull request.

Examples:

- Backend Python updates split higher-risk areas such as `smbprotocol` and `pyvips` away from routine development-tool bumps.
- Frontend major upgrades for React, MUI, Vite, TypeScript, routing, localization, and related runtime-critical packages stay manual.
- Companion Tauri JavaScript and Rust updates are coordinated through a multi-ecosystem group.
- Root Docker dependency updates are allowed, but Node and Python base-image version changes stay manual so they can be coordinated across Docker, CI, local development, and docs.

That split keeps routine maintenance moving while preserving deliberate review for dependency changes that can affect runtime compatibility, release behavior, or user workflows.

## Dependency Vulnerability Audits

The dependency audit workflow lives in `.github/workflows/dependency-security.yml`.

GitHub Actions displays that workflow as `Security: Dependency Audit`.

It runs weekly and on manual dispatch.

Current checks are:

- backend: `pip-audit -r backend/requirements-dev.lock.txt`
- frontend: `npm audit --package-lock-only --omit=dev --audit-level=high`
- companion npm: `npm audit --package-lock-only --omit=dev --audit-level=high`
- companion Rust: `cargo audit`

Use this workflow to catch known issues in the dependency manifests and lockfiles that the repository owns directly.

Inside the dev container, `pip-audit` and `cargo-audit` are installed during setup with the same pinned versions used in CI, so local verification can match the workflow behavior closely.

## How This Fits with Release Work

These checks support release safety, but they are not the same as release publication controls.

Use [Container Image Security and Artifact Integrity](../container-image-security-and-artifact-integrity/) for the Trivy image scans, `.trivyignore.yaml` policy, SBOM emission, provenance, and image signing workflow.

