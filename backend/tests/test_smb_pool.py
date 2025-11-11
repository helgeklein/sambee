"""
Tests for SMB Connection Pool

Verifies that SMB connections are properly pooled and reused across requests.
"""

import asyncio
from unittest.mock import patch

import pytest
from app.storage.smb import SMBBackend
from app.storage.smb_pool import SMBConnectionPool, get_connection_pool


@pytest.mark.asyncio
async def test_connection_pool_reuses_connections():
    """Test that connection pool reuses existing connections."""
    pool = SMBConnectionPool()

    with patch("smbclient.register_session") as mock_register:
        # First connection
        async with pool.get_connection(
            host="test-host",
            port=445,
            username="user",
            password="pass",
            share_name="share",
        ):
            pass

        # Should have called register_session once
        assert mock_register.call_count == 1

        # Second connection with same credentials
        async with pool.get_connection(
            host="test-host",
            port=445,
            username="user",
            password="pass",
            share_name="share",
        ):
            pass

        # Should NOT call register_session again (reused)
        assert mock_register.call_count == 1, "Connection should be reused"


@pytest.mark.asyncio
async def test_connection_pool_reference_counting():
    """Test that reference counting works correctly."""
    pool = SMBConnectionPool()

    with patch("smbclient.register_session"):
        # Acquire connection
        async with pool.get_connection(
            host="test-host",
            port=445,
            username="user",
            password="pass",
            share_name="share",
        ):
            # Check ref count while in use
            stats = pool.get_stats()
            assert stats["total_connections"] == 1
            assert stats["active_connections"] == 1
            assert stats["total_references"] == 1

        # After release, ref count should be 0 but connection still pooled
        stats = pool.get_stats()
        assert stats["total_connections"] == 1
        assert stats["active_connections"] == 0
        assert stats["idle_connections"] == 1


@pytest.mark.asyncio
async def test_connection_pool_nested_acquire():
    """Test that multiple nested acquires increment ref count."""
    pool = SMBConnectionPool()

    with patch("smbclient.register_session"):
        async with pool.get_connection(
            host="test-host",
            port=445,
            username="user",
            password="pass",
            share_name="share",
        ):
            # Nested acquire (same connection)
            async with pool.get_connection(
                host="test-host",
                port=445,
                username="user",
                password="pass",
                share_name="share",
            ):
                stats = pool.get_stats()
                assert stats["total_references"] == 2
                assert stats["active_connections"] == 1  # Still only 1 connection

            # After inner release
            stats = pool.get_stats()
            assert stats["total_references"] == 1

        # After both releases
        stats = pool.get_stats()
        assert stats["total_references"] == 0


@pytest.mark.asyncio
async def test_connection_pool_different_servers():
    """Test that different servers get different connections."""
    pool = SMBConnectionPool()

    with patch("smbclient.register_session") as mock_register:
        # Connection to server 1
        async with pool.get_connection(
            host="server1",
            port=445,
            username="user",
            password="pass",
            share_name="share",
        ):
            pass

        # Connection to server 2 (different host)
        async with pool.get_connection(
            host="server2",
            port=445,
            username="user",
            password="pass",
            share_name="share",
        ):
            pass

        # Should create 2 separate connections
        assert mock_register.call_count == 2

        stats = pool.get_stats()
        assert stats["total_connections"] == 2


@pytest.mark.asyncio
async def test_smb_backend_uses_pool():
    """Test that SMBBackend properly uses the connection pool."""
    backend = SMBBackend(
        host="test-host",
        share_name="test-share",
        username="test-user",
        password="test-pass",
        port=445,
    )

    with (
        patch("smbclient.register_session") as mock_register,
        patch("smbclient.scandir") as mock_scandir,
    ):
        mock_scandir.return_value = []  # Empty directory

        # First request
        await backend.connect()
        await backend.list_directory("/")
        await backend.disconnect()

        # Second request (should reuse connection)
        await backend.connect()
        await backend.list_directory("/another")
        await backend.disconnect()

        # Should only register session once (pooled)
        assert mock_register.call_count == 1, "Connection should be reused from pool"


@pytest.mark.asyncio
async def test_pool_cleanup_removes_idle_connections():
    """Test that cleanup removes idle connections."""
    from datetime import timedelta

    pool = SMBConnectionPool(
        max_idle_time=timedelta(milliseconds=100),  # Very short for testing
    )

    with (
        patch("smbclient.register_session"),
        patch("smbclient.delete_session") as mock_delete,
    ):
        # Create a connection
        async with pool.get_connection(
            host="test-host",
            port=445,
            username="user",
            password="pass",
            share_name="share",
        ):
            pass

        # Connection should be in pool
        stats = pool.get_stats()
        assert stats["total_connections"] == 1

        # Wait for connection to become idle
        await asyncio.sleep(0.15)  # Longer than max_idle_time

        # Run cleanup
        await pool.cleanup_idle_connections()

        # Connection should be removed
        stats = pool.get_stats()
        assert stats["total_connections"] == 0
        assert mock_delete.call_count == 1


@pytest.mark.asyncio
async def test_pool_cleanup_preserves_active_connections():
    """Test that cleanup doesn't remove active connections."""
    from datetime import timedelta

    pool = SMBConnectionPool(
        max_idle_time=timedelta(milliseconds=100),
    )

    with (
        patch("smbclient.register_session"),
        patch("smbclient.delete_session") as mock_delete,
    ):
        async with pool.get_connection(
            host="test-host",
            port=445,
            username="user",
            password="pass",
            share_name="share",
        ):
            # While connection is active, run cleanup
            await asyncio.sleep(0.15)  # Longer than max_idle_time
            await pool.cleanup_idle_connections()

            # Connection should NOT be removed (still in use)
            stats = pool.get_stats()
            assert stats["total_connections"] == 1
            assert stats["active_connections"] == 1
            assert mock_delete.call_count == 0


@pytest.mark.asyncio
async def test_pool_close_all():
    """Test that close_all properly closes all connections."""
    pool = SMBConnectionPool()

    with (
        patch("smbclient.register_session"),
        patch("smbclient.delete_session") as mock_delete,
    ):
        # Create multiple connections
        async with pool.get_connection("host1", 445, "user", "pass", "share"):
            pass
        async with pool.get_connection("host2", 445, "user", "pass", "share"):
            pass

        # Should have 2 connections
        stats = pool.get_stats()
        assert stats["total_connections"] == 2

        # Close all
        await pool.close_all()

        # All connections should be removed
        stats = pool.get_stats()
        assert stats["total_connections"] == 0
        assert mock_delete.call_count == 2


@pytest.mark.asyncio
async def test_global_pool_singleton():
    """Test that get_connection_pool returns singleton instance."""
    pool1 = await get_connection_pool()
    pool2 = await get_connection_pool()

    assert pool1 is pool2, "Should return same instance"
