//! Tauri command for downloading files from the Sambee server.
//!
//! Downloads a file via `GET /api/viewer/{connId}/download?path=...`
//! and saves it to a local temp directory with a `-copy` suffix.

use std::fs;
use std::time::{Duration, SystemTime};

use log::{error, info};
use reqwest::header;
use reqwest::Client;

use crate::http_client::{classify_proxy_auth_intercept, log_request_error, plain_client, SambeeHttpClientStore};
use crate::sync::operations::CompanionLockContext;
use crate::sync::temp;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// HTTP request timeout for file download (5 minutes for large files).
const DOWNLOAD_TIMEOUT_SECS: u64 = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Download result
// ─────────────────────────────────────────────────────────────────────────────

/// Result of a successful file download.
pub struct DownloadResult {
    /// Absolute path to the downloaded local temp file.
    pub local_path: std::path::PathBuf,
    /// Modification time recorded right after writing (original_mtime).
    pub original_mtime: SystemTime,
    /// UUID of the operation directory.
    pub operation_id: uuid::Uuid,
}

fn validate_download_size(remote_path: &str, expected_size: Option<u64>, actual_size: u64) -> Result<(), String> {
    if let Some(expected_size) = expected_size {
        if actual_size != expected_size {
            error!(
                "Download size mismatch for {}: expected {} byte(s), received {} byte(s)",
                remote_path, expected_size, actual_size
            );
            return Err(format!(
                "Downloaded file size mismatch for {}: expected {} byte(s), received {} byte(s)",
                remote_path, expected_size, actual_size
            ));
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

//
// download_file
//
/// Download a file from the Sambee server to a local temp directory.
///
/// 1. Creates an operation directory under `{temp}/sambee-companion/{uuid}/`.
/// 2. Streams the file from `GET /api/viewer/{connId}/download?path={remote_path}`.
/// 3. Saves it with a `-copy` suffix (e.g. `report-copy.docx`).
/// 4. Returns the local path and the file's mtime (used for change detection).
#[allow(dead_code)]
pub async fn download_file(
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
    expected_size: Option<u64>,
) -> Result<DownloadResult, String> {
    let client = plain_client()?;
    download_file_with_client(&client, server_url, connection_id, remote_path, lock_context, expected_size).await
}

pub async fn download_file_with_store(
    http_clients: &SambeeHttpClientStore,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
    expected_size: Option<u64>,
) -> Result<DownloadResult, String> {
    let client = http_clients.client_for_server(server_url)?;
    download_file_with_client(&client, server_url, connection_id, remote_path, lock_context, expected_size).await
}

pub async fn download_file_with_client(
    client: &Client,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: &CompanionLockContext,
    expected_size: Option<u64>,
) -> Result<DownloadResult, String> {
    let operation_id = uuid::Uuid::new_v4();

    // Create operation directory
    let op_dir = temp::create_operation_dir(&operation_id)?;
    let local_path = temp::temp_file_path(&op_dir, remote_path);

    // Build download URL
    let url = format!("{}/api/viewer/{}/download", server_url.trim_end_matches('/'), connection_id);

    info!(
        "Downloading: server={}, conn_id={}, path='{}' → {}",
        server_url,
        connection_id,
        remote_path,
        local_path.display()
    );

    let response = client
        .get(&url)
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .query(&[
            ("path", remote_path),
            ("operation_id", lock_context.operation_id.as_str()),
            ("lock_id", lock_context.lock_id.as_str()),
            ("lock_capability", lock_context.lock_capability.as_str()),
        ])
        .header("Authorization", format!("Bearer {}", lock_context.operation_token))
        .send()
        .await
        .map_err(|error| {
            let message = log_request_error("Download request", "GET", &url, &error);
            let _ = fs::remove_dir_all(&op_dir);
            message
        })?;

    let status = response.status();
    if !status.is_success() {
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response.text().await.unwrap_or_default();
        if let Some(message) = classify_proxy_auth_intercept("File download", Some(status), content_type.as_deref(), &body) {
            let _ = fs::remove_dir_all(&op_dir);
            return Err(message);
        }
        error!("Download failed: HTTP {status} — {body}");
        // Clean up the empty operation directory on failure
        let _ = fs::remove_dir_all(&op_dir);
        return Err(format!("Download failed (HTTP {status}): {body}"));
    }

    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_default();

    if content_type.to_ascii_lowercase().contains("text/html") {
        let body = response.text().await.map_err(|error| {
            let _ = fs::remove_dir_all(&op_dir);
            log_request_error("Download HTML response body", "GET", &url, &error)
        })?;

        if let Some(message) = classify_proxy_auth_intercept("File download", Some(status), Some(&content_type), &body) {
            let _ = fs::remove_dir_all(&op_dir);
            return Err(message);
        }

        let _ = fs::remove_dir_all(&op_dir);
        return Err("Download returned HTML instead of file contents".to_string());
    }

    // Write response body to file
    let bytes = response.bytes().await.map_err(|error| {
        let _ = fs::remove_dir_all(&op_dir);
        log_request_error("Download response body", "GET", &url, &error)
    })?;

    if let Err(e) = validate_download_size(remote_path, expected_size, bytes.len() as u64) {
        let _ = fs::remove_dir_all(&op_dir);
        return Err(e);
    }

    fs::write(&local_path, &bytes).map_err(|e| {
        let _ = fs::remove_dir_all(&op_dir);
        format!("Failed to write temp file {}: {e}", local_path.display())
    })?;

    // Record original mtime
    let original_mtime = fs::metadata(&local_path)
        .and_then(|m| m.modified())
        .unwrap_or_else(|_| SystemTime::now());

    info!(
        "Download complete: {} bytes → {} (expected {:?})",
        bytes.len(),
        local_path.display(),
        expected_size
    );

    Ok(DownloadResult {
        local_path,
        original_mtime,
        operation_id,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    //
    // test_download_bad_server
    //
    #[tokio::test]
    async fn test_download_bad_server() {
        let lock_context = CompanionLockContext {
            lock_id: "lock-test".to_string(),
            operation_id: "op-test".to_string(),
            lock_capability: "cap-test".to_string(),
            operation_token: "operation-token".to_string(),
            renew_after_seconds: 600,
            token_issued_at_epoch_seconds: 1_700_000_000,
        };

        let result = download_file("http://127.0.0.1:1", "test-conn", "/docs/test.txt", &lock_context, None).await;
        assert!(result.is_err());
    }

    //
    // test_download_result_fields
    //
    #[test]
    fn test_download_result_fields() {
        let result = DownloadResult {
            local_path: std::path::PathBuf::from("/tmp/test/file-copy.txt"),
            original_mtime: SystemTime::now(),
            operation_id: uuid::Uuid::new_v4(),
        };
        assert!(result.local_path.to_string_lossy().contains("file-copy.txt"));
        assert!(!result.operation_id.is_nil());
    }

    #[test]
    fn test_validate_download_size_matches_expected() {
        let result = validate_download_size("/docs/test.txt", Some(12), 12);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_download_size_detects_mismatch() {
        let result = validate_download_size("/docs/test.txt", Some(12), 0);
        assert_eq!(
            result.unwrap_err(),
            "Downloaded file size mismatch for /docs/test.txt: expected 12 byte(s), received 0 byte(s)"
        );
    }
}
