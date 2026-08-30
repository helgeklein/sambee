"""Loopback compatibility coverage for the backend V2 relay API and Companion transport."""

import json
import os
import socket
import subprocess
import threading
import time
from datetime import timedelta
from pathlib import Path
from urllib.request import Request, urlopen

import uvicorn

from app.api import archive_operations
from app.core.security import create_access_token
from app.db.database import get_session
from app.main import app
from app.models.archive_operation import ArchiveOperation, ArchiveOperationKind, ArchiveOperationPhase
from app.models.user import User
from app.services.archive.v2_checkpoint import new_v2_creation_checkpoint, new_v2_extraction_checkpoint


class _LoopbackCreationExecution:
    def __init__(self) -> None:
        self.finalized = False

    def is_active(self) -> bool:
        return True

    async def finalize(self) -> None:
        self.finalized = True

    async def abort(self) -> None:
        return None


class _LoopbackCreationWriterManager:
    def __init__(self) -> None:
        self.execution_by_operation: dict[object, _LoopbackCreationExecution] = {}

    def execution(self, operation_id: object) -> _LoopbackCreationExecution:
        return self.execution_by_operation.setdefault(operation_id, _LoopbackCreationExecution())


def _available_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as socket_handle:
        socket_handle.bind(("127.0.0.1", 0))
        return int(socket_handle.getsockname()[1])


def _streaming_operation(user: User, kind: ArchiveOperationKind, *, source_is_local: bool) -> ArchiveOperation:
    checkpoint = (
        new_v2_extraction_checkpoint(manifest=[], source_snapshot={"size": 0, "modified_at": None})
        if kind == ArchiveOperationKind.EXTRACT
        else new_v2_creation_checkpoint(
            manifest=[
                {
                    "archive_path": "report.txt",
                    "is_directory": False,
                    "source_size": 3,
                    "source_path": "report.txt",
                    "modified_at": None,
                }
            ]
        )
    )
    if kind == ArchiveOperationKind.CREATE and source_is_local:
        checkpoint["member_outcomes"] = {"report.txt": {"status": "created", "source_bytes": 3}}
    return ArchiveOperation(
        user_id=user.id,
        kind=kind,
        phase=ArchiveOperationPhase.STREAMING,
        source_connection_id="local-drive:c" if source_is_local else "smb-source",
        source_path="source.zip",
        destination_connection_id="smb-destination" if source_is_local else "local-drive:d",
        destination_path="archive-output.zip",
        checkpoint_json=json.dumps(checkpoint),
    )


def test_companion_relay_transport_interoperates_with_fastapi(session, regular_user: User, monkeypatch) -> None:
    """Run every mixed V2 relay binding through real HTTP serialization on loopback."""

    operations = [
        (
            _streaming_operation(regular_user, ArchiveOperationKind.EXTRACT, source_is_local=True),
            "local_zip_to_smb_extract",
            "complete_replay",
        ),
        (
            _streaming_operation(regular_user, ArchiveOperationKind.EXTRACT, source_is_local=False),
            "smb_zip_to_local_extract",
            "extraction_complete",
        ),
        (
            _streaming_operation(regular_user, ArchiveOperationKind.CREATE, source_is_local=False),
            "smb_to_local_zip_create",
            "creation_member_complete",
        ),
        (
            _streaming_operation(regular_user, ArchiveOperationKind.CREATE, source_is_local=True),
            "local_to_smb_zip_create",
            "creation_complete",
        ),
    ]
    writer_manager = _LoopbackCreationWriterManager()
    monkeypatch.setattr(archive_operations, "_local_to_smb_creation_writers", writer_manager)
    for operation, _purpose, _action in operations:
        session.add(operation)
    session.commit()
    checkpoints = {operation.id: operation.checkpoint_json for operation, _purpose, _action in operations}
    for operation, _purpose, _action in operations:
        operation.phase = ArchiveOperationPhase.PREPARED
        operation.checkpoint_json = None
    session.commit()

    def get_session_override():
        yield session

    port = _available_loopback_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, lifespan="off", log_level="warning"))
    app.dependency_overrides[get_session] = get_session_override
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            if time.monotonic() >= deadline:
                raise TimeoutError("FastAPI relay interoperability server did not start")
            time.sleep(0.01)
        user_token = create_access_token(
            data={"sub": regular_user.username, "tv": regular_user.token_version},
            expires_delta=timedelta(minutes=5),
        )
        companion_tokens = {}
        for operation, _purpose, _action in operations:
            request = Request(
                f"http://127.0.0.1:{port}/api/archive/v2/operations/{operation.id}/companion-session",
                method="POST",
                headers={"Authorization": f"Bearer {user_token}"},
            )
            with urlopen(request, timeout=10) as response:
                companion_tokens[operation.id] = json.loads(response.read())["token"]
        for operation, _purpose, _action in operations:
            operation.phase = ArchiveOperationPhase.STREAMING
            operation.checkpoint_json = checkpoints[operation.id]
        session.commit()
        cases = []
        for operation, purpose, action in operations:
            route_kind = "extraction" if operation.kind == ArchiveOperationKind.EXTRACT else "creation"
            cases.append(
                {
                    "relay_url": f"http://127.0.0.1:{port}/api/archive/v2/operations/{operation.id}/relay/{route_kind}",
                    "token": companion_tokens[operation.id],
                    "action": action,
                }
            )
        environment = {
            **os.environ,
            "SAMBEE_ARCHIVE_RELAY_INTEROP_CASES": json.dumps(cases),
            "RUST_TEST_THREADS": "1",
        }
        subprocess.run(
            ["cargo", "test", "archive_relay_transport_interoperates_with_fastapi_when_configured", "--lib", "-q"],
            cwd=Path(__file__).parents[2] / "companion/src-tauri",
            env=environment,
            check=True,
            timeout=120,
        )
        session.expire_all()
        terminal_operations = {operation.id: session.get(ArchiveOperation, operation.id) for operation, _purpose, _action in operations}
        assert all(operation is not None for operation in terminal_operations.values())
        assert [terminal_operations[operation.id].phase for operation, _purpose, _action in operations] == [
            ArchiveOperationPhase.COMPLETED,
            ArchiveOperationPhase.COMPLETED,
            ArchiveOperationPhase.COMPLETED,
            ArchiveOperationPhase.COMPLETED,
        ]
        for operation, _purpose, action in operations[:3]:
            checkpoint = json.loads(terminal_operations[operation.id].checkpoint_json)
            assert checkpoint["delivery_ids"]
            if action == "creation_member_complete":
                assert checkpoint["member_outcomes"] == {"report.txt": {"status": "created", "source_bytes": 3}}
        local_to_smb_operation = operations[-1][0]
        assert writer_manager.execution_by_operation[local_to_smb_operation.id].finalized is True
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        app.dependency_overrides.clear()
