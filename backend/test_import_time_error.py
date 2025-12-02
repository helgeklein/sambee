#!/usr/bin/env python3
"""
Test to verify that module import-time ConfigurationError is caught cleanly.

This simulates the Docker deployment scenario where config.toml is a directory.
"""

import shutil
import subprocess
import sys
from pathlib import Path

# Test directory
TEST_DIR = Path(__file__).parent / "test_config_error"


def cleanup():
    """Remove test directory if it exists."""
    if TEST_DIR.exists():
        shutil.rmtree(TEST_DIR)


def test_clean_config_error():
    """Test that ConfigurationError at import time shows clean error."""

    print("\n" + "=" * 80)
    print("TEST: Clean ConfigurationError at Module Import Time")
    print("=" * 80)
    print("\nThis test simulates the Docker scenario where config.toml is a directory.")
    print()

    # Clean up any previous test
    cleanup()

    # Create test directory structure
    TEST_DIR.mkdir(exist_ok=True)
    app_dir = TEST_DIR / "app"
    app_dir.mkdir(exist_ok=True)
    core_dir = app_dir / "core"
    core_dir.mkdir(exist_ok=True)

    # Copy necessary files
    backend_dir = Path(__file__).parent
    shutil.copy(backend_dir / "app" / "core" / "exceptions.py", core_dir / "exceptions.py")
    shutil.copy(backend_dir / "app" / "core" / "config.py", core_dir / "config.py")

    # Create __init__.py files
    (app_dir / "__init__.py").write_text("")
    (core_dir / "__init__.py").write_text("")

    # Create config.toml as a DIRECTORY (simulating Docker mount issue)
    config_dir = TEST_DIR / "config.toml"
    config_dir.mkdir(exist_ok=True)

    print(f"Created test structure at: {TEST_DIR}")
    print(f"config.toml is a directory: {config_dir.is_dir()}")
    print()

    # Try to import config (should fail cleanly)
    print("Attempting to import config module with config.toml as a directory...")
    print("-" * 80)

    result = subprocess.run(
        [sys.executable, "-c", "from app.core.config import settings"],
        cwd=TEST_DIR,
        capture_output=True,
        text=True,
    )

    print("STDERR output:")
    print(result.stderr)
    print("-" * 80)
    print()

    # Verify clean error message
    has_error_message = "Configuration Error:" in result.stderr
    has_directory_message = "is a directory" in result.stderr
    has_no_traceback = "Traceback" not in result.stderr
    exited_with_error = result.returncode == 1

    print("Verification:")
    print(f"  ✓ Has clean error message: {has_error_message}")
    print(f"  ✓ Mentions directory issue: {has_directory_message}")
    print(f"  ✓ No 'Traceback' in output: {has_no_traceback}")
    print(f"  ✓ Exited with error code 1: {exited_with_error}")
    print()

    # Clean up
    cleanup()

    if all([has_error_message, has_directory_message, has_no_traceback, exited_with_error]):
        print("✅ TEST PASSED: ConfigurationError is caught cleanly at import time!")
        print("   No stack traces, just a clear user-friendly message.")
        return True
    else:
        print("❌ TEST FAILED: Stack trace or unclear error message detected.")
        return False


if __name__ == "__main__":
    try:
        success = test_clean_config_error()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Test script error: {e}")
        cleanup()
        sys.exit(1)
