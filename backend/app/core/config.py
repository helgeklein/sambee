import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, field_validator

from app.core.auth_methods import AuthMethod, parse_auth_method
from app.core.environment import IS_DEVELOPMENT
from app.core.exceptions import ConfigurationError


#
# load_toml_config
#
def load_toml_config(config_file: Path) -> dict[str, Any]:
    """Load configuration from TOML file if it exists.

    Returns:
        Dictionary with flattened config values for Pydantic.
        Returns empty dict if file doesn't exist.
    """

    if not config_file.exists():
        return {}

    # Check if config_file is actually a directory (common Docker mount issue)
    if config_file.is_dir():
        raise ConfigurationError(
            f"'{config_file}' is a directory, not a file. Common cause: Docker created a directory because the file doesn't exist on the host."
        )

    try:
        with open(config_file, "rb") as f:
            toml_data = tomllib.load(f)
    except tomllib.TOMLDecodeError as e:
        raise ConfigurationError(f"Invalid TOML syntax in '{config_file}': {e}") from e

    # Flatten nested TOML structure for Pydantic
    # Convert sections like [security] to flat keys like SECRET_KEY
    flat_config = {}

    # App settings
    if "app" in toml_data:
        app = toml_data["app"]
        if "log_level" in app:
            flat_config["log_level"] = app["log_level"]

    # Auth settings (check here first, then security section for backwards compatibility)
    if "auth" in toml_data:
        auth = toml_data["auth"]
        if "auth_method" in auth:
            flat_config["auth_method"] = auth["auth_method"]

    # Security settings
    if "security" in toml_data:
        security = toml_data["security"]
        if "access_token_expire_minutes" in security:
            flat_config["access_token_expire_minutes"] = security["access_token_expire_minutes"]
        # Only use security.auth_method if not already set from auth section
        if "auth_method" in security and "auth_method" not in flat_config:
            flat_config["auth_method"] = security["auth_method"]

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
    auth_method: AuthMethod = AuthMethod.PASSWORD  # Authentication method

    @field_validator("auth_method", mode="before")
    @classmethod
    def validate_auth_method(cls, v: str | AuthMethod) -> AuthMethod:
        """Validate and convert auth_method to AuthMethod enum"""
        if isinstance(v, AuthMethod):
            return v
        return parse_auth_method(v)

    # Admin setup (username only - password auto-generated)
    admin_username: str = "admin"


#
# load_settings
#
def load_settings() -> UserSettings:
    """Load settings from config.toml file."""

    # Allow tests to override config path via environment variable
    import os

    env_config_path = os.environ.get("SAMBEE_CONFIG_PATH")
    if env_config_path:
        config_path = Path(env_config_path)
    # Determine config file location based on environment
    elif IS_DEVELOPMENT:
        # DEV mode: running in devcontainer
        config_path = Path("/workspace/config.toml")
    else:
        # PROD mode: running in Docker
        config_path = Path("/app/config.toml")

    toml_config = load_toml_config(config_path)
    return UserSettings(**toml_config)


# Create global instances
static = StaticSettings()

try:
    settings = load_settings()
except ConfigurationError as e:
    # Print clean error message and exit before uvicorn can show stack trace
    from app.core.logging import setup_early_error_logging

    logger = setup_early_error_logging()
    logger.error(f"Configuration Error: {e}")
    sys.exit(1)

# Ensure data directory exists
try:
    static.data_dir.mkdir(parents=True, exist_ok=True)
except (PermissionError, OSError) as e:
    from app.core.logging import setup_early_error_logging

    logger = setup_early_error_logging()
    logger.error(f"Failed to create data directory '{static.data_dir}': {e}")
    sys.exit(1)
