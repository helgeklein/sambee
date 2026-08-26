"""Integration tests for persisted archive-operation lifecycle state."""

import json
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from unittest.mock import ANY, AsyncMock, patch
from zipfile import ZipFile

from fastapi.testclient import TestClient
from sqlmodel import select

from app.models.archive_operation import ARCHIVE_OPERATION_HEARTBEAT_TIMEOUT_SECONDS, ArchiveOperation
from app.models.audit import AuditEvent
from app.models.connection import Connection
from app.models.file import FileInfo, FileType
from app.services.archive.creation import ArchiveCreationResult
from app.services.archive.extraction import ArchiveExtractionConflict, ArchiveExtractionConflicts, ArchiveExtractionResult
from app.services.archive.operation_monitor import expire_stale_archive_operations


class MemoryRandomAccessReader:
    """Minimal archive reader used to exercise scoped relay endpoints."""

    def __init__(self, data: bytes) -> None:
        self.data = data

    async def read_at(self, offset: int, length: int) -> bytes:
        return self.data[offset : offset + length]

    async def close(self) -> None:
        return None


def test_prepare_read_and_cancel_archive_operation(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
    session,
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

    events = list(session.exec(select(AuditEvent).where(AuditEvent.correlation_id == operation["id"])).all())
    assert {(event.event_name, event.result) for event in events} == {
        ("archive.operation.lifecycle", "succeeded"),
        ("archive.operation.decision", "succeeded"),
    }
    assert len(events) == 3
    assert all("backup.zip" not in event.safe_details_json and "backup" not in event.safe_details_json for event in events)


def test_expires_a_stale_archive_operation_as_interrupted(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
    session,
) -> None:
    operation = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
        },
    ).json()
    stale_time = datetime.now(timezone.utc) - timedelta(seconds=ARCHIVE_OPERATION_HEARTBEAT_TIMEOUT_SECONDS + 1)
    stored = session.get(ArchiveOperation, uuid.UUID(operation["id"]))
    assert stored is not None
    stored.heartbeat_at = stale_time
    session.add(stored)
    session.commit()

    assert expire_stale_archive_operations(session=session) == 1

    expired = client.get(f"/api/archive/operations/{operation['id']}", headers=auth_headers_user)
    assert expired.json()["phase"] == "failed"
    assert json.loads(expired.json()["last_error_json"])["code"] == "archive_interrupted"


def test_lists_owner_archive_operations_with_active_filter(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    active = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "active.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "active",
        },
    ).json()
    completed = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": str(test_connection.id),
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "completed.zip",
            "plan_json": json.dumps({"source_paths": ["source.txt"]}),
        },
    ).json()
    client.post(
        f"/api/archive/operations/{completed['id']}/phase",
        headers=auth_headers_user,
        json={"expected_phase": "prepared", "next_phase": "cancelled"},
    )

    all_operations = client.get("/api/archive/operations", headers=auth_headers_user)
    active_operations = client.get("/api/archive/operations?active_only=true", headers=auth_headers_user)

    assert all_operations.status_code == 200
    assert {operation["id"] for operation in all_operations.json()} >= {active["id"], completed["id"]}
    assert active_operations.status_code == 200
    assert [operation["id"] for operation in active_operations.json()] == [active["id"]]


def test_mints_companion_session_only_for_mixed_archive_extraction(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
        },
    ).json()

    session = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user)

    assert session.status_code == 200
    assert session.json()["expires_in"] == 900
    assert session.json()["operation"]["phase"] == "accepted"
    assert isinstance(session.json()["token"], str)

    repeated = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user)
    assert repeated.status_code == 409

    local_destination = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "backup",
        },
    ).json()
    reverse_session = client.post(f"/api/archive/operations/{local_destination['id']}/companion-session", headers=auth_headers_user)
    assert reverse_session.status_code == 200
    assert reverse_session.json()["operation"]["phase"] == "accepted"

    same_provider = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "backup",
        },
    ).json()
    rejected = client.post(f"/api/archive/operations/{same_provider['id']}/companion-session", headers=auth_headers_user)
    assert rejected.status_code == 422


def test_companion_relay_writes_scoped_members_and_completes(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None

    async def write_member(_path, stream, **_kwargs):
        bytes_written = 0
        async for chunk in stream:
            bytes_written += len(chunk)
        return bytes_written

    backend.write_file_from_stream.side_effect = write_member
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        begin = client.post(f"/api/archive/operations/{prepared['id']}/companion-extract/begin", headers=relay_headers)
        write = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-extract/member",
            headers=relay_headers,
            params={"member_path": "nested/readme.txt"},
            content=b"hello",
        )
        duplicate = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-extract/member",
            headers=relay_headers,
            params={"member_path": "nested/readme.txt"},
            content=b"hello",
        )
        complete = client.post(f"/api/archive/operations/{prepared['id']}/companion-extract/complete", headers=relay_headers)

    assert begin.status_code == 200
    assert begin.json()["phase"] == "streaming"
    assert write.status_code == 200
    assert json.loads(write.json()["checkpoint_json"]) == {
        "files_extracted": 1,
        "directories_created": 2,
        "extracted_bytes": 5,
        "written_members": ["nested/readme.txt"],
    }
    assert duplicate.status_code == 409
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    backend.write_file_from_stream.assert_awaited_once()


def test_companion_relay_rejects_unsafe_member_path(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        client.post(f"/api/archive/operations/{prepared['id']}/companion-extract/begin", headers=relay_headers)
        response = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-extract/member",
            headers=relay_headers,
            params={"member_path": "../outside.txt"},
            content=b"blocked",
        )

    assert response.status_code == 422
    backend.write_file_from_stream.assert_not_awaited()


def test_companion_relay_creates_empty_directory_members(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        client.post(f"/api/archive/operations/{prepared['id']}/companion-extract/begin", headers=relay_headers)
        response = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-extract/member",
            headers=relay_headers,
            params={"member_path": "empty", "is_directory": "true"},
        )

    assert response.status_code == 200
    assert json.loads(response.json()["checkpoint_json"]) == {
        "files_extracted": 0,
        "directories_created": 2,
        "extracted_bytes": 0,
        "written_members": ["empty"],
    }
    backend.write_file_from_stream.assert_not_awaited()


def test_companion_local_relay_streams_smb_members_and_completes(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("empty/", b"")
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(f"/api/archive/operations/{prepared['id']}/companion-local-extract/begin", headers=relay_headers)
        member = client.get(
            f"/api/archive/operations/{prepared['id']}/companion-local-extract/member",
            headers=relay_headers,
            params={"member_path": "readme.txt"},
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-local-extract/complete",
            headers=relay_headers,
            json={"files_extracted": 1, "directories_created": 2, "extracted_bytes": 5},
        )

    assert manifest.status_code == 200
    assert manifest.json()["operation"]["phase"] == "streaming"
    assert manifest.json()["entries"] == [
        {"path": "empty", "is_directory": True, "uncompressed_size": 0},
        {"path": "readme.txt", "is_directory": False, "uncompressed_size": 5},
    ]
    assert member.status_code == 200
    assert member.content == b"hello"
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    checkpoint = json.loads(complete.json()["checkpoint_json"])
    assert checkpoint["extracted_bytes"] == 5
    assert checkpoint["source_identity"] == {"size": len(archive_bytes), "modified_at": None}
    assert checkpoint["archive_manifest"] == manifest.json()["entries"]


def test_companion_local_extraction_relay_reuses_its_persisted_manifest(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        first_manifest = client.post(f"/api/archive/operations/{prepared['id']}/companion-local-extract/begin", headers=relay_headers)
        backend.get_file_info.reset_mock()
        backend.open_random_access_reader.reset_mock()
        repeated_manifest = client.post(f"/api/archive/operations/{prepared['id']}/companion-local-extract/begin", headers=relay_headers)

    assert first_manifest.status_code == 200
    assert repeated_manifest.status_code == 200
    assert repeated_manifest.json()["entries"] == first_manifest.json()["entries"]
    backend.connect.assert_awaited_once()
    backend.get_file_info.assert_not_awaited()
    backend.open_random_access_reader.assert_not_awaited()


def test_companion_local_relay_rejects_an_archive_changed_after_manifest_preflight(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.side_effect = [
        FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes)),
        FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes) + 1),
    ]
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(f"/api/archive/operations/{prepared['id']}/companion-local-extract/begin", headers=relay_headers)
        member = client.get(
            f"/api/archive/operations/{prepared['id']}/companion-local-extract/member",
            headers=relay_headers,
            params={"member_path": "readme.txt"},
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert manifest.status_code == 200
    assert member.status_code == 409
    assert operation.json()["phase"] == "failed"


def test_companion_local_relay_rejects_a_member_outside_its_preflight_manifest(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w") as archive:
        archive.writestr("readme.txt", b"hello")
    archive_bytes = archive_buffer.getvalue()
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": str(test_connection.id),
            "source_path": "backup.zip",
            "destination_connection_id": "local-drive:c",
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="backup.zip", path="backup.zip", type=FileType.FILE, size=len(archive_bytes))
    backend.open_random_access_reader.side_effect = lambda _path: MemoryRandomAccessReader(archive_bytes)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(f"/api/archive/operations/{prepared['id']}/companion-local-extract/begin", headers=relay_headers)
        backend.open_random_access_reader.reset_mock()
        member = client.get(
            f"/api/archive/operations/{prepared['id']}/companion-local-extract/member",
            headers=relay_headers,
            params={"member_path": "not-approved.txt"},
        )

    assert manifest.status_code == 200
    assert member.status_code == 422
    backend.open_random_access_reader.assert_not_awaited()


def test_companion_local_creation_relay_streams_smb_members_and_completes(
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
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)

    async def source_chunks():
        yield b"hello"

    backend.read_file = lambda _path: source_chunks()
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(f"/api/archive/operations/{prepared['id']}/companion-local-create/begin", headers=relay_headers)
        member = client.get(
            f"/api/archive/operations/{prepared['id']}/companion-local-create/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-local-create/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 5},
        )

    assert manifest.status_code == 200
    assert manifest.json()["operation"]["phase"] == "streaming"
    assert manifest.json()["entries"] == [
        {
            "source_path": "readme.txt",
            "archive_path": "readme.txt",
            "is_directory": False,
            "source_size": 5,
            "modified_at": None,
        }
    ]
    assert member.status_code == 200
    assert member.content == b"hello"
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    checkpoint = json.loads(complete.json()["checkpoint_json"])
    assert checkpoint["source_bytes"] == 5
    assert checkpoint["source_manifest"] == [
        {
            "source_path": "readme.txt",
            "archive_path": "readme.txt",
            "is_directory": False,
            "source_identity": {"size": 5, "modified_at": None},
        }
    ]


def test_companion_local_creation_relay_reuses_its_persisted_manifest(
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
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        first_manifest = client.post(f"/api/archive/operations/{prepared['id']}/companion-local-create/begin", headers=relay_headers)
        backend.get_file_info.reset_mock()
        repeated_manifest = client.post(f"/api/archive/operations/{prepared['id']}/companion-local-create/begin", headers=relay_headers)

    assert first_manifest.status_code == 200
    assert repeated_manifest.status_code == 200
    assert repeated_manifest.json()["entries"] == first_manifest.json()["entries"]
    backend.connect.assert_awaited_once()
    backend.get_file_info.assert_not_awaited()


def test_companion_local_creation_relay_rejects_a_source_changed_after_manifest_preflight(
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
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.side_effect = [
        FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5),
        FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=6),
    ]
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(f"/api/archive/operations/{prepared['id']}/companion-local-create/begin", headers=relay_headers)
        member = client.get(
            f"/api/archive/operations/{prepared['id']}/companion-local-create/member",
            headers=relay_headers,
            params={"archive_path": "readme.txt"},
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert manifest.status_code == 200
    assert member.status_code == 409
    assert operation.json()["phase"] == "failed"


def test_companion_local_creation_relay_rejects_an_inconsistent_completion_summary(
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
            "destination_connection_id": "local-drive:c",
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.get_file_info.return_value = FileInfo(name="readme.txt", path="readme.txt", type=FileType.FILE, size=5)
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        manifest = client.post(f"/api/archive/operations/{prepared['id']}/companion-local-create/begin", headers=relay_headers)
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-local-create/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 4},
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert manifest.status_code == 200
    assert complete.status_code == 409
    assert operation.json()["phase"] == "failed"


def test_companion_smb_creation_relay_writes_local_zip_stream_and_completes(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "create",
            "source_connection_id": "local-drive:c",
            "source_path": "",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output.zip",
            "plan_json": json.dumps({"source_paths": ["readme.txt"]}),
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    writer = AsyncMock()
    writer.write.side_effect = lambda data: len(data)
    backend.open_exclusive_writer.return_value = writer

    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        stream = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-smb-create/stream",
            headers=relay_headers,
            content=b"zip-bytes",
        )
        complete = client.post(
            f"/api/archive/operations/{prepared['id']}/companion-smb-create/complete",
            headers=relay_headers,
            json={"files_created": 1, "directories_created": 0, "source_bytes": 9},
        )

    assert stream.status_code == 200
    assert stream.json()["phase"] == "streaming"
    writer.write.assert_awaited_once_with(b"zip-bytes")
    writer.close.assert_awaited_once()
    assert complete.status_code == 200
    assert complete.json()["phase"] == "completed"
    assert json.loads(complete.json()["checkpoint_json"])["source_bytes"] == 9


def test_companion_relay_marks_destination_collision_as_failed(
    client: TestClient,
    auth_headers_user: dict,
    test_connection: Connection,
) -> None:
    prepared = client.post(
        "/api/archive/operations",
        headers=auth_headers_user,
        json={
            "kind": "extract",
            "source_connection_id": "local-drive:c",
            "source_path": "backup.zip",
            "destination_connection_id": str(test_connection.id),
            "destination_path": "output",
        },
    ).json()
    capability = client.post(f"/api/archive/operations/{prepared['id']}/companion-session", headers=auth_headers_user).json()
    relay_headers = {"Authorization": f"Bearer {capability['token']}"}
    backend = AsyncMock()
    backend.connect.return_value = None
    backend.disconnect.return_value = None
    backend.create_directory.return_value = None
    backend.write_file_from_stream.side_effect = FileExistsError()
    with patch("app.api.archive_operations.SMBBackend", return_value=backend):
        client.post(f"/api/archive/operations/{prepared['id']}/companion-extract/begin", headers=relay_headers)
        response = client.put(
            f"/api/archive/operations/{prepared['id']}/companion-extract/member",
            headers=relay_headers,
            params={"member_path": "existing.txt"},
            content=b"blocked",
        )
        operation = client.get(f"/api/archive/operations/{prepared['id']}", headers=auth_headers_user)

    assert response.status_code == 409
    assert operation.json()["phase"] == "failed"


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
