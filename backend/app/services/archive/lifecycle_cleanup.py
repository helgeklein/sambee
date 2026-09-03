"""Process-local cleanup hooks for durable archive operation termination."""

import logging
import uuid
from collections.abc import Awaitable, Callable

OperationCleanup = Callable[[], Awaitable[object]]
OperationFailurePreparation = Callable[[], Awaitable[str | None]]


class ArchiveOperationCleanupRegistry:
    """Run registered process-local cleanup after a durable operation terminates."""

    def __init__(self, logger: logging.Logger | logging.LoggerAdapter[logging.Logger]) -> None:
        self._logger = logger
        self._callbacks: dict[uuid.UUID, OperationCleanup] = {}
        self._failure_preparations: dict[uuid.UUID, OperationFailurePreparation] = {}

    def register(
        self,
        operation_id: uuid.UUID,
        callback: OperationCleanup,
        *,
        prepare_failure: OperationFailurePreparation | None = None,
    ) -> None:
        """Associate the sole current process-local resource with one operation."""

        self._callbacks[operation_id] = callback
        if prepare_failure is not None:
            self._failure_preparations[operation_id] = prepare_failure

    def unregister(self, operation_id: uuid.UUID) -> None:
        """Forget cleanup after its resource has already been released."""

        self._callbacks.pop(operation_id, None)
        self._failure_preparations.pop(operation_id, None)

    async def prepare_failure(self, operation_id: uuid.UUID) -> str | None:
        """Fence a live resource and return its bounded aggregate checkpoint."""

        callback = self._failure_preparations.get(operation_id)
        if callback is None:
            return None
        try:
            return await callback()
        except Exception:
            self._logger.exception("Failed to prepare terminated archive operation resource: operation_id=%s", operation_id)
            return None

    async def cleanup(self, operation_id: uuid.UUID) -> None:
        """Best-effort release of a resource whose durable operation has ended."""

        callback = self._callbacks.pop(operation_id, None)
        self._failure_preparations.pop(operation_id, None)
        if callback is None:
            return
        try:
            await callback()
        except Exception:
            self._logger.exception("Failed to release terminated archive operation resource: operation_id=%s", operation_id)


archive_operation_cleanup_registry = ArchiveOperationCleanupRegistry(logging.getLogger(__name__))
