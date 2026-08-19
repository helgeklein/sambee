import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine, select
from sqlmodel.pool import StaticPool

import app.api.system_settings as system_settings_api
import app.db.database as database_module
from app.core.system_setting_definitions import SystemSettingKey
from app.models.connection import Connection
from app.models.oidc import OidcFlow, OidcFlowPurpose, OidcFlowStatus, OidcProviderConfiguration
from app.models.system_settings import SmbPolicySettings, SmbSettingsUpdate, SystemSetting
from app.models.user import User
from app.services.system_settings import (
    SmbPolicyConfigurationError,
    get_integer_setting_value,
    get_smb_policy_settings,
    get_smbclient_policy_kwargs,
    refresh_smb_runtime_policy,
    retire_smb_runtime_policy,
)
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
        assert data["preprocessors"]["imagemagick"]["timeout_seconds"]["value"] == 30
        assert data["pdf"]["screen_derivative_enabled"]["value"] == 0
        assert data["pdf"]["cpu_time_seconds"]["value"] == 60

    def test_regular_user_cannot_fetch_advanced_settings(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.get("/api/admin/settings/advanced", headers=auth_headers_user)

        assert response.status_code == 403

    def test_admin_can_update_advanced_settings(self, client: TestClient, auth_headers_admin: dict[str, str], session: Session) -> None:
        response = client.put(
            "/api/admin/settings/advanced",
            headers=auth_headers_admin,
            json={
                "preprocessors": {
                    "imagemagick": {"timeout_seconds": 45},
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["preprocessors"]["imagemagick"]["timeout_seconds"]["value"] == 45

    def test_admin_can_update_pdf_rollout_and_cpu_limits(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        response = client.put(
            "/api/admin/settings/advanced",
            headers=auth_headers_admin,
            json={"pdf": {"screen_derivative_enabled": 1, "cpu_time_seconds": 45}},
        )

        assert response.status_code == 200
        assert response.json()["pdf"]["screen_derivative_enabled"]["value"] == 1
        assert response.json()["pdf"]["cpu_time_seconds"]["value"] == 45

    def test_update_rejects_out_of_range_values(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        response = client.put(
            "/api/admin/settings/advanced",
            headers=auth_headers_admin,
            json={"preprocessors": {"imagemagick": {"timeout_seconds": 1}}},
        )

        assert response.status_code == 400
        assert "between" in response.json()["detail"]


class TestSmbSettingsApi:
    def test_admin_can_fetch_default_smb_settings(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        response = client.get("/api/admin/settings/smb", headers=auth_headers_admin)

        assert response.status_code == 200
        data = response.json()
        assert data["read_chunk_size_bytes"]["value"] == 4 * 1024 * 1024
        assert data["policy"] == {
            "authentication_mode": "negotiate",
            "encryption_mode": "signing_only",
            "connection_timeout_seconds": 30,
        }
        assert data["require_signing"] is True
        assert data["require_encryption"] is False

    def test_admin_can_update_smb_policy_and_streaming_setting(
        self, client: TestClient, auth_headers_admin: dict[str, str], session: Session
    ) -> None:
        payload = {
            "read_chunk_size_bytes": 2 * 1024 * 1024,
            "policy": {
                "authentication_mode": "kerberos_required",
                "encryption_mode": "encryption_required",
                "connection_timeout_seconds": 45,
            },
        }

        response = client.put("/api/admin/settings/smb", headers=auth_headers_admin, json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["read_chunk_size_bytes"]["value"] == 2 * 1024 * 1024
        assert data["policy_source"] == "database"
        assert data["policy"] == {
            "authentication_mode": "kerberos_required",
            "encryption_mode": "encryption_required",
            "connection_timeout_seconds": 45,
        }
        assert data["require_encryption"] is True
        assert session.get(SystemSetting, SystemSettingKey.SMB_POLICY.value) is not None

    def test_policy_ignores_retired_target_access_fields(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        response = client.put(
            "/api/admin/settings/smb",
            headers=auth_headers_admin,
            json={
                "policy": {
                    "authentication_mode": "negotiate",
                    "enforce_target_allowlist": True,
                    "allowed_target_hostnames": [],
                    "allowed_target_cidrs": [],
                    "allowed_ports": [445],
                    "connection_timeout_seconds": 30,
                }
            },
        )

        assert response.status_code == 200
        assert response.json()["policy"] == {
            "authentication_mode": "negotiate",
            "encryption_mode": "signing_only",
            "connection_timeout_seconds": 30,
        }

    def test_regular_user_cannot_update_smb_settings(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.put("/api/admin/settings/smb", headers=auth_headers_user, json={"reset_policy": True})

        assert response.status_code == 403

    def test_policy_update_retires_existing_smb_runtime_state(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        with patch("app.api.system_settings.refresh_smb_runtime_policy", new_callable=AsyncMock) as mock_refresh:
            response = client.put(
                "/api/admin/settings/smb",
                headers=auth_headers_admin,
                json={"policy": {"authentication_mode": "kerberos_required", "connection_timeout_seconds": 30}},
            )

        assert response.status_code == 200
        mock_refresh.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_policy_update_waits_for_runtime_refresh(self, session: Session, admin_user: User) -> None:
        refresh_started = asyncio.Event()
        allow_refresh_to_finish = asyncio.Event()

        async def wait_for_refresh_completion() -> None:
            refresh_started.set()
            await allow_refresh_to_finish.wait()

        with (
            patch("app.api.system_settings.retire_smb_runtime_policy", new_callable=AsyncMock) as mock_retire,
            patch("app.api.system_settings.refresh_smb_runtime_policy", side_effect=wait_for_refresh_completion) as mock_refresh,
        ):
            update_task = asyncio.create_task(
                system_settings_api.put_smb_settings(
                    SmbSettingsUpdate(policy=SmbPolicySettings(authentication_mode="kerberos_required")),
                    current_user=admin_user,
                    session=session,
                )
            )

            await asyncio.wait_for(refresh_started.wait(), timeout=1)
            assert not update_task.done()

            allow_refresh_to_finish.set()
            response = await update_task

        assert response.policy.authentication_mode == "kerberos_required"
        mock_retire.assert_awaited_once()
        mock_refresh.assert_awaited_once()

    def test_invalid_policy_update_does_not_retire_smb_runtime_state(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        with patch("app.api.system_settings.refresh_smb_runtime_policy", new_callable=AsyncMock) as mock_refresh:
            response = client.put(
                "/api/admin/settings/smb",
                headers=auth_headers_admin,
                json={
                    "policy": {
                        "authentication_mode": "negotiate",
                        "connection_timeout_seconds": 1,
                    }
                },
            )

        assert response.status_code == 422
        mock_refresh.assert_not_awaited()

    def test_read_chunk_update_does_not_refresh_smb_runtime_state(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        with patch("app.api.system_settings.refresh_smb_runtime_policy", new_callable=AsyncMock) as mock_refresh:
            response = client.put(
                "/api/admin/settings/smb",
                headers=auth_headers_admin,
                json={"read_chunk_size_bytes": 2 * 1024 * 1024},
            )

        assert response.status_code == 200
        mock_refresh.assert_not_awaited()

    def test_default_policy_save_does_not_refresh_smb_runtime_state(self, client: TestClient, auth_headers_admin: dict[str, str]) -> None:
        with patch("app.api.system_settings.refresh_smb_runtime_policy", new_callable=AsyncMock) as mock_refresh:
            response = client.put(
                "/api/admin/settings/smb",
                headers=auth_headers_admin,
                json={"policy": {"authentication_mode": "negotiate", "connection_timeout_seconds": 30}},
            )

        assert response.status_code == 200
        mock_refresh.assert_not_awaited()


@pytest.mark.asyncio
async def test_refresh_smb_runtime_policy_restarts_directory_services() -> None:
    cache_manager = MagicMock()
    monitor = MagicMock()
    cache_manager.stop_all_async = AsyncMock()
    monitor.restart_all_async = AsyncMock()

    with (
        patch("app.services.directory_cache.get_directory_cache_manager", return_value=cache_manager),
        patch("app.services.directory_monitor.get_monitor", return_value=monitor),
    ):
        await refresh_smb_runtime_policy()

    cache_manager.stop_all_async.assert_awaited_once()
    monitor.restart_all_async.assert_awaited_once()


@pytest.mark.asyncio
async def test_retire_smb_runtime_policy_retires_contexts_immediately() -> None:
    with patch("app.storage.smb_pool.retire_all_smb_connection_contexts", new_callable=AsyncMock) as mock_retire:
        await retire_smb_runtime_policy()

    mock_retire.assert_awaited_once_with("SMB policy updated")


def test_invalid_persisted_smb_policy_disables_smb_access(monkeypatch) -> None:
    monkeypatch.setattr(system_settings_store, "get_override", lambda key: "not-json")

    with pytest.raises(SmbPolicyConfigurationError):
        get_smb_policy_settings()


def test_smbclient_policy_requires_encryption_only_for_strict_mode() -> None:
    signing_only_policy = SmbPolicySettings()
    strict_policy = SmbPolicySettings(encryption_mode="encryption_required")

    with patch("app.services.system_settings.get_smb_policy_settings", return_value=signing_only_policy):
        assert get_smbclient_policy_kwargs()["encrypt"] is False

    with patch("app.services.system_settings.get_smb_policy_settings", return_value=strict_policy):
        assert get_smbclient_policy_kwargs()["encrypt"] is True


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
