"""WebSocket endpoints for real-time directory updates"""

import logging
from typing import Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()


class ConnectionManager:
    """Manages WebSocket connections and directory subscriptions"""

    def __init__(self):
        # Map: connection_id -> set of WebSocket connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # Map: WebSocket -> set of subscribed directory paths
        self.subscriptions: Dict[WebSocket, Set[str]] = {}

    async def connect(self, websocket: WebSocket):
        """Accept a new WebSocket connection"""
        await websocket.accept()
        self.subscriptions[websocket] = set()
        logger.info(f"WebSocket connected: {id(websocket)}")

    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection and its subscriptions"""
        if websocket in self.subscriptions:
            del self.subscriptions[websocket]
        logger.info(f"WebSocket disconnected: {id(websocket)}")

    async def subscribe(self, websocket: WebSocket, connection_id: str, path: str):
        """Subscribe a WebSocket to directory changes"""
        key = f"{connection_id}:{path}"

        if websocket in self.subscriptions:
            self.subscriptions[websocket].add(key)

        if key not in self.active_connections:
            self.active_connections[key] = set()
        self.active_connections[key].add(websocket)

        logger.info(f"WebSocket {id(websocket)} subscribed to {key}")

    async def unsubscribe(self, websocket: WebSocket, connection_id: str, path: str):
        """Unsubscribe a WebSocket from directory changes"""
        key = f"{connection_id}:{path}"

        if websocket in self.subscriptions:
            self.subscriptions[websocket].discard(key)

        if key in self.active_connections:
            self.active_connections[key].discard(websocket)
            if not self.active_connections[key]:
                del self.active_connections[key]

        logger.info(f"WebSocket {id(websocket)} unsubscribed from {key}")

    async def notify_directory_change(self, connection_id: str, path: str):
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
async def websocket_endpoint(websocket: WebSocket):
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
async def notify_change(connection_id: str, path: str):
    """Notify clients about a directory change"""
    await manager.notify_directory_change(connection_id, path)
