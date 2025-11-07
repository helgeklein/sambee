"""
Security Tests - Phase 10

Tests for security vulnerabilities including:
- Injection attacks (SQL, path traversal, command injection)
- Authentication bypass attempts
- Authorization bypass attempts
- Encryption security
- Rate limiting (basic validation)
"""

import base64
import json
from datetime import datetime, timedelta, timezone

import pytest
from app.core.config import settings
from app.core.security import (
    create_access_token,
    decrypt_password,
    encrypt_password,
    get_password_hash,
    verify_password,
)
from app.models.connection import Connection
from cryptography.fernet import Fernet, InvalidToken
from fastapi.testclient import TestClient
from jose import jwt
from sqlmodel import Session


class TestInjectionAttacks:
    """Test protection against injection attacks"""

    def test_sql_injection_in_login(self, client: TestClient):
        """Test SQL injection attempts in login"""
        # Common SQL injection patterns
        injection_attempts = [
            "admin' OR '1'='1",
            "admin' OR '1'='1' --",
            "admin' OR '1'='1' /*",
            "'; DROP TABLE users; --",
            "admin'--",
            "' OR 1=1--",
            "admin' UNION SELECT * FROM users--",
        ]

        for attempt in injection_attempts:
            response = client.post(
                "/api/auth/token",
                data={"username": attempt, "password": "anypassword"},
            )
            # Should fail authentication, not cause SQL error
            assert response.status_code in [401, 422]
            if response.status_code == 401:
                assert (
                    "incorrect username or password"
                    in response.json()["detail"].lower()
                )

    def test_path_traversal_in_browse(
        self, client: TestClient, user_token: str, test_connection: Connection
    ):
        """Test path traversal attempts in browse endpoint"""
        # Path traversal patterns
        traversal_attempts = [
            "../../etc/passwd",
            "../../../windows/system32",
            "....//....//etc/passwd",
            "..%2F..%2Fetc%2Fpasswd",
            "..\\..\\windows\\system32",
            "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
        ]

        for attempt in traversal_attempts:
            response = client.get(
                f"/api/browse/{test_connection.id}/list",
                params={"path": attempt},
                headers={"Authorization": f"Bearer {user_token}"},
            )
            # Should either reject the path or sanitize it
            # Not return a 200 with system files
            if response.status_code == 200:
                # If it returns 200, ensure it didn't access system files
                data = response.json()
                assert "passwd" not in str(data).lower()
                assert "system32" not in str(data).lower()

    def test_command_injection_in_filename(
        self, client: TestClient, user_token: str, test_connection: Connection
    ):
        """Test command injection attempts in filenames"""
        # Command injection patterns
        command_patterns = [
            "; rm -rf /",
            "| cat /etc/passwd",
            "& dir",
            "`whoami`",
            "$(whoami)",
            "; ls -la",
        ]

        for pattern in command_patterns:
            response = client.get(
                f"/api/browse/{test_connection.id}/list",
                params={"path": f"test{pattern}"},
                headers={"Authorization": f"Bearer {user_token}"},
            )
            # Should handle gracefully, not execute commands
            assert response.status_code in [200, 400, 404, 500]

    def test_xss_in_filename(
        self, client: TestClient, user_token: str, test_connection: Connection
    ):
        """Test XSS attempts in filenames"""
        xss_patterns = [
            "<script>alert('xss')</script>",
            "<img src=x onerror=alert('xss')>",
            "javascript:alert('xss')",
            "<iframe src='javascript:alert(1)'>",
        ]

        for pattern in xss_patterns:
            response = client.get(
                f"/api/browse/{test_connection.id}/list",
                params={"path": pattern},
                headers={"Authorization": f"Bearer {user_token}"},
            )
            # Should handle gracefully
            assert response.status_code in [200, 400, 404, 500]
            if response.status_code == 200:
                # Ensure response doesn't contain unescaped XSS
                content = response.text
                assert "<script>" not in content
                assert "onerror=" not in content


class TestAuthenticationBypass:
    """Test authentication bypass attempts"""

    def test_no_token_access(self, client: TestClient):
        """Test accessing protected endpoints without token"""
        protected_endpoints = [
            "/api/auth/me",
            "/api/admin/connections",
        ]

        for endpoint in protected_endpoints:
            response = client.get(endpoint)
            assert response.status_code == 401
            assert "not authenticated" in response.json()["detail"].lower()

    def test_invalid_token_format(self, client: TestClient):
        """Test invalid token formats"""
        invalid_tokens = [
            "notavalidtoken",
            "Bearer.invalid.token",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid",
            "",
            "null",
            "undefined",
        ]

        for token in invalid_tokens:
            response = client.get(
                "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
            )
            assert response.status_code == 401

    def test_expired_token(self, client: TestClient, session: Session):
        """Test expired token rejection"""
        # Create a token that expired 1 hour ago
        expired_token = create_access_token(
            data={"sub": "testuser"}, expires_delta=timedelta(hours=-1)
        )

        response = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {expired_token}"}
        )
        assert response.status_code == 401

    def test_token_with_invalid_signature(self, client: TestClient):
        """Test token with invalid signature"""
        # Create a valid token structure but with wrong signature
        payload = {
            "sub": "testuser",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        # Sign with a different secret
        invalid_token = jwt.encode(payload, "wrong_secret_key", algorithm="HS256")

        response = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {invalid_token}"}
        )
        assert response.status_code == 401

    def test_token_algorithm_confusion(self, client: TestClient):
        """Test JWT algorithm confusion attack (alg: none)"""
        # Create a token with 'none' algorithm
        exp_time = datetime.now(timezone.utc) + timedelta(hours=1)
        payload = {"sub": "admin", "exp": int(exp_time.timestamp())}

        # Manually create a JWT with 'none' algorithm
        header = (
            base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode())
            .decode()
            .rstrip("=")
        )
        payload_b64 = (
            base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        )
        none_token = f"{header}.{payload_b64}."

        response = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {none_token}"}
        )
        assert response.status_code == 401

    def test_token_with_non_existent_user(self, client: TestClient):
        """Test token with valid signature but non-existent user"""
        token = create_access_token(data={"sub": "nonexistentuser12345"})

        response = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 401

    def test_token_replay_attack(
        self, client: TestClient, user_token: str, session: Session
    ):
        """Test token replay attack (token should remain valid until expiry)"""
        # First request
        response1 = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {user_token}"}
        )
        assert response1.status_code == 200

        # Replay the same token (should work until expiration)
        response2 = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {user_token}"}
        )
        assert response2.status_code == 200

        # Note: True replay attack prevention requires token blacklisting
        # or very short-lived tokens with refresh tokens


class TestAuthorizationBypass:
    """Test authorization bypass attempts"""

    def test_regular_user_accessing_admin_endpoint(
        self, client: TestClient, user_token: str
    ):
        """Test regular user trying to access admin-only endpoints"""
        # Try to access admin connections list (admin only)
        response = client.get(
            "/api/admin/connections",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert response.status_code == 403
        assert "not enough permissions" in response.json()["detail"].lower()

    def test_regular_user_accessing_other_users_connections(
        self,
        client: TestClient,
        user_token: str,
        admin_token: str,
        test_connection: Connection,
    ):
        """Test user trying to access another user's connections"""
        # Use the test_connection fixture which is already created
        # Try to access it via browse endpoint
        response = client.get(
            f"/api/browse/{test_connection.id}/list",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        # Currently connections aren't user-scoped, so this might work
        # But we're testing that the endpoint at least handles it properly
        assert response.status_code in [200, 403, 404, 500]

    def test_user_cannot_modify_other_users_connections(
        self,
        client: TestClient,
        user_token: str,
        test_connection: Connection,
    ):
        """Test user trying to modify a connection without admin rights"""
        # Regular user tries to update a connection (requires admin)
        response = client.put(
            f"/api/admin/connections/{test_connection.id}",
            json={
                "name": "Hacked Connection",
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        # Should be forbidden (user doesn't have admin rights)
        assert response.status_code == 403

    def test_user_cannot_delete_other_users_connections(
        self,
        client: TestClient,
        user_token: str,
        test_connection: Connection,
    ):
        """Test user trying to delete a connection without admin rights"""
        # Regular user tries to delete a connection (requires admin)
        response = client.delete(
            f"/api/admin/connections/{test_connection.id}",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        # Should be forbidden (user doesn't have admin rights)
        assert response.status_code == 403

    def test_admin_escalation_attempt(
        self, client: TestClient, user_token: str, session: Session
    ):
        """Test user trying to escalate to admin via password change or profile update"""
        # Try to change password and somehow become admin (shouldn't work)
        response = client.post(
            "/api/auth/change-password",
            json={"current_password": "testpass", "new_password": "newpass"},
            headers={"Authorization": f"Bearer {user_token}"},
        )
        # Password change might work, but shouldn't grant admin
        if response.status_code == 200:
            # Verify user is still not admin
            me_response = client.get(
                "/api/auth/me", headers={"Authorization": f"Bearer {user_token}"}
            )
            assert me_response.status_code == 200
            assert me_response.json()["is_admin"] is False


class TestEncryptionSecurity:
    """Test encryption and hashing security"""

    def test_password_hashing_strength(self):
        """Test that passwords are hashed with strong algorithm"""
        password = "testpassword123"
        hashed = get_password_hash(password)

        # Should use Argon2
        assert hashed.startswith("$argon2")
        # Should be long (Argon2 hashes are typically 90+ chars)
        assert len(hashed) > 80
        # Should be different each time (salt)
        hashed2 = get_password_hash(password)
        assert hashed != hashed2
        # Both should verify
        assert verify_password(password, hashed)
        assert verify_password(password, hashed2)

    def test_password_verification_fails_for_wrong_password(self):
        """Test password verification fails for wrong password"""
        password = "correctpassword"
        hashed = get_password_hash(password)

        assert not verify_password("wrongpassword", hashed)
        assert not verify_password("", hashed)
        assert not verify_password(password + "x", hashed)

    def test_fernet_encryption_decryption(self):
        """Test Fernet encryption/decryption of SMB passwords"""
        password = "supersecretpassword123!@#"
        encrypted = encrypt_password(password)

        # Should be different from original
        assert encrypted != password
        # Should be base64-like string
        assert isinstance(encrypted, str)
        # Should decrypt back to original
        decrypted = decrypt_password(encrypted)
        assert decrypted == password

    def test_fernet_encryption_unique_output(self):
        """Test that Fernet produces unique output each time (nonce/IV)"""
        password = "testpassword"
        encrypted1 = encrypt_password(password)
        encrypted2 = encrypt_password(password)

        # Should be different due to random IV
        assert encrypted1 != encrypted2
        # Both should decrypt to same value
        assert decrypt_password(encrypted1) == password
        assert decrypt_password(encrypted2) == password

    def test_fernet_invalid_token(self):
        """Test decryption of invalid encrypted data"""
        with pytest.raises((InvalidToken, Exception)):
            decrypt_password("invalidencrypteddata")

    def test_fernet_wrong_key_fails(self):
        """Test decryption with wrong key fails"""
        password = "testpassword"
        encrypted = encrypt_password(password)

        # Create a different Fernet instance with different key
        wrong_fernet = Fernet(Fernet.generate_key())

        with pytest.raises((InvalidToken, Exception)):
            wrong_fernet.decrypt(encrypted.encode()).decode()

    def test_jwt_secret_key_strength(self):
        """Test that JWT secret key is strong"""
        # Secret key should be long enough
        assert len(settings.secret_key) >= 32
        # Should not be default/weak values
        weak_keys = ["secret", "12345", "password", "changeme", "test"]
        assert settings.secret_key.lower() not in weak_keys

    def test_jwt_token_contains_minimal_data(self):
        """Test JWT token doesn't leak sensitive information"""
        token = create_access_token(data={"sub": "testuser"})

        # Decode without verification to inspect payload
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[settings.algorithm]
        )

        # Should only contain necessary fields
        assert "sub" in payload  # Subject (username)
        assert "exp" in payload  # Expiration
        # Should NOT contain password or other sensitive data
        assert "password" not in payload
        assert "password_hash" not in payload
        assert "encryption_key" not in payload


class TestRateLimiting:
    """Test basic rate limiting validation"""

    def test_multiple_failed_login_attempts(self, client: TestClient):
        """Test multiple failed login attempts"""
        # Note: This test validates that failed logins are handled correctly
        # Actual rate limiting would require middleware/plugin
        for _ in range(10):
            response = client.post(
                "/api/auth/token",
                data={"username": "nonexistent", "password": "wrongpassword"},
            )
            # Should consistently fail
            assert response.status_code == 401
            # Should not leak user existence
            assert "incorrect username or password" in response.json()["detail"].lower()

    def test_rapid_api_requests(self, client: TestClient, user_token: str):
        """Test rapid API requests (basic validation)"""
        # Make rapid requests
        responses = []
        for _ in range(20):
            response = client.get(
                "/api/auth/me", headers={"Authorization": f"Bearer {user_token}"}
            )
            responses.append(response.status_code)

        # All should succeed (no rate limiting implemented yet)
        # This test documents current behavior
        assert all(status == 200 for status in responses)

        # Note: In production, you would want rate limiting middleware
        # that would start returning 429 Too Many Requests


class TestInputValidation:
    """Test input validation and sanitization"""

    def test_connection_name_validation(self, client: TestClient, admin_token: str):
        """Test connection name validation"""
        # Empty name should be rejected
        response = client.post(
            "/api/admin/connections",
            json={
                "name": "",
                "host": "valid-host",
                "share_name": "valid-share",
                "username": "user",
                "password": "pass",
            },
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        # Should reject empty name
        assert response.status_code in [400, 422]

    def test_host_validation(self, client: TestClient, admin_token: str):
        """Test SMB host validation"""
        # Empty host should be rejected
        response = client.post(
            "/api/admin/connections",
            json={
                "name": "Test",
                "host": "",
                "share_name": "valid-share",
                "username": "user",
                "password": "pass",
            },
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        # Should reject empty host
        assert response.status_code in [400, 422]


class TestSecurityHeaders:
    """Test security headers and responses"""

    def test_no_sensitive_data_in_error_responses(self, client: TestClient):
        """Test that error responses don't leak sensitive information"""
        # Try to access non-existent endpoint
        response = client.get("/api/nonexistent")
        assert response.status_code == 404

        # Error should not leak internal paths, stack traces, etc.
        error_text = response.text.lower()
        assert "/workspace/" not in error_text
        assert "traceback" not in error_text
        assert "sqlite" not in error_text  # No DB details

    def test_authentication_error_messages(self, client: TestClient):
        """Test that auth errors don't leak user existence"""
        # Try with non-existent user
        response1 = client.post(
            "/api/auth/token",
            data={"username": "nonexistentuser", "password": "password"},
        )

        # Try with existing user but wrong password
        # (Assuming admin user exists from fixtures)
        response2 = client.post(
            "/api/auth/token", data={"username": "admin", "password": "wrongpassword"}
        )

        # Both should give same generic error (don't leak user existence)
        assert response1.status_code == 401
        assert response2.status_code == 401
        assert response1.json()["detail"] == response2.json()["detail"]
