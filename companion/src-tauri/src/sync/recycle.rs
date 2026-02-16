//! Recycle bin for completed/discarded edit sessions.
//!
//! When an edit session ends (upload or discard), the temp file is **moved**
//! (not deleted) to a recycle bin directory. Files are kept for 7 days and
//! then automatically cleaned up.
//!
//! Directory: `{temp}/sambee-companion/recycle/`
//! Filename format: `{stem}-copy-{YYYYMMDD-HHmmss}.{ext}`

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use log::{debug, info, warn};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Subdirectory name for the recycle bin under the companion temp root.
const RECYCLE_DIR: &str = "recycle";

/// How long recycled files are kept before automatic deletion.
const RECYCLE_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60); // 7 days

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

//
// recycle_bin_dir
//
/// Returns the recycle bin directory, creating it if necessary.
pub fn recycle_bin_dir() -> Result<PathBuf, String> {
    let root = super::temp::companion_temp_root()?;
    let dir = root.join(RECYCLE_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create recycle bin {}: {e}", dir.display()))?;
    Ok(dir)
}

//
// recycle_file
//
/// Move a temp file to the recycle bin with a timestamped name.
///
/// The original operation directory is removed after the file is moved.
/// Returns the path of the file in the recycle bin.
pub fn recycle_file(source: &Path) -> Result<PathBuf, String> {
    let recycle_dir = recycle_bin_dir()?;
    let filename = source
        .file_name()
        .ok_or_else(|| "Cannot determine filename".to_string())?
        .to_string_lossy();

    let recycled_name = make_recycled_name(&filename);
    let dest = recycle_dir.join(&recycled_name);

    // Move (rename if same filesystem, copy+delete otherwise)
    if fs::rename(source, &dest).is_err() {
        fs::copy(source, &dest).map_err(|e| format!("Failed to copy {} to recycle bin: {e}", source.display()))?;
        let _ = fs::remove_file(source);
    }

    // Clean up the operation directory (parent of the source file)
    if let Some(op_dir) = source.parent() {
        let _ = fs::remove_dir_all(op_dir);
    }

    info!("Recycled file: {} → {}", source.display(), dest.display());
    Ok(dest)
}

//
// cleanup_expired
//
/// Delete recycled files older than 7 days.
///
/// Returns the number of files cleaned up.
pub fn cleanup_expired() -> usize {
    let recycle_dir = match recycle_bin_dir() {
        Ok(d) => d,
        Err(e) => {
            warn!("Cannot access recycle bin for cleanup: {e}");
            return 0;
        }
    };

    let entries = match fs::read_dir(&recycle_dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };

    let now = SystemTime::now();
    let mut cleaned = 0;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let modified = match metadata.modified() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let age = now.duration_since(modified).unwrap_or(Duration::ZERO);
        if age > RECYCLE_TTL && fs::remove_file(&path).is_ok() {
            debug!("Cleaned up expired recycled file: {}", path.display());
            cleaned += 1;
        }
    }

    if cleaned > 0 {
        info!("Recycle bin cleanup: removed {cleaned} expired file(s)");
    }

    cleaned
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

//
// make_recycled_name
//
/// Create a timestamped recycled filename.
///
/// `report-copy.docx` → `report-copy-20260210-143022.docx`
/// `Makefile-copy` → `Makefile-copy-20260210-143022`
fn make_recycled_name(filename: &str) -> String {
    let now = chrono_timestamp();

    match filename.rfind('.') {
        Some(dot_pos) if dot_pos > 0 => {
            let stem = &filename[..dot_pos];
            let ext = &filename[dot_pos..]; // includes the dot
            format!("{stem}-{now}{ext}")
        }
        _ => {
            format!("{filename}-{now}")
        }
    }
}

//
// chrono_timestamp
//
/// Generate a `YYYYMMDD-HHmmss` timestamp string.
fn chrono_timestamp() -> String {
    use std::time::UNIX_EPOCH;

    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO).as_secs();

    // Convert epoch seconds to date/time components
    let days = secs / 86400;
    let time_secs = secs % 86400;

    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    // Compute year/month/day from days since epoch (civil calendar)
    let (year, month, day) = days_to_ymd(days);

    format!("{year:04}{month:02}{day:02}-{hours:02}{minutes:02}{seconds:02}")
}

//
// days_to_ymd
//
/// Convert days since Unix epoch to (year, month, day).
///
/// Uses the algorithm from Howard Hinnant's `<chrono>`-based date library.
fn days_to_ymd(days: u64) -> (u64, u64, u64) {
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    (y, m, d)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    //
    // test_make_recycled_name_with_extension
    //
    #[test]
    fn test_make_recycled_name_with_extension() {
        let name = make_recycled_name("report-copy.docx");
        // Should match pattern: report-copy-YYYYMMDD-HHmmss.docx
        assert!(name.starts_with("report-copy-"));
        assert!(name.ends_with(".docx"));
        // Timestamp part: 15 chars (YYYYMMDD-HHmmss)
        let mid = &name["report-copy-".len()..name.len() - ".docx".len()];
        assert_eq!(mid.len(), 15);
        assert_eq!(&mid[8..9], "-");
    }

    //
    // test_make_recycled_name_no_extension
    //
    #[test]
    fn test_make_recycled_name_no_extension() {
        let name = make_recycled_name("Makefile-copy");
        assert!(name.starts_with("Makefile-copy-"));
        // No extension, so just timestamp at end
        let mid = &name["Makefile-copy-".len()..];
        assert_eq!(mid.len(), 15);
    }

    //
    // test_recycle_file
    //
    #[test]
    fn test_recycle_file() {
        let dir = tempfile::tempdir().unwrap();
        let op_dir = dir.path().join("op-123");
        fs::create_dir_all(&op_dir).unwrap();

        let source = op_dir.join("report-copy.docx");
        fs::write(&source, b"test content").unwrap();

        let recycled = recycle_file(&source).unwrap();
        assert!(recycled.exists());
        assert!(!source.exists());
        // Operation dir should be cleaned up
        assert!(!op_dir.exists());

        // Verify recycled file name pattern
        let name = recycled.file_name().unwrap().to_string_lossy();
        assert!(name.starts_with("report-copy-"));
        assert!(name.ends_with(".docx"));
    }

    //
    // test_days_to_ymd
    //
    #[test]
    fn test_days_to_ymd() {
        // 2026-02-10 is day 20494 since epoch
        // Let's verify a known date: 1970-01-01 = day 0
        let (y, m, d) = days_to_ymd(0);
        assert_eq!((y, m, d), (1970, 1, 1));

        // 2000-01-01 = day 10957
        let (y, m, d) = days_to_ymd(10957);
        assert_eq!((y, m, d), (2000, 1, 1));
    }

    //
    // test_cleanup_expired
    //
    #[test]
    fn test_cleanup_expired() {
        // Just verify it doesn't panic on an empty/normal recycle bin
        let _count = cleanup_expired();
    }
}
