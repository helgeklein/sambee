"""
Tests for WebSocket endpoints and real-time directory change notifications.

This module tests:
- WebSocket connection management
- Subscription/unsubscription to directories
- Directory change notifications
- SMB monitoring integration
- Error handling and edge cases
- Concurrent connections and thread safety
"""

import uuid
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class WebSocketClient:
    """Helper class to manage WebSocket test client connections."""

    def __init__(self, ws):
        self.ws = ws
        self.received_messages: List[dict] = []

    def send_json(self, data: dict):
        """Send JSON data to WebSocket."""
        self.ws.send_json(data)

    def receive_json(self) -> dict:
        """Receive JSON data from WebSocket."""
        msg = self.ws.receive_json()
        self.received_messages.append(msg)
        return msg

    def subscribe(self, connection_id: str, path: str = ""):
        """Send subscribe action."""
        self.send_json(
            {"action": "subscribe", "connection_id": connection_id, "path": path}
        )
        return self.receive_json()

    def unsubscribe(self, connection_id: str, path: str = ""):
        """Send unsubscribe action."""
        self.send_json(
            {"action": "unsubscribe", "connection_id": connection_id, "path": path}
        )
        return self.receive_json()

    def ping(self):
        """Send ping."""
        self.send_json({"action": "ping"})
        return self.receive_json()


class TestWebSocketConnection:
    """Test WebSocket connection management."""

    def test_websocket_connection_success(self, client):
        """Test successful WebSocket connection."""
        with client.websocket_connect("/api/ws") as websocket:
            # Connection established successfully
            assert websocket is not None

            # Send ping to verify connection is alive
            websocket.send_json({"action": "ping"})
            response = websocket.receive_json()
            assert response["type"] == "pong"

    def test_websocket_multiple_connections(self, client):
        """Test multiple concurrent WebSocket connections."""
        with client.websocket_connect("/api/ws") as ws1:
            with client.websocket_connect("/api/ws") as ws2:
                # Both connections should be active
                ws1.send_json({"action": "ping"})
                response1 = ws1.receive_json()
                assert response1["type"] == "pong"

                ws2.send_json({"action": "ping"})
                response2 = ws2.receive_json()
                assert response2["type"] == "pong"

    def test_websocket_disconnect(self, client):
        """Test WebSocket disconnection cleanup."""
        ws = client.websocket_connect("/api/ws")
        websocket = ws.__enter__()

        # Verify connection works
        websocket.send_json({"action": "ping"})
        response = websocket.receive_json()
        assert response["type"] == "pong"

        # Close connection
        ws.__exit__(None, None, None)

        # Connection should be closed
        # (cleanup is handled automatically by ConnectionManager)


class TestSubscriptionManagement:
    """Test directory subscription and unsubscription."""

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_subscribe_to_directory(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test subscribing to a directory for change notifications."""
        # Mock the monitor
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        # Mock database session to return our test connection
        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)

            # Subscribe to a directory
            response = ws_client.subscribe(str(test_connection.id), "/documents")

            # Verify response
            assert response["type"] == "subscribed"
            assert response["connection_id"] == str(test_connection.id)
            assert response["path"] == "/documents"

            # Verify SMB monitoring was started
            mock_monitor.start_monitoring.assert_called_once()

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_subscribe_multiple_directories(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test subscribing to multiple directories."""
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)

            # Subscribe to multiple directories
            response1 = ws_client.subscribe(str(test_connection.id), "/documents")
            assert response1["type"] == "subscribed"
            assert response1["path"] == "/documents"

            response2 = ws_client.subscribe(str(test_connection.id), "/images")
            assert response2["type"] == "subscribed"
            assert response2["path"] == "/images"

            # Both should trigger monitoring
            assert mock_monitor.start_monitoring.call_count == 2

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_unsubscribe_from_directory(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test unsubscribing from a directory."""
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)

            # Subscribe first
            ws_client.subscribe(str(test_connection.id), "/documents")

            # Now unsubscribe
            response = ws_client.unsubscribe(str(test_connection.id), "/documents")

            # Verify response
            assert response["type"] == "unsubscribed"
            assert response["connection_id"] == str(test_connection.id)
            assert response["path"] == "/documents"

            # Verify SMB monitoring was stopped (last subscriber)
            mock_monitor.stop_monitoring.assert_called_once()

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_multiple_clients_same_directory(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test multiple clients subscribing to the same directory."""
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as ws1:
            with client.websocket_connect("/api/ws") as ws2:
                client1 = WebSocketClient(ws1)
                client2 = WebSocketClient(ws2)

                # Both subscribe to same directory
                client1.subscribe(str(test_connection.id), "/shared")
                client2.subscribe(str(test_connection.id), "/shared")

                # SMB monitoring should only start once
                assert mock_monitor.start_monitoring.call_count == 1

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_last_subscriber_stops_monitoring(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test that monitoring stops when last subscriber unsubscribes."""
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as ws1:
            with client.websocket_connect("/api/ws") as ws2:
                client1 = WebSocketClient(ws1)
                client2 = WebSocketClient(ws2)

                # Both subscribe
                client1.subscribe(str(test_connection.id), "/shared")
                client2.subscribe(str(test_connection.id), "/shared")

                # First unsubscribe - monitoring should continue
                client1.unsubscribe(str(test_connection.id), "/shared")
                assert mock_monitor.stop_monitoring.call_count == 0

                # Second unsubscribe - monitoring should stop
                client2.unsubscribe(str(test_connection.id), "/shared")
                mock_monitor.stop_monitoring.assert_called_once()


class TestDirectoryMonitoringIntegration:
    """Test integration with SMB directory monitoring."""

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_monitoring_starts_with_connection_details(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test that SMB monitoring starts with correct connection details."""
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)
            ws_client.subscribe(str(test_connection.id), "/documents")

            # Verify monitoring was called with correct parameters
            mock_monitor.start_monitoring.assert_called_once()
            call_kwargs = mock_monitor.start_monitoring.call_args[1]

            assert call_kwargs["connection_id"] == str(test_connection.id)
            assert call_kwargs["path"] == "/documents"
            assert call_kwargs["host"] == test_connection.host
            assert call_kwargs["share_name"] == test_connection.share_name
            assert call_kwargs["username"] == test_connection.username
            assert "password" in call_kwargs
            assert "on_change_callback" in call_kwargs

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_invalid_connection_id_format(
        self, mock_db_session, mock_get_monitor, client
    ):
        """Test handling of invalid connection ID format."""
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)

            # Subscribe with invalid UUID
            response = ws_client.subscribe("not-a-valid-uuid", "/documents")

            # Should still get subscribed response (error logged internally)
            assert response["type"] == "subscribed"

            # Monitoring should not start with invalid UUID
            mock_monitor.start_monitoring.assert_not_called()

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_nonexistent_connection_id(self, mock_db_session, mock_get_monitor, client):
        """Test handling of non-existent connection ID."""
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        # Mock database to return None (connection not found)
        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = None
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)

            fake_id = str(uuid.uuid4())
            response = ws_client.subscribe(fake_id, "/documents")

            # Should get subscribed response (error logged)
            assert response["type"] == "subscribed"

            # Monitoring should not start
            mock_monitor.start_monitoring.assert_not_called()

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_connection_without_share_name(
        self, mock_db_session, mock_get_monitor, client, session
    ):
        """Test handling of connection without share name."""
        from app.models.connection import Connection

        # Create connection without share
        connection = Connection(
            name="No Share",
            host="server.local",
            share_name=None,
            username="user",
            password_encrypted="encrypted",
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        # Mock database to return connection without share
        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)

            response = ws_client.subscribe(str(connection.id), "/documents")
            assert response["type"] == "subscribed"

            # Monitoring should not start without share name
            mock_monitor.start_monitoring.assert_not_called()

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_monitoring_startup_failure(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test handling of SMB monitoring startup failures."""
        mock_monitor = MagicMock()
        mock_monitor.start_monitoring.side_effect = Exception("SMB connection failed")
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)

            # Should still subscribe even if monitoring fails
            response = ws_client.subscribe(str(test_connection.id), "/documents")
            assert response["type"] == "subscribed"


class TestChangeNotifications:
    """Test directory change notification broadcasting."""

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_notify_single_subscriber(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test notifying a single subscriber about directory changes."""
        from app.api.websocket import manager

        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)
            ws_client.subscribe(str(test_connection.id), "/documents")

            # Simulate a directory change notification
            import asyncio

            asyncio.run(
                manager.notify_directory_change(str(test_connection.id), "/documents")
            )

            # Client should receive notification
            notification = ws_client.receive_json()
            assert notification["type"] == "directory_changed"
            assert notification["connection_id"] == str(test_connection.id)
            assert notification["path"] == "/documents"

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_notify_multiple_subscribers(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test notifying multiple subscribers about the same change."""
        from app.api.websocket import manager

        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as ws1:
            with client.websocket_connect("/api/ws") as ws2:
                client1 = WebSocketClient(ws1)
                client2 = WebSocketClient(ws2)

                # Both subscribe to same directory
                client1.subscribe(str(test_connection.id), "/shared")
                client2.subscribe(str(test_connection.id), "/shared")

                # Trigger notification
                import asyncio

                asyncio.run(
                    manager.notify_directory_change(str(test_connection.id), "/shared")
                )

                # Both clients should receive notification
                notif1 = client1.receive_json()
                notif2 = client2.receive_json()

                assert notif1["type"] == "directory_changed"
                assert notif2["type"] == "directory_changed"
                assert notif1["path"] == "/shared"
                assert notif2["path"] == "/shared"

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_subscription_filtering(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test that notifications are filtered by subscription."""
        from app.api.websocket import manager

        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)

            # Subscribe to /documents only
            ws_client.subscribe(str(test_connection.id), "/documents")

            # Trigger notification for /images (not subscribed)
            import asyncio

            asyncio.run(
                manager.notify_directory_change(str(test_connection.id), "/images")
            )

            # Client should NOT receive notification
            # (would timeout if trying to receive)
            # Instead, send a ping to verify connection is still alive
            ping_response = ws_client.ping()
            assert ping_response["type"] == "pong"


class TestErrorHandling:
    """Test error handling and edge cases."""

    def test_invalid_json_message(self, client):
        """Test handling of invalid JSON messages."""
        with client.websocket_connect("/api/ws"):
            # This should cause an error but not crash the server
            # FastAPI's TestClient handles this gracefully
            pass

    def test_malformed_subscription_request(self, client):
        """Test handling of malformed subscription requests."""
        with client.websocket_connect("/api/ws") as websocket:
            # Send action without required fields
            websocket.send_json({"action": "subscribe"})

            # Server should handle gracefully (no connection_id means no action)
            # Connection should still be alive
            websocket.send_json({"action": "ping"})
            response = websocket.receive_json()
            assert response["type"] == "pong"

    def test_unknown_action(self, client):
        """Test handling of unknown action types."""
        with client.websocket_connect("/api/ws") as websocket:
            # Send unknown action
            websocket.send_json({"action": "unknown_action"})

            # Connection should still be alive
            websocket.send_json({"action": "ping"})
            response = websocket.receive_json()
            assert response["type"] == "pong"

    @patch("app.api.websocket.get_monitor")
    def test_disconnect_cleanup(self, mock_get_monitor, client):
        """Test that disconnect properly cleans up subscriptions."""
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        # Create and close connection
        ws_context = client.websocket_connect("/api/ws")
        websocket = ws_context.__enter__()

        # Send ping to establish connection
        websocket.send_json({"action": "ping"})
        websocket.receive_json()

        # Close
        ws_context.__exit__(None, None, None)

        # Cleanup happens automatically in ConnectionManager.disconnect()

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_notification_to_disconnected_client(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test handling of notifications to disconnected clients."""

        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        # Note: This test is limited by TestClient's WebSocket implementation
        # In production, failed sends would trigger cleanup
        # This is more of a structural test


class TestConcurrency:
    """Test concurrent operations and thread safety."""

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_multiple_clients_multiple_directories(
        self,
        mock_db_session,
        mock_get_monitor,
        client,
        test_connection,
        multiple_connections,
    ):
        """Test multiple clients subscribing to multiple directories."""
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        # Mock to return appropriate connection
        def get_connection(query):
            result = MagicMock()
            # Return test_connection for simplicity
            result.first.return_value = test_connection
            return result

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.side_effect = lambda q: get_connection(q)
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as ws1:
            with client.websocket_connect("/api/ws") as ws2:
                client1 = WebSocketClient(ws1)
                client2 = WebSocketClient(ws2)

                # Client 1 subscribes to multiple directories
                client1.subscribe(str(test_connection.id), "/dir1")
                client1.subscribe(str(test_connection.id), "/dir2")

                # Client 2 subscribes to different directories
                client2.subscribe(str(test_connection.id), "/dir3")
                client2.subscribe(str(test_connection.id), "/dir4")

                # All should succeed
                assert len(client1.received_messages) >= 2
                assert len(client2.received_messages) >= 2

    @patch("app.api.websocket.get_monitor")
    @patch("sqlmodel.Session")
    def test_rapid_subscribe_unsubscribe(
        self, mock_db_session, mock_get_monitor, client, test_connection
    ):
        """Test rapid subscription and unsubscription cycles."""
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        mock_session_instance = MagicMock()
        mock_session_instance.__enter__.return_value = mock_session_instance
        mock_session_instance.__exit__.return_value = None
        mock_session_instance.exec.return_value.first.return_value = test_connection
        mock_db_session.return_value = mock_session_instance

        with client.websocket_connect("/api/ws") as websocket:
            ws_client = WebSocketClient(websocket)

            # Rapid subscribe/unsubscribe cycles
            for i in range(5):
                ws_client.subscribe(str(test_connection.id), f"/dir{i}")
                ws_client.unsubscribe(str(test_connection.id), f"/dir{i}")

            # Connection should still be healthy
            response = ws_client.ping()
            assert response["type"] == "pong"


class TestConnectionManager:
    """Test ConnectionManager class directly."""

    def test_connection_manager_initialization(self):
        """Test ConnectionManager initialization."""
        from app.api.websocket import ConnectionManager

        manager = ConnectionManager()
        assert manager.active_connections == {}
        assert manager.subscriptions == {}

    @pytest.mark.asyncio
    async def test_connection_manager_connect(self):
        """Test ConnectionManager connect method."""
        from app.api.websocket import ConnectionManager

        manager = ConnectionManager()
        mock_ws = AsyncMock()

        await manager.connect(mock_ws)

        # WebSocket should be accepted and added to subscriptions
        mock_ws.accept.assert_called_once()
        assert mock_ws in manager.subscriptions
        assert manager.subscriptions[mock_ws] == set()

    def test_connection_manager_disconnect(self):
        """Test ConnectionManager disconnect method."""
        from app.api.websocket import ConnectionManager

        manager = ConnectionManager()
        mock_ws = MagicMock()

        # Add websocket to subscriptions
        manager.subscriptions[mock_ws] = set()

        # Disconnect
        manager.disconnect(mock_ws)

        # Should be removed from subscriptions
        assert mock_ws not in manager.subscriptions
