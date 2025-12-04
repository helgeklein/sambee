"""Sambee Backend Application"""

import sys
from pathlib import Path

# Read version from centralized VERSION file
_version_file = Path(__file__).parent.parent.parent / "VERSION"
try:
    __version__ = _version_file.read_text().strip()
except FileNotFoundError:
    from app.core.logging import setup_early_error_logging

    logger = setup_early_error_logging()
    logger.error(f"VERSION file not found: {_version_file}")
    sys.exit(1)
except (PermissionError, OSError) as e:
    from app.core.logging import setup_early_error_logging

    logger = setup_early_error_logging()
    logger.error(f"Cannot read VERSION file: {e}")
    logger.error("Check file permissions and try again.")
    sys.exit(1)
