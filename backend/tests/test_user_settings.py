from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.user_setting_definitions import UserSettingKey
from app.models.user_settings import UserSetting


class TestCurrentUserSettingsApi:
    def test_user_gets_default_settings(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        response = client.get("/api/auth/me/settings", headers=auth_headers_user)

        assert response.status_code == 200
        data = response.json()
        assert data["appearance"] == {"theme_id": "sambee-light", "custom_themes": []}
        assert data["localization"] == {"language": "browser", "regional_locale": "browser"}
        assert data["browser"]["quick_nav_include_dot_directories"] is False
        assert data["browser"]["selected_connection_id"] is None
        assert data["text_editor"] == {"max_file_size_bytes": 52_428_800, "word_wrap_enabled": None}

    def test_user_updates_independent_settings(self, client: TestClient, auth_headers_user: dict[str, str], session: Session) -> None:
        updates = (
            {
                "field": "appearance.custom_themes",
                "value": [{"id": "custom-theme", "name": "Custom", "mode": "light", "primary": {"main": "#123456"}}],
            },
            {"field": "appearance.theme_id", "value": "custom-theme"},
            {"field": "localization.language", "value": "en"},
            {"field": "localization.regional_locale", "value": "en-GB"},
            {"field": "browser.quick_nav_include_dot_directories", "value": True},
            {"field": "browser.quick_bar_shortcut_hint_visibility", "value": "never"},
            {"field": "browser.file_browser_view_mode", "value": "details"},
            {"field": "browser.pane_mode", "value": "dual"},
            {"field": "browser.selected_connection_id", "value": "conn-123"},
            {"field": "browser.viewer_associations", "value": {".MD": " markdown ", "application/pdf": "pdf"}},
            {"field": "text_editor.max_file_size_bytes", "value": 4_194_304},
            {"field": "text_editor.word_wrap_enabled", "value": True},
        )
        for payload in updates:
            response = client.put("/api/auth/me/settings", headers=auth_headers_user, json=payload)
            assert response.status_code == 200
            assert response.json()["field"] == payload["field"]

        data = client.get("/api/auth/me/settings", headers=auth_headers_user).json()
        assert data["appearance"]["theme_id"] == "custom-theme"
        assert data["browser"]["viewer_associations"] == {".md": "markdown", "application/pdf": "pdf"}
        assert data["text_editor"]["max_file_size_bytes"] == 4_194_304
        keys = {row.key for row in session.exec(select(UserSetting)).all()}
        assert UserSettingKey.APPEARANCE_THEME_ID.value in keys
        assert UserSettingKey.TEXT_EDITOR_WORD_WRAP_ENABLED.value in keys

    def test_user_can_clear_compound_and_nullable_settings(
        self, client: TestClient, auth_headers_user: dict[str, str], session: Session
    ) -> None:
        for payload in (
            {"field": "browser.selected_connection_id", "value": "conn-123"},
            {"field": "browser.viewer_associations", "value": {".md": "markdown"}},
            {"field": "browser.selected_connection_id", "value": None},
            {"field": "browser.viewer_associations", "value": {}},
            {"field": "text_editor.word_wrap_enabled", "value": None},
        ):
            response = client.put("/api/auth/me/settings", headers=auth_headers_user, json=payload)
            assert response.status_code == 200

        keys = {row.key for row in session.exec(select(UserSetting)).all()}
        assert UserSettingKey.BROWSER_SELECTED_CONNECTION_ID.value not in keys
        assert UserSettingKey.BROWSER_VIEWER_ASSOCIATIONS.value not in keys
        assert UserSettingKey.TEXT_EDITOR_WORD_WRAP_ENABLED.value not in keys

    def test_user_settings_are_isolated_per_user(
        self, client: TestClient, auth_headers_user: dict[str, str], auth_headers_admin: dict[str, str]
    ) -> None:
        response = client.put(
            "/api/auth/me/settings", headers=auth_headers_user, json={"field": "appearance.theme_id", "value": "sambee-dark"}
        )
        assert response.status_code == 200
        assert client.get("/api/auth/me/settings", headers=auth_headers_admin).json()["appearance"]["theme_id"] == "sambee-light"

    def test_rejects_invalid_values_and_legacy_shapes(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        invalid_values = (
            {"field": "appearance.theme_id", "value": "   "},
            {"field": "appearance.theme_id", "value": "unknown-theme"},
            {
                "field": "appearance.custom_themes",
                "value": [{"id": "sambee-dark", "name": "Collision", "mode": "light", "primary": {"main": "#123456"}}],
            },
            {"field": "browser.viewer_associations", "value": {"   ": "markdown"}},
            {"field": "text_editor.max_file_size_bytes", "value": 1024},
            {"field": "localization.regional_locale", "value": "english_us"},
        )
        for payload in invalid_values:
            assert client.put("/api/auth/me/settings", headers=auth_headers_user, json=payload).status_code == 400

        for payload in (
            {"appearance": {"theme_id": "sambee-dark"}},
            {"field": "unknown", "value": True},
            {"field": "appearance.theme_id", "value": "sambee-dark", "unexpected": True},
        ):
            assert client.put("/api/auth/me/settings", headers=auth_headers_user, json=payload).status_code == 422

    def test_prevents_removing_the_active_custom_theme(self, client: TestClient, auth_headers_user: dict[str, str]) -> None:
        custom_themes = [{"id": "custom-theme", "name": "Custom", "mode": "light", "primary": {"main": "#123456"}}]
        assert (
            client.put(
                "/api/auth/me/settings", headers=auth_headers_user, json={"field": "appearance.custom_themes", "value": custom_themes}
            ).status_code
            == 200
        )
        assert (
            client.put(
                "/api/auth/me/settings", headers=auth_headers_user, json={"field": "appearance.theme_id", "value": "custom-theme"}
            ).status_code
            == 200
        )
        response = client.put("/api/auth/me/settings", headers=auth_headers_user, json={"field": "appearance.custom_themes", "value": []})
        assert response.status_code == 400
        assert response.json()["detail"] == "Cannot remove the active custom theme before selecting another theme"
