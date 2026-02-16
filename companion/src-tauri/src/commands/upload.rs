//! Tauri command for uploading edited files back to the Sambee server.
//!
//! Uploads via `POST /api/viewer/{connId}/upload?path=...` (multipart).
//! Includes retry logic (3 attempts, exponential backoff) and progress events.

use std::fs;
use std::path::Path;

use log::{error, info, warn};
use reqwest::multipart;
use reqwest::Client;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::sync::operations::{UPLOAD_MAX_RETRIES, UPLOAD_RETRY_BASE_MS};

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

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

//
// upload_file
//
/// Upload a local file to the Sambee server with retry and progress reporting.
///
/// Calls `POST /api/viewer/{connId}/upload?path={remote_path}` with a
/// multipart form body. Retries up to 3 times with exponential backoff
/// on transient failures.
///
/// Emits `upload-progress` events to the specified Tauri window via
/// `AppHandle::emit_to`.
pub async fn upload_file(
    app: &AppHandle,
    window_label: &str,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    local_path: &Path,
    session_token: &str,
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

    let url = format!("{}/api/viewer/{}/upload", server_url.trim_end_matches('/'), connection_id);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(UPLOAD_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

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
            .query(&[("path", remote_path)])
            .header("Authorization", format!("Bearer {session_token}"))
            .multipart(form)
            .send()
            .await
        {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    // Emit 100% progress
                    let _ = app.emit_to(window_label, "upload-progress", serde_json::json!({ "progress": 1.0 }));

                    let body: UploadResponse = response.json().await.map_err(|e| format!("Failed to parse upload response: {e}"))?;

                    info!("Upload complete: {} → {}, size={}", local_path.display(), body.path, body.size);
                    return Ok(body);
                }

                // Non-success — check if retryable
                let body_text = response.text().await.unwrap_or_default();
                last_error = format!("HTTP {status}: {body_text}");

                // 4xx errors (except 408/429) are not retryable
                if status.is_client_error() && status.as_u16() != 408 && status.as_u16() != 429 {
                    error!("Upload failed (non-retryable): {last_error}");
                    return Err(format!("Upload failed: {last_error}"));
                }

                warn!("Upload attempt {attempt}/{UPLOAD_MAX_RETRIES} failed: {last_error}");
            }
            Err(e) => {
                last_error = format!("{e}");
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
pub async fn acquire_lock(server_url: &str, connection_id: &str, remote_path: &str, session_token: &str) -> Result<String, String> {
    let url = format!("{}/api/companion/{}/lock", server_url.trim_end_matches('/'), connection_id);

    let client = Client::new();
    let response = client
        .post(&url)
        .query(&[("path", remote_path)])
        .header("Authorization", format!("Bearer {session_token}"))
        .json(&serde_json::json!({ "companion_session": session_token }))
        .send()
        .await
        .map_err(|e| format!("Lock acquire request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Lock acquire failed (HTTP {status}): {body}"));
    }

    #[derive(Deserialize)]
    struct LockResp {
        lock_id: String,
    }

    let body: LockResp = response.json().await.map_err(|e| format!("Failed to parse lock response: {e}"))?;

    info!("Lock acquired: lock_id={}", body.lock_id);
    Ok(body.lock_id)
}

//
// release_lock
//
/// Release an edit lock on a file.
///
/// `DELETE /api/companion/{connId}/lock?path={remote_path}`
pub async fn release_lock(server_url: &str, connection_id: &str, remote_path: &str, session_token: &str) -> Result<(), String> {
    let url = format!("{}/api/companion/{}/lock", server_url.trim_end_matches('/'), connection_id);

    let client = Client::new();
    let response = client
        .delete(&url)
        .query(&[("path", remote_path)])
        .header("Authorization", format!("Bearer {session_token}"))
        .send()
        .await
        .map_err(|e| format!("Lock release request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
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
pub async fn send_heartbeat(server_url: &str, connection_id: &str, remote_path: &str, session_token: &str) -> Result<(), String> {
    let url = format!(
        "{}/api/companion/{}/lock/heartbeat",
        server_url.trim_end_matches('/'),
        connection_id
    );

    let client = Client::new();
    let response = client
        .post(&url)
        .query(&[("path", remote_path)])
        .header("Authorization", format!("Bearer {session_token}"))
        .send()
        .await
        .map_err(|e| format!("Heartbeat request failed: {e}"))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Heartbeat failed: {body}"));
    }

    Ok(())
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
        let result = release_lock("http://127.0.0.1:1", "test-conn", "/docs/test.txt", "fake-token").await;
        assert!(result.is_err());
    }

    //
    // test_send_heartbeat_bad_server
    //
    #[tokio::test]
    async fn test_send_heartbeat_bad_server() {
        let result = send_heartbeat("http://127.0.0.1:1", "test-conn", "/docs/test.txt", "fake-token").await;
        assert!(result.is_err());
    }
}
