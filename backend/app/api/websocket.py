"""WebSocket endpoints for real-time directory updates"""

import logging
from typing import Dict, Set

from app.services.directory_monitor import get_monitor
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()


class ConnectionManager:
    """Manages WebSocket connections and directory subscriptions"""

    def __init__(self) -> None:
        # Map: connection_id -> set of WebSocket connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # Map: WebSocket -> set of subscribed directory paths
        self.subscriptions: Dict[WebSocket, Set[str]] = {}

    async def connect(self, websocket: WebSocket) -> None:
        """Accept a new WebSocket connection"""
        await websocket.accept()
        self.subscriptions[websocket] = set()
        logger.info(f"WebSocket connected: {id(websocket)}")

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection and its subscriptions"""
        # Get all subscriptions for this WebSocket before removing
        subscriptions_to_remove = []
        if websocket in self.subscriptions:
            subscriptions_to_remove = list(self.subscriptions[websocket])
            del self.subscriptions[websocket]

        # Remove from active_connections and stop monitoring if last subscriber
        for key in subscriptions_to_remove:
            if key in self.active_connections:
                self.active_connections[key].discard(websocket)

                if not self.active_connections[key]:
                    del self.active_connections[key]
                    # Stop SMB monitoring
                    try:
                        connection_id, path = key.split(":", 1)
                        monitor = get_monitor()
                        monitor.stop_monitoring(connection_id, path)
                        logger.info(
                            f"Stopped SMB monitoring for {key} (last subscriber disconnected)"
                        )
                    except Exception as e:
                        logger.error(
                            f"Failed to stop SMB monitoring for {key}: {e}",
                            exc_info=True,
                        )

        logger.info(f"WebSocket disconnected: {id(websocket)}")

    async def subscribe(
        self, websocket: WebSocket, connection_id: str, path: str
    ) -> None:
        """Subscribe a WebSocket to directory changes and start SMB monitoring"""
        key = f"{connection_id}:{path}"

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
                # Get connection details from database
                import uuid

                from app.core.security import decrypt_password
                from app.db.database import engine
                from app.models.connection import Connection as SMBConnection
                from sqlmodel import Session as DBSession
                from sqlmodel import select

                # Convert string UUID to UUID object
                try:
                    conn_uuid = uuid.UUID(connection_id)
                except ValueError:
                    logger.error(f"Invalid connection_id format: {connection_id}")
                    return

                with DBSession(engine) as session:
                    conn = session.exec(
                        select(SMBConnection).where(SMBConnection.id == conn_uuid)
                    ).first()

                    if conn and conn.share_name:
                        # Start monitoring with callback to notify WebSocket clients
                        monitor = get_monitor()
                        monitor.start_monitoring(
                            connection_id=connection_id,
                            path=path,
                            host=conn.host,
                            share_name=conn.share_name,
                            username=conn.username,
                            password=decrypt_password(conn.password_encrypted),
                            port=conn.port or 445,
                            on_change_callback=self.notify_directory_change,
                        )
                        logger.info(f"Started SMB monitoring for {key}")
                    else:
                        logger.warning(
                            f"Connection {connection_id} not found or invalid"
                        )
            except Exception as e:
                logger.error(
                    f"Failed to start SMB monitoring for {key}: {e}", exc_info=True
                )

    async def unsubscribe(
        self, websocket: WebSocket, connection_id: str, path: str
    ) -> None:
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
                    monitor.stop_monitoring(connection_id, path)
                    logger.info(f"Stopped SMB monitoring for {key}")
                except Exception as e:
                    logger.error(
                        f"Failed to stop SMB monitoring for {key}: {e}", exc_info=True
                    )

        logger.info(f"WebSocket {id(websocket)} unsubscribed from {key}")

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
                    logger.info(
                        f"Notified WebSocket {id(websocket)} about change in {key}"
                    )
                except Exception as e:
                    logger.error(f"Failed to notify WebSocket {id(websocket)}: {e}")
                    disconnected.append(websocket)

            # Clean up disconnected WebSockets
            for ws in disconnected:
                self.disconnect(ws)


# Global connection manager instance
manager = ConnectionManager()


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
    await manager.connect(websocket)

    try:
        while True:
            # Receive messages from client
            data = await websocket.receive_json()
            action = data.get("action")
            connection_id = data.get("connection_id")
            path = data.get("path", "")

            if action == "subscribe" and connection_id:
                await manager.subscribe(websocket, connection_id, path)
                await websocket.send_json(
                    {"type": "subscribed", "connection_id": connection_id, "path": path}
                )

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
