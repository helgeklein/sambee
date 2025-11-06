from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App settings
    app_name: str = "Sambee"
    debug: bool = False
    log_level: str = "INFO"

    # Security
    secret_key: str
    encryption_key: str  # Fernet key for encrypting SMB passwords
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours

    # Admin setup (first run)
    admin_username: str = "admin"
    admin_password: str = "admin"

    # Paths
    data_dir: Path = Path("data")

    # Optional test SMB
    test_smb_host: Optional[str] = None
    test_smb_share: Optional[str] = None
    test_smb_username: Optional[str] = None
    test_smb_password: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
    )


settings = Settings()  # pyright: ignore[reportCallIssue]

# Ensure data directory exists
settings.data_dir.mkdir(parents=True, exist_ok=True)
