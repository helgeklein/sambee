# Version Management

## Single Source of Truth

The application version is stored in a **single location**: `/workspace/VERSION`

This file contains just the version number (e.g., `0.1.0`) and is used by:
- **Backend**: Read at import time by `app/__init__.py`
- **Frontend**: Synced to `package.json` by the `scripts/sync-version` script

## Updating the Version

To update the application version:

1. Edit `/workspace/VERSION` and change the version number
2. Run the sync script: `./scripts/sync-version`
3. Commit both `VERSION` and `frontend/package.json`

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

**Frontend** (`scripts/sync-version`):
- Reads `VERSION` file
- Updates `package.json` with `jq` (or `sed` as fallback)
- Run this script before npm install/build

**CI/CD**: Remember to run `./scripts/sync-version` in your build pipeline before building the frontend.
