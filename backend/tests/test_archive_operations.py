"""Integration tests for persisted archive-operation lifecycle state."""

import json
from unittest.mock import ANY, AsyncMock, patch

from fastapi.testclient import TestClient

from app.models.connection import Connection
from app.services.archive.creation import ArchiveCreationResult
from app.services.archive.extraction import ArchiveExtractionConflict, ArchiveExtractionConflicts, ArchiveExtractionResult


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


def test_executes_same_connection_creation_from_immutable_plan(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup.zip",
            "plan_json": json.dumps({"source_paths": ["first.txt", "second.txt"]}),
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.create_archive_from_files", new=AsyncMock(return_value=ArchiveCreationResult(2, 11))
        ) as create_archive,
    ):
        response = client.post(f"/api/archive/operations/{prepared['id']}/execute-create", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "completed"
    assert json.loads(response.json()["checkpoint_json"]) == {"files_created": 2, "directories_created": 0, "source_bytes": 11}
    create_archive.assert_awaited_once_with(
        backend,
        source_paths=["first.txt", "second.txt"],
        target_path="backup.zip",
        is_cancelled=ANY,
    )


def test_executes_same_connection_extraction(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(return_value=ArchiveExtractionResult(2, 2, 10)),
        ) as extract_archive,
    ):
        response = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "completed"
    assert json.loads(response.json()["checkpoint_json"]) == {
        "files_extracted": 2,
        "directories_created": 2,
        "extracted_bytes": 10,
        "files_skipped": 0,
        "files_replaced": 0,
        "skipped_members": [],
        "replaced_members": [],
        "renamed_members": [],
    }
    extract_archive.assert_awaited_once_with(
        backend,
        archive_path="input.zip",
        destination_root="output",
        existing_file_policy=None,
        member_collision_actions={},
        member_rename_targets={},
        is_cancelled=ANY,
    )


def test_extraction_conflicts_become_pending_user_decisions(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None

    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(side_effect=ArchiveExtractionConflicts([ArchiveExtractionConflict("root.txt", "output/root.txt")])),
        ),
    ):
        response = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert response.status_code == 200
    assert response.json()["phase"] == "awaiting_user_decision"
    assert json.loads(response.json()["pending_decision_json"])["conflicts"] == [
        {"member_path": "root.txt", "target_path": "output/root.txt", "is_directory": False}
    ]

    decision = client.post(
        f"/api/archive/operations/{prepared['id']}/decide-extraction",
        headers=auth_headers_user,
        json={"action": "skip_all"},
    )
    assert decision.status_code == 200
    assert decision.json()["phase"] == "streaming"
    assert decision.json()["collision_policy"] == "skip_all"


def test_individual_extraction_decision_is_limited_to_pending_member(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(side_effect=ArchiveExtractionConflicts([ArchiveExtractionConflict("root.txt", "output/root.txt")])),
        ),
    ):
        client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    response = client.post(
        f"/api/archive/operations/{prepared['id']}/decide-extraction",
        headers=auth_headers_user,
        json={"action": "skip", "member_path": "root.txt"},
    )

    assert response.status_code == 200
    assert response.json()["phase"] == "streaming"
    assert response.json()["collision_policy"] is None
    assert json.loads(response.json()["checkpoint_json"]) == {"member_collision_actions": {"root.txt": "skip"}}

    with patch(
        "app.api.archive_operations.extract_archive_to_new_paths",
        new=AsyncMock(return_value=ArchiveExtractionResult(1, 1, 6, files_skipped=1, skipped_members=("root.txt",))),
    ) as extract_archive:
        resumed = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert resumed.status_code == 200
    assert resumed.json()["phase"] == "completed"
    assert json.loads(resumed.json()["checkpoint_json"])["skipped_members"] == ["root.txt"]
    assert extract_archive.await_args.kwargs["member_collision_actions"] == {"root.txt": "skip"}


def test_individual_rename_decision_persists_a_safe_member_remap(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "input.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    with (
        patch("app.api.archive_operations.SMBBackend", return_value=backend),
        patch(
            "app.api.archive_operations.extract_archive_to_new_paths",
            new=AsyncMock(side_effect=ArchiveExtractionConflicts([ArchiveExtractionConflict("root.txt", "output/root.txt")])),
        ),
    ):
        client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    response = client.post(
        f"/api/archive/operations/{prepared['id']}/decide-extraction",
        headers=auth_headers_user,
        json={"action": "rename", "member_path": "root.txt", "target_path": "renamed/root-copy.txt"},
    )

    assert response.status_code == 200
    assert json.loads(response.json()["checkpoint_json"]) == {"member_rename_targets": {"root.txt": "renamed/root-copy.txt"}}

    with patch(
        "app.api.archive_operations.extract_archive_to_new_paths",
        new=AsyncMock(return_value=ArchiveExtractionResult(1, 1, 4, renamed_members=("root.txt",))),
    ) as extract_archive:
        resumed = client.post(f"/api/archive/operations/{prepared['id']}/execute-extract", headers=auth_headers_user)

    assert resumed.status_code == 200
    assert json.loads(resumed.json()["checkpoint_json"])["renamed_members"] == ["root.txt"]
    assert extract_archive.await_args.kwargs["member_rename_targets"] == {"root.txt": "renamed/root-copy.txt"}
