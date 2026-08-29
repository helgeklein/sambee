//! Direct local ZIP archive creation with portable entry-name validation.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File as FsFile, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use bzip2::read::BzDecoder;
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use flate2::{read::DeflateDecoder, write::DeflateEncoder, Compression};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::mpsc::Receiver;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;
use zip::write::{SimpleFileOptions, StreamWriter, ZipWriter};
use zip::CompressionMethod;

/// Bounded source-read size for direct local archive output.
pub const ARCHIVE_COPY_BUFFER_SIZE: usize = 64 * 1024;
pub const ARCHIVE_INLINE_PREVIEW_MAX_BYTES: u64 = 5 * 1024 * 1024;
const STORED_SAVINGS_BYTES: usize = 1024;
const STORED_SAVINGS_RATIO: f64 = 0.05;
const EOCD_SIGNATURE: &[u8; 4] = b"PK\x05\x06";
const CENTRAL_DIRECTORY_SIGNATURE: &[u8; 4] = b"PK\x01\x02";
const ZIP64_LOCATOR_SIGNATURE: &[u8; 4] = b"PK\x06\x07";
const ZIP64_EOCD_SIGNATURE: &[u8; 4] = b"PK\x06\x06";
const LOCAL_FILE_SIGNATURE: &[u8; 4] = b"PK\x03\x04";
const EOCD_SIZE: usize = 22;
const ZIP64_LOCATOR_SIZE: usize = 20;
const CENTRAL_DIRECTORY_FIXED_SIZE: usize = 46;
const MAX_COMMENT_BYTES: usize = u16::MAX as usize;
const MAX_ENTRY_VARIABLE_BYTES: usize = u16::MAX as usize * 3;
const ZIP64_SENTINEL_U16: u16 = u16::MAX;
const ZIP64_SENTINEL_U32: u32 = u32::MAX;
const INFOZIP_UNICODE_PATH_FIELD_ID: u16 = 0x7075;
const INFOZIP_UNICODE_PATH_VERSION: u8 = 1;
const CP437_EXTENDED_CHARACTERS: &str =
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const UNIX_HOST_SYSTEM: u16 = 3;
const UNIX_FILE_TYPE_MASK: u16 = 0o170000;
const UNIX_DIRECTORY_FILE_TYPE: u16 = 0o040000;
const UNIX_REGULAR_FILE_TYPE: u16 = 0o100000;

/// A safe entry parsed from a local ZIP central directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalArchiveReadEntry {
    pub path: String,
    pub is_directory: bool,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub compression_method: u16,
    pub crc32: u32,
    pub modified_at: Option<DateTime<Utc>>,
    pub encrypted: bool,
    pub is_safe: bool,
    pub has_supported_file_type: bool,
    pub local_header_offset: u64,
    pub flags: u16,
    pub raw_name: Vec<u8>,
}

/// Normalized inspection metadata for one archive member.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveInspectionManifestMember {
    pub path: String,
    pub is_directory: bool,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub compression_method: u16,
    pub crc32: u32,
    pub modified_at: Option<DateTime<Utc>>,
    pub encrypted: bool,
    pub is_safe: bool,
    pub has_supported_file_type: bool,
}

impl ArchiveInspectionManifestMember {
    /// Whether the member may be read for an inline preview.
    pub fn is_preview_available(&self) -> bool {
        !self.encrypted && matches!(self.compression_method, 0 | 8 | 12)
    }

    /// Whether this member is eligible for a bounded inline preview.
    pub fn is_inline_preview_eligible(&self) -> bool {
        !self.is_directory
            && self.is_safe
            && self.has_supported_file_type
            && self.is_preview_available()
            && self.uncompressed_size <= ARCHIVE_INLINE_PREVIEW_MAX_BYTES
    }
}

/// Immutable normalized archive inspection result, independent of HTTP DTOs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveInspectionManifest {
    pub entries: Vec<ArchiveInspectionManifestMember>,
}

impl ArchiveInspectionManifest {
    /// Resolve a safe regular member that is available for reading.
    pub fn member(&self, member_path: &str) -> Result<&ArchiveInspectionManifestMember, LocalArchiveReadError> {
        let (normalized_path, is_directory) = normalize_virtual_path(member_path);
        if is_directory || normalized_path.is_empty() || !is_safe_virtual_path(member_path, &normalized_path) {
            return Err(LocalArchiveReadError::InvalidMemberPath);
        }
        let entry = self
            .entries
            .iter()
            .find(|entry| entry.is_safe && entry.has_supported_file_type && !entry.is_directory && entry.path == normalized_path)
            .ok_or(LocalArchiveReadError::MemberNotFound)?;
        if !entry.is_preview_available() {
            return Err(LocalArchiveReadError::UnavailableMember);
        }
        Ok(entry)
    }

    /// Return a bounded virtual directory page derived from the inspection manifest.
    pub fn list_directory(
        &self,
        virtual_path: &str,
        cursor: Option<&str>,
        page_size: usize,
    ) -> Result<LocalArchiveDirectoryPage, LocalArchiveReadError> {
        let (normalized_path, is_directory) = normalize_virtual_path(virtual_path);
        if (!virtual_path.is_empty() && (!is_directory || normalized_path.is_empty()))
            || !is_safe_virtual_path(&format!("{normalized_path}/"), &normalized_path) && !normalized_path.is_empty()
        {
            return Err(LocalArchiveReadError::InvalidDirectoryPath);
        }
        let prefix = if normalized_path.is_empty() {
            String::new()
        } else {
            format!("{normalized_path}/")
        };
        let mut children = BTreeMap::new();
        for entry in &self.entries {
            if !entry.is_safe || !entry.has_supported_file_type || !entry.path.starts_with(&prefix) {
                continue;
            }
            let remainder = &entry.path[prefix.len()..];
            if remainder.is_empty() {
                continue;
            }
            let (name, descendant) = remainder.split_once('/').map_or((remainder, false), |(name, _)| (name, true));
            let path = format!("{prefix}{name}");
            if descendant {
                children.entry(path.clone()).or_insert_with(|| LocalArchiveDirectoryEntry {
                    name: name.to_string(),
                    path,
                    is_directory: true,
                    compressed_size: None,
                    uncompressed_size: None,
                    compression_method: None,
                    crc32: None,
                    modified_at: None,
                    encrypted: false,
                    is_available: false,
                });
                continue;
            }
            children.insert(
                path.clone(),
                LocalArchiveDirectoryEntry {
                    name: name.to_string(),
                    path,
                    is_directory: entry.is_directory,
                    compressed_size: (!entry.is_directory).then_some(entry.compressed_size),
                    uncompressed_size: (!entry.is_directory).then_some(entry.uncompressed_size),
                    compression_method: (!entry.is_directory).then_some(entry.compression_method),
                    crc32: (!entry.is_directory).then_some(entry.crc32),
                    modified_at: entry.modified_at,
                    encrypted: entry.encrypted,
                    is_available: entry.is_inline_preview_eligible(),
                },
            );
        }
        let mut entries = children.into_values().collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            left.is_directory
                .cmp(&right.is_directory)
                .reverse()
                .then_with(|| {
                    left.name
                        .nfc()
                        .case_fold()
                        .collect::<String>()
                        .cmp(&right.name.nfc().case_fold().collect::<String>())
                })
                .then_with(|| left.name.cmp(&right.name))
        });
        let start = match cursor {
            Some(value) if !value.is_empty() => usize::from_str_radix(value, 16).map_err(|_| LocalArchiveReadError::InvalidCursor)?,
            _ => 0,
        };
        if start > entries.len() {
            return Err(LocalArchiveReadError::InvalidCursor);
        }
        let total = entries.len();
        let next_offset = start.saturating_add(page_size);
        let next_cursor = (next_offset < total).then(|| format!("{next_offset:x}"));
        Ok(LocalArchiveDirectoryPage {
            entries: entries.into_iter().skip(start).take(page_size).collect(),
            total,
            next_cursor,
        })
    }
}

/// Immutable, request-scoped local source binding for archive inspection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveInspectionPlan {
    manifest: ArchiveInspectionManifest,
}

impl ArchiveInspectionPlan {
    /// Read the local source once and bind its normalized manifest to this request.
    pub fn from_archive_path(archive_path: &Path) -> Result<Self, LocalArchiveReadError> {
        Ok(Self {
            manifest: inspect_local_archive(archive_path)?,
        })
    }
}

/// Resolve a request-scoped inspection plan without owning transport or HTTP projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveInspectionCoordinator {
    plan: ArchiveInspectionPlan,
}

impl ArchiveInspectionCoordinator {
    pub fn from_archive_path(archive_path: &Path) -> Result<Self, LocalArchiveReadError> {
        Ok(Self {
            plan: ArchiveInspectionPlan::from_archive_path(archive_path)?,
        })
    }

    pub fn list_directory(
        &self,
        virtual_path: &str,
        cursor: Option<&str>,
        page_size: usize,
    ) -> Result<LocalArchiveDirectoryPage, LocalArchiveReadError> {
        self.plan.manifest.list_directory(virtual_path, cursor, page_size)
    }

    pub fn member(&self, member_path: &str) -> Result<&ArchiveInspectionManifestMember, LocalArchiveReadError> {
        self.plan.manifest.member(member_path)
    }
}

/// A single direct child returned from a virtual archive directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalArchiveDirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub compressed_size: Option<u64>,
    pub uncompressed_size: Option<u64>,
    pub compression_method: Option<u16>,
    pub crc32: Option<u32>,
    pub modified_at: Option<DateTime<Utc>>,
    pub encrypted: bool,
    pub is_available: bool,
}

/// A bounded virtual-directory page from a local ZIP archive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalArchiveDirectoryPage {
    pub entries: Vec<LocalArchiveDirectoryEntry>,
    pub total: usize,
    pub next_cursor: Option<String>,
}

/// A source item mapped to one portable archive entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalArchiveEntry {
    pub source_path: PathBuf,
    pub archive_path: String,
    pub is_directory: bool,
    pub source_size: u64,
    pub source_modified_at: Option<String>,
}

/// Summary of a completed local archive write.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LocalArchiveCreationResult {
    pub files_created: u64,
    pub directories_created: u64,
    pub source_bytes: u64,
}

/// An immutable, normalized member approved for archive creation.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ArchiveCreationManifestMember {
    pub archive_path: String,
    pub is_directory: bool,
    pub source_size: u64,
    #[serde(default, rename = "modified_at", alias = "source_modified_at")]
    pub source_modified_at: Option<String>,
}

/// Typed creation manifest shared by local and relayed archive writers.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ArchiveCreationManifest {
    pub entries: Vec<ArchiveCreationManifestMember>,
}

impl ArchiveCreationManifest {
    /// Normalize and validate all immutable creation members before output begins.
    pub fn from_entries(entries: Vec<ArchiveCreationManifestMember>) -> Result<Self, LocalArchiveError> {
        if entries.is_empty() {
            return Err(LocalArchiveError::EmptyCreationManifest);
        }
        let mut normalized_entries = Vec::with_capacity(entries.len());
        let mut file_paths = HashSet::new();
        let mut directory_paths = HashSet::new();
        for entry in entries {
            if entry.is_directory && entry.source_size != 0 {
                return Err(LocalArchiveError::InvalidDirectorySourceSize);
            }
            let archive_path = normalized_archive_path(&entry.archive_path, entry.is_directory)?
                .trim_end_matches('/')
                .to_string();
            let archive_path_key = collision_key(&archive_path);
            if entry.is_directory {
                if !directory_paths.insert(archive_path_key) {
                    return Err(LocalArchiveError::DuplicateEntryPath);
                }
            } else if !file_paths.insert(archive_path_key) {
                return Err(LocalArchiveError::DuplicateEntryPath);
            }
            let path_parts = archive_path.split('/').collect::<Vec<_>>();
            let directory_part_count = if entry.is_directory {
                path_parts.len()
            } else {
                path_parts.len().saturating_sub(1)
            };
            for index in 1..=directory_part_count {
                directory_paths.insert(collision_key(&path_parts[..index].join("/")));
            }
            normalized_entries.push(ArchiveCreationManifestMember {
                archive_path,
                is_directory: entry.is_directory,
                source_size: entry.source_size,
                source_modified_at: normalize_creation_source_modified_at(entry.source_modified_at)?,
            });
        }
        if !file_paths.is_disjoint(&directory_paths) {
            return Err(LocalArchiveError::DuplicateEntryPath);
        }
        Ok(Self {
            entries: normalized_entries,
        })
    }

    /// Return the normalized approved member for a transport path.
    pub fn member(&self, archive_path: &str) -> Result<&ArchiveCreationManifestMember, LocalArchiveError> {
        let normalized_path = normalized_archive_path(archive_path, false)?;
        let normalized = normalized_path.trim_end_matches('/');
        self.entries
            .iter()
            .find(|entry| entry.archive_path == normalized)
            .ok_or(LocalArchiveError::UnknownCreationMember)
    }

    /// Return aggregate expected totals for a fully committed manifest.
    #[cfg(test)]
    pub fn summary(&self) -> Result<LocalArchiveCreationResult, LocalArchiveError> {
        let mut result = LocalArchiveCreationResult::default();
        for entry in &self.entries {
            if entry.is_directory {
                result.directories_created = result
                    .directories_created
                    .checked_add(1)
                    .ok_or_else(|| LocalArchiveError::Io(std::io::Error::other("Archive directory count overflow")))?;
            } else {
                result.files_created = result
                    .files_created
                    .checked_add(1)
                    .ok_or_else(|| LocalArchiveError::Io(std::io::Error::other("Archive file count overflow")))?;
                result.source_bytes = result
                    .source_bytes
                    .checked_add(entry.source_size)
                    .ok_or_else(|| LocalArchiveError::Io(std::io::Error::other("Archive source size overflow")))?;
            }
        }
        Ok(result)
    }
}

/// Immutable creation manifest binding consumed by a local creation execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalArchiveCreationExecutionPlan {
    manifest: ArchiveCreationManifest,
}

impl LocalArchiveCreationExecutionPlan {
    pub fn from_manifest(manifest: ArchiveCreationManifest) -> Self {
        Self { manifest }
    }

    fn into_state(self) -> ArchiveCreationManifestState {
        ArchiveCreationManifestState::new(self.manifest)
    }
}

/// One manifest-validated creation member outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveCreationMemberOutcome {
    pub archive_path: String,
    pub status: LocalArchiveCreationMemberStatus,
    pub source_bytes: u64,
}

/// In-memory relay outcome state that requires exact manifest coverage at completion.
#[derive(Debug, Clone)]
pub struct ArchiveCreationManifestState {
    manifest: ArchiveCreationManifest,
    outcomes: HashMap<String, ArchiveCreationMemberOutcome>,
}

impl ArchiveCreationManifestState {
    pub fn new(manifest: ArchiveCreationManifest) -> Self {
        Self {
            manifest,
            outcomes: HashMap::new(),
        }
    }

    pub fn expected_outcome(&self, archive_path: &str) -> Result<ArchiveCreationMemberOutcome, LocalArchiveError> {
        let member = self.manifest.member(archive_path)?;
        Ok(ArchiveCreationMemberOutcome {
            archive_path: member.archive_path.clone(),
            status: if member.is_directory {
                LocalArchiveCreationMemberStatus::Directory
            } else {
                LocalArchiveCreationMemberStatus::Created
            },
            source_bytes: member.source_size,
        })
    }

    pub fn record(&mut self, outcome: ArchiveCreationMemberOutcome) -> Result<(), LocalArchiveError> {
        let expected = self.expected_outcome(&outcome.archive_path)?;
        if outcome != expected {
            return Err(LocalArchiveError::InvalidCreationOutcome);
        }
        if let Some(existing) = self.outcomes.get(&expected.archive_path) {
            return if existing == &expected {
                Ok(())
            } else {
                Err(LocalArchiveError::ConflictingCreationOutcome)
            };
        }
        self.outcomes.insert(expected.archive_path.clone(), expected);
        Ok(())
    }

    /// Record the sole permitted outcome after the member's physical write is acknowledged.
    pub fn record_expected(&mut self, archive_path: &str) -> Result<(), LocalArchiveError> {
        self.record(self.expected_outcome(archive_path)?)
    }

    /// Return aggregate progress derived solely from recorded member outcomes.
    pub fn progress(&self) -> Result<LocalArchiveCreationResult, LocalArchiveError> {
        let mut result = LocalArchiveCreationResult::default();
        for outcome in self.outcomes.values() {
            match outcome.status {
                LocalArchiveCreationMemberStatus::Directory => {
                    result.directories_created = result
                        .directories_created
                        .checked_add(1)
                        .ok_or_else(|| LocalArchiveError::Io(std::io::Error::other("Archive directory count overflow")))?;
                }
                LocalArchiveCreationMemberStatus::Created => {
                    result.files_created = result
                        .files_created
                        .checked_add(1)
                        .ok_or_else(|| LocalArchiveError::Io(std::io::Error::other("Archive file count overflow")))?;
                    result.source_bytes = result
                        .source_bytes
                        .checked_add(outcome.source_bytes)
                        .ok_or_else(|| LocalArchiveError::Io(std::io::Error::other("Archive source size overflow")))?;
                }
            }
        }
        Ok(result)
    }

    pub fn terminal_summary(&self) -> Result<LocalArchiveCreationResult, LocalArchiveError> {
        if self.outcomes.len() != self.manifest.entries.len()
            || self
                .manifest
                .entries
                .iter()
                .any(|entry| !self.outcomes.contains_key(&entry.archive_path))
        {
            return Err(LocalArchiveError::IncompleteCreationManifest);
        }
        self.progress()
    }
}

/// An immutable, normalized member approved for remote ZIP extraction.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ArchiveExtractionManifestMember {
    pub path: String,
    pub is_directory: bool,
    pub uncompressed_size: u64,
    pub modified_at: Option<DateTime<Utc>>,
}

/// Typed extraction manifest received from a remote ZIP source.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ArchiveExtractionManifest {
    pub entries: Vec<ArchiveExtractionManifestMember>,
}

impl ArchiveExtractionManifest {
    /// Normalize and validate all immutable extraction members before output begins.
    pub fn from_entries(entries: Vec<ArchiveExtractionManifestMember>) -> Result<Self, LocalArchiveError> {
        let mut normalized_entries = Vec::with_capacity(entries.len());
        let mut entry_paths = HashSet::new();
        let mut file_paths = HashSet::new();
        let mut directory_paths = HashSet::new();
        for entry in entries {
            let path = normalized_archive_path(&entry.path, entry.is_directory)?
                .trim_end_matches('/')
                .to_string();
            let path_key = collision_key(&path);
            if !entry_paths.insert(path_key.clone()) {
                return Err(LocalArchiveError::DuplicateEntryPath);
            }
            let path_parts = path.split('/').collect::<Vec<_>>();
            let directory_part_count = if entry.is_directory {
                path_parts.len()
            } else {
                path_parts.len().saturating_sub(1)
            };
            for index in 1..=directory_part_count {
                directory_paths.insert(collision_key(&path_parts[..index].join("/")));
            }
            if !entry.is_directory {
                file_paths.insert(path_key);
            }
            normalized_entries.push(ArchiveExtractionManifestMember {
                path,
                is_directory: entry.is_directory,
                uncompressed_size: entry.uncompressed_size,
                modified_at: entry.modified_at,
            });
        }
        if !file_paths.is_disjoint(&directory_paths) {
            return Err(LocalArchiveError::DuplicateEntryPath);
        }
        Ok(Self {
            entries: normalized_entries,
        })
    }
}

/// One durable terminal or partial outcome reported by a remote extraction destination.
#[derive(Debug, Clone, Deserialize)]
struct ArchiveExtractionRelayMemberOutcome {
    status: String,
    #[serde(default)]
    target_path: String,
    #[serde(default)]
    directories_created: u64,
    #[serde(default)]
    extracted_bytes: u64,
    #[serde(default)]
    replaced: bool,
    #[serde(default)]
    renamed: bool,
}

/// Typed remote extraction state used to resume local relay execution safely.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ArchiveExtractionRelayState {
    #[serde(default)]
    extraction_outcome_checkpoint_version: Option<u8>,
    #[serde(default)]
    written_members: Vec<String>,
    #[serde(default)]
    member_outcomes: Option<HashMap<String, ArchiveExtractionRelayMemberOutcome>>,
    #[serde(default)]
    ignored_members: Vec<String>,
    #[serde(default)]
    retry_members: Vec<String>,
    #[serde(default)]
    member_collision_actions: HashMap<String, String>,
    #[serde(default)]
    member_rename_targets: HashMap<String, String>,
    collision_policy: Option<String>,
    #[serde(default)]
    files_extracted: u64,
    #[serde(default)]
    directories_created: u64,
    #[serde(default)]
    extracted_bytes: u64,
    #[serde(default)]
    files_skipped: u64,
}

impl ArchiveExtractionRelayState {
    /// Deserialize the authoritative durable relay checkpoint.
    pub fn from_checkpoint_json(checkpoint_json: &str) -> Result<Self, LocalArchiveError> {
        serde_json::from_str(checkpoint_json).map_err(|_| {
            LocalArchiveError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Archive relay returned an invalid checkpoint",
            ))
        })
    }

    /// Return members whose durable outcomes are terminal and therefore replayable.
    pub fn completed_members(&self) -> Result<HashSet<String>, LocalArchiveError> {
        if self.extraction_outcome_checkpoint_version.is_some_and(|version| version != 1) {
            return Err(LocalArchiveError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Archive relay returned an unsupported extraction checkpoint version",
            )));
        }
        let Some(outcomes) = &self.member_outcomes else {
            if self.extraction_outcome_checkpoint_version.is_some() {
                return Err(LocalArchiveError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Archive relay returned a versioned checkpoint without member outcomes",
                )));
            }
            return Ok(self.legacy_v1_completed_members());
        };
        outcomes
            .iter()
            .filter_map(|(member_path, outcome)| match outcome.status.as_str() {
                "directory" | "extracted" | "skipped" | "ignored" => Some(Ok(member_path.clone())),
                "partial" => None,
                _ => Some(Err(LocalArchiveError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Archive relay returned an invalid member outcome",
                )))),
            })
            .collect()
    }

    /// Bind persisted relay decisions and outcomes to the immutable member manifest.
    pub fn validate_manifest(&self, manifest: &ArchiveExtractionManifest) -> Result<(), LocalArchiveError> {
        let member_paths = manifest.entries.iter().map(|entry| entry.path.as_str()).collect::<HashSet<_>>();
        let mut referenced_members = self
            .member_outcomes
            .as_ref()
            .into_iter()
            .flat_map(|outcomes| outcomes.keys())
            .chain(self.ignored_members.iter())
            .chain(self.retry_members.iter())
            .chain(self.member_collision_actions.keys())
            .chain(self.member_rename_targets.keys());
        if referenced_members.any(|member_path| !member_paths.contains(member_path.as_str())) {
            return Err(LocalArchiveError::CheckpointMemberUnavailable);
        }
        if let Some(outcomes) = &self.member_outcomes {
            for outcome in outcomes.values() {
                if !matches!(
                    outcome.status.as_str(),
                    "directory" | "extracted" | "skipped" | "ignored" | "partial"
                ) || (outcome.status != "partial" && outcome.target_path.is_empty())
                    || (outcome.renamed && outcome.target_path.is_empty())
                {
                    return Err(LocalArchiveError::Io(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Archive relay returned an invalid member outcome",
                    )));
                }
            }
        }
        Ok(())
    }

    /// Read unversioned V1 members; retire this sole compatibility boundary with the V1 reader after V2 retention ends.
    fn legacy_v1_completed_members(&self) -> HashSet<String> {
        self.written_members.iter().cloned().collect()
    }

    /// Return the currently approved local-relative target for one manifest member.
    pub fn target_member_path<'a>(&'a self, member_path: &'a str) -> &'a str {
        self.member_rename_targets.get(member_path).map_or(member_path, String::as_str)
    }

    /// Return whether a member is intentionally ignored by a persisted decision.
    pub fn is_ignored(&self, member_path: &str) -> bool {
        self.ignored_members.iter().any(|member| member == member_path)
    }

    /// Return whether a partial member was authorized to retry.
    pub fn is_retrying(&self, member_path: &str) -> bool {
        self.retry_members.iter().any(|member| member == member_path)
    }

    /// Return the member-specific or global collision action, if one is persisted.
    pub fn collision_action(&self, member_path: &str) -> Option<&str> {
        self.member_collision_actions
            .get(member_path)
            .or(self.collision_policy.as_ref())
            .map(String::as_str)
    }

    /// Return the durable aggregate progress reported by the backend.
    pub fn progress(&self) -> LocalArchiveExtractionResult {
        if let Some(outcomes) = &self.member_outcomes {
            let mut result = LocalArchiveExtractionResult::default();
            for outcome in outcomes.values() {
                result.directories_created = result.directories_created.saturating_add(outcome.directories_created);
                match outcome.status.as_str() {
                    "directory" => {}
                    "extracted" => {
                        result.files_extracted = result.files_extracted.saturating_add(1);
                        result.extracted_bytes = result.extracted_bytes.saturating_add(outcome.extracted_bytes);
                        result.files_replaced = result.files_replaced.saturating_add(u64::from(outcome.replaced));
                    }
                    "skipped" | "ignored" => result.files_skipped = result.files_skipped.saturating_add(1),
                    "partial" => result.partial_members = result.partial_members.saturating_add(1),
                    _ => return LocalArchiveExtractionResult::default(),
                }
            }
            return result;
        }
        LocalArchiveExtractionResult {
            files_extracted: self.files_extracted,
            directories_created: self.directories_created,
            extracted_bytes: self.extracted_bytes,
            files_skipped: self.files_skipped,
            ..LocalArchiveExtractionResult::default()
        }
    }
}

/// Immutable relay manifest and validated durable state consumed by mixed extraction coordinators.
#[derive(Debug, Clone)]
pub struct ArchiveExtractionRelayExecutionPlan {
    manifest: ArchiveExtractionManifest,
    state: ArchiveExtractionRelayState,
}

impl ArchiveExtractionRelayExecutionPlan {
    pub fn from_checkpoint_json(manifest: ArchiveExtractionManifest, checkpoint_json: &str) -> Result<Self, LocalArchiveError> {
        let state = ArchiveExtractionRelayState::from_checkpoint_json(checkpoint_json)?;
        Self::from_state(manifest, state)
    }

    pub fn from_state(manifest: ArchiveExtractionManifest, state: ArchiveExtractionRelayState) -> Result<Self, LocalArchiveError> {
        state.validate_manifest(&manifest)?;
        Ok(Self { manifest, state })
    }

    pub fn manifest(&self) -> &ArchiveExtractionManifest {
        &self.manifest
    }
}

impl std::ops::Deref for ArchiveExtractionRelayExecutionPlan {
    type Target = ArchiveExtractionRelayState;

    fn deref(&self) -> &Self::Target {
        &self.state
    }
}

/// Terminal state reported after one local ZIP entry commits successfully.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalArchiveCreationMemberStatus {
    Directory,
    Created,
}

/// One bounded source-stream event supplied by the asynchronous SMB relay.
pub enum LocalArchiveRelayChunk {
    Data(Vec<u8>),
    Complete,
    Failed,
}

/// Stateful local ZIP writer used while an asynchronous source relay streams one member at a time.
pub struct LocalArchiveRelayWriter {
    writer: ZipWriter<StreamWriter<FsFile>>,
    manifest: ArchiveCreationManifest,
    next_manifest_index: usize,
}

/// Summary of a completed local archive extraction.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LocalArchiveExtractionResult {
    pub files_extracted: u64,
    pub directories_created: u64,
    pub extracted_bytes: u64,
    pub files_skipped: u64,
    pub files_replaced: u64,
    pub files_failed: u64,
    pub partial_members: u64,
}

/// Terminal state reported by a local extraction destination for one archive member.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalArchiveExtractionDestinationStatus {
    Directory,
    Extracted,
    Skipped,
    Ignored,
}

/// Provider-neutral member result used to update extraction progress and replay state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalArchiveExtractionDestinationResult {
    pub member_path: String,
    pub status: LocalArchiveExtractionDestinationStatus,
    pub target_path: String,
    pub extracted_bytes: u64,
    pub directories_created: u64,
    pub replaced: bool,
    pub renamed: bool,
}

/// A user-approved resolution for a pre-existing local extraction output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalArchiveExtractionCollisionAction {
    Skip,
    Replace,
    ReplaceOlder,
}

/// Durable-in-session state required to restart local extraction after a pause.
#[derive(Debug, Clone, Default)]
pub struct LocalArchiveExtractionCheckpoint {
    manifest: Option<ArchiveExtractionManifest>,
    source_identity: Option<LocalArchiveSourceIdentity>,
    member_outcomes: HashMap<String, LocalArchiveExtractionDestinationResult>,
    collision_actions: HashMap<String, LocalArchiveExtractionCollisionAction>,
    member_rename_targets: HashMap<String, String>,
    global_collision_action: Option<LocalArchiveExtractionCollisionAction>,
    partial_members: HashMap<String, u64>,
    destination_root_created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LocalArchiveSourceIdentity {
    size: u64,
    modified_at: Option<std::time::SystemTime>,
}

fn local_archive_source_identity(archive_path: &Path) -> Result<LocalArchiveSourceIdentity, LocalArchiveError> {
    let metadata = fs::metadata(archive_path)?;
    Ok(LocalArchiveSourceIdentity {
        size: metadata.len(),
        modified_at: metadata.modified().ok(),
    })
}

/// Immutable archive members and persisted checkpoint state consumed by one extraction pass.
#[derive(Debug, Clone)]
pub struct LocalArchiveExtractionExecutionPlan {
    manifest: ArchiveExtractionManifest,
    checkpoint: LocalArchiveExtractionCheckpoint,
}

impl LocalArchiveExtractionExecutionPlan {
    pub fn from_manifest(
        manifest: ArchiveExtractionManifest,
        checkpoint: LocalArchiveExtractionCheckpoint,
    ) -> Result<Self, LocalArchiveError> {
        let member_paths = manifest.entries.iter().map(|entry| entry.path.as_str()).collect::<HashSet<_>>();
        let mut checkpoint_member_paths = checkpoint
            .member_outcomes
            .keys()
            .chain(checkpoint.collision_actions.keys())
            .chain(checkpoint.member_rename_targets.keys())
            .chain(checkpoint.partial_members.keys());
        if checkpoint_member_paths.any(|member_path| !member_paths.contains(member_path.as_str())) {
            return Err(LocalArchiveError::CheckpointMemberUnavailable);
        }
        Ok(Self { manifest, checkpoint })
    }

    #[cfg(test)]
    pub fn completed_member_paths(&self) -> HashSet<&str> {
        self.checkpoint.member_outcomes.keys().map(String::as_str).collect()
    }

    pub fn has_complete_terminal_coverage(&self) -> bool {
        self.checkpoint.member_outcomes.len() == self.manifest.entries.len()
            && self
                .manifest
                .entries
                .iter()
                .all(|entry| self.checkpoint.member_outcomes.contains_key(&entry.path))
    }

    pub fn into_checkpoint(self) -> LocalArchiveExtractionCheckpoint {
        self.checkpoint
    }
}

impl LocalArchiveExtractionCheckpoint {
    pub fn result(&self) -> LocalArchiveExtractionResult {
        let mut result = LocalArchiveExtractionResult {
            directories_created: u64::from(self.destination_root_created),
            partial_members: self.partial_members.len() as u64,
            ..LocalArchiveExtractionResult::default()
        };
        for outcome in self.member_outcomes.values() {
            result.directories_created = result.directories_created.saturating_add(outcome.directories_created);
            result.extracted_bytes = result.extracted_bytes.saturating_add(outcome.extracted_bytes);
            match outcome.status {
                LocalArchiveExtractionDestinationStatus::Directory => {}
                LocalArchiveExtractionDestinationStatus::Extracted => {
                    result.files_extracted = result.files_extracted.saturating_add(1);
                    result.files_replaced = result.files_replaced.saturating_add(u64::from(outcome.replaced));
                }
                LocalArchiveExtractionDestinationStatus::Skipped | LocalArchiveExtractionDestinationStatus::Ignored => {
                    result.files_skipped = result.files_skipped.saturating_add(1);
                }
            }
        }
        result
    }

    fn is_completed(&self, member_path: &str) -> bool {
        self.member_outcomes.contains_key(member_path)
    }

    pub fn resolve_collision(&mut self, member_path: String, action: LocalArchiveExtractionCollisionAction) {
        self.collision_actions.insert(member_path, action);
    }

    pub fn resolve_all_collisions(&mut self, action: LocalArchiveExtractionCollisionAction) {
        self.global_collision_action = Some(action);
    }

    pub fn rename_member(&mut self, member_path: String, target_path: String) {
        self.member_rename_targets.insert(
            member_path.trim_end_matches('/').to_string(),
            target_path.trim_end_matches('/').to_string(),
        );
    }

    fn target_path(&self, member_path: &str) -> String {
        let matching_source = self
            .member_rename_targets
            .keys()
            .filter(|source| member_path == source.as_str() || member_path.starts_with(&format!("{source}/")))
            .max_by_key(|source| source.len());
        let Some(source) = matching_source else {
            return member_path.to_string();
        };
        let suffix = member_path[source.len()..].trim_matches('/');
        if suffix.is_empty() {
            self.member_rename_targets[source].clone()
        } else {
            format!("{}/{suffix}", self.member_rename_targets[source])
        }
    }

    fn collision_action(&self, member_path: &str) -> Option<LocalArchiveExtractionCollisionAction> {
        self.collision_actions.get(member_path).copied().or(self.global_collision_action)
    }

    fn has_partial_member(&self, member_path: &str) -> bool {
        self.partial_members.contains_key(member_path)
    }

    fn record_partial_member(&mut self, member_path: String, directories_created: u64) {
        self.partial_members.insert(member_path, directories_created);
    }

    fn clear_partial_member(&mut self, member_path: &str) -> u64 {
        self.partial_members.remove(member_path).unwrap_or(0)
    }

    pub fn ignore_member_error(&mut self, member_path: String) {
        let target_path = self.target_path(&member_path);
        self.partial_members.remove(&member_path);
        self.record_destination_result(LocalArchiveExtractionDestinationResult {
            member_path,
            status: LocalArchiveExtractionDestinationStatus::Ignored,
            target_path,
            extracted_bytes: 0,
            directories_created: 0,
            replaced: false,
            renamed: false,
        })
        .expect("ignored member outcome must be internally valid");
    }

    fn record_destination_result(&mut self, result: LocalArchiveExtractionDestinationResult) -> Result<(), LocalArchiveError> {
        if let Some(existing) = self.member_outcomes.get(&result.member_path) {
            if existing == &result {
                return Ok(());
            }
            return Err(LocalArchiveError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Archive extraction member outcome conflicts with its prior result",
            )));
        }
        self.member_outcomes.insert(result.member_path.clone(), result);
        Ok(())
    }
}

/// A file that needs a user decision before local extraction can continue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalArchiveExtractionCollision {
    pub member_path: String,
    pub target_path: String,
    pub is_directory: bool,
}

/// A failed local archive member that can be retried or left in place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalArchiveExtractionMemberError {
    pub member_path: String,
    pub target_path: String,
    pub message: String,
    pub partial_output: bool,
}

/// The result of one restartable local extraction pass.
#[derive(Debug, Clone)]
pub enum LocalArchiveExtractionRunResult {
    Completed(LocalArchiveExtractionCheckpoint),
    AwaitingCollision {
        checkpoint: LocalArchiveExtractionCheckpoint,
        collision: LocalArchiveExtractionCollision,
    },
    AwaitingMemberError {
        checkpoint: LocalArchiveExtractionCheckpoint,
        error: LocalArchiveExtractionMemberError,
    },
}

/// Errors returned by local direct archive creation.
#[derive(Debug, Error)]
pub enum LocalArchiveError {
    #[error("archive entry path is unsafe")]
    UnsafeEntryPath,
    #[error("archive contains a symbolic link or unsupported special member")]
    UnsupportedArchiveMember,
    #[error("archive output already exists")]
    TargetExists,
    #[error("archive extraction destination already exists")]
    ExtractionTargetExists,
    #[error("archive output is inside a selected source directory")]
    TargetInsideSource,
    #[error("archive output is outside the allowed drive root")]
    TargetOutsideRoot,
    #[error("archive sources produce duplicate normalized entry names")]
    DuplicateEntryPath,
    #[error("extraction checkpoint references an archive member that is unavailable")]
    CheckpointMemberUnavailable,
    #[error("archive extraction did not record every archive member")]
    IncompleteExtractionManifest,
    #[error("archive creation manifest is empty")]
    EmptyCreationManifest,
    #[error("archive directory source size must be zero")]
    InvalidDirectorySourceSize,
    #[error("archive creation member is invalid or unavailable")]
    UnknownCreationMember,
    #[error("archive creation member outcome is invalid")]
    InvalidCreationOutcome,
    #[error("archive creation member outcome conflicts with its prior result")]
    ConflictingCreationOutcome,
    #[error("archive creation member outcomes did not match the preflight manifest")]
    IncompleteCreationManifest,
    #[error("archive source changed since extraction began")]
    ArchiveSourceChanged,
    #[error("archive source is not a regular file or directory")]
    UnsupportedSource,
    #[error("archive operation was cancelled")]
    Cancelled,
    #[error("archive extraction failed after creating partial output: {0}")]
    PartialOutput(#[source] Box<LocalArchiveError>),
    #[error("archive creation failed after creating partial output: {0}")]
    PartialArchiveOutput(#[source] Box<LocalArchiveError>),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    ArchiveRead(#[from] LocalArchiveReadError),
}

/// Errors returned by custom local ZIP metadata parsing.
#[derive(Debug, Error)]
pub enum LocalArchiveReadError {
    #[error("archive is too small to be a ZIP file")]
    TooSmall,
    #[error("ZIP end-of-central-directory record is missing or malformed")]
    InvalidEndOfDirectory,
    #[error("ZIP64 end-of-central-directory record is invalid")]
    InvalidZip64Directory,
    #[error("ZIP central directory extends beyond archive bounds")]
    DirectoryOutOfBounds,
    #[error("ZIP central-directory entry is invalid")]
    InvalidDirectoryEntry,
    #[error("ZIP central-directory entry length is invalid")]
    InvalidEntryLength,
    #[error("ZIP64 member metadata is missing or malformed")]
    InvalidZip64Member,
    #[error("archive directory path is invalid")]
    InvalidDirectoryPath,
    #[error("archive listing cursor is invalid")]
    InvalidCursor,
    #[error("archive member path is invalid")]
    InvalidMemberPath,
    #[error("archive member was not found")]
    MemberNotFound,
    #[error("archive member uses an unavailable codec or blocked feature")]
    UnavailableMember,
    #[error("ZIP local header is invalid or does not match the central directory")]
    InvalidLocalHeader,
    #[error("archive member payload extends beyond archive bounds")]
    MemberOutOfBounds,
    #[error("archive member integrity check failed")]
    MemberIntegrityFailure,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

fn u16_le(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

fn u32_le(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]])
}

fn u64_le(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
    ])
}

fn read_exact_at(file: &mut FsFile, archive_size: u64, offset: u64, length: usize) -> Result<Vec<u8>, LocalArchiveReadError> {
    let end = offset
        .checked_add(length as u64)
        .ok_or(LocalArchiveReadError::DirectoryOutOfBounds)?;
    if end > archive_size {
        return Err(LocalArchiveReadError::DirectoryOutOfBounds);
    }
    let mut data = vec![0; length];
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(offset))?;
    file.read_exact(&mut data)?;
    Ok(data)
}

fn unicode_path_name(raw_name: &[u8], extra: &[u8]) -> Option<String> {
    let mut position = 0;
    while position + 4 <= extra.len() {
        let field_id = u16_le(extra, position);
        let field_length = usize::from(u16_le(extra, position + 2));
        position += 4;
        if position + field_length > extra.len() {
            return None;
        }
        let field = &extra[position..position + field_length];
        position += field_length;
        if field_id != INFOZIP_UNICODE_PATH_FIELD_ID || field.len() < 5 {
            continue;
        }
        if field[0] != INFOZIP_UNICODE_PATH_VERSION || u32_le(field, 1) != !update_crc32(u32::MAX, raw_name) {
            continue;
        }
        if let Ok(name) = std::str::from_utf8(&field[5..]) {
            return Some(name.to_owned());
        }
    }
    None
}

fn decode_entry_name(raw_name: &[u8], flags: u16, extra: &[u8]) -> String {
    if flags & 0x0800 != 0 {
        return String::from_utf8_lossy(raw_name).into_owned();
    }
    if let Some(name) = unicode_path_name(raw_name, extra) {
        return name;
    }
    decode_cp437(raw_name)
}

fn decode_cp437(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| {
            if *byte < 0x80 {
                char::from(*byte)
            } else {
                CP437_EXTENDED_CHARACTERS
                    .chars()
                    .nth(usize::from(*byte - 0x80))
                    .expect("CP437 mapping must contain all 128 extended characters")
            }
        })
        .collect()
}

fn normalize_virtual_path(path: &str) -> (String, bool) {
    let is_directory = path.ends_with(['/', '\\']);
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    (trimmed.to_string(), is_directory)
}

fn is_safe_virtual_path(path: &str, normalized_path: &str) -> bool {
    let canonical = path.replace('\\', "/");
    let trimmed = canonical.trim_end_matches('/');
    if trimmed.is_empty() || trimmed.starts_with('/') || trimmed.contains('\0') {
        return false;
    }
    let segments = trimmed.split('/');
    segments
        .clone()
        .all(|segment| !segment.is_empty() && !matches!(segment, "." | "..") && !segment.contains(':'))
        && normalized_path == trimmed
}

fn has_supported_file_type(version_made_by: u16, external_attributes: u32) -> bool {
    if version_made_by >> 8 != UNIX_HOST_SYSTEM {
        return true;
    }
    matches!(
        (external_attributes >> 16) as u16 & UNIX_FILE_TYPE_MASK,
        0 | UNIX_DIRECTORY_FILE_TYPE | UNIX_REGULAR_FILE_TYPE
    )
}

fn dos_datetime(date_value: u16, time_value: u16) -> Option<DateTime<Utc>> {
    let year = i32::from((date_value >> 9) & 0x7f) + 1980;
    let month = u32::from((date_value >> 5) & 0x0f);
    let day = u32::from(date_value & 0x1f);
    let hour = u32::from((time_value >> 11) & 0x1f);
    let minute = u32::from((time_value >> 5) & 0x3f);
    let second = u32::from((time_value & 0x1f) * 2);
    NaiveDate::from_ymd_opt(year, month, day)?
        .and_hms_opt(hour, minute, second)
        .map(|value| value.and_utc())
}

fn zip64_member_values(
    extra: &[u8],
    mut compressed_size: u64,
    mut uncompressed_size: u64,
    mut local_header_offset: u64,
) -> Result<(u64, u64, u64), LocalArchiveReadError> {
    let mut position = 0;
    while position + 4 <= extra.len() {
        let field_id = u16_le(extra, position);
        let field_length = usize::from(u16_le(extra, position + 2));
        position += 4;
        if position + field_length > extra.len() {
            return Err(LocalArchiveReadError::InvalidZip64Member);
        }
        if field_id != 0x0001 {
            position += field_length;
            continue;
        }
        let field = &extra[position..position + field_length];
        let mut value_position = 0;
        let mut take_value = |required: bool, value: &mut u64| -> Result<(), LocalArchiveReadError> {
            if required {
                if value_position + 8 > field.len() {
                    return Err(LocalArchiveReadError::InvalidZip64Member);
                }
                *value = u64_le(field, value_position);
                value_position += 8;
            }
            Ok(())
        };
        take_value(uncompressed_size == u64::from(ZIP64_SENTINEL_U32), &mut uncompressed_size)?;
        take_value(compressed_size == u64::from(ZIP64_SENTINEL_U32), &mut compressed_size)?;
        take_value(local_header_offset == u64::from(ZIP64_SENTINEL_U32), &mut local_header_offset)?;
        return Ok((compressed_size, uncompressed_size, local_header_offset));
    }
    if compressed_size == u64::from(ZIP64_SENTINEL_U32)
        || uncompressed_size == u64::from(ZIP64_SENTINEL_U32)
        || local_header_offset == u64::from(ZIP64_SENTINEL_U32)
    {
        return Err(LocalArchiveReadError::InvalidZip64Member);
    }
    Ok((compressed_size, uncompressed_size, local_header_offset))
}

fn read_local_archive_entries(archive_path: &Path) -> Result<Vec<LocalArchiveReadEntry>, LocalArchiveReadError> {
    let mut file = FsFile::open(archive_path)?;
    let archive_size = file.metadata()?.len();
    if archive_size < EOCD_SIZE as u64 {
        return Err(LocalArchiveReadError::TooSmall);
    }
    let tail_length = archive_size.min((EOCD_SIZE + MAX_COMMENT_BYTES) as u64) as usize;
    let tail = read_exact_at(&mut file, archive_size, archive_size - tail_length as u64, tail_length)?;
    let Some(eocd_index) = tail.windows(EOCD_SIGNATURE.len()).rposition(|window| window == EOCD_SIGNATURE) else {
        return Err(LocalArchiveReadError::InvalidEndOfDirectory);
    };
    if eocd_index + EOCD_SIZE > tail.len() || eocd_index + EOCD_SIZE + usize::from(u16_le(&tail, eocd_index + 20)) != tail.len() {
        return Err(LocalArchiveReadError::InvalidEndOfDirectory);
    }
    let eocd_offset = archive_size - tail_length as u64 + eocd_index as u64;
    let mut entry_count = u64::from(u16_le(&tail, eocd_index + 10));
    let mut directory_size = u64::from(u32_le(&tail, eocd_index + 12));
    let mut directory_offset = u64::from(u32_le(&tail, eocd_index + 16));
    if entry_count == u64::from(ZIP64_SENTINEL_U16)
        || directory_size == u64::from(ZIP64_SENTINEL_U32)
        || directory_offset == u64::from(ZIP64_SENTINEL_U32)
    {
        if eocd_offset < ZIP64_LOCATOR_SIZE as u64 {
            return Err(LocalArchiveReadError::InvalidZip64Directory);
        }
        let locator = read_exact_at(&mut file, archive_size, eocd_offset - ZIP64_LOCATOR_SIZE as u64, ZIP64_LOCATOR_SIZE)?;
        if locator[..4] != *ZIP64_LOCATOR_SIGNATURE {
            return Err(LocalArchiveReadError::InvalidZip64Directory);
        }
        let zip64_offset = u64_le(&locator, 8);
        let header = read_exact_at(&mut file, archive_size, zip64_offset, 56)?;
        if header[..4] != *ZIP64_EOCD_SIGNATURE || u64_le(&header, 4) < 44 {
            return Err(LocalArchiveReadError::InvalidZip64Directory);
        }
        entry_count = u64_le(&header, 32);
        directory_size = u64_le(&header, 40);
        directory_offset = u64_le(&header, 48);
    }
    let directory_end = directory_offset
        .checked_add(directory_size)
        .filter(|end| *end <= archive_size)
        .ok_or(LocalArchiveReadError::DirectoryOutOfBounds)?;
    let mut entries = Vec::new();
    let mut position = directory_offset;
    for _ in 0..entry_count {
        let fixed = read_exact_at(&mut file, archive_size, position, CENTRAL_DIRECTORY_FIXED_SIZE)?;
        if fixed[..4] != *CENTRAL_DIRECTORY_SIGNATURE {
            return Err(LocalArchiveReadError::InvalidDirectoryEntry);
        }
        let name_length = usize::from(u16_le(&fixed, 28));
        let extra_length = usize::from(u16_le(&fixed, 30));
        let comment_length = usize::from(u16_le(&fixed, 32));
        let variable_length = name_length + extra_length + comment_length;
        let entry_end = position
            .checked_add(CENTRAL_DIRECTORY_FIXED_SIZE as u64)
            .and_then(|offset| offset.checked_add(variable_length as u64))
            .filter(|end| *end <= directory_end)
            .ok_or(LocalArchiveReadError::InvalidEntryLength)?;
        if variable_length > MAX_ENTRY_VARIABLE_BYTES {
            return Err(LocalArchiveReadError::InvalidEntryLength);
        }
        let variable = read_exact_at(
            &mut file,
            archive_size,
            position + CENTRAL_DIRECTORY_FIXED_SIZE as u64,
            variable_length,
        )?;
        let raw_name = variable[..name_length].to_vec();
        let flags = u16_le(&fixed, 8);
        let version_made_by = u16_le(&fixed, 4);
        let external_attributes = u32_le(&fixed, 38);
        let extra = &variable[name_length..name_length + extra_length];
        let decoded_name = decode_entry_name(&raw_name, flags, extra);
        let (path, is_directory) = normalize_virtual_path(&decoded_name);
        let (compressed_size, uncompressed_size, local_header_offset) = zip64_member_values(
            extra,
            u64::from(u32_le(&fixed, 20)),
            u64::from(u32_le(&fixed, 24)),
            u64::from(u32_le(&fixed, 42)),
        )?;
        entries.push(LocalArchiveReadEntry {
            path: path.clone(),
            is_directory,
            compressed_size,
            uncompressed_size,
            compression_method: u16_le(&fixed, 10),
            crc32: u32_le(&fixed, 16),
            modified_at: dos_datetime(u16_le(&fixed, 14), u16_le(&fixed, 12)),
            encrypted: flags & 1 != 0,
            is_safe: is_safe_virtual_path(&decoded_name, &path),
            has_supported_file_type: has_supported_file_type(version_made_by, external_attributes),
            local_header_offset,
            flags,
            raw_name,
        });
        position = entry_end;
    }
    if position != directory_end {
        return Err(LocalArchiveReadError::InvalidDirectoryEntry);
    }
    Ok(entries)
}

/// Project parsed local ZIP metadata into the shared inspection domain value.
pub fn inspect_local_archive(archive_path: &Path) -> Result<ArchiveInspectionManifest, LocalArchiveReadError> {
    Ok(ArchiveInspectionManifest {
        entries: read_local_archive_entries(archive_path)?
            .into_iter()
            .map(|entry| ArchiveInspectionManifestMember {
                path: entry.path,
                is_directory: entry.is_directory,
                compressed_size: entry.compressed_size,
                uncompressed_size: entry.uncompressed_size,
                compression_method: entry.compression_method,
                crc32: entry.crc32,
                modified_at: entry.modified_at,
                encrypted: entry.encrypted,
                is_safe: entry.is_safe,
                has_supported_file_type: entry.has_supported_file_type,
            })
            .collect(),
    })
}

/// Resolve and validate a local archive member before starting an HTTP response.
pub fn validate_local_archive_member(archive_path: &Path, member_path: &str) -> Result<LocalArchiveReadEntry, LocalArchiveReadError> {
    let (normalized_path, is_directory) = normalize_virtual_path(member_path);
    if is_directory || normalized_path.is_empty() || !is_safe_virtual_path(member_path, &normalized_path) {
        return Err(LocalArchiveReadError::InvalidMemberPath);
    }
    let entry = read_local_archive_entries(archive_path)?
        .into_iter()
        .find(|candidate| {
            candidate.is_safe && candidate.has_supported_file_type && !candidate.is_directory && candidate.path == normalized_path
        })
        .ok_or(LocalArchiveReadError::MemberNotFound)?;
    if entry.encrypted || !matches!(entry.compression_method, 0 | 8 | 12) {
        return Err(LocalArchiveReadError::UnavailableMember);
    }

    let mut file = FsFile::open(archive_path)?;
    let archive_size = file.metadata()?.len();
    let local_header = read_exact_at(&mut file, archive_size, entry.local_header_offset, 30)?;
    if local_header[..4] != *LOCAL_FILE_SIGNATURE
        || u16_le(&local_header, 6) != entry.flags
        || u16_le(&local_header, 8) != entry.compression_method
    {
        return Err(LocalArchiveReadError::InvalidLocalHeader);
    }
    let name_length = usize::from(u16_le(&local_header, 26));
    let extra_length = usize::from(u16_le(&local_header, 28));
    let local_name = read_exact_at(&mut file, archive_size, entry.local_header_offset + 30, name_length)?;
    if local_name != entry.raw_name {
        return Err(LocalArchiveReadError::InvalidLocalHeader);
    }
    let data_offset = entry
        .local_header_offset
        .checked_add(30)
        .and_then(|offset| offset.checked_add(name_length as u64))
        .and_then(|offset| offset.checked_add(extra_length as u64))
        .ok_or(LocalArchiveReadError::MemberOutOfBounds)?;
    if data_offset
        .checked_add(entry.compressed_size)
        .filter(|end| *end <= archive_size)
        .is_none()
    {
        return Err(LocalArchiveReadError::MemberOutOfBounds);
    }
    Ok(entry)
}

fn member_data_offset(archive_path: &Path, entry: &LocalArchiveReadEntry) -> Result<(FsFile, u64), LocalArchiveReadError> {
    let mut file = FsFile::open(archive_path)?;
    let archive_size = file.metadata()?.len();
    let local_header = read_exact_at(&mut file, archive_size, entry.local_header_offset, 30)?;
    if local_header[..4] != *LOCAL_FILE_SIGNATURE
        || u16_le(&local_header, 6) != entry.flags
        || u16_le(&local_header, 8) != entry.compression_method
    {
        return Err(LocalArchiveReadError::InvalidLocalHeader);
    }
    let name_length = usize::from(u16_le(&local_header, 26));
    let extra_length = usize::from(u16_le(&local_header, 28));
    let local_name = read_exact_at(&mut file, archive_size, entry.local_header_offset + 30, name_length)?;
    if local_name != entry.raw_name {
        return Err(LocalArchiveReadError::InvalidLocalHeader);
    }
    let data_offset = entry
        .local_header_offset
        .checked_add(30)
        .and_then(|offset| offset.checked_add(name_length as u64))
        .and_then(|offset| offset.checked_add(extra_length as u64))
        .ok_or(LocalArchiveReadError::MemberOutOfBounds)?;
    if data_offset
        .checked_add(entry.compressed_size)
        .filter(|end| *end <= archive_size)
        .is_none()
    {
        return Err(LocalArchiveReadError::MemberOutOfBounds);
    }
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(data_offset))?;
    Ok((file, archive_size))
}

fn update_crc32(mut state: u32, bytes: &[u8]) -> u32 {
    for byte in bytes {
        state ^= u32::from(*byte);
        for _ in 0..8 {
            state = if state & 1 != 0 { (state >> 1) ^ 0xedb8_8320 } else { state >> 1 };
        }
    }
    state
}

fn copy_member_data(reader: &mut impl Read, output: &mut impl Write) -> Result<(u64, u32), LocalArchiveReadError> {
    let mut buffer = vec![0; ARCHIVE_COPY_BUFFER_SIZE];
    let mut total = 0_u64;
    let mut crc = u32::MAX;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok((total, !crc));
        }
        output.write_all(&buffer[..read])?;
        total = total
            .checked_add(read as u64)
            .ok_or(LocalArchiveReadError::MemberIntegrityFailure)?;
        crc = update_crc32(crc, &buffer[..read]);
    }
}

/// Stream one parser-validated local member without staging archive or payload bytes.
pub fn stream_local_archive_member(archive_path: &Path, member_path: &str, output: &mut impl Write) -> Result<(), LocalArchiveReadError> {
    let entry = validate_local_archive_member(archive_path, member_path)?;
    let (file, _) = member_data_offset(archive_path, &entry)?;
    let (written, crc32) = match entry.compression_method {
        0 => {
            let mut reader = file.take(entry.compressed_size);
            copy_member_data(&mut reader, output)?
        }
        8 => {
            let reader = file.take(entry.compressed_size);
            let mut decoder = DeflateDecoder::new(reader);
            let result = copy_member_data(&mut decoder, output)?;
            if decoder.into_inner().limit() != 0 {
                return Err(LocalArchiveReadError::MemberIntegrityFailure);
            }
            result
        }
        12 => {
            let reader = file.take(entry.compressed_size);
            let mut decoder = BzDecoder::new(reader);
            let result = copy_member_data(&mut decoder, output)?;
            if decoder.into_inner().limit() != 0 {
                return Err(LocalArchiveReadError::MemberIntegrityFailure);
            }
            result
        }
        _ => return Err(LocalArchiveReadError::UnavailableMember),
    };
    if written != entry.uncompressed_size || crc32 != entry.crc32 {
        return Err(LocalArchiveReadError::MemberIntegrityFailure);
    }
    Ok(())
}

/// Validate every entry that a mixed-executor extraction will relay.
///
/// Unlike direct local extraction, mixed extraction does not silently skip
/// unreadable entries because the remote destination cannot be rolled back.
pub fn validate_local_archive_extraction(archive_path: &Path) -> Result<Vec<LocalArchiveReadEntry>, LocalArchiveError> {
    let entries = read_local_archive_entries(archive_path)?;
    if entries.iter().any(|entry| !entry.is_safe) {
        return Err(LocalArchiveError::UnsafeEntryPath);
    }
    if entries.iter().any(|entry| !entry.has_supported_file_type) {
        return Err(LocalArchiveError::UnsupportedArchiveMember);
    }
    validate_extraction_output_paths(&entries)?;
    for entry in entries.iter().filter(|entry| !entry.is_directory) {
        validate_local_archive_member(archive_path, &entry.path)?;
    }
    Ok(entries)
}

/// Extract local archive members until completion or the next unresolved file collision.
pub fn extract_local_archive_with_checkpoint_and_progress(
    drive_root: &Path,
    archive_path: &Path,
    destination_path: &Path,
    mut checkpoint: LocalArchiveExtractionCheckpoint,
    is_cancelled: impl Fn() -> bool,
    mut on_progress: impl FnMut(LocalArchiveExtractionResult),
) -> Result<LocalArchiveExtractionRunResult, LocalArchiveError> {
    if is_cancelled() {
        return Err(LocalArchiveError::Cancelled);
    }
    let source_identity = local_archive_source_identity(archive_path)?;
    match checkpoint.source_identity.as_ref() {
        Some(identity) if identity != &source_identity => return Err(LocalArchiveError::ArchiveSourceChanged),
        Some(_) => {}
        None => checkpoint.source_identity = Some(source_identity),
    }
    let entries = read_local_archive_entries(archive_path)?;
    if entries.iter().any(|entry| !entry.is_safe) {
        return Err(LocalArchiveError::UnsafeEntryPath);
    }
    if entries.iter().any(|entry| !entry.has_supported_file_type) {
        return Err(LocalArchiveError::UnsupportedArchiveMember);
    }
    validate_extraction_output_paths(&entries)?;
    validate_checkpointed_extraction_output_paths(&entries, &checkpoint)?;
    let discovered_manifest = ArchiveExtractionManifest::from_entries(
        entries
            .iter()
            .map(|entry| ArchiveExtractionManifestMember {
                path: entry.path.clone(),
                is_directory: entry.is_directory,
                uncompressed_size: entry.uncompressed_size,
                modified_at: entry.modified_at,
            })
            .collect(),
    )?;
    let manifest = match checkpoint.manifest.as_ref() {
        Some(manifest) if manifest != &discovered_manifest => return Err(LocalArchiveError::ArchiveSourceChanged),
        Some(manifest) => manifest.clone(),
        None => {
            checkpoint.manifest = Some(discovered_manifest.clone());
            discovered_manifest
        }
    };
    let execution_plan = LocalArchiveExtractionExecutionPlan::from_manifest(manifest, checkpoint)?;
    let manifest = execution_plan.manifest.clone();
    let mut checkpoint = execution_plan.into_checkpoint();

    (|| {
        let destination_created = create_local_extraction_root(drive_root, destination_path)?;
        if destination_created {
            checkpoint.destination_root_created = true;
        }
        on_progress(checkpoint.result());

        for entry in entries {
            if is_cancelled() {
                return Err(LocalArchiveError::Cancelled);
            }
            if checkpoint.is_completed(&entry.path) {
                continue;
            }
            if entry.is_directory {
                let target_path = checkpoint.target_path(&entry.path);
                let renamed = target_path != entry.path;
                if let Some(collision) = extraction_directory_collision(destination_path, &entry.path, true, &checkpoint)? {
                    on_progress(checkpoint.result());
                    return Ok(LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision });
                }
                let directories_created = ensure_extraction_directory(drive_root, destination_path, &destination_path.join(&target_path))?;
                checkpoint.record_destination_result(LocalArchiveExtractionDestinationResult {
                    renamed,
                    member_path: entry.path,
                    status: LocalArchiveExtractionDestinationStatus::Directory,
                    target_path,
                    extracted_bytes: 0,
                    directories_created,
                    replaced: false,
                })?;
                on_progress(checkpoint.result());
                continue;
            }
            if entry.encrypted || !matches!(entry.compression_method, 0 | 8 | 12) {
                let target_path = checkpoint.target_path(&entry.path);
                let renamed = target_path != entry.path;
                checkpoint.record_destination_result(LocalArchiveExtractionDestinationResult {
                    member_path: entry.path,
                    status: LocalArchiveExtractionDestinationStatus::Skipped,
                    renamed,
                    target_path,
                    extracted_bytes: 0,
                    directories_created: 0,
                    replaced: false,
                })?;
                on_progress(checkpoint.result());
                continue;
            }

            let target_path = checkpoint.target_path(&entry.path);
            let output_path = destination_path.join(&target_path);
            let parent = output_path.parent().ok_or(LocalArchiveError::TargetOutsideRoot)?;
            if let Some(collision) = extraction_directory_collision(destination_path, &entry.path, false, &checkpoint)? {
                on_progress(checkpoint.result());
                return Ok(LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision });
            }
            let parent_directories_created = ensure_extraction_directory(drive_root, destination_path, parent)?;
            let reopen_partial = checkpoint.has_partial_member(&entry.path)
                && fs::symlink_metadata(&output_path)
                    .map(|metadata| metadata.file_type().is_file())
                    .unwrap_or(false);
            let mut replaced = false;
            if output_path.exists() && !reopen_partial {
                match checkpoint.collision_action(&entry.path) {
                    None => {
                        let target_path = checkpoint.target_path(&entry.path);
                        on_progress(checkpoint.result());
                        return Ok(LocalArchiveExtractionRunResult::AwaitingCollision {
                            checkpoint,
                            collision: LocalArchiveExtractionCollision {
                                member_path: entry.path.clone(),
                                target_path,
                                is_directory: false,
                            },
                        });
                    }
                    Some(LocalArchiveExtractionCollisionAction::Skip) => {
                        checkpoint.record_destination_result(LocalArchiveExtractionDestinationResult {
                            member_path: entry.path,
                            status: LocalArchiveExtractionDestinationStatus::Skipped,
                            target_path,
                            extracted_bytes: 0,
                            directories_created: 0,
                            replaced: false,
                            renamed: false,
                        })?;
                        on_progress(checkpoint.result());
                        continue;
                    }
                    Some(LocalArchiveExtractionCollisionAction::ReplaceOlder) => {
                        let source_is_newer = entry.modified_at.is_some_and(|source| {
                            fs::metadata(&output_path)
                                .ok()
                                .and_then(|metadata| metadata.modified().ok())
                                .map(DateTime::<Utc>::from)
                                .is_some_and(|target| source > target)
                        });
                        if !source_is_newer {
                            checkpoint.record_destination_result(LocalArchiveExtractionDestinationResult {
                                member_path: entry.path,
                                status: LocalArchiveExtractionDestinationStatus::Skipped,
                                target_path,
                                extracted_bytes: 0,
                                directories_created: 0,
                                replaced: false,
                                renamed: false,
                            })?;
                            on_progress(checkpoint.result());
                            continue;
                        }
                        revalidate_target_parent(drive_root, &output_path)?;
                        if !fs::symlink_metadata(&output_path)?.file_type().is_file() {
                            return Err(LocalArchiveError::UnsupportedSource);
                        }
                        fs::remove_file(&output_path)?;
                        replaced = true;
                    }
                    Some(LocalArchiveExtractionCollisionAction::Replace) => {
                        revalidate_target_parent(drive_root, &output_path)?;
                        if !fs::symlink_metadata(&output_path)?.file_type().is_file() {
                            return Err(LocalArchiveError::UnsupportedSource);
                        }
                        fs::remove_file(&output_path)?;
                        replaced = true;
                    }
                }
            }
            let member_result = (|| {
                let mut output = if reopen_partial {
                    reopen_partial_local_extraction_file(drive_root, &output_path)?
                } else {
                    open_local_extraction_file(drive_root, &output_path)?
                };
                stream_local_archive_member(archive_path, &entry.path, &mut output)?;
                output.flush()?;
                if let Some(modified_at) = entry.modified_at {
                    output.set_modified(modified_at.into())?;
                }
                Ok(())
            })();
            if let Err(error) = member_result {
                if matches!(error, LocalArchiveError::Cancelled) {
                    return Err(LocalArchiveError::Cancelled);
                }
                let partial_output = fs::symlink_metadata(&output_path)
                    .map(|metadata| metadata.file_type().is_file())
                    .unwrap_or(false);
                if partial_output {
                    checkpoint.record_partial_member(entry.path.clone(), parent_directories_created);
                }
                on_progress(checkpoint.result());
                return Ok(LocalArchiveExtractionRunResult::AwaitingMemberError {
                    checkpoint,
                    error: LocalArchiveExtractionMemberError {
                        member_path: entry.path,
                        target_path,
                        message: error.to_string(),
                        partial_output,
                    },
                });
            }
            let partial_directories_created = checkpoint.clear_partial_member(&entry.path);
            checkpoint.record_destination_result(LocalArchiveExtractionDestinationResult {
                renamed: target_path != entry.path,
                member_path: entry.path,
                status: LocalArchiveExtractionDestinationStatus::Extracted,
                target_path,
                extracted_bytes: entry.uncompressed_size,
                directories_created: parent_directories_created.saturating_add(partial_directories_created),
                replaced,
            })?;
            on_progress(checkpoint.result());
        }
        let terminal_plan = LocalArchiveExtractionExecutionPlan::from_manifest(manifest, checkpoint.clone())?;
        if !terminal_plan.has_complete_terminal_coverage() {
            return Err(LocalArchiveError::IncompleteExtractionManifest);
        }
        Ok(LocalArchiveExtractionRunResult::Completed(checkpoint))
    })()
    .map_err(|error| match error {
        LocalArchiveError::Cancelled => LocalArchiveError::Cancelled,
        error => LocalArchiveError::PartialOutput(Box::new(error)),
    })
}

fn validate_extraction_output_paths(entries: &[LocalArchiveReadEntry]) -> Result<(), LocalArchiveError> {
    let mut file_paths = HashSet::new();
    let mut directory_paths = HashSet::new();
    for entry in entries {
        let parts = entry.path.split('/').collect::<Vec<_>>();
        let directory_count = if entry.is_directory {
            parts.len()
        } else {
            parts.len().saturating_sub(1)
        };
        for index in 1..=directory_count {
            directory_paths.insert(collision_key(&parts[..index].join("/")));
        }
        if !entry.is_directory
            && !entry.encrypted
            && matches!(entry.compression_method, 0 | 8 | 12)
            && !file_paths.insert(collision_key(&entry.path))
        {
            return Err(LocalArchiveError::DuplicateEntryPath);
        }
    }
    if !file_paths.is_disjoint(&directory_paths) {
        return Err(LocalArchiveError::DuplicateEntryPath);
    }
    Ok(())
}

/// Validate that per-member renamed outputs remain safe and collision-free within the archive manifest.
pub fn validate_local_extraction_rename_target(
    archive_path: &Path,
    checkpoint: &LocalArchiveExtractionCheckpoint,
    member_path: &str,
    target_path: &str,
    is_directory: bool,
) -> Result<(), LocalArchiveError> {
    let normalized_target = normalized_archive_path(target_path, is_directory)?;
    let target_path = normalized_target.trim_end_matches('/');
    let member_path = member_path.trim_end_matches('/');
    if collision_key(member_path) == collision_key(target_path) {
        return Err(LocalArchiveError::DuplicateEntryPath);
    }
    let entries = read_local_archive_entries(archive_path)?;
    let is_known_member = if is_directory {
        archive_directory_paths(&entries).contains(member_path)
    } else {
        entries.iter().any(|entry| entry.path == member_path && !entry.is_directory)
    };
    if !is_known_member {
        return Err(LocalArchiveError::UnsupportedSource);
    }
    let mut candidate = checkpoint.clone();
    candidate.rename_member(member_path.to_string(), target_path.to_string());
    validate_checkpointed_extraction_output_paths(&entries, &candidate)
}

fn archive_directory_paths(entries: &[LocalArchiveReadEntry]) -> HashSet<String> {
    let mut directories = HashSet::new();
    for entry in entries {
        if entry.is_directory {
            directories.insert(entry.path.trim_end_matches('/').to_string());
        }
        let parts = entry.path.trim_end_matches('/').split('/').collect::<Vec<_>>();
        let directory_count = if entry.is_directory {
            parts.len()
        } else {
            parts.len().saturating_sub(1)
        };
        for index in 1..=directory_count {
            directories.insert(parts[..index].join("/"));
        }
    }
    directories
}

fn validate_checkpointed_extraction_output_paths(
    entries: &[LocalArchiveReadEntry],
    checkpoint: &LocalArchiveExtractionCheckpoint,
) -> Result<(), LocalArchiveError> {
    let mut file_paths = HashSet::new();
    let mut directory_paths = HashSet::new();
    for entry in entries {
        let target_path = checkpoint.target_path(&entry.path);
        let parts = target_path.split('/').collect::<Vec<_>>();
        let directory_count = if entry.is_directory {
            parts.len()
        } else {
            parts.len().saturating_sub(1)
        };
        for index in 1..=directory_count {
            directory_paths.insert(collision_key(&parts[..index].join("/")));
        }
        if !entry.is_directory
            && !entry.encrypted
            && matches!(entry.compression_method, 0 | 8 | 12)
            && !file_paths.insert(collision_key(&target_path))
        {
            return Err(LocalArchiveError::DuplicateEntryPath);
        }
    }
    if !file_paths.is_disjoint(&directory_paths) {
        return Err(LocalArchiveError::DuplicateEntryPath);
    }
    Ok(())
}

fn extraction_directory_collision(
    destination_path: &Path,
    member_path: &str,
    is_directory: bool,
    checkpoint: &LocalArchiveExtractionCheckpoint,
) -> Result<Option<LocalArchiveExtractionCollision>, LocalArchiveError> {
    let parts = member_path.trim_end_matches('/').split('/').collect::<Vec<_>>();
    let directory_count = if is_directory { parts.len() } else { parts.len().saturating_sub(1) };
    for index in 1..=directory_count {
        let source_path = parts[..index].join("/");
        let target_path = checkpoint.target_path(&source_path);
        match fs::symlink_metadata(destination_path.join(&target_path)) {
            Ok(metadata) if !metadata.file_type().is_dir() => {
                return Ok(Some(LocalArchiveExtractionCollision {
                    member_path: source_path,
                    target_path,
                    is_directory: true,
                }));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(LocalArchiveError::Io(error)),
        }
    }
    Ok(None)
}

fn ensure_extraction_directory(drive_root: &Path, destination_path: &Path, directory_path: &Path) -> Result<u64, LocalArchiveError> {
    let relative_path = directory_path
        .strip_prefix(destination_path)
        .map_err(|_| LocalArchiveError::TargetOutsideRoot)?;
    let mut created = 0;
    let mut current = destination_path.to_path_buf();
    for segment in relative_path.components() {
        current.push(segment);
        if current.exists() {
            if !current.is_dir() {
                return Err(LocalArchiveError::UnsupportedSource);
            }
            continue;
        }
        revalidate_target_parent(drive_root, &current)?;
        fs::create_dir(&current)?;
        created += 1;
    }
    Ok(created)
}

/// Create an extraction root when absent, or validate an existing directory.
pub fn create_local_extraction_root(drive_root: &Path, destination_path: &Path) -> Result<bool, LocalArchiveError> {
    if destination_path.exists() {
        return if destination_path.is_dir() {
            Ok(false)
        } else {
            Err(LocalArchiveError::ExtractionTargetExists)
        };
    }
    revalidate_target_parent(drive_root, destination_path)?;
    fs::create_dir(destination_path)?;
    Ok(true)
}

/// Create required local descendants under an already-owned extraction root.
pub fn ensure_local_extraction_directory(
    drive_root: &Path,
    destination_path: &Path,
    directory_path: &Path,
) -> Result<u64, LocalArchiveError> {
    ensure_extraction_directory(drive_root, destination_path, directory_path)
}

/// Open one new local output file after revalidating containment and parents.
pub fn open_local_extraction_file(drive_root: &Path, destination_path: &Path) -> Result<FsFile, LocalArchiveError> {
    revalidate_target_parent(drive_root, destination_path)?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination_path)
        .map_err(LocalArchiveError::Io)
}

/// Reopen the known partial target of a failed member without broad overwrite permission.
pub fn reopen_partial_local_extraction_file(drive_root: &Path, destination_path: &Path) -> Result<FsFile, LocalArchiveError> {
    revalidate_target_parent(drive_root, destination_path)?;
    OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(destination_path)
        .map_err(LocalArchiveError::Io)
}

/// Validate a manifest member path before combining it with a local destination root.
pub fn validate_local_extraction_member_path(member_path: &str, is_directory: bool) -> Result<(), LocalArchiveError> {
    normalized_archive_path(member_path, is_directory).map(|_| ())
}

fn normalized_archive_path(value: &str, is_directory: bool) -> Result<String, LocalArchiveError> {
    let path = value.replace('\\', "/");
    if path.is_empty() || path.starts_with('/') || path.contains('\0') {
        return Err(LocalArchiveError::UnsafeEntryPath);
    }
    let path = path.trim_end_matches('/');
    if path.is_empty()
        || path
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | "..") || segment.contains(':'))
    {
        return Err(LocalArchiveError::UnsafeEntryPath);
    }
    Ok(if is_directory { format!("{path}/") } else { path.to_owned() })
}

fn collision_key(path: &str) -> String {
    path.trim_end_matches('/').nfc().case_fold().collect()
}

fn normalized_source_modified_at(metadata: &fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
        .map(|timestamp| timestamp.to_rfc3339_opts(SecondsFormat::Secs, false))
}

fn normalize_creation_source_modified_at(source_modified_at: Option<String>) -> Result<Option<String>, LocalArchiveError> {
    source_modified_at
        .map(|timestamp| {
            DateTime::parse_from_rfc3339(&timestamp)
                .map(|timestamp| timestamp.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Secs, false))
                .map_err(|_| LocalArchiveError::InvalidCreationOutcome)
        })
        .transpose()
}

fn source_name(path: &Path) -> Result<String, LocalArchiveError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or(LocalArchiveError::UnsafeEntryPath)
}

/// Build a complete recursive manifest from selected local sources.
pub fn build_local_archive_manifest(source_paths: &[PathBuf], target_path: &Path) -> Result<Vec<LocalArchiveEntry>, LocalArchiveError> {
    build_local_archive_manifest_with_cancellation(source_paths, target_path, || false)
}

/// Build a complete recursive manifest while checking for cooperative cancellation.
pub fn build_local_archive_manifest_with_cancellation(
    source_paths: &[PathBuf],
    target_path: &Path,
    is_cancelled: impl Fn() -> bool,
) -> Result<Vec<LocalArchiveEntry>, LocalArchiveError> {
    if is_cancelled() {
        return Err(LocalArchiveError::Cancelled);
    }
    if target_path.exists() {
        return Err(LocalArchiveError::TargetExists);
    }
    build_local_archive_manifest_inner(source_paths, Some(target_path), &is_cancelled)
}

/// Build a complete recursive manifest for a ZIP target owned by another provider.
pub fn build_local_archive_manifest_for_remote_target(source_paths: &[PathBuf]) -> Result<Vec<LocalArchiveEntry>, LocalArchiveError> {
    build_local_archive_manifest_inner(source_paths, None, &|| false)
}

fn build_local_archive_manifest_inner<F: Fn() -> bool>(
    source_paths: &[PathBuf],
    target_path: Option<&Path>,
    is_cancelled: &F,
) -> Result<Vec<LocalArchiveEntry>, LocalArchiveError> {
    let mut entries = Vec::new();
    let mut names = HashSet::new();

    fn visit<F: Fn() -> bool>(
        source_path: &Path,
        archive_path: &str,
        target_path: Option<&Path>,
        entries: &mut Vec<LocalArchiveEntry>,
        names: &mut HashSet<String>,
        is_cancelled: &F,
    ) -> Result<(), LocalArchiveError> {
        if is_cancelled() {
            return Err(LocalArchiveError::Cancelled);
        }
        let metadata = fs::symlink_metadata(source_path)?;
        let is_directory = metadata.file_type().is_dir();
        if !is_directory && !metadata.file_type().is_file() {
            return Err(LocalArchiveError::UnsupportedSource);
        }
        if is_directory && target_path.is_some_and(|target| target.starts_with(source_path)) {
            return Err(LocalArchiveError::TargetInsideSource);
        }
        let archive_path = normalized_archive_path(archive_path, is_directory)?;
        if !names.insert(collision_key(&archive_path)) {
            return Err(LocalArchiveError::DuplicateEntryPath);
        }
        entries.push(LocalArchiveEntry {
            source_path: source_path.to_owned(),
            archive_path: archive_path.clone(),
            is_directory,
            source_size: if is_directory { 0 } else { metadata.len() },
            source_modified_at: normalized_source_modified_at(&metadata),
        });
        if !is_directory {
            return Ok(());
        }

        let mut children = fs::read_dir(source_path)?.collect::<Result<Vec<_>, _>>()?;
        children.sort_by_key(|child| collision_key(&child.file_name().to_string_lossy()));
        for child in children {
            let child_name = child.file_name().to_string_lossy().into_owned();
            visit(
                &child.path(),
                &format!("{}{child_name}", archive_path),
                target_path,
                entries,
                names,
                is_cancelled,
            )?;
        }
        Ok(())
    }

    for source_path in source_paths {
        visit(
            source_path,
            &source_name(source_path)?,
            target_path,
            &mut entries,
            &mut names,
            is_cancelled,
        )?;
    }
    if entries.is_empty() {
        return Err(LocalArchiveError::UnsupportedSource);
    }
    Ok(entries)
}

/// Project adapter-enumerated local entries into the immutable creation manifest before writing.
pub fn project_local_archive_creation_manifest(entries: &[LocalArchiveEntry]) -> Result<ArchiveCreationManifest, LocalArchiveError> {
    ArchiveCreationManifest::from_entries(
        entries
            .iter()
            .map(|entry| ArchiveCreationManifestMember {
                archive_path: entry.archive_path.clone(),
                is_directory: entry.is_directory,
                source_size: entry.source_size,
                source_modified_at: entry.source_modified_at.clone(),
            })
            .collect(),
    )
}

fn validate_local_archive_manifest_entries(
    entries: &[LocalArchiveEntry],
    manifest: &ArchiveCreationManifest,
) -> Result<(), LocalArchiveError> {
    if entries.len() != manifest.entries.len()
        || entries.iter().zip(&manifest.entries).any(|(entry, member)| {
            entry.archive_path.trim_end_matches('/') != member.archive_path
                || entry.is_directory != member.is_directory
                || entry.source_size != member.source_size
                || entry.source_modified_at != member.source_modified_at
        })
    {
        return Err(LocalArchiveError::InvalidCreationOutcome);
    }
    Ok(())
}

/// Create a ZIP directly at a previously non-existent local output path.
pub fn create_local_archive(
    drive_root: &Path,
    target_path: &Path,
    entries: &[LocalArchiveEntry],
    is_cancelled: impl Fn() -> bool,
) -> Result<LocalArchiveCreationResult, LocalArchiveError> {
    create_local_archive_with_cancellation_and_progress(drive_root, target_path, entries, is_cancelled, |_| {})
}

/// Create a local ZIP while publishing committed source-member progress.
pub fn create_local_archive_with_cancellation_and_progress(
    drive_root: &Path,
    target_path: &Path,
    entries: &[LocalArchiveEntry],
    is_cancelled: impl Fn() -> bool,
    on_progress: impl FnMut(LocalArchiveCreationResult),
) -> Result<LocalArchiveCreationResult, LocalArchiveError> {
    create_local_archive_with_cancellation_progress_and_state(drive_root, target_path, entries, is_cancelled, on_progress)
        .map(|(result, _state)| result)
}

/// Create a local ZIP while retaining its immutable manifest and outcome ledger.
pub fn create_local_archive_with_cancellation_progress_and_state(
    drive_root: &Path,
    target_path: &Path,
    entries: &[LocalArchiveEntry],
    is_cancelled: impl Fn() -> bool,
    on_progress: impl FnMut(LocalArchiveCreationResult),
) -> Result<(LocalArchiveCreationResult, ArchiveCreationManifestState), LocalArchiveError> {
    revalidate_target_parent(drive_root, target_path)?;
    let manifest = project_local_archive_creation_manifest(entries)?;
    let output = OpenOptions::new().write(true).create_new(true).open(target_path)?;
    let (result, state) =
        write_local_archive_stream_with_manifest(output, entries, manifest, &is_cancelled, on_progress).map_err(|error| match error {
            LocalArchiveError::Cancelled => LocalArchiveError::Cancelled,
            error => LocalArchiveError::PartialArchiveOutput(Box::new(error)),
        })?;
    if is_cancelled() {
        return Err(LocalArchiveError::Cancelled);
    }
    read_local_archive_entries(target_path).map_err(|error| LocalArchiveError::PartialArchiveOutput(Box::new(error.into())))?;
    Ok((result, state))
}

/// Write a portable ZIP while retaining the immutable manifest and committed outcomes.
/// Write a portable ZIP from a preflight manifest and its local source adapter entries.
pub fn write_local_archive_stream_with_manifest<W: Write>(
    output: W,
    entries: &[LocalArchiveEntry],
    manifest: ArchiveCreationManifest,
    is_cancelled: impl Fn() -> bool,
    on_progress: impl FnMut(LocalArchiveCreationResult),
) -> Result<(LocalArchiveCreationResult, ArchiveCreationManifestState), LocalArchiveError> {
    write_local_archive_stream_with_execution_plan(
        output,
        entries,
        LocalArchiveCreationExecutionPlan::from_manifest(manifest),
        is_cancelled,
        on_progress,
    )
}

/// Write a portable ZIP from an immutable execution plan and local source adapter entries.
pub fn write_local_archive_stream_with_execution_plan<W: Write>(
    output: W,
    entries: &[LocalArchiveEntry],
    execution_plan: LocalArchiveCreationExecutionPlan,
    is_cancelled: impl Fn() -> bool,
    mut on_progress: impl FnMut(LocalArchiveCreationResult),
) -> Result<(LocalArchiveCreationResult, ArchiveCreationManifestState), LocalArchiveError> {
    validate_local_archive_manifest_entries(entries, &execution_plan.manifest)?;
    (|| {
        let mut writer = ZipWriter::new_stream(output);
        let mut state = execution_plan.into_state();
        let manifest_entries = state.manifest.entries.clone();
        let mut buffer = vec![0; ARCHIVE_COPY_BUFFER_SIZE];

        on_progress(state.progress()?);

        for (entry, manifest_entry) in entries.iter().zip(&manifest_entries) {
            if is_cancelled() {
                return Err(LocalArchiveError::Cancelled);
            }
            if entry.is_directory {
                writer.add_directory(normalized_archive_path(&manifest_entry.archive_path, true)?, directory_options())?;
                state.record_expected(&manifest_entry.archive_path)?;
                on_progress(state.progress()?);
                continue;
            }
            let mut source = FsFile::open(&entry.source_path)?;
            let probe_size = source.read(&mut buffer)?;
            writer.start_file(
                normalized_archive_path(&manifest_entry.archive_path, false)?,
                regular_file_options(&buffer[..probe_size])?,
            )?;
            writer.write_all(&buffer[..probe_size])?;
            let mut source_bytes = probe_size as u64;
            loop {
                if is_cancelled() {
                    return Err(LocalArchiveError::Cancelled);
                }
                let read = source.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                writer.write_all(&buffer[..read])?;
                source_bytes = source_bytes
                    .checked_add(read as u64)
                    .ok_or_else(|| LocalArchiveError::Io(std::io::Error::other("Archive source size overflow")))?;
            }
            if source_bytes != manifest_entry.source_size {
                return Err(LocalArchiveError::InvalidCreationOutcome);
            }
            state.record_expected(&manifest_entry.archive_path)?;
            on_progress(state.progress()?);
        }

        let mut output = writer.finish()?;
        output.flush()?;
        let result = state.terminal_summary()?;
        Ok((result, state))
    })()
}

fn directory_options() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
}

fn regular_file_options(probe: &[u8]) -> Result<SimpleFileOptions, LocalArchiveError> {
    let method = if should_store(probe)? {
        CompressionMethod::Stored
    } else {
        CompressionMethod::Deflated
    };
    Ok(SimpleFileOptions::default()
        .compression_method(method)
        .compression_level((method == CompressionMethod::Deflated).then_some(6)))
}

fn should_store(probe: &[u8]) -> Result<bool, LocalArchiveError> {
    if probe.is_empty() {
        return Ok(true);
    }
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::new(6));
    encoder.write_all(probe)?;
    let compressed_size = encoder.finish()?.len();
    let savings = probe.len().saturating_sub(compressed_size);
    Ok(savings < STORED_SAVINGS_BYTES && (savings as f64 / probe.len() as f64) < STORED_SAVINGS_RATIO)
}

type CompressionProbe = (Vec<u8>, Option<Vec<u8>>, bool);

fn receive_compression_probe(chunks: &mut Receiver<LocalArchiveRelayChunk>) -> Result<CompressionProbe, LocalArchiveError> {
    let mut probe = Vec::with_capacity(ARCHIVE_COPY_BUFFER_SIZE);
    while probe.len() < ARCHIVE_COPY_BUFFER_SIZE {
        match chunks.blocking_recv() {
            Some(LocalArchiveRelayChunk::Data(chunk)) => {
                if chunk.len() > ARCHIVE_COPY_BUFFER_SIZE {
                    return Err(LocalArchiveError::Io(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Archive source relay chunk exceeds the configured bound",
                    )));
                }
                let remaining = ARCHIVE_COPY_BUFFER_SIZE - probe.len();
                if chunk.len() <= remaining {
                    probe.extend_from_slice(&chunk);
                    continue;
                }
                probe.extend_from_slice(&chunk[..remaining]);
                return Ok((probe, Some(chunk[remaining..].to_vec()), false));
            }
            Some(LocalArchiveRelayChunk::Complete) => return Ok((probe, None, true)),
            Some(LocalArchiveRelayChunk::Failed) => {
                return Err(LocalArchiveError::Io(std::io::Error::other("Archive source relay failed")));
            }
            None => {
                return Err(LocalArchiveError::Io(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "Archive source relay ended before completion",
                )));
            }
        }
    }
    Ok((probe, None, false))
}

/// Create a new local ZIP target that receives source bytes through bounded relay channels.
pub fn create_local_archive_relay_writer(
    drive_root: &Path,
    target_path: &Path,
    manifest: ArchiveCreationManifest,
) -> Result<LocalArchiveRelayWriter, LocalArchiveError> {
    if target_path.exists() {
        return Err(LocalArchiveError::TargetExists);
    }
    revalidate_target_parent(drive_root, target_path)?;
    let output = OpenOptions::new().write(true).create_new(true).open(target_path)?;
    Ok(LocalArchiveRelayWriter {
        writer: ZipWriter::new_stream(output),
        manifest,
        next_manifest_index: 0,
    })
}

impl LocalArchiveRelayWriter {
    fn next_manifest_entry(&self, archive_path: &str, is_directory: bool) -> Result<(String, u64), LocalArchiveError> {
        let normalized_path = normalized_archive_path(archive_path, is_directory)?
            .trim_end_matches('/')
            .to_string();
        let entry = self
            .manifest
            .entries
            .get(self.next_manifest_index)
            .filter(|entry| entry.archive_path == normalized_path && entry.is_directory == is_directory)
            .ok_or(LocalArchiveError::InvalidCreationOutcome)?;
        Ok((entry.archive_path.clone(), entry.source_size))
    }

    /// Add one explicit directory entry to the local ZIP.
    pub fn add_directory(mut self, archive_path: &str) -> Result<Self, LocalArchiveError> {
        let (manifest_path, source_size) = self.next_manifest_entry(archive_path, true)?;
        if source_size != 0 {
            return Err(LocalArchiveError::InvalidCreationOutcome);
        }
        (|| {
            self.writer
                .add_directory(normalized_archive_path(&manifest_path, true)?, directory_options())?;
            self.next_manifest_index += 1;
            Ok(self)
        })()
        .map_err(|error| LocalArchiveError::PartialArchiveOutput(Box::new(error)))
    }

    /// Write one regular member from a bounded asynchronous-relay channel.
    pub fn write_file(mut self, archive_path: &str, mut chunks: Receiver<LocalArchiveRelayChunk>) -> Result<Self, LocalArchiveError> {
        let (manifest_path, expected_size) = self.next_manifest_entry(archive_path, false)?;
        (|| {
            let (probe, pending_chunk, source_completed) = receive_compression_probe(&mut chunks)?;
            self.writer
                .start_file(normalized_archive_path(&manifest_path, false)?, regular_file_options(&probe)?)?;
            self.writer.write_all(&probe)?;
            let mut written = probe.len() as u64;
            if let Some(chunk) = pending_chunk {
                self.writer.write_all(&chunk)?;
                written = written
                    .checked_add(chunk.len() as u64)
                    .ok_or_else(|| LocalArchiveError::Io(std::io::Error::other("Archive source size overflow")))?;
            }
            if !source_completed {
                loop {
                    match chunks.blocking_recv() {
                        Some(LocalArchiveRelayChunk::Data(chunk)) => {
                            self.writer.write_all(&chunk)?;
                            written = written
                                .checked_add(chunk.len() as u64)
                                .ok_or_else(|| LocalArchiveError::Io(std::io::Error::other("Archive source size overflow")))?;
                        }
                        Some(LocalArchiveRelayChunk::Complete) => break,
                        Some(LocalArchiveRelayChunk::Failed) => {
                            return Err(LocalArchiveError::Io(std::io::Error::other("Archive source relay failed")));
                        }
                        None => {
                            return Err(LocalArchiveError::Io(std::io::Error::new(
                                std::io::ErrorKind::UnexpectedEof,
                                "Archive source relay ended before completion",
                            )));
                        }
                    }
                }
            }
            if written != expected_size {
                return Err(LocalArchiveError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Archive source size does not match its manifest",
                )));
            }
            self.next_manifest_index += 1;
            Ok(self)
        })()
        .map_err(|error| LocalArchiveError::PartialArchiveOutput(Box::new(error)))
    }

    /// Finalize the ZIP central directory after all manifest members commit.
    pub fn finish(self) -> Result<(), LocalArchiveError> {
        if self.next_manifest_index != self.manifest.entries.len() {
            return Err(LocalArchiveError::InvalidCreationOutcome);
        }
        (|| {
            let mut output = self.writer.finish()?;
            output.flush()?;
            Ok(())
        })()
        .map_err(|error| LocalArchiveError::PartialArchiveOutput(Box::new(error)))
    }
}

fn revalidate_target_parent(drive_root: &Path, target_path: &Path) -> Result<(), LocalArchiveError> {
    let canonical_root = fs::canonicalize(drive_root)?;
    let parent = target_path.parent().ok_or(LocalArchiveError::TargetOutsideRoot)?;
    let canonical_parent = fs::canonicalize(parent)?;
    if !canonical_parent.starts_with(canonical_root) {
        return Err(LocalArchiveError::TargetOutsideRoot);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::fs;
    use std::io::{Read, Seek, SeekFrom, Write};

    use serde::Deserialize;
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;
    use zip::ZipArchive;

    use super::*;

    #[derive(Deserialize)]
    struct ConformanceManifest {
        version: u8,
        fixtures: Vec<ConformanceFixture>,
    }

    #[derive(Deserialize)]
    struct ConformanceFixture {
        name: String,
        sha256: String,
        entries: Vec<ConformanceEntry>,
        expected_error: Option<String>,
    }

    #[derive(Deserialize)]
    struct ConformanceEntry {
        raw_name_hex: String,
        path: String,
        directory: bool,
        method: u16,
        uncompressed_size: u64,
        safe: bool,
        data_descriptor: bool,
        member_sha256: Option<String>,
    }

    #[derive(Deserialize)]
    struct ExtractionOutcomeConformanceCorpus {
        version: u8,
        #[serde(default)]
        behavioral_scenarios: Vec<ExtractionBehavioralConformanceScenario>,
        #[serde(default)]
        manifest_scenarios: Vec<ExtractionManifestConformanceScenario>,
        scenarios: Vec<ExtractionOutcomeConformanceScenario>,
    }

    #[derive(Deserialize)]
    struct ExtractionTrajectoryConformanceCorpus {
        version: u8,
        topologies: Vec<String>,
        scenarios: Vec<ExtractionTrajectoryConformanceScenario>,
    }

    #[derive(Clone, Deserialize)]
    struct ExtractionTrajectoryConformanceScenario {
        name: String,
        members: Vec<String>,
        existing_file_policy: Option<String>,
        steps: Vec<ExtractionTrajectoryStep>,
        terminal_phase: String,
        completed_members: Vec<String>,
        progress: std::collections::HashMap<String, u64>,
    }

    #[derive(Clone, Deserialize)]
    struct ExtractionTrajectoryStep {
        event: String,
        member_path: Option<String>,
        action: Option<String>,
        target_path: Option<String>,
        status: Option<String>,
        #[serde(default)]
        extracted_bytes: u64,
        #[serde(default)]
        replaced: bool,
        #[serde(default)]
        renamed: bool,
    }

    #[derive(Deserialize)]
    struct ExtractionManifestConformanceScenario {
        name: String,
        entries: Vec<ExtractionManifestConformanceEntry>,
        normalized_entries: Option<Vec<ExtractionManifestConformanceEntry>>,
        error: Option<String>,
    }

    #[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
    struct ExtractionManifestConformanceEntry {
        path: String,
        is_directory: bool,
        uncompressed_size: u64,
    }

    #[derive(Deserialize)]
    struct CreationOutcomeConformanceCorpus {
        version: u8,
        #[serde(default)]
        manifest_scenarios: Vec<CreationManifestConformanceScenario>,
        #[serde(default)]
        terminal_scenarios: Vec<CreationTerminalConformanceScenario>,
        scenarios: Vec<CreationOutcomeConformanceScenario>,
    }

    #[derive(Deserialize)]
    struct CreationManifestConformanceScenario {
        name: String,
        entries: Vec<CreationManifestConformanceEntry>,
        normalized_entries: Option<Vec<CreationManifestConformanceEntry>>,
        progress: Option<std::collections::HashMap<String, u64>>,
        error: Option<String>,
    }

    #[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
    struct CreationManifestConformanceEntry {
        archive_path: String,
        is_directory: bool,
        source_size: u64,
    }

    #[derive(Deserialize)]
    struct CreationTerminalConformanceScenario {
        name: String,
        entries: Vec<CreationManifestConformanceEntry>,
        result_reports: Vec<CreationOutcomeResultReport>,
        progress: Option<std::collections::HashMap<String, u64>>,
        error: Option<String>,
    }

    #[derive(Deserialize)]
    struct CreationOutcomeConformanceScenario {
        name: String,
        result_reports: Vec<CreationOutcomeResultReport>,
        member_outcomes: Option<std::collections::HashMap<String, CreationOutcomeExpected>>,
        progress: Option<std::collections::HashMap<String, u64>>,
        error: Option<String>,
    }

    #[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
    struct CreationOutcomeResultReport {
        archive_path: String,
        status: String,
        source_bytes: u64,
    }

    #[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
    struct CreationOutcomeExpected {
        status: String,
        source_bytes: u64,
    }

    #[derive(Deserialize)]
    struct CreationTrajectoryConformanceCorpus {
        version: u8,
        topologies: Vec<String>,
        scenarios: Vec<CreationTrajectoryConformanceScenario>,
    }

    #[derive(Deserialize)]
    struct CreationTrajectoryConformanceScenario {
        name: String,
        entries: Vec<CreationManifestConformanceEntry>,
        steps: Vec<CreationTrajectoryStep>,
        terminal_phase: String,
        completed_members: Vec<String>,
        progress: std::collections::HashMap<String, u64>,
    }

    #[derive(Deserialize)]
    struct CreationTrajectoryStep {
        event: String,
        archive_path: Option<String>,
        status: Option<String>,
        #[serde(default)]
        source_bytes: u64,
    }

    #[derive(Deserialize)]
    struct ExtractionBehavioralConformanceScenario {
        name: String,
        collision_action: Option<String>,
        rename_target: Option<String>,
        member_path: Option<String>,
        member_error_action: Option<String>,
        terminal_phase: String,
        #[serde(default)]
        progress: std::collections::HashMap<String, u64>,
    }

    #[derive(Deserialize)]
    struct ExtractionOutcomeConformanceScenario {
        name: String,
        #[serde(default)]
        result_reports: Vec<ExtractionOutcomeResultReport>,
        #[serde(default)]
        completed_members: Vec<String>,
        #[serde(default)]
        progress: std::collections::HashMap<String, u64>,
    }

    #[derive(Deserialize)]
    struct ExtractionOutcomeResultReport {
        member_path: String,
        status: String,
        target_path: String,
        #[serde(default)]
        extracted_bytes: u64,
        #[serde(default)]
        directories_created: u64,
        #[serde(default)]
        replaced: bool,
        #[serde(default)]
        renamed: bool,
    }

    fn conformance_corpus_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").join("archive_testdata")
    }

    fn extract_local_archive_to_new_directory(
        drive_root: &Path,
        archive_path: &Path,
        destination_path: &Path,
    ) -> Result<LocalArchiveExtractionResult, LocalArchiveError> {
        extract_local_archive_to_new_directory_with_cancellation(drive_root, archive_path, destination_path, || false)
    }

    fn extract_local_archive_to_new_directory_with_cancellation(
        drive_root: &Path,
        archive_path: &Path,
        destination_path: &Path,
        is_cancelled: impl Fn() -> bool,
    ) -> Result<LocalArchiveExtractionResult, LocalArchiveError> {
        extract_local_archive_to_new_directory_with_cancellation_and_progress(
            drive_root,
            archive_path,
            destination_path,
            is_cancelled,
            |_| {},
        )
    }

    fn extract_local_archive_to_new_directory_with_cancellation_and_progress(
        drive_root: &Path,
        archive_path: &Path,
        destination_path: &Path,
        is_cancelled: impl Fn() -> bool,
        on_progress: impl FnMut(LocalArchiveExtractionResult),
    ) -> Result<LocalArchiveExtractionResult, LocalArchiveError> {
        match extract_local_archive_with_checkpoint_and_progress(
            drive_root,
            archive_path,
            destination_path,
            LocalArchiveExtractionCheckpoint::default(),
            is_cancelled,
            on_progress,
        )? {
            LocalArchiveExtractionRunResult::Completed(checkpoint) => Ok(checkpoint.result()),
            LocalArchiveExtractionRunResult::AwaitingCollision { .. } => Err(LocalArchiveError::TargetExists),
            LocalArchiveExtractionRunResult::AwaitingMemberError { error, .. } => Err(LocalArchiveError::PartialOutput(Box::new(
                LocalArchiveError::Io(std::io::Error::other(error.message)),
            ))),
        }
    }

    #[test]
    fn rejects_unsafe_archive_entry_paths() {
        assert!(matches!(
            normalized_archive_path("../unsafe", false),
            Err(LocalArchiveError::UnsafeEntryPath)
        ));
        assert!(matches!(
            normalized_archive_path("C:/unsafe", false),
            Err(LocalArchiveError::UnsafeEntryPath)
        ));
    }

    #[test]
    fn uses_validated_infozip_unicode_path_for_unflagged_names() {
        let raw_name = b"cafe.txt";
        let unicode_name = "café.txt";
        let field_length = u16::try_from(1 + 4 + unicode_name.len()).unwrap();
        let mut extra = Vec::new();
        extra.extend_from_slice(&INFOZIP_UNICODE_PATH_FIELD_ID.to_le_bytes());
        extra.extend_from_slice(&field_length.to_le_bytes());
        extra.push(INFOZIP_UNICODE_PATH_VERSION);
        extra.extend_from_slice(&(!update_crc32(u32::MAX, raw_name)).to_le_bytes());
        extra.extend_from_slice(unicode_name.as_bytes());

        assert_eq!(decode_entry_name(raw_name, 0, &extra), unicode_name);
    }

    #[test]
    fn ignores_infozip_unicode_path_with_a_mismatched_crc() {
        let raw_name = b"cafe.txt";
        let unicode_name = "café.txt";
        let field_length = u16::try_from(1 + 4 + unicode_name.len()).unwrap();
        let mut extra = Vec::new();
        extra.extend_from_slice(&INFOZIP_UNICODE_PATH_FIELD_ID.to_le_bytes());
        extra.extend_from_slice(&field_length.to_le_bytes());
        extra.push(INFOZIP_UNICODE_PATH_VERSION);
        extra.extend_from_slice(&(!update_crc32(u32::MAX, raw_name) ^ 1).to_le_bytes());
        extra.extend_from_slice(unicode_name.as_bytes());

        assert_eq!(decode_entry_name(raw_name, 0, &extra), "cafe.txt");
    }

    #[test]
    fn decodes_unflagged_legacy_names_as_cp437() {
        assert_eq!(decode_entry_name(b"caf\x82.txt", 0, &[]), "café.txt");
    }

    #[test]
    fn passes_v1_zip_reader_conformance_corpus() {
        let corpus_root = conformance_corpus_root();
        let manifest: ConformanceManifest = serde_json::from_slice(&fs::read(corpus_root.join("manifest-v1.json")).unwrap()).unwrap();
        assert_eq!(manifest.version, 1);

        for fixture in manifest.fixtures {
            let fixture_path = corpus_root.join(&fixture.name);
            let fixture_data = fs::read(&fixture_path).unwrap();
            assert_eq!(hex::encode(Sha256::digest(fixture_data)), fixture.sha256);
            if fixture.expected_error.as_deref() == Some("format_error") {
                assert!(matches!(
                    read_local_archive_entries(&fixture_path),
                    Err(LocalArchiveReadError::TooSmall | LocalArchiveReadError::InvalidEndOfDirectory)
                ));
                continue;
            }
            let entries = read_local_archive_entries(&fixture_path).unwrap();
            assert_eq!(entries.len(), fixture.entries.len());
            for (entry, expected) in entries.iter().zip(fixture.entries) {
                assert_eq!(hex::encode(&entry.raw_name), expected.raw_name_hex);
                assert_eq!(entry.path, expected.path);
                assert_eq!(entry.is_directory, expected.directory);
                assert_eq!(entry.compression_method, expected.method);
                assert_eq!(entry.uncompressed_size, expected.uncompressed_size);
                assert_eq!(entry.is_safe, expected.safe);
                assert_eq!(entry.flags & 0x0008 != 0, expected.data_descriptor);
                if expected.safe {
                    if let Some(member_sha256) = expected.member_sha256 {
                        let mut member = Vec::new();
                        stream_local_archive_member(&fixture_path, &entry.path, &mut member).unwrap();
                        assert_eq!(hex::encode(Sha256::digest(member)), member_sha256);
                    }
                }
            }
        }
    }

    #[test]
    fn writes_directory_manifest_to_a_readable_zip() {
        let directory = tempdir().unwrap();
        let source_root = directory.path().join("source");
        fs::create_dir_all(source_root.join("empty")).unwrap();
        fs::write(source_root.join("notes.txt"), b"notes").unwrap();
        let target = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source_root], &target).unwrap();

        let result = create_local_archive(directory.path(), &target, &entries, || false).unwrap();

        assert_eq!(result.files_created, 1);
        assert_eq!(result.directories_created, 2);
        assert_eq!(read_local_archive_entries(&target).unwrap().len(), 3);
        let mut archive = ZipArchive::new(FsFile::open(&target).unwrap()).unwrap();
        assert_eq!(
            archive.file_names().collect::<Vec<_>>(),
            ["source/", "source/empty/", "source/notes.txt"]
        );
        let mut notes = String::new();
        archive.by_name("source/notes.txt").unwrap().read_to_string(&mut notes).unwrap();
        assert_eq!(notes, "notes");
    }

    #[test]
    fn cancels_manifest_enumeration_before_traversing_sources() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source");
        fs::create_dir(&source).unwrap();
        let target = directory.path().join("archive.zip");
        let cancellation_checks = std::cell::Cell::new(0);

        assert!(matches!(
            build_local_archive_manifest_with_cancellation(&[source], &target, || {
                let checks = cancellation_checks.get() + 1;
                cancellation_checks.set(checks);
                checks >= 2
            }),
            Err(LocalArchiveError::Cancelled)
        ));
        assert!(!target.exists());
    }

    #[test]
    fn writes_relayed_members_to_a_readable_zip_without_staging() {
        let directory = tempdir().unwrap();
        let target = directory.path().join("archive.zip");
        let manifest = ArchiveCreationManifest::from_entries(vec![ArchiveCreationManifestMember {
            archive_path: "notes.txt".to_string(),
            is_directory: false,
            source_size: 5,
            source_modified_at: None,
        }])
        .unwrap();
        let writer = create_local_archive_relay_writer(directory.path(), &target, manifest).unwrap();
        let (sender, receiver) = tokio::sync::mpsc::channel(2);
        sender.try_send(LocalArchiveRelayChunk::Data(b"notes".to_vec())).unwrap();
        sender.try_send(LocalArchiveRelayChunk::Complete).unwrap();
        writer.write_file("notes.txt", receiver).unwrap().finish().unwrap();
        let mut archive = ZipArchive::new(FsFile::open(&target).unwrap()).unwrap();
        let mut notes = String::new();
        archive.by_name("notes.txt").unwrap().read_to_string(&mut notes).unwrap();
        assert_eq!(notes, "notes");
        assert_eq!(validate_local_archive_member(&target, "notes.txt").unwrap().compression_method, 0);
    }

    #[test]
    fn deflates_compressible_relayed_members() {
        let directory = tempdir().unwrap();
        let target = directory.path().join("archive.zip");
        let content = vec![b'x'; ARCHIVE_COPY_BUFFER_SIZE];
        let manifest = ArchiveCreationManifest::from_entries(vec![ArchiveCreationManifestMember {
            archive_path: "notes.txt".to_string(),
            is_directory: false,
            source_size: content.len() as u64,
            source_modified_at: None,
        }])
        .unwrap();
        let writer = create_local_archive_relay_writer(directory.path(), &target, manifest).unwrap();
        let (sender, receiver) = tokio::sync::mpsc::channel(2);
        sender.try_send(LocalArchiveRelayChunk::Data(content.clone())).unwrap();
        sender.try_send(LocalArchiveRelayChunk::Complete).unwrap();

        writer.write_file("notes.txt", receiver).unwrap().finish().unwrap();

        assert_eq!(validate_local_archive_member(&target, "notes.txt").unwrap().compression_method, 8);
    }

    #[test]
    fn rejects_relay_members_that_do_not_match_the_preflight_manifest() {
        let directory = tempdir().unwrap();
        let target = directory.path().join("archive.zip");
        let manifest = ArchiveCreationManifest::from_entries(vec![ArchiveCreationManifestMember {
            archive_path: "notes.txt".to_string(),
            is_directory: false,
            source_size: 0,
            source_modified_at: None,
        }])
        .unwrap();
        let writer = create_local_archive_relay_writer(directory.path(), &target, manifest).unwrap();
        let (_sender, receiver) = tokio::sync::mpsc::channel(1);

        assert!(matches!(
            writer.write_file("unexpected.txt", receiver),
            Err(LocalArchiveError::InvalidCreationOutcome)
        ));
    }

    #[test]
    fn rejects_colliding_relay_manifest_before_opening_output() {
        assert!(matches!(
            ArchiveCreationManifest::from_entries(vec![
                ArchiveCreationManifestMember {
                    archive_path: "folder".to_string(),
                    is_directory: false,
                    source_size: 1,
                    source_modified_at: None,
                },
                ArchiveCreationManifestMember {
                    archive_path: "folder/child.txt".to_string(),
                    is_directory: false,
                    source_size: 1,
                    source_modified_at: None,
                },
            ]),
            Err(LocalArchiveError::DuplicateEntryPath)
        ));
    }

    #[test]
    fn reopens_only_an_existing_partial_extraction_file() {
        let directory = tempdir().unwrap();
        let target = directory.path().join("partial.txt");
        fs::write(&target, b"partial output").unwrap();

        let mut output = reopen_partial_local_extraction_file(directory.path(), &target).unwrap();
        output.write_all(b"complete").unwrap();
        output.flush().unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"complete");
        assert!(reopen_partial_local_extraction_file(directory.path(), &directory.path().join("missing.txt")).is_err());
    }

    #[test]
    fn reports_partial_archive_output_after_source_read_failure() {
        let directory = tempdir().unwrap();
        let target = directory.path().join("archive.zip");
        let entries = [LocalArchiveEntry {
            source_path: directory.path().join("missing.txt"),
            archive_path: "missing.txt".to_string(),
            is_directory: false,
            source_size: 0,
            source_modified_at: None,
        }];

        assert!(matches!(
            create_local_archive(directory.path(), &target, &entries, || false),
            Err(LocalArchiveError::PartialArchiveOutput(_))
        ));
        assert!(target.is_file());
    }

    #[test]
    fn rejects_local_source_entries_that_do_not_match_the_preflight_manifest() {
        let entries = [LocalArchiveEntry {
            source_path: PathBuf::from("source.txt"),
            archive_path: "source.txt".to_string(),
            is_directory: false,
            source_size: 1,
            source_modified_at: None,
        }];
        let manifest = ArchiveCreationManifest::from_entries(vec![ArchiveCreationManifestMember {
            archive_path: "different.txt".to_string(),
            is_directory: false,
            source_size: 1,
            source_modified_at: None,
        }])
        .unwrap();

        assert!(matches!(
            write_local_archive_stream_with_manifest(Vec::new(), &entries, manifest, || false, |_| {}),
            Err(LocalArchiveError::InvalidCreationOutcome)
        ));
    }

    #[test]
    fn cancels_archive_creation_before_finalization() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"source").unwrap();
        let target = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &target).unwrap();
        let cancellation_checks = std::cell::Cell::new(0);

        assert!(matches!(
            create_local_archive(directory.path(), &target, &entries, || {
                let checks = cancellation_checks.get() + 1;
                cancellation_checks.set(checks);
                checks >= 3
            }),
            Err(LocalArchiveError::Cancelled)
        ));
        assert!(target.is_file());
    }

    #[test]
    fn publishes_creation_progress_and_preserves_cancellation() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"source").unwrap();
        let target = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &target).unwrap();
        let mut progress = Vec::new();

        let result = create_local_archive_with_cancellation_and_progress(
            directory.path(),
            &target,
            &entries,
            || false,
            |update| progress.push(update),
        )
        .unwrap();

        assert_eq!(
            progress.first(),
            Some(&LocalArchiveCreationResult {
                files_created: 0,
                directories_created: 0,
                source_bytes: 0
            })
        );
        assert_eq!(progress.last(), Some(&result));

        let cancelled_target = directory.path().join("cancelled.zip");
        assert!(matches!(
            create_local_archive_with_cancellation_and_progress(directory.path(), &cancelled_target, &entries, || true, |_| {},),
            Err(LocalArchiveError::Cancelled)
        ));
        assert!(cancelled_target.is_file());
    }

    #[test]
    fn lists_safe_virtual_archive_directories_in_bounded_pages() {
        let directory = tempdir().unwrap();
        let source_root = directory.path().join("source");
        fs::create_dir_all(source_root.join("nested/empty")).unwrap();
        fs::write(source_root.join("alpha.txt"), b"alpha").unwrap();
        fs::write(source_root.join("nested/beta.txt"), b"beta").unwrap();
        let target = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source_root], &target).unwrap();
        create_local_archive(directory.path(), &target, &entries, || false).unwrap();

        let inspection = ArchiveInspectionCoordinator::from_archive_path(&target).unwrap();
        let first_page = inspection.list_directory("source/", None, 1).unwrap();
        assert_eq!(first_page.total, 2);
        assert_eq!(first_page.entries[0].name, "nested");
        assert!(first_page.entries[0].is_directory);
        assert_eq!(first_page.next_cursor.as_deref(), Some("1"));

        let second_page = inspection.list_directory("source/", first_page.next_cursor.as_deref(), 1).unwrap();
        assert_eq!(second_page.entries[0].name, "alpha.txt");
        assert_eq!(second_page.entries[0].uncompressed_size, Some(5));
        assert_eq!(second_page.next_cursor, None);
        assert!(matches!(
            inspection.list_directory("../unsafe/", None, 100),
            Err(LocalArchiveReadError::InvalidDirectoryPath)
        ));
    }

    #[test]
    fn streams_a_validated_deflate_member_without_staging() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("notes.txt");
        fs::write(&source, vec![b'x'; ARCHIVE_COPY_BUFFER_SIZE]).unwrap();
        let target = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &target).unwrap();
        create_local_archive(directory.path(), &target, &entries, || false).unwrap();

        let member = validate_local_archive_member(&target, "notes.txt").unwrap();
        assert_eq!(member.compression_method, 8);
        let mut output = Vec::new();
        stream_local_archive_member(&target, "notes.txt", &mut output).unwrap();
        assert_eq!(output, vec![b'x'; ARCHIVE_COPY_BUFFER_SIZE]);
        assert!(matches!(
            validate_local_archive_member(&target, "../notes.txt"),
            Err(LocalArchiveReadError::InvalidMemberPath)
        ));
    }

    #[test]
    fn stores_incompressible_members_after_a_bounded_probe() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("data.bin");
        let mut content = Vec::with_capacity(ARCHIVE_COPY_BUFFER_SIZE);
        let mut state = 0x4d595df4_u32;
        for _ in 0..ARCHIVE_COPY_BUFFER_SIZE {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            content.push((state >> 24) as u8);
        }
        fs::write(&source, &content).unwrap();
        let target = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &target).unwrap();

        create_local_archive(directory.path(), &target, &entries, || false).unwrap();

        let member = validate_local_archive_member(&target, "data.bin").unwrap();
        assert_eq!(member.compression_method, 0);
        let mut output = Vec::new();
        stream_local_archive_member(&target, "data.bin", &mut output).unwrap();
        assert_eq!(output, content);
    }

    #[test]
    fn extracts_members_to_a_new_directory_with_exclusive_outputs() {
        let directory = tempdir().unwrap();
        let source_root = directory.path().join("source");
        fs::create_dir_all(source_root.join("nested/empty")).unwrap();
        fs::write(source_root.join("nested/notes.txt"), b"extracted").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source_root], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let destination = directory.path().join("output");

        let result = extract_local_archive_to_new_directory(directory.path(), &archive_path, &destination).unwrap();

        assert_eq!(result.files_extracted, 1);
        assert_eq!(result.extracted_bytes, 9);
        let extracted_path = destination.join("source/nested/notes.txt");
        assert_eq!(fs::read(&extracted_path).unwrap(), b"extracted");
        let expected_modified_at = validate_local_archive_member(&archive_path, "source/nested/notes.txt")
            .unwrap()
            .modified_at
            .unwrap();
        assert_eq!(
            DateTime::<Utc>::from(fs::metadata(extracted_path).unwrap().modified().unwrap()),
            expected_modified_at
        );
        assert!(destination.join("source/nested/empty").is_dir());
        let existing_destination = directory.path().join("existing-output");
        fs::create_dir(&existing_destination).unwrap();
        let existing_result = extract_local_archive_to_new_directory(directory.path(), &archive_path, &existing_destination).unwrap();
        assert_eq!(existing_result.directories_created, 3);
        assert_eq!(
            fs::read(existing_destination.join("source/nested/notes.txt")).unwrap(),
            b"extracted"
        );
    }

    #[test]
    fn records_each_local_destination_result_only_once() {
        let mut checkpoint = LocalArchiveExtractionCheckpoint::default();
        let result = LocalArchiveExtractionDestinationResult {
            member_path: "source.txt".to_string(),
            status: LocalArchiveExtractionDestinationStatus::Extracted,
            target_path: "source.txt".to_string(),
            extracted_bytes: 6,
            directories_created: 1,
            replaced: false,
            renamed: false,
        };

        checkpoint.record_destination_result(result.clone()).unwrap();
        checkpoint.record_destination_result(result).unwrap();

        assert_eq!(
            checkpoint.result(),
            LocalArchiveExtractionResult {
                files_extracted: 1,
                directories_created: 1,
                extracted_bytes: 6,
                files_skipped: 0,
                files_replaced: 0,
                files_failed: 0,
                partial_members: 0,
            }
        );
    }

    #[test]
    fn passes_v1_creation_result_conformance_scenarios() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/creation-outcome-scenarios-v1.json");
        let corpus: CreationOutcomeConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared creation outcome corpus should be readable"))
                .expect("shared creation outcome corpus should be valid JSON");
        assert_eq!(corpus.version, 1);

        for scenario in corpus.scenarios {
            let manifest = ArchiveCreationManifest::from_entries(scenario.result_reports.iter().fold(Vec::new(), |mut entries, report| {
                if !entries
                    .iter()
                    .any(|entry: &ArchiveCreationManifestMember| entry.archive_path == report.archive_path)
                {
                    entries.push(ArchiveCreationManifestMember {
                        archive_path: report.archive_path.clone(),
                        is_directory: report.status == "directory",
                        source_size: if report.status == "directory" { 0 } else { report.source_bytes },
                        source_modified_at: None,
                    });
                }
                entries
            }))
            .expect("creation outcome scenario must form a valid manifest");
            let mut state = ArchiveCreationManifestState::new(manifest);
            let result = scenario.result_reports.into_iter().try_for_each(|report| {
                let status = match report.status.as_str() {
                    "directory" => LocalArchiveCreationMemberStatus::Directory,
                    "created" => LocalArchiveCreationMemberStatus::Created,
                    status => panic!("unsupported creation result status in {}: {status}", scenario.name),
                };
                state.record(ArchiveCreationMemberOutcome {
                    archive_path: report.archive_path,
                    status,
                    source_bytes: report.source_bytes,
                })
            });
            if scenario.error.is_some() {
                assert!(result.is_err(), "{} must reject its invalid result", scenario.name);
                continue;
            }
            result.expect("valid creation outcome scenario must be accepted");
            let expected_outcomes = scenario
                .member_outcomes
                .expect("valid creation outcome scenario must declare outcomes");
            assert_eq!(state.outcomes.len(), expected_outcomes.len());
            for (archive_path, expected_outcome) in expected_outcomes {
                let member_result = state
                    .outcomes
                    .get(&archive_path)
                    .expect("expected creation result must be recorded");
                assert_eq!(member_result.source_bytes, expected_outcome.source_bytes);
                assert_eq!(
                    matches!(member_result.status, LocalArchiveCreationMemberStatus::Directory),
                    expected_outcome.status == "directory"
                );
            }
            let expected_progress = scenario.progress.expect("valid creation outcome scenario must declare progress");
            let progress = state.progress().expect("creation outcome progress must be derivable");
            assert_eq!(progress.files_created, expected_progress["files_created"]);
            assert_eq!(progress.directories_created, expected_progress["directories_created"]);
            assert_eq!(progress.source_bytes, expected_progress["source_bytes"]);
        }
    }

    #[test]
    fn passes_v1_extraction_manifest_conformance_scenarios() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/extraction-outcome-scenarios-v1.json");
        let corpus: ExtractionOutcomeConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared extraction outcome corpus should be readable"))
                .expect("shared extraction outcome corpus should be valid JSON");
        assert_eq!(corpus.version, 1);

        for scenario in corpus.manifest_scenarios {
            let manifest = ArchiveExtractionManifest::from_entries(
                scenario
                    .entries
                    .into_iter()
                    .map(|entry| ArchiveExtractionManifestMember {
                        path: entry.path,
                        is_directory: entry.is_directory,
                        uncompressed_size: entry.uncompressed_size,
                        modified_at: None,
                    })
                    .collect(),
            );
            if scenario.error.is_some() {
                assert!(manifest.is_err(), "{} must reject its invalid manifest", scenario.name);
                continue;
            }
            let manifest = manifest.expect("valid manifest scenario must be accepted");
            let expected_entries = scenario
                .normalized_entries
                .expect("valid manifest scenario must declare normalized entries");
            assert_eq!(manifest.entries.len(), expected_entries.len(), "{}", scenario.name);
            for (entry, expected) in manifest.entries.iter().zip(expected_entries) {
                assert_eq!(entry.path, expected.path, "{}", scenario.name);
                assert_eq!(entry.is_directory, expected.is_directory, "{}", scenario.name);
                assert_eq!(entry.uncompressed_size, expected.uncompressed_size, "{}", scenario.name);
            }
        }
    }

    #[test]
    fn passes_v1_creation_manifest_conformance_scenarios() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/creation-outcome-scenarios-v1.json");
        let corpus: CreationOutcomeConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared creation outcome corpus should be readable"))
                .expect("shared creation outcome corpus should be valid JSON");
        assert_eq!(corpus.version, 1);

        for scenario in corpus.manifest_scenarios {
            let manifest = ArchiveCreationManifest::from_entries(
                scenario
                    .entries
                    .into_iter()
                    .map(|entry| ArchiveCreationManifestMember {
                        archive_path: entry.archive_path,
                        is_directory: entry.is_directory,
                        source_size: entry.source_size,
                        source_modified_at: None,
                    })
                    .collect(),
            );
            if scenario.error.is_some() {
                assert!(manifest.is_err(), "{} must reject its invalid manifest", scenario.name);
                continue;
            }
            let manifest = manifest.expect("valid manifest scenario must be accepted");
            let expected_entries = scenario
                .normalized_entries
                .expect("valid manifest scenario must declare normalized entries");
            assert_eq!(manifest.entries.len(), expected_entries.len(), "{}", scenario.name);
            for (member, expected) in manifest.entries.iter().zip(expected_entries) {
                assert_eq!(member.archive_path, expected.archive_path, "{}", scenario.name);
                assert_eq!(member.is_directory, expected.is_directory, "{}", scenario.name);
                assert_eq!(member.source_size, expected.source_size, "{}", scenario.name);
            }
            let expected_progress = scenario.progress.expect("valid manifest scenario must declare progress");
            let summary = manifest.summary().expect("valid manifest summary must be representable");
            assert_eq!(summary.files_created, expected_progress["files_created"], "{}", scenario.name);
            assert_eq!(
                summary.directories_created, expected_progress["directories_created"],
                "{}",
                scenario.name
            );
            assert_eq!(summary.source_bytes, expected_progress["source_bytes"], "{}", scenario.name);
        }
    }

    #[test]
    fn passes_v1_creation_terminal_conformance_scenarios() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/creation-outcome-scenarios-v1.json");
        let corpus: CreationOutcomeConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared creation outcome corpus should be readable"))
                .expect("shared creation outcome corpus should be valid JSON");
        assert_eq!(corpus.version, 1);

        for scenario in corpus.terminal_scenarios {
            let manifest = ArchiveCreationManifest::from_entries(
                scenario
                    .entries
                    .into_iter()
                    .map(|entry| ArchiveCreationManifestMember {
                        archive_path: entry.archive_path,
                        is_directory: entry.is_directory,
                        source_size: entry.source_size,
                        source_modified_at: None,
                    })
                    .collect(),
            )
            .expect("terminal scenario manifest must be valid");
            let result = (|| {
                let mut state = ArchiveCreationManifestState::new(manifest);
                for report in scenario.result_reports {
                    let status = match report.status.as_str() {
                        "directory" => LocalArchiveCreationMemberStatus::Directory,
                        "created" => LocalArchiveCreationMemberStatus::Created,
                        status => panic!("unsupported creation result status in {}: {status}", scenario.name),
                    };
                    state.record(ArchiveCreationMemberOutcome {
                        archive_path: report.archive_path,
                        status,
                        source_bytes: report.source_bytes,
                    })?;
                }
                state.terminal_summary()
            })();
            if scenario.error.is_some() {
                assert!(result.is_err(), "{} must reject its invalid terminal state", scenario.name);
                continue;
            }
            let summary = result.expect("valid terminal scenario must be accepted");
            let expected_progress = scenario.progress.expect("valid terminal scenario must declare progress");
            assert_eq!(summary.files_created, expected_progress["files_created"], "{}", scenario.name);
            assert_eq!(
                summary.directories_created, expected_progress["directories_created"],
                "{}",
                scenario.name
            );
            assert_eq!(summary.source_bytes, expected_progress["source_bytes"], "{}", scenario.name);
        }
    }

    #[test]
    fn passes_v1_creation_trajectory_conformance_scenarios() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/creation-trajectory-scenarios-v1.json");
        let corpus: CreationTrajectoryConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared creation trajectory corpus should be readable"))
                .expect("shared creation trajectory corpus should be valid JSON");
        assert_eq!(corpus.version, 1);
        assert_eq!(
            corpus.topologies.into_iter().collect::<std::collections::HashSet<_>>(),
            std::collections::HashSet::from([
                "smb_to_smb".to_string(),
                "local_to_local".to_string(),
                "smb_to_local".to_string(),
                "local_to_smb".to_string(),
            ])
        );

        for scenario in corpus.scenarios {
            let manifest = ArchiveCreationManifest::from_entries(
                scenario
                    .entries
                    .iter()
                    .map(|entry| ArchiveCreationManifestMember {
                        archive_path: entry.archive_path.clone(),
                        is_directory: entry.is_directory,
                        source_size: entry.source_size,
                        source_modified_at: None,
                    })
                    .collect(),
            )
            .expect("trajectory members must form a valid immutable manifest");
            let mut state = ArchiveCreationManifestState::new(manifest);
            let mut cancelled = false;
            for step in scenario.steps {
                match step.event.as_str() {
                    "initialize" | "resume" | "terminal_summary" => {}
                    "cancel" => cancelled = true,
                    "report" => {
                        let status = match step.status.as_deref() {
                            Some("directory") => LocalArchiveCreationMemberStatus::Directory,
                            Some("created") => LocalArchiveCreationMemberStatus::Created,
                            status => panic!("unsupported creation result status in {}: {status:?}", scenario.name),
                        };
                        state
                            .record(ArchiveCreationMemberOutcome {
                                archive_path: step.archive_path.expect("creation reports must identify their archive member"),
                                status,
                                source_bytes: step.source_bytes,
                            })
                            .expect("valid creation trajectory outcome must be accepted");
                    }
                    event => panic!("unsupported creation trajectory event in {}: {event}", scenario.name),
                }
            }
            assert_eq!(
                state.outcomes.keys().cloned().collect::<std::collections::HashSet<_>>(),
                scenario.completed_members.into_iter().collect(),
                "{}",
                scenario.name
            );
            if cancelled {
                assert_eq!(scenario.terminal_phase, "cancelled", "{}", scenario.name);
            } else {
                let summary = state
                    .terminal_summary()
                    .expect("complete trajectory must produce a terminal summary");
                assert_eq!(summary.files_created, scenario.progress["files_created"], "{}", scenario.name);
                assert_eq!(
                    summary.directories_created, scenario.progress["directories_created"],
                    "{}",
                    scenario.name
                );
                assert_eq!(summary.source_bytes, scenario.progress["source_bytes"], "{}", scenario.name);
            }
        }
    }

    #[test]
    fn passes_v1_terminal_result_conformance_scenarios() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/extraction-outcome-scenarios-v1.json");
        let corpus: ExtractionOutcomeConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared extraction outcome corpus should be readable"))
                .expect("shared extraction outcome corpus should be valid JSON");
        assert_eq!(corpus.version, 1);

        for scenario in corpus.scenarios.into_iter().filter(|scenario| !scenario.result_reports.is_empty()) {
            let mut checkpoint = LocalArchiveExtractionCheckpoint::default();
            for report in scenario.result_reports {
                let status = match report.status.as_str() {
                    "directory" => LocalArchiveExtractionDestinationStatus::Directory,
                    "extracted" => LocalArchiveExtractionDestinationStatus::Extracted,
                    "skipped" => LocalArchiveExtractionDestinationStatus::Skipped,
                    "ignored" => LocalArchiveExtractionDestinationStatus::Ignored,
                    status => panic!("unsupported terminal result status in {}: {status}", scenario.name),
                };
                checkpoint
                    .record_destination_result(LocalArchiveExtractionDestinationResult {
                        member_path: report.member_path,
                        status,
                        target_path: report.target_path,
                        extracted_bytes: report.extracted_bytes,
                        directories_created: report.directories_created,
                        replaced: report.replaced,
                        renamed: report.renamed,
                    })
                    .expect("valid terminal outcome must be accepted");
            }
            let expected_members: std::collections::HashSet<String> = scenario.completed_members.into_iter().collect();
            assert_eq!(
                checkpoint.member_outcomes.keys().cloned().collect::<std::collections::HashSet<_>>(),
                expected_members,
                "{}",
                scenario.name
            );
            let result = checkpoint.result();
            assert_eq!(
                result.files_extracted,
                scenario.progress.get("files_extracted").copied().unwrap_or(0),
                "{}",
                scenario.name
            );
            assert_eq!(
                result.directories_created,
                scenario.progress.get("directories_created").copied().unwrap_or(0),
                "{}",
                scenario.name
            );
            assert_eq!(
                result.extracted_bytes,
                scenario.progress.get("extracted_bytes").copied().unwrap_or(0),
                "{}",
                scenario.name
            );
            assert_eq!(
                result.files_skipped,
                scenario.progress.get("files_skipped").copied().unwrap_or(0),
                "{}",
                scenario.name
            );
            assert_eq!(
                result.files_replaced,
                scenario.progress.get("files_replaced").copied().unwrap_or(0),
                "{}",
                scenario.name
            );
        }
    }

    #[test]
    fn passes_v1_extraction_trajectory_conformance_scenarios() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/extraction-trajectory-scenarios-v1.json");
        let corpus: ExtractionTrajectoryConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared extraction trajectory corpus should be readable"))
                .expect("shared extraction trajectory corpus should be valid JSON");
        assert_eq!(corpus.version, 1);
        assert_eq!(
            corpus.topologies.iter().cloned().collect::<std::collections::HashSet<_>>(),
            std::collections::HashSet::from([
                "smb_to_smb".to_string(),
                "local_to_local".to_string(),
                "smb_to_local".to_string(),
                "local_to_smb".to_string(),
            ])
        );

        for topology in corpus.topologies {
            for scenario in corpus.scenarios.clone() {
                let manifest = ArchiveExtractionManifest::from_entries(
                    scenario
                        .members
                        .iter()
                        .map(|path| ArchiveExtractionManifestMember {
                            path: path.clone(),
                            is_directory: false,
                            uncompressed_size: 0,
                            modified_at: None,
                        })
                        .collect(),
                )
                .expect("trajectory members must form a valid immutable manifest");
                let mut checkpoint = LocalArchiveExtractionCheckpoint::default();
                let mut phase = "prepared";
                for step in scenario.steps {
                    match step.event.as_str() {
                        "initialize" => {
                            assert_eq!(phase, "prepared", "{topology}: {}", scenario.name);
                            phase = "streaming";
                        }
                        "collision_pause" => {
                            assert_eq!(phase, "streaming", "{topology}: {}", scenario.name);
                            phase = "awaiting_user_decision";
                        }
                        "partial_write" => {
                            assert_eq!(phase, "streaming", "{topology}: {}", scenario.name);
                            checkpoint
                                .record_partial_member(step.member_path.expect("partial writes must identify their archive member"), 0);
                            phase = "awaiting_user_decision";
                        }
                        "decision" => {
                            assert_eq!(phase, "awaiting_user_decision", "{topology}: {}", scenario.name);
                            match step.action.as_deref() {
                                Some("skip") => checkpoint.resolve_collision(
                                    step.member_path.expect("skip decisions must identify their archive member"),
                                    LocalArchiveExtractionCollisionAction::Skip,
                                ),
                                Some("replace") => checkpoint.resolve_collision(
                                    step.member_path.expect("replace decisions must identify their archive member"),
                                    LocalArchiveExtractionCollisionAction::Replace,
                                ),
                                Some("replace_older") => {
                                    assert_eq!(
                                        scenario.existing_file_policy.as_deref(),
                                        Some("replace_older"),
                                        "{topology}: {}",
                                        scenario.name
                                    );
                                    checkpoint.resolve_all_collisions(LocalArchiveExtractionCollisionAction::ReplaceOlder);
                                }
                                Some("rename") => checkpoint.rename_member(
                                    step.member_path.expect("rename decisions must identify their archive member"),
                                    step.target_path.expect("rename decisions must identify their target"),
                                ),
                                Some("retry") => {}
                                Some("ignore") => checkpoint
                                    .ignore_member_error(step.member_path.expect("ignore decisions must identify their archive member")),
                                action => panic!("unsupported extraction decision in {}: {action:?}", scenario.name),
                            }
                            phase = "streaming";
                        }
                        "resume" => {
                            assert_eq!(phase, "streaming", "{topology}: {}", scenario.name);
                            LocalArchiveExtractionExecutionPlan::from_manifest(manifest.clone(), checkpoint.clone())
                                .expect("resume checkpoint members must belong to the immutable manifest");
                        }
                        "report" => {
                            assert_eq!(phase, "streaming", "{topology}: {}", scenario.name);
                            let member_path = step.member_path.expect("reports must identify their archive member");
                            if checkpoint.is_completed(&member_path) {
                                continue;
                            }
                            let status = match step.status.as_deref() {
                                Some("directory") => LocalArchiveExtractionDestinationStatus::Directory,
                                Some("extracted") => LocalArchiveExtractionDestinationStatus::Extracted,
                                Some("skipped") => LocalArchiveExtractionDestinationStatus::Skipped,
                                Some("ignored") => LocalArchiveExtractionDestinationStatus::Ignored,
                                status => panic!("unsupported terminal result status in {}: {status:?}", scenario.name),
                            };
                            checkpoint
                                .record_destination_result(LocalArchiveExtractionDestinationResult {
                                    member_path,
                                    status,
                                    target_path: step.target_path.expect("reports must identify their target"),
                                    extracted_bytes: step.extracted_bytes,
                                    directories_created: 0,
                                    replaced: step.replaced,
                                    renamed: step.renamed,
                                })
                                .expect("valid trajectory outcome must be accepted");
                        }
                        "cancel" => {
                            assert_eq!(phase, "streaming", "{topology}: {}", scenario.name);
                            phase = "cancelled";
                        }
                        "terminal_summary" => {
                            assert_eq!(phase, "streaming", "{topology}: {}", scenario.name);
                            let terminal_plan = LocalArchiveExtractionExecutionPlan::from_manifest(manifest.clone(), checkpoint.clone())
                                .expect("terminal checkpoint members must belong to the immutable manifest");
                            assert!(terminal_plan.has_complete_terminal_coverage(), "{topology}: {}", scenario.name);
                            phase = "completed";
                        }
                        event => panic!("unsupported extraction trajectory event in {}: {event}", scenario.name),
                    }
                }
                let plan = LocalArchiveExtractionExecutionPlan::from_manifest(manifest, checkpoint.clone())
                    .expect("trajectory checkpoint members must belong to its immutable manifest");
                assert_eq!(phase, scenario.terminal_phase.as_str(), "{topology}: {}", scenario.name);
                assert_eq!(
                    plan.completed_member_paths(),
                    scenario.completed_members.iter().map(String::as_str).collect(),
                    "{topology}: {}",
                    scenario.name
                );
                assert_eq!(
                    plan.has_complete_terminal_coverage(),
                    scenario.terminal_phase == "completed",
                    "{topology}: {}",
                    scenario.name
                );
                let result = checkpoint.result();
                assert_eq!(
                    result.files_extracted, scenario.progress["files_extracted"],
                    "{topology}: {}",
                    scenario.name
                );
                assert_eq!(
                    result.files_skipped, scenario.progress["files_skipped"],
                    "{topology}: {}",
                    scenario.name
                );
                assert_eq!(
                    result.files_replaced, scenario.progress["files_replaced"],
                    "{topology}: {}",
                    scenario.name
                );
                assert_eq!(
                    result.extracted_bytes, scenario.progress["extracted_bytes"],
                    "{topology}: {}",
                    scenario.name
                );
            }
        }
    }

    #[test]
    fn reports_cancellation_without_creating_or_misclassifying_output() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"source").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(std::slice::from_ref(&source), &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();

        let preflight_destination = directory.path().join("preflight-output");
        assert!(matches!(
            extract_local_archive_to_new_directory_with_cancellation(directory.path(), &archive_path, &preflight_destination, || true),
            Err(LocalArchiveError::Cancelled)
        ));
        assert!(!preflight_destination.exists());

        let started_destination = directory.path().join("started-output");
        let cancellation_checks = Cell::new(0);
        assert!(matches!(
            extract_local_archive_to_new_directory_with_cancellation(directory.path(), &archive_path, &started_destination, || {
                let checks = cancellation_checks.get();
                cancellation_checks.set(checks + 1);
                checks > 0
            }),
            Err(LocalArchiveError::Cancelled)
        ));
        assert!(started_destination.is_dir());
    }

    #[test]
    fn publishes_only_committed_direct_local_extraction_progress() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"source").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let destination = directory.path().join("output");
        let mut progress = Vec::new();

        let result = extract_local_archive_to_new_directory_with_cancellation_and_progress(
            directory.path(),
            &archive_path,
            &destination,
            || false,
            |update| progress.push(update),
        )
        .unwrap();

        assert_eq!(
            progress.first(),
            Some(&LocalArchiveExtractionResult {
                files_extracted: 0,
                directories_created: 1,
                extracted_bytes: 0,
                files_skipped: 0,
                files_replaced: 0,
                files_failed: 0,
                partial_members: 0,
            })
        );
        assert_eq!(progress.last(), Some(&result));
    }

    #[test]
    fn pauses_for_existing_outputs_and_resumes_after_skip_or_replace() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(std::slice::from_ref(&source), &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();

        let skip_destination = directory.path().join("skip-output");
        fs::create_dir(&skip_destination).unwrap();
        fs::write(skip_destination.join("source.txt"), b"existing contents").unwrap();
        let (mut skip_checkpoint, skip_collision) = match extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &skip_destination,
            LocalArchiveExtractionCheckpoint::default(),
            || false,
            |_| {},
        )
        .unwrap()
        {
            LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => (checkpoint, collision),
            LocalArchiveExtractionRunResult::AwaitingMemberError { .. } => panic!("expected a collision pause"),
            LocalArchiveExtractionRunResult::Completed(_) => panic!("expected a collision pause"),
        };
        assert_eq!(skip_collision.member_path, "source.txt");
        skip_checkpoint.resolve_collision(skip_collision.member_path, LocalArchiveExtractionCollisionAction::Skip);
        let LocalArchiveExtractionRunResult::Completed(skip_checkpoint) = extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &skip_destination,
            skip_checkpoint,
            || false,
            |_| {},
        )
        .unwrap() else {
            panic!("skip resolution must complete extraction");
        };
        assert_eq!(skip_checkpoint.result().files_skipped, 1);
        assert_eq!(fs::read(skip_destination.join("source.txt")).unwrap(), b"existing contents");

        let replace_destination = directory.path().join("replace-output");
        fs::create_dir(&replace_destination).unwrap();
        fs::write(replace_destination.join("source.txt"), b"existing contents").unwrap();
        let (mut replace_checkpoint, replace_collision) = match extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &replace_destination,
            LocalArchiveExtractionCheckpoint::default(),
            || false,
            |_| {},
        )
        .unwrap()
        {
            LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => (checkpoint, collision),
            LocalArchiveExtractionRunResult::AwaitingMemberError { .. } => panic!("expected a collision pause"),
            LocalArchiveExtractionRunResult::Completed(_) => panic!("expected a collision pause"),
        };
        replace_checkpoint.resolve_collision(replace_collision.member_path, LocalArchiveExtractionCollisionAction::Replace);
        let LocalArchiveExtractionRunResult::Completed(replace_checkpoint) = extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &replace_destination,
            replace_checkpoint,
            || false,
            |_| {},
        )
        .unwrap() else {
            panic!("replace resolution must complete extraction");
        };
        assert_eq!(replace_checkpoint.result().files_extracted, 1);
        assert_eq!(fs::read(replace_destination.join("source.txt")).unwrap(), b"archive contents");
    }

    #[test]
    fn rejects_archive_changes_before_resuming_a_paused_extraction() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(std::slice::from_ref(&source), &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();

        let destination = directory.path().join("output");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("source.txt"), b"existing contents").unwrap();
        let (mut checkpoint, collision) = match extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &destination,
            LocalArchiveExtractionCheckpoint::default(),
            || false,
            |_| {},
        )
        .unwrap()
        {
            LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => (checkpoint, collision),
            _ => panic!("expected a collision pause"),
        };
        checkpoint.resolve_collision(collision.member_path, LocalArchiveExtractionCollisionAction::Replace);

        fs::remove_file(&archive_path).unwrap();
        fs::write(&source, b"changed contents").unwrap();
        let changed_entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &changed_entries, || false).unwrap();

        assert!(matches!(
            extract_local_archive_with_checkpoint_and_progress(directory.path(), &archive_path, &destination, checkpoint, || false, |_| {},),
            Err(LocalArchiveError::ArchiveSourceChanged)
        ));
        assert_eq!(fs::read(destination.join("source.txt")).unwrap(), b"existing contents");
    }

    #[test]
    fn executes_v1_collision_skip_behavioral_scenario() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/extraction-outcome-scenarios-v1.json");
        let corpus: ExtractionOutcomeConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared extraction outcome corpus should be readable"))
                .expect("shared extraction outcome corpus should be valid JSON");
        let scenario = corpus
            .behavioral_scenarios
            .into_iter()
            .find(|scenario| scenario.name == "collision_skip_is_terminal")
            .expect("collision skip scenario should be present");
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let destination = directory.path().join("output");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("source.txt"), b"existing contents").unwrap();

        let (mut checkpoint, collision) = match extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &destination,
            LocalArchiveExtractionCheckpoint::default(),
            || false,
            |_| {},
        )
        .unwrap()
        {
            LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => (checkpoint, collision),
            LocalArchiveExtractionRunResult::AwaitingMemberError { .. } => panic!("expected a collision pause"),
            LocalArchiveExtractionRunResult::Completed(_) => panic!("expected a collision pause"),
        };
        let action = match scenario.collision_action.as_deref() {
            Some("skip") => LocalArchiveExtractionCollisionAction::Skip,
            Some(action) => panic!("unsupported collision action: {action}"),
            None => panic!("collision skip scenario must define an action"),
        };
        checkpoint.resolve_collision(collision.member_path, action);
        let LocalArchiveExtractionRunResult::Completed(checkpoint) =
            extract_local_archive_with_checkpoint_and_progress(directory.path(), &archive_path, &destination, checkpoint, || false, |_| {})
                .unwrap()
        else {
            panic!("skip resolution must complete extraction");
        };

        assert_eq!(scenario.terminal_phase, "completed");
        assert_eq!(checkpoint.result().files_skipped, scenario.progress["files_skipped"]);
        assert_eq!(fs::read(destination.join("source.txt")).unwrap(), b"existing contents");
    }

    #[test]
    fn executes_v1_cancellation_behavioral_scenario() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/extraction-outcome-scenarios-v1.json");
        let corpus: ExtractionOutcomeConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared extraction outcome corpus should be readable"))
                .expect("shared extraction outcome corpus should be valid JSON");
        let scenario = corpus
            .behavioral_scenarios
            .into_iter()
            .find(|scenario| scenario.name == "cancellation_stops_before_member_completion")
            .expect("cancellation scenario should be present");
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let destination = directory.path().join("output");

        assert!(matches!(
            extract_local_archive_with_checkpoint_and_progress(
                directory.path(),
                &archive_path,
                &destination,
                LocalArchiveExtractionCheckpoint::default(),
                || true,
                |_| {},
            ),
            Err(LocalArchiveError::Cancelled)
        ));
        assert_eq!(scenario.terminal_phase, "cancelled");
        assert_eq!(scenario.progress["files_extracted"], 0);
        assert!(!destination.exists());
    }

    #[test]
    fn executes_v1_rename_behavioral_scenario() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/extraction-outcome-scenarios-v1.json");
        let corpus: ExtractionOutcomeConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared extraction outcome corpus should be readable"))
                .expect("shared extraction outcome corpus should be valid JSON");
        let scenario = corpus
            .behavioral_scenarios
            .into_iter()
            .find(|scenario| scenario.name == "rename_preserves_terminal_destination_metadata")
            .expect("rename scenario should be present");
        let rename_target = scenario.rename_target.expect("rename scenario should define a target");
        let directory = tempdir().unwrap();
        let source = directory.path().join("root.txt");
        fs::write(&source, b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let destination = directory.path().join("output");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("root.txt"), b"existing contents").unwrap();

        let (mut checkpoint, collision) = match extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &destination,
            LocalArchiveExtractionCheckpoint::default(),
            || false,
            |_| {},
        )
        .unwrap()
        {
            LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => (checkpoint, collision),
            LocalArchiveExtractionRunResult::AwaitingMemberError { .. } => panic!("expected a collision pause"),
            LocalArchiveExtractionRunResult::Completed(_) => panic!("expected a collision pause"),
        };
        checkpoint.rename_member(collision.member_path, rename_target.clone());
        let LocalArchiveExtractionRunResult::Completed(checkpoint) =
            extract_local_archive_with_checkpoint_and_progress(directory.path(), &archive_path, &destination, checkpoint, || false, |_| {})
                .unwrap()
        else {
            panic!("rename resolution must complete extraction");
        };

        assert_eq!(scenario.terminal_phase, "completed");
        assert_eq!(checkpoint.result().files_extracted, 1);
        assert_eq!(fs::read(destination.join("root.txt")).unwrap(), b"existing contents");
        assert_eq!(fs::read(destination.join(&rename_target)).unwrap(), b"archive contents");
    }

    #[test]
    fn rejects_rename_targets_that_collide_with_another_archive_member() {
        let directory = tempdir().unwrap();
        let first_source = directory.path().join("first.txt");
        let second_source = directory.path().join("second.txt");
        fs::write(&first_source, b"first contents").unwrap();
        fs::write(&second_source, b"second contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[first_source, second_source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();

        assert!(matches!(
            validate_local_extraction_rename_target(
                &archive_path,
                &LocalArchiveExtractionCheckpoint::default(),
                "first.txt",
                "SECOND.TXT",
                false,
            ),
            Err(LocalArchiveError::DuplicateEntryPath)
        ));
    }

    #[test]
    fn pauses_for_directory_collisions_and_remaps_the_directory_subtree() {
        let directory = tempdir().unwrap();
        let source_directory = directory.path().join("source");
        fs::create_dir(&source_directory).unwrap();
        fs::write(source_directory.join("child.txt"), b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source_directory], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let destination = directory.path().join("output");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("source"), b"existing contents").unwrap();

        let (mut checkpoint, collision) = match extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &destination,
            LocalArchiveExtractionCheckpoint::default(),
            || false,
            |_| {},
        )
        .unwrap()
        {
            LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => (checkpoint, collision),
            LocalArchiveExtractionRunResult::AwaitingMemberError { .. } => panic!("expected a directory collision pause"),
            LocalArchiveExtractionRunResult::Completed(_) => panic!("expected a directory collision pause"),
        };
        assert_eq!(collision.member_path, "source");
        assert_eq!(collision.target_path, "source");
        assert!(collision.is_directory);
        checkpoint.rename_member(collision.member_path, "renamed".to_string());

        let LocalArchiveExtractionRunResult::Completed(checkpoint) =
            extract_local_archive_with_checkpoint_and_progress(directory.path(), &archive_path, &destination, checkpoint, || false, |_| {})
                .unwrap()
        else {
            panic!("directory rename must complete extraction");
        };
        assert_eq!(checkpoint.result().files_extracted, 1);
        assert_eq!(fs::read(destination.join("source")).unwrap(), b"existing contents");
        assert_eq!(fs::read(destination.join("renamed/child.txt")).unwrap(), b"archive contents");
    }

    #[test]
    fn rejects_source_changes_before_retrying_a_known_partial_output() {
        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/extraction-outcome-scenarios-v1.json");
        let corpus: ExtractionOutcomeConformanceCorpus =
            serde_json::from_slice(&fs::read(corpus_path).expect("shared extraction outcome corpus should be readable"))
                .expect("shared extraction outcome corpus should be valid JSON");
        let retry_scenario = corpus
            .behavioral_scenarios
            .iter()
            .find(|scenario| scenario.name == "partial_error_retry_completes_extraction")
            .expect("partial retry scenario should be present");
        let ignore_scenario = corpus
            .behavioral_scenarios
            .iter()
            .find(|scenario| scenario.name == "partial_error_ignore_skips_member")
            .expect("partial ignore scenario should be present");
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let original_archive = fs::read(&archive_path).unwrap();
        let archive_entry = read_local_archive_entries(&archive_path).unwrap().pop().unwrap();
        assert_eq!(archive_entry.compression_method, 0);
        let mut local_header = [0; 30];
        let mut archive = FsFile::open(&archive_path).unwrap();
        archive.seek(SeekFrom::Start(archive_entry.local_header_offset)).unwrap();
        archive.read_exact(&mut local_header).unwrap();
        let data_offset =
            archive_entry.local_header_offset + 30 + u64::from(u16_le(&local_header, 26)) + u64::from(u16_le(&local_header, 28));
        drop(archive);
        let mut archive = OpenOptions::new().write(true).open(&archive_path).unwrap();
        archive.seek(SeekFrom::Start(data_offset)).unwrap();
        archive.write_all(b"X").unwrap();
        archive.flush().unwrap();
        drop(archive);

        let destination = directory.path().join("output");
        let (checkpoint, error) = match extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &destination,
            LocalArchiveExtractionCheckpoint::default(),
            || false,
            |_| {},
        )
        .unwrap()
        {
            LocalArchiveExtractionRunResult::AwaitingMemberError { checkpoint, error } => (checkpoint, error),
            LocalArchiveExtractionRunResult::AwaitingCollision { .. } => panic!("expected a member error pause"),
            LocalArchiveExtractionRunResult::Completed(_) => panic!("expected a member error pause"),
        };
        assert_eq!(
            error.member_path,
            retry_scenario
                .member_path
                .as_deref()
                .expect("partial retry scenario must define a member path")
        );
        assert!(error.partial_output);
        assert!(destination.join("source.txt").is_file());

        let mut ignored_checkpoint = checkpoint.clone();
        assert_eq!(ignore_scenario.member_error_action.as_deref(), Some("ignore"));
        ignored_checkpoint.ignore_member_error(
            ignore_scenario
                .member_path
                .clone()
                .expect("partial ignore scenario must define a member path"),
        );
        let LocalArchiveExtractionRunResult::Completed(ignored_checkpoint) = extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &destination,
            ignored_checkpoint,
            || false,
            |_| {},
        )
        .unwrap() else {
            panic!("ignoring the failed member must complete extraction");
        };
        assert_eq!(ignore_scenario.terminal_phase, "completed");
        assert_eq!(ignored_checkpoint.result().files_skipped, ignore_scenario.progress["files_skipped"]);
        assert_eq!(ignored_checkpoint.result().files_failed, 0);
        assert_eq!(ignored_checkpoint.result().partial_members, 0);

        fs::write(&archive_path, original_archive).unwrap();
        assert!(matches!(
            extract_local_archive_with_checkpoint_and_progress(directory.path(), &archive_path, &destination, checkpoint, || false, |_| {},),
            Err(LocalArchiveError::ArchiveSourceChanged)
        ));
        assert_eq!(retry_scenario.member_error_action.as_deref(), Some("retry"));
    }

    #[test]
    fn applies_a_skip_all_collision_decision_to_remaining_existing_outputs() {
        let directory = tempdir().unwrap();
        let first_source = directory.path().join("first.txt");
        let second_source = directory.path().join("second.txt");
        fs::write(&first_source, b"first archive contents").unwrap();
        fs::write(&second_source, b"second archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[first_source, second_source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let destination = directory.path().join("output");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("first.txt"), b"first existing contents").unwrap();
        fs::write(destination.join("second.txt"), b"second existing contents").unwrap();

        let (mut checkpoint, collision) = match extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &destination,
            LocalArchiveExtractionCheckpoint::default(),
            || false,
            |_| {},
        )
        .unwrap()
        {
            LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => (checkpoint, collision),
            LocalArchiveExtractionRunResult::AwaitingMemberError { .. } => panic!("expected a collision pause"),
            LocalArchiveExtractionRunResult::Completed(_) => panic!("expected a collision pause"),
        };
        assert_eq!(collision.member_path, "first.txt");
        checkpoint.resolve_all_collisions(LocalArchiveExtractionCollisionAction::Skip);
        let LocalArchiveExtractionRunResult::Completed(checkpoint) =
            extract_local_archive_with_checkpoint_and_progress(directory.path(), &archive_path, &destination, checkpoint, || false, |_| {})
                .unwrap()
        else {
            panic!("skip-all resolution must complete extraction");
        };
        assert_eq!(checkpoint.result().files_skipped, 2);
        assert_eq!(fs::read(destination.join("first.txt")).unwrap(), b"first existing contents");
        assert_eq!(fs::read(destination.join("second.txt")).unwrap(), b"second existing contents");
    }

    #[test]
    fn replace_older_replaces_only_existing_files_older_than_the_archive_member() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();

        let older_destination = directory.path().join("older-output");
        fs::create_dir(&older_destination).unwrap();
        let older_target = older_destination.join("source.txt");
        fs::write(&older_target, b"older contents").unwrap();
        FsFile::options()
            .write(true)
            .open(&older_target)
            .unwrap()
            .set_modified(std::time::SystemTime::UNIX_EPOCH)
            .unwrap();
        let (mut older_checkpoint, _collision) = match extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &older_destination,
            LocalArchiveExtractionCheckpoint::default(),
            || false,
            |_| {},
        )
        .unwrap()
        {
            LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => (checkpoint, collision),
            LocalArchiveExtractionRunResult::AwaitingMemberError { .. } => panic!("expected a collision pause"),
            LocalArchiveExtractionRunResult::Completed(_) => panic!("expected a collision pause"),
        };
        older_checkpoint.resolve_all_collisions(LocalArchiveExtractionCollisionAction::ReplaceOlder);
        let LocalArchiveExtractionRunResult::Completed(older_checkpoint) = extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &older_destination,
            older_checkpoint,
            || false,
            |_| {},
        )
        .unwrap() else {
            panic!("replace-older should replace an older target");
        };
        assert_eq!(older_checkpoint.result().files_extracted, 1);
        assert_eq!(fs::read(&older_target).unwrap(), b"archive contents");

        let newer_destination = directory.path().join("newer-output");
        fs::create_dir(&newer_destination).unwrap();
        let newer_target = newer_destination.join("source.txt");
        fs::write(&newer_target, b"newer contents").unwrap();
        FsFile::options()
            .write(true)
            .open(&newer_target)
            .unwrap()
            .set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60))
            .unwrap();
        let (mut newer_checkpoint, collision) = match extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &newer_destination,
            LocalArchiveExtractionCheckpoint::default(),
            || false,
            |_| {},
        )
        .unwrap()
        {
            LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => (checkpoint, collision),
            LocalArchiveExtractionRunResult::AwaitingMemberError { .. } => panic!("expected a collision pause"),
            LocalArchiveExtractionRunResult::Completed(_) => panic!("expected a collision pause"),
        };
        assert_eq!(collision.member_path, "source.txt");
        newer_checkpoint.resolve_all_collisions(LocalArchiveExtractionCollisionAction::ReplaceOlder);
        let LocalArchiveExtractionRunResult::Completed(newer_checkpoint) = extract_local_archive_with_checkpoint_and_progress(
            directory.path(),
            &archive_path,
            &newer_destination,
            newer_checkpoint,
            || false,
            |_| {},
        )
        .unwrap() else {
            panic!("replace-older should skip a newer target");
        };
        assert_eq!(newer_checkpoint.result().files_skipped, 1);
        assert_eq!(fs::read(&newer_target).unwrap(), b"newer contents");
    }

    #[test]
    fn rejects_file_directory_collisions_before_creating_the_destination() {
        let directory = tempdir().unwrap();
        let archive_path = directory.path().join("collision.zip");
        let output = OpenOptions::new().write(true).create_new(true).open(&archive_path).unwrap();
        let mut writer = ZipWriter::new_stream(output);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer.start_file("tree", options).unwrap();
        writer.write_all(b"file").unwrap();
        writer.start_file("tree/child.txt", options).unwrap();
        writer.write_all(b"child").unwrap();
        writer.finish().unwrap();
        let destination = directory.path().join("output");

        assert!(matches!(
            extract_local_archive_to_new_directory(directory.path(), &archive_path, &destination),
            Err(LocalArchiveError::DuplicateEntryPath)
        ));
        assert!(!destination.exists());
    }

    #[test]
    fn rejects_unsafe_members_before_creating_the_destination() {
        let directory = tempdir().unwrap();
        let archive_path = directory.path().join("unsafe.zip");
        let output = OpenOptions::new().write(true).create_new(true).open(&archive_path).unwrap();
        let mut writer = ZipWriter::new_stream(output);
        writer
            .start_file(
                "../unsafe.txt",
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
        writer.write_all(b"unsafe").unwrap();
        writer.finish().unwrap();
        let destination = directory.path().join("output");

        assert!(matches!(
            extract_local_archive_to_new_directory(directory.path(), &archive_path, &destination),
            Err(LocalArchiveError::UnsafeEntryPath)
        ));
        assert!(!destination.exists());
    }

    #[test]
    fn rejects_symbolic_link_members_before_creating_the_destination() {
        let directory = tempdir().unwrap();
        let archive_path = directory.path().join("symbolic-link.zip");
        let output = OpenOptions::new().write(true).create_new(true).open(&archive_path).unwrap();
        let mut writer = ZipWriter::new_stream(output);
        writer
            .start_file("link", SimpleFileOptions::default().compression_method(CompressionMethod::Stored))
            .unwrap();
        writer.write_all(b"target").unwrap();
        writer.finish().unwrap();
        let mut archive_bytes = fs::read(&archive_path).unwrap();
        let central_directory_offset = archive_bytes
            .windows(CENTRAL_DIRECTORY_SIGNATURE.len())
            .position(|value| value == CENTRAL_DIRECTORY_SIGNATURE)
            .unwrap();
        archive_bytes[central_directory_offset + 4..central_directory_offset + 6].copy_from_slice(&0x0314_u16.to_le_bytes());
        archive_bytes[central_directory_offset + 38..central_directory_offset + 42].copy_from_slice(&(0o120777_u32 << 16).to_le_bytes());
        fs::write(&archive_path, archive_bytes).unwrap();
        let destination = directory.path().join("output");

        assert!(inspect_local_archive(&archive_path)
            .unwrap()
            .list_directory("", None, 100)
            .unwrap()
            .entries
            .is_empty());
        assert!(matches!(
            extract_local_archive_to_new_directory(directory.path(), &archive_path, &destination),
            Err(LocalArchiveError::UnsupportedArchiveMember)
        ));
        assert!(!destination.exists());
    }

    #[test]
    fn reports_partial_output_after_member_integrity_failure() {
        let directory = tempdir().unwrap();
        let archive_path = directory.path().join("corrupt.zip");
        let output = OpenOptions::new().write(true).create_new(true).open(&archive_path).unwrap();
        let mut writer = ZipWriter::new_stream(output);
        writer
            .start_file(
                "notes.txt",
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
        writer.write_all(b"contents").unwrap();
        writer.finish().unwrap();
        let mut archive_bytes = fs::read(&archive_path).unwrap();
        let central_directory_offset = archive_bytes
            .windows(CENTRAL_DIRECTORY_SIGNATURE.len())
            .position(|value| value == CENTRAL_DIRECTORY_SIGNATURE)
            .unwrap();
        archive_bytes[central_directory_offset + 16] ^= 1;
        fs::write(&archive_path, archive_bytes).unwrap();
        let destination = directory.path().join("output");

        assert!(matches!(
            extract_local_archive_to_new_directory(directory.path(), &archive_path, &destination),
            Err(LocalArchiveError::PartialOutput(_))
        ));
        assert!(destination.join("notes.txt").is_file());
    }

    #[test]
    fn rejects_a_target_inside_a_source_directory() {
        let directory = tempdir().unwrap();
        let source_root = directory.path().join("source");
        fs::create_dir(&source_root).unwrap();

        assert!(matches!(
            build_local_archive_manifest(std::slice::from_ref(&source_root), &source_root.join("archive.zip")),
            Err(LocalArchiveError::TargetInsideSource)
        ));
    }

    #[test]
    fn loads_v1_topology_operation_compatibility_matrix() {
        let matrix_path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../archive-contract/v1/topology-operation-compatibility-matrix-v1.json");
        let matrix: serde_json::Value = serde_json::from_slice(&fs::read(matrix_path).unwrap()).unwrap();

        assert_eq!(matrix["version"], 1);
        let operations = matrix["operations"].as_array().unwrap();
        let mut cells = operations
            .iter()
            .map(|entry| format!("{}:{}", entry["topology"].as_str().unwrap(), entry["operation"].as_str().unwrap()))
            .collect::<Vec<_>>();
        cells.sort();
        assert_eq!(
            cells,
            vec![
                "local_to_local:creation",
                "local_to_local:extraction",
                "local_to_local:inspection",
                "local_to_smb:creation",
                "local_to_smb:extraction",
                "local_to_smb:inspection",
                "smb_to_local:creation",
                "smb_to_local:extraction",
                "smb_to_local:inspection",
                "smb_to_smb:creation",
                "smb_to_smb:extraction",
                "smb_to_smb:inspection",
            ]
        );
        for entry in operations {
            assert!(entry["retirement_condition"]
                .as_str()
                .is_some_and(|condition| !condition.is_empty()));
            if entry["operation"] == "inspection" {
                assert_eq!(entry["status"], "legacy_source_only");
                assert!(entry.get("driver").is_none());
                assert!(entry.get("relay_purpose").is_none());
            } else {
                assert_eq!(entry["status"], "supported");
                assert!(entry["driver"].is_string());
            }
        }
    }

    #[test]
    fn passes_v1_inspection_scenarios() {
        let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let corpus: serde_json::Value =
            serde_json::from_slice(&fs::read(workspace_root.join("archive-contract/v1/inspection-scenarios-v1.json")).unwrap()).unwrap();
        assert_eq!(corpus["version"], 1);

        for scenario in corpus["scenarios"].as_array().unwrap() {
            let archive_path = workspace_root.join("archive_testdata").join(scenario["fixture"].as_str().unwrap());
            if scenario["error"] == "format_error" {
                assert!(inspect_local_archive(&archive_path).is_err());
                continue;
            }
            let manifest = inspect_local_archive(&archive_path).unwrap();
            let entries = manifest
                .entries
                .iter()
                .map(|entry| {
                    serde_json::json!({
                        "path": entry.path,
                        "is_directory": entry.is_directory,
                        "compression_method": entry.compression_method,
                        "uncompressed_size": entry.uncompressed_size,
                        "is_safe": entry.is_safe,
                        "preview_state": if entry.encrypted { "blocked" } else if entry.is_preview_available() { "readable" } else { "unavailable" },
                        "inline_preview_eligible": entry.is_inline_preview_eligible(),
                    })
                })
                .collect::<Vec<_>>();
            assert_eq!(entries, *scenario["entries"].as_array().unwrap());
        }
    }

    #[cfg(unix)]
    #[test]
    fn passes_v1_creation_manifest_virtual_tree_corpus() {
        use std::os::unix::fs::symlink;

        let corpus_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../archive-contract/v1/creation-manifest-scenarios-v1.json");
        let corpus: serde_json::Value = serde_json::from_slice(&fs::read(corpus_path).unwrap()).unwrap();
        for scenario in corpus["scenarios"].as_array().unwrap() {
            let root = tempdir().unwrap();
            for node in scenario["nodes"].as_array().unwrap() {
                let path = root.path().join(node["path"].as_str().unwrap());
                match node["type"].as_str().unwrap() {
                    "directory" => fs::create_dir_all(path).unwrap(),
                    "file" => {
                        fs::create_dir_all(path.parent().unwrap()).unwrap();
                        fs::write(path, vec![0; node["size"].as_u64().unwrap_or(0) as usize]).unwrap();
                    }
                    "symlink" | "unsupported" => symlink("missing", path).unwrap(),
                    _ => unreachable!(),
                }
            }
            for node in scenario["nodes"].as_array().unwrap() {
                let Some(modified_at) = node.get("modified_at").and_then(serde_json::Value::as_str) else {
                    continue;
                };
                let timestamp = DateTime::parse_from_rfc3339(modified_at).unwrap().with_timezone(&Utc).into();
                let path = root.path().join(node["path"].as_str().unwrap());
                fs::File::open(path)
                    .unwrap()
                    .set_times(fs::FileTimes::new().set_modified(timestamp))
                    .unwrap();
            }
            let sources = scenario["sources"]
                .as_array()
                .unwrap()
                .iter()
                .map(|path| root.path().join(path.as_str().unwrap()))
                .collect::<Vec<_>>();
            let result = build_local_archive_manifest(&sources, &root.path().join(scenario["target"].as_str().unwrap()));
            if scenario.get("error").is_some() {
                assert!(result.is_err(), "{}", scenario["name"]);
                continue;
            }
            let manifest = project_local_archive_creation_manifest(&result.unwrap()).unwrap();
            let actual = manifest
                .entries
                .iter()
                .zip(scenario["manifest"].as_array().unwrap())
                .map(|(entry, expected)| {
                    let mut actual = serde_json::json!({
                        "archive_path": entry.archive_path.trim_end_matches('/'),
                        "is_directory": entry.is_directory,
                        "source_size": entry.source_size,
                    });
                    if expected.get("modified_at").is_some() {
                        actual["modified_at"] = serde_json::json!(entry.source_modified_at);
                    }
                    actual
                })
                .collect::<Vec<_>>();
            assert_eq!(actual, *scenario["manifest"].as_array().unwrap(), "{}", scenario["name"]);
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_target_parent_symlinked_outside_drive_root() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let source = root.path().join("source.txt");
        fs::write(&source, b"source").unwrap();
        symlink(outside.path(), root.path().join("escape")).unwrap();
        let target = root.path().join("escape/archive.zip");
        let entries = build_local_archive_manifest(&[source], &target).unwrap();

        assert!(matches!(
            create_local_archive(root.path(), &target, &entries, || false),
            Err(LocalArchiveError::TargetOutsideRoot)
        ));
    }
}
