"""Stable error envelopes for the public Archive V2 API."""

from __future__ import annotations

from typing import cast

from fastapi import HTTPException, Request, status
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

ARCHIVE_V2_API_PREFIX = "/api/archive/v2"


def _is_archive_v2_request(request: Request) -> bool:
    return request.url.path == ARCHIVE_V2_API_PREFIX or request.url.path.startswith(f"{ARCHIVE_V2_API_PREFIX}/")


def _error_code(status_code: int, detail: object) -> str:
    message = str(detail).lower()
    if "idempotency" in message:
        return "idempotency_conflict"
    if "checkpoint" in message:
        return "invalid_checkpoint"
    if "manifest" in message:
        return "invalid_manifest"
    if "member path" in message:
        return "invalid_member_path"
    if "source" in message and "changed" in message:
        return "source_changed"
    if "partial" in message:
        return "partial_output"
    if "cancel" in message:
        return "cancelled"
    if status_code == status.HTTP_401_UNAUTHORIZED:
        return "capability_invalid" if "companion session" in message else "authentication_invalid"
    if status_code == status.HTTP_403_FORBIDDEN:
        return "capability_invalid" if "companion session" in message else "authorization_denied"
    if status_code == status.HTTP_404_NOT_FOUND:
        return "not_found"
    if status_code == status.HTTP_405_METHOD_NOT_ALLOWED:
        return "operation_unavailable"
    if status_code == status.HTTP_409_CONFLICT:
        return "invalid_operation_state"
    if status_code in {status.HTTP_400_BAD_REQUEST, status.HTTP_413_CONTENT_TOO_LARGE, status.HTTP_422_UNPROCESSABLE_CONTENT}:
        return "invalid_request"
    return "transport_failure"


def _message(detail: object) -> str:
    if isinstance(detail, str) and detail:
        return detail[:500]
    return "Archive V2 request failed"


async def archive_v2_http_exception_handler(request: Request, exc: Exception) -> Response:
    """Emit the V2 problem envelope while preserving all other API responses."""

    http_exception = cast(HTTPException, exc)
    if not _is_archive_v2_request(request):
        return await http_exception_handler(request, http_exception)
    return JSONResponse(
        status_code=http_exception.status_code,
        content={
            "code": _error_code(http_exception.status_code, http_exception.detail),
            "message": _message(http_exception.detail),
        },
        headers=http_exception.headers,
    )


async def archive_v2_request_validation_exception_handler(request: Request, exc: Exception) -> Response:
    """Do not leak framework-specific validation payloads from the V2 contract."""

    if not _is_archive_v2_request(request):
        return await request_validation_exception_handler(request, cast(RequestValidationError, exc))
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"code": "invalid_request", "message": "Archive V2 request validation failed"},
    )
