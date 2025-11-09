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


def get_request_id() -> Optional[str]:
    """Get the current request ID from context."""
    return request_id_var.get()


def set_user(username: Optional[str]) -> None:
    """Set the current user for the request context."""
    user_var.set(username)


def get_user() -> Optional[str]:
    """Get the current user from context."""
    return user_var.get()


def clear_context() -> None:
    """Clear all context variables."""
    request_id_var.set(None)
    user_var.set(None)


class ContextAdapter(logging.LoggerAdapter):
    """
    Logging adapter that automatically adds request context to log messages.

    Adds request_id and user to all log messages when available.
    """

    def process(
        self, msg: str, kwargs: MutableMapping[str, Any]
    ) -> tuple[str, MutableMapping[str, Any]]:
        """Add context information to log message."""
        request_id = get_request_id()
        user = get_user()

        # Build context prefix
        context_parts = []
        if request_id:
            context_parts.append(f"request_id={request_id}")
        if user:
            context_parts.append(f"user={user}")

        if context_parts:
            context_str = " - ".join(context_parts)
            msg = f"{context_str} - {msg}"

        return msg, kwargs


def get_logger(name: str) -> logging.LoggerAdapter:
    """
    Get a context-aware logger.

    Args:
        name: Logger name (typically __name__)

    Returns:
        LoggerAdapter that automatically includes request context.
    """
    base_logger = logging.getLogger(name)
    return ContextAdapter(base_logger, {})
