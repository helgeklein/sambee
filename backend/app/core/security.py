import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlmodel import Session, select

from app.core.auth_methods import AuthMethod
from app.core.authorization import Capability, user_has_capability
from app.core.config import settings, static
from app.core.exceptions import ConfigurationError
from app.core.logging import get_logger
from app.db.database import get_session
from app.models.user import User

logger = get_logger(__name__)

# Use argon2-cffi directly instead of passlib to avoid deprecation warnings
_password_hasher = PasswordHasher()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

# OAuth2 scheme that doesn't auto-error on missing tokens
# Used for endpoints that need to handle both password and 'none' auth methods
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)

# Fernet cipher for password encryption (initialized lazily)
_fernet: Fernet | None = None


def is_user_expired(user: User, now: datetime | None = None) -> bool:
    expires_at = user.expires_at
    if expires_at is None:
        return False

    current_time = now or datetime.now(timezone.utc)
    expires_at_utc = expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at.astimezone(timezone.utc)
    return expires_at_utc <= current_time


def _build_credentials_exception(detail: str = "Could not validate credentials") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _ensure_user_is_current(user: User | None, failure_exception: HTTPException) -> User:
    if user is None:
        raise failure_exception

    if not user.is_active:
        logger.info(f"Rejected inactive user during auth validation: username={user.username}")
        raise failure_exception

    if is_user_expired(user):
        logger.info(f"Rejected expired user during auth validation: username={user.username}")
        raise failure_exception

    return user


#
# get_fernet
#
def get_fernet() -> Fernet:
    """
    Get or initialize the Fernet cipher.

    Lazy initialization ensures encryption_key is loaded from database first.
    """
    global _fernet
    if _fernet is None:
        if not settings.encryption_key:
            raise ConfigurationError("Encryption key not loaded from database yet")
        _fernet = Fernet(settings.encryption_key.encode())
    return _fernet


#
# verify_password
#
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hashed password."""

    try:
        _password_hasher.verify(hashed_password, plain_password)
        return True
    except VerifyMismatchError:
        return False


#
# get_password_hash
#
def get_password_hash(password: str) -> str:
    """Hash a password for storage."""

    return _password_hasher.hash(password)


#
# encrypt_password
#
def encrypt_password(password: str) -> str:
    """Encrypt password for storage"""

    try:
        return get_fernet().encrypt(password.encode()).decode()
    except Exception as e:
        raise ConfigurationError(f"Failed to encrypt password: {e}") from e


#
# decrypt_password
#
def decrypt_password(encrypted_password: str) -> str:
    """Decrypt stored password"""

    try:
        return get_fernet().decrypt(encrypted_password.encode()).decode()
    except Exception as e:
        raise ConfigurationError(f"Failed to decrypt password. Data may be corrupted or encryption key changed: {e}") from e


#
# create_access_token
#
def create_access_token(data: dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token"""

    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt: str = jwt.encode(to_encode, settings.secret_key, algorithm=static.algorithm)
    return encoded_jwt


def build_user_access_token(user: User, expires_delta: Optional[timedelta] = None) -> str:
    return create_access_token(
        data={
            "sub": str(user.id),
            "tv": user.token_version,
        },
        expires_delta=expires_delta,
    )


def _get_user_from_subject(subject: str, session: Session) -> User | None:
    try:
        user_id = uuid.UUID(subject)
        return session.get(User, user_id)
    except ValueError:
        statement = select(User).where(User.username == subject)
        return session.exec(statement).first()


#
# get_current_user
#
async def get_current_user(token: str = Depends(oauth2_scheme), session: Session = Depends(get_session)) -> User:
    """Get the current authenticated user from token"""

    credentials_exception = _build_credentials_exception()

    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[static.algorithm])
        subject: str | None = payload.get("sub")
        if subject is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = _get_user_from_subject(subject, session)
    user = _ensure_user_is_current(user, credentials_exception)

    token_version = int(payload.get("tv", 0))
    if token_version != user.token_version:
        raise credentials_exception
    return user


#
# get_current_user_with_auth_check
#
async def get_current_user_with_auth_check(
    token: Optional[str] = Depends(oauth2_scheme_optional),
    session: Session = Depends(get_session),
) -> User:
    """Get the current authenticated user based on configured auth method.

    - auth_method="password": Validates JWT token and returns user
    - auth_method="none": Returns admin user without token validation
      (assumes reverse proxy handles authentication)
    """

    return await get_current_user_for_token(token, session)


async def get_current_user_for_token(token: Optional[str], session: Session) -> User:
    """Resolve the authenticated user for explicit token values.

    This is used by both HTTP dependency-based flows and WebSocket
    authentication where FastAPI dependencies are not available.
    """

    # For "none" auth method, return the admin user
    if settings.auth_method == AuthMethod.NONE:
        logger.debug("Auth method is 'none' - returning admin user (assuming reverse proxy auth)")
        statement = select(User).where(User.username == settings.admin_username)
        user = session.exec(statement).first()
        if not user:
            # This should not happen if database is properly initialized
            logger.error(f"Admin user '{settings.admin_username}' not found in database")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Authentication configuration error",
            )
        return _ensure_user_is_current(user, _build_credentials_exception(detail="Not authenticated"))

    # For "password" auth method, require a valid token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Validate JWT token
    return await get_current_user(token=token, session=session)


#
# get_current_admin_user
#
async def get_current_admin_user(
    current_user: User = Depends(get_current_user_with_auth_check),
) -> User:
    """Ensure the current user is an admin"""

    if not user_has_capability(current_user, Capability.ACCESS_ADMIN_SETTINGS):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    return current_user


def require_capability(capability: Capability) -> Callable[..., Any]:
    async def dependency(current_user: User = Depends(get_current_user_with_auth_check)) -> User:
        if not user_has_capability(current_user, capability):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return current_user

    return dependency
