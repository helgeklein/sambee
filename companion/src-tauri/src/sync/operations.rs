//! `FileOperation` — the core data model for tracking active edit sessions.
//!
//! Each edit session (deep-link → download → edit → upload/discard) is
//! represented by a `FileOperation`. Operations are held in-memory and also
//! persisted to disk as JSON sidecars so sessions survive crashes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Heartbeat interval — the companion sends a heartbeat every 30 seconds.
pub const HEARTBEAT_INTERVAL_SECS: u64 = 30;

/// File status poll interval — check mtime every 2 seconds.
pub const FILE_POLL_INTERVAL_SECS: u64 = 2;

/// Hold-to-confirm duration in milliseconds (frontend reference constant).
#[allow(dead_code)]
pub const HOLD_DURATION_MS: u64 = 1500;

/// Maximum upload retry attempts.
pub const UPLOAD_MAX_RETRIES: u32 = 3;

/// Base delay for exponential backoff on upload retries (milliseconds).
pub const UPLOAD_RETRY_BASE_MS: u64 = 1000;

/// Default file size threshold in megabytes for the large-file warning.
pub const DEFAULT_MAX_FILE_SIZE_MB: u64 = 50;

/// Bytes per megabyte.
const BYTES_PER_MB: u64 = 1_000_000;

// ─────────────────────────────────────────────────────────────────────────────
// OperationStatus
// ─────────────────────────────────────────────────────────────────────────────

/// Current status of a file edit operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "data")]
pub enum OperationStatus {
    /// File is being downloaded from the server.
    Downloading,

    /// File is open in a native app; "Done Editing" window is visible.
    Editing,

    /// Upload in progress. `f32` is the fraction 0.0..1.0.
    Uploading(f32),

    /// Upload failed after all retries.
    UploadFailed(String),

    /// Upload complete, lock released, temp file recycled.
    Completed,

    /// User discarded changes, lock released, temp file recycled.
    Discarded,
}

// ─────────────────────────────────────────────────────────────────────────────
// FileOperation
// ─────────────────────────────────────────────────────────────────────────────

/// Represents one active file-editing session.
///
/// Created when a `sambee://` URI is processed, and lives until the user
/// finishes editing (upload or discard) or discards the session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOperation {
    /// Unique operation identifier.
    pub id: Uuid,

    /// Base URL of the Sambee server (e.g. "https://sambee.example.com").
    pub server_url: String,

    /// Connection UUID on the server.
    pub connection_id: String,

    /// Remote path on the SMB share (e.g. "/docs/report.docx").
    pub remote_path: String,

    /// Local path to the downloaded temp copy.
    pub local_path: PathBuf,

    /// Companion session JWT (longer-lived, obtained via token exchange).
    pub token: String,

    /// When the file was downloaded.
    pub downloaded_at: SystemTime,

    /// Modification time of the file at download time (for change detection).
    pub original_mtime: SystemTime,

    /// Current status of this operation.
    pub status: OperationStatus,

    /// Display name of the native app used (e.g. "LibreOffice Writer").
    pub opened_with_app: Option<String>,

    /// The lock ID returned by the server when the lock was acquired.
    pub lock_id: Option<String>,

    /// Server-side `modified_at` at download time (ISO 8601 string).
    ///
    /// Used for conflict detection: before uploading, the companion fetches
    /// the current `modified_at` from the server and compares it to this value.
    /// If they differ, another user may have modified the file concurrently.
    pub server_last_modified: Option<String>,
}

impl FileOperation {
    //
    // filename
    //
    /// Returns just the file name portion of the remote path.
    pub fn filename(&self) -> &str {
        self.remote_path
            .rsplit('/')
            .next()
            .unwrap_or(&self.remote_path)
    }

    //
    // is_active
    //
    /// Returns true if this operation is still in an active (non-terminal) state.
    pub fn is_active(&self) -> bool {
        matches!(
            self.status,
            OperationStatus::Downloading
                | OperationStatus::Editing
                | OperationStatus::Uploading(_)
                | OperationStatus::UploadFailed(_)
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OperationStore
// ─────────────────────────────────────────────────────────────────────────────

/// Thread-safe, in-memory store for active file operations.
///
/// Wraps a `Vec<FileOperation>` behind an `Arc<RwLock<...>>` so it can be
/// shared across Tauri commands and background tasks.
#[derive(Debug, Clone)]
pub struct OperationStore {
    inner: Arc<RwLock<Vec<FileOperation>>>,
}

impl Default for OperationStore {
    fn default() -> Self {
        Self::new()
    }
}

impl OperationStore {
    //
    // new
    //
    /// Create an empty operation store.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(Vec::new())),
        }
    }

    //
    // add
    //
    /// Add a new operation to the store.
    pub fn add(&self, op: FileOperation) {
        let mut ops = self.inner.write().expect("OperationStore lock poisoned");
        ops.push(op);
    }

    //
    // get
    //
    /// Get a clone of an operation by its ID.
    pub fn get(&self, id: Uuid) -> Option<FileOperation> {
        let ops = self.inner.read().expect("OperationStore lock poisoned");
        ops.iter().find(|o| o.id == id).cloned()
    }

    //
    // update_status
    //
    /// Update the status of an operation by its ID.
    pub fn update_status(&self, id: Uuid, status: OperationStatus) {
        let mut ops = self.inner.write().expect("OperationStore lock poisoned");
        if let Some(op) = ops.iter_mut().find(|o| o.id == id) {
            op.status = status;
        }
    }

    //
    // active_operations
    //
    /// Returns a snapshot of all active (non-terminal) operations.
    pub fn active_operations(&self) -> Vec<FileOperation> {
        let ops = self.inner.read().expect("OperationStore lock poisoned");
        ops.iter().filter(|o| o.is_active()).cloned().collect()
    }

    //
    // all_operations
    //
    /// Returns a snapshot of all operations.
    #[allow(dead_code)]
    pub fn all_operations(&self) -> Vec<FileOperation> {
        let ops = self.inner.read().expect("OperationStore lock poisoned");
        ops.clone()
    }

    //
    // remove
    //
    /// Remove an operation by its ID.
    #[allow(dead_code)]
    pub fn remove(&self, id: Uuid) {
        let mut ops = self.inner.write().expect("OperationStore lock poisoned");
        ops.retain(|o| o.id != id);
    }

    //
    // update_app
    //
    /// Update the `opened_with_app` field for the operation with the given ID.
    pub fn update_app(&self, id: &Uuid, app_name: &str) {
        let mut ops = self.inner.write().expect("OperationStore lock poisoned");
        if let Some(op) = ops.iter_mut().find(|o| &o.id == id) {
            op.opened_with_app = Some(app_name.to_string());
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending confirmations (for interactive lifecycle steps)
// ─────────────────────────────────────────────────────────────────────────────

/// Thread-safe map of pending oneshot confirmations.
///
/// Used when the edit lifecycle needs to pause and ask the user a yes/no
/// question (e.g. "This file is 128 MB — continue anyway?"). The lifecycle
/// stores a `tokio::sync::oneshot::Sender<bool>` here and awaits the
/// receiver; a Tauri command from the frontend calls `respond()` to unblock.
#[derive(Debug, Default, Clone)]
pub struct PendingConfirmations {
    inner: Arc<RwLock<HashMap<String, tokio::sync::oneshot::Sender<bool>>>>,
}

impl PendingConfirmations {
    //
    // insert
    //
    /// Store a sender under the given key.
    pub fn insert(&self, key: String, tx: tokio::sync::oneshot::Sender<bool>) {
        let mut map = self
            .inner
            .write()
            .expect("PendingConfirmations lock poisoned");
        map.insert(key, tx);
    }

    //
    // respond
    //
    /// Send a response and remove the entry. Returns `true` if found.
    pub fn respond(&self, key: &str, value: bool) -> bool {
        let mut map = self
            .inner
            .write()
            .expect("PendingConfirmations lock poisoned");
        if let Some(tx) = map.remove(key) {
            let _ = tx.send(value);
            true
        } else {
            false
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending app selections
// ─────────────────────────────────────────────────────────────────────────────

/// Selected application info returned from the app picker dialog.
///
/// Contains the executable path and display name of the chosen application.
#[derive(Debug, Clone)]
pub struct SelectedApp {
    /// Path to the application executable (e.g. "/usr/bin/libreoffice").
    pub executable: String,

    /// Human-readable display name (e.g. "LibreOffice Writer").
    pub name: String,
}

/// Thread-safe store for pending app picker selections.
///
/// Used when the edit lifecycle pauses to let the user pick a native
/// application. The lifecycle stores a `tokio::sync::oneshot::Sender` here
/// and awaits the receiver; a Tauri command from the frontend calls
/// `respond()` to unblock with the selection (or `None` for cancellation).
#[derive(Debug, Default, Clone)]
pub struct PendingAppSelections {
    inner: Arc<RwLock<HashMap<String, tokio::sync::oneshot::Sender<Option<SelectedApp>>>>>,
}

impl PendingAppSelections {
    //
    // insert
    //
    /// Store a sender under the given request ID.
    pub fn insert(&self, key: String, tx: tokio::sync::oneshot::Sender<Option<SelectedApp>>) {
        let mut map = self
            .inner
            .write()
            .expect("PendingAppSelections lock poisoned");
        map.insert(key, tx);
    }

    //
    // respond
    //
    /// Send a selection response and remove the entry. Returns `true` if found.
    pub fn respond(&self, key: &str, value: Option<SelectedApp>) -> bool {
        let mut map = self
            .inner
            .write()
            .expect("PendingAppSelections lock poisoned");
        if let Some(tx) = map.remove(key) {
            let _ = tx.send(value);
            true
        } else {
            false
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// File size helpers
// ─────────────────────────────────────────────────────────────────────────────

//
// exceeds_size_limit
//
/// Check whether a file size (in bytes) exceeds the configured limit.
///
/// Returns `Some(size_mb)` if the file is above the threshold, `None` otherwise.
pub fn exceeds_size_limit(size_bytes: u64, max_mb: u64) -> Option<u64> {
    let size_mb = size_bytes / BYTES_PER_MB;
    if size_bytes > max_mb * BYTES_PER_MB {
        Some(size_mb)
    } else {
        None
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON sidecar persistence
// ─────────────────────────────────────────────────────────────────────────────

/// Filename for the JSON sidecar that stores operation metadata alongside
/// the temp file.
pub const SIDECAR_FILENAME: &str = "operation.json";

//
// save_operation_sidecar
//
/// Persist a `FileOperation` as a JSON sidecar in the operation's temp directory.
pub fn save_operation_sidecar(op: &FileOperation) -> Result<(), String> {
    let dir = op
        .local_path
        .parent()
        .ok_or_else(|| "Cannot determine parent directory of temp file".to_string())?;

    let sidecar_path = dir.join(SIDECAR_FILENAME);
    let json = serde_json::to_string_pretty(op)
        .map_err(|e| format!("Failed to serialize operation: {e}"))?;

    std::fs::write(&sidecar_path, json)
        .map_err(|e| format!("Failed to write sidecar {}: {e}", sidecar_path.display()))?;

    Ok(())
}

//
// remove_operation_sidecar
//
/// Remove the operation's temp directory (containing the sidecar and temp file).
///
/// Used when the user cancels the app picker before opening the file.
pub fn remove_operation_sidecar(op: &FileOperation) -> Result<(), String> {
    let dir = op
        .local_path
        .parent()
        .ok_or_else(|| "Cannot determine parent directory of temp file".to_string())?;

    if dir.exists() {
        std::fs::remove_dir_all(dir)
            .map_err(|e| format!("Failed to remove operation dir {}: {e}", dir.display()))?;
    }

    Ok(())
}

//
// load_operation_sidecar
//
/// Load a `FileOperation` from a JSON sidecar file.
pub fn load_operation_sidecar(sidecar_path: &std::path::Path) -> Result<FileOperation, String> {
    let content = std::fs::read_to_string(sidecar_path)
        .map_err(|e| format!("Failed to read sidecar {}: {e}", sidecar_path.display()))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse sidecar {}: {e}", sidecar_path.display()))
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    //
    // make_test_operation
    //
    fn make_test_operation(id: Uuid) -> FileOperation {
        FileOperation {
            id,
            server_url: "https://sambee.example.com".to_string(),
            connection_id: "conn-123".to_string(),
            remote_path: "/docs/report.docx".to_string(),
            local_path: PathBuf::from("/tmp/sambee-companion/test/report-copy.docx"),
            token: "test-token".to_string(),
            downloaded_at: SystemTime::now(),
            original_mtime: SystemTime::now(),
            status: OperationStatus::Editing,
            opened_with_app: Some("LibreOffice Writer".to_string()),
            lock_id: Some("lock-abc".to_string()),
            server_last_modified: Some("2026-02-09T14:30:00".to_string()),
        }
    }

    //
    // test_filename_extraction
    //
    #[test]
    fn test_filename_extraction() {
        let op = make_test_operation(Uuid::new_v4());
        assert_eq!(op.filename(), "report.docx");
    }

    //
    // test_filename_no_slash
    //
    #[test]
    fn test_filename_no_slash() {
        let mut op = make_test_operation(Uuid::new_v4());
        op.remote_path = "plain.txt".to_string();
        assert_eq!(op.filename(), "plain.txt");
    }

    //
    // test_is_active
    //
    #[test]
    fn test_is_active() {
        let mut op = make_test_operation(Uuid::new_v4());

        op.status = OperationStatus::Downloading;
        assert!(op.is_active());

        op.status = OperationStatus::Editing;
        assert!(op.is_active());

        op.status = OperationStatus::Uploading(0.5);
        assert!(op.is_active());

        op.status = OperationStatus::UploadFailed("error".to_string());
        assert!(op.is_active());

        op.status = OperationStatus::Completed;
        assert!(!op.is_active());

        op.status = OperationStatus::Discarded;
        assert!(!op.is_active());
    }

    //
    // test_operation_store_crud
    //
    #[test]
    fn test_operation_store_crud() {
        let store = OperationStore::new();
        let id1 = Uuid::new_v4();
        let id2 = Uuid::new_v4();

        store.add(make_test_operation(id1));
        store.add(make_test_operation(id2));

        assert_eq!(store.all_operations().len(), 2);
        assert!(store.get(id1).is_some());

        store.update_status(id1, OperationStatus::Completed);
        assert_eq!(store.get(id1).unwrap().status, OperationStatus::Completed);

        assert_eq!(store.active_operations().len(), 1);

        store.remove(id1);
        assert!(store.get(id1).is_none());
        assert_eq!(store.all_operations().len(), 1);
    }

    //
    // test_sidecar_roundtrip
    //
    #[test]
    fn test_sidecar_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let local_path = dir.path().join("report-copy.docx");
        std::fs::write(&local_path, b"test content").unwrap();

        let mut op = make_test_operation(Uuid::new_v4());
        op.local_path = local_path;

        save_operation_sidecar(&op).unwrap();

        let sidecar_path = dir.path().join(SIDECAR_FILENAME);
        assert!(sidecar_path.exists());

        let loaded = load_operation_sidecar(&sidecar_path).unwrap();
        assert_eq!(loaded.id, op.id);
        assert_eq!(loaded.remote_path, op.remote_path);
        assert_eq!(loaded.server_url, op.server_url);
    }

    //
    // test_pending_confirmations
    //
    #[tokio::test]
    async fn test_pending_confirmations() {
        let pending = PendingConfirmations::default();
        let (tx, rx) = tokio::sync::oneshot::channel::<bool>();

        pending.insert("req-1".to_string(), tx);

        // Responding with true should unblock the receiver
        assert!(pending.respond("req-1", true));
        assert!(rx.await.unwrap());

        // Second respond returns false (key already consumed)
        assert!(!pending.respond("req-1", false));
    }

    //
    // test_exceeds_size_limit
    //
    #[test]
    fn test_exceeds_size_limit() {
        // 10 MB file, 50 MB limit → within limit
        assert!(exceeds_size_limit(10_000_000, 50).is_none());

        // 51 MB file, 50 MB limit → exceeds
        assert_eq!(exceeds_size_limit(51_000_000, 50), Some(51));

        // Exactly at limit → within limit
        assert!(exceeds_size_limit(50_000_000, 50).is_none());

        // 128 MB file, 50 MB limit
        assert_eq!(exceeds_size_limit(128_000_000, 50), Some(128));
    }

    //
    // test_operation_status_serialization
    //
    #[test]
    fn test_operation_status_serialization() {
        let statuses = vec![
            OperationStatus::Downloading,
            OperationStatus::Editing,
            OperationStatus::Uploading(0.75),
            OperationStatus::UploadFailed("timeout".to_string()),
            OperationStatus::Completed,
            OperationStatus::Discarded,
        ];

        for status in statuses {
            let json = serde_json::to_string(&status).unwrap();
            let deserialized: OperationStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, status);
        }
    }
}
