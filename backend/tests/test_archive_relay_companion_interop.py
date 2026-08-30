"""Loopback compatibility coverage for the backend V2 relay API and Companion transport."""

import json
import os
import socket
import subprocess
import threading
import time
from datetime import timedelta
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
from zipfile import ZipFile

import uvicorn

from app.api import archive_operations
from app.core.security import create_access_token
from app.db.database import get_session
from app.main import app
from app.models.archive_operation import ArchiveOperation, ArchiveOperationKind, ArchiveOperationPhase
from app.models.file import FileInfo, FileType
from app.models.user import User


class _LoopbackRandomAccessReader:
    def __init__(self, contents: bytes) -> None:
        self.contents = contents

    async def read_at(self, offset: int, length: int) -> bytes:
        return self.contents[offset : offset + length]

    async def close(self) -> None:
        return None


class _LoopbackSmbBackend:
    def __init__(self) -> None:
        archive = BytesIO()
        with ZipFile(archive, "w") as zip_file:
            zip_file.writestr("report.txt", b"abc")
        self.archive_contents = archive.getvalue()
        self.created_directories: list[str] = []
        self.written_files: dict[str, bytes] = {}

    async def connect(self) -> None:
        return None

    async def disconnect(self) -> None:
        return None

    async def get_file_info(self, path: str) -> FileInfo:
        if path == "source.zip":
            return FileInfo(name="source.zip", path=path, type=FileType.FILE, size=len(self.archive_contents))
        if path == "report.txt":
            return FileInfo(name="report.txt", path=path, type=FileType.FILE, size=3)
        raise FileNotFoundError(path)

    async def list_directory(self, path: str):
        raise FileNotFoundError(path)

    async def open_random_access_reader(self, path: str) -> _LoopbackRandomAccessReader:
        if path != "source.zip":
            raise FileNotFoundError(path)
        return _LoopbackRandomAccessReader(self.archive_contents)

    async def read_file(self, path: str):
        if path != "report.txt":
            raise FileNotFoundError(path)
        yield b"abc"

    async def create_directory(self, path: str) -> None:
        self.created_directories.append(path)

    async def write_file_from_stream(self, path: str, source, *, overwrite: bool) -> int:
        contents = bytearray()
        async for chunk in source:
            contents.extend(chunk)
        self.written_files[path] = bytes(contents)
        return len(contents)


class _LoopbackCreationExecution:
    def __init__(self) -> None:
        self.active = False
        self.finalized = False
        self.written_members: dict[str, bytes] = {}

    def is_active(self) -> bool:
        return self.active

    async def open(self, _backend: _LoopbackSmbBackend, _target_path: str) -> None:
        self.active = True

    async def write_member(self, archive_path: str, *, is_directory: bool, source, expected_uncompressed_size: int) -> None:
        contents = bytearray()
        async for chunk in source:
            contents.extend(chunk)
        if is_directory or len(contents) != expected_uncompressed_size:
            raise ValueError("Loopback creation member is invalid")
        self.written_members[archive_path] = bytes(contents)

    async def finalize(self) -> None:
        self.finalized = True
        self.active = False

    async def abort(self) -> None:
        self.active = False


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
    return ArchiveOperation(
        user_id=user.id,
        kind=kind,
        phase=ArchiveOperationPhase.PREPARED,
        source_connection_id="local-drive:c" if source_is_local else "smb-source",
        source_path="source.zip",
        destination_connection_id="smb-destination" if source_is_local else "local-drive:d",
        destination_path="archive-output.zip",
        plan_json=json.dumps({"source_paths": ["report.txt"]}) if kind == ArchiveOperationKind.CREATE else "",
    )


def test_companion_relay_transport_interoperates_with_fastapi(session, regular_user: User, monkeypatch) -> None:
    """Run every mixed V2 relay binding through real HTTP serialization on loopback."""

    operations = [
        (
            _streaming_operation(regular_user, ArchiveOperationKind.EXTRACT, source_is_local=True),
            "local_zip_to_smb_extract",
            "local_extraction",
        ),
        (
            _streaming_operation(regular_user, ArchiveOperationKind.EXTRACT, source_is_local=False),
            "smb_zip_to_local_extract",
            "remote_extraction",
        ),
        (
            _streaming_operation(regular_user, ArchiveOperationKind.CREATE, source_is_local=False),
            "smb_to_local_zip_create",
            "remote_creation",
        ),
        (
            _streaming_operation(regular_user, ArchiveOperationKind.CREATE, source_is_local=True),
            "local_to_smb_zip_create",
            "local_creation",
        ),
    ]
    writer_manager = _LoopbackCreationWriterManager()
    smb_backend = _LoopbackSmbBackend()
    monkeypatch.setattr(archive_operations, "_local_to_smb_creation_writers", writer_manager)
    monkeypatch.setattr(archive_operations, "_mixed_smb_source_connection", lambda *_args: object())
    monkeypatch.setattr(archive_operations, "_mixed_extraction_destination_connection", lambda *_args: object())
    monkeypatch.setattr(archive_operations, "build_smb_backend", lambda *_args, **_kwargs: smb_backend)
    for operation, _purpose, _action in operations:
        session.add(operation)
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
        for operation, _purpose, _action in operations:
            checkpoint = json.loads(terminal_operations[operation.id].checkpoint_json)
            assert checkpoint["delivery_ids"]
            if operation.kind == ArchiveOperationKind.CREATE:
                assert checkpoint["member_outcomes"] == {"report.txt": {"status": "created", "source_bytes": 3}}
        local_to_smb_operation = operations[-1][0]
        local_to_smb_execution = writer_manager.execution_by_operation[local_to_smb_operation.id]
        assert local_to_smb_execution.written_members == {"report.txt": b"abc"}
        assert local_to_smb_execution.finalized is True
        assert smb_backend.written_files == {"archive-output.zip/report.txt": b"abc"}
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        app.dependency_overrides.clear()
