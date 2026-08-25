//! Response models matching the Sambee backend API contract.
//!
//! These structs produce the same JSON shapes as the Python backend's
//! Pydantic models, so the frontend needs zero model changes.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// File type discriminator — matches backend `FileType` enum.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileType {
    File,
    Directory,
}

/// Kind of local filesystem link represented by a directory entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinkKind {
    FilesystemLink,
    WindowsShortcut,
}

/// Filesystem category of a resolved local link target.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LinkTargetType {
    File,
    Directory,
    Other,
}

/// Result state for background local link target resolution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinkTargetState {
    Resolved,
    Missing,
    AccessDenied,
    Unresolvable,
    UnmappedDrive,
}

/// Display-safe target metadata for a local filesystem link.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkTargetInfo {
    pub name: String,
    /// Full user-facing target path, present only for targets on an exposed local drive.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(rename = "type")]
    pub target_type: LinkTargetType,
}

/// Background resolution result for a local link in a directory listing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkTargetResolution {
    pub source_path: String,
    pub state: LinkTargetState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<LinkTargetInfo>,
}

/// Batched local link target metadata for one directory.
#[derive(Debug, Serialize)]
pub struct LinkTargetListing {
    pub items: Vec<LinkTargetResolution>,
}

/// Metadata for a single file or directory.
/// Matches the backend `FileInfo` Pydantic model.
#[derive(Debug, Clone, Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub file_type: FileType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<DateTime<Utc>>,
    pub is_readable: bool,
    pub is_hidden: bool,
    /// Companion-only metadata identifying a local filesystem link source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_kind: Option<LinkKind>,
}

/// A listing of directory contents.
/// Matches the backend `DirectoryListing` Pydantic model.
#[derive(Debug, Serialize)]
pub struct DirectoryListing {
    pub path: String,
    pub items: Vec<FileInfo>,
    pub total: usize,
}

/// Request to create a local archive from selected paths on one drive.
#[derive(Debug, Deserialize)]
pub struct ArchiveCreateRequest {
    pub source_paths: Vec<String>,
    pub target_path: String,
}

/// Summary returned after a local archive has been written directly.
#[derive(Debug, Serialize)]
pub struct ArchiveCreationResponse {
    pub files_created: u64,
    pub directories_created: u64,
    pub source_bytes: u64,
}

/// The final local-drive target selected for an activation request.
#[derive(Debug, Serialize)]
pub struct ActivationResolution {
    /// Companion drive ID containing the canonical target.
    pub drive_id: String,
    /// Canonical target path relative to `drive_id`.
    pub path: String,
    /// Metadata for the target used to choose navigation or file opening.
    pub item: FileInfo,
}

/// A mounted drive / volume visible to the companion.
#[derive(Debug, Serialize)]
pub struct DriveInfo {
    pub id: String,
    pub name: String,
    pub drive_type: DriveType,
}

/// Classification of a drive's physical/logical type.
#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum DriveType {
    Fixed,
    Removable,
    Network,
    Virtual,
    Unknown,
}

/// Health check response.
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub paired: bool,
}

/// Public pairing state for the current browser origin.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublicPairingStatus {
    Unpaired,
    PendingLocalApproval,
    Paired,
}

/// Response from `POST /api/pair/initiate`.
#[derive(Debug, Serialize)]
pub struct PairInitiateResponse {
    pub pairing_id: String,
    pub nonce_companion: String,
}

/// Response from `POST /api/pair/confirm`.
#[derive(Debug, Serialize)]
pub struct PairConfirmResponse {
    pub secret: String,
}

/// Public pairing status for the current browser origin.
#[derive(Debug, Serialize)]
pub struct PairStatusResponse {
    pub current_origin: Option<String>,
    pub current_origin_paired: bool,
    pub status: PublicPairingStatus,
}

/// Response from `POST /api/pair/test`.
#[derive(Debug, Serialize)]
pub struct PairTestResponse {
    pub status: String,
    pub message: String,
    pub origin: String,
}

/// Browser-sourced localization update payload.
#[derive(Debug, Deserialize)]
pub struct LocalizationSyncRequest {
    pub language: String,
    pub regional_locale: String,
    pub updated_at: String,
}

/// Companion localization state synchronized from the browser.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompanionLocalizationState {
    pub language: String,
    pub regional_locale: String,
    pub updated_at: DateTime<Utc>,
    pub source_origin: String,
}

/// Response after attempting to sync browser localization.
#[derive(Debug, Serialize)]
pub struct LocalizationSyncResponse {
    pub applied: bool,
    #[serde(flatten)]
    pub state: CompanionLocalizationState,
}

/// Response from `POST /api/browse/{drive}/upload`.
/// Matches the backend `UploadResponse` Pydantic model.
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct UploadResponse {
    pub status: String,
    pub path: String,
    pub size: u64,
    pub last_modified: Option<String>,
}

/// Conflict detail for copy/move when the destination already exists.
/// Matches the backend `ConflictInfo` Pydantic model.
#[derive(Debug, Serialize)]
pub struct ConflictInfo {
    pub existing_file: FileInfo,
    pub incoming_file: FileInfo,
}

/// Response for directory search (quick navigate).
/// Matches the backend `DirectorySearchResult` Pydantic model.
#[derive(Debug, Serialize)]
pub struct DirectorySearchResult {
    pub results: Vec<String>,
    pub total_matches: usize,
    pub cache_state: String,
    pub directory_count: usize,
}
