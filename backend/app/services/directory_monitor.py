"""
Directory monitoring service using SMB change notifications.
Monitors directories for changes and notifies WebSocket clients.
"""

import asyncio
import logging
import random
import threading
from collections.abc import Awaitable, Callable
from typing import Dict, Optional

from smbprotocol.change_notify import (  # type: ignore[import-untyped]
    ChangeNotifyFlags,
    CompletionFilter,
    FileAction,
    FileSystemWatcher,
)
from smbprotocol.connection import Connection  # type: ignore[import-untyped]
from smbprotocol.open import (  # type: ignore[import-untyped]
    CreateDisposition,
    CreateOptions,
    DirectoryAccessMask,
    FileAttributes,
    ImpersonationLevel,
    Open,
    ShareAccess,
)
from smbprotocol.session import Session  # type: ignore[import-untyped]
from smbprotocol.tree import TreeConnect  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)

# Connection retry configuration
MAX_RETRY_ATTEMPTS = 5
INITIAL_RETRY_DELAY = 1.0  # seconds
MAX_RETRY_DELAY = 60.0  # seconds
RETRY_BACKOFF_MULTIPLIER = 2.0
RETRY_JITTER_FACTOR = 0.1  # 10% jitter

# Timeout configuration
SMB_CONNECT_TIMEOUT = 30.0  # seconds for initial connection
SMB_OPERATION_TIMEOUT = 60.0  # seconds for SMB operations


class DirectoryMonitor:
    """
    Monitors SMB directories for changes using SMB2_CHANGE_NOTIFY.
    Manages directory handles and watchers with proper cleanup.
    """

    def __init__(self) -> None:
        # Map: "connection_id:path" -> MonitoredDirectory
        self._monitors: Dict[str, "MonitoredDirectory"] = {}
        self._lock = threading.Lock()
        self._running = True

    def start_monitoring(
        self,
        connection_id: str,
        path: str,
        host: str,
        share_name: str,
        username: str,
        password: str,
        port: int = 445,
        on_change_callback: Optional[Callable[[str, str], Awaitable[None]]] = None,
    ) -> None:
        """
        Start monitoring a directory for changes.

        Args:
            connection_id: Unique connection identifier
            path: Directory path to monitor (relative to share root)
            host: SMB server hostname
            share_name: SMB share name
            username: SMB username
            password: SMB password
            port: SMB port
            on_change_callback: Async callback function(connection_id, path) called on changes
        """
        key = f"{connection_id}:{path}"

        with self._lock:
            # If already monitoring, just update subscriber count
            if key in self._monitors:
                self._monitors[key].subscriber_count += 1
                logger.info(
                    f"Increased subscriber count for {key} to {self._monitors[key].subscriber_count}"
                )
                return

            # Create new monitor
            try:
                monitor = MonitoredDirectory(
                    connection_id=connection_id,
                    path=path,
                    host=host,
                    share_name=share_name,
                    username=username,
                    password=password,
                    port=port,
                    on_change_callback=on_change_callback,
                )
                monitor.start()
                self._monitors[key] = monitor
                logger.info(f"Started monitoring: {key}")
            except Exception as e:
                logger.error(f"Failed to start monitoring {key}: {e}", exc_info=True)
                raise

    def stop_monitoring(self, connection_id: str, path: str) -> None:
        """
        Stop monitoring a directory (decreases subscriber count, stops when 0).

        Args:
            connection_id: Connection identifier
            path: Directory path
        """
        key = f"{connection_id}:{path}"

        with self._lock:
            if key not in self._monitors:
                logger.warning(f"Attempted to stop monitoring non-existent key: {key}")
                return

            monitor = self._monitors[key]
            monitor.subscriber_count -= 1

            if monitor.subscriber_count <= 0:
                logger.info(f"Stopping monitoring: {key}")
                try:
                    monitor.stop()
                except Exception as e:
                    logger.error(f"Error stopping monitor {key}: {e}", exc_info=True)
                finally:
                    del self._monitors[key]
            else:
                logger.info(
                    f"Decreased subscriber count for {key} to {monitor.subscriber_count}"
                )

    def stop_all(self) -> None:
        """Stop all monitors and clean up resources."""
        with self._lock:
            self._running = False
            keys = list(self._monitors.keys())

        for key in keys:
            try:
                monitor = self._monitors[key]
                monitor.stop()
            except Exception as e:
                logger.error(f"Error stopping monitor {key}: {e}", exc_info=True)

        with self._lock:
            self._monitors.clear()

        logger.info("All directory monitors stopped")


class MonitoredDirectory:
    """
    Represents a single monitored directory with its SMB handles and watcher.
    Handles proper resource cleanup to prevent handle leaks.
    """

    def __init__(
        self,
        connection_id: str,
        path: str,
        host: str,
        share_name: str,
        username: str,
        password: str,
        port: int,
        on_change_callback: Optional[Callable[[str, str], Awaitable[None]]] = None,
    ) -> None:
        self.connection_id = connection_id
        self.path = path
        self.host = host
        self.share_name = share_name
        self.username = username
        self.password = password
        self.port = port
        self.on_change_callback = on_change_callback
        self.subscriber_count = 1

        # SMB resources - must be cleaned up
        self._connection: Optional[Connection] = None
        self._session: Optional[Session] = None
        self._tree: Optional[TreeConnect] = None
        self._open: Optional[Open] = None
        self._watcher: Optional[FileSystemWatcher] = None
        self._monitor_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        # Retry state
        self._retry_count = 0
        self._consecutive_failures = 0

    def start(self) -> None:
        """Start monitoring this directory."""
        try:
            # Establish SMB connection
            self._connection = Connection(
                guid=None, server_name=self.host, port=self.port
            )
            self._connection.connect()

            # Create session
            self._session = Session(
                self._connection,
                username=self.username,
                password=self.password,
            )
            self._session.connect()

            # Connect to tree (share)
            self._tree = TreeConnect(self._session, rf"\\{self.host}\{self.share_name}")
            self._tree.connect()

            # Open directory for change notification
            # Convert path to Windows format
            windows_path = self.path.replace("/", "\\") if self.path else ""

            self._open = Open(self._tree, windows_path)
            self._open.create(
                impersonation_level=ImpersonationLevel.Impersonation,
                desired_access=DirectoryAccessMask.FILE_LIST_DIRECTORY
                | DirectoryAccessMask.SYNCHRONIZE,
                file_attributes=FileAttributes.FILE_ATTRIBUTE_DIRECTORY,
                share_access=ShareAccess.FILE_SHARE_READ
                | ShareAccess.FILE_SHARE_WRITE
                | ShareAccess.FILE_SHARE_DELETE,
                create_disposition=CreateDisposition.FILE_OPEN,
                create_options=CreateOptions.FILE_DIRECTORY_FILE,
            )

            # Create watcher
            self._watcher = FileSystemWatcher(self._open)

            # Start monitoring in background thread
            self._monitor_thread = threading.Thread(
                target=self._monitor_loop, daemon=True
            )
            self._monitor_thread.start()

        except Exception:
            # Clean up on error
            self._cleanup()
            raise

    def _reconnect(self) -> None:
        """Reconnect to SMB server after connection loss with exponential backoff."""
        self._consecutive_failures += 1

        if self._consecutive_failures > MAX_RETRY_ATTEMPTS:
            logger.error(
                f"Max retry attempts ({MAX_RETRY_ATTEMPTS}) reached for {self.connection_id}:{self.path}, giving up"
            )
            self._stop_event.set()
            return

        # Calculate delay with exponential backoff and jitter
        base_delay = min(
            INITIAL_RETRY_DELAY
            * (RETRY_BACKOFF_MULTIPLIER ** (self._consecutive_failures - 1)),
            MAX_RETRY_DELAY,
        )
        jitter = base_delay * RETRY_JITTER_FACTOR * (random.random() * 2 - 1)  # +/- 10%
        delay = max(0, base_delay + jitter)

        logger.info(
            f"Reconnecting monitor for {self.connection_id}:{self.path} "
            f"(attempt {self._consecutive_failures}/{MAX_RETRY_ATTEMPTS}, delay: {delay:.1f}s)"
        )

        # Wait before reconnecting
        if self._stop_event.wait(delay):
            return  # Stop event was set during wait

        # Establish new SMB connection with timeout handling
        try:
            self._connection = Connection(
                guid=None, server_name=self.host, port=self.port
            )
            self._connection.connect(timeout=SMB_CONNECT_TIMEOUT)
        except Exception as e:
            logger.error(f"Connection failed during reconnect: {e}", exc_info=True)
            raise

        # Create new session
        self._session = Session(
            self._connection,
            username=self.username,
            password=self.password,
        )
        self._session.connect()

        # Connect to tree (share)
        self._tree = TreeConnect(self._session, rf"\\{self.host}\{self.share_name}")
        self._tree.connect()

        # Open directory for change notification
        windows_path = self.path.replace("/", "\\") if self.path else ""

        self._open = Open(self._tree, windows_path)
        self._open.create(
            impersonation_level=ImpersonationLevel.Impersonation,
            desired_access=DirectoryAccessMask.FILE_LIST_DIRECTORY
            | DirectoryAccessMask.SYNCHRONIZE,
            file_attributes=FileAttributes.FILE_ATTRIBUTE_DIRECTORY,
            share_access=ShareAccess.FILE_SHARE_READ
            | ShareAccess.FILE_SHARE_WRITE
            | ShareAccess.FILE_SHARE_DELETE,
            create_disposition=CreateDisposition.FILE_OPEN,
            create_options=CreateOptions.FILE_DIRECTORY_FILE,
        )

        # Create new watcher
        self._watcher = FileSystemWatcher(self._open)

        logger.info(
            f"Successfully reconnected monitor for {self.connection_id}:{self.path}"
        )

    def _monitor_loop(self) -> None:
        """Background thread that monitors for changes."""
        try:
            while not self._stop_event.is_set():
                # Start watching for changes
                # Monitor file/dir additions, deletions, renames, and modifications
                completion_filter = (
                    CompletionFilter.FILE_NOTIFY_CHANGE_FILE_NAME
                    | CompletionFilter.FILE_NOTIFY_CHANGE_DIR_NAME
                    | CompletionFilter.FILE_NOTIFY_CHANGE_SIZE
                    | CompletionFilter.FILE_NOTIFY_CHANGE_LAST_WRITE
                )

                # Watch subdirectories too
                flags = ChangeNotifyFlags.SMB2_WATCH_TREE

                if self._watcher is None:
                    logger.warning(
                        f"Watcher is None for {self.connection_id}:{self.path}, exiting loop"
                    )
                    break

                # Start the watcher (this is a blocking call until change occurs)
                self._watcher.start(
                    completion_filter=completion_filter,
                    flags=flags,
                    output_buffer_length=4096,
                    send=True,
                )

                # Wait for response (blocking)
                try:
                    result = self._watcher.wait()

                    if self._stop_event.is_set():
                        break

                    if result is not None:
                        # Success - reset failure counter
                        self._consecutive_failures = 0

                        # Log the changes
                        for action_info in result:
                            action = action_info["action"].get_value()
                            filename = action_info["file_name"].get_value()
                            action_name = self._get_action_name(action)
                            logger.info(
                                f"Change detected in {self.connection_id}:{self.path} - {action_name}: {filename}"
                            )

                        # Notify callback
                        if self.on_change_callback:
                            try:
                                # Create a new event loop for this thread
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                                loop.run_until_complete(
                                    self.on_change_callback(
                                        self.connection_id, self.path
                                    )
                                )
                                loop.close()
                            except Exception as cb_error:
                                logger.error(
                                    f"Error in change callback: {cb_error}",
                                    exc_info=True,
                                )

                        # Restart watcher for next change
                        # Need to create a new watcher instance
                        self._watcher = FileSystemWatcher(self._open)

                except Exception as e:
                    if not self._stop_event.is_set():
                        error_type = type(e).__name__
                        error_msg = str(e).lower()

                        logger.error(
                            f"Error waiting for changes in {self.connection_id}:{self.path}: {error_type}: {e}",
                            exc_info=True,
                        )

                        # Check if the error is due to connection/timeout issues
                        is_connection_error = (
                            "socket" in error_msg
                            or "connection" in error_msg
                            or "closed" in error_msg
                            or "timeout" in error_msg
                            or "timed out" in error_msg
                            or error_type
                            in ("TimeoutError", "ConnectionError", "OSError")
                        )

                        if is_connection_error:
                            logger.warning(
                                f"Connection/timeout issue detected for {self.connection_id}:{self.path}, "
                                f"attempting recovery (consecutive failures: {self._consecutive_failures})"
                            )
                            # Clean up old resources
                            self._cleanup()
                            # Try to reconnect with exponential backoff
                            try:
                                self._reconnect()
                                # Success - reset failure counter
                                self._consecutive_failures = 0
                                logger.info(
                                    f"Successfully reconnected {self.connection_id}:{self.path}"
                                )
                            except Exception as reconnect_error:
                                logger.error(
                                    f"Failed to reconnect (attempt {self._consecutive_failures}/{MAX_RETRY_ATTEMPTS}): {reconnect_error}",
                                    exc_info=True,
                                )
                                # _reconnect handles retry logic and stop event
                                if self._stop_event.is_set():
                                    break
                        else:
                            # Other errors - wait briefly and retry with same connection
                            logger.info(
                                "Non-connection error, recreating watcher after 5s delay"
                            )
                            self._stop_event.wait(5)
                            if not self._stop_event.is_set() and self._open:
                                self._watcher = FileSystemWatcher(self._open)

        except Exception as e:
            logger.error(
                f"Monitor loop error for {self.connection_id}:{self.path}: {e}",
                exc_info=True,
            )
        finally:
            logger.info(f"Monitor loop stopped for {self.connection_id}:{self.path}")

    def _get_action_name(self, action: int) -> str:
        """Get human-readable action name."""
        action_names = {
            FileAction.FILE_ACTION_ADDED: "ADDED",
            FileAction.FILE_ACTION_REMOVED: "REMOVED",
            FileAction.FILE_ACTION_MODIFIED: "MODIFIED",
            FileAction.FILE_ACTION_RENAMED_OLD_NAME: "RENAMED_OLD",
            FileAction.FILE_ACTION_RENAMED_NEW_NAME: "RENAMED_NEW",
        }
        return action_names.get(action, f"UNKNOWN({action})")

    def stop(self) -> None:
        """Stop monitoring and clean up resources."""
        logger.info(f"Stopping monitor for {self.connection_id}:{self.path}")
        self._stop_event.set()

        # Cancel any pending watcher
        if self._watcher and hasattr(self._watcher, "cancel"):
            try:
                self._watcher.cancel()
            except Exception as e:
                logger.warning(f"Error canceling watcher: {e}")

        # Wait for monitor thread to finish
        if self._monitor_thread and self._monitor_thread.is_alive():
            self._monitor_thread.join(timeout=5.0)
            if self._monitor_thread.is_alive():
                logger.warning(
                    f"Monitor thread did not stop cleanly for {self.connection_id}:{self.path}"
                )

        # Clean up SMB resources
        self._cleanup()

    def _cleanup(self) -> None:
        """Clean up SMB resources in proper order."""
        # Close in reverse order of creation to prevent leaks

        if self._open:
            try:
                self._open.close()
                logger.debug(
                    f"Closed directory handle for {self.connection_id}:{self.path}"
                )
            except Exception as e:
                logger.warning(f"Error closing directory handle: {e}")
            finally:
                self._open = None

        if self._tree:
            try:
                self._tree.disconnect()
                logger.debug(f"Disconnected tree for {self.connection_id}:{self.path}")
            except Exception as e:
                logger.warning(f"Error disconnecting tree: {e}")
            finally:
                self._tree = None

        if self._session:
            try:
                self._session.disconnect()
                logger.debug(
                    f"Disconnected session for {self.connection_id}:{self.path}"
                )
            except Exception as e:
                logger.warning(f"Error disconnecting session: {e}")
            finally:
                self._session = None

        if self._connection:
            try:
                self._connection.disconnect()
                logger.debug(
                    f"Disconnected connection for {self.connection_id}:{self.path}"
                )
            except Exception as e:
                logger.warning(f"Error disconnecting connection: {e}")
            finally:
                self._connection = None


# Global monitor instance
_global_monitor: Optional[DirectoryMonitor] = None


def get_monitor() -> DirectoryMonitor:
    """Get or create the global directory monitor instance."""
    global _global_monitor
    if _global_monitor is None:
        _global_monitor = DirectoryMonitor()
    return _global_monitor


def shutdown_monitor() -> None:
    """Shutdown the global monitor and clean up all resources."""
    global _global_monitor
    if _global_monitor is not None:
        _global_monitor.stop_all()
        _global_monitor = None
