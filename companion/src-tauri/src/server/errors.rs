//! Error types for the local HTTP API server.
//!
//! Error responses use `{"detail": "..."}` to match FastAPI's default
//! `HTTPException` format, which the Sambee frontend expects.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::Value;

/// API error type that converts into appropriate HTTP responses.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Conflict")]
    Conflict(Value),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

/// Standard error response matching FastAPI's `HTTPException` format.
#[derive(Serialize)]
struct ErrorResponse {
    detail: Value,
}

impl ApiError {
    /// Create a Conflict error with a plain string detail message.
    pub fn conflict_message(msg: impl Into<String>) -> Self {
        ApiError::Conflict(Value::String(msg.into()))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, detail) = match self {
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, Value::String(msg)),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, Value::String(msg)),
            ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, Value::String(msg)),
            ApiError::Conflict(val) => (StatusCode::CONFLICT, val),
            ApiError::Io(ref e) => {
                let code = match e.kind() {
                    std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                    std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
                    _ => StatusCode::INTERNAL_SERVER_ERROR,
                };
                (code, Value::String(self.to_string()))
            }
            ApiError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, Value::String(msg)),
        };

        let body = ErrorResponse { detail };

        (status, axum::Json(body)).into_response()
    }
}
