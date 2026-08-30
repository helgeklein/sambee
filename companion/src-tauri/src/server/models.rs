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
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveCreateRequest {
    pub source_paths: Vec<String>,
    pub target_path: String,
}

/// Start either a direct local archive creation or extraction lifecycle execution.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ArchiveExecutionStartRequest {
    Create { source_paths: Vec<String>, target_path: String },
    Extract { archive_path: String, destination_path: String },
}

/// Start a V2-pinned direct-local archive lifecycle execution.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ArchiveV2ExecutionStartRequest {
    Create {
        contract_version: ArchiveContractVersion,
        source_paths: Vec<String>,
        target_path: String,
    },
    Extract {
        contract_version: ArchiveContractVersion,
        archive_path: String,
        destination_path: String,
    },
}

/// The only archive contract accepted by the V2 Companion API.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveContractVersion {
    V2,
}

/// V2 relay creation request when the local drive is the destination.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveV2RelayCreationLocalDestinationRequest {
    pub contract_version: ArchiveContractVersion,
    pub target_path: String,
    pub server_url: String,
    pub operation_id: String,
    pub operation_token: String,
}

/// V2 relay creation request when the local drive provides source paths.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveV2RelayCreationLocalSourceRequest {
    pub contract_version: ArchiveContractVersion,
    pub source_paths: Vec<String>,
    pub target_path: String,
    pub server_url: String,
    pub operation_id: String,
    pub operation_token: String,
}

/// An operation-based V2 relay creation request.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ArchiveV2RelayCreationRequest {
    LocalDestination(ArchiveV2RelayCreationLocalDestinationRequest),
    LocalSource(ArchiveV2RelayCreationLocalSourceRequest),
}

/// Summary returned after a local archive has been written directly.
#[derive(Debug, Serialize)]
pub struct ArchiveCreationResponse {
    pub files_created: u64,
    pub directories_created: u64,
    pub source_bytes: u64,
}

/// Request to extract a local archive into a new relative destination directory.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveExtractRequest {
    pub archive_path: String,
    pub destination_path: String,
}

/// Request to cancel a Companion-owned archive extraction execution.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveExecutionCancellationRequest {
    #[serde(alias = "expectedRevision")]
    pub expected_revision: u64,
}

/// V2-pinned cancellation request for a direct-local archive execution.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveV2ExecutionCancellationRequest {
    pub contract_version: ArchiveContractVersion,
    #[serde(alias = "expectedRevision")]
    pub expected_revision: u64,
}

/// Request to apply an explicit collision decision to a paused local extraction.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveExecutionDecisionRequest {
    #[serde(alias = "expectedRevision")]
    pub expected_revision: u64,
    pub member_path: String,
    pub action: ArchiveExecutionDecisionAction,
    #[serde(default)]
    pub target_path: Option<String>,
}

/// V2-pinned decision request for a direct-local archive execution.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveV2ExecutionDecisionRequest {
    pub contract_version: ArchiveContractVersion,
    #[serde(alias = "expectedRevision")]
    pub expected_revision: u64,
    pub member_path: String,
    pub action: ArchiveExecutionDecisionAction,
    #[serde(default)]
    pub target_path: Option<String>,
}

/// Supported local extraction collision decisions.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveExecutionDecisionAction {
    Skip,
    SkipAll,
    Replace,
    ReplaceAll,
    ReplaceOlder,
    Rename,
    Retry,
    Ignore,
}

/// The archive member currently awaiting a local collision decision.
#[derive(Debug, Serialize)]
pub struct ArchiveExecutionPendingDecision {
    pub kind: String,
    #[serde(rename = "memberPath")]
    pub member_path: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "targetPath")]
    pub target_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "isDirectory")]
    pub is_directory: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "partialOutput")]
    pub partial_output: Option<bool>,
    #[serde(rename = "allowedActions")]
    pub allowed_actions: Vec<String>,
}

/// V2 relay extraction request when the local drive provides the ZIP source.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveV2RelayExtractionLocalSourceRequest {
    pub contract_version: ArchiveContractVersion,
    pub archive_path: String,
    pub server_url: String,
    pub operation_id: String,
    pub operation_token: String,
}

/// V2 relay extraction request when the local drive receives output.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveV2RelayExtractionLocalDestinationRequest {
    pub contract_version: ArchiveContractVersion,
    pub destination_path: String,
    pub server_url: String,
    pub operation_id: String,
    pub operation_token: String,
}

/// An operation-based V2 relay extraction request.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ArchiveV2RelayExtractionRequest {
    LocalSource(ArchiveV2RelayExtractionLocalSourceRequest),
    LocalDestination(ArchiveV2RelayExtractionLocalDestinationRequest),
}

/// Summary returned after a local archive extraction completes.
#[derive(Debug, Serialize)]
pub struct ArchiveExtractionResponse {
    pub files_extracted: u64,
    pub directories_created: u64,
    pub extracted_bytes: u64,
    pub files_skipped: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_json: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_decision_json: Option<String>,
}

/// Current lifecycle state for a short-lived Companion archive execution.
#[derive(Debug, Serialize)]
pub struct ArchiveExecutionResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_version: Option<ArchiveContractVersion>,
    pub execution_id: String,
    pub kind: String,
    pub phase: String,
    pub revision: u64,
    pub progress: ArchiveExecutionProgress,
    pub cancellation_requested: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_extracted: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directories_created: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extracted_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_skipped: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_created: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "pendingDecision")]
    pub pending_decision: Option<ArchiveExecutionPendingDecision>,
}

/// Contract-shaped aggregate progress counters for an archive lifecycle execution.
#[derive(Debug, Serialize)]
pub struct ArchiveExecutionProgress {
    #[serde(rename = "completedMembers")]
    pub completed_members: u64,
    #[serde(rename = "skippedMembers")]
    pub skipped_members: u64,
    #[serde(rename = "failedMembers")]
    pub failed_members: u64,
    #[serde(rename = "partialMembers")]
    pub partial_members: u64,
}

#[cfg(test)]
mod tests {
    use super::{
        ArchiveExecutionCancellationRequest, ArchiveExecutionDecisionAction, ArchiveExecutionDecisionRequest, ArchiveExecutionStartRequest,
        ArchiveV2RelayCreationRequest, ArchiveV2RelayExtractionRequest,
    };

    #[test]
    fn accepts_kind_tagged_creation_and_extraction_payloads() {
        assert!(matches!(
            serde_json::from_str::<ArchiveExecutionStartRequest>(
                r#"{"kind":"create","source_paths":["source.txt"],"target_path":"archive.zip"}"#
            ),
            Ok(ArchiveExecutionStartRequest::Create { .. })
        ));
        assert!(matches!(
            serde_json::from_str::<ArchiveExecutionStartRequest>(
                r#"{"kind":"extract","archive_path":"archive.zip","destination_path":"output"}"#
            ),
            Ok(ArchiveExecutionStartRequest::Extract { .. })
        ));
    }

    #[test]
    fn rejects_lifecycle_start_payloads_that_mix_creation_and_extraction_fields() {
        let payload = r#"{
            "kind": "create",
            "source_paths": ["source.txt"],
            "target_path": "archive.zip",
            "archive_path": "archive.zip",
            "destination_path": "output"
        }"#;

        assert!(serde_json::from_str::<ArchiveExecutionStartRequest>(payload).is_err());
    }

    #[test]
    fn accepts_cancellation_revision_alias_but_rejects_unknown_fields() {
        let request = serde_json::from_str::<ArchiveExecutionCancellationRequest>(r#"{"expectedRevision":2}"#)
            .expect("camel-case revision should be accepted");
        assert_eq!(request.expected_revision, 2);
        assert!(serde_json::from_str::<ArchiveExecutionCancellationRequest>(r#"{"expected_revision":2,"kind":"extract"}"#).is_err());
    }

    #[test]
    fn accepts_strict_local_archive_decisions() {
        let request = serde_json::from_str::<ArchiveExecutionDecisionRequest>(
            r#"{"expectedRevision":2,"member_path":"source.txt","action":"replace"}"#,
        )
        .expect("camel-case revision decision should be accepted");
        assert_eq!(request.expected_revision, 2);
        assert_eq!(request.member_path, "source.txt");
        assert!(matches!(request.action, ArchiveExecutionDecisionAction::Replace));
        assert!(matches!(
            serde_json::from_str::<ArchiveExecutionDecisionRequest>(
                r#"{"expected_revision":2,"member_path":"source.txt","action":"retry"}"#
            )
            .expect("retry should be accepted")
            .action,
            ArchiveExecutionDecisionAction::Retry
        ));
        let renamed = serde_json::from_str::<ArchiveExecutionDecisionRequest>(
            r#"{"expected_revision":2,"member_path":"source.txt","action":"rename","target_path":"renamed.txt"}"#,
        )
        .expect("rename target should be accepted");
        assert!(matches!(renamed.action, ArchiveExecutionDecisionAction::Rename));
        assert_eq!(renamed.target_path.as_deref(), Some("renamed.txt"));
        assert!(serde_json::from_str::<ArchiveExecutionDecisionRequest>(
            r#"{"expected_revision":2,"member_path":"source.txt","action":"skip","target_path":"elsewhere","unknown":true}"#
        )
        .is_err());
    }

    #[test]
    fn accepts_strict_normalized_v2_relay_requests() {
        assert!(matches!(
            serde_json::from_str::<ArchiveV2RelayCreationRequest>(
                r#"{"contract_version":"v2","source_paths":["source.txt"],"target_path":"archive.zip","server_url":"http://localhost:3000","operation_id":"a8ddf5e8-4d57-46ca-ae79-80bc85610d23","operation_token":"token"}"#
            ),
            Ok(ArchiveV2RelayCreationRequest::LocalSource(_))
        ));
        assert!(matches!(
            serde_json::from_str::<ArchiveV2RelayExtractionRequest>(
                r#"{"contract_version":"v2","destination_path":"output","server_url":"http://localhost:3000","operation_id":"a8ddf5e8-4d57-46ca-ae79-80bc85610d23","operation_token":"token"}"#
            ),
            Ok(ArchiveV2RelayExtractionRequest::LocalDestination(_))
        ));
        assert!(serde_json::from_str::<ArchiveV2RelayExtractionRequest>(
            r#"{"contract_version":"v2","archive_path":"archive.zip","destination_path":"output","server_url":"http://localhost:3000","operation_id":"a8ddf5e8-4d57-46ca-ae79-80bc85610d23","operation_token":"token"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ArchiveV2RelayCreationRequest>(
            r#"{"contract_version":"v1","target_path":"archive.zip","server_url":"http://localhost:3000","operation_id":"a8ddf5e8-4d57-46ca-ae79-80bc85610d23","operation_token":"token"}"#
        )
        .is_err());
    }
}

/// Stable identity for a locally hosted archive.
#[derive(Debug, Serialize)]
pub struct ArchiveIdentity {
    pub path: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<DateTime<Utc>>,
}

/// Whether an archive member can be read by the current Companion capability.
#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveEntryState {
    Readable,
    Blocked,
    Unavailable,
}

/// Metadata for a single immediate virtual archive child.
#[derive(Debug, Serialize)]
pub struct ArchiveEntryInfo {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub file_type: FileType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compressed_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compression_method: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crc32: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<DateTime<Utc>>,
    pub state: ArchiveEntryState,
    pub is_hidden: bool,
}

/// A bounded page of virtual ZIP directory entries.
#[derive(Debug, Serialize)]
pub struct ArchiveDirectoryListing {
    pub archive: ArchiveIdentity,
    pub path: String,
    pub items: Vec<ArchiveEntryInfo>,
    pub total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub page_size: usize,
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

/// Opaque edit-lock control material sent by a browser editor.
#[derive(Debug, Deserialize)]
pub struct EditLockControlRequest {
    pub operation_id: String,
    pub lock_id: String,
    pub lock_capability: String,
}

/// Active edit-lock state returned to a browser editor.
#[derive(Debug, Serialize)]
pub struct EditLockResponse {
    pub lock_id: String,
    pub lock_capability: String,
    pub operation_id: String,
    pub file_path: String,
    pub locked_by: String,
    pub locked_at: String,
}

/// Display-safe edit-lock status that intentionally omits secret material.
#[derive(Debug, Serialize)]
pub struct EditLockStatusResponse {
    pub locked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked_at: Option<String>,
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
