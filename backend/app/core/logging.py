"""
Logging utilities for request context management.

Provides request ID tracking and context-aware logging throughout the application.
"""

import logging
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
