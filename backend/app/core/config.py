import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, field_validator

from app.core.auth_methods import AuthMethod
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

    # Image viewer settings
    if "image_viewer" in toml_data:
        image_viewer = toml_data["image_viewer"]
        if "conv_size_thresh" in image_viewer:
            flat_config["image_viewer_conv_size_thresh"] = image_viewer["conv_size_thresh"]

    # Frontend logging settings
    if "frontend_logging" in toml_data:
        frontend_logging = toml_data["frontend_logging"]
        if "enabled" in frontend_logging:
            flat_config["frontend_logging_enabled"] = frontend_logging["enabled"]
        if "log_retention_hours" in frontend_logging:
            flat_config["frontend_log_retention_hours"] = frontend_logging["log_retention_hours"]
        if "log_level" in frontend_logging:
            flat_config["frontend_log_level"] = frontend_logging["log_level"]
        if "log_components" in frontend_logging:
            flat_config["frontend_log_components"] = frontend_logging["log_components"]
        if "username_regex" in frontend_logging:
            flat_config["frontend_logging_username_regex"] = frontend_logging["username_regex"]

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
class Settings(BaseModel):
    """Application settings with validation"""

    # App settings
    log_level: str = "INFO"

    # Auth method - must be set via config or environment variable
    auth_method: AuthMethod = AuthMethod.PASSWORD

    @field_validator("log_level", "frontend_log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate and normalize log level to uppercase.

        Args:
            v: Log level string (case-insensitive)

        Returns:
            Normalized uppercase log level

        Raises:
            ValueError: If log level is invalid
        """

        valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR"}
        normalized = v.upper()

        if normalized not in valid_levels:
            raise ValueError(f"Invalid log level: '{v}'. Must be one of: {', '.join(sorted(valid_levels))}")

        return normalized

    # Security settings
    access_token_expire_minutes: int = 1440
    secret_key: str = ""  # Set dynamically from database
    encryption_key: str = ""  # Set dynamically from database

    # Admin settings
    admin_username: str = "admin"

    # Image viewer settings
    image_viewer_conv_size_thresh: int = 512000

    # Frontend logging settings
    frontend_logging_enabled: bool = False
    frontend_log_retention_hours: int = 1
    frontend_log_level: str = "ERROR"  # Minimum severity: DEBUG, INFO, WARNING, ERROR
    frontend_log_components: str = ""
    frontend_logging_username_regex: str = ""


#
# load_settings
#
def load_settings() -> Settings:
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
    return Settings(**toml_config)


# Create global instances
static = StaticSettings()

try:
    settings = load_settings()
except Exception as e:
    # Catch all config errors (TOML syntax, validation errors, etc.)
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
