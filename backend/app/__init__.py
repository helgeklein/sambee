"""Sambee Backend Application"""

from pathlib import Path

# Read version from centralized VERSION file
_version_file = Path(__file__).parent.parent.parent / "VERSION"
__version__ = _version_file.read_text().strip()
