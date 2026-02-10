//! File info queries from the Sambee server.
//!
//! Fetches file metadata (size, last modified) from the backend API.
//! Used for:
//! - **File size checks** — warn before downloading very large files
//! - **Conflict detection** — compare `modified_at` before upload

use log::info;
use reqwest::Client;
use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────────────────────────────────────────
// Response types
// ─────────────────────────────────────────────────────────────────────────────

/// File metadata returned by `GET /api/browse/{connId}/info?path=...`.
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
/// Calls `GET /api/browse/{connId}/info?path={remote_path}`.
pub async fn get_file_info(
    server_url: &str,
    connection_id: &str,
    remote_path: &str,
    session_token: &str,
) -> Result<FileInfoResponse, String> {
    let url = format!(
        "{}/api/browse/{}/info",
        server_url.trim_end_matches('/'),
        connection_id
    );

    info!(
        "Fetching file info: conn_id={}, path='{}'",
        connection_id, remote_path
    );

    let client = Client::new();
    let response = client
        .get(&url)
        .query(&[("path", remote_path)])
        .header("Authorization", format!("Bearer {session_token}"))
        .send()
        .await
        .map_err(|e| format!("File info request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("File info failed (HTTP {status}): {body}"));
    }

    let info: FileInfoResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse file info response: {e}"))?;

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
        let result = get_file_info(
            "http://127.0.0.1:1",
            "test-conn",
            "/docs/test.txt",
            "fake-token",
        )
        .await;
        assert!(result.is_err());
    }
}
