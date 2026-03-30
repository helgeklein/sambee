import pytest
from fastapi import HTTPException

from app.models.connection import ConnectionAccessMode
from app.services.connection_access import (
    READ_ONLY_CONNECTION_DETAIL,
    READ_ONLY_USER_DETAIL,
    get_effective_connection_access,
    require_connection_write_access,
)


class TestEffectiveConnectionAccess:
    def test_read_write_connection_allows_write(self, admin_user, test_connection):
        access = get_effective_connection_access(admin_user, test_connection)

        assert access.access_mode == ConnectionAccessMode.READ_WRITE
        assert access.allows_write is True
        assert access.source == "connection_access_mode"

    def test_read_only_connection_blocks_write(self, admin_user, read_only_connection):
        access = get_effective_connection_access(admin_user, read_only_connection)

        assert access.access_mode == ConnectionAccessMode.READ_ONLY
        assert access.allows_write is False
        assert access.source == "connection_access_mode"

    def test_viewer_user_blocks_write_on_writable_connection(self, viewer_user, test_connection):
        access = get_effective_connection_access(viewer_user, test_connection)

        assert access.access_mode == ConnectionAccessMode.READ_ONLY
        assert access.allows_write is False
        assert access.source == "user_role"


class TestRequireConnectionWriteAccess:
    def test_returns_access_for_writable_connection(self, regular_user, test_connection):
        access = require_connection_write_access(regular_user, test_connection, action="rename", path="docs/readme.md")

        assert access.access_mode == ConnectionAccessMode.READ_WRITE
        assert access.allows_write is True

    def test_raises_for_read_only_connection(self, regular_user, read_only_connection):
        with pytest.raises(HTTPException) as exc_info:
            require_connection_write_access(regular_user, read_only_connection, action="delete", path="docs/readme.md")

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == READ_ONLY_CONNECTION_DETAIL

    def test_raises_for_viewer_user_even_on_writable_connection(self, viewer_user, test_connection):
        with pytest.raises(HTTPException) as exc_info:
            require_connection_write_access(viewer_user, test_connection, action="rename", path="docs/readme.md")

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == READ_ONLY_USER_DETAIL
