"""Tests for backend log level validation and usage."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings


#
# test_valid_log_levels
#
def test_valid_log_levels():
    """Test that valid log levels are accepted and normalized to uppercase."""

    valid_levels = [
        ("debug", "DEBUG"),
        ("DEBUG", "DEBUG"),
        ("info", "INFO"),
        ("INFO", "INFO"),
        ("warning", "WARNING"),
        ("WARNING", "WARNING"),
        ("error", "ERROR"),
        ("ERROR", "ERROR"),
        ("DeBuG", "DEBUG"),  # Mixed case
    ]

    for input_level, expected_output in valid_levels:
        settings = Settings(log_level=input_level)
        assert settings.log_level == expected_output


#
# test_invalid_log_levels
#
def test_invalid_log_levels():
    """Test that invalid log levels raise clear validation errors."""

    invalid_levels = [
        "INVALID",
        "trace",
        "warn",  # Frontend uses "warn", backend uses "WARNING"
        "fatal",
        "off",
        "",
        "123",
    ]

    for invalid_level in invalid_levels:
        with pytest.raises(ValidationError) as exc_info:
            Settings(log_level=invalid_level)

        # Verify error message is clear
        error = exc_info.value.errors()[0]
        assert error["loc"] == ("log_level",)
        assert "Invalid log level" in error["msg"]
        assert invalid_level in str(error["input"])
        assert "Must be one of:" in error["msg"]


#
# test_default_log_level
#
def test_default_log_level():
    """Test that default log level is INFO."""

    settings = Settings()
    assert settings.log_level == "INFO"


#
# test_log_level_case_insensitive
#
def test_log_level_case_insensitive():
    """Test that log level validation is case-insensitive."""

    # All these should work
    test_cases = ["debug", "Debug", "DEBUG", "dEbUg"]

    for test_case in test_cases:
        settings = Settings(log_level=test_case)
        assert settings.log_level == "DEBUG"
