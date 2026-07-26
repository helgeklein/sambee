import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class AuditEvent(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    event_name: str = Field(index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)
    acting_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id", index=True)
    affected_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id", index=True)
    provider_configuration_id: int | None = Field(default=None, foreign_key="oidcproviderconfiguration.id", index=True)
    correlation_id: str | None = Field(default=None, index=True)
    result: str
    safe_details_json: str = Field(default="{}")
