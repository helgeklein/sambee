from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from app.core.config import settings, static
from app.db.database import get_session
from app.models.user import User

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
            raise RuntimeError("Encryption key not loaded from database yet")
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

    return get_fernet().encrypt(password.encode()).decode()


#
# decrypt_password
#
def decrypt_password(encrypted_password: str) -> str:
    """Decrypt stored password"""

    return get_fernet().decrypt(encrypted_password.encode()).decode()


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
# get_current_admin_user
#
async def get_current_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Ensure the current user is an admin"""

    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    return current_user
