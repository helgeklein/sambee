//! Tauri command for uploading edited files back to the Sambee server.
//!
//! Uploads via `POST /api/browse/{connId}/upload?path=...` (multipart).
//! Includes retry logic (3 attempts, exponential backoff) and progress events.

use std::fs;
use std::path::Path;
use std::time::Duration;

use log::{error, info, warn};
use reqwest::header;
use reqwest::multipart;
use reqwest::Client;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::http_client::{
    classify_proxy_auth_intercept, log_request_error, plain_client, SambeeHttpClientStore, DEFAULT_REQUEST_TIMEOUT_SECS,
};
use crate::sync::operations::{CompanionLockContext, UPLOAD_MAX_RETRIES, UPLOAD_RETRY_BASE_MS};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// HTTP request timeout for file upload (5 minutes for large files).
const UPLOAD_TIMEOUT_SECS: u64 = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Response types
// ─────────────────────────────────────────────────────────────────────────────

/// Deserialized response from the upload endpoint.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct UploadResponse {
    pub status: String,
    pub path: String,
    pub size: u64,
    pub last_modified: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LockResponse {
    lock_id: String,
    lock_capability: String,
    operation_id: String,
    operation_token: String,
    renew_after_seconds: u64,
}

#[derive(Debug, Deserialize)]
pub struct RenewSessionResponse {
    pub token: String,
    #[allow(dead_code)]
    pub expires_in: u64,
    pub renew_after_seconds: u64,
}

#[derive(Debug, Deserialize)]
struct BackendErrorResponse {
    detail: BackendErrorDetail,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BackendErrorDetail {
    #[allow(dead_code)]
    Message(String),
    Structured(BackendStructuredErrorDetail),
}

#[derive(Debug, Deserialize)]
struct BackendStructuredErrorDetail {
    code: String,
    message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompanionLifecycleErrorCode {
    RenewalRequired,
    AuthFailed,
    LockLost,
    RecoveryRequired,
}

const LIFECYCLE_ERROR_PREFIX: &str = "sambee_companion_lifecycle:";

impl CompanionLifecycleErrorCode {
    fn as_str(self) -> &'static str {
        match self {
            Self::RenewalRequired => "renewal_required",
            Self::AuthFailed => "auth_failed",
            Self::LockLost => "lock_lost",
            Self::RecoveryRequired => "recovery_required",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "renewal_required" => Some(Self::RenewalRequired),
            "auth_failed" => Some(Self::AuthFailed),
            "lock_lost" => Some(Self::LockLost),
            "recovery_required" => Some(Self::RecoveryRequired),
            _ => None,
        }
    }
}

fn encode_lifecycle_error(code: CompanionLifecycleErrorCode, message: &str) -> String {
    format!("{LIFECYCLE_ERROR_PREFIX}{}:{message}", code.as_str())
}

fn decode_lifecycle_error(error: &str) -> Option<(CompanionLifecycleErrorCode, &str)> {
    let payload = error.strip_prefix(LIFECYCLE_ERROR_PREFIX)?;
    let (code, message) = payload.split_once(':')?;
    Some((CompanionLifecycleErrorCode::from_str(code)?, message))
}

fn classify_lifecycle_error(body_text: &str) -> Option<String> {
    let parsed: BackendErrorResponse = serde_json::from_str(body_text).ok()?;
    match parsed.detail {
        BackendErrorDetail::Structured(detail) => {
            let code = CompanionLifecycleErrorCode::from_str(&detail.code)?;
            Some(encode_lifecycle_error(code, &detail.message))
        }
        BackendErrorDetail::Message(_) => None,
    }
}

pub fn lifecycle_error_message(error: &str) -> Option<&str> {
    decode_lifecycle_error(error).map(|(_, message)| message)
}

pub fn is_renewal_required_error(error: &str) -> bool {
    matches!(
        decode_lifecycle_error(error),
        Some((CompanionLifecycleErrorCode::RenewalRequired, _))
    )
}

pub fn is_lock_lost_error(error: &str) -> bool {
    matches!(decode_lifecycle_error(error), Some((CompanionLifecycleErrorCode::LockLost, _)))
}

pub fn is_auth_failed_error(error: &str) -> bool {
    matches!(decode_lifecycle_error(error), Some((CompanionLifecycleErrorCode::AuthFailed, _)))
}

pub fn is_recovery_required_error(error: &str) -> bool {
    matches!(decode_lifecycle_error(error), Some((CompanionLifecycleErrorCode::RecoveryRequired, _)))
}

fn build_operation_query<'a>(remote_path: &'a str, lock_context: &'a CompanionLockContext) -> [(&'a str, &'a str); 4] {
    [
        ("path", remote_path),
        ("operation_id", lock_context.operation_id.as_str()),
        ("lock_id", lock_context.lock_id.as_str()),
        ("lock_capability", lock_context.lock_capability.as_str()),
    ]
}

fn build_lock_control_body(lock_context: &CompanionLockContext) -> serde_json::Value {
    serde_json::json!({
        "operation_id": lock_context.operation_id,
        "lock_id": lock_context.lock_id,
        "lock_capability": lock_context.lock_capability,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

//
// upload_file
//
/// Upload a local file to the Sambee server with retry and progress reporting.
///
/// Calls `POST /api/browse/{connId}/upload?path={remote_path}` with a
/// multipart form body. Retries up to 3 times with exponential backoff
/// on transient failures.
///
/// Emits `upload-progress` events to the specified Tauri window via
/// `AppHandle::emit_to`.
#[allow(dead_code)]
pub async fn upload_file(
    app: &AppHandle,
    window_label: &str,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    local_path: &Path,
    lock_context: &CompanionLockContext,
) -> Result<UploadResponse, String> {
    let client = plain_client()?;
    upload_file_with_client(
        &client,
        app,
        window_label,
        server_url,
        connection_id,
        remote_path,
        local_path,
        lock_context,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn upload_file_with_store(
    http_clients: &SambeeHttpClientStore,
    app: &AppHandle,
    window_label: &str,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    local_path: &Path,
    lock_context: &CompanionLockContext,
) -> Result<UploadResponse, String> {
    let client = http_clients.client_for_server(server_url)?;
    upload_file_with_client(
        &client,
        app,
        window_label,
        server_url,
        connection_id,
        remote_path,
        local_path,
        lock_context,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn upload_file_with_client(
    client: &Client,
    app: &AppHandle,
    window_label: &str,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    local_path: &Path,
    lock_context: &CompanionLockContext,
) -> Result<UploadResponse, String> {
    let filename = local_path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());

    let file_bytes = fs::read(local_path).map_err(|e| format!("Failed to read local file {}: {e}", local_path.display()))?;

    let _total_size = file_bytes.len() as f32;

    info!(
        "Uploading: {} ({} bytes) → {}/{}",
        local_path.display(),
        file_bytes.len(),
        connection_id,
        remote_path
    );

    let url = format!("{}/api/browse/{}/upload", server_url.trim_end_matches('/'), connection_id);

    let mut last_error = String::new();

    for attempt in 1..=UPLOAD_MAX_RETRIES {
        // Emit progress: start of attempt
        let progress = if attempt == 1 { 0.0 } else { 0.05 }; // Small offset for retries
        let _ = app.emit_to(window_label, "upload-progress", serde_json::json!({ "progress": progress }));

        // Guess MIME type from filename
        let mime_type = mime_guess::from_path(local_path).first_or_octet_stream().to_string();

        let file_part = multipart::Part::bytes(file_bytes.clone())
            .file_name(filename.clone())
            .mime_str(&mime_type)
            .map_err(|e| format!("Failed to set MIME type: {e}"))?;

        let form = multipart::Form::new().part("file", file_part);

        match client
            .post(&url)
            .timeout(Duration::from_secs(UPLOAD_TIMEOUT_SECS))
            .query(&build_operation_query(remote_path, lock_context))
            .header("Authorization", format!("Bearer {}", lock_context.operation_token))
            .multipart(form)
            .send()
            .await
        {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    // Emit 100% progress
                    let _ = app.emit_to(window_label, "upload-progress", serde_json::json!({ "progress": 1.0 }));

                    let content_type = response
                        .headers()
                        .get(header::CONTENT_TYPE)
                        .and_then(|value| value.to_str().ok())
                        .map(str::to_owned)
                        .unwrap_or_default();
                    let body_text = response.text().await.map_err(|e| format!("Failed to read upload response: {e}"))?;

                    if !content_type.to_ascii_lowercase().contains("application/json") {
                        if let Some(message) = classify_proxy_auth_intercept("File upload", Some(status), Some(&content_type), &body_text) {
                            return Err(message);
                        }
                        return Err(format!("Failed to parse upload response: unexpected content type '{content_type}'"));
                    }

                    let body: UploadResponse =
                        serde_json::from_str(&body_text).map_err(|e| format!("Failed to parse upload response: {e}"))?;

                    info!("Upload complete: {} → {}, size={}", local_path.display(), body.path, body.size);
                    return Ok(body);
                }

                // Non-success — check if retryable
                let content_type = response
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_owned);
                let body_text = response.text().await.unwrap_or_default();
                if let Some(message) = classify_proxy_auth_intercept("File upload", Some(status), content_type.as_deref(), &body_text) {
                    return Err(message);
                }
                if let Some(message) = classify_lifecycle_error(&body_text) {
                    return Err(message);
                }
                last_error = format!("HTTP {status}: {body_text}");

                // 4xx errors (except 408/429) are not retryable
                if status.is_client_error() && status.as_u16() != 408 && status.as_u16() != 429 {
                    error!("Upload failed (non-retryable): {last_error}");
                    return Err(format!("Upload failed: {last_error}"));
                }

                warn!("Upload attempt {attempt}/{UPLOAD_MAX_RETRIES} failed: {last_error}");
            }
            Err(error) => {
                last_error = log_request_error("Upload request", "POST", &url, &error);
                warn!("Upload attempt {attempt}/{UPLOAD_MAX_RETRIES} error: {last_error}");
            }
        }

        // Exponential backoff before retry (but not after the last attempt)
        if attempt < UPLOAD_MAX_RETRIES {
            let delay_ms = UPLOAD_RETRY_BASE_MS * 2u64.pow(attempt - 1);
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;

            // Emit a small progress bump to show we're retrying
            let retry_progress = (attempt as f32 / UPLOAD_MAX_RETRIES as f32) * 0.1;
            let _ = app.emit_to(window_label, "upload-progress", serde_json::json!({ "progress": retry_progress }));
        }
    }

    error!("Upload failed after {UPLOAD_MAX_RETRIES} attempts: {last_error}");
    Err(format!("Upload failed after {UPLOAD_MAX_RETRIES} attempts: {last_error}"))
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock management helpers
// ─────────────────────────────────────────────────────────────────────────────

//
// acquire_lock
//
/// Acquire an edit lock on a file.
///
/// `POST /api/companion/{connId}/lock?path={remote_path}`
#[allow(dead_code)]
pub async fn acquire_lock(
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    session_token: &str,
) -> Result<CompanionLockContext, String> {
    let client = plain_client()?;
    acquire_lock_with_client(&client, server_url, connection_id, remote_path, session_token).await
}

pub async fn acquire_lock_with_store(
    http_clients: &SambeeHttpClientStore,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    session_token: &str,
) -> Result<CompanionLockContext, String> {
    let client = http_clients.client_for_server(server_url)?;
    acquire_lock_with_client(&client, server_url, connection_id, remote_path, session_token).await
}

pub async fn acquire_lock_with_client(
    client: &Client,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    session_token: &str,
) -> Result<CompanionLockContext, String> {
    let url = format!("{}/api/companion/{}/lock", server_url.trim_end_matches('/'), connection_id);

    let response = client
        .post(&url)
        .timeout(Duration::from_secs(DEFAULT_REQUEST_TIMEOUT_SECS))
        .query(&[("path", remote_path)])
        .header("Authorization", format!("Bearer {session_token}"))
        .send()
        .await
        .map_err(|error| log_request_error("Lock acquire request", "POST", &url, &error))?;

    let status = response.status();
    if !status.is_success() {
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response.text().await.unwrap_or_default();
        if let Some(message) = classify_proxy_auth_intercept("Lock acquire", Some(status), content_type.as_deref(), &body) {
            return Err(message);
        }
        if let Some(message) = classify_lifecycle_error(&body) {
            return Err(message);
        }
        return Err(format!("Lock acquire failed (HTTP {status}): {body}"));
    }

    let body: LockResponse = response.json().await.map_err(|e| format!("Failed to parse lock response: {e}"))?;

    info!("Lock acquired: lock_id={}, operation_id={}", body.lock_id, body.operation_id);
    Ok(CompanionLockContext {
        lock_id: body.lock_id,
        lock_capability: body.lock_capability,
        operation_id: body.operation_id,
        operation_token: body.operation_token,
        renew_after_seconds: body.renew_after_seconds,
        token_issued_at_epoch_seconds: chrono::Utc::now().timestamp(),
    })
}

//
// release_lock
//
/// Release an edit lock on a file.
///
/// `DELETE /api/companion/{connId}/lock?path={remote_path}`
#[allow(dead_code)]
pub async fn release_lock(
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
) -> Result<(), String> {
    let client = plain_client()?;
    release_lock_with_client(&client, server_url, connection_id, remote_path, lock_context).await
}

pub async fn release_lock_with_store(
    http_clients: &SambeeHttpClientStore,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
) -> Result<(), String> {
    let client = http_clients.client_for_server(server_url)?;
    release_lock_with_client(&client, server_url, connection_id, remote_path, lock_context).await
}

pub async fn release_lock_with_client(
    client: &Client,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
) -> Result<(), String> {
    let url = format!("{}/api/companion/{}/lock", server_url.trim_end_matches('/'), connection_id);

    let response = client
        .delete(&url)
        .timeout(Duration::from_secs(DEFAULT_REQUEST_TIMEOUT_SECS))
        .query(&[("path", remote_path)])
        .header("Authorization", format!("Bearer {}", lock_context.operation_token))
        .json(&build_lock_control_body(lock_context))
        .send()
        .await
        .map_err(|error| log_request_error("Lock release request", "DELETE", &url, &error))?;

    let status = response.status();
    if !status.is_success() {
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response.text().await.unwrap_or_default();
        if let Some(message) = classify_proxy_auth_intercept("Lock release", Some(status), content_type.as_deref(), &body) {
            return Err(message);
        }
        if let Some(message) = classify_lifecycle_error(&body) {
            return Err(message);
        }
        warn!("Lock release failed (HTTP {status}): {body}");
        // Non-fatal: lock will expire via heartbeat timeout
        return Err(format!("Lock release failed (HTTP {status}): {body}"));
    }

    info!("Lock released: conn_id={}, path={}", connection_id, remote_path);
    Ok(())
}

//
// send_heartbeat
//
/// Send a heartbeat to keep an edit lock alive.
///
/// `POST /api/companion/{connId}/lock/heartbeat?path={remote_path}`
pub async fn send_heartbeat(
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
) -> Result<(), String> {
    let client = plain_client()?;
    send_heartbeat_with_client(&client, server_url, connection_id, remote_path, lock_context).await
}

pub async fn send_heartbeat_with_store(
    http_clients: &SambeeHttpClientStore,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
) -> Result<(), String> {
    let client = http_clients.client_for_server(server_url)?;
    send_heartbeat_with_client(&client, server_url, connection_id, remote_path, lock_context).await
}

pub async fn send_heartbeat_with_client(
    client: &Client,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
) -> Result<(), String> {
    let url = format!(
        "{}/api/companion/{}/lock/heartbeat",
        server_url.trim_end_matches('/'),
        connection_id
    );

    let response = client
        .post(&url)
        .timeout(Duration::from_secs(DEFAULT_REQUEST_TIMEOUT_SECS))
        .query(&[("path", remote_path)])
        .header("Authorization", format!("Bearer {}", lock_context.operation_token))
        .json(&build_lock_control_body(lock_context))
        .send()
        .await
        .map_err(|error| log_request_error("Heartbeat request", "POST", &url, &error))?;

    let status = response.status();
    if !status.is_success() {
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response.text().await.unwrap_or_default();
        if let Some(message) = classify_proxy_auth_intercept("Heartbeat", Some(status), content_type.as_deref(), &body) {
            return Err(message);
        }
        if let Some(message) = classify_lifecycle_error(&body) {
            return Err(message);
        }
        return Err(format!("Heartbeat failed: {body}"));
    }

    Ok(())
}

pub async fn renew_operation_session(
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
) -> Result<CompanionLockContext, String> {
    let client = plain_client()?;
    renew_operation_session_with_client(&client, server_url, connection_id, remote_path, lock_context).await
}

pub async fn renew_operation_session_with_store(
    http_clients: &SambeeHttpClientStore,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
) -> Result<CompanionLockContext, String> {
    let client = http_clients.client_for_server(server_url)?;
    renew_operation_session_with_client(&client, server_url, connection_id, remote_path, lock_context).await
}

pub async fn renew_operation_session_with_client(
    client: &Client,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
) -> Result<CompanionLockContext, String> {
    let url = format!("{}/api/companion/{}/session/renew", server_url.trim_end_matches('/'), connection_id);

    let response = client
        .post(&url)
        .timeout(Duration::from_secs(DEFAULT_REQUEST_TIMEOUT_SECS))
        .query(&[("path", remote_path)])
        .header("Authorization", format!("Bearer {}", lock_context.operation_token))
        .json(&build_lock_control_body(lock_context))
        .send()
        .await
        .map_err(|error| log_request_error("Operation session renew request", "POST", &url, &error))?;

    let status = response.status();
    if !status.is_success() {
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response.text().await.unwrap_or_default();
        if let Some(message) = classify_proxy_auth_intercept("Operation session renew", Some(status), content_type.as_deref(), &body) {
            return Err(message);
        }
        if let Some(message) = classify_lifecycle_error(&body) {
            return Err(message);
        }
        return Err(format!("Operation session renew failed (HTTP {status}): {body}"));
    }

    let body: RenewSessionResponse = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse operation session renewal response: {error}"))?;

    Ok(CompanionLockContext {
        lock_id: lock_context.lock_id.clone(),
        lock_capability: lock_context.lock_capability.clone(),
        operation_id: lock_context.operation_id.clone(),
        operation_token: body.token,
        renew_after_seconds: body.renew_after_seconds,
        token_issued_at_epoch_seconds: chrono::Utc::now().timestamp(),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    //
    // test_upload_response_deserialization
    //
    #[test]
    fn test_upload_response_deserialization() {
        let json = r#"{
            "status": "ok",
            "path": "/docs/report.docx",
            "size": 12345,
            "last_modified": "2026-02-10T14:30:00"
        }"#;
        let resp: UploadResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.status, "ok");
        assert_eq!(resp.path, "/docs/report.docx");
        assert_eq!(resp.size, 12345);
        assert_eq!(resp.last_modified.as_deref(), Some("2026-02-10T14:30:00"));
    }

    //
    // test_upload_response_null_modified
    //
    #[test]
    fn test_upload_response_null_modified() {
        let json = r#"{"status": "ok", "path": "/a.txt", "size": 0, "last_modified": null}"#;
        let resp: UploadResponse = serde_json::from_str(json).unwrap();
        assert!(resp.last_modified.is_none());
    }

    #[test]
    fn test_classify_lifecycle_error_parses_structured_backend_error() {
        let body = r#"{"detail":{"code":"renewal_required","message":"renew now"}}"#;
        let encoded = classify_lifecycle_error(body).expect("expected lifecycle error");

        assert!(is_renewal_required_error(&encoded));
        assert_eq!(lifecycle_error_message(&encoded), Some("renew now"));
    }

    #[test]
    fn test_classify_lifecycle_error_parses_auth_failed_backend_error() {
        let body = r#"{"detail":{"code":"auth_failed","message":"auth now"}}"#;
        let encoded = classify_lifecycle_error(body).expect("expected lifecycle error");

        assert!(is_auth_failed_error(&encoded));
        assert_eq!(lifecycle_error_message(&encoded), Some("auth now"));
    }

    #[test]
    fn test_classify_lifecycle_error_parses_recovery_required_backend_error() {
        let body = r#"{"detail":{"code":"recovery_required","message":"recover now"}}"#;
        let encoded = classify_lifecycle_error(body).expect("expected lifecycle error");

        assert!(is_recovery_required_error(&encoded));
        assert_eq!(lifecycle_error_message(&encoded), Some("recover now"));
    }

    #[test]
    fn test_classify_lifecycle_error_ignores_plain_detail() {
        let body = r#"{"detail":"plain error"}"#;
        assert!(classify_lifecycle_error(body).is_none());
    }

    //
    // test_acquire_lock_bad_server
    //
    #[tokio::test]
    async fn test_acquire_lock_bad_server() {
        let result = acquire_lock("http://127.0.0.1:1", "test-conn", "/docs/test.txt", "fake-token").await;
        assert!(result.is_err());
    }

    //
    // test_release_lock_bad_server
    //
    #[tokio::test]
    async fn test_release_lock_bad_server() {
        let lock_context = CompanionLockContext {
            lock_id: "lock-test".to_string(),
            lock_capability: "cap-test".to_string(),
            operation_id: "op-test".to_string(),
            operation_token: "operation-token".to_string(),
            renew_after_seconds: 600,
            token_issued_at_epoch_seconds: 1_700_000_000,
        };

        let result = release_lock("http://127.0.0.1:1", "test-conn", "/docs/test.txt", &lock_context).await;
        assert!(result.is_err());
    }

    //
    // test_send_heartbeat_bad_server
    //
    #[tokio::test]
    async fn test_send_heartbeat_bad_server() {
        let lock_context = CompanionLockContext {
            lock_id: "lock-test".to_string(),
            lock_capability: "cap-test".to_string(),
            operation_id: "op-test".to_string(),
            operation_token: "operation-token".to_string(),
            renew_after_seconds: 600,
            token_issued_at_epoch_seconds: 1_700_000_000,
        };

        let result = send_heartbeat("http://127.0.0.1:1", "test-conn", "/docs/test.txt", &lock_context).await;
        assert!(result.is_err());
    }
}
