//! File info queries from the Sambee server.
//!
//! Fetches file metadata (size, last modified) from the backend API.
//! Used for:
//! - **File size checks** — warn before downloading very large files
//! - **Conflict detection** — compare `modified_at` before upload

use std::time::Duration;

use log::{debug, info};
use reqwest::header;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::http_client::{
    classify_proxy_auth_intercept, log_request_error, plain_client, SambeeHttpClientStore, DEFAULT_REQUEST_TIMEOUT_SECS,
};
use crate::sync::operations::CompanionLockContext;

// ─────────────────────────────────────────────────────────────────────────────
// Response types
// ─────────────────────────────────────────────────────────────────────────────

/// File metadata returned by `GET /api/companion/{connId}/file-info?path=...`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfoResponse {
    /// Filename (e.g. "report.docx").
    pub name: String,

    /// Full path on the share.
    pub path: String,

    /// "file" or "directory".
    #[serde(rename = "type")]
    pub file_type: String,

    /// File size in bytes (may be `None` for directories).
    pub size: Option<u64>,

    /// MIME type (e.g. "application/pdf").
    pub mime_type: Option<String>,

    /// ISO 8601 timestamp of last modification on the server.
    pub modified_at: Option<String>,

    /// ISO 8601 timestamp of creation on the server.
    pub created_at: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

//
// get_file_info
//
/// Fetch file metadata from the Sambee server.
///
/// Calls `GET /api/companion/{connId}/file-info?path={remote_path}`.
#[allow(dead_code)]
pub async fn get_file_info(
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: Option<&CompanionLockContext>,
    session_token: Option<&str>,
) -> Result<FileInfoResponse, String> {
    let client = plain_client()?;
    get_file_info_with_client(&client, server_url, connection_id, remote_path, lock_context, session_token).await
}

pub async fn get_file_info_with_store(
    http_clients: &SambeeHttpClientStore,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: Option<&CompanionLockContext>,
    session_token: Option<&str>,
) -> Result<FileInfoResponse, String> {
    let client = http_clients.client_for_server(server_url)?;
    get_file_info_with_client(&client, server_url, connection_id, remote_path, lock_context, session_token).await
}

pub async fn get_file_info_with_client(
    client: &Client,
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    lock_context: Option<&CompanionLockContext>,
    session_token: Option<&str>,
) -> Result<FileInfoResponse, String> {
    let url = format!("{}/api/companion/{}/file-info", server_url.trim_end_matches('/'), connection_id);

    info!("Fetching file info: conn_id={}, path='{}'", connection_id, remote_path);

    let mut request = client
        .get(&url)
        .timeout(Duration::from_secs(DEFAULT_REQUEST_TIMEOUT_SECS))
        .query(&[("path", remote_path)]);

    if let Some(lock_context) = lock_context {
        request = request
            .query(&[
                ("operation_id", lock_context.operation_id.as_str()),
                ("lock_id", lock_context.lock_id.as_str()),
            ])
            .header("Authorization", format!("Bearer {}", lock_context.operation_token));
    } else {
        let session_token = session_token.ok_or_else(|| "File info request is missing companion authentication context".to_string())?;
        request = request.header("Authorization", format!("Bearer {session_token}"));
    }

    let response = request
        .send()
        .await
        .map_err(|error| log_request_error("File info request", "GET", &url, &error))?;

    let status = response.status();
    let response_url = response.url().clone();
    let response_content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    debug!(
        "File info HTTP response received: status={}, url='{}', content_type={:?}",
        status, response_url, response_content_type
    );

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        debug!("File info error body received: {} bytes", body.len());
        if let Some(message) = classify_proxy_auth_intercept("File info", Some(status), response_content_type.as_deref(), &body) {
            return Err(message);
        }
        if let Some(message) = super::upload::classify_lifecycle_error(&body) {
            return Err(message);
        }
        return Err(format!("File info failed (HTTP {status}): {body}"));
    }

    let content_type = response_content_type.unwrap_or_default();
    let body = response
        .text()
        .await
        .map_err(|error| log_request_error("File info response body", "GET", response_url.as_str(), &error))?;

    debug!("File info success body received: {} bytes", body.len());

    if !content_type.to_ascii_lowercase().contains("application/json") {
        if let Some(message) = classify_proxy_auth_intercept("File info", Some(status), Some(&content_type), &body) {
            return Err(message);
        }
        return Err(format!(
            "Failed to parse file info response: unexpected content type '{content_type}'"
        ));
    }

    let info: FileInfoResponse = serde_json::from_str(&body).map_err(|e| format!("Failed to parse file info response: {e}"))?;

    debug!(
        "File info JSON parsed successfully: file_type='{}', mime_type={:?}",
        info.file_type, info.mime_type
    );

    info!(
        "File info: name='{}', size={:?}, modified_at={:?}",
        info.name, info.size, info.modified_at
    );

    Ok(info)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    //
    // test_file_info_response_deserialization
    //
    #[test]
    fn test_file_info_response_deserialization() {
        let json = r#"{
            "name": "report.docx",
            "path": "/docs/report.docx",
            "type": "file",
            "size": 54321,
            "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "modified_at": "2026-02-09T14:30:00",
            "created_at": "2026-01-15T10:00:00"
        }"#;
        let info: FileInfoResponse = serde_json::from_str(json).unwrap();
        assert_eq!(info.name, "report.docx");
        assert_eq!(info.path, "/docs/report.docx");
        assert_eq!(info.file_type, "file");
        assert_eq!(info.size, Some(54321));
        assert_eq!(info.modified_at.as_deref(), Some("2026-02-09T14:30:00"));
    }

    //
    // test_file_info_response_null_fields
    //
    #[test]
    fn test_file_info_response_null_fields() {
        let json = r#"{
            "name": "folder",
            "path": "/docs/folder",
            "type": "directory",
            "size": null,
            "mime_type": null,
            "modified_at": null,
            "created_at": null
        }"#;
        let info: FileInfoResponse = serde_json::from_str(json).unwrap();
        assert_eq!(info.file_type, "directory");
        assert!(info.size.is_none());
        assert!(info.modified_at.is_none());
    }

    //
    // test_get_file_info_bad_server
    //
    #[tokio::test]
    async fn test_get_file_info_bad_server() {
        let result = get_file_info("http://127.0.0.1:1", "test-conn", "/docs/test.txt", None, Some("fake-token")).await;
        assert!(result.is_err());
    }
}
