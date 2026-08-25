"""Integration tests for persisted archive-operation lifecycle state."""

from fastapi.testclient import TestClient

from app.models.connection import Connection


def test_prepare_read_and_cancel_archive_operation(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    response = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
            "manifest_hash": "sha256:fixture",
        },
    )

    assert response.status_code == 201
    operation = response.json()
    assert operation["phase"] == "prepared"
    assert operation["cancellation_requested"] is False

    read_response = client.get(f"/api/archive/operations/{operation['id']}", headers=auth_headers_user)
    assert read_response.status_code == 200
    assert read_response.json()["manifest_hash"] == "sha256:fixture"

    transition = client.post(
        f"/api/archive/operations/{operation['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "prepared", "next_phase": "accepted"},
    )
    repeated_transition = client.post(
        f"/api/archive/operations/{operation['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "prepared", "next_phase": "accepted"},
    )
    assert transition.status_code == 200
    assert repeated_transition.status_code == 200
    assert repeated_transition.json()["phase"] == "accepted"

    first_cancel = client.post(f"/api/archive/operations/{operation['id']}/cancel", headers=auth_headers_user)
    second_cancel = client.post(f"/api/archive/operations/{operation['id']}/cancel", headers=auth_headers_user)
    assert first_cancel.status_code == 200
    assert second_cancel.status_code == 200
    assert second_cancel.json()["cancellation_requested"] is True
