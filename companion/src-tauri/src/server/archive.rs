//! Direct local ZIP archive creation with portable entry-name validation.

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File as FsFile, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, NaiveDate, Utc};
use flate2::read::DeflateDecoder;
use thiserror::Error;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;
use zip::write::{SimpleFileOptions, ZipWriter};
use zip::CompressionMethod;

/// Bounded source-read size for direct local archive output.
pub const ARCHIVE_COPY_BUFFER_SIZE: usize = 64 * 1024;
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

/// Errors returned by local direct archive creation.
#[derive(Debug, Error)]
pub enum LocalArchiveError {
    #[error("archive entry path is unsafe")]
    UnsafeEntryPath,
    #[error("archive output already exists")]
    TargetExists,
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
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
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

fn decode_entry_name(raw_name: &[u8], flags: u16) -> String {
    if flags & 0x0800 != 0 {
        String::from_utf8_lossy(raw_name).into_owned()
    } else {
        // CP437 filenames are rare in current archives. Lossy decoding preserves
        // bounded parsing while unsafe paths are still rejected below.
        String::from_utf8_lossy(raw_name).into_owned()
    }
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
        let decoded_name = decode_entry_name(&raw_name, flags);
        let (path, is_directory) = normalize_virtual_path(&decoded_name);
        let (compressed_size, uncompressed_size, local_header_offset) = zip64_member_values(
            &variable[name_length..name_length + extra_length],
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
        if !entry.is_safe || !entry.path.starts_with(&prefix) {
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
        .find(|candidate| candidate.is_safe && !candidate.is_directory && candidate.path == normalized_path)
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

    let mut entries = Vec::new();
    let mut names = HashSet::new();

    fn visit(
        source_path: &Path,
        archive_path: &str,
        target_path: &Path,
        entries: &mut Vec<LocalArchiveEntry>,
        names: &mut HashSet<String>,
    ) -> Result<(), LocalArchiveError> {
        let metadata = fs::symlink_metadata(source_path)?;
        let is_directory = metadata.file_type().is_dir();
        if !is_directory && !metadata.file_type().is_file() {
            return Err(LocalArchiveError::UnsupportedSource);
        }
        if is_directory && target_path.starts_with(source_path) {
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
    let mut writer = ZipWriter::new_stream(output);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(6));
    let mut files_created = 0;
    let mut directories_created = 0;
    let mut source_bytes = 0;
    let mut buffer = vec![0; ARCHIVE_COPY_BUFFER_SIZE];

    for entry in entries {
        if is_cancelled() {
            return Err(LocalArchiveError::Cancelled);
        }
        if entry.is_directory {
            writer.add_directory(normalized_archive_path(&entry.archive_path, true)?, options)?;
            directories_created += 1;
            continue;
        }
        writer.start_file(normalized_archive_path(&entry.archive_path, false)?, options)?;
        let mut source = FsFile::open(&entry.source_path)?;
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

    use tempfile::tempdir;
    use zip::ZipArchive;

    use super::*;

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
        let mut archive = ZipArchive::new(FsFile::open(target).unwrap()).unwrap();
        assert_eq!(
            archive.file_names().collect::<Vec<_>>(),
            ["source/", "source/empty/", "source/notes.txt"]
        );
        let mut notes = String::new();
        archive.by_name("source/notes.txt").unwrap().read_to_string(&mut notes).unwrap();
        assert_eq!(notes, "notes");
    }

    #[test]
    fn lists_safe_virtual_archive_directories_in_bounded_pages() {
        let directory = tempdir().unwrap();
        let source_root = directory.path().join("source");
        fs::create_dir_all(source_root.join("nested")).unwrap();
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
        fs::write(&source, b"local archive member").unwrap();
        let target = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &target).unwrap();
        create_local_archive(directory.path(), &target, &entries, || false).unwrap();

        let member = validate_local_archive_member(&target, "notes.txt").unwrap();
        assert_eq!(member.compression_method, 8);
        let mut output = Vec::new();
        stream_local_archive_member(&target, "notes.txt", &mut output).unwrap();
        assert_eq!(output, b"local archive member");
        assert!(matches!(
            validate_local_archive_member(&target, "../notes.txt"),
            Err(LocalArchiveReadError::InvalidMemberPath)
        ));
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
