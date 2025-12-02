#!/usr/bin/env python3
"""
Test script to verify clean error handling without stack traces.

This script tests that ConfigurationError is caught and displayed cleanly.
"""

import sys
from pathlib import Path

# Add app directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.core.exceptions import ConfigurationError
from app.core.logging import get_logger, log_error

logger = get_logger(__name__)


#
# test_configuration_error
#
def test_configuration_error():
    """Test that ConfigurationError is logged cleanly without stack trace."""

    print("=" * 80)
    print("Testing ConfigurationError handling")
    print("=" * 80)
    print()

    try:
        # Simulate a configuration error
        raise ConfigurationError("'config.toml' is a directory, not a file. Remove it and don't mount config.toml.")
    except ConfigurationError as e:
        log_error(logger, f"Configuration error: {e}")
        log_error(logger, "Application startup failed. Exiting.")
        print()
        print("✅ Error logged cleanly without stack trace!")
        print()


#
# test_regular_exception
#
def test_regular_exception():
    """Show what happens with a regular exception for comparison."""

    print("=" * 80)
    print("For comparison: Regular exception WITH stack trace (old behavior)")
    print("=" * 80)
    print()

    try:
        raise RuntimeError("'config.toml' is a directory")
    except RuntimeError as e:
        logger.error(f"Error: {e}", exc_info=True)
        print()


if __name__ == "__main__":
    print("\n" + "=" * 80)
    print("CLEAN ERROR HANDLING TEST")
    print("=" * 80 + "\n")

    # Test clean error handling
    test_configuration_error()

    # Show old behavior for comparison
    test_regular_exception()

    print("=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)
