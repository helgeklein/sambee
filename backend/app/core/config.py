import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel


#
# load_toml_config
#
def load_toml_config(config_file: Path = Path("config.toml")) -> dict[str, Any]:
    """Load configuration from TOML file if it exists.

    Returns:
        Dictionary with flattened config values for Pydantic.
        Returns empty dict if file doesn't exist.
    """

    if not config_file.exists():
        return {}

    # Check if config_file is actually a directory (common Docker mount issue)
    if config_file.is_dir():
        raise RuntimeError(
            f"'{config_file}' is a directory, not a file. Common cause: Docker created a directory because the file doesn't exist on the host."
        )

    with open(config_file, "rb") as f:
        toml_data = tomllib.load(f)

    # Flatten nested TOML structure for Pydantic
    # Convert sections like [security] to flat keys like SECRET_KEY
    flat_config = {}

    # App settings
    if "app" in toml_data:
        app = toml_data["app"]
        if "log_level" in app:
            flat_config["log_level"] = app["log_level"]

    # Security settings
    if "security" in toml_data:
        security = toml_data["security"]
        if "access_token_expire_minutes" in security:
            flat_config["access_token_expire_minutes"] = security["access_token_expire_minutes"]

    # Admin settings
    if "admin" in toml_data:
        admin = toml_data["admin"]
        if "username" in admin:
            flat_config["admin_username"] = admin["username"]

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

    Loaded from config.toml file (optional - all secrets auto-generated in database).

    Note: secret_key, encryption_key, and admin_password are stored in the
    database and auto-generated on first run. They are not loaded from config.
    """

    # App settings
    log_level: str = "INFO"

    # Security - secrets loaded from database (not config file)
    # These will be set by database.py after initialization
    secret_key: str = ""  # Loaded from database
    encryption_key: str = ""  # Loaded from database
    access_token_expire_minutes: int = 60 * 24  # 24 hours

    # Admin setup (username only - password auto-generated)
    admin_username: str = "admin"


#
# load_settings
#
def load_settings() -> UserSettings:
    """Load settings from config.toml file."""

    toml_config = load_toml_config()
    return UserSettings(**toml_config)


# Create global instances
static = StaticSettings()
settings = load_settings()

# Ensure data directory exists
static.data_dir.mkdir(parents=True, exist_ok=True)
