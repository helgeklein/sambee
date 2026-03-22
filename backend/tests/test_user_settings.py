from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.user_setting_definitions import UserSettingKey
from app.models.user_settings import UserSetting


class TestCurrentUserSettingsApi:
    def test_user_gets_default_settings(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.get("/api/auth/me/settings", headers=auth_headers_user)

        assert response.status_code == 200
        data = response.json()
        assert data["appearance"]["theme_id"] == "sambee-light"
        assert data["appearance"]["custom_themes"] == []
        assert data["localization"]["language"] == "browser"
        assert data["localization"]["regional_locale"] == "browser"
        assert data["browser"]["quick_nav_include_dot_directories"] is False
        assert data["browser"]["file_browser_view_mode"] == "list"
        assert data["browser"]["pane_mode"] == "single"
        assert data["browser"]["selected_connection_id"] is None

    def test_user_can_update_own_settings(self, client: TestClient, auth_headers_user: dict[str, str], session: Session) -> None:
        response = client.put(
            "/api/auth/me/settings",
            headers=auth_headers_user,
            json={
                "appearance": {
                    "theme_id": "sambee-dark",
                    "custom_themes": [
                        {
                            "id": "custom-theme",
                            "name": "Custom Theme",
                            "mode": "light",
                            "primary": {"main": "#123456"},
                        }
                    ],
                },
                "localization": {
                    "language": "en",
                    "regional_locale": "en-GB",
                },
                "browser": {
                    "quick_nav_include_dot_directories": True,
                    "file_browser_view_mode": "details",
                    "pane_mode": "dual",
                    "selected_connection_id": "conn-123",
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["appearance"]["theme_id"] == "sambee-dark"
        assert data["appearance"]["custom_themes"][0]["id"] == "custom-theme"
        assert data["localization"]["language"] == "en"
        assert data["localization"]["regional_locale"] == "en-GB"
        assert data["browser"]["quick_nav_include_dot_directories"] is True
        assert data["browser"]["file_browser_view_mode"] == "details"
        assert data["browser"]["pane_mode"] == "dual"
        assert data["browser"]["selected_connection_id"] == "conn-123"

        rows = session.exec(select(UserSetting)).all()
        values = {row.key: row.value for row in rows}
        assert values[UserSettingKey.APPEARANCE_THEME_ID.value] == "sambee-dark"
        assert '"id":"custom-theme"' in values[UserSettingKey.APPEARANCE_CUSTOM_THEMES.value]
        assert values[UserSettingKey.LOCALIZATION_LANGUAGE.value] == "en"
        assert values[UserSettingKey.LOCALIZATION_REGIONAL_LOCALE.value] == "en-GB"
        assert values[UserSettingKey.BROWSER_QUICK_NAV_INCLUDE_DOT_DIRECTORIES.value] == "true"
        assert values[UserSettingKey.BROWSER_FILE_BROWSER_VIEW_MODE.value] == "details"
        assert values[UserSettingKey.BROWSER_PANE_MODE.value] == "dual"
        assert values[UserSettingKey.BROWSER_SELECTED_CONNECTION_ID.value] == "conn-123"

    def test_user_can_clear_custom_themes(self, client: TestClient, auth_headers_user: dict[str, str], session: Session) -> None:
        seed_response = client.put(
            "/api/auth/me/settings",
            headers=auth_headers_user,
            json={
                "appearance": {
                    "custom_themes": [
                        {
                            "id": "custom-theme",
                            "name": "Custom Theme",
                            "mode": "light",
                            "primary": {"main": "#123456"},
                        }
                    ]
                }
            },
        )
        assert seed_response.status_code == 200

        clear_response = client.put(
            "/api/auth/me/settings",
            headers=auth_headers_user,
            json={"appearance": {"custom_themes": []}},
        )

        assert clear_response.status_code == 200
        assert clear_response.json()["appearance"]["custom_themes"] == []

        rows = session.exec(select(UserSetting)).all()
        keys = {row.key for row in rows}
        assert UserSettingKey.APPEARANCE_CUSTOM_THEMES.value not in keys

    def test_user_can_clear_selected_connection_preference(
        self,
        client: TestClient,
        auth_headers_user: dict[str, str],
        session: Session,
    ) -> None:
        seed_response = client.put(
            "/api/auth/me/settings",
            headers=auth_headers_user,
            json={"browser": {"selected_connection_id": "conn-123"}},
        )
        assert seed_response.status_code == 200

        clear_response = client.put(
            "/api/auth/me/settings",
            headers=auth_headers_user,
            json={"browser": {"selected_connection_id": None}},
        )

        assert clear_response.status_code == 200
        assert clear_response.json()["browser"]["selected_connection_id"] is None

        rows = session.exec(select(UserSetting)).all()
        keys = {row.key for row in rows}
        assert UserSettingKey.BROWSER_SELECTED_CONNECTION_ID.value not in keys

    def test_user_settings_are_isolated_per_user(
        self,
        client: TestClient,
        auth_headers_user: dict[str, str],
        auth_headers_admin: dict[str, str],
    ) -> None:
        update_response = client.put(
            "/api/auth/me/settings",
            headers=auth_headers_user,
            json={"appearance": {"theme_id": "sambee-dark"}},
        )
        assert update_response.status_code == 200

        admin_response = client.get("/api/auth/me/settings", headers=auth_headers_admin)
        assert admin_response.status_code == 200
        assert admin_response.json()["appearance"]["theme_id"] == "sambee-light"

    def test_update_rejects_empty_theme_id(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.put(
            "/api/auth/me/settings",
            headers=auth_headers_user,
            json={"appearance": {"theme_id": "   "}},
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "Theme ID cannot be empty"

    def test_update_rejects_invalid_custom_theme_payload(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.put(
            "/api/auth/me/settings",
            headers=auth_headers_user,
            json={
                "appearance": {
                    "custom_themes": [
                        {
                            "id": "broken-theme",
                            "name": "Broken Theme",
                            "mode": "light",
                        }
                    ]
                }
            },
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "Custom themes payload contains an invalid theme definition"

    def test_update_rejects_invalid_browser_preference_values(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.put(
            "/api/auth/me/settings",
            headers=auth_headers_user,
            json={"browser": {"file_browser_view_mode": "grid"}},
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "File browser view mode must be one of: list, details"

    def test_update_rejects_invalid_regional_locale(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.put(
            "/api/auth/me/settings",
            headers=auth_headers_user,
            json={"localization": {"regional_locale": "english_us"}},
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "Regional locale must be a valid locale identifier like en-US"
