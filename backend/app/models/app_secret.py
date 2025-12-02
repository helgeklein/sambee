from datetime import datetime, timezone
from typing import ClassVar

from sqlmodel import Field, SQLModel


#
# AppSecret
#
class AppSecret(SQLModel, table=True):
    """
    Application secrets (singleton table - only one row).

    Stores JWT signing key and encryption key for the application.
    These are auto-generated on first database initialization.
    """

    __tablename__: ClassVar[str] = "app_secrets"

    id: int = Field(default=1, primary_key=True)  # Always 1 (singleton)
    secret_key: str = Field(index=False)  # JWT signing key (64-char hex)
    encryption_key: str = Field(index=False)  # Fernet encryption key (44-char base64)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
