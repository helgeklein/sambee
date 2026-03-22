import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, field_validator

from app.core.auth_methods import AuthMethod
from app.core.environment import IS_DEVELOPMENT
from app.core.exceptions import ConfigurationError
from app.core.system_setting_definitions import SYSTEM_SETTING_DEFINITIONS, SystemSettingKey

configured_setting_keys: frozenset[str] = frozenset()


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
        # Console logging settings
        if "logging_enabled" in frontend_logging:
            flat_config["frontend_logging_enabled"] = frontend_logging["logging_enabled"]
        if "log_level" in frontend_logging:
            flat_config["frontend_log_level"] = frontend_logging["log_level"]
        # Backend tracing settings
        if "tracing_enabled" in frontend_logging:
            flat_config["frontend_tracing_enabled"] = frontend_logging["tracing_enabled"]
        if "tracing_retention_hours" in frontend_logging:
            flat_config["frontend_tracing_retention_hours"] = frontend_logging["tracing_retention_hours"]
        if "tracing_level" in frontend_logging:
            flat_config["frontend_tracing_level"] = frontend_logging["tracing_level"]
        if "tracing_components" in frontend_logging:
            flat_config["frontend_tracing_components"] = frontend_logging["tracing_components"]
        if "tracing_username_regex" in frontend_logging:
            flat_config["frontend_tracing_username_regex"] = frontend_logging["tracing_username_regex"]

    # Directory cache persistence settings
    if "directory_cache" in toml_data:
        dc = toml_data["directory_cache"]
        if "location" in dc:
            flat_config["directory_cache_location"] = dc["location"]
        if "coalesce_interval_seconds" in dc:
            flat_config["directory_cache_coalesce_interval_seconds"] = dc["coalesce_interval_seconds"]
        if "max_staleness_minutes" in dc:
            flat_config["directory_cache_max_staleness_minutes"] = dc["max_staleness_minutes"]

    # SMB backend settings
    if "smb" in toml_data:
        smb = toml_data["smb"]
        if "read_chunk_size_bytes" in smb:
            flat_config["smb_read_chunk_size_bytes"] = smb["read_chunk_size_bytes"]

    # Preprocessor settings
    if "preprocessors" in toml_data:
        preprocessors = toml_data["preprocessors"]

        imagemagick = preprocessors.get("imagemagick")
        if isinstance(imagemagick, dict):
            if "max_file_size_bytes" in imagemagick:
                flat_config["preprocessor_imagemagick_max_file_size_bytes"] = imagemagick["max_file_size_bytes"]
            if "timeout_seconds" in imagemagick:
                flat_config["preprocessor_imagemagick_timeout_seconds"] = imagemagick["timeout_seconds"]

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

    @field_validator("log_level", "frontend_log_level", "frontend_tracing_level")
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

    # Frontend console logging settings
    frontend_logging_enabled: bool = False
    frontend_log_level: str = "WARNING"  # Console log level: DEBUG, INFO, WARNING, ERROR

    # Frontend backend tracing settings
    frontend_tracing_enabled: bool = False
    frontend_tracing_retention_hours: int = 1
    frontend_tracing_level: str = "ERROR"  # Tracing log level: DEBUG, INFO, WARNING, ERROR
    frontend_tracing_components: str = ""
    frontend_tracing_username_regex: str = ""

    # Directory cache persistence settings
    directory_cache_location: str = ""  # Empty = default (data_dir / directory_cache)
    directory_cache_coalesce_interval_seconds: int = 30  # Min time between disk writes
    directory_cache_max_staleness_minutes: int = 43200  # 30 days — ignore snapshots older than this

    # SMB backend settings
    smb_read_chunk_size_bytes: int = SYSTEM_SETTING_DEFINITIONS[SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES].default_value

    # Preprocessor settings
    preprocessor_imagemagick_max_file_size_bytes: int = SYSTEM_SETTING_DEFINITIONS[
        SystemSettingKey.PREPROCESSOR_IMAGEMAGICK_MAX_FILE_SIZE_BYTES
    ].default_value
    preprocessor_imagemagick_timeout_seconds: int = SYSTEM_SETTING_DEFINITIONS[
        SystemSettingKey.PREPROCESSOR_IMAGEMAGICK_TIMEOUT_SECONDS
    ].default_value

    @field_validator(
        "smb_read_chunk_size_bytes",
        "preprocessor_imagemagick_max_file_size_bytes",
        "preprocessor_imagemagick_timeout_seconds",
    )
    @classmethod
    def validate_integer_system_setting(cls, value: int, info: Any) -> int:
        definition_by_attr = {definition.config_attr: definition for definition in SYSTEM_SETTING_DEFINITIONS.values()}
        definition = definition_by_attr.get(info.field_name)
        if definition is None:
            return value
        if value < definition.min_value or value > definition.max_value:
            raise ValueError(f"{definition.config_attr} must be between {definition.min_value} and {definition.max_value}")
        return value


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

    global configured_setting_keys

    toml_config = load_toml_config(config_path)
    configured_setting_keys = frozenset(toml_config.keys())
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
