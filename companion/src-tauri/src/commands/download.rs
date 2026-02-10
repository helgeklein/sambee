//! Tauri command for downloading files from the Sambee server.
//!
//! Downloads a file via `GET /api/viewer/{connId}/download?path=...`
//! and saves it to a local temp directory with a `-copy` suffix.

use std::fs;
use std::time::SystemTime;

use log::{error, info};
use reqwest::Client;

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
pub async fn download_file(
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    session_token: &str,
) -> Result<DownloadResult, String> {
    let operation_id = uuid::Uuid::new_v4();

    // Create operation directory
    let op_dir = temp::create_operation_dir(&operation_id)?;
    let local_path = temp::temp_file_path(&op_dir, remote_path);

    // Build download URL
    let url = format!(
        "{}/api/viewer/{}/download",
        server_url.trim_end_matches('/'),
        connection_id
    );

    info!(
        "Downloading: server={}, conn_id={}, path='{}' → {}",
        server_url,
        connection_id,
        remote_path,
        local_path.display()
    );

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .query(&[("path", remote_path)])
        .header("Authorization", format!("Bearer {session_token}"))
        .send()
        .await
        .map_err(|e| {
            error!("Download request failed: {e}");
            format!("Download request failed: {e}")
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        error!("Download failed: HTTP {status} — {body}");
        // Clean up the empty operation directory on failure
        let _ = fs::remove_dir_all(&op_dir);
        return Err(format!("Download failed (HTTP {status}): {body}"));
    }

    // Write response body to file
    let bytes = response.bytes().await.map_err(|e| {
        let _ = fs::remove_dir_all(&op_dir);
        format!("Failed to read download response: {e}")
    })?;

    fs::write(&local_path, &bytes).map_err(|e| {
        let _ = fs::remove_dir_all(&op_dir);
        format!("Failed to write temp file {}: {e}", local_path.display())
    })?;

    // Record original mtime
    let original_mtime = fs::metadata(&local_path)
        .and_then(|m| m.modified())
        .unwrap_or_else(|_| SystemTime::now());

    info!(
        "Download complete: {} bytes → {}",
        bytes.len(),
        local_path.display()
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
        let result = download_file(
            "http://127.0.0.1:1",
            "test-conn",
            "/docs/test.txt",
            "fake-token",
        )
        .await;
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
        assert!(result
            .local_path
            .to_string_lossy()
            .contains("file-copy.txt"));
        assert!(!result.operation_id.is_nil());
    }
}
