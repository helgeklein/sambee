"""WebSocket endpoints for real-time directory updates"""

import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Dict, Set

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from sqlmodel import Session as DBSession

from app.core.security import decrypt_password, get_current_user_for_token
from app.db.database import engine
from app.models.user import User
from app.services.connection_access import get_accessible_connection_or_404
from app.services.directory_monitor import get_monitor
from app.storage.smb import SMBBackend

logger = logging.getLogger(__name__)

router = APIRouter()


class ConnectionManager:
    """Manages WebSocket connections and directory subscriptions"""

    #
    # __init__
    #
    def __init__(self) -> None:
        # Map: connection_id -> set of WebSocket connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # Map: WebSocket -> set of subscribed directory paths
        self.subscriptions: Dict[WebSocket, Set[str]] = {}
        # Map: WebSocket -> authenticated user
        self.users: Dict[WebSocket, User] = {}
        # Map: subscription key -> resolved SMB path (with path_prefix applied)
        self._resolved_paths: Dict[str, str] = {}

    #
    # connect
    #
    async def connect(self, websocket: WebSocket, user: User) -> None:
        """Accept a new WebSocket connection"""

        await websocket.accept()
        self.subscriptions[websocket] = set()
        self.users[websocket] = user
        logger.info(f"WebSocket connected: {id(websocket)}")

    #
    # disconnect
    #
    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection and its subscriptions"""

        # Get all subscriptions for this WebSocket before removing
        subscriptions_to_remove = []
        if websocket in self.subscriptions:
            subscriptions_to_remove = list(self.subscriptions[websocket])
            del self.subscriptions[websocket]

        self.users.pop(websocket, None)

        # Remove from active_connections and stop monitoring if last subscriber
        for key in subscriptions_to_remove:
            if key in self.active_connections:
                self.active_connections[key].discard(websocket)

                if not self.active_connections[key]:
                    del self.active_connections[key]
                    # Stop SMB monitoring
                    try:
                        connection_id, path = key.split(":", 1)
                        resolved = self._resolved_paths.pop(key, path)
                        monitor = get_monitor()
                        monitor.stop_monitoring(connection_id, resolved)
                        logger.info(f"Stopped SMB monitoring for {key} (last subscriber disconnected)")
                    except Exception as e:
                        logger.error(
                            f"Failed to stop SMB monitoring for {key}: {e}",
                            exc_info=True,
                        )

        logger.info(f"WebSocket disconnected: {id(websocket)}")

    #
    # subscribe
    #
    async def subscribe(self, websocket: WebSocket, connection_id: str, path: str) -> bool:
        """Subscribe a WebSocket to directory changes and start SMB monitoring"""

        current_user = self.users.get(websocket)
        if current_user is None:
            logger.warning(f"Rejected unauthenticated WebSocket subscription: {id(websocket)}")
            return False

        key = f"{connection_id}:{path}"

        try:
            conn_uuid = uuid.UUID(connection_id)
        except ValueError:
            logger.error(f"Invalid connection_id format: {connection_id}")
            return False

        try:
            with DBSession(engine) as session:
                conn = get_accessible_connection_or_404(session, current_user, conn_uuid)
        except HTTPException:
            logger.warning(f"Rejected unauthorized WebSocket subscription: user={current_user.username}, connection_id={connection_id}")
            return False

        if websocket in self.subscriptions:
            self.subscriptions[websocket].add(key)

        # Track this WebSocket for notifications
        is_new_subscription = key not in self.active_connections
        if key not in self.active_connections:
            self.active_connections[key] = set()
        self.active_connections[key].add(websocket)

        logger.info(f"WebSocket {id(websocket)} subscribed to {key}")

        # Start SMB monitoring if this is the first subscriber for this directory
        if is_new_subscription:
            try:
                # Resolve the monitoring path by applying path_prefix.
                # The user-facing path is relative to the prefix, but
                # the SMB monitor must watch the real directory on the
                # share (prefix + user path).
                prefix = SMBBackend._normalize_prefix(conn.path_prefix)
                if prefix and path:
                    resolved_path = f"{prefix}/{path}"
                elif prefix:
                    resolved_path = prefix
                else:
                    resolved_path = path

                # Remember the resolved path so unsubscribe can stop
                # the correct monitor.
                self._resolved_paths[key] = resolved_path
                share_name = conn.share_name
                assert share_name is not None

                # Start monitoring with callback to notify WebSocket clients
                monitor = get_monitor()
                monitor.start_monitoring(
                    connection_id=connection_id,
                    path=resolved_path,
                    host=conn.host,
                    share_name=share_name,
                    username=conn.username,
                    password=decrypt_password(conn.password_encrypted),
                    port=conn.port or 445,
                    on_change_callback=self._make_change_callback(connection_id, path),
                )
                logger.info(f"Started SMB monitoring for {key} (resolved: {resolved_path})")
            except Exception as e:
                logger.error(f"Failed to start SMB monitoring for {key}: {e}", exc_info=True)

        return True

    #
    # unsubscribe
    #
    async def unsubscribe(self, websocket: WebSocket, connection_id: str, path: str) -> None:
        """Unsubscribe a WebSocket from directory changes and stop SMB monitoring if last subscriber"""

        key = f"{connection_id}:{path}"

        if websocket in self.subscriptions:
            self.subscriptions[websocket].discard(key)

        if key in self.active_connections:
            self.active_connections[key].discard(websocket)

            # If no more subscribers, stop SMB monitoring
            if not self.active_connections[key]:
                del self.active_connections[key]
                try:
                    monitor = get_monitor()
                    resolved = self._resolved_paths.pop(key, path)
                    monitor.stop_monitoring(connection_id, resolved)
                    logger.info(f"Stopped SMB monitoring for {key}")
                except Exception as e:
                    logger.error(f"Failed to stop SMB monitoring for {key}: {e}", exc_info=True)

        logger.info(f"WebSocket {id(websocket)} unsubscribed from {key}")

    #
    # _make_change_callback
    #
    def _make_change_callback(self, connection_id: str, user_path: str) -> "Callable[[str, str], Awaitable[None]]":
        """Create a change callback that maps the resolved path back to the user-facing path.

        The SMB monitor watches the resolved path (with path_prefix applied),
        but subscribers are keyed by the user-facing path. This closure ensures
        the notification is sent with the user-facing path so it matches the
        subscription key and the frontend's current path.
        """

        async def _callback(_conn_id: str, _resolved_path: str) -> None:
            await self.notify_directory_change(connection_id, user_path)

        return _callback

    #
    # notify_directory_change
    #
    async def notify_directory_change(self, connection_id: str, path: str) -> None:
        """Notify all subscribers about a directory change"""

        key = f"{connection_id}:{path}"

        if key in self.active_connections:
            disconnected = []
            for websocket in self.active_connections[key]:
                try:
                    await websocket.send_json(
                        {
                            "type": "directory_changed",
                            "connection_id": connection_id,
                            "path": path,
                        }
                    )
                    logger.info(f"Notified WebSocket {id(websocket)} about change in {key}")
                except Exception as e:
                    logger.error(f"Failed to notify WebSocket {id(websocket)}: {e}")
                    disconnected.append(websocket)

            # Clean up disconnected WebSockets
            for ws in disconnected:
                self.disconnect(ws)

    #
    # broadcast_transfer_progress
    #
    async def broadcast_transfer_progress(
        self,
        connection_id: str,
        path: str,
        bytes_transferred: int,
        total_bytes: int | None,
        item_name: str,
    ) -> None:
        """Broadcast byte-level transfer progress to all WebSocket clients
        subscribed to the parent directory of *path*.

        Used during cross-connection copy/move to provide real-time
        progress updates in the UI.

        Args:
            connection_id: The connection whose directory the transfer
                targets.
            path: The parent directory path (matches subscription keys).
            bytes_transferred: Bytes written so far for the current file.
            total_bytes: Total file size (``None`` if unknown).
            item_name: Human-readable filename being transferred.
        """

        key = f"{connection_id}:{path}"
        if key not in self.active_connections:
            return

        payload = {
            "type": "transfer_progress",
            "connection_id": connection_id,
            "path": path,
            "bytes_transferred": bytes_transferred,
            "total_bytes": total_bytes,
            "item_name": item_name,
        }

        disconnected: list[WebSocket] = []
        for websocket in self.active_connections[key]:
            try:
                await websocket.send_json(payload)
            except Exception:
                disconnected.append(websocket)

        for ws in disconnected:
            self.disconnect(ws)


# Global connection manager instance
manager = ConnectionManager()


#
# websocket_endpoint
#
@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for real-time directory change notifications.

    Client sends:
    - {"action": "subscribe", "connection_id": "uuid", "path": "/some/path"}
    - {"action": "unsubscribe", "connection_id": "uuid", "path": "/some/path"}

    Server sends:
    - {"type": "directory_changed", "connection_id": "uuid", "path": "/some/path"}
    """

    token = websocket.query_params.get("token")

    with DBSession(engine) as session:
        try:
            current_user = await get_current_user_for_token(token, session)
        except HTTPException:
            await websocket.close(code=1008, reason="Not authenticated")
            return

    await manager.connect(websocket, current_user)

    try:
        while True:
            # Receive messages from client
            data = await websocket.receive_json()
            action = data.get("action")
            connection_id = data.get("connection_id")
            path = data.get("path", "")

            if action == "subscribe" and connection_id:
                if await manager.subscribe(websocket, connection_id, path):
                    await websocket.send_json({"type": "subscribed", "connection_id": connection_id, "path": path})
                else:
                    await websocket.send_json({"type": "error", "message": "Connection not found or access denied"})

            elif action == "unsubscribe" and connection_id:
                await manager.unsubscribe(websocket, connection_id, path)
                await websocket.send_json(
                    {
                        "type": "unsubscribed",
                        "connection_id": connection_id,
                        "path": path,
                    }
                )

            elif action == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected normally: {id(websocket)}")
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
        manager.disconnect(websocket)


# Helper function to trigger notifications (to be called when files change)
async def notify_change(connection_id: str, path: str) -> None:
    """Notify clients about a directory change"""
    await manager.notify_directory_change(connection_id, path)


async def notify_transfer_progress(
    connection_id: str,
    path: str,
    bytes_transferred: int,
    total_bytes: int | None,
    item_name: str,
) -> None:
    """Broadcast byte-level transfer progress to subscribed clients."""
    await manager.broadcast_transfer_progress(
        connection_id,
        path,
        bytes_transferred,
        total_bytes,
        item_name,
    )
