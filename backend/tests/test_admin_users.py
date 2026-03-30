"""Tests for admin user management endpoints."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.security import verify_password
from app.models.user import User, UserRole


@pytest.mark.integration
class TestAdminUsers:
    def test_list_users_as_admin(self, client: TestClient, auth_headers_admin: dict, admin_user: User, regular_user: User):
        response = client.get("/api/admin/users", headers=auth_headers_admin)

        assert response.status_code == 200
        data = response.json()
        usernames = {user["username"] for user in data}
        assert len(data) >= 2
        assert {admin_user.username, regular_user.username}.issubset(usernames)

    def test_list_users_as_regular_user_forbidden(
        self,
        client: TestClient,
        auth_headers_user: dict,
        admin_user: User,
        regular_user: User,
    ):
        response = client.get("/api/admin/users", headers=auth_headers_user)

        assert response.status_code == 403

    def test_create_user_generates_temporary_password(self, client: TestClient, auth_headers_admin: dict, session: Session):
        response = client.post(
            "/api/admin/users",
            headers=auth_headers_admin,
            json={
                "username": "newuser",
                "name": "New User",
                "email": "newuser@example.com",
                "role": "editor",
                "must_change_password": True,
                "expires_at": "2030-01-01T00:00:00Z",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["username"] == "newuser"
        assert data["name"] == "New User"
        assert data["email"] == "newuser@example.com"
        assert data["role"] == "editor"
        assert data["must_change_password"] is True
        assert data["expires_at"] == "2030-01-01T00:00:00Z"
        assert isinstance(data["temporary_password"], str)
        assert len(data["temporary_password"]) >= 12

        created_user = session.get(User, uuid.UUID(data["id"]))
        assert created_user is not None
        assert created_user.name == "New User"
        assert created_user.email == "newuser@example.com"
        assert created_user.role == UserRole.EDITOR
        assert created_user.must_change_password is True
        assert verify_password(data["temporary_password"], created_user.password_hash)

    def test_create_user_rejects_legacy_regular_role(self, client: TestClient, auth_headers_admin: dict):
        response = client.post(
            "/api/admin/users",
            headers=auth_headers_admin,
            json={
                "username": "legacyroleuser",
                "role": "regular",
            },
        )

        assert response.status_code == 422

    def test_update_user_role_and_active_state(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        regular_user: User,
        session: Session,
    ):
        response = client.patch(
            f"/api/admin/users/{regular_user.id}",
            headers=auth_headers_admin,
            json={
                "name": "Updated Test User",
                "email": "updated-testuser@example.com",
                "role": "admin",
                "is_active": False,
                "expires_at": "2031-02-03T04:05:06Z",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Test User"
        assert data["email"] == "updated-testuser@example.com"
        assert data["role"] == "admin"
        assert data["is_active"] is False
        assert data["expires_at"] == "2031-02-03T04:05:06Z"

        session.refresh(regular_user)
        assert regular_user.name == "Updated Test User"
        assert regular_user.email == "updated-testuser@example.com"
        assert regular_user.role == UserRole.ADMIN
        assert regular_user.is_active is False

    def test_reset_password_invalidates_existing_token(
        self,
        client: TestClient,
        auth_headers_admin: dict,
        regular_user: User,
        user_token: str,
        session: Session,
    ):
        response = client.post(
            f"/api/admin/users/{regular_user.id}/reset-password",
            headers=auth_headers_admin,
            json={
                "new_password": "BrandNewPass123!",
                "must_change_password": False,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Password reset successfully"

        session.refresh(regular_user)
        assert regular_user.must_change_password is False
        assert regular_user.token_version == 1
        assert verify_password("BrandNewPass123!", regular_user.password_hash)

        old_token_response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {user_token}"})
        assert old_token_response.status_code == 401

    def test_cannot_delete_last_active_admin(self, client: TestClient, auth_headers_admin: dict, admin_user: User):
        response = client.delete(f"/api/admin/users/{admin_user.id}", headers=auth_headers_admin)

        assert response.status_code == 400
        assert "admin" in response.json()["detail"].lower()

    def test_delete_regular_user(self, client: TestClient, auth_headers_admin: dict, regular_user: User, session: Session):
        response = client.delete(f"/api/admin/users/{regular_user.id}", headers=auth_headers_admin)

        assert response.status_code == 200
        assert response.json()["message"] == "User deleted successfully"
        assert session.get(User, regular_user.id) is None
