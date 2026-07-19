+++
title = "Dependency Update Workflow"
+++

Use this page for routine dependency updates and dependency-related release preparation. Use [Product Versioning](../product-versioning/) when changing the Sambee version, and [Release Checklist](../release-checklist/) when preparing a complete product release.

## Dependency Update Rules

Routine install behavior and actual dependency changes are different workflows.

- use `npm ci` for routine installs in `frontend/` and `companion/`
- use the hashed backend lockfiles for routine Python installs
- do not hand-edit generated lockfile details when the repository already provides a regeneration workflow

### Backend Dependency Updates

For backend dependency changes:

- update the reviewed top-level requirement files first
- regenerate backend lockfiles with the supported refresh script
- use `scripts/refresh-backend-lockfiles --check` for a read-only freshness check when needed
- validate with backend tests and type checking

That keeps direct requirements, transitive dependencies, and hashes aligned.

More specifically:

- change `requirements.txt` and `requirements-dev.txt`, not only the generated lockfiles
- regenerate `requirements.lock.txt` and `requirements-dev.lock.txt` through `scripts/refresh-backend-lockfiles`
- treat resolver conflicts as real compatibility constraints instead of forcing transitive pins by hand
- avoid hand-editing lockfile hashes except as a last resort

For an already-open backend dependency-update PR:

- review the direct requirement changes first
- run `scripts/refresh-backend-lockfiles --check` if you want a quick stale-lockfile check before editing
- regenerate the lockfiles from the reviewed sources
- validate with at least `pytest -v` and `mypy app`
- commit regenerated lockfiles back to the update branch instead of patching transitive entries manually

### High-Risk Dependency Areas

Some ecosystems are intentionally treated as coordinated manual changes rather than casual bumps.

- Python runtime version
- high-risk frontend packages such as React, Vite, TypeScript, and MUI
- companion Tauri package and crate alignment
- backend packages with higher behavioral risk such as `smbprotocol` and `pyvips`

Additional contributor rules in those areas:

- keep companion Tauri JavaScript packages and Rust crates on matching major.minor versions
- validate companion Tauri alignment with `scripts/check_tauri_version_alignment.py` when those dependencies move
- treat Python runtime upgrades as coordinated manual changes across production Docker, the devcontainer, and CI
- prefer committed scripts and lockfiles over one-off installers or floating `npx` downloads

## Dependency Security Audits

The audit workflow and Dependabot configuration now live in the Developer Guide security section.

Use [Dependency Security and Dependabot](../../security/dependency-security-and-dependabot/) for:

- Dependabot grouping and ignore rules
- scheduled dependency audit coverage

Use [Container Image Security and Artifact Integrity](../../security/container-image-security-and-artifact-integrity/) for:

- container-image vulnerability scanning
- Trivy suppression policy
- image signing, SBOM, and provenance controls

Keep this page focused on dependency inputs, generated lockfiles, and dependency-specific validation.

## Validation Expectations

At minimum, run the checks for the subsystem whose release-sensitive files changed.

Common examples:

```bash
cd backend && pytest -v
cd backend && mypy app
cd frontend && npx tsc --noEmit && npm run lint
cd companion && npx tsc --noEmit && npm run lint
```

Choose the relevant subset based on the dependencies that changed.
