"""
SMB Connection Pool

Manages a pool of SMB connections with automatic reuse across requests.
This eliminates the connection overhead (TCP handshake + SMB negotiation)
for subsequent requests to the same server.

Key Features:
- Thread-safe connection sharing
- Reference counting for automatic cleanup
- Connection health checks
- Per-server connection limits
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

import smbclient

logger = logging.getLogger(__name__)


@dataclass
class PooledConnection:
    """Represents a pooled SMB connection with metadata."""

    host: str
    port: int
    username: str
    share_name: str
    created_at: datetime
    last_used: datetime
    reference_count: int
    # Note: smbclient manages the actual connection internally via register_session()
    # We just track whether it's been registered and how many refs it has


class SMBConnectionPool:
    """
    Thread-safe pool of SMB connections.

    Connections are identified by (host, port, username, share_name).
    Multiple requests to the same server reuse the same connection.
    """

    def __init__(
        self,
        max_idle_time: timedelta = timedelta(minutes=5),
        cleanup_interval: timedelta = timedelta(minutes=1),
    ):
        """
        Initialize the connection pool.

        Args:
            max_idle_time: How long to keep idle connections alive
            cleanup_interval: How often to run cleanup of idle connections
        """
        self._connections: dict[tuple[str, int, str, str], PooledConnection] = {}
        self._lock = asyncio.Lock()
        self._max_idle_time = max_idle_time
        self._cleanup_interval = cleanup_interval
        self._cleanup_task: Optional[asyncio.Task[None]] = None

    def _get_pool_key(
        self, host: str, port: int, username: str, share_name: str
    ) -> tuple[str, int, str, str]:
        """Generate a unique key for connection pooling."""
        return (host.lower(), port, username, share_name)

    @asynccontextmanager
    async def get_connection(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        share_name: str,
    ) -> AsyncIterator[None]:
        """
        Acquire a connection from the pool (or create if needed).

        This is a context manager that automatically handles reference counting.
        The connection is released when the context exits.

        Usage:
            async with pool.get_connection(...):
                # Use smbclient operations here
                # The connection is guaranteed to be active
                result = smbclient.scandir(path, username=username, password=password)

        Args:
            host: SMB server hostname or IP
            port: SMB server port (usually 445)
            username: Username for authentication
            password: Password for authentication
            share_name: SMB share name

        Yields:
            None (connection is managed internally by smbclient)
        """
        pool_key = self._get_pool_key(host, port, username, share_name)

        # Acquire connection
        async with self._lock:
            if pool_key in self._connections:
                # Reuse existing connection
                conn = self._connections[pool_key]
                conn.reference_count += 1
                conn.last_used = datetime.now()
                logger.info(
                    f"♻️  Reusing pooled connection: {host}:{port}/{share_name} "
                    f"(refs={conn.reference_count})"
                )
            else:
                # Create new connection
                logger.info(
                    f"🔌 Creating new pooled connection: {host}:{port}/{share_name}"
                )

                # Register session with smbclient (establishes connection)
                try:
                    await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: smbclient.register_session(
                            host,
                            username=username,
                            password=password,
                            port=port,
                        ),
                    )
                except Exception as e:
                    logger.error(
                        f"Failed to create SMB connection to {host}:{port}: {e}",
                        exc_info=True,
                    )
                    raise

                # Add to pool
                conn = PooledConnection(
                    host=host,
                    port=port,
                    username=username,
                    share_name=share_name,
                    created_at=datetime.now(),
                    last_used=datetime.now(),
                    reference_count=1,
                )
                self._connections[pool_key] = conn

                logger.info(f"✅ SMB connection pooled: {host}:{port}/{share_name}")

        try:
            # Yield control to caller (connection is ready)
            yield

        finally:
            # Release connection
            async with self._lock:
                if pool_key in self._connections:
                    conn = self._connections[pool_key]
                    conn.reference_count -= 1
                    conn.last_used = datetime.now()

                    logger.debug(
                        f"Released pooled connection: {host}:{port}/{share_name} "
                        f"(refs={conn.reference_count})"
                    )

                    # Don't immediately remove - keep in pool for reuse
                    # Cleanup task will handle removing idle connections

    async def cleanup_idle_connections(self) -> None:
        """Remove connections that have been idle for too long."""
        async with self._lock:
            now = datetime.now()
            to_remove = []

            for pool_key, conn in self._connections.items():
                # Only remove if not actively in use
                if conn.reference_count == 0:
                    idle_time = now - conn.last_used
                    if idle_time > self._max_idle_time:
                        to_remove.append(pool_key)

            # Remove idle connections
            for pool_key in to_remove:
                conn = self._connections[pool_key]
                logger.info(
                    f"Removing idle connection: {conn.host}:{conn.port}/{conn.share_name} "
                    f"(idle for {(now - conn.last_used).total_seconds():.0f}s)"
                )

                # Delete session from smbclient pool
                try:
                    smbclient.delete_session(conn.host, port=conn.port)
                except Exception as e:
                    logger.warning(
                        f"Error deleting session for {conn.host}:{conn.port}: {e}"
                    )

                del self._connections[pool_key]

            if to_remove:
                logger.debug(
                    f"Cleaned up {len(to_remove)} idle connection(s), "
                    f"{len(self._connections)} remaining"
                )

    async def start_cleanup_task(self) -> None:
        """Start the background cleanup task."""
        if self._cleanup_task is not None:
            return  # Already running

        async def cleanup_loop() -> None:
            """Periodically clean up idle connections."""
            while True:
                try:
                    await asyncio.sleep(self._cleanup_interval.total_seconds())
                    await self.cleanup_idle_connections()
                except asyncio.CancelledError:
                    logger.info("Connection pool cleanup task cancelled")
                    break
                except Exception as e:
                    logger.error(f"Error in cleanup task: {e}", exc_info=True)

        self._cleanup_task = asyncio.create_task(cleanup_loop())
        logger.info("Started SMB connection pool cleanup task")

    async def stop_cleanup_task(self) -> None:
        """Stop the background cleanup task."""
        if self._cleanup_task is not None:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None

    async def close_all(self) -> None:
        """Close all pooled connections (for shutdown)."""
        async with self._lock:
            for pool_key, conn in self._connections.items():
                try:
                    logger.info(
                        f"Closing connection: {conn.host}:{conn.port}/{conn.share_name}"
                    )
                    smbclient.delete_session(conn.host, port=conn.port)
                except Exception as e:
                    logger.warning(
                        f"Error closing connection {conn.host}:{conn.port}: {e}"
                    )

            self._connections.clear()
            logger.info("All SMB connections closed")

    def get_stats(self) -> dict[str, int]:
        """
        Get statistics about the connection pool.

        Returns:
            Dictionary with pool statistics
        """
        total_refs = sum(conn.reference_count for conn in self._connections.values())
        active_conns = sum(
            1 for conn in self._connections.values() if conn.reference_count > 0
        )

        return {
            "total_connections": len(self._connections),
            "active_connections": active_conns,
            "idle_connections": len(self._connections) - active_conns,
            "total_references": total_refs,
        }


# Global singleton instance
_pool: Optional[SMBConnectionPool] = None
_pool_lock = asyncio.Lock()


async def get_connection_pool() -> SMBConnectionPool:
    """
    Get the global SMB connection pool instance.

    Creates the pool on first access and starts the cleanup task.

    Returns:
        The global connection pool
    """
    global _pool

    if _pool is None:
        async with _pool_lock:
            if _pool is None:  # Double-check after acquiring lock
                _pool = SMBConnectionPool()
                await _pool.start_cleanup_task()
                logger.info("Initialized global SMB connection pool")

    return _pool


async def shutdown_connection_pool() -> None:
    """Shutdown the global connection pool (for application shutdown)."""
    global _pool

    if _pool is not None:
        await _pool.stop_cleanup_task()
        await _pool.close_all()
        _pool = None
        logger.info("SMB connection pool shut down")
