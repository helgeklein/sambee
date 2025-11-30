from dataclasses import dataclass
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


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
class UserSettings(BaseSettings):
    """Application configuration settings

    Read from (descending priority):
      1. environment variables (production Docker container)
      2. .env.backend file (development)
      3. defaults defined here
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

    # Have Pydantic read settings
    model_config = SettingsConfigDict(
        env_file=".env.backend",
        case_sensitive=False,
    )


# Create global instances
static = StaticSettings()
settings = UserSettings()  # pyright: ignore[reportCallIssue]

# Ensure data directory exists
static.data_dir.mkdir(parents=True, exist_ok=True)
