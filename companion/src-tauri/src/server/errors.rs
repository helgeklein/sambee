//! Error types for the local HTTP API server.
//!
//! Error responses use `{"detail": "..."}` to match FastAPI's default
//! `HTTPException` format, which the Sambee frontend expects.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::Value;

/// Stable error code used while browser pairing is still awaiting companion approval.
pub const PAIR_CONFIRMATION_PENDING_CODE: &str = "pair_confirmation_pending";
/// Stable error code for a recent local file that no longer exists.
pub const RECENT_FILE_TARGET_MISSING_CODE: &str = "recent_file_target_missing";
/// Stable error code for a recent local target that is no longer a regular file.
pub const RECENT_FILE_TARGET_NOT_FILE_CODE: &str = "recent_file_target_not_file";
/// Stable error code for a confirmed failure to launch a local native application.
pub const RECENT_FILE_NATIVE_LAUNCH_FAILED_CODE: &str = "recent_file_native_launch_failed";

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

    #[error("Too many requests: {0}")]
    TooManyRequests(String),

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
            ApiError::TooManyRequests(msg) => (StatusCode::TOO_MANY_REQUESTS, Value::String(msg), None),
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

    use super::{ApiError, RECENT_FILE_TARGET_NOT_FILE_CODE};

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
}
