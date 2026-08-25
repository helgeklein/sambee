//! Direct local ZIP archive creation with portable entry-name validation.

use std::collections::HashSet;
use std::fs::{self, File as FsFile, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use thiserror::Error;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;
use zip::write::{SimpleFileOptions, ZipWriter};
use zip::CompressionMethod;

/// Bounded source-read size for direct local archive output.
pub const ARCHIVE_COPY_BUFFER_SIZE: usize = 64 * 1024;

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
