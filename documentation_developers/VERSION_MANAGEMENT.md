# Version Management

## Single Source of Truth

The application version is stored in a **single location**: `/workspace/VERSION`

This file contains just the version number (e.g., `0.1.0`) and is used by:
- **Backend**: Read at import time by `app/__init__.py`
- **Frontend**: Synced to package metadata by the `scripts/sync-version` script
- **Companion**: Synced to npm/Tauri/Rust package metadata by the `scripts/sync-version` script

## Updating the Version

To update the application version:

1. Edit `/workspace/VERSION` and change the version number
2. Run the sync script: `./scripts/sync-version`
3. Review and commit all files changed by the sync script together

The sync script automatically runs during:
- Dev container post-create setup
- Can be run manually anytime with `./scripts/sync-version`

## Implementation Details

**Backend** (`app/__init__.py`):
```python
from pathlib import Path

_version_file = Path(__file__).parent.parent.parent / "VERSION"
__version__ = _version_file.read_text().strip()
```

**Frontend + Companion** (`scripts/sync-version`):
- Reads `VERSION` file
- Updates these files:
	- `frontend/package.json`
	- `frontend/package-lock.json` (if present)
	- `companion/package.json`
	- `companion/package-lock.json` (if present)
	- `companion/src-tauri/Cargo.toml` (the `[package]` version only)
	- `companion/src-tauri/tauri.conf.json`
	- `companion/src-tauri/Cargo.lock` (the `sambee-companion` package version)
- Run this script before `npm ci`, builds, or release packaging after `VERSION` changes
- Treat the generated lockfile changes as release metadata that must be reviewed with the `VERSION` change, not edited by hand later

**CI/CD**:
- GitHub Actions now runs `./scripts/sync-version` before frontend and companion lint/test/build jobs.
- That enforcement is centralized in the composite action `.github/actions/sync-version-check`.
- CI fails if the sync step produces uncommitted changes, which prevents `VERSION` drift and unsynced package metadata from slipping through.
