from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.core.authorization import Capability
from app.core.logging import set_user
from app.core.security import require_capability
from app.db.database import get_session
from app.models.system_settings import AdvancedSystemSettingsRead, AdvancedSystemSettingsUpdate
from app.models.user import User
from app.services.system_settings import build_advanced_system_settings_read, update_advanced_system_settings

router = APIRouter()


@router.get("/settings/advanced", response_model=AdvancedSystemSettingsRead)
async def get_advanced_system_settings(
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
) -> AdvancedSystemSettingsRead:
    set_user(current_user.username)
    return build_advanced_system_settings_read()


@router.put("/settings/advanced", response_model=AdvancedSystemSettingsRead)
async def put_advanced_system_settings(
    payload: AdvancedSystemSettingsUpdate,
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
    session: Session = Depends(get_session),
) -> AdvancedSystemSettingsRead:
    set_user(current_user.username)
    try:
        update_advanced_system_settings(payload, updated_by_user_id=current_user.id, session=session)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return build_advanced_system_settings_read()
