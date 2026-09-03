"""Aggregate, privacy-safe telemetry for archive operations."""

from collections.abc import Mapping

from app.core.logging import format_audit_fields, get_logger

logger = get_logger(__name__)


def log_archive_operation_metrics(operation: str, duration_ms: float, counts: Mapping[str, int]) -> None:
    """Log aggregate archive operation metrics without path or user data."""

    logger.info(
        "archive_metrics %s",
        format_audit_fields(
            operation=operation,
            duration_ms=round(duration_ms),
            **counts,
        ),
    )
