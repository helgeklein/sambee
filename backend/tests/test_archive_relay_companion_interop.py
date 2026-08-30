"""Loopback compatibility coverage for the backend V2 relay API and Companion transport."""

import json
import os
import socket
import subprocess
import threading
import time
from datetime import timedelta
from pathlib import Path

import uvicorn

from app.api.archive_operations import ARCHIVE_COMPANION_TOKEN_CLAIM, ARCHIVE_COMPANION_TOKEN_CLASS
from app.core.security import create_access_token
from app.db.database import get_session
from app.main import app
from app.models.archive_operation import ArchiveOperation, ArchiveOperationKind, ArchiveOperationPhase
from app.models.user import User
from app.services.archive.v2_checkpoint import new_v2_creation_checkpoint, new_v2_extraction_checkpoint


def _available_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as socket_handle:
        socket_handle.bind(("127.0.0.1", 0))
        return int(socket_handle.getsockname()[1])


def _capability(user: User, operation: ArchiveOperation, purpose: str) -> str:
    return create_access_token(
        data={
            "sub": user.username,
            "tv": user.token_version,
            "jti": f"interop-{operation.id.hex}",
            ARCHIVE_COMPANION_TOKEN_CLAIM: True,
            "token_class": ARCHIVE_COMPANION_TOKEN_CLASS,
            "purpose": purpose,
            "archive_operation_id": str(operation.id),
            "source_connection_id": operation.source_connection_id,
            "source_path": operation.source_path,
            "destination_connection_id": operation.destination_connection_id,
            "destination_path": operation.destination_path,
            "manifest_hash": operation.manifest_hash,
            "contract_version": operation.contract_version.value,
        },
        expires_delta=timedelta(minutes=5),
    )


def _streaming_operation(user: User, kind: ArchiveOperationKind, *, source_is_local: bool) -> ArchiveOperation:
    checkpoint = (
        new_v2_extraction_checkpoint(manifest=[], source_snapshot={"size": 0, "modified_at": None})
        if kind == ArchiveOperationKind.EXTRACT
        else new_v2_creation_checkpoint(manifest=[])
    )
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


def test_companion_relay_transport_interoperates_with_fastapi(session, regular_user: User) -> None:
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
        (_streaming_operation(regular_user, ArchiveOperationKind.CREATE, source_is_local=False), "smb_to_local_zip_create", "fail"),
        (_streaming_operation(regular_user, ArchiveOperationKind.CREATE, source_is_local=True), "local_to_smb_zip_create", "fail"),
    ]
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
        cases = []
        for operation, purpose, action in operations:
            route_kind = "extraction" if operation.kind == ArchiveOperationKind.EXTRACT else "creation"
            cases.append(
                {
                    "relay_url": f"http://127.0.0.1:{port}/api/archive/v2/operations/{operation.id}/relay/{route_kind}",
                    "token": _capability(regular_user, operation, purpose),
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
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        app.dependency_overrides.clear()
