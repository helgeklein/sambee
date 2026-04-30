+++
title = "Dependency And Release Workflow"
description = "Treat version metadata, dependency lockfiles, and docs-version declarations as reviewed source instead of incidental setup artifacts."
+++

Versioning in Sambee is deliberate. Several files across backend, frontend, companion, and website have to stay aligned, and the repository already has workflows to enforce that alignment.

## Product Version Source Of Truth

The application version lives in one place:

- `VERSION`

When the product version changes:

1. update `VERSION`
2. run `./scripts/sync-version`
3. review all resulting metadata changes together

The sync step updates version-bearing frontend and companion files so they do not drift away from the root version.

## Files That Move With Product Version Changes

The sync workflow updates files such as:

- `frontend/package.json`
- `frontend/package-lock.json`
- `companion/package.json`
- `companion/package-lock.json`
- `companion/src-tauri/Cargo.toml`
- `companion/src-tauri/tauri.conf.json`
- `companion/src-tauri/Cargo.lock`

Treat those edits as release metadata, not as noise to separate later.

## Dependency Update Rules

Routine install behavior and actual dependency changes are different workflows.

- use `npm ci` for routine installs in `frontend/`, `companion/`, and `website/`
- use the hashed backend lockfiles for routine Python installs
- do not hand-edit generated lockfile details when the repository already provides a regeneration workflow

### Backend Dependency Updates

For backend dependency changes:

- update the reviewed top-level requirement files first
- regenerate backend lockfiles with the supported refresh script
- validate with backend tests and type checking

That keeps direct requirements, transitive dependencies, and hashes aligned.

### High-Risk Dependency Areas

Some ecosystems are intentionally treated as coordinated manual changes rather than casual bumps.

- Python runtime version
- high-risk frontend packages such as React, Vite, TypeScript, and MUI
- companion Tauri package and crate alignment
- backend packages with higher behavioral risk such as `smbprotocol` and `pyvips`

## Docs Version Metadata

The public docs version system has its own source of truth.

- `website/data/docs-versions.toml` declares the available docs versions and their canonical order
- `website/data/docs-nav/<version>.toml` declares sidebar order within a version
- `website/content/docs/<version>/...` contains the actual versioned content

If you change docs-version metadata, you are changing public docs behavior, not just internal bookkeeping.

## Release-Sensitive Change Checklist

Use extra care when a change touches any of these:

- `VERSION`
- dependency lockfiles or requirement inputs
- package metadata in frontend or companion projects
- docs version declarations and version navigation files
- build scripts that generate version-bearing or release-facing outputs

## Validation Expectations

At minimum, run the checks for the subsystem whose release-sensitive files changed.

Common examples:

```bash
./scripts/sync-version
cd backend && pytest -v
cd backend && mypy app
cd frontend && npx tsc --noEmit && npm run lint
cd companion && npx tsc --noEmit && npm run lint
cd website && npm run build
```

Choose the relevant subset based on what changed, but do not skip version-sync validation when `VERSION` moves.

## Related Pages

- [How To Plan And Review A Change](../../contribution-workflows/how-to-plan-and-review-a-change/): scope the change and review the release-sensitive diff intentionally
- [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/): choose the right checks for the specific subsystem and risk surface
- [Companion Distribution And Update Workflow](../companion-distribution-and-update-workflow/): follow the dedicated Companion release-publishing and promotion flow
