"""Tests for authenticated WebSocket subscriptions and connection authorization."""

from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest
from starlette.websockets import WebSocketDisconnect

import app.api.websocket as websocket_module
from app.api.websocket import manager
from app.models.connection import Connection


class WebSocketClient:
    """Helper wrapper around the Starlette websocket test session."""

    def __init__(self, websocket_session) -> None:
        self.websocket_session = websocket_session

    def send_json(self, payload: dict[str, str]) -> None:
        self.websocket_session.send_json(payload)

    def receive_json(self) -> dict[str, str]:
        return self.websocket_session.receive_json()

    def subscribe(self, connection_id: str, path: str = "") -> dict[str, str]:
        self.send_json({"action": "subscribe", "connection_id": connection_id, "path": path})
        return self.receive_json()

    def unsubscribe(self, connection_id: str, path: str = "") -> dict[str, str]:
        self.send_json({"action": "unsubscribe", "connection_id": connection_id, "path": path})
        return self.receive_json()

    def ping(self) -> dict[str, str]:
        self.send_json({"action": "ping"})
        return self.receive_json()


class _SessionContext:
    def __init__(self, session) -> None:
        self._session = session

    def __enter__(self):
        return self._session

    def __exit__(self, exc_type, exc, tb) -> None:
        del exc_type, exc, tb


@pytest.fixture(name="websocket_state")
def websocket_state_fixture(session) -> Generator[None, None, None]:
    """Bind websocket DB access to the per-test SQLModel session and clear global state."""

    original_db_session = websocket_module.DBSession
    manager.active_connections.clear()
    manager.subscriptions.clear()
    manager.users.clear()
    manager._resolved_paths.clear()
    websocket_module.DBSession = lambda _engine: _SessionContext(session)

    yield

    manager.active_connections.clear()
    manager.subscriptions.clear()
    manager.users.clear()
    manager._resolved_paths.clear()
    websocket_module.DBSession = original_db_session


def _ws_path(token: str | None) -> str:
    return f"/api/ws?token={token}" if token else "/api/ws"


@pytest.mark.integration
class TestWebSocketAuthentication:
    def test_websocket_requires_authentication(self, client, websocket_state) -> None:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(_ws_path(None)):
                pass

    def test_authenticated_websocket_can_ping(self, client, admin_token: str, websocket_state) -> None:
        with client.websocket_connect(_ws_path(admin_token)) as websocket:
            ws_client = WebSocketClient(websocket)
            assert ws_client.ping() == {"type": "pong"}


@pytest.mark.integration
class TestWebSocketConnectionAuthorization:
    @patch("app.api.websocket.get_monitor")
    def test_regular_user_can_subscribe_to_shared_connection(
        self,
        mock_get_monitor,
        client,
        user_token: str,
        test_connection: Connection,
        websocket_state,
    ) -> None:
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        with client.websocket_connect(_ws_path(user_token)) as websocket:
            ws_client = WebSocketClient(websocket)
            response = ws_client.subscribe(str(test_connection.id), "/documents")

        assert response == {
            "type": "subscribed",
            "connection_id": str(test_connection.id),
            "path": "/documents",
        }
        mock_monitor.start_monitoring.assert_called_once()

    @patch("app.api.websocket.get_monitor")
    def test_regular_user_can_subscribe_to_owned_private_connection(
        self,
        mock_get_monitor,
        client,
        user_token: str,
        user_private_connection: Connection,
        websocket_state,
    ) -> None:
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        with client.websocket_connect(_ws_path(user_token)) as websocket:
            ws_client = WebSocketClient(websocket)
            response = ws_client.subscribe(str(user_private_connection.id), "/private")

        assert response["type"] == "subscribed"
        assert response["connection_id"] == str(user_private_connection.id)
        mock_monitor.start_monitoring.assert_called_once()

    @patch("app.api.websocket.get_monitor")
    def test_regular_user_cannot_subscribe_to_other_private_connection(
        self,
        mock_get_monitor,
        client,
        user_token: str,
        other_private_connection: Connection,
        websocket_state,
    ) -> None:
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        with client.websocket_connect(_ws_path(user_token)) as websocket:
            ws_client = WebSocketClient(websocket)
            response = ws_client.subscribe(str(other_private_connection.id), "/secret")

        assert response == {"type": "error", "message": "Connection not found or access denied"}
        mock_monitor.start_monitoring.assert_not_called()

    @patch("app.api.websocket.get_monitor")
    def test_invalid_connection_id_returns_error(
        self,
        mock_get_monitor,
        client,
        admin_token: str,
        websocket_state,
    ) -> None:
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        with client.websocket_connect(_ws_path(admin_token)) as websocket:
            ws_client = WebSocketClient(websocket)
            response = ws_client.subscribe("not-a-valid-uuid", "/documents")

        assert response == {"type": "error", "message": "Connection not found or access denied"}
        mock_monitor.start_monitoring.assert_not_called()


@pytest.mark.integration
class TestWebSocketMonitoring:
    @patch("app.api.websocket.get_monitor")
    def test_subscribe_resolves_prefix_for_monitor(
        self,
        mock_get_monitor,
        client,
        admin_token: str,
        test_connection: Connection,
        websocket_state,
    ) -> None:
        test_connection.path_prefix = "/photos"
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        with client.websocket_connect(_ws_path(admin_token)) as websocket:
            ws_client = WebSocketClient(websocket)
            response = ws_client.subscribe(str(test_connection.id), "vacation")

        assert response["type"] == "subscribed"
        call_kwargs = mock_monitor.start_monitoring.call_args.kwargs
        assert call_kwargs["path"] == "photos/vacation"

    @patch("app.api.websocket.get_monitor")
    def test_disconnect_stops_monitoring_with_resolved_path(
        self,
        mock_get_monitor,
        client,
        admin_token: str,
        test_connection: Connection,
        websocket_state,
    ) -> None:
        test_connection.path_prefix = "/photos"
        mock_monitor = MagicMock()
        mock_get_monitor.return_value = mock_monitor

        websocket_context = client.websocket_connect(_ws_path(admin_token))
        websocket = websocket_context.__enter__()
        ws_client = WebSocketClient(websocket)
        ws_client.subscribe(str(test_connection.id), "vacation")
        websocket_context.__exit__(None, None, None)

        mock_monitor.stop_monitoring.assert_called_once_with(str(test_connection.id), "photos/vacation")
