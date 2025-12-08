"""
Tests for frontend logging configuration API
"""

from fastapi.testclient import TestClient


#
# test_get_logging_config_default
#
def test_get_logging_config_default(client: TestClient, auth_headers_admin: dict[str, str]) -> None:
    """Test getting default logging configuration"""

    response = client.get("/api/logs/config", headers=auth_headers_admin)
    assert response.status_code == 200

    data = response.json()
    assert "enabled" in data
    assert "log_level" in data
    assert "components" in data
    assert isinstance(data["enabled"], bool)
    assert isinstance(data["log_level"], str)
    assert isinstance(data["components"], list)

    # Default should be disabled
    assert data["enabled"] is False
    # Default log level is "ERROR"
    assert data["log_level"] == "ERROR"
    # Default should have all components (empty list)
    assert data["components"] == []


#
# test_get_logging_config_with_regex_match
#
def test_get_logging_config_with_regex_match(client: TestClient, auth_headers_admin: dict[str, str], monkeypatch) -> None:
    """Test that logging is enabled when username matches regex"""

    from app.api import logs

    monkeypatch.setattr(logs.settings, "frontend_logging_enabled", True)
    monkeypatch.setattr(logs.settings, "frontend_logging_username_regex", "^testadmin$")
    monkeypatch.setattr(logs.settings, "frontend_log_level", "WARNING")  # WARNING and ERROR
    monkeypatch.setattr(logs.settings, "frontend_log_components", "Swiper")

    response = client.get("/api/logs/config", headers=auth_headers_admin)
    assert response.status_code == 200

    data = response.json()
    assert data["enabled"] is True
    assert data["log_level"] == "WARNING"
    assert data["components"] == ["Swiper"]


#
# test_get_logging_config_with_regex_no_match
#
def test_get_logging_config_with_regex_no_match(client: TestClient, auth_headers_admin: dict[str, str], monkeypatch) -> None:
    """Test that logging is disabled when username doesn't match regex"""

    from app.api import logs

    monkeypatch.setattr(logs.settings, "frontend_logging_enabled", True)
    monkeypatch.setattr(logs.settings, "frontend_logging_username_regex", "^other_user$")
    monkeypatch.setattr(logs.settings, "frontend_log_level", "DEBUG")
    monkeypatch.setattr(logs.settings, "frontend_log_components", "")

    response = client.get("/api/logs/config", headers=auth_headers_admin)
    assert response.status_code == 200

    data = response.json()
    assert data["enabled"] is False


#
# test_get_logging_config_with_invalid_regex
#
def test_get_logging_config_with_invalid_regex(client: TestClient, auth_headers_admin: dict[str, str], monkeypatch) -> None:
    """Test that invalid regex disables logging"""

    from app.api import logs

    monkeypatch.setattr(logs.settings, "frontend_logging_enabled", True)
    monkeypatch.setattr(logs.settings, "frontend_logging_username_regex", "[invalid(regex")
    monkeypatch.setattr(logs.settings, "frontend_log_level", "INFO")
    monkeypatch.setattr(logs.settings, "frontend_log_components", "")

    response = client.get("/api/logs/config", headers=auth_headers_admin)
    assert response.status_code == 200

    data = response.json()
    assert data["enabled"] is False


#
# test_logging_config_requires_auth
#
def test_logging_config_requires_auth(client: TestClient) -> None:
    """Test that logging config endpoint requires authentication"""

    response = client.get("/api/logs/config")
    assert response.status_code == 401


#
# test_log_level_returned
#
def test_log_level_returned(client: TestClient, auth_headers_admin: dict[str, str], monkeypatch) -> None:
    """Test that log level is returned correctly"""

    from app.api import logs

    # Test each log level
    for level in ["DEBUG", "INFO", "WARNING", "ERROR"]:
        monkeypatch.setattr(logs.settings, "frontend_logging_enabled", True)
        monkeypatch.setattr(logs.settings, "frontend_logging_username_regex", "^testadmin$")
        monkeypatch.setattr(logs.settings, "frontend_log_level", level)

        response = client.get("/api/logs/config", headers=auth_headers_admin)
        assert response.status_code == 200
        assert response.json()["log_level"] == level


#
# test_log_retention_config
#
def test_log_retention_config() -> None:
    """Test that log retention configuration is loaded"""

    from app.core.config import settings

    # Default should be 1 hour
    assert settings.frontend_log_retention_hours == 1
    assert isinstance(settings.frontend_log_retention_hours, int)
