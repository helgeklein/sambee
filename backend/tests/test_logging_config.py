"""
Tests for frontend logging configuration API
"""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models.user import User


#
# test_get_logging_config_default
#
def test_get_logging_config_default(client: TestClient, auth_headers_admin: dict[str, str], session: Session) -> None:
    """Test getting default logging configuration"""

    response = client.get("/api/logs/config", headers=auth_headers_admin)
    assert response.status_code == 200

    data = response.json()
    assert "enabled" in data
    assert "levels" in data
    assert "components" in data
    assert isinstance(data["enabled"], bool)
    assert isinstance(data["levels"], list)
    assert isinstance(data["components"], list)

    # Default should have all levels
    assert set(data["levels"]) == {"error", "warn", "info", "debug"}
    # Default should have all components (empty list)
    assert data["components"] == []


#
# test_update_logging_config
#
def test_update_logging_config(client: TestClient, auth_headers_admin: dict[str, str], session: Session) -> None:
    """Test updating logging configuration"""

    # Update config
    new_config = {
        "enabled": True,
        "levels": ["error", "warn"],
        "components": ["Swiper", "ImageLoader"],
    }

    response = client.put("/api/logs/config", headers=auth_headers_admin, json=new_config)
    assert response.status_code == 200

    data = response.json()
    assert data["enabled"] is True
    assert set(data["levels"]) == {"error", "warn"}
    assert set(data["components"]) == {"Swiper", "ImageLoader"}

    # Verify the user object was updated
    statement = select(User).where(User.username == "testadmin")
    user = session.exec(statement).first()
    assert user is not None, "User should exist in the database"
    assert user.enable_frontend_logging is True
    assert "error" in user.frontend_log_levels
    assert "warn" in user.frontend_log_levels
    assert "Swiper" in user.frontend_log_components


#
# test_update_logging_config_invalid_level
#
def test_update_logging_config_invalid_level(client: TestClient, auth_headers_admin: dict[str, str]) -> None:
    """Test updating logging configuration with invalid level"""

    invalid_config = {
        "enabled": True,
        "levels": ["invalid_level"],
        "components": [],
    }

    response = client.put("/api/logs/config", headers=auth_headers_admin, json=invalid_config)
    assert response.status_code == 400
    assert "Invalid log level" in response.json()["detail"]


#
# test_get_logging_config_after_update
#
def test_get_logging_config_after_update(client: TestClient, auth_headers_admin: dict[str, str]) -> None:
    """Test that configuration persists after update"""

    # Update config
    new_config = {
        "enabled": False,
        "levels": ["error"],
        "components": ["TestComponent"],
    }

    client.put("/api/logs/config", headers=auth_headers_admin, json=new_config)

    # Get config again
    response = client.get("/api/logs/config", headers=auth_headers_admin)
    assert response.status_code == 200

    data = response.json()
    assert data["enabled"] is False
    assert data["levels"] == ["error"]
    assert data["components"] == ["TestComponent"]


#
# test_logging_config_requires_auth
#
def test_logging_config_requires_auth(client: TestClient) -> None:
    """Test that logging config endpoints require authentication"""

    # GET without auth
    response = client.get("/api/logs/config")
    assert response.status_code == 401

    # PUT without auth
    response = client.put("/api/logs/config", json={"enabled": True, "levels": [], "components": []})
    assert response.status_code == 401


#
# test_log_retention_config
#
def test_log_retention_config(session: Session) -> None:
    """Test that log retention configuration is loaded"""

    from app.core.config import settings

    # Default should be 1 hour
    assert settings.frontend_log_retention_hours == 1
    assert isinstance(settings.frontend_log_retention_hours, int)
