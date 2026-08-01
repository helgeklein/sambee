"""
Logging utilities for request context management.

Provides request ID tracking and context-aware logging throughout the application.
"""

import logging
import re
import uuid
from collections.abc import MutableMapping
from contextvars import ContextVar
from typing import Any, Optional

# Context variables for request tracking
request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
user_var: ContextVar[Optional[str]] = ContextVar("user", default=None)


#
# set_request_id
#
def set_request_id(request_id: Optional[str] = None) -> str:
    """
    Set the request ID for the current context.

    Args:
        request_id: Optional request ID. If not provided, generates a new UUID.

    Returns:
        The request ID that was set.
    """

    if request_id is None:
        request_id = str(uuid.uuid4())
    request_id_var.set(request_id)
    return request_id


#
# get_request_id
#
def get_request_id() -> Optional[str]:
    """Get the current request ID from context."""

    return request_id_var.get()


#
# set_user
#
def set_user(username: Optional[str]) -> None:
    """Set the current user for the request context."""

    user_var.set(username)


#
# get_user
#
def get_user() -> Optional[str]:
    """Get the current user from context."""

    return user_var.get()


#
# clear_context
#
def clear_context() -> None:
    """Clear all context variables."""

    request_id_var.set(None)
    user_var.set(None)


def format_audit_fields(**fields: Any) -> str:
    """Format audit-safe key/value pairs for log messages.

    Skips fields with ``None`` values and quotes string-like identifiers while
    avoiding raw bearer material unless a caller passes it explicitly.
    """

    formatted_fields: list[str] = []
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, uuid.UUID):
            formatted_fields.append(f"{key}='{value}'")
        elif isinstance(value, str):
            formatted_fields.append(f"{key}={value!r}")
        else:
            formatted_fields.append(f"{key}={value}")

    return ", ".join(formatted_fields)


class UvicornProtocolLogFilter(logging.Filter):
    """Apply a separate threshold to routine Uvicorn WebSocket lifecycle records."""

    _FRAME_PREFIXES = (
        "> TEXT ",
        "< TEXT ",
        "> BINARY ",
        "< BINARY ",
        "> PING ",
        "< PING ",
        "> PONG ",
        "< PONG ",
        "> CLOSE ",
        "< CLOSE ",
    )

    def __init__(self, protocol_log_level: int) -> None:
        super().__init__()
        self.protocol_log_level = protocol_log_level

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        is_protocol_message = (
            message in {"connection open", "connection closed", "connection rejected (403 Forbidden)"}
            or ("WebSocket " in message and "[accepted]" in message)
            or message.startswith(self._FRAME_PREFIXES)
        )
        return not is_protocol_message or record.levelno >= self.protocol_log_level


class UvicornAccessLogFilter(logging.Filter):
    """Redact query strings and apply protocol verbosity to rejected WebSockets."""

    _QUERY_STRING_PATTERN = re.compile(r'(?P<method>"?(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|WebSocket)\s+)(?P<path>[^\s?]+)\?[^\s"]+')

    def __init__(self, protocol_log_level: int) -> None:
        super().__init__()
        self.protocol_log_level = protocol_log_level

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        is_rejected_websocket = "WebSocket " in message and message.endswith('" 403')
        if is_rejected_websocket and record.levelno < self.protocol_log_level:
            return False

        redacted_message = self._QUERY_STRING_PATTERN.sub(r"\g<method>\g<path>?<redacted>", message)
        if redacted_message != message:
            record.msg = redacted_message
            record.args = ()
        return True


def configure_uvicorn_loggers(
    handlers: list[logging.Handler],
    log_format: str,
    application_log_level: int,
    access_log_level: int,
    protocol_log_level: int,
) -> None:
    """Configure Uvicorn access, protocol, and lifecycle log routing."""

    def configure_logger(logger_name: str, level: int, log_filter: logging.Filter | None = None) -> None:
        logger = logging.getLogger(logger_name)
        logger.setLevel(level)
        logger.handlers.clear()
        for handler in handlers:
            configured_handler = logging.StreamHandler(handler.stream) if isinstance(handler, logging.StreamHandler) else handler
            formatter = (
                logging.Formatter(log_format.replace("%(name)s", "uvicorn"))
                if logger_name == "uvicorn.error"
                else logging.Formatter(log_format)
            )
            configured_handler.setFormatter(formatter)
            if log_filter is not None:
                configured_handler.addFilter(log_filter)
            logger.addHandler(configured_handler)
        logger.propagate = False

    protocol_filter = UvicornProtocolLogFilter(protocol_log_level)
    access_filter = UvicornAccessLogFilter(protocol_log_level)
    configure_logger("uvicorn", application_log_level, protocol_filter)
    configure_logger("uvicorn.error", application_log_level, protocol_filter)
    configure_logger("uvicorn.access", access_log_level, access_filter)


class ContextAdapter(logging.LoggerAdapter[logging.Logger]):
    """
    Logging adapter that automatically adds request context to log messages.

    Adds request_id and user to all log messages when available.
    """

    #
    # process
    #
    def process(self, msg: str, kwargs: MutableMapping[str, Any]) -> tuple[str, MutableMapping[str, Any]]:
        """Add context information to log message."""

        request_id = get_request_id()
        user = get_user()

        # Build context suffix
        context_parts = []
        if request_id:
            context_parts.append(f"request_id={request_id}")
        if user:
            context_parts.append(f"user={user}")

        if context_parts:
            context_str = " - ".join(context_parts)
            msg = f"{msg} - {context_str}"

        return msg, kwargs


#
# get_logger
#
def get_logger(name: str) -> logging.LoggerAdapter[logging.Logger]:
    """
    Get a context-aware logger.

    Args:
        name: Logger name (typically __name__)

    Returns:
        LoggerAdapter that automatically includes request context.
    """

    base_logger = logging.getLogger(name)
    return ContextAdapter(base_logger, {})


#
# setup_early_error_logging
#
def setup_early_error_logging() -> logging.Logger:
    """
    Setup minimal logging for early startup errors.

    Used for critical errors that occur before main application initialization,
    such as missing configuration files, import errors, or file system issues.

    This function is idempotent - safe to call multiple times. It configures
    the root logger with a simple format suitable for error messages.

    Returns:
        Logger instance ready to use for error logging.

    Example:
        logger = setup_early_error_logging()
        logger.error("Configuration file not found")
        sys.exit(1)
    """

    # Configure root logger if not already configured
    # basicConfig is idempotent - only configures if no handlers exist
    logging.basicConfig(level=logging.ERROR, format="%(levelname)s - %(message)s")

    # Return a logger for the caller
    return logging.getLogger("sambee.startup")


#
# log_error
#
def log_error(logger: logging.Logger | logging.LoggerAdapter[logging.Logger], message: str) -> None:
    """
    Log an error message without stack trace.

    Use this for user-facing errors where stack traces would be confusing.
    Always logs with exc_info=False to prevent stack trace output.

    Args:
        logger: Logger instance to use for logging.
        message: Clear, concise error message with actionable information.
    """

    logger.error(message, exc_info=False)
