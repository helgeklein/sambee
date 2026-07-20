+++
title = "Product Versioning"
+++

The Sambee product version has one source of truth. Every publishable build uses a plain, immutable `X.Y.Z` version.

## Product Version Source of Truth

The application version lives in:

- `VERSION`

When the product version changes:

1. Update `VERSION`.
1. Run `./scripts/sync-version`.
1. Review all resulting metadata changes together.

The sync step updates version-bearing frontend and Companion files so they do not drift away from the root version.

## Files That Move with Product Version Changes

The sync workflow updates files such as:

- `frontend/package.json`
- `frontend/package-lock.json`
- `companion/package.json`
- `companion/package-lock.json`
- `companion/src-tauri/Cargo.toml`
- `companion/src-tauri/tauri.conf.json`
- `companion/src-tauri/Cargo.lock`

Treat those edits as release metadata, not as noise to separate later.

## Publishable Build Policy

`X.Y.Z` has product meaning as well as ordering meaning:

- `X` is the user-visible normal product release.
- `Y` is a maintenance release within that normal release.
- `Z` is the immutable publishable build sequence within `X.Y`.

Publishable versions contain only non-negative numeric components. Prerelease suffixes and build metadata are not publishable because they do not support a single monotonic update path for Companion users.

When a release workflow starts from `main`, it reserves the annotated Git tag `build-vX.Y.Z` for that exact source commit. Reusing an existing build selects that tag and checks out its immutable commit. Never move or recreate a `build-v...` tag.

## Validation

Run the version sync before validating the affected release surfaces. At minimum, review the generated metadata and run the checks required by the changed subsystem.

Common examples:

```bash
./scripts/sync-version
cd backend && pytest -v
cd backend && mypy app
cd frontend && npx tsc --noEmit && npm run lint
cd companion && npx tsc --noEmit && npm run lint
```

Use [Release Checklist](../release-checklist/) for the complete product-release sequence.

