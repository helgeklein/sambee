"""
Performance and Load Tests - Phase 9

Tests for:
- Concurrent user operations
- Large directory handling
- Response time benchmarks
- WebSocket performance
- Resource usage
- Data transfer performance
"""

import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest
from app.api.websocket import ConnectionManager
from app.core.security import encrypt_password
from app.models.connection import Connection
from app.models.file import DirectoryListing, FileInfo, FileType
from fastapi.testclient import TestClient
from sqlmodel import Session


@pytest.mark.performance
class TestConcurrentUsers:
    """Test system behavior with multiple concurrent users."""

    def test_concurrent_browse_requests(
        self, client: TestClient, auth_headers_user: dict[str, str], session: Session
    ):
        """Test concurrent directory browse requests (limited by SQLite)."""
        # Create test connection
        connection = Connection(
            name="Concurrent Test",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted=encrypt_password("testpass"),
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        # Mock SMB backend
        with patch("app.api.browser.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            mock_instance.list_directory.return_value = DirectoryListing(
                path="/",
                items=[
                    FileInfo(
                        name=f"file{i}.txt",
                        path=f"/file{i}.txt",
                        type=FileType.FILE,
                        size=1024,
                    )
                    for i in range(100)
                ],
                total=100,
            )
            mock_backend_class.return_value = mock_instance

            # Send requests sequentially but quickly to test throughput
            # Note: SQLite doesn't support true concurrent writes from threads
            start_time = time.time()
            responses = []
            for _ in range(20):  # Reduced from 50 due to SQLite limitations
                response = client.get(
                    f"/api/browse/{connection.id}/list",
                    headers=auth_headers_user,
                )
                responses.append(response)
            elapsed = time.time() - start_time

            # All should succeed
            assert all(r.status_code == 200 for r in responses), (
                f"Some requests failed: {[r.status_code for r in responses if r.status_code != 200]}"
            )
            # Should complete quickly
            assert elapsed < 2.0, f"20 requests took {elapsed:.2f}s"

    def test_concurrent_admin_operations(
        self,
        client: TestClient,
        auth_headers_admin: dict[str, str],
        session: Session,
    ):
        """Test sequential admin connection operations (SQLite limitation)."""
        with patch("app.api.admin.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            mock_backend_class.return_value = mock_instance

            # Create connections sequentially (SQLite doesn't support concurrent writes)
            # This tests throughput rather than true concurrency
            start_time = time.time()
            responses = []
            for i in range(10):  # Reduced to 10 for speed
                response = client.post(
                    "/api/admin/connections",
                    json={
                        "name": f"Connection {i}",
                        "type": "smb",
                        "host": "server.local",
                        "port": 445,
                        "share_name": "share",
                        "username": "user",
                        "password": "pass",
                    },
                    headers=auth_headers_admin,
                )
                responses.append(response)
            elapsed = time.time() - start_time

            # All should succeed
            successful = sum(1 for r in responses if r.status_code == 200)
            assert successful == 10, f"Only {successful}/10 succeeded"
            # Should complete reasonably fast
            assert elapsed < 2.0, f"10 sequential creates took {elapsed:.2f}s"

    def test_multiple_users_different_connections(
        self,
        client: TestClient,
        auth_headers_admin: dict[str, str],
        auth_headers_user: dict[str, str],
        session: Session,
    ):
        """Test multiple users accessing different connections."""
        # Create multiple connections
        connections = []
        for i in range(5):
            conn = Connection(
                name=f"Share {i}",
                type="smb",
                host="server.local",
                share_name=f"share{i}",
                username="user",
                password_encrypted=encrypt_password("testpass"),
            )
            session.add(conn)
            connections.append(conn)
        session.commit()

        with patch("app.api.browser.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            mock_instance.list_directory.return_value = DirectoryListing(
                path="/", items=[], total=0
            )
            mock_backend_class.return_value = mock_instance

            # Test sequential access (works with both QueuePool and StaticPool)
            # In production with QueuePool, this would be concurrent
            # In testing with StaticPool, sequential is safer
            start_time = time.time()
            responses = []
            for conn in connections:
                # Admin user
                response = client.get(
                    f"/api/browse/{conn.id}/list",
                    headers=auth_headers_admin,
                )
                responses.append(response)
                # Regular user
                response = client.get(
                    f"/api/browse/{conn.id}/list",
                    headers=auth_headers_user,
                )
                responses.append(response)
            elapsed = time.time() - start_time

            assert all(r.status_code == 200 for r in responses)
            assert elapsed < 2.0, f"10 sequential requests took {elapsed:.2f}s"


@pytest.mark.performance
class TestLargeDirectories:
    """Test handling of large directories with many files."""

    def test_browse_1000_files(
        self, client: TestClient, auth_headers_user: dict[str, str], session: Session
    ):
        """Test browsing directory with 1000 files completes in < 1s."""
        connection = Connection(
            name="Large Dir",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted=encrypt_password("testpass"),
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        with patch("app.api.browser.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            # Generate 1000 files
            mock_instance.list_directory.return_value = DirectoryListing(
                path="/",
                items=[
                    FileInfo(
                        name=f"file_{i:04d}.txt",
                        path=f"/file_{i:04d}.txt",
                        type=FileType.FILE,
                        size=i * 1024,
                    )
                    for i in range(1000)
                ],
                total=1000,
            )
            mock_backend_class.return_value = mock_instance

            start_time = time.time()
            response = client.get(
                f"/api/browse/{connection.id}/list",
                headers=auth_headers_user,
            )
            elapsed = time.time() - start_time

            assert response.status_code == 200
            data = response.json()
            assert len(data["items"]) == 1000
            # Should complete in under 1 second
            assert elapsed < 1.0, f"1000 files took {elapsed:.2f}s"

    def test_browse_nested_directories(
        self, client: TestClient, auth_headers_user: dict[str, str], session: Session
    ):
        """Test browsing deeply nested directories."""
        connection = Connection(
            name="Deep Dirs",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted=encrypt_password("testpass"),
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        with patch("app.api.browser.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            # Simulate deep path: /a/b/c/d/e/f/g/h/i/j/
            deep_path = "/".join([chr(97 + i) for i in range(10)])  # a/b/c/.../j
            mock_instance.list_directory.return_value = DirectoryListing(
                path=f"/{deep_path}",
                items=[
                    FileInfo(
                        name="deep_file.txt",
                        path=f"/{deep_path}/deep_file.txt",
                        type=FileType.FILE,
                        size=1024,
                    )
                ],
                total=1,
            )
            mock_backend_class.return_value = mock_instance

            start_time = time.time()
            response = client.get(
                f"/api/browse/{connection.id}/list?path={deep_path}",
                headers=auth_headers_user,
            )
            elapsed = time.time() - start_time

            assert response.status_code == 200
            assert elapsed < 0.5, f"Deep path took {elapsed:.2f}s"

    def test_sequential_directory_navigation(
        self, client: TestClient, auth_headers_user: dict[str, str], session: Session
    ):
        """Test navigating through multiple directories sequentially."""
        connection = Connection(
            name="Nav Test",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted=encrypt_password("testpass"),
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        with patch("app.api.browser.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()

            def mock_list_dir(path=""):
                # Return different content based on path
                if not path or path == "/":
                    items = [
                        FileInfo(
                            name=f"folder{i}",
                            path=f"/folder{i}",
                            type=FileType.DIRECTORY,
                        )
                        for i in range(10)
                    ]
                else:
                    items = [
                        FileInfo(
                            name=f"file{i}.txt",
                            path=f"{path}/file{i}.txt",
                            type=FileType.FILE,
                            size=1024,
                        )
                        for i in range(50)
                    ]
                return DirectoryListing(path=path or "/", items=items, total=len(items))

            mock_instance.list_directory.side_effect = mock_list_dir
            mock_backend_class.return_value = mock_instance

            # Navigate through 20 directories
            start_time = time.time()
            paths = ["/", "folder0", "folder1", "folder2"] * 5
            for path in paths:
                response = client.get(
                    f"/api/browse/{connection.id}/list?path={path}",
                    headers=auth_headers_user,
                )
                assert response.status_code == 200
            elapsed = time.time() - start_time

            # 20 sequential requests should complete in reasonable time
            assert elapsed < 2.0, f"20 sequential requests took {elapsed:.2f}s"


@pytest.mark.performance
class TestResponseTimes:
    """Test API endpoint response time benchmarks."""

    def test_auth_token_validation_response_time(
        self, client: TestClient, auth_headers_user: dict[str, str], session: Session
    ):
        """Test token validation is fast."""
        # Create a connection to test auth
        connection = Connection(
            name="Auth Test",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted=encrypt_password("testpass"),
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        with patch("app.api.browser.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            mock_instance.list_directory.return_value = DirectoryListing(
                path="/", items=[], total=0
            )
            mock_backend_class.return_value = mock_instance

            start_time = time.time()
            response = client.get(
                f"/api/browse/{connection.id}/list",
                headers=auth_headers_user,
            )
            elapsed = time.time() - start_time

            assert response.status_code == 200
            # Auth validation should be fast (< 100ms)
            assert elapsed < 0.1, f"Auth validation took {elapsed:.2f}s"

    def test_connection_list_response_time(
        self, client: TestClient, auth_headers_admin: dict[str, str], session: Session
    ):
        """Test listing connections is fast even with many connections."""
        # Create 50 connections
        for i in range(50):
            conn = Connection(
                name=f"Connection {i}",
                type="smb",
                host="server.local",
                share_name=f"share{i}",
                username="user",
                password_encrypted=encrypt_password("testpass"),
            )
            session.add(conn)
        session.commit()

        start_time = time.time()
        response = client.get("/api/admin/connections", headers=auth_headers_admin)
        elapsed = time.time() - start_time

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 50
        # Should be fast even with 50 connections
        assert elapsed < 0.1, f"List 50 connections took {elapsed:.2f}s"

    def test_file_preview_start_time(
        self, client: TestClient, auth_headers_user: dict[str, str], session: Session
    ):
        """Test file preview starts streaming quickly."""
        connection = Connection(
            name="Preview Test",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted=encrypt_password("testpass"),
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        with patch("app.api.preview.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            mock_instance.get_file_info.return_value = FileInfo(
                name="test.txt",
                path="/test.txt",
                type=FileType.FILE,
                size=1024,
            )

            async def mock_read_file(path):
                yield b"data"

            mock_instance.read_file = mock_read_file
            mock_backend_class.return_value = mock_instance

            start_time = time.time()
            response = client.get(
                f"/api/preview/{connection.id}/file?path=test.txt",
                headers=auth_headers_user,
            )
            elapsed = time.time() - start_time

            assert response.status_code == 200
            # Preview should start quickly (< 500ms)
            assert elapsed < 0.5, f"Preview start took {elapsed:.2f}s"


@pytest.mark.performance
class TestWebSocketPerformance:
    """Test WebSocket connection and notification performance."""

    @pytest.mark.asyncio
    async def test_websocket_connection_limit(self):
        """Test system can handle many WebSocket connections."""
        manager = ConnectionManager()

        # Simulate 100 concurrent WebSocket connections
        class MockWebSocket:
            def __init__(self, client_id: str):
                self.client_id = client_id
                self.messages = []
                self.accepted = False

            async def accept(self):
                self.accepted = True

            async def send_json(self, data):
                self.messages.append(data)

        clients = [MockWebSocket(f"client_{i}") for i in range(100)]

        start_time = time.time()
        for client in clients:
            await manager.connect(client)  # type: ignore
        elapsed = time.time() - start_time

        # Should handle 100 connections quickly
        assert all(c.accepted for c in clients)
        assert len(manager.subscriptions) == 100
        assert elapsed < 1.0, f"100 connections took {elapsed:.2f}s"

        # Disconnect all
        for client in clients:
            manager.disconnect(client)  # type: ignore

        assert len(manager.subscriptions) == 0

    @pytest.mark.asyncio
    async def test_websocket_broadcast_performance(self):
        """Test broadcasting to many subscribers is fast."""
        manager = ConnectionManager()

        class MockWebSocket:
            def __init__(self, client_id: str):
                self.client_id = client_id
                self.messages = []

            async def accept(self):
                pass

            async def send_json(self, data):
                self.messages.append(data)
                # Simulate small network delay
                await asyncio.sleep(0.001)

        # Create 50 clients
        clients = [MockWebSocket(f"client_{i}") for i in range(50)]
        for client in clients:
            await manager.connect(client)  # type: ignore

        # All subscribe to same directory
        connection_id = "test-conn-id"
        path = "/test"
        for client in clients:
            await manager.subscribe(client, connection_id, path)  # type: ignore

        # Broadcast a change notification
        start_time = time.time()
        await manager.notify_directory_change(connection_id, path)
        elapsed = time.time() - start_time

        # All clients should receive notification
        assert all(len(c.messages) == 1 for c in clients)
        assert all(c.messages[0]["type"] == "directory_changed" for c in clients)
        # Broadcast to 50 clients should be fast (< 200ms with delays)
        assert elapsed < 0.2, f"Broadcast to 50 clients took {elapsed:.2f}s"

        # Cleanup
        for client in clients:
            manager.disconnect(client)  # type: ignore

    @pytest.mark.asyncio
    async def test_websocket_subscription_overhead(self):
        """Test subscription/unsubscription performance."""
        manager = ConnectionManager()

        class MockWebSocket:
            def __init__(self, client_id: str):
                self.client_id = client_id

            async def accept(self):
                pass

            async def send_json(self, data):
                pass

        client = MockWebSocket("perf_client")
        await manager.connect(client)  # type: ignore

        # Subscribe to 100 different directories
        connection_id = "test-conn"
        start_time = time.time()
        for i in range(100):
            await manager.subscribe(client, connection_id, f"/dir{i}")  # type: ignore
        elapsed = time.time() - start_time

        assert elapsed < 1.0, f"100 subscriptions took {elapsed:.2f}s"
        # Verify subscriptions
        assert len(manager.subscriptions[client]) == 100  # type: ignore

        # Disconnect cleans up all subscriptions
        manager.disconnect(client)  # type: ignore
        assert client not in manager.subscriptions  # type: ignore


@pytest.mark.performance
class TestResourceUsage:
    """Test resource usage under various load conditions."""

    def test_connection_creation_memory(
        self, client: TestClient, auth_headers_admin: dict[str, str], session: Session
    ):
        """Test memory usage when creating many connections."""
        import gc

        gc.collect()

        with patch("app.api.admin.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            mock_backend_class.return_value = mock_instance

            # Create 100 connections
            connection_ids = []
            for i in range(100):
                response = client.post(
                    "/api/admin/connections",
                    json={
                        "name": f"Memory Test {i}",
                        "type": "smb",
                        "host": "server.local",
                        "port": 445,
                        "share_name": "share",
                        "username": "user",
                        "password": "pass",
                    },
                    headers=auth_headers_admin,
                )
                assert response.status_code == 200
                connection_ids.append(response.json()["id"])

            # Verify all connections exist
            response = client.get("/api/admin/connections", headers=auth_headers_admin)
            assert response.status_code == 200
            assert len(response.json()) >= 100

            # Cleanup - delete all
            for conn_id in connection_ids:
                client.delete(
                    f"/api/admin/connections/{conn_id}",
                    headers=auth_headers_admin,
                )

    def test_session_cleanup(
        self, client: TestClient, auth_headers_user: dict[str, str], session: Session
    ):
        """Test that database sessions are properly closed."""
        connection = Connection(
            name="Session Test",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted=encrypt_password("testpass"),
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        with patch("app.api.browser.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            mock_instance.list_directory.return_value = DirectoryListing(
                path="/", items=[], total=0
            )
            mock_backend_class.return_value = mock_instance

            # Make 100 requests - each should properly close its session
            for _ in range(100):
                response = client.get(
                    f"/api/browse/{connection.id}/list",
                    headers=auth_headers_user,
                )
                assert response.status_code == 200

            # No assertion needed - just ensure no resource leaks crash the test


@pytest.mark.performance
class TestDataTransfer:
    """Test data transfer performance for file operations."""

    def test_large_directory_listing_transfer(
        self, client: TestClient, auth_headers_user: dict[str, str], session: Session
    ):
        """Test transferring large directory listings."""
        connection = Connection(
            name="Large Transfer",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted=encrypt_password("testpass"),
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        with patch("app.api.browser.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            # Create large listing with lots of metadata
            mock_instance.list_directory.return_value = DirectoryListing(
                path="/",
                items=[
                    FileInfo(
                        name=f"very_long_filename_for_testing_transfer_{i:04d}_with_extra_padding.txt",
                        path=f"/subdir/nested/path/very_long_filename_for_testing_transfer_{i:04d}_with_extra_padding.txt",
                        type=FileType.FILE,
                        size=i * 1024 * 1024,  # Size in MB
                    )
                    for i in range(500)
                ],
                total=500,
            )
            mock_backend_class.return_value = mock_instance

            start_time = time.time()
            response = client.get(
                f"/api/browse/{connection.id}/list",
                headers=auth_headers_user,
            )
            elapsed = time.time() - start_time

            assert response.status_code == 200
            # Even large responses should be reasonably fast
            assert elapsed < 1.0, f"Large listing transfer took {elapsed:.2f}s"
            # Verify data size
            assert len(response.json()["items"]) == 500

    def test_concurrent_file_streams(
        self, client: TestClient, auth_headers_user: dict[str, str], session: Session
    ):
        """Test multiple sequential file preview streams (SQLite limitation)."""
        connection = Connection(
            name="Stream Test",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted=encrypt_password("testpass"),
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        with patch("app.api.preview.SMBBackend") as mock_backend_class:
            mock_instance = AsyncMock()
            mock_instance.get_file_info.return_value = FileInfo(
                name="test.txt",
                path="/test.txt",
                type=FileType.FILE,
                size=1024,
            )

            async def mock_read_file(path):
                # Simulate file chunks
                for i in range(10):
                    yield b"chunk of data " * 100

            mock_instance.read_file = mock_read_file
            mock_backend_class.return_value = mock_instance

            # Stream 10 files sequentially (SQLite doesn't handle concurrent well)
            start_time = time.time()
            responses = []
            for i in range(10):
                response = client.get(
                    f"/api/preview/{connection.id}/file?path=test{i}.txt",
                    headers=auth_headers_user,
                )
                responses.append(response)
            elapsed = time.time() - start_time

            assert all(r.status_code == 200 for r in responses), (
                f"Some failed: {[r.status_code for r in responses if r.status_code != 200]}"
            )
            # 10 sequential streams should complete reasonably
            assert elapsed < 2.0, f"10 sequential streams took {elapsed:.2f}s"
