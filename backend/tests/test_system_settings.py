from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine, select
from sqlmodel.pool import StaticPool

import app.db.database as database_module
from app.core.system_setting_definitions import SystemSettingKey
from app.models.oidc import OidcFlow, OidcFlowPurpose, OidcFlowStatus
from app.models.system_settings import SystemSetting
from app.services.system_settings import get_integer_setting_value
from app.services.system_settings import store as system_settings_store


class TestAboutSettingsApi:
    def test_admin_can_fetch_safe_about_information(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        response = client.get("/api/admin/settings/about", headers=auth_headers_admin)

        assert response.status_code == 200
        data = response.json()
        assert data["version"]
        assert data["started_at"]
        assert data["operating_system"]
        assert data["architecture"]
        assert data["python_version"]
        assert isinstance(data["containerized"], bool)
        assert {"hostname", "environment", "mounts", "network"}.isdisjoint(data)

    def test_regular_user_cannot_fetch_about_information(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.get("/api/admin/settings/about", headers=auth_headers_user)

        assert response.status_code == 403


class TestAdvancedSystemSettingsApi:
    def test_returns_default_when_system_settings_table_is_missing(self, tmp_path: Path, monkeypatch) -> None:
        test_engine = create_engine(
            f"sqlite:///{tmp_path / 'missing-system-settings.db'}",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        try:
            monkeypatch.setattr(database_module, "engine", test_engine)
            system_settings_store._cache = {}
            system_settings_store._loaded = False

            assert get_integer_setting_value(SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES) == 4 * 1024 * 1024
            assert system_settings_store._loaded is False
        finally:
            test_engine.dispose()

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
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["smb"]["read_chunk_size_bytes"]["value"] == 2 * 1024 * 1024
        assert data["smb"]["read_chunk_size_bytes"]["source"] == "database"
        assert data["preprocessors"]["imagemagick"]["timeout_seconds"]["value"] == 45

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


class TestNetworkSettingsApi:
    def test_admin_can_update_network_settings(self, client: TestClient, auth_headers_admin: dict[str, str], session: Session) -> None:
        response = client.put(
            "/api/admin/settings/network",
            headers=auth_headers_admin,
            json={
                "public_url": "https://files.example.test/",
                "trusted_proxy_cidrs": ["10.0.0.4/24", "2001:db8::1/64", "10.0.0.0/24"],
            },
        )

        assert response.status_code == 200
        assert response.json() == {
            "public_url": "https://files.example.test",
            "trusted_proxy_cidrs": ["10.0.0.0/24", "2001:db8::/64"],
        }
        assert session.get(SystemSetting, "network.public_url").value == "https://files.example.test"

    def test_network_settings_reject_public_url_path(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        response = client.put(
            "/api/admin/settings/network",
            headers=auth_headers_admin,
            json={"public_url": "https://files.example.test/sambee", "trusted_proxy_cidrs": []},
        )

        assert response.status_code == 400
        assert "must not include a path" in response.json()["detail"]

    def test_regular_user_cannot_update_network_settings(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.put(
            "/api/admin/settings/network",
            headers=auth_headers_user,
            json={"public_url": "https://files.example.test", "trusted_proxy_cidrs": []},
        )

        assert response.status_code == 403

    def test_public_url_change_invalidates_oidc_flows(
        self, client: TestClient, auth_headers_admin: dict[str, str], session: Session
    ) -> None:
        session.add(
            OidcFlow(
                purpose=OidcFlowPurpose.LOGIN,
                status=OidcFlowStatus.STARTED,
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            )
        )
        session.add(SystemSetting(key="network.public_url", value="https://old.example.test"))
        session.commit()

        response = client.put(
            "/api/admin/settings/network",
            headers=auth_headers_admin,
            json={"public_url": "https://new.example.test", "trusted_proxy_cidrs": []},
        )

        assert response.status_code == 200
        assert session.exec(select(OidcFlow)).first() is None
