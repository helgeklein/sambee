"""Owner-scoped durable archive-operation lifecycle endpoints."""

import json
import mimetypes
import unicodedata
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from joserfc.errors import ExpiredTokenError, JoseError
from sqlmodel import Session, col, select

from app.api._smb_helpers import build_smb_backend, disconnect_backend_safely
from app.core.logging import get_logger, set_user
from app.core.security import (
    create_access_token,
    decode_access_token,
    get_current_user_with_auth_check,
    is_user_expired,
    oauth2_scheme,
)
from app.db.database import get_session
from app.models.archive_operation import (
    TERMINAL_ARCHIVE_OPERATION_PHASES,
    ArchiveCompanionCreationManifest,
    ArchiveCompanionCreationManifestEntry,
    ArchiveCompanionCreationSummary,
    ArchiveCompanionExtractionManifest,
    ArchiveCompanionExtractionSummary,
    ArchiveCompanionFailure,
    ArchiveCompanionManifestEntry,
    ArchiveCompanionSession,
    ArchiveExtractionDecision,
    ArchiveOperation,
    ArchiveOperationKind,
    ArchiveOperationPhase,
    ArchiveOperationPrepare,
    ArchiveOperationRead,
    ArchiveOperationTransition,
)
from app.models.connection import Connection
from app.models.file import FileInfo, FileType
from app.models.user import User
from app.services.archive.creation import ArchiveCreationCancelled, build_archive_creation_manifest, create_archive_from_files
from app.services.archive.extraction import ArchiveExtractionCancelled, ArchiveExtractionConflicts, extract_archive_to_new_paths
from app.services.archive.operations import (
    apply_existing_file_decision,
    await_operation_decision,
    fail_operation,
    heartbeat_operation,
    request_operation_cancellation,
    update_operation_phase,
)
from app.services.archive.zip_reader import ArchiveFormatError, ZipEntry, ZipReader
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event
from app.services.connection_access import get_accessible_connection_or_404, require_connection_write_access
from app.services.history_common import LOCAL_DRIVE_PREFIX
from app.storage.smb import SMBBackend

router = APIRouter()
logger = get_logger(__name__)

ARCHIVE_COMPANION_TOKEN_EXPIRE_MINUTES = 15
ARCHIVE_COMPANION_TOKEN_CLAIM = "archive_operation"
ARCHIVE_COMPANION_TOKEN_CLASS = "archive_operation"
ARCHIVE_COMPANION_EXTRACTION_PURPOSE = "local_zip_to_smb_extract"
ARCHIVE_COMPANION_SMB_TO_LOCAL_EXTRACTION_PURPOSE = "smb_zip_to_local_extract"
ARCHIVE_COMPANION_SMB_TO_LOCAL_CREATION_PURPOSE = "smb_to_local_zip_create"
ARCHIVE_COMPANION_LOCAL_TO_SMB_CREATION_PURPOSE = "local_to_smb_zip_create"


def _validate_archive_companion_token(
    token: str,
    *,
    operation_id: uuid.UUID,
    purpose: str,
    session: Session,
) -> tuple[User, dict[str, Any]]:
    """Validate a short-lived archive relay capability for one operation."""

    try:
        payload = decode_access_token(token)
    except (ExpiredTokenError, JoseError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Archive Companion session is invalid or expired") from exc
    if (
        not payload.get(ARCHIVE_COMPANION_TOKEN_CLAIM)
        or payload.get("token_class") != ARCHIVE_COMPANION_TOKEN_CLASS
        or payload.get("purpose") != purpose
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Archive Companion session is invalid or expired")
    if payload.get("archive_operation_id") != str(operation_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session does not match this operation")
    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Archive Companion session is invalid or expired")
    user = session.exec(select(User).where(User.username == subject)).first()
    if user is None or not user.is_active or is_user_expired(user) or payload.get("tv") != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Archive Companion session is invalid or expired")
    return user, payload


def _mixed_archive_member_target(destination_root: str, member_path: str) -> str:
    """Join a validated archive member beneath its operation-owned output root."""

    normalized_member = member_path.replace("\\", "/")
    if (
        not normalized_member
        or normalized_member.startswith("/")
        or "\x00" in normalized_member
        or any(part in {"", ".", ".."} for part in normalized_member.split("/"))
    ):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member path is invalid")
    root = destination_root.replace("\\", "/").strip("/")
    if not root:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive destination path is invalid")
    return f"{root}/{normalized_member}"


def _mixed_archive_checkpoint(operation: ArchiveOperation) -> dict[str, object]:
    try:
        checkpoint = json.loads(operation.checkpoint_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
    if not isinstance(checkpoint, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    return checkpoint


def _mixed_archive_checkpoint_counter(checkpoint: dict[str, object], key: str) -> int:
    """Return a non-negative integer archive checkpoint counter."""

    value = checkpoint.get(key, 0)
    if type(value) is not int or value < 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    return value


def _archive_source_identity(info: FileInfo) -> dict[str, object]:
    """Return the stable source metadata available before opening an SMB ZIP."""

    return {
        "size": info.size,
        "modified_at": info.modified_at.isoformat() if info.modified_at is not None else None,
    }


def _expected_companion_creation_summary(operation: ArchiveOperation) -> ArchiveCompanionCreationSummary:
    """Derive the only valid final ZIP creation counts from its preflight manifest."""

    checkpoint = _mixed_archive_checkpoint(operation)
    source_manifest = checkpoint.get("source_manifest")
    if not isinstance(source_manifest, list):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    files_created = 0
    directories_created = 0
    source_bytes = 0
    for entry in source_manifest:
        if not isinstance(entry, dict) or not isinstance(entry.get("is_directory"), bool):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        source_identity = entry.get("source_identity")
        if not isinstance(source_identity, dict) or type(source_identity.get("size")) is not int:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        size = source_identity["size"]
        if size < 0:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        if entry["is_directory"]:
            directories_created += 1
        else:
            files_created += 1
            source_bytes += size
    return ArchiveCompanionCreationSummary(
        files_created=files_created,
        directories_created=directories_created,
        source_bytes=source_bytes,
    )


async def _ensure_mixed_archive_parent_directories(
    backend: SMBBackend,
    *,
    destination_root: str,
    target_path: str,
) -> int:
    """Create missing output parents below an already-owned destination root."""

    created = 0
    root_parts = destination_root.replace("\\", "/").strip("/").split("/")
    parent_parts = target_path.split("/")[:-1]
    for index in range(len(root_parts) + 1, len(parent_parts) + 1):
        path = "/".join(parent_parts[:index])
        try:
            await backend.create_directory(path)
            created += 1
        except FileExistsError:
            continue
    return created


def _verify_operation_connection_scope(
    session: Session,
    current_user: User,
    *,
    connection_id: str,
    requires_write_access: bool,
) -> None:
    """Authorize an operation endpoint without treating local drive IDs as UUIDs."""

    if connection_id.startswith(LOCAL_DRIVE_PREFIX):
        return
    try:
        connection = get_accessible_connection_or_404(session, current_user, uuid.UUID(connection_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive operation connection ID is invalid") from exc
    if requires_write_access:
        require_connection_write_access(current_user, connection, action="write archive output")


def _get_owned_operation_or_404(session: Session, current_user: User, operation_id: uuid.UUID) -> ArchiveOperation:
    operation = session.get(ArchiveOperation, operation_id)
    if operation is None or operation.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Archive operation was not found")
    return operation


@router.post("/operations", response_model=ArchiveOperationRead, status_code=status.HTTP_201_CREATED)
async def prepare_archive_operation(
    payload: ArchiveOperationPrepare,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Persist a validated archive operation before any direct output begins."""

    set_user(current_user.username)
    _verify_operation_connection_scope(session, current_user, connection_id=payload.source_connection_id, requires_write_access=False)
    _verify_operation_connection_scope(session, current_user, connection_id=payload.destination_connection_id, requires_write_access=True)
    operation = ArchiveOperation(user_id=current_user.id, **payload.model_dump())
    session.add(operation)
    write_audit_event(
        session,
        event_name=AuditEventName.ARCHIVE_OPERATION_LIFECYCLE,
        result=AuditResult.SUCCEEDED,
        acting_user_id=current_user.id,
        correlation_id=str(operation.id),
        details=AuditDetails(archive_operation_kind=operation.kind.value, archive_phase=operation.phase.value),
    )
    session.commit()
    session.refresh(operation)
    return operation


@router.get("/operations/{operation_id}", response_model=ArchiveOperationRead)
async def get_archive_operation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Return one operation only to its initiating user."""

    return _get_owned_operation_or_404(session, current_user, operation_id)


@router.get("/operations", response_model=list[ArchiveOperationRead])
async def list_archive_operations(
    active_only: bool = Query(default=False),
    limit: int = Query(default=25, ge=1, le=100),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> list[ArchiveOperation]:
    """List recent owner-scoped archive operations for durable status recovery."""

    query = select(ArchiveOperation).where(ArchiveOperation.user_id == current_user.id)
    if active_only:
        query = query.where(col(ArchiveOperation.phase).not_in(TERMINAL_ARCHIVE_OPERATION_PHASES))
    query = query.order_by(col(ArchiveOperation.updated_at).desc()).limit(limit)
    return list(session.exec(query).all())


@router.post("/operations/{operation_id}/companion-session", response_model=ArchiveCompanionSession)
async def create_archive_companion_session(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveCompanionSession:
    """Mint a capability limited to one supported mixed-executor archive operation."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    source_is_local = operation.source_connection_id.startswith(LOCAL_DRIVE_PREFIX)
    destination_is_local = operation.destination_connection_id.startswith(LOCAL_DRIVE_PREFIX)
    if operation.kind == ArchiveOperationKind.EXTRACT and source_is_local != destination_is_local:
        purpose = ARCHIVE_COMPANION_EXTRACTION_PURPOSE if source_is_local else ARCHIVE_COMPANION_SMB_TO_LOCAL_EXTRACTION_PURPOSE
    elif operation.kind == ArchiveOperationKind.CREATE and not source_is_local and destination_is_local:
        purpose = ARCHIVE_COMPANION_SMB_TO_LOCAL_CREATION_PURPOSE
    elif operation.kind == ArchiveOperationKind.CREATE and source_is_local and not destination_is_local:
        purpose = ARCHIVE_COMPANION_LOCAL_TO_SMB_CREATION_PURPOSE
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Archive Companion execution is not available for this archive direction",
        )
    if operation.phase != ArchiveOperationPhase.PREPARED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready for Companion execution")

    operation = update_operation_phase(
        session,
        operation,
        expected_phase=ArchiveOperationPhase.PREPARED,
        next_phase=ArchiveOperationPhase.ACCEPTED,
    )
    token = create_access_token(
        data={
            "sub": current_user.username,
            "tv": current_user.token_version,
            "jti": uuid.uuid4().hex,
            ARCHIVE_COMPANION_TOKEN_CLAIM: True,
            "token_class": ARCHIVE_COMPANION_TOKEN_CLASS,
            "purpose": purpose,
            "archive_operation_id": str(operation.id),
            "source_connection_id": operation.source_connection_id,
            "source_path": operation.source_path,
            "destination_connection_id": operation.destination_connection_id,
            "destination_path": operation.destination_path,
            "manifest_hash": operation.manifest_hash,
        },
        expires_delta=timedelta(minutes=ARCHIVE_COMPANION_TOKEN_EXPIRE_MINUTES),
    )
    return ArchiveCompanionSession(
        token=token,
        expires_in=ARCHIVE_COMPANION_TOKEN_EXPIRE_MINUTES * 60,
        operation=ArchiveOperationRead.model_validate(operation),
    )


def _get_scoped_mixed_extraction_operation(
    token: str,
    *,
    operation_id: uuid.UUID,
    session: Session,
) -> tuple[User, ArchiveOperation]:
    """Return the relay-authorized operation after validating immutable scope."""

    user, payload = _validate_archive_companion_token(
        token,
        operation_id=operation_id,
        purpose=ARCHIVE_COMPANION_EXTRACTION_PURPOSE,
        session=session,
    )
    operation = _get_owned_operation_or_404(session, user, operation_id)
    expected_claims = {
        "source_connection_id": operation.source_connection_id,
        "source_path": operation.source_path,
        "destination_connection_id": operation.destination_connection_id,
        "destination_path": operation.destination_path,
        "manifest_hash": operation.manifest_hash,
    }
    if any(payload.get(name) != value for name, value in expected_claims.items()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session scope does not match this operation")
    if (
        operation.kind != ArchiveOperationKind.EXTRACT
        or not operation.source_connection_id.startswith(LOCAL_DRIVE_PREFIX)
        or operation.destination_connection_id.startswith(LOCAL_DRIVE_PREFIX)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session scope does not permit this operation")
    return user, operation


def _get_scoped_smb_to_local_extraction_operation(
    token: str,
    *,
    operation_id: uuid.UUID,
    session: Session,
) -> tuple[User, ArchiveOperation]:
    """Return the source-streaming operation after validating immutable scope."""

    user, payload = _validate_archive_companion_token(
        token,
        operation_id=operation_id,
        purpose=ARCHIVE_COMPANION_SMB_TO_LOCAL_EXTRACTION_PURPOSE,
        session=session,
    )
    operation = _get_owned_operation_or_404(session, user, operation_id)
    expected_claims = {
        "source_connection_id": operation.source_connection_id,
        "source_path": operation.source_path,
        "destination_connection_id": operation.destination_connection_id,
        "destination_path": operation.destination_path,
        "manifest_hash": operation.manifest_hash,
    }
    if any(payload.get(name) != value for name, value in expected_claims.items()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session scope does not match this operation")
    if (
        operation.kind != ArchiveOperationKind.EXTRACT
        or operation.source_connection_id.startswith(LOCAL_DRIVE_PREFIX)
        or not operation.destination_connection_id.startswith(LOCAL_DRIVE_PREFIX)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session scope does not permit this operation")
    return user, operation


def _get_scoped_smb_to_local_creation_operation(
    token: str,
    *,
    operation_id: uuid.UUID,
    session: Session,
) -> tuple[User, ArchiveOperation]:
    """Return the source-streaming creation operation after validating immutable scope."""

    user, payload = _validate_archive_companion_token(
        token,
        operation_id=operation_id,
        purpose=ARCHIVE_COMPANION_SMB_TO_LOCAL_CREATION_PURPOSE,
        session=session,
    )
    operation = _get_owned_operation_or_404(session, user, operation_id)
    expected_claims = {
        "source_connection_id": operation.source_connection_id,
        "source_path": operation.source_path,
        "destination_connection_id": operation.destination_connection_id,
        "destination_path": operation.destination_path,
        "manifest_hash": operation.manifest_hash,
    }
    if any(payload.get(name) != value for name, value in expected_claims.items()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session scope does not match this operation")
    if (
        operation.kind != ArchiveOperationKind.CREATE
        or operation.source_connection_id.startswith(LOCAL_DRIVE_PREFIX)
        or not operation.destination_connection_id.startswith(LOCAL_DRIVE_PREFIX)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session scope does not permit this operation")
    return user, operation


def _get_scoped_local_to_smb_creation_operation(
    token: str,
    *,
    operation_id: uuid.UUID,
    session: Session,
) -> tuple[User, ArchiveOperation]:
    """Return the destination-writing creation operation after validating immutable scope."""

    user, payload = _validate_archive_companion_token(
        token,
        operation_id=operation_id,
        purpose=ARCHIVE_COMPANION_LOCAL_TO_SMB_CREATION_PURPOSE,
        session=session,
    )
    operation = _get_owned_operation_or_404(session, user, operation_id)
    expected_claims = {
        "source_connection_id": operation.source_connection_id,
        "source_path": operation.source_path,
        "destination_connection_id": operation.destination_connection_id,
        "destination_path": operation.destination_path,
        "manifest_hash": operation.manifest_hash,
    }
    if any(payload.get(name) != value for name, value in expected_claims.items()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session scope does not match this operation")
    if (
        operation.kind != ArchiveOperationKind.CREATE
        or not operation.source_connection_id.startswith(LOCAL_DRIVE_PREFIX)
        or operation.destination_connection_id.startswith(LOCAL_DRIVE_PREFIX)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session scope does not permit this operation")
    return user, operation


def _mixed_smb_source_connection(session: Session, user: User, operation: ArchiveOperation) -> Connection:
    try:
        return get_accessible_connection_or_404(session, user, uuid.UUID(operation.source_connection_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive source connection ID is invalid") from exc


def _validate_smb_to_local_manifest(entries: list[ZipEntry]) -> None:
    """Reject any source archive that cannot be safely extracted locally as a whole."""

    if any(not entry.is_safe for entry in entries):
        raise ArchiveFormatError("Archive extraction contains an unsafe member path")
    if any(not entry.has_supported_file_type for entry in entries):
        raise ArchiveFormatError("Archive extraction contains a symbolic link or unsupported special member")
    if any(entry.encrypted or entry.compression_method not in {0, 8, 12} for entry in entries if not entry.is_directory):
        raise ArchiveFormatError("Archive extraction contains an unavailable member")
    file_paths: set[str] = set()
    directory_paths: set[str] = set()
    for entry in entries:
        normalized_path = unicodedata.normalize("NFC", entry.path).casefold()
        if entry.is_directory:
            directory_paths.add(normalized_path)
        else:
            if normalized_path in file_paths:
                raise ArchiveFormatError("Archive extraction output paths collide after normalization")
            file_paths.add(normalized_path)
        parts = entry.path.split("/")
        directory_count = len(parts) if entry.is_directory else len(parts) - 1
        directory_paths.update(unicodedata.normalize("NFC", "/".join(parts[:index])).casefold() for index in range(1, directory_count + 1))
    if file_paths & directory_paths:
        raise ArchiveFormatError("Archive extraction output paths create a file/directory collision")


def _mixed_extraction_destination_connection(session: Session, user: User, operation: ArchiveOperation) -> Connection:
    try:
        connection = get_accessible_connection_or_404(session, user, uuid.UUID(operation.destination_connection_id))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive destination connection ID is invalid"
        ) from exc
    require_connection_write_access(user, connection, action="extract archive", path=operation.destination_path)
    return connection


@router.post("/operations/{operation_id}/companion-extract/begin", response_model=ArchiveOperationRead)
async def begin_companion_archive_extraction(
    operation_id: uuid.UUID,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Claim one new SMB destination root for a scoped local ZIP relay."""

    user, operation = _get_scoped_mixed_extraction_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase == ArchiveOperationPhase.STREAMING:
        return operation
    if operation.phase != ArchiveOperationPhase.ACCEPTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready for Companion execution")
    if operation.cancellation_requested:
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.CANCELLED
        )
    connection = _mixed_extraction_destination_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        try:
            await backend.create_directory(operation.destination_path)
        except FileExistsError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Archive extraction destination already exists",
            ) from exc
        operation.checkpoint_json = json.dumps(
            {
                "files_extracted": 0,
                "directories_created": 1,
                "extracted_bytes": 0,
                "written_members": [],
            }
        )
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.STREAMING
        )
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"mixed archive begin operation {operation.id}")


@router.put("/operations/{operation_id}/companion-extract/member", response_model=ArchiveOperationRead)
async def write_companion_archive_member(
    operation_id: uuid.UUID,
    request: Request,
    member_path: str = Query(..., min_length=1),
    is_directory: bool = Query(False),
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Stream one validated local ZIP member to its operation-owned SMB target."""

    user, operation = _get_scoped_mixed_extraction_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not accepting member output")
    if operation.cancellation_requested:
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
        )
    target_path = _mixed_archive_member_target(operation.destination_path, member_path)
    checkpoint = _mixed_archive_checkpoint(operation)
    written_members = checkpoint.setdefault("written_members", [])
    if not isinstance(written_members, list) or not all(isinstance(member, str) for member in written_members):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    if member_path in written_members:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive member has already been written")

    connection = _mixed_extraction_destination_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        created_directories = await _ensure_mixed_archive_parent_directories(
            backend,
            destination_root=operation.destination_path,
            target_path=target_path,
        )
        if is_directory:
            await backend.create_directory(target_path)
            created_directories += 1
            written = 0
        else:
            written = await backend.write_file_from_stream(target_path, request.stream(), overwrite=False)
        written_members.append(member_path)
        if not is_directory:
            checkpoint["files_extracted"] = _mixed_archive_checkpoint_counter(checkpoint, "files_extracted") + 1
        checkpoint["directories_created"] = _mixed_archive_checkpoint_counter(checkpoint, "directories_created") + created_directories
        checkpoint["extracted_bytes"] = _mixed_archive_checkpoint_counter(checkpoint, "extracted_bytes") + written
        operation.checkpoint_json = json.dumps(checkpoint)
        session.add(operation)
        session.commit()
        session.refresh(operation)
        return operation
    except FileExistsError as exc:
        fail_operation(session, operation, "Archive member destination already exists")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive member destination already exists") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Mixed archive member write failed: operation_id=%s, member_path=%r", operation.id, member_path)
        fail_operation(session, operation, str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive member write failed") from exc
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"mixed archive member operation {operation.id}")


@router.post("/operations/{operation_id}/companion-extract/complete", response_model=ArchiveOperationRead)
async def complete_companion_archive_extraction(
    operation_id: uuid.UUID,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Record the terminal result after Companion has streamed all safe members."""

    _user, operation = _get_scoped_mixed_extraction_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase == ArchiveOperationPhase.COMPLETED:
        return operation
    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready to complete")
    if operation.cancellation_requested:
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
        )
    update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.VERIFYING)
    return update_operation_phase(
        session, operation, expected_phase=ArchiveOperationPhase.VERIFYING, next_phase=ArchiveOperationPhase.COMPLETED
    )


@router.post("/operations/{operation_id}/companion-local-extract/begin", response_model=ArchiveCompanionExtractionManifest)
async def begin_companion_local_archive_extraction(
    operation_id: uuid.UUID,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveCompanionExtractionManifest:
    """Validate and expose one complete SMB ZIP manifest to its local Companion executor."""

    user, operation = _get_scoped_smb_to_local_extraction_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase not in {ArchiveOperationPhase.ACCEPTED, ArchiveOperationPhase.STREAMING}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready for Companion execution")
    if operation.cancellation_requested:
        if operation.phase == ArchiveOperationPhase.ACCEPTED:
            update_operation_phase(
                session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.CANCELLED
            )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation was cancelled")
    if operation.phase == ArchiveOperationPhase.STREAMING:
        checkpoint = _mixed_archive_checkpoint(operation)
        archive_manifest = checkpoint.get("archive_manifest")
        if not isinstance(archive_manifest, list):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        try:
            persisted_entries = [
                ArchiveCompanionManifestEntry(
                    path=entry["path"],
                    is_directory=entry["is_directory"],
                    uncompressed_size=entry["uncompressed_size"],
                )
                for entry in archive_manifest
                if isinstance(entry, dict)
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
        if len(persisted_entries) != len(archive_manifest):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        return ArchiveCompanionExtractionManifest(operation=ArchiveOperationRead.model_validate(operation), entries=persisted_entries)
    connection = _mixed_smb_source_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    reader = None
    try:
        await backend.connect()
        archive_info = await backend.get_file_info(operation.source_path)
        if archive_info.type != FileType.FILE or archive_info.size is None:
            raise ArchiveFormatError("Archive extraction source must be a regular file")
        reader = await backend.open_random_access_reader(operation.source_path)
        zip_entries = await ZipReader(reader, archive_info.size).entries()
        _validate_smb_to_local_manifest(zip_entries)
        if operation.phase == ArchiveOperationPhase.ACCEPTED:
            operation.checkpoint_json = json.dumps(
                {
                    "files_extracted": 0,
                    "directories_created": 0,
                    "extracted_bytes": 0,
                    "source_identity": _archive_source_identity(archive_info),
                    "archive_manifest": [
                        {
                            "path": entry.path,
                            "is_directory": entry.is_directory,
                            "uncompressed_size": entry.uncompressed_size,
                        }
                        for entry in zip_entries
                    ],
                }
            )
            operation = update_operation_phase(
                session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.STREAMING
            )
        return ArchiveCompanionExtractionManifest(
            operation=ArchiveOperationRead.model_validate(operation),
            entries=[
                ArchiveCompanionManifestEntry(
                    path=entry.path,
                    is_directory=entry.is_directory,
                    uncompressed_size=entry.uncompressed_size,
                )
                for entry in zip_entries
            ],
        )
    except ArchiveFormatError as exc:
        fail_operation(session, operation, str(exc))
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive extraction source is invalid") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Mixed SMB archive manifest read failed: operation_id=%s", operation.id)
        fail_operation(session, operation, str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive manifest read failed") from exc
    finally:
        if reader is not None:
            await reader.close()
        await disconnect_backend_safely(backend, logger=logger, context=f"mixed archive manifest operation {operation.id}")


@router.get("/operations/{operation_id}/companion-local-extract/member")
async def stream_companion_local_archive_member(
    operation_id: uuid.UUID,
    member_path: str = Query(..., min_length=1),
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Stream one validated SMB ZIP member directly to the scoped local executor."""

    user, operation = _get_scoped_smb_to_local_extraction_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not accepting member reads")
    if operation.cancellation_requested:
        update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation was cancelled")
    checkpoint = _mixed_archive_checkpoint(operation)
    archive_manifest = checkpoint.get("archive_manifest")
    expected_member = (
        next(
            (
                entry
                for entry in archive_manifest
                if isinstance(entry, dict) and entry.get("path") == member_path and entry.get("is_directory") is False
            ),
            None,
        )
        if isinstance(archive_manifest, list)
        else None
    )
    if not isinstance(expected_member, dict) or type(expected_member.get("uncompressed_size")) is not int:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member is invalid or unavailable")
    connection = _mixed_smb_source_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    reader = None
    try:
        await backend.connect()
        archive_info = await backend.get_file_info(operation.source_path)
        if archive_info.type != FileType.FILE or archive_info.size is None:
            raise ArchiveFormatError("Archive extraction source must be a regular file")
        if checkpoint.get("source_identity") != _archive_source_identity(archive_info):
            fail_operation(session, operation, "Archive extraction source changed after manifest validation")
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive extraction source changed after manifest validation")
        reader = await backend.open_random_access_reader(operation.source_path)
        zip_reader = ZipReader(reader, archive_info.size)
        member = await zip_reader.validate_member(member_path)
        if member.uncompressed_size != expected_member["uncompressed_size"]:
            fail_operation(session, operation, "Archive extraction manifest changed after validation")
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive extraction manifest changed after validation")

        async def stream_member() -> AsyncIterator[bytes]:
            try:
                async for chunk in zip_reader.stream_member(member_path):
                    session.refresh(operation)
                    if operation.cancellation_requested:
                        update_operation_phase(
                            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
                        )
                        return
                    heartbeat_operation(session, operation)
                    yield chunk
            finally:
                await reader.close()
                await disconnect_backend_safely(
                    backend,
                    logger=logger,
                    context=f"mixed archive member stream operation {operation.id}",
                )

        return StreamingResponse(
            stream_member(),
            media_type=mimetypes.guess_type(member.path)[0] or "application/octet-stream",
        )
    except ArchiveFormatError as exc:
        if reader is not None:
            await reader.close()
        await disconnect_backend_safely(backend, logger=logger, context=f"invalid mixed archive member operation {operation.id}")
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive member is invalid or unavailable") from exc
    except Exception:
        if reader is not None:
            await reader.close()
        await disconnect_backend_safely(backend, logger=logger, context=f"failed mixed archive member operation {operation.id}")
        raise


@router.post("/operations/{operation_id}/companion-local-extract/complete", response_model=ArchiveOperationRead)
async def complete_companion_local_archive_extraction(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionExtractionSummary,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Persist local output counts after every scoped SMB member was written."""

    _user, operation = _get_scoped_smb_to_local_extraction_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase == ArchiveOperationPhase.COMPLETED:
        return operation
    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready to complete")
    if operation.cancellation_requested:
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
        )
    checkpoint = _mixed_archive_checkpoint(operation)
    checkpoint.update(payload.model_dump())
    operation.checkpoint_json = json.dumps(checkpoint)
    session.add(operation)
    session.commit()
    session.refresh(operation)
    update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.VERIFYING)
    return update_operation_phase(
        session, operation, expected_phase=ArchiveOperationPhase.VERIFYING, next_phase=ArchiveOperationPhase.COMPLETED
    )


@router.post("/operations/{operation_id}/companion-local-extract/fail", response_model=ArchiveOperationRead)
async def fail_companion_local_archive_extraction(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionFailure,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Record a local executor failure without leaving the operation active."""

    _user, operation = _get_scoped_smb_to_local_extraction_operation(operation_token, operation_id=operation_id, session=session)
    return fail_operation(session, operation, payload.message)


@router.post("/operations/{operation_id}/companion-local-create/begin", response_model=ArchiveCompanionCreationManifest)
async def begin_companion_local_archive_creation(
    operation_id: uuid.UUID,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveCompanionCreationManifest:
    """Preflight complete SMB sources before Companion creates a local ZIP."""

    user, operation = _get_scoped_smb_to_local_creation_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase not in {ArchiveOperationPhase.ACCEPTED, ArchiveOperationPhase.STREAMING}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready for Companion execution")
    if operation.cancellation_requested:
        if operation.phase == ArchiveOperationPhase.ACCEPTED:
            update_operation_phase(
                session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.CANCELLED
            )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation was cancelled")
    if operation.phase == ArchiveOperationPhase.STREAMING:
        checkpoint = _mixed_archive_checkpoint(operation)
        source_manifest = checkpoint.get("source_manifest")
        if not isinstance(source_manifest, list):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        try:
            persisted_entries = [
                ArchiveCompanionCreationManifestEntry(
                    source_path=entry["source_path"],
                    archive_path=entry["archive_path"],
                    is_directory=entry["is_directory"],
                    source_size=entry["source_identity"]["size"] or 0,
                    modified_at=entry["source_identity"]["modified_at"],
                )
                for entry in source_manifest
                if isinstance(entry, dict) and isinstance(entry.get("source_identity"), dict)
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
        if len(persisted_entries) != len(source_manifest):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        return ArchiveCompanionCreationManifest(operation=ArchiveOperationRead.model_validate(operation), entries=persisted_entries)
    connection = _mixed_smb_source_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        source_entries = await build_archive_creation_manifest(backend, _creation_source_paths(operation), operation.destination_path)
        if operation.phase == ArchiveOperationPhase.ACCEPTED:
            operation.checkpoint_json = json.dumps(
                {
                    "files_created": 0,
                    "directories_created": 0,
                    "source_bytes": 0,
                    "source_manifest": [
                        {
                            "source_path": entry.source_path,
                            "archive_path": entry.archive_path,
                            "is_directory": entry.info.type == FileType.DIRECTORY,
                            "source_identity": {
                                "size": entry.info.size or 0,
                                "modified_at": entry.info.modified_at.isoformat() if entry.info.modified_at else None,
                            },
                        }
                        for entry in source_entries
                    ],
                }
            )
            operation = update_operation_phase(
                session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.STREAMING
            )
        return ArchiveCompanionCreationManifest(
            operation=ArchiveOperationRead.model_validate(operation),
            entries=[
                ArchiveCompanionCreationManifestEntry(
                    source_path=entry.source_path,
                    archive_path=entry.archive_path,
                    is_directory=entry.info.type == FileType.DIRECTORY,
                    source_size=entry.info.size or 0,
                    modified_at=entry.info.modified_at,
                )
                for entry in source_entries
            ],
        )
    except ArchiveFormatError as exc:
        fail_operation(session, operation, str(exc))
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation sources are invalid") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Mixed SMB archive creation manifest read failed: operation_id=%s", operation.id)
        fail_operation(session, operation, str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive creation manifest read failed") from exc
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"mixed archive creation manifest operation {operation.id}")


@router.get("/operations/{operation_id}/companion-local-create/member")
async def stream_companion_local_archive_creation_member(
    operation_id: uuid.UUID,
    archive_path: str = Query(..., min_length=1),
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Stream one preflight-approved SMB regular file to the scoped local ZIP writer."""

    user, operation = _get_scoped_smb_to_local_creation_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not accepting source reads")
    if operation.cancellation_requested:
        update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation was cancelled")
    connection = _mixed_smb_source_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        checkpoint = _mixed_archive_checkpoint(operation)
        source_manifest = checkpoint.get("source_manifest")
        if not isinstance(source_manifest, list):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
        entry = next(
            (candidate for candidate in source_manifest if isinstance(candidate, dict) and candidate.get("archive_path") == archive_path),
            None,
        )
        if (
            not isinstance(entry, dict)
            or entry.get("is_directory") is not False
            or not isinstance(entry.get("source_path"), str)
            or not isinstance(entry.get("source_identity"), dict)
        ):
            raise ArchiveFormatError("Archive creation member is invalid or unavailable")
        source_path = entry["source_path"]
        source_info = await backend.get_file_info(source_path)
        if source_info.type != FileType.FILE or entry["source_identity"] != _archive_source_identity(source_info):
            fail_operation(session, operation, "Archive creation source changed after manifest validation")
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation source changed after manifest validation")

        async def stream_member() -> AsyncIterator[bytes]:
            try:
                async for chunk in backend.read_file(source_path):
                    session.refresh(operation)
                    if operation.cancellation_requested:
                        update_operation_phase(
                            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
                        )
                        return
                    heartbeat_operation(session, operation)
                    yield chunk
            finally:
                await disconnect_backend_safely(
                    backend,
                    logger=logger,
                    context=f"mixed archive creation member stream operation {operation.id}",
                )

        return StreamingResponse(stream_member(), media_type="application/octet-stream")
    except ArchiveFormatError as exc:
        await disconnect_backend_safely(backend, logger=logger, context=f"invalid mixed archive creation member operation {operation.id}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation member is invalid or unavailable"
        ) from exc
    except Exception:
        await disconnect_backend_safely(backend, logger=logger, context=f"failed mixed archive creation member operation {operation.id}")
        raise


@router.post("/operations/{operation_id}/companion-local-create/complete", response_model=ArchiveOperationRead)
async def complete_companion_local_archive_creation(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionCreationSummary,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Persist the finished local ZIP summary after all scoped SMB members were relayed."""

    _user, operation = _get_scoped_smb_to_local_creation_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase == ArchiveOperationPhase.COMPLETED:
        return operation
    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready to complete")
    if operation.cancellation_requested:
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
        )
    if payload != _expected_companion_creation_summary(operation):
        fail_operation(session, operation, "Archive creation completion did not match the preflight manifest")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation completion did not match the preflight manifest")
    checkpoint = _mixed_archive_checkpoint(operation)
    checkpoint.update(payload.model_dump())
    operation.checkpoint_json = json.dumps(checkpoint)
    session.add(operation)
    session.commit()
    session.refresh(operation)
    update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.VERIFYING)
    return update_operation_phase(
        session, operation, expected_phase=ArchiveOperationPhase.VERIFYING, next_phase=ArchiveOperationPhase.COMPLETED
    )


@router.post("/operations/{operation_id}/companion-local-create/fail", response_model=ArchiveOperationRead)
async def fail_companion_local_archive_creation(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionFailure,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Record a local ZIP creator failure without leaving the operation active."""

    _user, operation = _get_scoped_smb_to_local_creation_operation(operation_token, operation_id=operation_id, session=session)
    return fail_operation(session, operation, payload.message)


@router.put("/operations/{operation_id}/companion-smb-create/stream", response_model=ArchiveOperationRead)
async def stream_companion_smb_archive_creation(
    operation_id: uuid.UUID,
    request: Request,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Write one locally produced ZIP stream to its exclusive scoped SMB target."""

    user, operation = _get_scoped_local_to_smb_creation_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase != ArchiveOperationPhase.ACCEPTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready for Companion output")
    if operation.cancellation_requested:
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.CANCELLED
        )
    connection = _mixed_extraction_destination_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    writer = None
    try:
        await backend.connect()
        writer = await backend.open_exclusive_writer(operation.destination_path)
        operation = update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.STREAMING
        )
        async for chunk in request.stream():
            session.refresh(operation)
            if operation.cancellation_requested:
                await writer.abort_and_delete_if_owned()
                writer = None
                return update_operation_phase(
                    session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
                )
            heartbeat_operation(session, operation)
            offset = 0
            while offset < len(chunk):
                written = await writer.write(chunk[offset:])
                if written <= 0:
                    raise OSError("Archive target writer accepted no bytes")
                offset += written
        await writer.close()
        writer = None
        return operation
    except FileExistsError as exc:
        fail_operation(session, operation, "Archive creation target already exists")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation target already exists") from exc
    except HTTPException:
        raise
    except Exception as exc:
        if writer is not None:
            await writer.abort_and_delete_if_owned()
        logger.exception("Mixed local archive creation write failed: operation_id=%s", operation.id)
        fail_operation(session, operation, str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive creation output failed") from exc
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"mixed archive creation output operation {operation.id}")


@router.post("/operations/{operation_id}/companion-smb-create/complete", response_model=ArchiveOperationRead)
async def complete_companion_smb_archive_creation(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionCreationSummary,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Persist the local ZIP summary after its exclusive SMB output has closed."""

    _user, operation = _get_scoped_local_to_smb_creation_operation(operation_token, operation_id=operation_id, session=session)
    if operation.phase == ArchiveOperationPhase.COMPLETED:
        return operation
    if operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready to complete")
    if operation.cancellation_requested:
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
        )
    operation.checkpoint_json = payload.model_dump_json()
    session.add(operation)
    session.commit()
    session.refresh(operation)
    update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.VERIFYING)
    return update_operation_phase(
        session, operation, expected_phase=ArchiveOperationPhase.VERIFYING, next_phase=ArchiveOperationPhase.COMPLETED
    )


@router.post("/operations/{operation_id}/companion-smb-create/fail", response_model=ArchiveOperationRead)
async def fail_companion_smb_archive_creation(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionFailure,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Record a local ZIP producer failure without leaving the operation active."""

    _user, operation = _get_scoped_local_to_smb_creation_operation(operation_token, operation_id=operation_id, session=session)
    return fail_operation(session, operation, payload.message)


@router.post("/operations/{operation_id}/phase", response_model=ArchiveOperationRead)
async def transition_archive_operation(
    operation_id: uuid.UUID,
    payload: ArchiveOperationTransition,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Advance one operation through an idempotent permitted transition."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    return update_operation_phase(session, operation, expected_phase=payload.expected_phase, next_phase=payload.next_phase)


def _creation_source_paths(operation: ArchiveOperation) -> list[str]:
    try:
        plan = json.loads(operation.plan_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation plan is invalid") from exc
    source_paths = plan.get("source_paths") if isinstance(plan, dict) else None
    if not isinstance(source_paths, list) or not source_paths or not all(isinstance(path, str) and path for path in source_paths):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation plan has no valid source files")
    return source_paths


def _member_collision_actions(operation: ArchiveOperation) -> dict[str, str]:
    """Return validated per-member choices recorded while resolving grouped conflicts."""

    try:
        checkpoint = json.loads(operation.checkpoint_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
    if not isinstance(checkpoint, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    member_actions = checkpoint.get("member_collision_actions", {})
    if not isinstance(member_actions, dict) or not all(
        isinstance(member_path, str) and action in {"skip", "replace"} for member_path, action in member_actions.items()
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    return member_actions


def _member_rename_targets(operation: ArchiveOperation) -> dict[str, str]:
    """Return persisted per-member output remaps after structural validation."""

    try:
        checkpoint = json.loads(operation.checkpoint_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
    rename_targets = checkpoint.get("member_rename_targets", {}) if isinstance(checkpoint, dict) else None
    if not isinstance(rename_targets, dict) or not all(
        isinstance(member_path, str) and isinstance(target_path, str) for member_path, target_path in rename_targets.items()
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    return rename_targets


@router.post("/operations/{operation_id}/execute-create", response_model=ArchiveOperationRead)
async def execute_archive_creation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Create the operation's direct SMB target from its immutable file-source plan."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    if operation.kind != ArchiveOperationKind.CREATE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not a creation operation")
    if operation.source_connection_id != operation.destination_connection_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Mixed archive creation requires the Companion executor"
        )
    if operation.source_connection_id.startswith(LOCAL_DRIVE_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Local archive creation requires the Companion executor"
        )
    source_paths = _creation_source_paths(operation)
    try:
        connection = get_accessible_connection_or_404(session, current_user, uuid.UUID(operation.source_connection_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation connection ID is invalid") from exc
    require_connection_write_access(current_user, connection, action="create archive", path=operation.destination_path)
    if operation.phase == ArchiveOperationPhase.PREPARED:
        update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.PREPARED, next_phase=ArchiveOperationPhase.ACCEPTED)
    if operation.phase != ArchiveOperationPhase.ACCEPTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation operation is not ready to execute")
    update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.STREAMING)

    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()

        async def is_cancelled() -> bool:
            session.refresh(operation)
            heartbeat_operation(session, operation)
            return operation.cancellation_requested

        result = await create_archive_from_files(
            backend,
            source_paths=source_paths,
            target_path=operation.destination_path,
            is_cancelled=is_cancelled,
        )
        operation.checkpoint_json = json.dumps(
            {
                "files_created": result.files_created,
                "directories_created": result.directories_created,
                "source_bytes": result.source_bytes,
            }
        )
        update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.VERIFYING
        )
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.VERIFYING, next_phase=ArchiveOperationPhase.COMPLETED
        )
    except ArchiveCreationCancelled:
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
        )
    except HTTPException:
        raise
    except Exception as exc:
        fail_operation(session, operation, str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive creation failed") from exc
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"archive creation operation {operation.id}")


@router.post("/operations/{operation_id}/execute-extract", response_model=ArchiveOperationRead)
async def execute_archive_extraction(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Extract the operation's archive into new paths on its source SMB connection."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    if operation.kind != ArchiveOperationKind.EXTRACT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not an extraction operation")
    if operation.source_connection_id != operation.destination_connection_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Mixed archive extraction requires the Companion executor"
        )
    if operation.source_connection_id.startswith(LOCAL_DRIVE_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Local archive extraction requires the Companion executor"
        )
    try:
        connection = get_accessible_connection_or_404(session, current_user, uuid.UUID(operation.source_connection_id))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive extraction connection ID is invalid"
        ) from exc
    require_connection_write_access(current_user, connection, action="extract archive", path=operation.destination_path)
    if operation.phase == ArchiveOperationPhase.PREPARED:
        update_operation_phase(session, operation, expected_phase=ArchiveOperationPhase.PREPARED, next_phase=ArchiveOperationPhase.ACCEPTED)
    if operation.phase == ArchiveOperationPhase.ACCEPTED:
        update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.ACCEPTED, next_phase=ArchiveOperationPhase.STREAMING
        )
    elif operation.phase != ArchiveOperationPhase.STREAMING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive extraction operation is not ready to execute")

    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()

        async def is_cancelled() -> bool:
            session.refresh(operation)
            heartbeat_operation(session, operation)
            return operation.cancellation_requested

        result = await extract_archive_to_new_paths(
            backend,
            archive_path=operation.source_path,
            destination_root=operation.destination_path,
            existing_file_policy=operation.collision_policy,
            member_collision_actions=_member_collision_actions(operation),
            member_rename_targets=_member_rename_targets(operation),
            is_cancelled=is_cancelled,
        )
        operation.checkpoint_json = json.dumps(
            {
                "files_extracted": result.files_extracted,
                "directories_created": result.directories_created,
                "extracted_bytes": result.extracted_bytes,
                "files_skipped": result.files_skipped,
                "files_replaced": result.files_replaced,
                "skipped_members": list(result.skipped_members),
                "replaced_members": list(result.replaced_members),
                "renamed_members": list(result.renamed_members),
            }
        )
        update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.VERIFYING
        )
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.VERIFYING, next_phase=ArchiveOperationPhase.COMPLETED
        )
    except ArchiveExtractionCancelled:
        return update_operation_phase(
            session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
        )
    except ArchiveExtractionConflicts as exc:
        return await_operation_decision(
            session,
            operation,
            {
                "kind": "existing_files",
                "allowed_actions": ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
                "conflicts": [
                    {
                        "member_path": conflict.member_path,
                        "target_path": conflict.target_path,
                        "is_directory": conflict.is_directory,
                    }
                    for conflict in exc.conflicts
                ],
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        fail_operation(session, operation, str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive extraction failed") from exc
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"archive extraction operation {operation.id}")


@router.post("/operations/{operation_id}/decide-extraction", response_model=ArchiveOperationRead)
async def decide_archive_extraction(
    operation_id: uuid.UUID,
    payload: ArchiveExtractionDecision,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Apply an allowed all-files collision policy or cancel the paused extraction."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    if payload.action == "cancel":
        return update_operation_phase(
            session,
            operation,
            expected_phase=ArchiveOperationPhase.AWAITING_USER_DECISION,
            next_phase=ArchiveOperationPhase.CANCELLED,
        )
    return apply_existing_file_decision(session, operation, payload.action, payload.member_path, payload.target_path)


@router.post("/operations/{operation_id}/cancel", response_model=ArchiveOperationRead)
async def cancel_archive_operation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Request cancellation; the executor checks this between bounded chunks."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    return request_operation_cancellation(session, operation)
