import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.core.authorization import Capability
from app.core.logging import get_logger, set_user
from app.core.secrets import generate_temporary_password
from app.core.security import get_password_hash, require_capability
from app.db.database import get_session
from app.models.user import (
    AdminUserCreate,
    AdminUserCreateResult,
    AdminUserPasswordReset,
    AdminUserPasswordResetResult,
    AdminUserRead,
    AdminUserUpdate,
    User,
    UserRole,
    build_admin_user_read,
)

router = APIRouter()
logger = get_logger(__name__)


def _count_active_admins(session: Session) -> int:
    admins = session.exec(select(User).where(User.role == UserRole.ADMIN)).all()
    return sum(1 for user in admins if user.is_active)


def _validate_user_update_guards(
    *,
    actor: User,
    target: User,
    session: Session,
    next_role: UserRole,
    next_is_active: bool,
    is_delete: bool = False,
) -> None:
    if target.id == actor.id and (is_delete or next_role != UserRole.ADMIN or not next_is_active):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot remove your own admin access")

    if target.role == UserRole.ADMIN and target.is_active and (is_delete or next_role != UserRole.ADMIN or not next_is_active):
        if _count_active_admins(session) <= 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove the last active admin")


@router.get("/users", response_model=list[AdminUserRead])
async def list_users(
    current_user: User = Depends(require_capability(Capability.MANAGE_USERS)),
    session: Session = Depends(get_session),
) -> list[AdminUserRead]:
    set_user(current_user.username)
    logger.info(f"Listing users: user={current_user.username}")
    users = session.exec(select(User).order_by(User.username)).all()
    return [build_admin_user_read(user) for user in users]


@router.post("/users", response_model=AdminUserCreateResult, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: AdminUserCreate,
    current_user: User = Depends(require_capability(Capability.MANAGE_USERS)),
    session: Session = Depends(get_session),
) -> AdminUserCreateResult:
    set_user(current_user.username)
    username = user_data.username.strip()
    existing_user = session.exec(select(User).where(User.username == username)).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with that username already exists")

    temporary_password: str | None = None
    password_to_store = user_data.password
    if not password_to_store:
        temporary_password = generate_temporary_password()
        password_to_store = temporary_password

    user = User(
        username=username,
        password_hash=get_password_hash(password_to_store),
        role=user_data.role,
        is_active=True,
        must_change_password=user_data.must_change_password,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    logger.info(f"Created user: actor={current_user.username}, username={user.username}, role={user.role}")

    return AdminUserCreateResult(
        **build_admin_user_read(user).model_dump(),
        temporary_password=temporary_password,
    )


@router.patch("/users/{user_id}", response_model=AdminUserRead)
async def update_user(
    user_id: uuid.UUID,
    user_data: AdminUserUpdate,
    current_user: User = Depends(require_capability(Capability.MANAGE_USERS)),
    session: Session = Depends(get_session),
) -> AdminUserRead:
    set_user(current_user.username)

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    next_username = user_data.username.strip() if user_data.username is not None else user.username
    next_role = user_data.role or user.role
    next_is_active = user.is_active if user_data.is_active is None else user_data.is_active

    if next_username != user.username:
        existing_user = session.exec(select(User).where(User.username == next_username)).first()
        if existing_user and existing_user.id != user.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with that username already exists")

    _validate_user_update_guards(
        actor=current_user,
        target=user,
        session=session,
        next_role=next_role,
        next_is_active=next_is_active,
    )

    user.username = next_username
    user.role = next_role
    user.is_active = next_is_active
    user.updated_at = datetime.now(timezone.utc)
    session.add(user)
    session.commit()
    session.refresh(user)

    logger.info(f"Updated user: actor={current_user.username}, username={user.username}, role={user.role}, active={user.is_active}")
    return build_admin_user_read(user)


@router.post("/users/{user_id}/reset-password", response_model=AdminUserPasswordResetResult)
async def reset_user_password(
    user_id: uuid.UUID,
    reset_data: AdminUserPasswordReset,
    current_user: User = Depends(require_capability(Capability.MANAGE_USERS)),
    session: Session = Depends(get_session),
) -> AdminUserPasswordResetResult:
    set_user(current_user.username)

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.password_hash = get_password_hash(reset_data.new_password)
    user.must_change_password = reset_data.must_change_password
    user.token_version += 1
    user.updated_at = datetime.now(timezone.utc)
    session.add(user)
    session.commit()

    logger.info(f"Reset password for user: actor={current_user.username}, username={user.username}")
    return AdminUserPasswordResetResult(
        message="Password reset successfully",
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: uuid.UUID,
    current_user: User = Depends(require_capability(Capability.MANAGE_USERS)),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    set_user(current_user.username)

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    _validate_user_update_guards(
        actor=current_user,
        target=user,
        session=session,
        next_role=user.role,
        next_is_active=user.is_active,
        is_delete=True,
    )

    session.delete(user)
    session.commit()

    logger.info(f"Deleted user: actor={current_user.username}, username={user.username}")
    return {"message": "User deleted successfully"}
