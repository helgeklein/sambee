import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.core.authorization import Capability
from app.core.logging import get_logger, set_user
from app.core.secrets import generate_temporary_password
from app.core.security import get_password_hash, require_capability
from app.db.database import get_session
from app.models.oidc import OidcIdentity, OidcPendingIdentityMapping, OidcProviderConfiguration
from app.models.user import (
    AdminUserCreate,
    AdminUserCreateResult,
    AdminUserOidcRead,
    AdminUserPasswordReset,
    AdminUserPasswordResetResult,
    AdminUserPendingOidcRead,
    AdminUserRead,
    AdminUserUpdate,
    User,
    UserRole,
    build_admin_user_read,
)
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event
from app.services.authentication_config import is_local_password_management_available
from app.services.oidc_mapping import OidcMappingError, remove_user_oidc_state

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


def _build_admin_user_read_with_authentication(session: Session, user: User) -> AdminUserRead:
    result = build_admin_user_read(user)
    configuration = session.get(OidcProviderConfiguration, 1)
    if configuration is None:
        return result
    identity = session.exec(
        select(OidcIdentity).where(OidcIdentity.issuer == configuration.issuer_url, OidcIdentity.user_id == user.id)
    ).first()
    pending = session.exec(
        select(OidcPendingIdentityMapping).where(
            OidcPendingIdentityMapping.provider_configuration_id == configuration.id,
            OidcPendingIdentityMapping.target_user_id == user.id,
        )
    ).first()
    return result.model_copy(
        update={
            "oidc": (
                AdminUserOidcRead(
                    identity_id=identity.id,
                    provider_display_name=configuration.display_name,
                    last_login_at=identity.last_login_at,
                )
                if identity is not None
                else None
            ),
            "pending_oidc": (
                AdminUserPendingOidcRead(
                    expected_username=pending.expected_username,
                    created_by_username=(
                        creator.username
                        if pending.created_by_user_id is not None and (creator := session.get(User, pending.created_by_user_id)) is not None
                        else "Deleted user"
                    ),
                    created_at=pending.created_at,
                )
                if pending is not None
                else None
            ),
        }
    )


@router.get("/users", response_model=list[AdminUserRead])
async def list_users(
    current_user: User = Depends(require_capability(Capability.MANAGE_USERS)),
    session: Session = Depends(get_session),
) -> list[AdminUserRead]:
    set_user(current_user.username)
    logger.info(f"Listing users: user={current_user.username}")
    users = session.exec(select(User).order_by(User.username)).all()
    return [_build_admin_user_read_with_authentication(session, user) for user in users]


@router.post("/users", response_model=AdminUserCreateResult, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: AdminUserCreate,
    current_user: User = Depends(require_capability(Capability.MANAGE_USERS)),
    session: Session = Depends(get_session),
) -> AdminUserCreateResult:
    set_user(current_user.username)
    if not is_local_password_management_available(session):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Creating local users is unavailable because local-password authentication is disabled",
        )
    username = user_data.username.strip()
    name = user_data.name.strip() if user_data.name else None
    email = user_data.email.strip().lower() if user_data.email else None
    existing_user = session.exec(select(User).where(User.username == username)).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with that username already exists")

    if email:
        existing_email_user = session.exec(select(User).where(User.email == email)).first()
        if existing_email_user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with that email address already exists")

    temporary_password: str | None = None
    password_to_store = user_data.password
    if not password_to_store:
        temporary_password = generate_temporary_password()
        password_to_store = temporary_password

    user = User(
        username=username,
        name=name,
        email=email,
        password_hash=get_password_hash(password_to_store),
        role=user_data.role,
        is_active=True,
        must_change_password=user_data.must_change_password,
        expires_at=user_data.expires_at,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    logger.info(f"Created user: actor={current_user.username}, username={user.username}, role={user.role}")

    return AdminUserCreateResult(
        **_build_admin_user_read_with_authentication(session, user).model_dump(),
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
    next_name = user_data.name.strip() if user_data.name is not None else user.name
    next_email = user_data.email.strip().lower() if user_data.email is not None else user.email
    next_role = user_data.role or user.role
    assignment_requested = "oidc_role_assignment" in user_data.model_fields_set
    next_oidc_role_assignment = user_data.oidc_role_assignment if assignment_requested else user.oidc_role_assignment
    if next_oidc_role_assignment is not None:
        next_role = next_oidc_role_assignment
    elif assignment_requested and user.oidc_role_assignment is not None:
        next_role = UserRole.VIEWER
    next_is_active = user.is_active if user_data.is_active is None else user_data.is_active
    next_expires_at = user.expires_at if user_data.expires_at is None else user_data.expires_at

    if next_username != user.username:
        existing_user = session.exec(select(User).where(User.username == next_username)).first()
        if existing_user and existing_user.id != user.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with that username already exists")

    if next_email != user.email and next_email:
        existing_email_user = session.exec(select(User).where(User.email == next_email)).first()
        if existing_email_user and existing_email_user.id != user.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with that email address already exists")

    _validate_user_update_guards(
        actor=current_user,
        target=user,
        session=session,
        next_role=next_role,
        next_is_active=next_is_active,
    )

    user.username = next_username
    user.name = next_name
    user.email = next_email
    user.role = next_role
    if assignment_requested and user.oidc_role_assignment != next_oidc_role_assignment:
        previous_assignment = user.oidc_role_assignment
        user.oidc_role_assignment = next_oidc_role_assignment
        user.token_version += 1
        write_audit_event(
            session,
            event_name=AuditEventName.USER_ROLE_ASSIGNMENT_CHANGED,
            result=AuditResult.SUCCEEDED,
            details=AuditDetails(
                selected_role=next_oidc_role_assignment.value if next_oidc_role_assignment is not None else None,
                changed_fields=(previous_assignment.value if previous_assignment is not None else "configured",),
            ),
            acting_user_id=current_user.id,
            affected_user_id=user.id,
        )
    user.is_active = next_is_active
    user.expires_at = next_expires_at
    user.updated_at = datetime.now(timezone.utc)
    session.add(user)
    session.commit()
    session.refresh(user)

    logger.info(f"Updated user: actor={current_user.username}, username={user.username}, role={user.role}, active={user.is_active}")
    return _build_admin_user_read_with_authentication(session, user)


@router.post("/users/{user_id}/reset-password", response_model=AdminUserPasswordResetResult)
async def reset_user_password(
    user_id: uuid.UUID,
    reset_data: AdminUserPasswordReset,
    current_user: User = Depends(require_capability(Capability.MANAGE_USERS)),
    session: Session = Depends(get_session),
) -> AdminUserPasswordResetResult:
    set_user(current_user.username)
    if not is_local_password_management_available(session):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Resetting local passwords is unavailable because local-password authentication is disabled",
        )

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset requires an existing local password",
        )

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

    try:
        remove_user_oidc_state(session, user=user, acting_user_id=current_user.id)
    except OidcMappingError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    session.delete(user)
    session.commit()

    logger.info(f"Deleted user: actor={current_user.username}, username={user.username}")
    return {"message": "User deleted successfully"}
