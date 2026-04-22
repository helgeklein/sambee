//! HMAC-SHA256 authentication middleware for the local API server.
//!
//! Validates requests by checking the `X-Companion-Secret` header, which
//! must contain `HMAC-SHA256(shared_secret, timestamp)`, and the
//! `X-Companion-Timestamp` header which carries the timestamp string.
//! Requests with timestamps deviating more than 30 seconds are rejected.
//!
//! Viewer endpoints also support query-parameter auth (`hmac` + `ts` params)
//! for use in `<img src>` / `<iframe>` contexts where headers can't be set.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Query, State};
use axum::http::Request;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use hmac::{Hmac, Mac};
use log::warn;
use serde::Deserialize;
use sha2::Sha256;

use super::errors::ApiError;
use super::AppState;

/// Name of the header carrying the HMAC value.
const SECRET_HEADER: &str = "x-companion-secret";

/// Name of the header carrying the timestamp used in the HMAC.
const TIMESTAMP_HEADER: &str = "x-companion-timestamp";

/// Maximum clock skew allowed (seconds).
const MAX_TIMESTAMP_SKEW: u64 = 30;

/// Request context included in authentication warning logs.
pub(super) struct AuthLogContext<'a> {
    pub(super) auth_transport: &'a str,
    pub(super) method: &'a str,
    pub(super) path: &'a str,
}

/// Query parameters for viewer URL auth (fallback when headers aren't set).
#[derive(Deserialize, Default)]
struct AuthQueryParams {
    hmac: Option<String>,
    ts: Option<String>,
    /// Origin identifier for query-param auth (the paired origin).
    origin: Option<String>,
}

/// Cached HMAC validation state (holds no secrets itself — retrieves from keychain on demand).
pub struct AuthState {
    // No persistent state needed — secrets are in the keychain
    // and origins are validated per-request.
}

impl AuthState {
    pub fn new() -> Self {
        Self {}
    }
}

/// Axum middleware that validates HMAC-authenticated requests.
///
/// Extracts the `Origin` header to determine which pairing secret to use,
/// then verifies the HMAC in `X-Companion-Secret` against the shared secret.
pub async fn require_auth(State(state): State<Arc<AppState>>, request: Request<axum::body::Body>, next: Next) -> Response {
    let log_context = AuthLogContext {
        auth_transport: "header",
        method: request.method().as_str(),
        path: request.uri().path(),
    };

    match extract_auth_credentials(&request) {
        Ok((origin, hmac_value, timestamp_str)) => match validate_hmac(&state, &origin, &hmac_value, &timestamp_str, &log_context) {
            Ok(()) => next.run(request).await,
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    }
}

/// Axum middleware that validates requests via headers OR query-param fallback.
///
/// First tries header-based auth (Origin + X-Companion-Secret + X-Companion-Timestamp).
/// If headers are missing, falls back to query params (`hmac`, `ts`, `origin`).
/// Used for viewer endpoints where the URL is used in `<img src>` attributes.
pub async fn require_auth_or_query(State(state): State<Arc<AppState>>, request: Request<axum::body::Body>, next: Next) -> Response {
    // Try header-based auth first
    let header_log_context = AuthLogContext {
        auth_transport: "header",
        method: request.method().as_str(),
        path: request.uri().path(),
    };
    if let Ok((origin, hmac_value, timestamp_str)) = extract_auth_credentials(&request) {
        return match validate_hmac(&state, &origin, &hmac_value, &timestamp_str, &header_log_context) {
            Ok(()) => next.run(request).await,
            Err(e) => e.into_response(),
        };
    }

    // Fall back to query-param auth
    let query: AuthQueryParams = Query::try_from_uri(request.uri()).map(|q| q.0).unwrap_or_default();

    let Some(hmac_value) = query.hmac else {
        return ApiError::Forbidden("Missing authentication (headers or query params)".to_string()).into_response();
    };

    let Some(timestamp_str) = query.ts else {
        return ApiError::Forbidden("Missing timestamp in query params".to_string()).into_response();
    };

    // For query-param auth, we need the origin in the query string since
    // browser resource requests (img src) don't include Origin headers.
    let origin = query.origin.unwrap_or_default();
    if origin.is_empty() {
        return ApiError::Forbidden("Missing origin in query params".to_string()).into_response();
    }

    let query_log_context = AuthLogContext {
        auth_transport: "query",
        method: request.method().as_str(),
        path: request.uri().path(),
    };

    match validate_hmac(&state, &origin, &hmac_value, &timestamp_str, &query_log_context) {
        Ok(()) => next.run(request).await,
        Err(e) => e.into_response(),
    }
}

/// Extract auth credentials from request headers.
fn extract_auth_credentials(request: &Request<axum::body::Body>) -> Result<(String, String, String), ApiError> {
    let origin = request
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::Forbidden("Missing Origin header".to_string()))?;

    let hmac_value = request
        .headers()
        .get(SECRET_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::Forbidden("Missing X-Companion-Secret header".to_string()))?;

    let timestamp_str = request
        .headers()
        .get(TIMESTAMP_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::Forbidden("Missing X-Companion-Timestamp header".to_string()))?;

    Ok((origin, hmac_value, timestamp_str))
}

/// Validate HMAC credentials against the stored secret for an origin.
///
/// Called from middleware and also from the WebSocket upgrade handler.
pub(super) fn validate_hmac_public(
    state: &AppState,
    origin: &str,
    hmac_value: &str,
    timestamp_str: &str,
    log_context: &AuthLogContext,
) -> Result<(), ApiError> {
    validate_hmac(state, origin, hmac_value, timestamp_str, log_context)
}

/// Validate HMAC credentials against the stored secret for an origin.
fn validate_hmac(
    state: &AppState,
    origin: &str,
    hmac_value: &str,
    timestamp_str: &str,
    log_context: &AuthLogContext,
) -> Result<(), ApiError> {
    // Get shared secret for this origin from pairing state
    let secret = state.pairing.get_secret_for_origin(origin).ok_or_else(|| {
        warn!(
            "Auth rejected: no pairing found for origin {origin}; transport={}; method={}; path={}",
            log_context.auth_transport, log_context.method, log_context.path,
        );
        ApiError::Forbidden("Not paired with this origin".to_string())
    })?;

    // Validate timestamp (within ±MAX_TIMESTAMP_SKEW seconds)
    let timestamp: u64 = timestamp_str
        .parse()
        .map_err(|_| ApiError::Forbidden("Invalid timestamp format".to_string()))?;

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let diff = now.abs_diff(timestamp);

    if diff > MAX_TIMESTAMP_SKEW {
        let direction = if timestamp > now { "future" } else { "past" };
        warn!(
            "Auth rejected: timestamp skew {diff}s exceeds {MAX_TIMESTAMP_SKEW}s; transport={}; method={}; path={}; origin={origin}; server_ts={now}; request_ts={timestamp}; direction={direction}",
            log_context.auth_transport,
            log_context.method,
            log_context.path,
        );
        return Err(ApiError::Forbidden("Request timestamp too old or too new".to_string()));
    }

    // Verify HMAC.
    // The secret is a hex string (e.g. "a1b2c3..."). Both sides use the
    // UTF-8 bytes of this string as the HMAC key (matching the frontend's
    // `TextEncoder.encode(secret)`).
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|_| ApiError::Internal("HMAC initialization failed".to_string()))?;
    mac.update(timestamp_str.as_bytes());

    let expected = hex::encode(mac.finalize().into_bytes());

    if expected != hmac_value {
        warn!(
            "Auth rejected: HMAC mismatch for origin {origin}; transport={}; method={}; path={}; server_ts={now}; request_ts={timestamp}",
            log_context.auth_transport, log_context.method, log_context.path,
        );
        return Err(ApiError::Forbidden("Invalid authentication".to_string()));
    }

    if !state.pairing.is_origin_paired(origin) {
        state.pairing.record_verified_origin(origin);
    }

    Ok(())
}
