from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.system_setting_definitions import SystemSettingKey
from app.models.system_settings import SystemSetting
from app.services.system_settings import get_integer_setting_value
from app.services.system_settings import store as system_settings_store


class TestAdvancedSystemSettingsApi:
    def test_admin_can_fetch_advanced_settings(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        response = client.get("/api/admin/settings/advanced", headers=auth_headers_admin)

        assert response.status_code == 200
        data = response.json()
        assert data["smb"]["read_chunk_size_bytes"]["value"] == 4 * 1024 * 1024
        assert data["smb"]["read_chunk_size_bytes"]["source"] == "default"
        assert data["preprocessors"]["imagemagick"]["timeout_seconds"]["value"] == 30

    def test_regular_user_cannot_fetch_advanced_settings(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.get("/api/admin/settings/advanced", headers=auth_headers_user)

        assert response.status_code == 403

    def test_admin_can_update_advanced_settings(self, client: TestClient, auth_headers_admin: dict[str, str], session: Session) -> None:
        response = client.put(
            "/api/admin/settings/advanced",
            headers=auth_headers_admin,
            json={
                "smb": {"read_chunk_size_bytes": 2 * 1024 * 1024},
                "preprocessors": {
                    "imagemagick": {"timeout_seconds": 45},
                    "graphicsmagick": {"max_file_size_bytes": 200 * 1024 * 1024},
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["smb"]["read_chunk_size_bytes"]["value"] == 2 * 1024 * 1024
        assert data["smb"]["read_chunk_size_bytes"]["source"] == "database"
        assert data["preprocessors"]["imagemagick"]["timeout_seconds"]["value"] == 45
        assert data["preprocessors"]["graphicsmagick"]["max_file_size_bytes"]["value"] == 200 * 1024 * 1024

        stored = session.get(SystemSetting, SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES.value)
        assert stored is not None
        assert stored.value == str(2 * 1024 * 1024)

        system_settings_store.refresh_from_session(session)
        assert get_integer_setting_value(SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES) == 2 * 1024 * 1024

    def test_update_rejects_out_of_range_values(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        response = client.put(
            "/api/admin/settings/advanced",
            headers=auth_headers_admin,
            json={"smb": {"read_chunk_size_bytes": 1}},
        )

        assert response.status_code == 400
        assert "between" in response.json()["detail"]

    def test_admin_can_reset_advanced_setting_override(
        self, client: TestClient, auth_headers_admin: dict[str, str], session: Session
    ) -> None:
        session.add(SystemSetting(key=SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES.value, value=str(2 * 1024 * 1024)))
        session.commit()
        system_settings_store.refresh_from_session(session)

        response = client.put(
            "/api/admin/settings/advanced",
            headers=auth_headers_admin,
            json={"reset_keys": [SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES.value]},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["smb"]["read_chunk_size_bytes"]["value"] == 4 * 1024 * 1024
        assert data["smb"]["read_chunk_size_bytes"]["source"] == "default"

        assert session.get(SystemSetting, SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES.value) is None

        system_settings_store.refresh_from_session(session)
        assert get_integer_setting_value(SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES) == 4 * 1024 * 1024

    def test_update_rejects_conflicting_reset_and_update(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        response = client.put(
            "/api/admin/settings/advanced",
            headers=auth_headers_admin,
            json={
                "smb": {"read_chunk_size_bytes": 2 * 1024 * 1024},
                "reset_keys": [SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES.value],
            },
        )

        assert response.status_code == 400
        assert "Cannot update and reset the same setting" in response.json()["detail"]
