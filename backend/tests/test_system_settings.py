from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine, select
from sqlmodel.pool import StaticPool

import app.db.database as database_module
from app.core.system_setting_definitions import SystemSettingKey
from app.models.connection import Connection
from app.models.oidc import OidcFlow, OidcFlowPurpose, OidcFlowStatus, OidcProviderConfiguration
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
        assert data["architecture"]
        assert data["python_runtime"]
        assert "database_version" not in data
        assert {"containerized", "environment", "hostname", "mounts", "network", "operating_system"}.isdisjoint(data)

    def test_regular_user_cannot_fetch_about_information(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.get("/api/admin/settings/about", headers=auth_headers_user)

        assert response.status_code == 403


class TestPublicSupportReportApi:
    def test_admin_can_fetch_public_safe_report(self, client: TestClient, auth_headers_admin: dict[str, str], session: Session) -> None:
        public_url = "https://files.northwind.example"
        trusted_proxy = "10.42.0.0/16"
        issuer_url = "https://login.northwind.example/tenant-a"
        client_id = "northwind-sambee-client"
        client_secret = "northwind-oidc-super-secret"
        group_name = "Northwind-Administrators"
        connection_name = "Northwind Finance"
        connection_host = "fileserver.northwind.internal"
        connection_share = "Finance"
        connection_username = "northwind-service"
        connection_password = "encrypted-northwind-password"

        session.add_all(
            [
                SystemSetting(key="network.public_url", value=public_url),
                SystemSetting(key="network.trusted_proxy_cidrs", value=trusted_proxy),
                SystemSetting(key="auth.mode", value="oidc_or_password"),
                OidcProviderConfiguration(
                    display_name="Northwind Identity",
                    issuer_url=issuer_url,
                    client_id=client_id,
                    encrypted_client_secret=client_secret,
                    scopes_json='["openid", "northwind.files.read"]',
                    admission_groups_json=f'["{group_name}"]',
                    role_mappings_json=f'{{"admin":["{group_name}"],"editor":[],"viewer":[]}}',
                ),
                Connection(
                    name=connection_name,
                    host=connection_host,
                    share_name=connection_share,
                    username=connection_username,
                    password_encrypted=connection_password,
                ),
            ]
        )
        session.commit()

        response = client.get("/api/admin/settings/support-report", headers=auth_headers_admin)

        assert response.status_code == 200
        report = response.json()["content"]
        assert "# Sambee public support report" in report
        assert 'public_url = "https://public-endpoint-1.invalid"' in report
        assert 'trusted_proxy_cidrs = ["ipv4-network-1/16"]' in report
        assert 'oidc.provider = "oidc-provider-1"' in report
        assert 'oidc.issuer_url = "https://oidc-provider-1.invalid/oidc-provider-path-1"' in report
        assert 'oidc.client_id = "oidc-client-1"' in report
        assert 'oidc.admission_groups = ["oidc-group-1"]' in report
        assert 'oidc.role_mappings.admin = ["oidc-group-1"]' in report
        assert "total = 1 # source: ui" in report
        assert 'by_type = {"smb": 1} # source: ui' in report

        for sensitive_value in (
            public_url,
            trusted_proxy,
            issuer_url,
            client_id,
            client_secret,
            group_name,
            connection_name,
            connection_host,
            connection_share,
            connection_username,
            connection_password,
        ):
            assert sensitive_value not in report

    def test_regular_user_cannot_fetch_public_support_report(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.get("/api/admin/settings/support-report", headers=auth_headers_user)

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
        stored_public_url = session.get(SystemSetting, "network.public_url")
        assert stored_public_url is not None
        assert stored_public_url.value == "https://files.example.test"

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
