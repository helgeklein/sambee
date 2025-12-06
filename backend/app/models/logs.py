"""
Models for mobile log collection
"""

from typing import Optional

from pydantic import BaseModel, Field


#
# MobileLogEntry
#
class MobileLogEntry(BaseModel):
    """Single log entry from mobile device"""

    timestamp: int = Field(..., description="Unix timestamp in milliseconds")
    level: str = Field(..., description="Log level: debug, info, warn, error")
    message: str = Field(..., description="Log message")
    context: Optional[dict] = Field(None, description="Additional context data")
    component: Optional[str] = Field(None, description="Component name that generated the log")


#
# MobileLogBatch
#
class MobileLogBatch(BaseModel):
    """Batch of log entries from mobile device"""

    session_id: str = Field(..., description="Unique session identifier")
    device_info: dict = Field(..., description="Device information (user agent, screen size, etc)")
    logs: list[MobileLogEntry] = Field(..., description="List of log entries")
