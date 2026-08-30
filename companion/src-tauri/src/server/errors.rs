//! Error types for the local HTTP API server.
//!
//! Error responses use `{"detail": "..."}` to match FastAPI's default
//! `HTTPException` format, which the Sambee frontend expects.

use axum::extract::{FromRequest, FromRequestParts, Json, Query, Request};
use axum::http::{request::Parts, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

/// Stable error code used while browser pairing is still awaiting companion approval.
pub const PAIR_CONFIRMATION_PENDING_CODE: &str = "pair_confirmation_pending";
/// Stable error code for a recent local file that no longer exists.
pub const RECENT_FILE_TARGET_MISSING_CODE: &str = "recent_file_target_missing";
/// Stable error code for a recent local target that is no longer a regular file.
pub const RECENT_FILE_TARGET_NOT_FILE_CODE: &str = "recent_file_target_not_file";
/// Stable error code for a confirmed failure to launch a local native application.
pub const RECENT_FILE_NATIVE_LAUNCH_FAILED_CODE: &str = "recent_file_native_launch_failed";
/// Stable error code for a link whose target no longer exists.
pub const LOCAL_LINK_TARGET_MISSING_CODE: &str = "local_link_target_missing";
/// Stable error code for a link whose target cannot be read by the Companion.
pub const LOCAL_LINK_TARGET_ACCESS_DENIED_CODE: &str = "local_link_target_access_denied";
/// Stable error code for a malformed or non-filesystem local link.
pub const LOCAL_LINK_TARGET_UNRESOLVABLE_CODE: &str = "local_link_target_unresolvable";
/// Stable error code for a link whose target is not available through a local drive route.
pub const LOCAL_LINK_TARGET_UNMAPPED_DRIVE_CODE: &str = "local_link_target_unmapped_drive";
/// Stable error code for a link whose target is not a regular file or directory.
pub const LOCAL_LINK_TARGET_UNSUPPORTED_TYPE_CODE: &str = "local_link_target_unsupported_type";
/// Stable error code when direct archive extraction leaves a partial destination.
pub const LOCAL_ARCHIVE_EXTRACTION_PARTIAL_CODE: &str = "local_archive_extraction_partial";
/// Stable error code when direct archive creation leaves a partial ZIP output.
pub const LOCAL_ARCHIVE_CREATION_PARTIAL_CODE: &str = "local_archive_creation_partial";

/// V2-only failure that always serializes to the language-neutral archive contract envelope.
#[derive(Debug)]
pub struct ArchiveV2Error {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ArchiveV2Error {
    pub fn invalid_request() -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "invalid_request",
            message: "Archive V2 request validation failed".to_string(),
        }
    }
}

impl From<ApiError> for ArchiveV2Error {
    fn from(error: ApiError) -> Self {
        let (status, code, message) = match error {
            ApiError::NotFound(message) | ApiError::NotFoundWithCode { message, .. } => (StatusCode::NOT_FOUND, "not_found", message),
            ApiError::BadRequest(message) | ApiError::BadRequestWithCode { message, .. } => {
                (StatusCode::BAD_REQUEST, "invalid_request", message)
            }
            ApiError::Forbidden(message) | ApiError::ForbiddenWithCode { message, .. } => {
                (StatusCode::FORBIDDEN, "authorization_denied", message)
            }
            ApiError::TooManyRequests(message) => (StatusCode::TOO_MANY_REQUESTS, "transport_failure", message),
            ApiError::PayloadTooLarge(message) => (StatusCode::PAYLOAD_TOO_LARGE, "invalid_request", message),
            ApiError::Conflict(detail) => {
                let message = match detail {
                    Value::String(message) => message,
                    detail => detail.to_string(),
                };
                let code = if message.contains("idempotency") {
                    "idempotency_conflict"
                } else if message.contains("cancel") {
                    "cancelled"
                } else {
                    "invalid_operation_state"
                };
                (StatusCode::CONFLICT, code, message)
            }
            ApiError::ConflictWithCode { message, code } => (StatusCode::CONFLICT, code, message),
            ApiError::Io(error) => (StatusCode::INTERNAL_SERVER_ERROR, "transport_failure", error.to_string()),
            ApiError::Internal(message) | ApiError::InternalWithCode { message, .. } => {
                (StatusCode::INTERNAL_SERVER_ERROR, "transport_failure", message)
            }
        };
        Self {
            status,
            code,
            message: message.chars().take(500).collect(),
        }
    }
}

impl IntoResponse for ArchiveV2Error {
    fn into_response(self) -> Response {
        (
            self.status,
            axum::Json(serde_json::json!({ "code": self.code, "message": self.message })),
        )
            .into_response()
    }
}

/// V2 JSON extractor that returns the archive contract envelope on parse failures.
pub struct ArchiveV2Json<T>(pub T);

impl<S, T> FromRequest<S> for ArchiveV2Json<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ArchiveV2Error;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        Json::<T>::from_request(request, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(|_| ArchiveV2Error::invalid_request())
    }
}

/// V2 query extractor that returns the archive contract envelope on parse failures.
pub struct ArchiveV2Query<T>(pub T);

impl<S, T> FromRequestParts<S> for ArchiveV2Query<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ArchiveV2Error;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Query::<T>::from_request_parts(parts, state)
            .await
            .map(|Query(value)| Self(value))
            .map_err(|_| ArchiveV2Error::invalid_request())
    }
}

/// API error type that converts into appropriate HTTP responses.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Not found: {message}")]
    NotFoundWithCode { message: String, code: &'static str },

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Bad request: {message}")]
    BadRequestWithCode { message: String, code: &'static str },

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Forbidden: {message}")]
    ForbiddenWithCode { message: String, code: &'static str },

    #[error("Too many requests: {0}")]
    TooManyRequests(String),

    #[error("Payload too large: {0}")]
    PayloadTooLarge(String),

    #[error("Conflict")]
    Conflict(Value),

    #[error("Conflict: {message}")]
    ConflictWithCode { message: String, code: &'static str },

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Internal error: {message}")]
    InternalWithCode { message: String, code: &'static str },
}

/// Standard error response matching FastAPI's `HTTPException` format.
#[derive(Serialize)]
struct ErrorResponse {
    detail: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
}

impl ApiError {
    /// Create a Conflict error with a plain string detail message.
    pub fn conflict_message(msg: impl Into<String>) -> Self {
        ApiError::Conflict(Value::String(msg.into()))
    }

    /// Create a Conflict error with a stable machine-readable code.
    pub fn conflict_code(msg: impl Into<String>, code: &'static str) -> Self {
        ApiError::ConflictWithCode { message: msg.into(), code }
    }

    /// Create a not-found response with a stable machine-readable code.
    pub fn not_found_code(msg: impl Into<String>, code: &'static str) -> Self {
        ApiError::NotFoundWithCode { message: msg.into(), code }
    }

    /// Create a bad-request response with a stable machine-readable code.
    pub fn bad_request_code(msg: impl Into<String>, code: &'static str) -> Self {
        ApiError::BadRequestWithCode { message: msg.into(), code }
    }

    /// Create a forbidden response with a stable machine-readable code.
    pub fn forbidden_code(msg: impl Into<String>, code: &'static str) -> Self {
        ApiError::ForbiddenWithCode { message: msg.into(), code }
    }

    /// Create an internal-error response with a stable machine-readable code.
    pub fn internal_code(msg: impl Into<String>, code: &'static str) -> Self {
        ApiError::InternalWithCode { message: msg.into(), code }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, detail, code) = match self {
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, Value::String(msg), None),
            ApiError::NotFoundWithCode { message, code } => (StatusCode::NOT_FOUND, Value::String(message), Some(code)),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, Value::String(msg), None),
            ApiError::BadRequestWithCode { message, code } => (StatusCode::BAD_REQUEST, Value::String(message), Some(code)),
            ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, Value::String(msg), None),
            ApiError::ForbiddenWithCode { message, code } => (StatusCode::FORBIDDEN, Value::String(message), Some(code)),
            ApiError::TooManyRequests(msg) => (StatusCode::TOO_MANY_REQUESTS, Value::String(msg), None),
            ApiError::PayloadTooLarge(msg) => (StatusCode::PAYLOAD_TOO_LARGE, Value::String(msg), None),
            ApiError::Conflict(val) => (StatusCode::CONFLICT, val, None),
            ApiError::ConflictWithCode { message, code } => (StatusCode::CONFLICT, Value::String(message), Some(code)),
            ApiError::Io(ref e) => {
                let code = match e.kind() {
                    std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                    std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
                    _ => StatusCode::INTERNAL_SERVER_ERROR,
                };
                (code, Value::String(self.to_string()), None)
            }
            ApiError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, Value::String(msg), None),
            ApiError::InternalWithCode { message, code } => (StatusCode::INTERNAL_SERVER_ERROR, Value::String(message), Some(code)),
        };

        let body = ErrorResponse { detail, code };

        (status, axum::Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, response::IntoResponse};

    use super::{ApiError, ArchiveV2Error, RECENT_FILE_TARGET_NOT_FILE_CODE};

    #[tokio::test]
    async fn coded_bad_request_includes_the_permanent_target_code() {
        let response = ApiError::bad_request_code("Not a file", RECENT_FILE_TARGET_NOT_FILE_CODE).into_response();

        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("response body should be JSON"),
            serde_json::json!({ "detail": "Not a file", "code": RECENT_FILE_TARGET_NOT_FILE_CODE })
        );
    }

    #[tokio::test]
    async fn archive_v2_error_uses_the_contract_envelope() {
        let response = ArchiveV2Error::from(ApiError::conflict_message(
            "Archive relay idempotency key conflicts with its command",
        ))
        .into_response();

        assert_eq!(response.status(), axum::http::StatusCode::CONFLICT);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("response body should be JSON"),
            serde_json::json!({
                "code": "idempotency_conflict",
                "message": "Archive relay idempotency key conflicts with its command",
            })
        );
    }
}
