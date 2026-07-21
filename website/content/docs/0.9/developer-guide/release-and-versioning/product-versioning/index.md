+++
title = "Product Versioning"
+++

## Product Version Source of Truth

The application version lives in:

- `VERSION`

When the product version changes:

1. Update `VERSION`.
1. Run `./scripts/sync-version`.

The sync step updates relevant frontend and Companion files.

### Files That Move with Product Version Changes

The sync workflow updates files such as:

- `frontend/package.json`
- `frontend/package-lock.json`
- `companion/package.json`
- `companion/package-lock.json`
- `companion/src-tauri/Cargo.toml`
- `companion/src-tauri/tauri.conf.json`
- `companion/src-tauri/Cargo.lock`

## Publishable Build Policy

Sambee uses a `X.Y.Z` versionining scheme where the components have the following meanings:

- `X` is the major version number.
- `Y` is the minor version number:
   - `0` for regular releases.
   - `1` ... `n` for maintenance releases.
- `Z` is the immutable publishable build sequence within `X.Y`:
   - Each new `X.Y` branch starts at `Z == 0`.

Publishable versions contain only non-negative numeric components. Prerelease suffixes and build metadata are not publishable because they do not support a single monotonic update path for Companion users.

### Git Build Tags

When a release workflow starts from `main`, it reserves the annotated Git tag `build-vX.Y.Z` for that exact source commit. Reusing an existing build selects that tag and checks out its immutable commit. Never move or recreate a `build-v...` tag.
