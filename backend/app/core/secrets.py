import logging
import secrets
import string

from cryptography.fernet import Fernet
from sqlmodel import Session, select

from app.models.app_secret import AppSecret

logger = logging.getLogger(__name__)


#
# generate_secret_key
#
def generate_secret_key() -> str:
    """
    Generate 64-character hex string for JWT signing.

    Returns:
        str: 64-character hexadecimal string
    """
    return secrets.token_hex(32)  # 32 bytes = 64 hex chars


#
# generate_encryption_key
#
def generate_encryption_key() -> str:
    """
    Generate 44-character base64 Fernet key for encrypting SMB passwords.

    Returns:
        str: 44-character base64-encoded Fernet key
    """
    return Fernet.generate_key().decode()


#
# generate_admin_password
#
def generate_admin_password(is_production: bool) -> str:
    """
    Generate admin password based on environment.

    Args:
        is_production: Whether running in production mode

    Returns:
        str: Generated password
            - Development: "admin" (easy to remember)
            - Production: 20-character random string (high entropy)
    """
    if not is_production:
        return "admin"

    # Generate secure 20-char password with mixed case, digits, punctuation
    alphabet = string.ascii_letters + string.digits + string.punctuation

    # Ensure at least one of each type
    password = [
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.digits),
        secrets.choice(string.punctuation),
    ]

    # Fill remaining with random choices
    password += [secrets.choice(alphabet) for _ in range(16)]

    # Shuffle to randomize positions
    secrets.SystemRandom().shuffle(password)

    return "".join(password)


def generate_temporary_password(length: int = 20) -> str:
    """Generate a high-entropy temporary password for admin-driven account actions."""

    if length < 12:
        raise ValueError("Temporary passwords must be at least 12 characters long")

    alphabet = string.ascii_letters + string.digits + string.punctuation
    password = [
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.digits),
        secrets.choice(string.punctuation),
    ]
    password += [secrets.choice(alphabet) for _ in range(length - 4)]
    secrets.SystemRandom().shuffle(password)
    return "".join(password)


#
# get_or_create_app_secrets
#
def get_or_create_app_secrets(session: Session) -> AppSecret:
    """
    Get existing app secrets or generate new ones.

    Returns the singleton AppSecret row, creating it if it doesn't exist.
    This is called during database initialization to ensure secrets are
    available for the application.

    Args:
        session: Database session

    Returns:
        AppSecret: The singleton secrets record
    """
    # Try to get existing secrets
    statement = select(AppSecret).where(AppSecret.id == 1)
    app_secret = session.exec(statement).first()

    if app_secret is None:
        # Generate new secrets
        app_secret = AppSecret(
            id=1,
            secret_key=generate_secret_key(),
            encryption_key=generate_encryption_key(),
        )
        session.add(app_secret)
        session.commit()
        session.refresh(app_secret)
        logger.info("✅ Generated new application secrets")

    return app_secret
