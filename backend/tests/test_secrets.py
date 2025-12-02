"""
Tests for password and secret generation.
Tests secret key generation, encryption key generation, and admin password generation.
"""

import re

import pytest
from cryptography.fernet import Fernet
from sqlmodel import Session, select

from app.core.secrets import (
    generate_admin_password,
    generate_encryption_key,
    generate_secret_key,
    get_or_create_app_secrets,
)
from app.models.app_secret import AppSecret


@pytest.mark.unit
class TestSecretGeneration:
    """Test secret key and encryption key generation."""

    def test_generate_secret_key_length(self):
        """Test that secret key is 64 characters (32 bytes as hex)."""
        key = generate_secret_key()
        assert len(key) == 64

    def test_generate_secret_key_is_hex(self):
        """Test that secret key is valid hexadecimal."""
        key = generate_secret_key()
        # Should only contain 0-9 and a-f
        assert re.match(r"^[0-9a-f]{64}$", key)

    def test_generate_secret_key_is_random(self):
        """Test that secret keys are different each time."""
        key1 = generate_secret_key()
        key2 = generate_secret_key()
        assert key1 != key2

    def test_generate_encryption_key_length(self):
        """Test that encryption key is 44 characters (Fernet key base64)."""
        key = generate_encryption_key()
        assert len(key) == 44

    def test_generate_encryption_key_is_valid_fernet(self):
        """Test that encryption key is a valid Fernet key."""
        key = generate_encryption_key()
        # Should be able to create a Fernet instance
        fernet = Fernet(key.encode())
        # Should be able to encrypt and decrypt
        test_data = b"test data"
        encrypted = fernet.encrypt(test_data)
        decrypted = fernet.decrypt(encrypted)
        assert decrypted == test_data

    def test_generate_encryption_key_is_random(self):
        """Test that encryption keys are different each time."""
        key1 = generate_encryption_key()
        key2 = generate_encryption_key()
        assert key1 != key2


@pytest.mark.unit
class TestAdminPasswordGeneration:
    """Test admin password generation for dev and prod environments."""

    def test_generate_admin_password_development(self):
        """Test that development password is 'admin'."""
        password = generate_admin_password(is_production=False)
        assert password == "admin"

    def test_generate_admin_password_production_length(self):
        """Test that production password is 20 characters."""
        password = generate_admin_password(is_production=True)
        assert len(password) == 20

    def test_generate_admin_password_production_complexity(self):
        """Test that production password has required character types."""
        password = generate_admin_password(is_production=True)

        # Must have at least one lowercase letter
        assert any(c.islower() for c in password)

        # Must have at least one uppercase letter
        assert any(c.isupper() for c in password)

        # Must have at least one digit
        assert any(c.isdigit() for c in password)

        # Must have at least one punctuation/special character
        assert any(not c.isalnum() for c in password)

    def test_generate_admin_password_production_is_random(self):
        """Test that production passwords are different each time."""
        password1 = generate_admin_password(is_production=True)
        password2 = generate_admin_password(is_production=True)
        assert password1 != password2


@pytest.mark.integration
class TestAppSecretModel:
    """Test AppSecret model and database operations."""

    def test_retrieve_existing_app_secret(self, session: Session):
        """Test retrieving the existing AppSecret record created by init_db."""
        # Retrieve the app secret created during init_db
        statement = select(AppSecret).where(AppSecret.id == 1)
        secret = session.exec(statement).first()

        # Verify it exists and has valid values
        assert secret is not None
        assert secret.id == 1
        assert len(secret.secret_key) == 64
        assert len(secret.encryption_key) == 44
        assert secret.created_at is not None
        assert secret.updated_at is not None

    def test_app_secret_fields_are_valid(self, session: Session):
        """Test that AppSecret fields contain valid secret formats."""
        statement = select(AppSecret).where(AppSecret.id == 1)
        secret = session.exec(statement).first()

        assert secret is not None
        # Secret key should be valid hex
        assert re.match(r"^[0-9a-f]{64}$", secret.secret_key)
        # Encryption key should be valid Fernet key (can create Fernet instance)
        fernet = Fernet(secret.encryption_key.encode())
        assert fernet is not None

    def test_app_secret_singleton_constraint(self, session: Session):
        """Test that only one AppSecret can exist (id=1)."""
        # Try to create another with id=1 (should fail)
        # In SQLite with primary key, this will raise an IntegrityError
        with pytest.raises(Exception):  # IntegrityError
            secret2 = AppSecret(
                id=1,
                secret_key=generate_secret_key(),
                encryption_key=generate_encryption_key(),
            )
            session.add(secret2)
            session.commit()


@pytest.mark.integration
class TestGetOrCreateAppSecrets:
    """Test get_or_create_app_secrets function."""

    def test_retrieve_existing_secrets_via_function(self, session: Session):
        """Test that get_or_create returns existing secrets created by init_db."""
        # The app secret was already created by init_db in conftest
        app_secret = get_or_create_app_secrets(session)

        # Verify it returns the existing record
        assert app_secret.id == 1
        assert len(app_secret.secret_key) == 64
        assert len(app_secret.encryption_key) == 44

    def test_get_or_create_is_idempotent(self, session: Session):
        """Test that calling get_or_create multiple times returns the same secrets."""
        # Call get_or_create twice
        app_secret1 = get_or_create_app_secrets(session)
        app_secret2 = get_or_create_app_secrets(session)

        # Should return the same secrets (not regenerate)
        assert app_secret1.secret_key == app_secret2.secret_key
        assert app_secret1.encryption_key == app_secret2.encryption_key

    def test_secrets_persist_across_sessions(self, engine):
        """Test that secrets persist across different sessions."""
        # Get secrets in first session
        with Session(engine) as session1:
            app_secret1 = get_or_create_app_secrets(session1)
            key1 = app_secret1.secret_key
            enc_key1 = app_secret1.encryption_key

        # Retrieve in second session
        with Session(engine) as session2:
            app_secret2 = get_or_create_app_secrets(session2)
            key2 = app_secret2.secret_key
            enc_key2 = app_secret2.encryption_key

        # Should be the same secrets
        assert key1 == key2
        assert enc_key1 == enc_key2


@pytest.mark.integration
class TestSecretsIntegration:
    """Test integration of secrets with database initialization."""

    def test_init_db_creates_secrets(self, engine):
        """Test that database initialization creates secrets."""
        from app.db.database import init_db

        # Initialize database
        init_db()

        # Verify secrets were created
        with Session(engine) as session:
            statement = select(AppSecret).where(AppSecret.id == 1)
            app_secret = session.exec(statement).first()

            assert app_secret is not None
            assert len(app_secret.secret_key) == 64
            assert len(app_secret.encryption_key) == 44

    def test_secrets_loaded_into_settings(self, engine):
        """Test that secrets are loaded into settings after init_db."""
        from app.core.config import settings
        from app.db.database import init_db

        # Initialize database
        init_db()

        # Verify settings have secrets
        assert settings.secret_key != ""
        assert settings.encryption_key != ""
        assert len(settings.secret_key) == 64
        assert len(settings.encryption_key) == 44

    def test_encryption_key_works_with_fernet(self, engine):
        """Test that generated encryption key works with Fernet."""
        from app.db.database import init_db

        # Initialize database
        init_db()

        # Get the encryption key
        with Session(engine) as session:
            statement = select(AppSecret).where(AppSecret.id == 1)
            app_secret = session.exec(statement).first()

            assert app_secret is not None

            # Test encryption/decryption
            fernet = Fernet(app_secret.encryption_key.encode())
            test_data = b"test password 123"
            encrypted = fernet.encrypt(test_data)
            decrypted = fernet.decrypt(encrypted)

            assert decrypted == test_data
