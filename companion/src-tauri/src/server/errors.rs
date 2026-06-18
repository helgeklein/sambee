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

/// API error type that converts into appropriate HTTP responses.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

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
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, detail, code) = match self {
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, Value::String(msg), None),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, Value::String(msg), None),
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
        };

        let body = ErrorResponse { detail, code };

        (status, axum::Json(body)).into_response()
    }
}
