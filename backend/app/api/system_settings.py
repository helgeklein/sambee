from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.core.authorization import Capability
from app.core.logging import set_user
from app.core.security import require_capability
from app.db.database import get_immediate_session, get_session
from app.models.system_settings import (
    AboutSettingsRead,
    AdvancedSystemSettingsRead,
    AdvancedSystemSettingUpdate,
    FileSearchSettingsRead,
    FileSearchSettingsUpdate,
    FileSearchSettingsUpdateResult,
    NetworkSettingsRead,
    NetworkSettingsUpdate,
    NetworkSettingsUpdateResult,
    PublicSupportReportRead,
    SmbSettingsRead,
    SmbSettingsUpdate,
    SmbSettingsUpdateResult,
)
from app.models.user import User
from app.services.system_settings import (
    build_about_settings_read,
    build_advanced_system_settings_read,
    build_file_search_settings_read,
    build_network_settings_read,
    build_public_support_report_read,
    build_smb_settings_read,
    refresh_smb_runtime_policy,
    retire_smb_runtime_policy,
    smb_policy_will_change,
    update_advanced_system_settings,
    update_file_search_settings,
    update_network_settings,
    update_smb_settings,
)

router = APIRouter()


@router.get("/settings/file-search", response_model=FileSearchSettingsRead)
async def get_file_search_settings(
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
    session: Session = Depends(get_session),
) -> FileSearchSettingsRead:
    set_user(current_user.username)
    return build_file_search_settings_read(session)


@router.put("/settings/file-search", response_model=FileSearchSettingsUpdateResult)
async def put_file_search_settings(
    payload: FileSearchSettingsUpdate,
    session: Session = Depends(get_immediate_session),
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
) -> FileSearchSettingsUpdateResult:
    set_user(current_user.username)
    try:
        return update_file_search_settings(payload, updated_by_user_id=current_user.id, session=session)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/settings/about", response_model=AboutSettingsRead)
async def get_about_settings(
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
) -> AboutSettingsRead:
    set_user(current_user.username)
    return build_about_settings_read()


@router.get("/settings/support-report", response_model=PublicSupportReportRead)
async def get_public_support_report(
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
    session: Session = Depends(get_session),
) -> PublicSupportReportRead:
    set_user(current_user.username)
    return build_public_support_report_read(session)


@router.get("/settings/advanced", response_model=AdvancedSystemSettingsRead)
async def get_advanced_system_settings(
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
) -> AdvancedSystemSettingsRead:
    set_user(current_user.username)
    return build_advanced_system_settings_read()


@router.put("/settings/advanced", response_model=AdvancedSystemSettingUpdate)
async def put_advanced_system_settings(
    payload: AdvancedSystemSettingUpdate,
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
    session: Session = Depends(get_session),
) -> AdvancedSystemSettingUpdate:
    set_user(current_user.username)
    try:
        return update_advanced_system_settings(payload, updated_by_user_id=current_user.id, session=session)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/settings/smb", response_model=SmbSettingsRead)
async def get_smb_settings(
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
) -> SmbSettingsRead:
    set_user(current_user.username)
    return build_smb_settings_read()


@router.put("/settings/smb", response_model=SmbSettingsUpdateResult)
async def put_smb_settings(
    payload: SmbSettingsUpdate,
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
    session: Session = Depends(get_session),
) -> SmbSettingsUpdateResult:
    set_user(current_user.username)
    try:
        policy_changed = smb_policy_will_change(payload, session)
        updated_settings = update_smb_settings(payload, updated_by_user_id=current_user.id, session=session)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if policy_changed:
        await retire_smb_runtime_policy()
        await refresh_smb_runtime_policy()
    return updated_settings


@router.get("/settings/network", response_model=NetworkSettingsRead)
async def get_network_settings(
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
    session: Session = Depends(get_session),
) -> NetworkSettingsRead:
    set_user(current_user.username)
    return build_network_settings_read(session)


@router.put("/settings/network", response_model=NetworkSettingsUpdateResult)
async def put_network_settings(
    payload: NetworkSettingsUpdate,
    current_user: User = Depends(require_capability(Capability.ACCESS_ADMIN_SETTINGS)),
    session: Session = Depends(get_session),
) -> NetworkSettingsUpdateResult:
    set_user(current_user.username)
    try:
        return update_network_settings(payload, updated_by_user_id=current_user.id, session=session)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
