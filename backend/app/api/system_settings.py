from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.core.authorization import Capability
from app.core.logging import set_user
from app.core.security import require_capability
from app.db.database import get_session
from app.models.system_settings import (
    AboutSettingsRead,
    AdvancedSystemSettingsRead,
    AdvancedSystemSettingsUpdate,
    NetworkSettingsRead,
    NetworkSettingsUpdate,
)
from app.models.user import User
from app.services.system_settings import (
    build_about_settings_read,
    build_advanced_system_settings_read,
    build_network_settings_read,
    update_advanced_system_settings,
    update_network_settings,
)

router = APIRouter()


@router.get("/settings/about", response_model=AboutSettingsRead)
async def get_about_settings(
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
) -> AboutSettingsRead:
    set_user(current_user.username)
    return build_about_settings_read()


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


@router.get("/settings/network", response_model=NetworkSettingsRead)
async def get_network_settings(
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
    session: Session = Depends(get_session),
) -> NetworkSettingsRead:
    set_user(current_user.username)
    return build_network_settings_read(session)


@router.put("/settings/network", response_model=NetworkSettingsRead)
async def put_network_settings(
    payload: NetworkSettingsUpdate,
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
    session: Session = Depends(get_session),
) -> NetworkSettingsRead:
    set_user(current_user.username)
    try:
        return update_network_settings(payload, updated_by_user_id=current_user.id, session=session)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
