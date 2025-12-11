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

    # Console logging fields
    assert "logging_enabled" in data
    assert "logging_level" in data
    assert isinstance(data["logging_enabled"], bool)
    assert isinstance(data["logging_level"], str)

    # Backend tracing fields
    assert "tracing_enabled" in data
    assert "tracing_level" in data
    assert "tracing_components" in data
    assert isinstance(data["tracing_enabled"], bool)
    assert isinstance(data["tracing_level"], str)
    assert isinstance(data["tracing_components"], list)

    # Defaults
    assert data["logging_enabled"] is False
    assert data["logging_level"] == "WARNING"
    assert data["tracing_enabled"] is False
    assert data["tracing_level"] == "ERROR"
    assert data["tracing_components"] == []


#
# test_get_logging_config_with_regex_match
#
def test_get_logging_config_with_regex_match(client: TestClient, auth_headers_admin: dict[str, str], monkeypatch) -> None:
    """Test that logging is enabled when username matches regex"""

    from app.api import logs

    monkeypatch.setattr(logs.settings, "frontend_logging_enabled", True)
    monkeypatch.setattr(logs.settings, "frontend_log_level", "INFO")
    monkeypatch.setattr(logs.settings, "frontend_tracing_enabled", True)
    monkeypatch.setattr(logs.settings, "frontend_tracing_username_regex", "^testadmin$")
    monkeypatch.setattr(logs.settings, "frontend_tracing_level", "WARNING")
    monkeypatch.setattr(logs.settings, "frontend_tracing_components", "Swiper")

    response = client.get("/api/logs/config", headers=auth_headers_admin)
    assert response.status_code == 200

    data = response.json()
    assert data["logging_enabled"] is True
    assert data["logging_level"] == "INFO"
    assert data["tracing_enabled"] is True
    assert data["tracing_level"] == "WARNING"
    assert data["tracing_components"] == ["Swiper"]


#
# test_get_logging_config_with_regex_no_match
#
def test_get_logging_config_with_regex_no_match(client: TestClient, auth_headers_admin: dict[str, str], monkeypatch) -> None:
    """Test that tracing is disabled when username doesn't match regex"""

    from app.api import logs

    monkeypatch.setattr(logs.settings, "frontend_logging_enabled", True)
    monkeypatch.setattr(logs.settings, "frontend_log_level", "DEBUG")
    monkeypatch.setattr(logs.settings, "frontend_tracing_enabled", True)
    monkeypatch.setattr(logs.settings, "frontend_tracing_username_regex", "^other_user$")
    monkeypatch.setattr(logs.settings, "frontend_tracing_level", "DEBUG")
    monkeypatch.setattr(logs.settings, "frontend_tracing_components", "")

    response = client.get("/api/logs/config", headers=auth_headers_admin)
    assert response.status_code == 200

    data = response.json()
    # Console logging is independent of username regex
    assert data["logging_enabled"] is True
    # Tracing should be disabled due to regex mismatch
    assert data["tracing_enabled"] is False


#
# test_get_logging_config_with_invalid_regex
#
def test_get_logging_config_with_invalid_regex(client: TestClient, auth_headers_admin: dict[str, str], monkeypatch) -> None:
    """Test that invalid regex disables tracing"""

    from app.api import logs

    monkeypatch.setattr(logs.settings, "frontend_logging_enabled", True)
    monkeypatch.setattr(logs.settings, "frontend_log_level", "INFO")
    monkeypatch.setattr(logs.settings, "frontend_tracing_enabled", True)
    monkeypatch.setattr(logs.settings, "frontend_tracing_username_regex", "[invalid(regex")
    monkeypatch.setattr(logs.settings, "frontend_tracing_level", "INFO")
    monkeypatch.setattr(logs.settings, "frontend_tracing_components", "")

    response = client.get("/api/logs/config", headers=auth_headers_admin)
    assert response.status_code == 200

    data = response.json()
    # Console logging is independent of regex
    assert data["logging_enabled"] is True
    # Tracing should be disabled due to invalid regex
    assert data["tracing_enabled"] is False


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
    """Test that log levels are returned correctly"""

    from app.api import logs

    # Test each log level for both logging and tracing
    for level in ["DEBUG", "INFO", "WARNING", "ERROR"]:
        monkeypatch.setattr(logs.settings, "frontend_logging_enabled", True)
        monkeypatch.setattr(logs.settings, "frontend_log_level", level)
        monkeypatch.setattr(logs.settings, "frontend_tracing_enabled", True)
        monkeypatch.setattr(logs.settings, "frontend_tracing_username_regex", "^testadmin$")
        monkeypatch.setattr(logs.settings, "frontend_tracing_level", level)

        response = client.get("/api/logs/config", headers=auth_headers_admin)
        assert response.status_code == 200
        assert response.json()["logging_level"] == level
        assert response.json()["tracing_level"] == level


#
# test_log_retention_config
#
def test_log_retention_config() -> None:
    """Test that log retention configuration is loaded"""

    from app.core.config import settings

    # Default should be 1 hour
    assert settings.frontend_tracing_retention_hours == 1
    assert isinstance(settings.frontend_tracing_retention_hours, int)
