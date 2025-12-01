import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel


def load_toml_config(config_file: Path = Path("config.toml")) -> dict[str, Any]:
    """Load configuration from TOML file if it exists.

    Returns:
        Dictionary with flattened config values for Pydantic.
        Returns empty dict if file doesn't exist.
    """
    if not config_file.exists():
        return {}

    with open(config_file, "rb") as f:
        toml_data = tomllib.load(f)

    # Flatten nested TOML structure for Pydantic
    # Convert sections like [security] to flat keys like SECRET_KEY
    flat_config = {}

    # App settings
    if "app" in toml_data:
        app = toml_data["app"]
        if "debug" in app:
            flat_config["debug"] = app["debug"]
        if "log_level" in app:
            flat_config["log_level"] = app["log_level"]

    # Security settings
    if "security" in toml_data:
        security = toml_data["security"]
        if "secret_key" in security:
            flat_config["secret_key"] = security["secret_key"]
        if "encryption_key" in security:
            flat_config["encryption_key"] = security["encryption_key"]
        if "access_token_expire_minutes" in security:
            flat_config["access_token_expire_minutes"] = security["access_token_expire_minutes"]

    # Admin settings
    if "admin" in toml_data:
        admin = toml_data["admin"]
        if "username" in admin:
            flat_config["admin_username"] = admin["username"]
        if "password" in admin:
            flat_config["admin_password"] = admin["password"]

    return flat_config


#
# Static settings - immutable, type-safe constants
#
@dataclass(frozen=True)
class StaticSettings:
    """Static application settings that cannot be overridden"""

    app_name: str = "Sambee"
    algorithm: str = "HS256"
    data_dir: Path = Path("data")


#
# User-configurable settings
#
class UserSettings(BaseModel):
    """Application configuration settings

    Loaded from config.toml file only.

    For production: Mount config.toml as read-only volume in container
    For development: Use config.toml (auto-generated if missing)
    """

    # App settings
    debug: bool = False
    log_level: str = "INFO"

    # Security (required - no defaults for production safety)
    secret_key: str
    encryption_key: str  # Fernet key for encrypting SMB passwords
    access_token_expire_minutes: int = 60 * 24  # 24 hours

    # Admin setup (first run)
    admin_username: str = "admin"
    admin_password: str = "changeme"


def load_settings() -> UserSettings:
    """Load settings from config.toml file."""
    toml_config = load_toml_config()
    return UserSettings(**toml_config)


# Create global instances
static = StaticSettings()
settings = load_settings()

# Ensure data directory exists
static.data_dir.mkdir(parents=True, exist_ok=True)
