//! Direct local ZIP archive creation with portable entry-name validation.

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File as FsFile, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, NaiveDate, Utc};
use flate2::{read::DeflateDecoder, write::DeflateEncoder, Compression};
use thiserror::Error;
use tokio::sync::mpsc::Receiver;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;
use zip::write::{SimpleFileOptions, StreamWriter, ZipWriter};
use zip::CompressionMethod;

/// Bounded source-read size for direct local archive output.
pub const ARCHIVE_COPY_BUFFER_SIZE: usize = 64 * 1024;
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
}

/// Summary of a completed local archive write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalArchiveCreationResult {
    pub files_created: u64,
    pub directories_created: u64,
    pub source_bytes: u64,
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
    files_created: u64,
    directories_created: u64,
    source_bytes: u64,
}

/// Summary of a completed local archive extraction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalArchiveExtractionResult {
    pub files_extracted: u64,
    pub directories_created: u64,
    pub extracted_bytes: u64,
    pub files_skipped: u64,
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

/// Return a bounded virtual-directory page without staging local archive contents.
pub fn list_local_archive_directory(
    archive_path: &Path,
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
    for entry in read_local_archive_entries(archive_path)? {
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
                is_available: !entry.encrypted && matches!(entry.compression_method, 0 | 8),
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
    if entry.encrypted || !matches!(entry.compression_method, 0 | 8) {
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

/// Extract safe and readable members into a destination directory that does not yet exist.
pub fn extract_local_archive_to_new_directory(
    drive_root: &Path,
    archive_path: &Path,
    destination_path: &Path,
) -> Result<LocalArchiveExtractionResult, LocalArchiveError> {
    if destination_path.exists() {
        return Err(LocalArchiveError::ExtractionTargetExists);
    }
    let entries = read_local_archive_entries(archive_path)?;
    if entries.iter().any(|entry| !entry.is_safe) {
        return Err(LocalArchiveError::UnsafeEntryPath);
    }
    if entries.iter().any(|entry| !entry.has_supported_file_type) {
        return Err(LocalArchiveError::UnsupportedArchiveMember);
    }
    validate_extraction_output_paths(&entries)?;
    revalidate_target_parent(drive_root, destination_path)?;
    fs::create_dir(destination_path)?;
    (|| {
        let mut files_extracted = 0;
        let mut directories_created = 1;
        let mut extracted_bytes = 0;
        let mut files_skipped = 0;
        let mut output_paths = HashSet::new();

        for entry in entries {
            if entry.is_directory {
                directories_created += ensure_extraction_directory(drive_root, destination_path, &destination_path.join(&entry.path))?;
                continue;
            }
            if entry.encrypted || !matches!(entry.compression_method, 0 | 8) {
                files_skipped += 1;
                continue;
            }
            if !output_paths.insert(collision_key(&entry.path)) {
                return Err(LocalArchiveError::DuplicateEntryPath);
            }
            let output_path = destination_path.join(&entry.path);
            let parent = output_path.parent().ok_or(LocalArchiveError::TargetOutsideRoot)?;
            directories_created += ensure_extraction_directory(drive_root, destination_path, parent)?;
            revalidate_target_parent(drive_root, &output_path)?;
            let mut output = OpenOptions::new().write(true).create_new(true).open(&output_path)?;
            stream_local_archive_member(archive_path, &entry.path, &mut output)?;
            output.flush()?;
            if let Some(modified_at) = entry.modified_at {
                output.set_modified(modified_at.into())?;
            }
            files_extracted += 1;
            extracted_bytes += entry.uncompressed_size;
        }
        Ok(LocalArchiveExtractionResult {
            files_extracted,
            directories_created,
            extracted_bytes,
            files_skipped,
        })
    })()
    .map_err(|error| LocalArchiveError::PartialOutput(Box::new(error)))
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
            && matches!(entry.compression_method, 0 | 8)
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

/// Create a new extraction root after revalidating its parent containment.
pub fn create_local_extraction_root(drive_root: &Path, destination_path: &Path) -> Result<(), LocalArchiveError> {
    if destination_path.exists() {
        return Err(LocalArchiveError::ExtractionTargetExists);
    }
    revalidate_target_parent(drive_root, destination_path)?;
    fs::create_dir(destination_path)?;
    Ok(())
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

/// Validate a manifest member path before combining it with a local destination root.
pub fn validate_local_extraction_member_path(member_path: &str, is_directory: bool) -> Result<(), LocalArchiveError> {
    normalized_archive_path(member_path, is_directory).map(|_| ())
}

/// Validate all remote creation entries before opening the local ZIP target.
pub fn validate_local_archive_creation_manifest(entries: &[(&str, bool)]) -> Result<(), LocalArchiveError> {
    let mut file_paths = HashSet::new();
    let mut directory_paths = HashSet::new();
    for (path, is_directory) in entries {
        let normalized = normalized_archive_path(path, *is_directory)?;
        let trimmed = normalized.trim_end_matches('/');
        let parts = trimmed.split('/').collect::<Vec<_>>();
        let directory_count = if *is_directory {
            parts.len()
        } else {
            parts.len().saturating_sub(1)
        };
        for index in 1..=directory_count {
            directory_paths.insert(collision_key(&parts[..index].join("/")));
        }
        if !*is_directory && !file_paths.insert(collision_key(trimmed)) {
            return Err(LocalArchiveError::DuplicateEntryPath);
        }
    }
    if !file_paths.is_disjoint(&directory_paths) {
        return Err(LocalArchiveError::DuplicateEntryPath);
    }
    Ok(())
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

fn source_name(path: &Path) -> Result<String, LocalArchiveError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or(LocalArchiveError::UnsafeEntryPath)
}

/// Build a complete recursive manifest from selected local sources.
pub fn build_local_archive_manifest(source_paths: &[PathBuf], target_path: &Path) -> Result<Vec<LocalArchiveEntry>, LocalArchiveError> {
    if target_path.exists() {
        return Err(LocalArchiveError::TargetExists);
    }
    build_local_archive_manifest_inner(source_paths, Some(target_path))
}

/// Build a complete recursive manifest for a ZIP target owned by another provider.
pub fn build_local_archive_manifest_for_remote_target(source_paths: &[PathBuf]) -> Result<Vec<LocalArchiveEntry>, LocalArchiveError> {
    build_local_archive_manifest_inner(source_paths, None)
}

fn build_local_archive_manifest_inner(
    source_paths: &[PathBuf],
    target_path: Option<&Path>,
) -> Result<Vec<LocalArchiveEntry>, LocalArchiveError> {
    let mut entries = Vec::new();
    let mut names = HashSet::new();

    fn visit(
        source_path: &Path,
        archive_path: &str,
        target_path: Option<&Path>,
        entries: &mut Vec<LocalArchiveEntry>,
        names: &mut HashSet<String>,
    ) -> Result<(), LocalArchiveError> {
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
        });
        if !is_directory {
            return Ok(());
        }

        let mut children = fs::read_dir(source_path)?.collect::<Result<Vec<_>, _>>()?;
        children.sort_by_key(|child| child.file_name());
        for child in children {
            let child_name = child.file_name().to_string_lossy().into_owned();
            visit(&child.path(), &format!("{}{child_name}", archive_path), target_path, entries, names)?;
        }
        Ok(())
    }

    for source_path in source_paths {
        visit(source_path, &source_name(source_path)?, target_path, &mut entries, &mut names)?;
    }
    if entries.is_empty() {
        return Err(LocalArchiveError::UnsupportedSource);
    }
    Ok(entries)
}

/// Create a ZIP directly at a previously non-existent local output path.
pub fn create_local_archive(
    drive_root: &Path,
    target_path: &Path,
    entries: &[LocalArchiveEntry],
    is_cancelled: impl Fn() -> bool,
) -> Result<LocalArchiveCreationResult, LocalArchiveError> {
    revalidate_target_parent(drive_root, target_path)?;
    let output = OpenOptions::new().write(true).create_new(true).open(target_path)?;
    write_local_archive_stream(output, entries, is_cancelled).map_err(|error| LocalArchiveError::PartialArchiveOutput(Box::new(error)))
}

/// Write a portable ZIP to an already-owned synchronous output stream.
pub fn write_local_archive_stream<W: Write>(
    output: W,
    entries: &[LocalArchiveEntry],
    is_cancelled: impl Fn() -> bool,
) -> Result<LocalArchiveCreationResult, LocalArchiveError> {
    (|| {
        let mut writer = ZipWriter::new_stream(output);
        let mut files_created = 0;
        let mut directories_created = 0;
        let mut source_bytes = 0;
        let mut buffer = vec![0; ARCHIVE_COPY_BUFFER_SIZE];

        for entry in entries {
            if is_cancelled() {
                return Err(LocalArchiveError::Cancelled);
            }
            if entry.is_directory {
                writer.add_directory(normalized_archive_path(&entry.archive_path, true)?, directory_options())?;
                directories_created += 1;
                continue;
            }
            let mut source = FsFile::open(&entry.source_path)?;
            let probe_size = source.read(&mut buffer)?;
            writer.start_file(
                normalized_archive_path(&entry.archive_path, false)?,
                regular_file_options(&buffer[..probe_size])?,
            )?;
            writer.write_all(&buffer[..probe_size])?;
            source_bytes += probe_size as u64;
            loop {
                if is_cancelled() {
                    return Err(LocalArchiveError::Cancelled);
                }
                let read = source.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                writer.write_all(&buffer[..read])?;
                source_bytes += read as u64;
            }
            files_created += 1;
        }

        let mut output = writer.finish()?;
        output.flush()?;
        Ok(LocalArchiveCreationResult {
            files_created,
            directories_created,
            source_bytes,
        })
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
pub fn create_local_archive_relay_writer(drive_root: &Path, target_path: &Path) -> Result<LocalArchiveRelayWriter, LocalArchiveError> {
    if target_path.exists() {
        return Err(LocalArchiveError::TargetExists);
    }
    revalidate_target_parent(drive_root, target_path)?;
    let output = OpenOptions::new().write(true).create_new(true).open(target_path)?;
    Ok(LocalArchiveRelayWriter {
        writer: ZipWriter::new_stream(output),
        files_created: 0,
        directories_created: 0,
        source_bytes: 0,
    })
}

impl LocalArchiveRelayWriter {
    /// Add one explicit directory entry to the local ZIP.
    pub fn add_directory(mut self, archive_path: &str) -> Result<Self, LocalArchiveError> {
        (|| {
            self.writer
                .add_directory(normalized_archive_path(archive_path, true)?, directory_options())?;
            self.directories_created += 1;
            Ok(self)
        })()
        .map_err(|error| LocalArchiveError::PartialArchiveOutput(Box::new(error)))
    }

    /// Write one regular member from a bounded asynchronous-relay channel.
    pub fn write_file(
        mut self,
        archive_path: &str,
        expected_size: u64,
        mut chunks: Receiver<LocalArchiveRelayChunk>,
    ) -> Result<Self, LocalArchiveError> {
        (|| {
            let (probe, pending_chunk, source_completed) = receive_compression_probe(&mut chunks)?;
            self.writer
                .start_file(normalized_archive_path(archive_path, false)?, regular_file_options(&probe)?)?;
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
            self.files_created += 1;
            self.source_bytes = self
                .source_bytes
                .checked_add(written)
                .ok_or_else(|| LocalArchiveError::Io(std::io::Error::other("Archive source size overflow")))?;
            Ok(self)
        })()
        .map_err(|error| LocalArchiveError::PartialArchiveOutput(Box::new(error)))
    }

    /// Finalize the ZIP central directory and return its creation summary.
    pub fn finish(self) -> Result<LocalArchiveCreationResult, LocalArchiveError> {
        (|| {
            let mut output = self.writer.finish()?;
            output.flush()?;
            Ok(LocalArchiveCreationResult {
                files_created: self.files_created,
                directories_created: self.directories_created,
                source_bytes: self.source_bytes,
            })
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
    use std::fs;

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

    fn conformance_corpus_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").join("archive_testdata")
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
    fn writes_relayed_members_to_a_readable_zip_without_staging() {
        let directory = tempdir().unwrap();
        let target = directory.path().join("archive.zip");
        let writer = create_local_archive_relay_writer(directory.path(), &target).unwrap();
        let (sender, receiver) = tokio::sync::mpsc::channel(2);
        sender.try_send(LocalArchiveRelayChunk::Data(b"notes".to_vec())).unwrap();
        sender.try_send(LocalArchiveRelayChunk::Complete).unwrap();
        let result = writer.write_file("notes.txt", 5, receiver).unwrap().finish().unwrap();

        assert_eq!(result.files_created, 1);
        assert_eq!(result.source_bytes, 5);
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
        let writer = create_local_archive_relay_writer(directory.path(), &target).unwrap();
        let content = vec![b'x'; ARCHIVE_COPY_BUFFER_SIZE];
        let (sender, receiver) = tokio::sync::mpsc::channel(2);
        sender.try_send(LocalArchiveRelayChunk::Data(content.clone())).unwrap();
        sender.try_send(LocalArchiveRelayChunk::Complete).unwrap();

        writer
            .write_file("notes.txt", content.len() as u64, receiver)
            .unwrap()
            .finish()
            .unwrap();

        assert_eq!(validate_local_archive_member(&target, "notes.txt").unwrap().compression_method, 8);
    }

    #[test]
    fn rejects_colliding_relay_manifest_before_opening_output() {
        assert!(matches!(
            validate_local_archive_creation_manifest(&[("folder", false), ("folder/child.txt", false)]),
            Err(LocalArchiveError::DuplicateEntryPath)
        ));
    }

    #[test]
    fn reports_partial_archive_output_after_source_read_failure() {
        let directory = tempdir().unwrap();
        let target = directory.path().join("archive.zip");
        let entries = [LocalArchiveEntry {
            source_path: directory.path().join("missing.txt"),
            archive_path: "missing.txt".to_string(),
            is_directory: false,
        }];

        assert!(matches!(
            create_local_archive(directory.path(), &target, &entries, || false),
            Err(LocalArchiveError::PartialArchiveOutput(_))
        ));
        assert!(target.is_file());
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

        let first_page = list_local_archive_directory(&target, "source/", None, 1).unwrap();
        assert_eq!(first_page.total, 2);
        assert_eq!(first_page.entries[0].name, "nested");
        assert!(first_page.entries[0].is_directory);
        assert_eq!(first_page.next_cursor.as_deref(), Some("1"));

        let second_page = list_local_archive_directory(&target, "source/", first_page.next_cursor.as_deref(), 1).unwrap();
        assert_eq!(second_page.entries[0].name, "alpha.txt");
        assert_eq!(second_page.entries[0].uncompressed_size, Some(5));
        assert_eq!(second_page.next_cursor, None);
        assert!(matches!(
            list_local_archive_directory(&target, "../unsafe/", None, 100),
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
        assert!(matches!(
            extract_local_archive_to_new_directory(directory.path(), &archive_path, &destination),
            Err(LocalArchiveError::ExtractionTargetExists)
        ));
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

        assert!(list_local_archive_directory(&archive_path, "", None, 100)
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
