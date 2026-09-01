"""Owner-scoped durable archive-operation lifecycle endpoints."""

import json
import mimetypes
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import Response, StreamingResponse
from joserfc.errors import ExpiredTokenError, JoseError
from sqlmodel import Session, col, select

from app.api._smb_helpers import build_smb_backend, disconnect_backend_safely
from app.api.browser import list_archive_directory
from app.api.viewer import stream_archive_member
from app.core.logging import get_logger, set_user
from app.core.security import (
    create_access_token,
    decode_access_token,
    get_current_user_with_auth_check,
    is_user_expired,
    oauth2_scheme,
)
from app.db.database import get_session
from app.models.archive import ArchiveDirectoryListing
from app.models.archive_operation import (
    TERMINAL_ARCHIVE_OPERATION_PHASES,
    ArchiveCompanionCreationManifest,
    ArchiveCompanionCreationManifestEntry,
    ArchiveCompanionCreationMemberCompletion,
    ArchiveCompanionCreationSourceManifest,
    ArchiveCompanionCreationSummary,
    ArchiveCompanionExtractionCollision,
    ArchiveCompanionExtractionManifest,
    ArchiveCompanionExtractionMemberCompletion,
    ArchiveCompanionExtractionMemberError,
    ArchiveCompanionExtractionSourceManifest,
    ArchiveCompanionExtractionSummary,
    ArchiveCompanionFailure,
    ArchiveCompanionManifestEntry,
    ArchiveCompanionSession,
    ArchiveContractVersion,
    ArchiveExtractionDecision,
    ArchiveOperation,
    ArchiveOperationErrorCode,
    ArchiveOperationKind,
    ArchiveOperationPhase,
    ArchiveOperationPrepare,
    ArchiveOperationRead,
    ArchiveOperationTransition,
)
from app.models.connection import Connection
from app.models.file import FileInfo, FileType
from app.models.user import User
from app.services.archive.coordinator import (
    ArchiveCreationCoordinator,
    ArchiveCreationExecutionPlan,
    ArchiveCreationManifest,
    ArchiveCreationManifestMember,
    ArchiveCreationState,
    ArchiveExtractionCoordinator,
    ArchiveExtractionDecisionState,
    ArchiveExtractionExecutionPlan,
    ArchiveExtractionManifest,
    ArchiveExtractionManifestMember,
    ArchiveExtractionState,
    DurableArchiveExecutionStateStore,
    advance_relay_transfer,
    archive_member_target,
    begin_relay_execution,
    commit_creation_member_outcome,
    complete_creation_relay_execution,
    complete_relay_execution,
    load_archive_checkpoint,
    persist_extraction_member_outcome,
)
from app.services.archive.creation import (
    ArchiveCreationCancelled,
    ArchiveCreationMemberOutcome,
    ArchiveCreationResult,
    build_archive_creation_manifest,
    create_archive_from_files,
    normalize_archive_creation_source_modified_at,
)
from app.services.archive.execution import (
    ArchiveCompanionRelayPurpose,
    ArchiveExecutionDriver,
    resolve_archive_operation_topology_plan,
)
from app.services.archive.extraction import (
    ArchiveExtractionDestinationResult,
    ArchiveExtractionMemberOutcome,
    ArchiveExtractionResult,
    extract_archive_to_new_paths,
    validate_archive_rename_targets,
)
from app.services.archive.live_creation import (
    ArchiveCreationWriterAlreadyActive,
    ArchiveCreationWriterMemberDataError,
    ArchiveCreationWriterSessionNotFound,
    LiveArchiveCreationWriterManager,
)
from app.services.archive.operations import (
    fail_operation,
    request_operation_cancellation,
    update_operation_phase,
)
from app.services.archive.target_write import (
    TargetWriteDisposition,
    TargetWriteFailure,
    collision_policy_from_action,
    resolve_target_write_attempt,
)
from app.services.archive.v2_checkpoint import canonical_v2_timestamp, new_v2_extraction_checkpoint
from app.services.archive.zip_reader import ArchiveFormatError, EffectiveArchiveEntries, ZipReader
from app.services.audit import AuditDetails, AuditEventName, AuditResult, write_audit_event
from app.services.connection_access import get_accessible_connection_or_404, require_connection_write_access
from app.services.history_common import LOCAL_DRIVE_PREFIX
from app.storage.smb import SMBBackend

logger = get_logger(__name__)
_local_to_smb_creation_writers = LiveArchiveCreationWriterManager(logger)


async def shutdown_local_to_smb_creation_writers() -> None:
    """Abort foreground local-to-SMB archive targets still held during shutdown."""

    await _local_to_smb_creation_writers.shutdown()


ARCHIVE_COMPANION_TOKEN_EXPIRE_MINUTES = 15
ARCHIVE_COMPANION_TOKEN_CLAIM = "archive_operation"
ARCHIVE_COMPANION_TOKEN_CLASS = "archive_operation"
ARCHIVE_RELAY_IDEMPOTENCY_HEADER = "Idempotency-Key"
ARCHIVE_RELAY_DELIVERY_IDS_KEY = "delivery_ids"
V2_ROUTE_QUERY_PARAMETERS: dict[str, frozenset[str]] = {
    "/v2/operations": frozenset({"active_only", "limit"}),
    "/v2/operations/{operation_id}/cancel": frozenset({"expected_revision"}),
    "/v2/inspection/directory": frozenset({"connection_id", "archive_path", "virtual_path", "cursor", "page_size", "contract_version"}),
    "/v2/inspection/member": frozenset(
        {
            "connection_id",
            "archive_path",
            "member_path",
            "download",
            "view_kind",
            "pdf_variant",
            "viewport_width",
            "viewport_height",
            "no_resizing",
            "screen_width",
            "screen_height",
            "screen_zoom_percent",
            "contract_version",
        }
    ),
    "/v2/operations/{operation_id}/relay/extraction/member": frozenset({"member_path", "is_directory", "source_modified_at"}),
    "/v2/operations/{operation_id}/relay/creation/member": frozenset({"archive_path"}),
}


def _reject_unknown_v2_query_parameters(request: Request) -> None:
    """Enforce the contract's closed-object rule for V2 query strings."""

    route = request.scope.get("route")
    route_path = getattr(route, "path", None)
    if not isinstance(route_path, str):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive V2 query route is invalid")
    unknown = set(request.query_params) - V2_ROUTE_QUERY_PARAMETERS.get(route_path, frozenset())
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Archive V2 query parameters are invalid",
        )


v2_router = APIRouter(prefix="/v2", dependencies=[Depends(_reject_unknown_v2_query_parameters)])


def _validate_archive_relay_idempotency_key(value: str | None) -> None:
    """Accept a backward-compatible Companion acknowledgement delivery ID."""

    if value is None:
        return
    try:
        uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive relay idempotency key is invalid") from exc


def _relay_delivery_replayed(
    operation: ArchiveOperation,
    idempotency_key: str | None,
    *,
    command: str,
    payload: dict[str, object],
) -> bool:
    """Return whether an acknowledgement has already durably completed."""

    if idempotency_key is None:
        return False
    checkpoint = load_archive_checkpoint(operation)
    deliveries = checkpoint.get(ARCHIVE_RELAY_DELIVERY_IDS_KEY, {})
    if not isinstance(deliveries, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive relay delivery checkpoint is invalid")
    fingerprint = json.dumps({"command": command, "payload": payload}, sort_keys=True, separators=(",", ":"))
    existing = deliveries.get(idempotency_key)
    if existing is None:
        return False
    if existing != fingerprint:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive relay idempotency key conflicts with its command")
    return True


def _record_relay_delivery(
    session: Session,
    operation: ArchiveOperation,
    idempotency_key: str | None,
    *,
    command: str,
    payload: dict[str, object],
) -> ArchiveOperation:
    """Persist a successful acknowledgement identity after its ledger mutation."""

    if idempotency_key is None:
        return operation
    checkpoint = load_archive_checkpoint(operation)
    deliveries = checkpoint.setdefault(ARCHIVE_RELAY_DELIVERY_IDS_KEY, {})
    if not isinstance(deliveries, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive relay delivery checkpoint is invalid")
    fingerprint = json.dumps({"command": command, "payload": payload}, sort_keys=True, separators=(",", ":"))
    existing = deliveries.get(idempotency_key)
    if existing is not None:
        if existing != fingerprint:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive relay idempotency key conflicts with its command")
        return operation
    deliveries[idempotency_key] = fingerprint
    return DurableArchiveExecutionStateStore(session).update_checkpoint(operation, json.dumps(checkpoint))


def _validate_archive_companion_token(
    token: str,
    *,
    operation_id: uuid.UUID,
    purpose: str | None,
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
        or (purpose is not None and payload.get("purpose") != purpose)
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


def _record_mixed_archive_member_completion(
    session: Session,
    operation: ArchiveOperation,
    checkpoint: dict[str, object],
    outcome: ArchiveExtractionDestinationResult,
) -> ArchiveOperation:
    """Persist one validated mixed-extraction member outcome and its counters."""

    return persist_extraction_member_outcome(
        DurableArchiveExecutionStateStore(session),
        operation,
        outcome,
        checkpoint=checkpoint,
    )


def _archive_source_identity(info: FileInfo) -> dict[str, object]:
    """Return the stable source metadata available before opening an SMB ZIP."""

    return {
        "size": info.size,
        "modified_at": canonical_v2_timestamp(info.modified_at),
    }


class ArchiveExtractionDirectoryCollision(Exception):
    """A non-directory target blocks a required archive output directory."""

    def __init__(self, path: str, target: FileInfo | None = None) -> None:
        self.path = path
        self.target = target
        super().__init__(f"Archive output directory is blocked: {path}")


def _mixed_directory_collision_member_path(
    execution_plan: ArchiveExtractionExecutionPlan,
    member_path: str,
    destination_root: str,
    target_path: str,
    *,
    is_directory: bool,
) -> str:
    """Map a materialized parent path to the source archive directory that owns it."""

    parts = member_path.split("/")
    directory_count = len(parts) if is_directory else len(parts) - 1
    for index in range(directory_count, 0, -1):
        source_path = "/".join(parts[:index])
        if archive_member_target(destination_root, execution_plan.target_member_path(source_path)) == target_path:
            return source_path
    return member_path


async def _ensure_mixed_archive_parent_directories(
    backend: SMBBackend,
    *,
    destination_root: str,
    target_path: str,
    include_target: bool = False,
) -> int:
    """Create missing output parents below an already-owned destination root."""

    created = 0
    root_parts = destination_root.replace("\\", "/").strip("/").split("/")
    target_parts = target_path.replace("\\", "/").strip("/").split("/")
    if target_parts[: len(root_parts)] != root_parts:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive output path is outside its destination root")
    directory_parts = target_parts if include_target else target_parts[:-1]
    for index in range(len(root_parts) + 1, len(directory_parts) + 1):
        path = "/".join(directory_parts[:index])
        for attempt in range(2):
            try:
                await backend.create_directory(path)
                created += 1
                break
            except FileExistsError as exc:
                try:
                    existing = await backend.get_file_info(path)
                except FileNotFoundError:
                    if attempt == 0:
                        continue
                    raise ArchiveExtractionDirectoryCollision(path) from exc
                if existing.type == FileType.DIRECTORY:
                    break
                raise ArchiveExtractionDirectoryCollision(path, existing)
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


def _require_v2_operation(operation: ArchiveOperation) -> None:
    """Reject any operation that is not pinned to the active V2 contract."""

    if operation.contract_version != ArchiveContractVersion.V2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Archive operation contract version is incompatible with V2",
        )


def _get_owned_v2_operation_or_404(session: Session, current_user: User, operation_id: uuid.UUID) -> ArchiveOperation:
    """Load an owned operation that may enter the V2 route family."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    _require_v2_operation(operation)
    return operation


def _require_backend_archive_execution(operation: ArchiveOperation) -> None:
    """Reject plans whose coordinator must run in Companion rather than the backend."""

    try:
        topology_plan = resolve_archive_operation_topology_plan(
            kind=operation.kind,
            source_connection_id=operation.source_connection_id,
            destination_connection_id=operation.destination_connection_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    if topology_plan.topology.driver != ArchiveExecutionDriver.BACKEND:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Archive execution requires the Companion coordinator",
        )


def _require_expected_archive_operation_revision(operation: ArchiveOperation, expected_revision: int | None) -> None:
    """Reject a client mutation based on a stale archive execution snapshot."""

    if expected_revision is not None and operation.revision != expected_revision:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation revision is stale")


async def prepare_archive_operation(
    payload: ArchiveOperationPrepare,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Persist a validated archive operation before any direct output begins."""

    set_user(current_user.username)
    _verify_operation_connection_scope(session, current_user, connection_id=payload.source_connection_id, requires_write_access=False)
    _verify_operation_connection_scope(session, current_user, connection_id=payload.destination_connection_id, requires_write_access=True)
    try:
        resolve_archive_operation_topology_plan(
            kind=payload.kind,
            source_connection_id=payload.source_connection_id,
            destination_connection_id=payload.destination_connection_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
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


async def get_archive_operation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Return one operation only to its initiating user."""

    return _get_owned_operation_or_404(session, current_user, operation_id)


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


async def create_archive_companion_session(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveCompanionSession:
    """Mint a capability limited to one supported mixed-executor archive operation."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    try:
        topology_plan = resolve_archive_operation_topology_plan(
            kind=operation.kind,
            source_connection_id=operation.source_connection_id,
            destination_connection_id=operation.destination_connection_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    if topology_plan.topology.driver != ArchiveExecutionDriver.COMPANION or topology_plan.topology.companion_purpose is None:
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
            "purpose": topology_plan.topology.companion_purpose,
            "archive_operation_id": str(operation.id),
            "source_connection_id": operation.source_connection_id,
            "source_path": operation.source_path,
            "destination_connection_id": operation.destination_connection_id,
            "destination_path": operation.destination_path,
            "manifest_hash": operation.manifest_hash,
            "contract_version": operation.contract_version.value,
        },
        expires_delta=timedelta(minutes=ARCHIVE_COMPANION_TOKEN_EXPIRE_MINUTES),
    )
    return ArchiveCompanionSession(
        token=token,
        expires_in=ARCHIVE_COMPANION_TOKEN_EXPIRE_MINUTES * 60,
        operation=ArchiveOperationRead.model_validate(operation),
    )


def _get_scoped_companion_operation(
    token: str,
    *,
    operation_id: uuid.UUID,
    binding: ArchiveCompanionRelayPurpose,
    session: Session,
) -> tuple[User, ArchiveOperation]:
    """Return the immutable operation authorized for one mixed relay binding."""

    cached_context = session.info.get("archive_v2_relay_context")
    if isinstance(cached_context, ResolvedRelayOperation):
        if cached_context.operation_id == operation_id and cached_context.operation_token == token:
            if cached_context.binding != binding:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="Archive relay binding does not match the resolved operation"
                )
            return cached_context.user, cached_context.operation
    user, payload = _validate_archive_companion_token(
        token,
        operation_id=operation_id,
        purpose=binding.value,
        session=session,
    )
    return _get_scoped_companion_operation_from_claims(
        user,
        payload,
        operation_id=operation_id,
        binding=binding,
        session=session,
    )


def _get_scoped_companion_operation_from_claims(
    user: User,
    payload: dict[str, Any],
    *,
    operation_id: uuid.UUID,
    binding: ArchiveCompanionRelayPurpose,
    session: Session,
) -> tuple[User, ArchiveOperation]:
    """Bind an already validated capability claim to its owned durable V2 operation."""

    if payload.get("purpose") != binding.value:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Archive Companion session is invalid or expired")
    operation = _get_owned_operation_or_404(session, user, operation_id)
    _require_v2_operation(operation)
    expected_claims = {
        "source_connection_id": operation.source_connection_id,
        "source_path": operation.source_path,
        "destination_connection_id": operation.destination_connection_id,
        "destination_path": operation.destination_path,
        "manifest_hash": operation.manifest_hash,
        "contract_version": operation.contract_version.value,
    }
    if any(payload.get(name) != value for name, value in expected_claims.items()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session scope does not match this operation")
    if (
        operation.kind != binding.kind
        or operation.source_connection_id.startswith(LOCAL_DRIVE_PREFIX) != binding.source_is_local
        or operation.destination_connection_id.startswith(LOCAL_DRIVE_PREFIX) != binding.destination_is_local
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Archive Companion session scope does not permit this operation")
    return user, operation


@dataclass(frozen=True)
class ResolvedRelayOperation:
    """One fully authorized V2 relay operation reused by a single HTTP request."""

    operation_id: uuid.UUID
    binding: ArchiveCompanionRelayPurpose
    operation_token: str
    session: Session
    user: User
    operation: ArchiveOperation


def _resolve_v2_relay_operation(
    operation_id: uuid.UUID,
    operation_token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> ResolvedRelayOperation:
    """Resolve the signed capability and durable binding once before V2 relay dispatch."""

    user, payload = _validate_archive_companion_token(
        operation_token,
        operation_id=operation_id,
        purpose=None,
        session=session,
    )
    purpose_value = payload.get("purpose")
    if not isinstance(purpose_value, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Archive Companion session is invalid or expired")
    try:
        binding = ArchiveCompanionRelayPurpose(purpose_value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Archive Companion session is invalid or expired") from exc
    user, operation = _get_scoped_companion_operation_from_claims(
        user,
        payload,
        operation_id=operation_id,
        binding=binding,
        session=session,
    )
    context = ResolvedRelayOperation(operation_id, binding, operation_token, session, user, operation)
    session.info["archive_v2_relay_context"] = context
    return context


@dataclass(frozen=True)
class ScopedCompanionRelay:
    """One authorized Companion relay context and its common lifecycle actions."""

    operation_id: uuid.UUID
    binding: ArchiveCompanionRelayPurpose
    operation_token: str
    session: Session

    @classmethod
    def from_resolved_context(cls, context: ResolvedRelayOperation) -> "ScopedCompanionRelay":
        """Create the lifecycle binding already authorized by a V2 route dependency."""

        return cls(context.operation_id, context.binding, context.operation_token, context.session)

    def resolve(self) -> tuple[User, ArchiveOperation]:
        """Load the only operation permitted by this scoped relay capability."""

        return _get_scoped_companion_operation(
            self.operation_token,
            operation_id=self.operation_id,
            binding=self.binding,
            session=self.session,
        )

    def fail(self, payload: ArchiveCompanionFailure) -> ArchiveOperation:
        """Persist one terminal relay failure."""

        return self.fail_message(payload.message)

    def fail_message(
        self,
        message: str,
        *,
        error_code: ArchiveOperationErrorCode | None = None,
    ) -> ArchiveOperation:
        """Persist one adapter-detected terminal relay failure."""

        _user, operation = self.resolve()
        return fail_operation(self.session, operation, message, error_code=error_code)

    def complete(self, *, checkpoint_json: str | None = None) -> ArchiveOperation:
        """Complete the relay through the shared durable lifecycle transition."""

        _user, operation = self.resolve()
        return complete_relay_execution(
            DurableArchiveExecutionStateStore(self.session),
            operation,
            checkpoint_json=checkpoint_json,
        )

    def complete_extraction(self, *, destination_root_created: bool) -> ArchiveOperation:
        """Complete a manifest-backed extraction after typed terminal coverage validation."""

        _user, operation = self.resolve()
        return ArchiveExtractionCoordinator(operation, DurableArchiveExecutionStateStore(self.session)).complete(
            destination_root_created=destination_root_created
        )

    def commit_preflight(
        self,
        operation: ArchiveOperation,
        *,
        checkpoint_json: str | None = None,
        allow_streaming: bool = True,
        not_ready_detail: str = "Archive operation is not ready for Companion execution",
    ) -> ArchiveOperation:
        """Advance a successfully preflighted scoped relay into its durable execution phase."""

        if operation.id != self.operation_id:
            raise ValueError("Preflight operation does not match the scoped relay")
        return begin_relay_execution(
            DurableArchiveExecutionStateStore(self.session),
            operation,
            checkpoint_json=checkpoint_json,
            allow_streaming=allow_streaming,
            not_ready_detail=not_ready_detail,
        )

    def begin(self, *, is_active: Callable[[], bool] | None = None) -> tuple[User, ArchiveOperation]:
        """Authorize a manifest relay start while preserving accepted or live resumed state."""

        user, operation = self.resolve()
        if operation.phase not in {ArchiveOperationPhase.ACCEPTED, ArchiveOperationPhase.STREAMING}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not ready for Companion execution")
        if operation.phase == ArchiveOperationPhase.STREAMING and is_active is not None and not is_active():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation session was interrupted")
        if operation.cancellation_requested:
            if operation.phase == ArchiveOperationPhase.ACCEPTED:
                update_operation_phase(
                    self.session,
                    operation,
                    expected_phase=ArchiveOperationPhase.ACCEPTED,
                    next_phase=ArchiveOperationPhase.CANCELLED,
                )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation was cancelled")
        return user, operation

    def streaming(
        self,
        *,
        not_streaming_detail: str,
        is_active: Callable[[], bool] | None = None,
    ) -> tuple[User, ArchiveOperation]:
        """Authorize one active relay action and apply a pending cancellation."""

        user, operation = self.resolve()
        if operation.phase != ArchiveOperationPhase.STREAMING:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=not_streaming_detail)
        if operation.cancellation_requested:
            update_operation_phase(
                self.session, operation, expected_phase=ArchiveOperationPhase.STREAMING, next_phase=ArchiveOperationPhase.CANCELLED
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation was cancelled")
        if is_active is not None and not is_active():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation session was interrupted")
        return user, operation

    async def complete_creation(
        self,
        payload: ArchiveCompanionCreationSummary,
        *,
        is_active: Callable[[], bool] | None = None,
        finalize: Callable[[], Awaitable[None]] | None = None,
        abort: Callable[[], Awaitable[None]] | None = None,
    ) -> ArchiveOperation:
        """Complete a member-reported creation relay and run optional target hooks."""

        _user, operation = self.resolve()
        if (
            operation.phase == ArchiveOperationPhase.STREAMING
            and not operation.cancellation_requested
            and is_active is not None
            and not is_active()
        ):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation session was interrupted")
        return await complete_creation_relay_execution(
            DurableArchiveExecutionStateStore(self.session),
            operation,
            ArchiveCreationResult(**payload.model_dump()),
            finalize=finalize,
            abort=abort,
        )

    async def fail_creation(
        self,
        payload: ArchiveCompanionFailure,
        *,
        abort: Callable[[], Awaitable[None]] | None = None,
    ) -> ArchiveOperation:
        """Record a creation failure and release any optional owned target."""

        operation = self.fail(payload)
        if abort is not None:
            await abort()
        return operation


def _companion_extraction_manifest_response(
    operation: ArchiveOperation,
    manifest: ArchiveExtractionManifest,
) -> ArchiveCompanionExtractionManifest:
    """Serialize a typed extraction manifest only at the Companion API boundary."""

    try:
        entries = [
            ArchiveCompanionManifestEntry(
                path=entry.member_path,
                is_directory=entry.is_directory,
                uncompressed_size=entry.uncompressed_size,
                modified_at=datetime.fromisoformat(entry.source_modified_at) if entry.source_modified_at is not None else None,
            )
            for entry in manifest.members
        ]
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
    return ArchiveCompanionExtractionManifest(operation=ArchiveOperationRead.model_validate(operation), entries=entries)


def _companion_creation_manifest_response(
    operation: ArchiveOperation,
    manifest: ArchiveCreationManifest,
) -> ArchiveCompanionCreationManifest:
    """Serialize a typed creation manifest only at the Companion API boundary."""

    try:
        entries = [
            ArchiveCompanionCreationManifestEntry(
                source_path=entry.source_path,
                archive_path=entry.archive_path,
                is_directory=entry.is_directory,
                source_size=entry.source_size,
                modified_at=entry.source_modified_at,
            )
            for entry in manifest.members
        ]
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid") from exc
    if any(entry.source_path is None for entry in entries):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation checkpoint is invalid")
    return ArchiveCompanionCreationManifest(operation=ArchiveOperationRead.model_validate(operation), entries=entries)


def _mixed_smb_source_connection(session: Session, user: User, operation: ArchiveOperation) -> Connection:
    try:
        return get_accessible_connection_or_404(session, user, uuid.UUID(operation.source_connection_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive source connection ID is invalid") from exc


def _validate_archive_extraction_entry_safety(entries: EffectiveArchiveEntries) -> None:
    """Reject raw unsafe paths and unsupported special member types."""

    if entries.has_unsafe_raw_entry:
        raise ArchiveFormatError("Archive extraction contains an unsafe member path")
    if entries.has_unsupported_special_raw_entry:
        raise ArchiveFormatError("Archive extraction contains a symbolic link or unsupported special member")


def _validate_smb_to_local_manifest(entries: EffectiveArchiveEntries) -> None:
    """Reject any source archive that cannot be streamed safely to a local executor."""

    _validate_archive_extraction_entry_safety(entries)
    if any(entry.encrypted or entry.compression_method not in {0, 8, 12} for entry in entries.regular_entries):
        raise ArchiveFormatError("Archive extraction contains an unavailable member")


def _companion_extraction_manifest(payload: ArchiveCompanionExtractionSourceManifest | None) -> ArchiveExtractionManifest | None:
    """Canonicalize a local Companion source manifest for durable relay comparison."""

    if payload is None:
        return None
    return ArchiveExtractionManifest.from_members(
        [
            ArchiveExtractionManifestMember(
                entry.path,
                entry.is_directory,
                entry.uncompressed_size,
                canonical_v2_timestamp(entry.modified_at),
            )
            for entry in payload.entries
        ]
    )


def _local_manifest_source_snapshot(manifest: ArchiveExtractionManifest) -> dict[str, object]:
    """Derive the stable local ZIP source snapshot carried by its validated manifest."""

    return {
        "size": sum(member.uncompressed_size for member in manifest.members),
        "modified_at": max(
            (member.source_modified_at for member in manifest.members if member.source_modified_at is not None), default=None
        ),
    }


def _mixed_extraction_destination_connection(session: Session, user: User, operation: ArchiveOperation) -> Connection:
    try:
        connection = get_accessible_connection_or_404(session, user, uuid.UUID(operation.destination_connection_id))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive destination connection ID is invalid"
        ) from exc
    require_connection_write_access(user, connection, action="extract archive", path=operation.destination_path)
    return connection


async def begin_companion_archive_extraction(
    payload: ArchiveCompanionExtractionSourceManifest | None = None,
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Claim one new SMB destination root for a scoped local ZIP relay."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    user, operation = relay.begin()
    if operation.phase == ArchiveOperationPhase.STREAMING:
        checkpoint = load_archive_checkpoint(operation)
        manifest = _companion_extraction_manifest(payload)
        if manifest is None:
            relay.fail_message("Archive extraction source manifest is required to resume")
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Archive extraction source manifest is required to resume",
            )
        if manifest != ArchiveExtractionManifest.from_checkpoint(checkpoint):
            relay.fail_message(
                "Archive extraction source changed after manifest validation",
                error_code=ArchiveOperationErrorCode.SOURCE_CHANGED,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Archive extraction source changed after manifest validation",
            )
        return operation
    connection = _mixed_extraction_destination_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        try:
            await backend.create_directory(operation.destination_path)
        except FileExistsError:
            destination_info = await backend.get_file_info(operation.destination_path)
            if destination_info.type != FileType.DIRECTORY:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Archive extraction destination is not a directory",
                )
        manifest = _companion_extraction_manifest(payload)
        if manifest is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Archive extraction source manifest is required",
            )
        return relay.commit_preflight(
            operation,
            checkpoint_json=json.dumps(
                new_v2_extraction_checkpoint(
                    manifest=manifest.checkpoint_entries(),
                    source_snapshot=_local_manifest_source_snapshot(manifest),
                )
            ),
        )
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"mixed archive begin operation {operation.id}")


async def write_companion_archive_member(
    request: Request,
    member_path: str = Query(..., min_length=1),
    is_directory: bool = Query(False),
    source_modified_at: datetime | None = Query(None),
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Stream one validated local ZIP member to its operation-owned SMB target."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    user, operation = relay.streaming(not_streaming_detail="Archive operation is not accepting member output")
    coordinator = ArchiveExtractionCoordinator(operation, DurableArchiveExecutionStateStore(session))
    checkpoint = load_archive_checkpoint(operation)
    execution_plan = ArchiveExtractionExecutionPlan.from_checkpoint(checkpoint, existing_file_policy=operation.collision_policy)
    completed_members = execution_plan.completed_member_paths()
    if member_path in completed_members:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive member has already been written")
    execution_plan.member(member_path, is_directory=is_directory)
    collision_action = execution_plan.collision_action(member_path)
    remapped_member_path = execution_plan.target_member_path(member_path)
    target_path = archive_member_target(operation.destination_path, remapped_member_path)

    connection = _mixed_extraction_destination_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        try:
            created_directories = await _ensure_mixed_archive_parent_directories(
                backend,
                destination_root=operation.destination_path,
                target_path=target_path,
                include_target=is_directory,
            )
        except ArchiveExtractionDirectoryCollision as exc:
            return coordinator.pause_for_collision(
                member_path=_mixed_directory_collision_member_path(
                    execution_plan,
                    member_path,
                    operation.destination_path,
                    exc.path,
                    is_directory=is_directory,
                ),
                is_directory=True,
                target_size=exc.target.size if exc.target is not None else None,
                target_modified_at=exc.target.modified_at if exc.target is not None else None,
                target_path=exc.path,
            )
        if is_directory:
            written = 0
        else:
            target_write = await resolve_target_write_attempt(
                target_path=target_path,
                policy=collision_policy_from_action(collision_action),
                source_modified_at=source_modified_at,
                observe_target=backend.get_file_info,
                stream_factory=request.stream,
                write_target=lambda path, stream, overwrite, mtime: backend.write_file_from_stream(
                    path,
                    stream,
                    overwrite=overwrite,
                    source_mtime=mtime,
                ),
            )
            if target_write.disposition == TargetWriteDisposition.SKIP:
                outcome = ArchiveExtractionMemberOutcome(member_path, "skipped", target_path)
                return coordinator.record_member_completed(outcome)
            if target_write.disposition == TargetWriteDisposition.AWAIT_COLLISION:
                target_info = target_write.target
                return coordinator.pause_for_collision(
                    member_path=member_path,
                    is_directory=target_info is not None and target_info.type != FileType.FILE,
                    target_size=target_info.size if target_info is not None else None,
                    target_modified_at=target_info.modified_at if target_info is not None else None,
                )
            written = target_write.bytes_written
            replace_existing = target_write.replaced
        outcome = ArchiveExtractionMemberOutcome(
            member_path,
            "directory" if is_directory else "extracted",
            target_path,
            extracted_bytes=written,
            directories_created=created_directories,
            replaced=not is_directory and replace_existing,
        )
        return coordinator.record_member_completed(outcome)
    except TargetWriteFailure as exc:
        return coordinator.pause_for_member_error(
            member_path=member_path,
            message=str(exc),
            partial_output=exc.bytes_written > 0,
        )
    except FileExistsError as exc:
        return coordinator.pause_for_member_error(member_path=member_path, message=str(exc), partial_output=False)
    except OSError as exc:
        return coordinator.pause_for_member_error(member_path=member_path, message=str(exc), partial_output=False)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Mixed archive member write failed: operation_id=%s, member_path=%r", operation.id, member_path)
        relay.fail_message(str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive member write failed") from exc
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"mixed archive member operation {operation.id}")


async def complete_companion_archive_extraction(
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Record the terminal result after Companion has streamed all safe members."""

    _validate_archive_relay_idempotency_key(idempotency_key)
    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    _user, operation = relay.resolve()
    payload_data: dict[str, object] = {}
    if _relay_delivery_replayed(operation, idempotency_key, command="extraction_complete", payload=payload_data):
        return operation
    operation = relay.complete_extraction(destination_root_created=False)
    return _record_relay_delivery(session, operation, idempotency_key, command="extraction_complete", payload=payload_data)


async def fail_companion_archive_extraction(
    payload: ArchiveCompanionFailure,
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Record a local ZIP extractor failure without leaving the operation active."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    return relay.fail(payload)


async def begin_companion_local_archive_extraction(
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveCompanionExtractionManifest:
    """Validate and expose one complete SMB ZIP manifest to its local Companion executor."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    user, operation = relay.begin()
    if operation.phase == ArchiveOperationPhase.STREAMING:
        checkpoint = load_archive_checkpoint(operation)
        extraction_state = ArchiveExtractionState.from_checkpoint(checkpoint)
        return _companion_extraction_manifest_response(operation, extraction_state.manifest)
    connection = _mixed_smb_source_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    reader = None
    try:
        await backend.connect()
        archive_info = await backend.get_file_info(operation.source_path)
        if archive_info.type != FileType.FILE or archive_info.size is None:
            raise ArchiveFormatError("Archive extraction source must be a regular file")
        reader = await backend.open_random_access_reader(operation.source_path)
        zip_reader = ZipReader(reader, archive_info.size)
        projection = await zip_reader.effective_entries()
        _validate_smb_to_local_manifest(projection)
        zip_entries = projection.entries
        try:
            manifest = ArchiveExtractionManifest.from_members(
                [
                    ArchiveExtractionManifestMember(
                        entry.path,
                        entry.is_directory,
                        entry.uncompressed_size,
                        canonical_v2_timestamp(entry.modified_at),
                    )
                    for entry in zip_entries
                ]
            )
        except HTTPException as exc:
            raise ArchiveFormatError("Archive extraction output paths are invalid") from exc
        operation = relay.commit_preflight(
            operation,
            checkpoint_json=json.dumps(
                new_v2_extraction_checkpoint(
                    manifest=manifest.checkpoint_entries(),
                    source_snapshot=_archive_source_identity(archive_info),
                )
            ),
        )
        return _companion_extraction_manifest_response(operation, manifest)
    except ArchiveFormatError as exc:
        relay.fail_message(str(exc))
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive extraction source is invalid") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Mixed SMB archive manifest read failed: operation_id=%s", operation.id)
        relay.fail_message(str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive manifest read failed") from exc
    finally:
        if reader is not None:
            await reader.close()
        await disconnect_backend_safely(backend, logger=logger, context=f"mixed archive manifest operation {operation.id}")


async def stream_companion_local_archive_member(
    member_path: str = Query(..., min_length=1),
    relay: ScopedCompanionRelay | None = None,
) -> StreamingResponse:
    """Stream one validated SMB ZIP member directly to the scoped local executor."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    user, operation = relay.streaming(not_streaming_detail="Archive operation is not accepting member reads")
    checkpoint = load_archive_checkpoint(operation)
    extraction_state = ArchiveExtractionState.from_checkpoint(checkpoint)
    expected_member = extraction_state.member(member_path, is_directory=False)
    connection = _mixed_smb_source_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    reader = None
    try:
        await backend.connect()
        archive_info = await backend.get_file_info(operation.source_path)
        if archive_info.type != FileType.FILE or archive_info.size is None:
            raise ArchiveFormatError("Archive extraction source must be a regular file")
        if checkpoint.get("source_snapshot") != _archive_source_identity(archive_info):
            relay.fail_message(
                "Archive extraction source changed after manifest validation",
                error_code=ArchiveOperationErrorCode.SOURCE_CHANGED,
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive extraction source changed after manifest validation")
        reader = await backend.open_random_access_reader(operation.source_path)
        zip_reader = ZipReader(reader, archive_info.size)
        member = (await zip_reader.effective_entries()).member_by_exact_path.get(expected_member.member_path)
        if member is None or member.path != expected_member.member_path or member.uncompressed_size != expected_member.uncompressed_size:
            relay.fail_message(
                "Archive extraction manifest changed after validation",
                error_code=ArchiveOperationErrorCode.SOURCE_CHANGED,
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive extraction manifest changed after validation")
        validated_member = await zip_reader.validate_entry(member)

        async def stream_member() -> AsyncIterator[bytes]:
            try:
                async for chunk in zip_reader.stream_validated_entry(validated_member):
                    if not ArchiveExtractionCoordinator(operation, DurableArchiveExecutionStateStore(session)).advance():
                        return
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


async def complete_companion_local_archive_member(
    payload: ArchiveCompanionExtractionMemberCompletion,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Durably acknowledge one completed local member before the next member opens."""

    _validate_archive_relay_idempotency_key(idempotency_key)
    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    _user, operation = relay.resolve()
    payload_data = payload.model_dump(mode="json")
    if _relay_delivery_replayed(operation, idempotency_key, command="extraction_member_complete", payload=payload_data):
        return operation
    _user, operation = relay.streaming(not_streaming_detail="Archive operation is not accepting member output")
    operation = ArchiveExtractionCoordinator(operation, DurableArchiveExecutionStateStore(session)).record_member_completed(
        ArchiveExtractionMemberOutcome(
            payload.member_path,
            payload.status,
            payload.target_path,
            extracted_bytes=payload.extracted_bytes,
            directories_created=payload.directories_created,
            replaced=payload.replaced,
            renamed=payload.renamed,
        ),
    )
    return _record_relay_delivery(
        session,
        operation,
        idempotency_key,
        command="extraction_member_complete",
        payload=payload_data,
    )


async def pause_companion_local_archive_member_for_collision(
    payload: ArchiveCompanionExtractionCollision,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Pause before Companion opens a verified pre-existing local output target."""

    _validate_archive_relay_idempotency_key(idempotency_key)
    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    _user, operation = relay.resolve()
    payload_data = payload.model_dump(mode="json")
    if _relay_delivery_replayed(operation, idempotency_key, command="extraction_member_collision", payload=payload_data):
        return operation
    _user, operation = relay.streaming(not_streaming_detail="Archive operation is not accepting member output")
    operation = ArchiveExtractionCoordinator(operation, DurableArchiveExecutionStateStore(session)).pause_for_collision(
        member_path=payload.member_path,
        is_directory=payload.is_directory,
        target_size=payload.target_size,
        target_modified_at=payload.target_modified_at,
        target_path=payload.target_path,
    )
    return _record_relay_delivery(
        session,
        operation,
        idempotency_key,
        command="extraction_member_collision",
        payload=payload_data,
    )


async def pause_companion_local_archive_member_for_error(
    payload: ArchiveCompanionExtractionMemberError,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Pause a scoped local member failure for retry or explicit ignore."""

    _validate_archive_relay_idempotency_key(idempotency_key)
    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    _user, operation = relay.resolve()
    payload_data = payload.model_dump(mode="json")
    if _relay_delivery_replayed(operation, idempotency_key, command="extraction_member_error", payload=payload_data):
        return operation
    _user, operation = relay.streaming(not_streaming_detail="Archive operation is not accepting member output")
    operation = ArchiveExtractionCoordinator(operation, DurableArchiveExecutionStateStore(session)).pause_for_member_error(
        member_path=payload.member_path,
        message=payload.message,
        partial_output=payload.partial_output,
    )
    return _record_relay_delivery(
        session,
        operation,
        idempotency_key,
        command="extraction_member_error",
        payload=payload_data,
    )


async def complete_companion_local_archive_extraction(
    payload: ArchiveCompanionExtractionSummary,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Complete after every scoped member outcome commits to the durable ledger."""

    _validate_archive_relay_idempotency_key(idempotency_key)
    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    _user, operation = relay.resolve()
    payload_data = payload.model_dump(mode="json")
    if _relay_delivery_replayed(operation, idempotency_key, command="extraction_complete", payload=payload_data):
        return operation
    operation = relay.complete_extraction(destination_root_created=payload.destination_root_created)
    return _record_relay_delivery(session, operation, idempotency_key, command="extraction_complete", payload=payload_data)


async def fail_companion_local_archive_extraction(
    payload: ArchiveCompanionFailure,
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Record a local executor failure without leaving the operation active."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    return relay.fail(payload)


async def begin_companion_local_archive_creation(
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveCompanionCreationManifest:
    """Preflight complete SMB sources before Companion creates a local ZIP."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    user, operation = relay.begin()
    if operation.phase == ArchiveOperationPhase.STREAMING:
        checkpoint = load_archive_checkpoint(operation)
        creation_state = ArchiveCreationState.from_checkpoint(checkpoint)
        return _companion_creation_manifest_response(operation, creation_state.manifest)
    connection = _mixed_smb_source_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        source_entries = await build_archive_creation_manifest(backend, _creation_source_paths(operation), operation.destination_path)
        manifest = ArchiveCreationManifest.from_members(
            [
                ArchiveCreationManifestMember(
                    entry.archive_path,
                    entry.info.type == FileType.DIRECTORY,
                    entry.info.size or 0,
                    entry.source_path,
                    entry.source_modified_at,
                )
                for entry in source_entries
            ]
        )
        operation = relay.commit_preflight(operation, checkpoint_json=json.dumps(manifest.empty_checkpoint()))
        return _companion_creation_manifest_response(operation, manifest)
    except ArchiveFormatError as exc:
        relay.fail_message(str(exc))
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation sources are invalid") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Mixed SMB archive creation manifest read failed: operation_id=%s", operation.id)
        relay.fail_message(str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive creation manifest read failed") from exc
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"mixed archive creation manifest operation {operation.id}")


async def stream_companion_local_archive_creation_member(
    archive_path: str = Query(..., min_length=1),
    relay: ScopedCompanionRelay | None = None,
) -> StreamingResponse:
    """Stream one preflight-approved SMB regular file to the scoped local ZIP writer."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    user, operation = relay.streaming(not_streaming_detail="Archive operation is not accepting source reads")
    connection = _mixed_smb_source_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        checkpoint = load_archive_checkpoint(operation)
        entry = ArchiveCreationState.from_checkpoint(checkpoint).member(archive_path)
        source_path = entry.source_path
        if entry.is_directory or source_path is None:
            raise ArchiveFormatError("Archive creation member is invalid or unavailable")
        source_info = await backend.get_file_info(source_path)
        if (
            source_info.type != FileType.FILE
            or source_info.size != entry.source_size
            or normalize_archive_creation_source_modified_at(source_info.modified_at) != entry.source_modified_at
        ):
            relay.fail_message(
                "Archive creation source changed after manifest validation",
                error_code=ArchiveOperationErrorCode.SOURCE_CHANGED,
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation source changed after manifest validation")

        async def stream_member() -> AsyncIterator[bytes]:
            try:
                async for chunk in backend.read_file(source_path):
                    if not advance_relay_transfer(DurableArchiveExecutionStateStore(session), operation):
                        return
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


async def complete_companion_local_archive_creation_member(
    payload: ArchiveCompanionCreationMemberCompletion,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Durably acknowledge one local ZIP member before writing the next member."""

    _validate_archive_relay_idempotency_key(idempotency_key)
    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    _user, operation = relay.streaming(not_streaming_detail="Archive operation is not accepting creation member output")
    payload_data = payload.model_dump()
    if _relay_delivery_replayed(operation, idempotency_key, command="creation_member_complete", payload=payload_data):
        return operation
    operation = commit_creation_member_outcome(
        DurableArchiveExecutionStateStore(session),
        operation,
        ArchiveCreationMemberOutcome(payload.archive_path, payload.status, payload.source_bytes),
    )
    return _record_relay_delivery(
        session,
        operation,
        idempotency_key,
        command="creation_member_complete",
        payload=payload_data,
    )


async def complete_companion_local_archive_creation(
    payload: ArchiveCompanionCreationSummary,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Persist the finished local ZIP summary after all scoped SMB members were relayed."""

    _validate_archive_relay_idempotency_key(idempotency_key)
    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    _user, operation = relay.resolve()
    payload_data = payload.model_dump(mode="json")
    if _relay_delivery_replayed(operation, idempotency_key, command="creation_complete", payload=payload_data):
        return operation
    operation = await relay.complete_creation(payload)
    return _record_relay_delivery(session, operation, idempotency_key, command="creation_complete", payload=payload_data)


async def fail_companion_local_archive_creation(
    payload: ArchiveCompanionFailure,
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Record a local ZIP creator failure without leaving the operation active."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    return await relay.fail_creation(payload)


def _local_to_smb_creation_manifest(payload: ArchiveCompanionCreationSourceManifest) -> ArchiveCreationManifest:
    """Translate a Companion source manifest into the shared immutable creation model."""

    return ArchiveCreationManifest.from_members(
        [
            ArchiveCreationManifestMember(
                entry.archive_path,
                entry.is_directory,
                entry.source_size,
                None,
                canonical_v2_timestamp(entry.modified_at),
            )
            for entry in payload.entries
        ]
    )


async def begin_companion_smb_archive_creation(
    payload: ArchiveCompanionCreationSourceManifest,
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Preflight local sources and claim the exclusive SMB ZIP target."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    execution = _local_to_smb_creation_writers.execution(relay.operation_id)
    user, operation = relay.begin(is_active=execution.is_active)
    if operation.phase == ArchiveOperationPhase.STREAMING:
        return operation
    manifest = _local_to_smb_creation_manifest(payload)
    connection = _mixed_extraction_destination_connection(session, user, operation)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        await execution.open(backend, operation.destination_path)
        operation = relay.commit_preflight(
            operation,
            checkpoint_json=json.dumps(manifest.empty_checkpoint()),
            allow_streaming=False,
            not_ready_detail="Archive operation is not ready for Companion output",
        )
        return operation
    except ArchiveCreationWriterAlreadyActive as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation writer is already active") from exc
    except FileExistsError as exc:
        await execution.abort()
        relay.fail_message("Archive creation target already exists")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation target already exists") from exc
    except HTTPException:
        await execution.abort()
        raise
    except Exception as exc:
        await execution.abort()
        logger.exception("Mixed local archive creation setup failed: operation_id=%s", operation.id)
        relay.fail_message(str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive creation setup failed") from exc


async def stream_companion_smb_archive_creation_member(
    request: Request,
    archive_path: str = Query(..., min_length=1),
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Commit one validated local source member through the backend-owned SMB ZIP writer."""

    _validate_archive_relay_idempotency_key(idempotency_key)
    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    execution = _local_to_smb_creation_writers.execution(relay.operation_id)
    _user, operation = relay.streaming(
        not_streaming_detail="Archive operation is not accepting creation member output",
        is_active=execution.is_active,
    )
    checkpoint = load_archive_checkpoint(operation)
    creation_state = ArchiveCreationState.from_checkpoint(checkpoint)
    entry = creation_state.member(archive_path)
    source_size = entry.source_size
    outcome = creation_state.expected_outcome(entry.archive_path)
    payload_data = {"archive_path": archive_path, "source_bytes": source_size}
    if _relay_delivery_replayed(operation, idempotency_key, command="creation_member_upload", payload=payload_data):
        return operation
    if creation_state.has_committed_outcome(outcome):
        return _record_relay_delivery(
            session,
            operation,
            idempotency_key,
            command="creation_member_upload",
            payload=payload_data,
        )

    async def source_chunks() -> AsyncIterator[bytes]:
        source_bytes = 0
        async for chunk in request.stream():
            if not advance_relay_transfer(DurableArchiveExecutionStateStore(session), operation):
                raise ArchiveCreationCancelled("Archive creation was cancelled")
            if len(chunk) > source_size - source_bytes:
                raise ArchiveFormatError("Archive creation source exceeds its declared size")
            source_bytes += len(chunk)
            yield chunk
        if source_bytes != source_size:
            raise ArchiveFormatError("Archive creation source changed after manifest validation")

    try:
        if not advance_relay_transfer(DurableArchiveExecutionStateStore(session), operation):
            raise ArchiveCreationCancelled("Archive creation was cancelled")
        await execution.write_member(
            entry.archive_path,
            is_directory=entry.is_directory,
            source=source_chunks(),
            expected_uncompressed_size=source_size,
        )
        operation = commit_creation_member_outcome(DurableArchiveExecutionStateStore(session), operation, outcome)
        return _record_relay_delivery(
            session,
            operation,
            idempotency_key,
            command="creation_member_upload",
            payload=payload_data,
        )
    except ArchiveCreationCancelled:
        await execution.abort()
        return operation
    except ArchiveCreationWriterMemberDataError as exc:
        await execution.abort()
        relay.fail_message("Archive creation member upload failed")
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except ArchiveCreationWriterSessionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive creation session was interrupted") from exc
    except HTTPException:
        await execution.abort()
        relay.fail_message("Archive creation member upload failed")
        raise
    except ArchiveFormatError as exc:
        await execution.abort()
        relay.fail_message(str(exc), error_code=ArchiveOperationErrorCode.SOURCE_CHANGED)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        await execution.abort()
        logger.exception("Mixed local archive creation member write failed: operation_id=%s", operation.id)
        relay.fail_message(str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Archive creation member output failed") from exc


async def complete_companion_smb_archive_creation(
    payload: ArchiveCompanionCreationSummary,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Finalize a fully reported backend-owned SMB ZIP and checked summary."""

    _validate_archive_relay_idempotency_key(idempotency_key)
    if relay is None:
        raise ValueError("A resolved archive relay is required")
    session = relay.session
    execution = _local_to_smb_creation_writers.execution(relay.operation_id)
    _user, operation = relay.resolve()
    payload_data = payload.model_dump(mode="json")
    if _relay_delivery_replayed(operation, idempotency_key, command="creation_complete", payload=payload_data):
        return operation
    operation = await relay.complete_creation(
        payload,
        is_active=execution.is_active,
        finalize=execution.finalize,
        abort=execution.abort,
    )
    return _record_relay_delivery(session, operation, idempotency_key, command="creation_complete", payload=payload_data)


async def fail_companion_smb_archive_creation(
    payload: ArchiveCompanionFailure,
    relay: ScopedCompanionRelay | None = None,
) -> ArchiveOperation:
    """Record a local ZIP producer failure without leaving the operation active."""

    if relay is None:
        raise ValueError("A resolved archive relay is required")
    execution = _local_to_smb_creation_writers.execution(relay.operation_id)
    return await relay.fail_creation(payload, abort=execution.abort)


@v2_router.post("/operations/{operation_id}/relay/extraction/begin", response_model=None)
async def begin_v2_companion_relay_extraction(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionExtractionSourceManifest | None = None,
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation | ArchiveCompanionExtractionManifest:
    """Begin a V2 extraction relay selected only from its durable operation."""

    purpose = relay_context.binding
    relay = ScopedCompanionRelay.from_resolved_context(relay_context)
    if purpose == ArchiveCompanionRelayPurpose.LOCAL_ZIP_TO_SMB_EXTRACT:
        return await begin_companion_archive_extraction(payload, relay)
    if purpose == ArchiveCompanionRelayPurpose.SMB_ZIP_TO_LOCAL_EXTRACT:
        return await begin_companion_local_archive_extraction(relay)
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not an extraction relay")


@v2_router.get("/operations/{operation_id}/relay/extraction/member")
async def read_v2_companion_relay_extraction_member(
    operation_id: uuid.UUID,
    member_path: str = Query(..., min_length=1),
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> StreamingResponse:
    """Read one source member for an SMB-owned V2 extraction relay."""

    if relay_context.binding != ArchiveCompanionRelayPurpose.SMB_ZIP_TO_LOCAL_EXTRACT:
        raise HTTPException(status_code=status.HTTP_405_METHOD_NOT_ALLOWED, detail="Archive relay does not provide source member reads")
    return await stream_companion_local_archive_member(member_path, ScopedCompanionRelay.from_resolved_context(relay_context))


@v2_router.put("/operations/{operation_id}/relay/extraction/member", response_model=ArchiveOperationRead)
async def write_v2_companion_relay_extraction_member(
    operation_id: uuid.UUID,
    request: Request,
    member_path: str = Query(..., min_length=1),
    is_directory: bool = Query(False),
    source_modified_at: datetime | None = Query(None),
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation:
    """Write one destination member for a local-owned V2 extraction relay."""

    if relay_context.binding != ArchiveCompanionRelayPurpose.LOCAL_ZIP_TO_SMB_EXTRACT:
        raise HTTPException(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED, detail="Archive relay does not accept destination member writes"
        )
    return await write_companion_archive_member(
        request, member_path, is_directory, source_modified_at, ScopedCompanionRelay.from_resolved_context(relay_context)
    )


@v2_router.post("/operations/{operation_id}/relay/extraction/member-complete", response_model=ArchiveOperationRead)
async def complete_v2_companion_relay_extraction_member(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionExtractionMemberCompletion,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation:
    """Acknowledge one local destination member through the V2 relay resource."""

    if relay_context.binding != ArchiveCompanionRelayPurpose.SMB_ZIP_TO_LOCAL_EXTRACT:
        raise HTTPException(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED, detail="Archive relay does not accept member completion acknowledgements"
        )
    return await complete_companion_local_archive_member(
        payload, idempotency_key, ScopedCompanionRelay.from_resolved_context(relay_context)
    )


@v2_router.post("/operations/{operation_id}/relay/extraction/member-collision", response_model=ArchiveOperationRead)
async def pause_v2_companion_relay_extraction_member_for_collision(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionExtractionCollision,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation:
    """Pause an extraction relay for a local destination collision."""

    if relay_context.binding != ArchiveCompanionRelayPurpose.SMB_ZIP_TO_LOCAL_EXTRACT:
        raise HTTPException(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED, detail="Archive relay does not accept collision acknowledgements"
        )
    return await pause_companion_local_archive_member_for_collision(
        payload, idempotency_key, ScopedCompanionRelay.from_resolved_context(relay_context)
    )


@v2_router.post("/operations/{operation_id}/relay/extraction/member-error", response_model=ArchiveOperationRead)
async def pause_v2_companion_relay_extraction_member_for_error(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionExtractionMemberError,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation:
    """Pause an extraction relay for a local destination write failure."""

    if relay_context.binding != ArchiveCompanionRelayPurpose.SMB_ZIP_TO_LOCAL_EXTRACT:
        raise HTTPException(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED, detail="Archive relay does not accept member error acknowledgements"
        )
    return await pause_companion_local_archive_member_for_error(
        payload, idempotency_key, ScopedCompanionRelay.from_resolved_context(relay_context)
    )


@v2_router.post("/operations/{operation_id}/relay/extraction/complete", response_model=ArchiveOperationRead)
async def complete_v2_companion_relay_extraction(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionExtractionSummary | None = None,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation:
    """Complete a V2 extraction relay selected from the durable topology."""

    purpose = relay_context.binding
    relay = ScopedCompanionRelay.from_resolved_context(relay_context)
    if purpose == ArchiveCompanionRelayPurpose.LOCAL_ZIP_TO_SMB_EXTRACT:
        return await complete_companion_archive_extraction(idempotency_key, relay)
    if purpose == ArchiveCompanionRelayPurpose.SMB_ZIP_TO_LOCAL_EXTRACT:
        if payload is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive extraction completion payload is required"
            )
        return await complete_companion_local_archive_extraction(payload, idempotency_key, relay)
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not an extraction relay")


@v2_router.post("/operations/{operation_id}/relay/extraction/fail", response_model=ArchiveOperationRead)
async def fail_v2_companion_relay_extraction(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionFailure,
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation:
    """Fail a V2 extraction relay selected from its durable topology."""

    purpose = relay_context.binding
    relay = ScopedCompanionRelay.from_resolved_context(relay_context)
    if purpose == ArchiveCompanionRelayPurpose.LOCAL_ZIP_TO_SMB_EXTRACT:
        return await fail_companion_archive_extraction(payload, relay)
    if purpose == ArchiveCompanionRelayPurpose.SMB_ZIP_TO_LOCAL_EXTRACT:
        return await fail_companion_local_archive_extraction(payload, relay)
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not an extraction relay")


@v2_router.post("/operations/{operation_id}/relay/creation/begin", response_model=None)
async def begin_v2_companion_relay_creation(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionCreationSourceManifest | None = None,
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation | ArchiveCompanionCreationManifest:
    """Begin a V2 creation relay selected only from its durable operation."""

    purpose = relay_context.binding
    relay = ScopedCompanionRelay.from_resolved_context(relay_context)
    if purpose == ArchiveCompanionRelayPurpose.SMB_TO_LOCAL_ZIP_CREATE:
        return await begin_companion_local_archive_creation(relay)
    if purpose == ArchiveCompanionRelayPurpose.LOCAL_TO_SMB_ZIP_CREATE:
        if payload is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive creation source manifest is required")
        return await begin_companion_smb_archive_creation(payload, relay)
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not a creation relay")


@v2_router.get("/operations/{operation_id}/relay/creation/member")
async def read_v2_companion_relay_creation_member(
    operation_id: uuid.UUID,
    archive_path: str = Query(..., min_length=1),
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> StreamingResponse:
    """Read one SMB source member for a V2 creation relay."""

    if relay_context.binding != ArchiveCompanionRelayPurpose.SMB_TO_LOCAL_ZIP_CREATE:
        raise HTTPException(status_code=status.HTTP_405_METHOD_NOT_ALLOWED, detail="Archive relay does not provide source member reads")
    return await stream_companion_local_archive_creation_member(archive_path, ScopedCompanionRelay.from_resolved_context(relay_context))


@v2_router.put("/operations/{operation_id}/relay/creation/member", response_model=ArchiveOperationRead)
async def write_v2_companion_relay_creation_member(
    operation_id: uuid.UUID,
    request: Request,
    archive_path: str = Query(..., min_length=1),
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation:
    """Write one local source member to the SMB-owned V2 ZIP target."""

    if relay_context.binding != ArchiveCompanionRelayPurpose.LOCAL_TO_SMB_ZIP_CREATE:
        raise HTTPException(status_code=status.HTTP_405_METHOD_NOT_ALLOWED, detail="Archive relay does not accept source member writes")
    return await stream_companion_smb_archive_creation_member(
        request, archive_path, idempotency_key, ScopedCompanionRelay.from_resolved_context(relay_context)
    )


@v2_router.post("/operations/{operation_id}/relay/creation/member-complete", response_model=ArchiveOperationRead)
async def complete_v2_companion_relay_creation_member(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionCreationMemberCompletion,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation:
    """Acknowledge a local ZIP member through the V2 relay resource."""

    if relay_context.binding != ArchiveCompanionRelayPurpose.SMB_TO_LOCAL_ZIP_CREATE:
        raise HTTPException(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED, detail="Archive relay does not accept member completion acknowledgements"
        )
    return await complete_companion_local_archive_creation_member(
        payload, idempotency_key, ScopedCompanionRelay.from_resolved_context(relay_context)
    )


@v2_router.post("/operations/{operation_id}/relay/creation/complete", response_model=ArchiveOperationRead)
async def complete_v2_companion_relay_creation(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionCreationSummary,
    idempotency_key: str | None = Header(default=None, alias=ARCHIVE_RELAY_IDEMPOTENCY_HEADER),
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation:
    """Complete a V2 creation relay selected from the durable topology."""

    purpose = relay_context.binding
    relay = ScopedCompanionRelay.from_resolved_context(relay_context)
    if purpose == ArchiveCompanionRelayPurpose.SMB_TO_LOCAL_ZIP_CREATE:
        return await complete_companion_local_archive_creation(payload, idempotency_key, relay)
    if purpose == ArchiveCompanionRelayPurpose.LOCAL_TO_SMB_ZIP_CREATE:
        return await complete_companion_smb_archive_creation(payload, idempotency_key, relay)
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not a creation relay")


@v2_router.post("/operations/{operation_id}/relay/creation/fail", response_model=ArchiveOperationRead)
async def fail_v2_companion_relay_creation(
    operation_id: uuid.UUID,
    payload: ArchiveCompanionFailure,
    relay_context: ResolvedRelayOperation = Depends(_resolve_v2_relay_operation),
) -> ArchiveOperation:
    """Fail a V2 creation relay selected from its durable topology."""

    purpose = relay_context.binding
    relay = ScopedCompanionRelay.from_resolved_context(relay_context)
    if purpose == ArchiveCompanionRelayPurpose.SMB_TO_LOCAL_ZIP_CREATE:
        return await fail_companion_local_archive_creation(payload, relay)
    if purpose == ArchiveCompanionRelayPurpose.LOCAL_TO_SMB_ZIP_CREATE:
        return await fail_companion_smb_archive_creation(payload, relay)
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archive operation is not a creation relay")


async def transition_archive_operation(
    operation_id: uuid.UUID,
    payload: ArchiveOperationTransition,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Advance one operation through an idempotent permitted transition."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    _require_expected_archive_operation_revision(operation, payload.expected_revision)
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


@asynccontextmanager
async def _open_direct_smb_archive_execution(
    operation_id: uuid.UUID,
    current_user: User,
    session: Session,
    *,
    expected_kind: ArchiveOperationKind,
    kind_name: str,
    write_action: str,
) -> AsyncIterator[tuple[ArchiveOperation, SMBBackend]]:
    """Authorize and connect one same-SMB archive execution for its direct adapter."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    if operation.kind != expected_kind:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Archive operation is not a {kind_name} operation")
    _require_backend_archive_execution(operation)
    try:
        connection = get_accessible_connection_or_404(session, current_user, uuid.UUID(operation.source_connection_id))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Archive {kind_name} connection ID is invalid",
        ) from exc
    require_connection_write_access(current_user, connection, action=write_action, path=operation.destination_path)
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    try:
        await backend.connect()
        yield operation, backend
    finally:
        await disconnect_backend_safely(backend, logger=logger, context=f"archive {kind_name} operation {operation.id}")


async def execute_archive_creation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Create the operation's direct SMB target from its immutable file-source plan."""

    async with _open_direct_smb_archive_execution(
        operation_id,
        current_user,
        session,
        expected_kind=ArchiveOperationKind.CREATE,
        kind_name="creation",
        write_action="create archive",
    ) as (operation, backend):
        source_paths = _creation_source_paths(operation)
        preflight_entries = await build_archive_creation_manifest(backend, source_paths, operation.destination_path)
        manifest = ArchiveCreationManifest.from_members(
            [
                ArchiveCreationManifestMember(
                    archive_path=entry.archive_path,
                    is_directory=entry.info.type == FileType.DIRECTORY,
                    source_size=entry.info.size or 0,
                    source_path=entry.source_path,
                    source_modified_at=entry.source_modified_at,
                )
                for entry in preflight_entries
            ]
        )

        async def run_creation(
            on_member_completed: Callable[[ArchiveCreationMemberOutcome], Awaitable[None]],
            is_cancelled: Callable[[], Awaitable[bool]],
        ) -> ArchiveCreationResult:
            return await create_archive_from_files(
                backend,
                destination=backend,
                source_paths=source_paths,
                target_path=operation.destination_path,
                is_cancelled=is_cancelled,
                on_member_completed=on_member_completed,
                preflight_manifest=manifest,
            )

        return await ArchiveCreationCoordinator(
            operation=operation,
            state_store=DurableArchiveExecutionStateStore(session),
        ).run(run_creation, execution_plan=ArchiveCreationExecutionPlan(manifest))


async def execute_archive_extraction(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Extract the operation's archive into new paths on its source SMB connection."""

    async with _open_direct_smb_archive_execution(
        operation_id,
        current_user,
        session,
        expected_kind=ArchiveOperationKind.EXTRACT,
        kind_name="extraction",
        write_action="extract archive",
    ) as (operation, backend):
        if operation.phase == ArchiveOperationPhase.PREPARED:
            archive_info = await backend.get_file_info(operation.source_path)
            if archive_info.type != FileType.FILE or archive_info.size is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive extraction source must be a regular file"
                )
            random_reader = await backend.open_random_access_reader(operation.source_path)
            try:
                zip_reader = ZipReader(random_reader, archive_info.size)
                projection = await zip_reader.effective_entries()
                _validate_archive_extraction_entry_safety(projection)
                entries = projection.entries
            finally:
                await random_reader.close()
            manifest = ArchiveExtractionManifest.from_members(
                [
                    ArchiveExtractionManifestMember(
                        entry.path,
                        entry.is_directory,
                        entry.uncompressed_size,
                        canonical_v2_timestamp(entry.modified_at),
                    )
                    for entry in entries
                ]
            )
            checkpoint = new_v2_extraction_checkpoint(
                manifest=manifest.checkpoint_entries(),
                source_snapshot=_archive_source_identity(archive_info),
            )
            operation = DurableArchiveExecutionStateStore(session).update_checkpoint(operation, json.dumps(checkpoint))
        else:
            checkpoint = load_archive_checkpoint(operation)
            archive_info = await backend.get_file_info(operation.source_path)
            if (
                archive_info.type != FileType.FILE
                or archive_info.size is None
                or checkpoint.get("source_snapshot") != _archive_source_identity(archive_info)
            ):
                DurableArchiveExecutionStateStore(session).fail(
                    operation,
                    "Archive extraction source changed after manifest validation",
                    error_code=ArchiveOperationErrorCode.SOURCE_CHANGED,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Archive extraction source changed after manifest validation",
                )

        async def run_extraction(
            execution_plan: ArchiveExtractionExecutionPlan,
            record_member_completed: Callable[[ArchiveExtractionDestinationResult], Awaitable[None]],
            is_cancelled: Callable[[], Awaitable[bool]],
        ) -> ArchiveExtractionResult:
            return await extract_archive_to_new_paths(
                backend,
                destination=backend,
                archive_path=operation.source_path,
                destination_root=operation.destination_path,
                execution_plan=execution_plan,
                on_member_completed=record_member_completed,
                is_cancelled=is_cancelled,
            )

        coordinator = ArchiveExtractionCoordinator(
            operation=operation,
            state_store=DurableArchiveExecutionStateStore(session),
        )
        return await coordinator.run(run_extraction)


async def decide_archive_extraction(
    operation_id: uuid.UUID,
    payload: ArchiveExtractionDecision,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Apply an allowed all-files collision policy or cancel the paused extraction."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    _require_expected_archive_operation_revision(operation, payload.expected_revision)
    if payload.action == "cancel":
        return update_operation_phase(
            session,
            operation,
            expected_phase=ArchiveOperationPhase.AWAITING_USER_DECISION,
            next_phase=ArchiveOperationPhase.CANCELLED,
        )
    if payload.action == "rename" and not operation.source_connection_id.startswith(LOCAL_DRIVE_PREFIX):
        await _validate_archive_extraction_rename(session, current_user, operation, payload)
    return ArchiveExtractionCoordinator(
        operation=operation,
        state_store=DurableArchiveExecutionStateStore(session),
    ).apply_decision(payload.action, member_path=payload.member_path, target_path=payload.target_path)


async def _validate_archive_extraction_rename(
    session: Session,
    current_user: User,
    operation: ArchiveOperation,
    payload: ArchiveExtractionDecision,
) -> None:
    """Reject a rename that would make the complete archive output ambiguous."""

    if not isinstance(payload.member_path, str) or not isinstance(payload.target_path, str):
        return
    try:
        connection = get_accessible_connection_or_404(session, current_user, uuid.UUID(operation.source_connection_id))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive extraction connection ID is invalid"
        ) from exc
    backend = build_smb_backend(connection, backend_factory=SMBBackend)
    reader = None
    try:
        await backend.connect()
        archive_info = await backend.get_file_info(operation.source_path)
        if archive_info.type != FileType.FILE or archive_info.size is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive extraction source must be a regular file"
            )
        reader = await backend.open_random_access_reader(operation.source_path)
        entries = (await ZipReader(reader, archive_info.size).effective_entries()).entries
        rename_targets = ArchiveExtractionDecisionState.from_checkpoint(load_archive_checkpoint(operation)).rename_targets()
        rename_targets[payload.member_path] = payload.target_path
        validate_archive_rename_targets(entries, rename_targets)
    except ArchiveFormatError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    finally:
        if reader is not None:
            await reader.close()
        await disconnect_backend_safely(backend, logger=logger, context=f"archive extraction rename validation {operation.id}")


async def cancel_archive_operation(
    operation_id: uuid.UUID,
    expected_revision: int | None = Query(default=None, ge=0),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Request cancellation; the executor checks this between bounded chunks."""

    operation = _get_owned_operation_or_404(session, current_user, operation_id)
    _require_expected_archive_operation_revision(operation, expected_revision)
    operation = request_operation_cancellation(session, operation)
    execution = _local_to_smb_creation_writers.execution(operation.id)
    if execution.is_active():
        return await complete_creation_relay_execution(
            DurableArchiveExecutionStateStore(session),
            operation,
            ArchiveCreationResult(files_created=0, directories_created=0, source_bytes=0),
            abort=execution.abort,
        )
    await execution.abort()
    return operation


@v2_router.post("/operations", response_model=ArchiveOperationRead, status_code=status.HTTP_201_CREATED)
async def prepare_v2_archive_operation(
    payload: ArchiveOperationPrepare,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Create one V2-pinned durable archive operation."""

    if payload.contract_version != ArchiveContractVersion.V2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive operation contract version is incompatible with V2"
        )
    return await prepare_archive_operation(payload, current_user, session)


@v2_router.get("/inspection/directory", response_model=ArchiveDirectoryListing)
async def list_v2_archive_directory(
    connection_id: uuid.UUID,
    archive_path: str = Query(..., min_length=1),
    virtual_path: str = Query(""),
    cursor: str | None = Query(None),
    page_size: int = Query(100, ge=1, le=500),
    contract_version: ArchiveContractVersion = Query(...),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveDirectoryListing:
    """Inspect an SMB archive directory through the V2 non-durable contract."""

    if contract_version != ArchiveContractVersion.V2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive inspection contract version is incompatible with V2"
        )
    return await list_archive_directory(
        connection_id,
        archive_path,
        virtual_path,
        cursor,
        page_size,
        current_user,
        session,
    )


@v2_router.get("/inspection/member", response_model=None)
async def stream_v2_archive_member(
    connection_id: uuid.UUID,
    archive_path: str = Query(..., min_length=1),
    member_path: str = Query(..., min_length=1),
    download: bool = Query(False),
    view_kind: Literal["raw", "text", "image", "pdf"] = Query("raw"),
    pdf_variant: Literal["original", "normalized"] = Query("original"),
    viewport_width: int | None = Query(None),
    viewport_height: int | None = Query(None),
    no_resizing: bool = Query(False),
    screen_width: int | None = Query(None, ge=320, le=16384),
    screen_height: int | None = Query(None, ge=320, le=16384),
    screen_zoom_percent: int = Query(200, ge=100, le=400),
    contract_version: ArchiveContractVersion = Query(...),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> Response | StreamingResponse:
    """Read one SMB archive member through the V2 non-durable contract."""

    if contract_version != ArchiveContractVersion.V2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archive inspection contract version is incompatible with V2"
        )
    return await stream_archive_member(
        connection_id,
        archive_path,
        member_path,
        download,
        view_kind,
        pdf_variant,
        viewport_width,
        viewport_height,
        no_resizing,
        screen_width,
        screen_height,
        screen_zoom_percent,
        current_user,
        session,
    )


@v2_router.get("/operations/{operation_id}", response_model=ArchiveOperationRead)
async def get_v2_archive_operation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Read one V2-pinned durable archive operation."""

    return _get_owned_v2_operation_or_404(session, current_user, operation_id)


@v2_router.get("/operations", response_model=list[ArchiveOperationRead])
async def list_v2_archive_operations(
    active_only: bool = Query(default=False),
    limit: int = Query(default=25, ge=1, le=100),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> list[ArchiveOperation]:
    """List owned V2 operations only."""

    operations = await list_archive_operations(active_only, limit, current_user, session)
    for operation in operations:
        _require_v2_operation(operation)
    return operations


@v2_router.post("/operations/{operation_id}/companion-session", response_model=ArchiveCompanionSession)
async def create_v2_archive_companion_session(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveCompanionSession:
    """Mint one signed V2 Companion capability."""

    _get_owned_v2_operation_or_404(session, current_user, operation_id)
    return await create_archive_companion_session(operation_id, current_user, session)


@v2_router.post("/operations/{operation_id}/phase", response_model=ArchiveOperationRead)
async def transition_v2_archive_operation_phase(
    operation_id: uuid.UUID,
    payload: ArchiveOperationTransition,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Advance a V2 operation through an allowed lifecycle transition."""

    operation = _get_owned_v2_operation_or_404(session, current_user, operation_id)
    _require_expected_archive_operation_revision(operation, payload.expected_revision)
    return update_operation_phase(session, operation, expected_phase=payload.expected_phase, next_phase=payload.next_phase)


@v2_router.post("/operations/{operation_id}/creation/begin", response_model=ArchiveOperationRead)
async def begin_v2_archive_creation(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Begin V2 direct SMB creation through the shared creation coordinator."""

    _get_owned_v2_operation_or_404(session, current_user, operation_id)
    return await execute_archive_creation(operation_id, current_user, session)


@v2_router.post("/operations/{operation_id}/extraction/begin", response_model=ArchiveOperationRead)
async def begin_v2_archive_extraction(
    operation_id: uuid.UUID,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Begin V2 direct SMB extraction through the shared extraction coordinator."""

    _get_owned_v2_operation_or_404(session, current_user, operation_id)
    return await execute_archive_extraction(operation_id, current_user, session)


@v2_router.post("/operations/{operation_id}/extraction/decision", response_model=ArchiveOperationRead)
async def decide_v2_archive_extraction(
    operation_id: uuid.UUID,
    payload: ArchiveExtractionDecision,
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Apply one V2 extraction decision."""

    _get_owned_v2_operation_or_404(session, current_user, operation_id)
    return await decide_archive_extraction(operation_id, payload, current_user, session)


@v2_router.post("/operations/{operation_id}/cancel", response_model=ArchiveOperationRead)
async def cancel_v2_archive_operation(
    operation_id: uuid.UUID,
    expected_revision: int | None = Query(default=None, ge=0),
    current_user: User = Depends(get_current_user_with_auth_check),
    session: Session = Depends(get_session),
) -> ArchiveOperation:
    """Cancel one V2 operation without entering legacy route dispatch."""

    _get_owned_v2_operation_or_404(session, current_user, operation_id)
    return await cancel_archive_operation(operation_id, expected_revision, current_user, session)
