//! Temp directory management for file edit sessions.
//!
//! Each edit session gets its own subdirectory under
//! `{temp}/sambee-companion/{operation-id}/`. The downloaded file is named
//! with a `-copy` suffix to make it clear it's a working copy.
//!
//! **Principle: Never lose user edits.** Active temp files are never deleted
//! automatically. Only the recycle bin performs automatic cleanup.

use std::fs;
use std::path::{Path, PathBuf};

use log::{debug, warn};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Root directory name under the OS temp directory.
const COMPANION_TEMP_DIR: &str = "sambee-companion";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

//
// companion_temp_root
//
/// Returns the root temp directory for the companion: `{temp}/sambee-companion/`.
///
/// Creates the directory if it doesn't exist.
pub fn companion_temp_root() -> Result<PathBuf, String> {
    let root = std::env::temp_dir().join(COMPANION_TEMP_DIR);
    fs::create_dir_all(&root).map_err(|e| {
        format!(
            "Failed to create companion temp root {}: {e}",
            root.display()
        )
    })?;
    Ok(root)
}

//
// create_operation_dir
//
/// Create the temp directory for an operation: `{temp}/sambee-companion/{operation-id}/`.
///
/// Returns the full path to the directory.
pub fn create_operation_dir(operation_id: &uuid::Uuid) -> Result<PathBuf, String> {
    let root = companion_temp_root()?;
    let dir = root.join(operation_id.to_string());
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create operation dir {}: {e}", dir.display()))?;
    debug!("Created operation dir: {}", dir.display());
    Ok(dir)
}

//
// temp_file_path
//
/// Compute the local temp file path for a remote file.
///
/// Naming convention: `{stem}-copy.{ext}` (or `{name}-copy` if no extension).
///
/// Examples:
/// - `report.docx` → `report-copy.docx`
/// - `archive.tar.gz` → `archive.tar-copy.gz`
/// - `Makefile` → `Makefile-copy`
pub fn temp_file_path(operation_dir: &Path, remote_path: &str) -> PathBuf {
    let filename = remote_path.rsplit('/').next().unwrap_or(remote_path);

    let copy_name = make_copy_name(filename);
    operation_dir.join(copy_name)
}

//
// make_copy_name
//
/// Add `-copy` suffix before the extension.
///
/// - `report.docx` → `report-copy.docx`
/// - `archive.tar.gz` → `archive.tar-copy.gz`
/// - `Makefile` → `Makefile-copy`
fn make_copy_name(filename: &str) -> String {
    match filename.rfind('.') {
        Some(dot_pos) if dot_pos > 0 => {
            let stem = &filename[..dot_pos];
            let ext = &filename[dot_pos..]; // includes the dot
            format!("{stem}-copy{ext}")
        }
        _ => {
            // No extension or dot at position 0 (hidden file like `.bashrc`)
            format!("{filename}-copy")
        }
    }
}

//
// scan_leftover_operations
//
/// Scan the companion temp root for leftover operation directories from
/// previous sessions (directories containing `operation.json`).
///
/// Returns a list of `(operation_dir, sidecar_path)` pairs.
pub fn scan_leftover_operations() -> Vec<(PathBuf, PathBuf)> {
    let root = match companion_temp_root() {
        Ok(r) => r,
        Err(e) => {
            warn!("Cannot scan for leftover operations: {e}");
            return Vec::new();
        }
    };

    let mut leftovers = Vec::new();

    let entries = match fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Skip the recycle bin directory
        if path.file_name().is_some_and(|n| n == "recycle") {
            continue;
        }

        let sidecar = path.join(super::operations::SIDECAR_FILENAME);
        if sidecar.is_file() {
            leftovers.push((path, sidecar));
        }
    }

    leftovers
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    //
    // test_make_copy_name_basic
    //
    #[test]
    fn test_make_copy_name_basic() {
        assert_eq!(make_copy_name("report.docx"), "report-copy.docx");
        assert_eq!(make_copy_name("photo.png"), "photo-copy.png");
    }

    //
    // test_make_copy_name_multi_dot
    //
    #[test]
    fn test_make_copy_name_multi_dot() {
        assert_eq!(make_copy_name("archive.tar.gz"), "archive.tar-copy.gz");
        assert_eq!(make_copy_name("my.file.name.txt"), "my.file.name-copy.txt");
    }

    //
    // test_make_copy_name_no_extension
    //
    #[test]
    fn test_make_copy_name_no_extension() {
        assert_eq!(make_copy_name("Makefile"), "Makefile-copy");
        assert_eq!(make_copy_name("README"), "README-copy");
    }

    //
    // test_make_copy_name_hidden_file
    //
    #[test]
    fn test_make_copy_name_hidden_file() {
        assert_eq!(make_copy_name(".bashrc"), ".bashrc-copy");
        assert_eq!(make_copy_name(".env"), ".env-copy");
    }

    //
    // test_temp_file_path
    //
    #[test]
    fn test_temp_file_path() {
        let dir = PathBuf::from("/tmp/sambee-companion/abc-123");
        let path = temp_file_path(&dir, "/docs/report.docx");
        assert_eq!(
            path,
            PathBuf::from("/tmp/sambee-companion/abc-123/report-copy.docx")
        );
    }

    //
    // test_temp_file_path_nested
    //
    #[test]
    fn test_temp_file_path_nested() {
        let dir = PathBuf::from("/tmp/sambee-companion/abc-123");
        let path = temp_file_path(&dir, "/deep/nested/folder/data.csv");
        assert_eq!(
            path,
            PathBuf::from("/tmp/sambee-companion/abc-123/data-copy.csv")
        );
    }

    //
    // test_create_operation_dir
    //
    #[test]
    fn test_create_operation_dir() {
        let id = uuid::Uuid::new_v4();
        let dir = create_operation_dir(&id).unwrap();
        assert!(dir.is_dir());
        // Clean up
        let _ = fs::remove_dir_all(&dir);
    }
}
