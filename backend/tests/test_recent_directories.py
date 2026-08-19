from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlmodel import Session

from app.models.connection import Connection
from app.models.file import FileInfo, FileType
from app.models.recent_directory import RecentDirectory
from app.models.user import User
from app.services import recent_directories


class TestRecentDirectoriesApi:
    @pytest.fixture(autouse=True)
    def mock_remote_target(self, monkeypatch: MonkeyPatch) -> None:
        import app.api.browser as browser_api

        class TargetBackend:
            async def connect(self) -> None:
                return None

            async def disconnect(self) -> None:
                return None

            async def get_file_info(self, path: str) -> FileInfo:
                return FileInfo(name=path.rsplit("/", 1)[-1], path=path, type=FileType.DIRECTORY)

        monkeypatch.setattr(browser_api, "build_smb_backend", lambda *_args, **_kwargs: TargetBackend())

    def test_records_searches_removes_and_clears_recent_directories(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        first = client.post(
            "/api/browse/recent-directories",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": "Documents/Reports", "is_directory": True},
        )
        second = client.post(
            "/api/browse/recent-directories",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": "Projects/2026", "is_directory": True},
        )

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["path"] == "Documents/Reports"

        search = client.get("/api/browse/recent-directories", headers=auth_headers_user, params={"q": "project"})
        assert search.status_code == 200
        assert [record["id"] for record in search.json()["results"]] == [second.json()["id"]]

        remove = client.delete(f"/api/browse/recent-directories/{first.json()['id']}", headers=auth_headers_user)
        assert remove.status_code == 204

        clear = client.delete("/api/browse/recent-directories", headers=auth_headers_user)
        assert clear.status_code == 200
        assert clear.json()["deleted_count"] == 1

    def test_normalizes_paths_rejects_unsafe_paths_and_keeps_records_private(
        self, client: TestClient, auth_headers_user: dict[str, str], auth_headers_admin: dict[str, str]
    ) -> None:
        first = client.post(
            "/api/browse/recent-directories",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": r"Documents\Résumé", "is_directory": True},
        )
        second = client.post(
            "/api/browse/recent-directories",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": "Documents/Résumé", "is_directory": True},
        )
        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["id"] == second.json()["id"]

        for invalid_path, expected_status in (("", 422), ("/absolute", 400), ("../outside", 400), ("Documents//duplicate", 400)):
            response = client.post(
                "/api/browse/recent-directories",
                headers=auth_headers_user,
                json={"connection_id": "local-drive:c", "path": invalid_path, "is_directory": True},
            )
            assert response.status_code == expected_status

        admin_results = client.get("/api/browse/recent-directories", headers=auth_headers_admin)
        assert admin_results.status_code == 200
        assert admin_results.json()["results"] == []

        foreign_remove = client.delete(f"/api/browse/recent-directories/{first.json()['id']}", headers=auth_headers_admin)
        assert foreign_remove.status_code == 404

    def test_rejects_a_remote_file_before_recording(
        self, client: TestClient, auth_headers_user: dict[str, str], test_connection: Connection, monkeypatch: MonkeyPatch
    ) -> None:
        import app.api.browser as browser_api

        class FileBackend:
            async def connect(self) -> None:
                return None

            async def disconnect(self) -> None:
                return None

            async def get_file_info(self, path: str) -> FileInfo:
                return FileInfo(name="report.txt", path=path, type=FileType.FILE)

        monkeypatch.setattr(browser_api, "build_smb_backend", lambda *_args, **_kwargs: FileBackend())

        response = client.post(
            "/api/browse/recent-directories",
            headers=auth_headers_user,
            json={"connection_id": str(test_connection.id), "path": "Reports", "is_directory": True},
        )

        assert response.status_code == 400


class TestRecentDirectoryService:
    def test_upserts_normalizes_matches_and_trims_each_users_history(
        self, session: Session, regular_user: User, monkeypatch: MonkeyPatch
    ) -> None:
        monkeypatch.setattr(recent_directories, "DEFAULT_RECENT_DIRECTORY_RETENTION_LIMIT", 2)

        first = recent_directories.record_recent_directory(
            connection_id="local-drive:c", path="Café\\Résumé", current_user=regular_user, session=session
        )
        recent_directories.record_recent_directory(
            connection_id="local-drive:c", path="Projects", current_user=regular_user, session=session
        )
        refreshed_first = recent_directories.record_recent_directory(
            connection_id="local-drive:c", path="Caf\u00e9/R\u00e9sum\u00e9", current_user=regular_user, session=session
        )
        recent_directories.record_recent_directory(
            connection_id="local-drive:c", path="Archive", current_user=regular_user, session=session
        )

        assert refreshed_first.id == first.id
        assert [
            record.path
            for record in recent_directories.search_recent_directories(
                query="resume", limit=100, current_user=regular_user, session=session
            )
        ] == ["Caf\u00e9/R\u00e9sum\u00e9"]
        assert [
            record.path
            for record in recent_directories.search_recent_directories(query="", limit=100, current_user=regular_user, session=session)
        ] == [
            "Archive",
            "Caf\u00e9/R\u00e9sum\u00e9",
        ]

    def test_filters_inaccessible_connections_and_bounds_results(
        self, session: Session, regular_user: User, other_private_connection: Connection
    ) -> None:
        session.add(
            RecentDirectory(
                user_id=regular_user.id,
                connection_id=str(other_private_connection.id),
                path="Private",
            )
        )
        for index in range(55):
            session.add(
                RecentDirectory(
                    user_id=regular_user.id,
                    connection_id="local-drive:c",
                    path=f"Directory {index}",
                )
            )
        session.commit()

        results = recent_directories.search_recent_directories(query="", limit=100, current_user=regular_user, session=session)

        assert len(results) == recent_directories.MAX_RECENT_DIRECTORY_RESULTS
        assert all(record.path != "Private" for record in results)

    def test_refuses_to_remove_another_users_record(self, session: Session, regular_user: User, admin_user: User) -> None:
        record = recent_directories.record_recent_directory(
            connection_id="local-drive:c", path="Private", current_user=regular_user, session=session
        )

        with pytest.raises(HTTPException, match="Recent directory not found"):
            recent_directories.remove_recent_directory(record_id=record.id, current_user=admin_user, session=session)
