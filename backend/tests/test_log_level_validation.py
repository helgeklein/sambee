"""Tests for backend log level validation and usage."""

import io
import logging

import pytest
from pydantic import ValidationError

from app.core.config import Settings, load_toml_config
from app.core.logging import UvicornAccessLogFilter, UvicornProtocolLogFilter, configure_uvicorn_loggers


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
        settings = Settings(access_log_level=input_level)
        assert settings.access_log_level == expected_output
        settings = Settings(protocol_log_level=input_level)
        assert settings.protocol_log_level == expected_output


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
            Settings(protocol_log_level=invalid_level)

        # Verify error message is clear
        error = exc_info.value.errors()[0]
        assert error["loc"] == ("protocol_log_level",)
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
    assert settings.access_log_level == "WARNING"
    assert settings.protocol_log_level == "WARNING"


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


def test_access_log_level_loads_from_app_config(tmp_path):
    """Load the Uvicorn access/protocol log level from the app TOML section."""

    config_file = tmp_path / "config.toml"
    config_file.write_text('[app]\naccess_log_level = "info"\nprotocol_log_level = "debug"\n')

    settings = Settings(**load_toml_config(config_file))

    assert settings.access_log_level == "INFO"
    assert settings.protocol_log_level == "DEBUG"


def test_configure_uvicorn_loggers_separates_access_from_lifecycle_logs():
    """Keep Uvicorn lifecycle logs at the app level while quieting access records."""

    logger_names = ("uvicorn", "uvicorn.access", "uvicorn.error")
    output = io.StringIO()
    previous_states = {
        name: (logging.getLogger(name).level, list(logging.getLogger(name).handlers), logging.getLogger(name).propagate)
        for name in logger_names
    }
    try:
        configure_uvicorn_loggers(
            handlers=[logging.StreamHandler(output)],
            log_format="%(name)s - %(levelname)s - %(message)s",
            application_log_level=logging.INFO,
            access_log_level=logging.WARNING,
            protocol_log_level=logging.WARNING,
        )

        assert logging.getLogger("uvicorn.access").level == logging.WARNING
        assert logging.getLogger("uvicorn.error").level == logging.INFO
        assert logging.getLogger("uvicorn").level == logging.INFO

        uvicorn_error_logger = logging.getLogger("uvicorn.error")
        uvicorn_error_logger.info("connection open")
        uvicorn_error_logger.info("Application startup complete.")

        assert "connection open" not in output.getvalue()
        assert "Application startup complete." in output.getvalue()
    finally:
        for name, (level, handlers, propagate) in previous_states.items():
            logger = logging.getLogger(name)
            logger.setLevel(level)
            logger.handlers = handlers
            logger.propagate = propagate


def test_uvicorn_protocol_log_filter_hides_routine_protocol_messages():
    """Hide routine WebSocket protocol logs without hiding Uvicorn errors."""

    log_filter = UvicornProtocolLogFilter(logging.WARNING)

    assert not log_filter.filter(logging.LogRecord("uvicorn.error", logging.INFO, "", 0, "connection open", (), None))
    assert not log_filter.filter(logging.LogRecord("uvicorn.error", logging.INFO, "", 0, 'WebSocket /api/ws" [accepted]', (), None))
    assert not log_filter.filter(logging.LogRecord("uvicorn.error", logging.INFO, "", 0, "connection rejected (403 Forbidden)", (), None))
    assert not log_filter.filter(
        logging.LogRecord("uvicorn.error", logging.DEBUG, "", 0, '> TEXT \'{"type":"subscribed"}\' [21 bytes]', (), None)
    )
    assert not log_filter.filter(logging.LogRecord("uvicorn.error", logging.DEBUG, "", 0, "> PING 4c 2a f7 4f [binary, 4 bytes]", (), None))
    assert log_filter.filter(logging.LogRecord("uvicorn.error", logging.INFO, "", 0, "Application startup complete.", (), None))
    assert log_filter.filter(logging.LogRecord("uvicorn.error", logging.ERROR, "", 0, "connection failed", (), None))


def test_uvicorn_access_log_filter_hides_rejected_websockets_and_redacts_query_strings():
    """Keep stale WebSocket tokens out of routine upgrade logs."""

    log_filter = UvicornAccessLogFilter(logging.WARNING)
    rejected_websocket = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        0,
        '172.19.0.11 - "WebSocket /api/ws?token=secret-token" 403',
        (),
        None,
    )
    retained_request = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        0,
        '172.19.0.11 - "GET /api/files?cursor=sensitive-value HTTP/1.1" 200',
        (),
        None,
    )

    assert not log_filter.filter(rejected_websocket)
    assert log_filter.filter(retained_request)
    assert retained_request.getMessage() == '172.19.0.11 - "GET /api/files?<redacted> HTTP/1.1" 200'
