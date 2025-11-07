"""
Tests for authentication and authorization.
Tests login, token generation/validation, password hashing, and encryption.
"""

import pytest
from app.core.security import (
    create_access_token,
    decrypt_password,
    encrypt_password,
    get_password_hash,
    verify_password,
)
from app.models.user import User
from fastapi.testclient import TestClient
from sqlmodel import Session


@pytest.mark.unit
class TestPasswordHashing:
    """Test password hashing and verification."""

    def test_password_hash_and_verify(self):
        """Test that password hashing and verification work correctly."""
        password = "mysecretpassword123"
        hashed = get_password_hash(password)

        # Hash should not be the plaintext password
        assert hashed != password
        # Hash should be long enough (argon2 produces long hashes)
        assert len(hashed) > 50

        # Verify correct password
        assert verify_password(password, hashed) is True

        # Verify incorrect password
        assert verify_password("wrongpassword", hashed) is False

    def test_same_password_different_hashes(self):
        """Test that hashing the same password twice produces different hashes (salted)."""
        password = "samepassword"
        hash1 = get_password_hash(password)
        hash2 = get_password_hash(password)

        # Different hashes due to random salt
        assert hash1 != hash2

        # But both verify correctly
        assert verify_password(password, hash1) is True
        assert verify_password(password, hash2) is True


@pytest.mark.unit
class TestPasswordEncryption:
    """Test Fernet password encryption and decryption."""

    def test_encrypt_and_decrypt(self):
        """Test that password encryption and decryption work correctly."""
        password = "my_smb_password_123"
        encrypted = encrypt_password(password)

        # Encrypted should not be the plaintext
        assert encrypted != password
        # Should be base64 encoded Fernet token
        assert len(encrypted) > 50

        # Decrypt should return original password
        decrypted = decrypt_password(encrypted)
        assert decrypted == password

    def test_same_password_different_encryption(self):
        """Test that encrypting the same password twice produces different ciphertext."""
        password = "same_smb_password"
        encrypted1 = encrypt_password(password)
        encrypted2 = encrypt_password(password)

        # Different due to random IV in Fernet
        assert encrypted1 != encrypted2

        # But both decrypt to same value
        assert decrypt_password(encrypted1) == password
        assert decrypt_password(encrypted2) == password

    def test_decrypt_invalid_token(self):
        """Test that decrypting invalid token raises exception."""
        with pytest.raises(Exception):
            decrypt_password("invalid_token_123")


@pytest.mark.unit
class TestTokenGeneration:
    """Test JWT token generation and validation."""

    def test_create_access_token(self):
        """Test that access token is created correctly."""
        username = "testuser"
        token = create_access_token(data={"sub": username})

        # Token should be a string
        assert isinstance(token, str)
        # JWT tokens have 3 parts separated by dots
        assert token.count(".") == 2

    def test_token_contains_username(self):
        """Test that token can be decoded to retrieve username."""
        from app.core.config import settings
        from jose import jwt

        username = "testuser"
        token = create_access_token(data={"sub": username})

        # Decode without verification (just to check content)
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[settings.algorithm]
        )
        assert payload["sub"] == username


@pytest.mark.integration
class TestLoginEndpoint:
    """Test the login endpoint."""

    def test_login_success(self, client: TestClient, admin_user: User):
        """Test successful login with correct credentials."""
        response = client.post(
            "/api/auth/token",
            data={
                "username": "testadmin",
                "password": "adminpass123",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["is_admin"] is True

    def test_login_wrong_password(self, client: TestClient, admin_user: User):
        """Test login fails with incorrect password."""
        response = client.post(
            "/api/auth/token",
            data={
                "username": "testadmin",
                "password": "wrongpassword",
            },
        )

        assert response.status_code == 401
        assert "Incorrect username or password" in response.json()["detail"]

    def test_login_nonexistent_user(self, client: TestClient):
        """Test login fails with non-existent user."""
        response = client.post(
            "/api/auth/token",
            data={
                "username": "nonexistent",
                "password": "password123",
            },
        )

        assert response.status_code == 401
        assert "Incorrect username or password" in response.json()["detail"]

    def test_login_missing_fields(self, client: TestClient):
        """Test login fails with missing fields."""
        response = client.post(
            "/api/auth/token",
            data={"username": "testadmin"},
        )

        assert response.status_code == 422  # Unprocessable entity

    def test_regular_user_login(self, client: TestClient, regular_user: User):
        """Test that regular users can login."""
        response = client.post(
            "/api/auth/token",
            data={
                "username": "testuser",
                "password": "userpass123",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["is_admin"] is False


@pytest.mark.integration
class TestAuthenticationMiddleware:
    """Test authentication middleware and protected endpoints."""

    def test_access_protected_endpoint_with_valid_token(
        self, client: TestClient, auth_headers_admin: dict
    ):
        """Test accessing protected endpoint with valid token."""
        response = client.get("/api/admin/connections", headers=auth_headers_admin)
        # Should not get 401 (actual response depends on data, but not auth error)
        assert response.status_code != 401

    def test_access_protected_endpoint_without_token(self, client: TestClient):
        """Test accessing protected endpoint without token fails."""
        response = client.get("/api/admin/connections")
        assert response.status_code == 401
        assert "Not authenticated" in response.json()["detail"]

    def test_access_protected_endpoint_with_invalid_token(self, client: TestClient):
        """Test accessing protected endpoint with invalid token fails."""
        response = client.get(
            "/api/admin/connections",
            headers={"Authorization": "Bearer invalid_token_12345"},
        )
        assert response.status_code == 401

    def test_access_protected_endpoint_with_malformed_header(self, client: TestClient):
        """Test accessing protected endpoint with malformed auth header."""
        response = client.get(
            "/api/admin/connections",
            headers={"Authorization": "InvalidFormat"},
        )
        assert response.status_code == 401


@pytest.mark.integration
class TestAdminAuthorization:
    """Test admin-only endpoints require admin privileges."""

    def test_admin_can_access_admin_endpoint(
        self, client: TestClient, auth_headers_admin: dict
    ):
        """Test that admin users can access admin endpoints."""
        response = client.get("/api/admin/connections", headers=auth_headers_admin)
        # Should not get 403 (may get 200 with empty list)
        assert response.status_code != 403

    def test_regular_user_cannot_access_admin_endpoint(
        self, client: TestClient, auth_headers_user: dict
    ):
        """Test that regular users cannot access admin endpoints."""
        response = client.get("/api/admin/connections", headers=auth_headers_user)
        assert response.status_code == 403
        assert "permission" in response.json()["detail"].lower()

    def test_regular_user_can_access_non_admin_endpoint(
        self, client: TestClient, auth_headers_user: dict, test_connection
    ):
        """Test that regular users can access non-admin endpoints."""
        # Browser endpoint should be accessible to all authenticated users
        response = client.get(
            f"/api/browser/{test_connection.id}/list",
            headers=auth_headers_user,
            params={"path": ""},
        )
        # May fail due to SMB connection, but should not be 403
        assert response.status_code != 403


@pytest.mark.integration
class TestGetCurrentUserEndpoint:
    """Test /me endpoint for getting current user info."""

    def test_get_current_user_info_admin(
        self, client: TestClient, auth_headers_admin: dict
    ):
        """Test getting current user info as admin."""
        response = client.get("/api/auth/me", headers=auth_headers_admin)
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "testadmin"  # From fixture
        assert data["is_admin"] is True
        assert "created_at" in data

    def test_get_current_user_info_regular_user(
        self, client: TestClient, auth_headers_user: dict
    ):
        """Test getting current user info as regular user."""
        response = client.get("/api/auth/me", headers=auth_headers_user)
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "testuser"
        assert data["is_admin"] is False
        assert "created_at" in data

    def test_get_current_user_info_without_auth(self, client: TestClient):
        """Test that /me endpoint requires authentication."""
        response = client.get("/api/auth/me")
        assert response.status_code == 401


@pytest.mark.integration
class TestChangePasswordEndpoint:
    """Test password change functionality."""

    def test_change_password_success(self, client: TestClient, session: Session):
        """Test successful password change."""
        from app.core.security import create_access_token, get_password_hash
        from app.models.user import User

        # Create a fresh user for this test
        test_user = User(
            username="password_change_user",
            password_hash=get_password_hash("oldpass123"),
            is_admin=False,
        )
        session.add(test_user)
        session.commit()
        session.refresh(test_user)

        # Create token for this user
        token = create_access_token(data={"sub": test_user.username})
        headers = {"Authorization": f"Bearer {token}"}

        response = client.post(
            "/api/auth/change-password?current_password=oldpass123&new_password=newpass123",
            headers=headers,
        )
        assert response.status_code == 200
        assert "success" in response.json()["message"].lower()

        # Verify can login with new password
        login_response = client.post(
            "/api/auth/token",
            data={"username": "password_change_user", "password": "newpass123"},
        )
        assert login_response.status_code == 200

    def test_change_password_wrong_current_password(
        self, client: TestClient, auth_headers_user: dict
    ):
        """Test password change fails with wrong current password."""
        response = client.post(
            "/api/auth/change-password?current_password=wrongpassword&new_password=newpass123",
            headers=auth_headers_user,
        )
        assert response.status_code == 400
        assert "incorrect" in response.json()["detail"].lower()

    def test_change_password_without_auth(self, client: TestClient):
        """Test that password change requires authentication."""
        response = client.post(
            "/api/auth/change-password?current_password=testpass&new_password=newpass123"
        )
        assert response.status_code == 401


@pytest.mark.integration
class TestTokenExpiration:
    """Test token expiration and validation."""

    def test_expired_token_rejected(self, client: TestClient):
        """Test that expired tokens are rejected."""
        from datetime import timedelta

        from app.core.security import create_access_token

        # Create token that expires immediately
        expired_token = create_access_token(
            data={"sub": "testuser"}, expires_delta=timedelta(seconds=-1)
        )

        response = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {expired_token}"}
        )
        assert response.status_code == 401

    def test_token_with_invalid_signature(self, client: TestClient):
        """Test that tokens with invalid signatures are rejected."""
        # Create a token with wrong signature
        invalid_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0dXNlciJ9.invalid_signature"

        response = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {invalid_token}"}
        )
        assert response.status_code == 401

    def test_token_with_missing_subject(self, client: TestClient):
        """Test that tokens without 'sub' claim are rejected."""
        from app.core.security import create_access_token

        # Create token without username in 'sub'
        token_no_sub = create_access_token(data={"other": "data"})

        response = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {token_no_sub}"}
        )
        assert response.status_code == 401

    def test_token_with_nonexistent_user(self, client: TestClient):
        """Test that tokens for non-existent users are rejected."""
        from app.core.security import create_access_token

        # Create token for user that doesn't exist
        token_fake_user = create_access_token(data={"sub": "nonexistentuser"})

        response = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {token_fake_user}"}
        )
        assert response.status_code == 401


@pytest.mark.integration
class TestPasswordHashingEdgeCases:
    """Test password hashing edge cases."""

    def test_empty_password_handling(self):
        """Test that empty passwords can be hashed and verified."""
        from app.core.security import get_password_hash, verify_password

        hashed = get_password_hash("")
        assert verify_password("", hashed)
        assert not verify_password("not empty", hashed)

    def test_very_long_password(self):
        """Test handling of very long passwords."""
        from app.core.security import get_password_hash, verify_password

        long_password = "a" * 1000
        hashed = get_password_hash(long_password)
        assert verify_password(long_password, hashed)

    def test_unicode_password(self):
        """Test handling of unicode characters in passwords."""
        from app.core.security import get_password_hash, verify_password

        unicode_password = "пароль密码🔐"
        hashed = get_password_hash(unicode_password)
        assert verify_password(unicode_password, hashed)
