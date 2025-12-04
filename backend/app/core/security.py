from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from app.core.auth_methods import AuthMethod
from app.core.config import settings, static
from app.core.exceptions import ConfigurationError
from app.core.logging import get_logger
from app.db.database import get_session
from app.models.user import User

logger = get_logger(__name__)

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

# Fernet cipher for password encryption (initialized lazily)
_fernet: Fernet | None = None


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
    """Verify a plain password against a hashed password"""

    return bool(pwd_context.verify(plain_password, hashed_password))


#
# get_password_hash
#
def get_password_hash(password: str) -> str:
    """Hash a password for storage"""

    return str(pwd_context.hash(password))


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


#
# get_current_user
#
async def get_current_user(token: str = Depends(oauth2_scheme), session: Session = Depends(get_session)) -> User:
    """Get the current authenticated user from token"""

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[static.algorithm])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    statement = select(User).where(User.username == username)
    user = session.exec(statement).first()

    if user is None:
        raise credentials_exception
    return user


#
# get_current_user_with_auth_check
#
async def get_current_user_with_auth_check(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> User:
    """Get the current authenticated user based on configured auth method.

    - auth_method="password": Validates JWT token and returns user
    - auth_method="none": Returns admin user without token validation
      (assumes reverse proxy handles authentication)
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
        return user

    # For "password" auth method, use standard JWT validation
    return await get_current_user(token=token, session=session)


#
# get_current_admin_user
#
async def get_current_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Ensure the current user is an admin"""

    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    return current_user
