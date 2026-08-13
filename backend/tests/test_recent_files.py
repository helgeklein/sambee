from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.models.connection import Connection
from app.models.file import FileInfo, FileType


class TestRecentFilesApi:
    @pytest.fixture(autouse=True)
    def mock_remote_target(self, monkeypatch: MonkeyPatch) -> None:
        import app.api.browser as browser_api

        class TargetBackend:
            async def connect(self) -> None:
                return None

            async def disconnect(self) -> None:
                return None

            async def get_file_info(self, path: str) -> FileInfo:
                return FileInfo(name=path.rsplit("/", 1)[-1], path=path, type=FileType.FILE)

        monkeypatch.setattr(browser_api, "build_smb_backend", lambda *_args, **_kwargs: TargetBackend())

    def test_records_searches_and_removes_a_recent_file(
        self, client: TestClient, auth_headers_user: dict[str, str], test_connection: Connection
    ) -> None:
        record_response = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": str(test_connection.id), "path": "reports/Quarterly Summary.pdf", "is_regular_file": True},
        )

        assert record_response.status_code == 200
        record = record_response.json()
        assert record["file_name"] == "Quarterly Summary.pdf"

        search_response = client.get("/api/browse/recent-files", headers=auth_headers_user, params={"q": "quarterly"})
        assert search_response.status_code == 200
        assert [result["id"] for result in search_response.json()["results"]] == [record["id"]]

        remove_response = client.delete(f"/api/browse/recent-files/{record['id']}", headers=auth_headers_user)
        assert remove_response.status_code == 204
        assert client.get("/api/browse/recent-files", headers=auth_headers_user).json()["results"] == []

    def test_matches_filename_only_and_ranks_exact_before_prefix(
        self, client: TestClient, auth_headers_user: dict[str, str], test_connection: Connection
    ) -> None:
        for path in ("archive/report-final.txt", "Report.txt", "notes/report.txt", "exact/report"):
            response = client.post(
                "/api/browse/recent-files",
                headers=auth_headers_user,
                json={"connection_id": str(test_connection.id), "path": path, "is_regular_file": True},
            )
            assert response.status_code == 200

        response = client.get("/api/browse/recent-files", headers=auth_headers_user, params={"q": "report"})
        assert response.status_code == 200
        assert [result["file_name"] for result in response.json()["results"]] == ["report", "report.txt", "Report.txt", "report-final.txt"]

        path_only = client.get("/api/browse/recent-files", headers=auth_headers_user, params={"q": "archive"})
        assert path_only.status_code == 200
        assert path_only.json()["results"] == []

    def test_default_exclusions_and_local_drive_records(
        self, client: TestClient, auth_headers_user: dict[str, str], test_connection: Connection
    ) -> None:
        image = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": str(test_connection.id), "path": "logo.png", "is_regular_file": True},
        )
        temporary = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": str(test_connection.id), "path": "~$draft.docx", "is_regular_file": True},
        )
        local = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": "Documents/report.txt", "is_regular_file": True},
        )

        assert image.status_code == 200 and image.json() is None
        assert temporary.status_code == 200 and temporary.json() is None
        assert local.status_code == 200
        assert client.get("/api/browse/recent-files", headers=auth_headers_user).json()["results"][0]["connection_id"] == "local-drive:c"

    def test_normalizes_paths_rejects_unsafe_paths_and_upserts_existing_records(
        self, client: TestClient, auth_headers_user: dict[str, str]
    ) -> None:
        first = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": r"Documents\Résumé.txt", "is_regular_file": True},
        )
        second = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": "Documents/Résumé.txt", "is_regular_file": True},
        )

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["id"] == second.json()["id"]
        assert second.json()["path"] == "Documents/Résumé.txt"

        for invalid_path, expected_status in (
            ("", 422),
            ("/absolute.txt", 400),
            ("../outside.txt", 400),
            ("Documents//duplicate.txt", 400),
        ):
            response = client.post(
                "/api/browse/recent-files",
                headers=auth_headers_user,
                json={"connection_id": "local-drive:c", "path": invalid_path, "is_regular_file": True},
            )
            assert response.status_code == expected_status

        assert len(client.get("/api/browse/recent-files", headers=auth_headers_user).json()["results"]) == 1

    def test_matches_diacritic_insensitively_and_prefers_word_boundary_matches(
        self, client: TestClient, auth_headers_user: dict[str, str]
    ) -> None:
        for path in ("Documents/cafe-resume.txt", "Documents/Résumé.txt"):
            response = client.post(
                "/api/browse/recent-files",
                headers=auth_headers_user,
                json={"connection_id": "local-drive:c", "path": path, "is_regular_file": True},
            )
            assert response.status_code == 200

        response = client.get("/api/browse/recent-files", headers=auth_headers_user, params={"q": "resume"})

        assert response.status_code == 200
        assert [record["file_name"] for record in response.json()["results"]] == ["Résumé.txt", "cafe-resume.txt"]

    def test_rejects_a_remote_directory_before_recording(
        self, client: TestClient, auth_headers_user: dict[str, str], test_connection: Connection, monkeypatch: MonkeyPatch
    ) -> None:
        import app.api.browser as browser_api

        class DirectoryBackend:
            async def connect(self) -> None:
                return None

            async def disconnect(self) -> None:
                return None

            async def get_file_info(self, path: str) -> FileInfo:
                return FileInfo(name="Documents", path=path, type=FileType.DIRECTORY)

        monkeypatch.setattr(browser_api, "build_smb_backend", lambda *_args, **_kwargs: DirectoryBackend())

        response = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": str(test_connection.id), "path": "Documents", "is_regular_file": True},
        )

        assert response.status_code == 400
        assert client.get("/api/browse/recent-files", headers=auth_headers_user).json()["results"] == []

    def test_records_are_private_to_the_current_user(
        self,
        client: TestClient,
        auth_headers_user: dict[str, str],
        auth_headers_admin: dict[str, str],
        test_connection: Connection,
    ) -> None:
        response = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": str(test_connection.id), "path": "private.txt", "is_regular_file": True},
        )
        assert response.status_code == 200

        admin_results = client.get("/api/browse/recent-files", headers=auth_headers_admin)
        assert admin_results.status_code == 200
        assert admin_results.json()["results"] == []

    def test_does_not_delete_another_users_recent_record(
        self,
        client: TestClient,
        auth_headers_user: dict[str, str],
        auth_headers_admin: dict[str, str],
    ) -> None:
        record = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": "private.txt", "is_regular_file": True},
        ).json()

        response = client.delete(f"/api/browse/recent-files/{record['id']}", headers=auth_headers_admin)

        assert response.status_code == 404
        assert [entry["id"] for entry in client.get("/api/browse/recent-files", headers=auth_headers_user).json()["results"]] == [
            record["id"]
        ]

    def test_validation_removes_a_confirmed_missing_target(
        self, client: TestClient, auth_headers_user: dict[str, str], test_connection: Connection, monkeypatch: MonkeyPatch
    ) -> None:
        import app.api.browser as browser_api

        class MissingTargetBackend:
            async def connect(self) -> None:
                return None

            async def disconnect(self) -> None:
                return None

            async def get_file_info(self, path: str) -> FileInfo:
                raise FileNotFoundError(path)

        record = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": str(test_connection.id), "path": "deleted.txt", "is_regular_file": True},
        ).json()

        monkeypatch.setattr(browser_api, "build_smb_backend", lambda *_args, **_kwargs: MissingTargetBackend())

        response = client.get(f"/api/browse/recent-files/{record['id']}/target", headers=auth_headers_user)

        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "recent_file_target_missing"
        assert client.get("/api/browse/recent-files", headers=auth_headers_user).json()["results"] == []

    def test_validation_preserves_a_target_when_connection_is_unavailable(
        self, client: TestClient, auth_headers_user: dict[str, str], test_connection: Connection, monkeypatch: MonkeyPatch
    ) -> None:
        import app.api.browser as browser_api

        class UnavailableTargetBackend:
            async def connect(self) -> None:
                raise ConnectionError("offline")

            async def disconnect(self) -> None:
                return None

        record = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": str(test_connection.id), "path": "kept.txt", "is_regular_file": True},
        ).json()

        monkeypatch.setattr(browser_api, "build_smb_backend", lambda *_args, **_kwargs: UnavailableTargetBackend())

        response = client.get(f"/api/browse/recent-files/{record['id']}/target", headers=auth_headers_user)

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "recent_file_validation_transient"
        assert [entry["id"] for entry in client.get("/api/browse/recent-files", headers=auth_headers_user).json()["results"]] == [
            record["id"]
        ]

    def test_validation_returns_authoritative_file_info(
        self, client: TestClient, auth_headers_user: dict[str, str], test_connection: Connection, monkeypatch: MonkeyPatch
    ) -> None:
        import app.api.browser as browser_api

        class TargetBackend:
            async def connect(self) -> None:
                return None

            async def disconnect(self) -> None:
                return None

            async def get_file_info(self, path: str) -> FileInfo:
                return FileInfo(name="report.pdf", path=path, type=FileType.FILE, mime_type="application/pdf")

        record = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": str(test_connection.id), "path": "report.pdf", "is_regular_file": True},
        ).json()

        monkeypatch.setattr(browser_api, "build_smb_backend", lambda *_args, **_kwargs: TargetBackend())

        response = client.get(f"/api/browse/recent-files/{record['id']}/target", headers=auth_headers_user)

        assert response.status_code == 200
        assert response.json()["mime_type"] == "application/pdf"


class TestFileSearchSettingsApi:
    def test_admin_reads_updates_and_resets_file_search_policy(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        initial = client.get("/api/admin/settings/file-search", headers=auth_headers_admin)
        assert initial.status_code == 200
        assert initial.json()["source"] == "default"

        update = client.put(
            "/api/admin/settings/file-search",
            headers=auth_headers_admin,
            json={
                "settings": {
                    "retention_limit": 2,
                    "result_limit": 1,
                    "excluded_categories": ["images", "temporary_backup"],
                    "excluded_extensions": ["bak"],
                }
            },
        )
        assert update.status_code == 200
        assert update.json()["source"] == "database"
        assert update.json()["settings"]["excluded_extensions"] == [".bak"]

        reset = client.put("/api/admin/settings/file-search", headers=auth_headers_admin, json={"reset_to_default": True})
        assert reset.status_code == 200
        assert reset.json()["source"] == "default"

    def test_policy_clamps_results_trims_history_and_does_not_retroactively_exclude(
        self,
        client: TestClient,
        auth_headers_admin: dict[str, str],
        auth_headers_user: dict[str, str],
    ) -> None:
        initial_record = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": "historical.txt", "is_regular_file": True},
        )
        assert initial_record.status_code == 200

        update = client.put(
            "/api/admin/settings/file-search",
            headers=auth_headers_admin,
            json={
                "settings": {
                    "retention_limit": 2,
                    "result_limit": 1,
                    "excluded_categories": ["images", "temporary_backup"],
                    "excluded_extensions": ["txt"],
                }
            },
        )
        assert update.status_code == 200

        excluded_record = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": "future.txt", "is_regular_file": True},
        )
        assert excluded_record.status_code == 200
        assert excluded_record.json() is None

        results = client.get("/api/browse/recent-files", headers=auth_headers_user, params={"q": "txt", "limit": 50})
        assert results.status_code == 200
        assert results.json()["result_limit"] == 1
        assert [record["file_name"] for record in results.json()["results"]] == ["historical.txt"]

        reduced = client.put(
            "/api/admin/settings/file-search",
            headers=auth_headers_admin,
            json={
                "settings": {
                    "retention_limit": 0,
                    "result_limit": 1,
                    "excluded_categories": ["images", "temporary_backup"],
                    "excluded_extensions": ["txt"],
                }
            },
        )
        assert reduced.status_code == 200
        assert client.get("/api/browse/recent-files", headers=auth_headers_user).json()["results"] == []

    def test_admin_updates_policy_and_zero_retention_clears_history(
        self,
        client: TestClient,
        auth_headers_admin: dict[str, str],
        auth_headers_user: dict[str, str],
        test_connection: Connection,
    ) -> None:
        assert (
            client.post(
                "/api/browse/recent-files",
                headers=auth_headers_user,
                json={"connection_id": "local-drive:c", "path": "kept.txt", "is_regular_file": True},
            ).status_code
            == 200
        )

        update = client.put(
            "/api/admin/settings/file-search",
            headers=auth_headers_admin,
            json={
                "settings": {
                    "retention_limit": 0,
                    "result_limit": 10,
                    "excluded_categories": ["images", "temporary_backup"],
                    "excluded_extensions": ["bak"],
                }
            },
        )
        assert update.status_code == 200
        assert update.json()["settings"]["retention_limit"] == 0
        assert client.get("/api/browse/recent-files", headers=auth_headers_user).json()["results"] == []

        disabled_record = client.post(
            "/api/browse/recent-files",
            headers=auth_headers_user,
            json={"connection_id": "local-drive:c", "path": "disabled.txt", "is_regular_file": True},
        )
        assert disabled_record.status_code == 200
        assert disabled_record.json() is None

    def test_regular_user_cannot_manage_file_search_settings(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        assert client.get("/api/admin/settings/file-search", headers=auth_headers_user).status_code == 403
