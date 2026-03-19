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
        assert len(data) == 2
        assert {user["username"] for user in data} == {admin_user.username, regular_user.username}

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
                "role": "regular",
                "must_change_password": True,
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["username"] == "newuser"
        assert data["role"] == "regular"
        assert data["must_change_password"] is True
        assert isinstance(data["temporary_password"], str)
        assert len(data["temporary_password"]) >= 12

        created_user = session.get(User, uuid.UUID(data["id"]))
        assert created_user is not None
        assert created_user.role == UserRole.REGULAR
        assert created_user.must_change_password is True
        assert verify_password(data["temporary_password"], created_user.password_hash)

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
                "role": "admin",
                "is_active": False,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "admin"
        assert data["is_active"] is False

        session.refresh(regular_user)
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
        response = client.post(f"/api/admin/users/{regular_user.id}/reset-password", headers=auth_headers_admin)

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Password reset successfully"
        assert isinstance(data["temporary_password"], str)

        session.refresh(regular_user)
        assert regular_user.must_change_password is True
        assert regular_user.token_version == 1
        assert verify_password(data["temporary_password"], regular_user.password_hash)

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
