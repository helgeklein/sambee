from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select

from app.core.auth_methods import AuthMethod
from app.core.config import settings
from app.core.logging import get_logger, set_user
from app.core.security import (
    create_access_token,
    get_current_user_with_auth_check,
    get_password_hash,
    verify_password,
)
from app.db.database import get_session
from app.models.user import User

router = APIRouter()
logger = get_logger(__name__)


#
# get_auth_config
#
@router.get("/config")
async def get_auth_config() -> dict[str, str]:
    """Get authentication configuration.

    Public endpoint that returns the current authentication method.
    Frontend uses this to determine whether to show login form.
    """

    return {"auth_method": settings.auth_method.value}


#
# login
#
@router.post("/token")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
) -> dict[str, str | bool]:
    """Login endpoint for OAuth2 password flow"""

    # Reject login attempts when auth_method is "none"
    if settings.auth_method == AuthMethod.NONE:
        logger.warning("Login attempt rejected: auth_method is 'none' (reverse proxy should handle auth)")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Password authentication is not enabled",
        )

    logger.info(f"Login attempt: username={form_data.username}")

    statement = select(User).where(User.username == form_data.username)
    user = session.exec(statement).first()

    if not user or not verify_password(form_data.password, user.password_hash):
        logger.warning(f"Failed login attempt: username={form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(data={"sub": user.username}, expires_delta=access_token_expires)

    logger.info(f"Successful login: username={user.username}, is_admin={user.is_admin}")
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": user.username,
        "is_admin": user.is_admin,
    }


#
# get_current_user_info
#
@router.get("/me")
async def get_current_user_info(
    current_user: User = Depends(get_current_user_with_auth_check),
) -> dict[str, Any]:
    """Get current user information"""

    set_user(current_user.username)
    logger.info(f"User info requested: username={current_user.username}")

    return {
        "username": current_user.username,
        "is_admin": current_user.is_admin,
        "created_at": current_user.created_at,
    }


#
# change_password
#
@router.post("/change-password")
async def change_password(
    current_password: str,
    new_password: str,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    """Change current user's password"""

    # Reject password changes when auth_method is "none"
    if settings.auth_method == AuthMethod.NONE:
        logger.warning("Password change rejected: auth_method is 'none' (reverse proxy handles auth)")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password changes are not available when authentication is handled by reverse proxy",
        )

    set_user(current_user.username)
    logger.info(f"Password change requested: username={current_user.username}")

    if not verify_password(current_password, current_user.password_hash):
        logger.warning(f"Password change failed - incorrect current password: username={current_user.username}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    current_user.password_hash = get_password_hash(new_password)
    session.add(current_user)
    session.commit()

    logger.info(f"Password changed successfully: username={current_user.username}")

    return {"message": "Password changed successfully"}
