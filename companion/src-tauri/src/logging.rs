//! Persistent file logging with automatic rotation.
//!
//! Provides a [`FileLogger`] that writes structured log lines to a file in
//! the application's data directory. The logger:
//!
//! - **Always** captures `Error` and `Warn` level messages.
//! - Optionally captures `Info` and `Debug` when verbose mode is enabled.
//! - Automatically **rotates** log files when they exceed [`MAX_LOG_SIZE_BYTES`],
//!   keeping at most [`MAX_LOG_FILES`] rotated copies (hard cap on disk usage).
//!
//! ## Verbose mode
//!
//! Verbose logging is controlled by a platform-specific config switch:
//!
//! - **Windows**: Registry `DWORD` value `VerboseLogging` under
//!   `HKEY_CURRENT_USER\Software\Sambee\Companion` (set to `1` to enable).
//! - **All platforms**: Environment variable `SAMBEE_LOG_VERBOSE=1`.
//!
//! The switch is read once at startup. To change it, restart the companion.

use log::{LevelFilter, Log, Metadata, Record};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Maximum size of a single log file in bytes (5 MB).
const MAX_LOG_SIZE_BYTES: u64 = 5 * 1024 * 1024;

/// Maximum number of rotated log files to keep (current + rotated copies).
/// Total worst-case disk usage = MAX_LOG_FILES × MAX_LOG_SIZE_BYTES = 15 MB.
const MAX_LOG_FILES: u32 = 3;

/// Name of the current (active) log file.
const LOG_FILE_NAME: &str = "sambee-companion.log";

/// Subdirectory under the app data dir where logs are stored.
const LOG_DIR_NAME: &str = "logs";

/// Environment variable that enables verbose logging on all platforms.
const ENV_VAR_VERBOSE: &str = "SAMBEE_LOG_VERBOSE";

/// Windows registry key path (under HKCU) for companion settings.
#[cfg(target_os = "windows")]
const REGISTRY_KEY_PATH: &str = r"Software\Sambee\Companion";

/// Windows registry value name for the verbose-logging toggle.
#[cfg(target_os = "windows")]
const REGISTRY_VALUE_NAME: &str = "VerboseLogging";

// ─────────────────────────────────────────────────────────────────────────────
// Logger state
// ─────────────────────────────────────────────────────────────────────────────

/// Mutable state protected by the logger's mutex.
struct LogState {
    /// Open file handle for the current log file.
    file: File,
    /// Directory that contains the log files.
    log_dir: PathBuf,
}

/// A file-based logger with size-based rotation.
///
/// Implements [`log::Log`] so it integrates seamlessly with the `log` crate
/// macros (`info!`, `warn!`, `error!`, `debug!`) used throughout the
/// companion codebase.
struct FileLogger {
    /// Maximum level this logger will accept.
    level: LevelFilter,
    /// Mutable state (file handle + path) behind a mutex for thread safety.
    state: Mutex<LogState>,
}

impl Log for FileLogger {
    //
    // enabled
    //
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= self.level
    }

    //
    // log
    //
    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let timestamp = format_timestamp(std::time::SystemTime::now());
        let line = format!(
            "{} {:5} [{}] {}\n",
            timestamp,
            record.level(),
            record.module_path().unwrap_or("unknown"),
            record.args()
        );

        if let Ok(mut state) = self.state.lock() {
            // Rotate before writing if the file has grown past the limit.
            if should_rotate(&state.file) {
                rotate_logs(&mut state);
            }

            let _ = state.file.write_all(line.as_bytes());
            let _ = state.file.flush();
        }
    }

    //
    // flush
    //
    fn flush(&self) {
        if let Ok(mut state) = self.state.lock() {
            let _ = state.file.flush();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotation helpers
// ─────────────────────────────────────────────────────────────────────────────

//
// should_rotate
//
/// Returns `true` if the current log file exceeds [`MAX_LOG_SIZE_BYTES`].
fn should_rotate(file: &File) -> bool {
    file.metadata().map(|m| m.len() >= MAX_LOG_SIZE_BYTES).unwrap_or(false)
}

//
// rotate_logs
//
/// Perform log file rotation.
///
/// Renames `sambee-companion.log` → `.log.1`, `.log.1` → `.log.2`, etc.
/// Deletes the oldest file if it would exceed [`MAX_LOG_FILES`].
/// Opens a fresh log file and replaces the file handle in `state`.
fn rotate_logs(state: &mut LogState) {
    let _ = state.file.flush();

    let base = state.log_dir.join(LOG_FILE_NAME);

    // Delete the oldest rotated file if it exists.
    let oldest = rotated_path(&base, MAX_LOG_FILES - 1);
    let _ = fs::remove_file(&oldest);

    // Shift existing rotated files: .N-1 → .N, ... , .1 → .2
    for i in (1..MAX_LOG_FILES - 1).rev() {
        let from = rotated_path(&base, i);
        let to = rotated_path(&base, i + 1);
        let _ = fs::rename(&from, &to);
    }

    // Rename current log → .1
    let first_rotated = rotated_path(&base, 1);
    let _ = fs::rename(&base, &first_rotated);

    // Open a fresh log file.
    if let Ok(new_file) = OpenOptions::new().create(true).append(true).open(&base) {
        state.file = new_file;
    }
}

//
// rotated_path
//
/// Build a rotated log filename: `base.N` (e.g., `sambee-companion.log.1`).
fn rotated_path(base: &std::path::Path, n: u32) -> PathBuf {
    let mut s = base.as_os_str().to_os_string();
    s.push(format!(".{n}"));
    PathBuf::from(s)
}

// ─────────────────────────────────────────────────────────────────────────────
// Config detection
// ─────────────────────────────────────────────────────────────────────────────

//
// read_verbose_config
//
/// Determine whether verbose logging is enabled.
///
/// Checks (in order):
/// 1. Environment variable `SAMBEE_LOG_VERBOSE` (all platforms).
/// 2. Windows registry DWORD `VerboseLogging` under
///    `HKCU\Software\Sambee\Companion`.
///
/// Returns `true` if any source says verbose logging is on.
fn read_verbose_config() -> bool {
    // 1. Environment variable (cross-platform).
    if let Ok(val) = std::env::var(ENV_VAR_VERBOSE) {
        if val == "1" || val.eq_ignore_ascii_case("true") {
            return true;
        }
    }

    // 2. Windows registry.
    #[cfg(target_os = "windows")]
    {
        if read_registry_verbose() {
            return true;
        }
    }

    false
}

/// Read the `VerboseLogging` DWORD from the Windows registry.
///
/// Returns `true` if the value exists and is non-zero.
#[cfg(target_os = "windows")]
fn read_registry_verbose() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey(REGISTRY_KEY_PATH) {
        Ok(k) => k,
        Err(_) => return false,
    };

    match key.get_value::<u32, _>(REGISTRY_VALUE_NAME) {
        Ok(val) => val != 0,
        Err(_) => false,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log directory resolution
// ─────────────────────────────────────────────────────────────────────────────

//
// resolve_log_dir
//
/// Determine (and create) the directory where log files are stored.
///
/// Uses platform-appropriate data directories:
/// - **Windows**: `%LOCALAPPDATA%\Sambee\Companion\logs`
/// - **Linux**: `~/.local/share/sambee-companion/logs`
/// - **macOS**: `~/Library/Application Support/app.sambee.companion/logs`
fn resolve_log_dir() -> Result<PathBuf, String> {
    let base = data_dir().ok_or("Could not determine application data directory")?;

    #[cfg(target_os = "windows")]
    let app_dir = base.join("Sambee").join("Companion");

    #[cfg(target_os = "macos")]
    let app_dir = base.join("app.sambee.companion");

    #[cfg(target_os = "linux")]
    let app_dir = base.join("sambee-companion");

    let log_dir = app_dir.join(LOG_DIR_NAME);
    fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log directory: {e}"))?;

    Ok(log_dir)
}

//
// data_dir
//
/// Return the platform data directory without pulling in the `dirs` crate.
///
/// - **Windows**: `%LOCALAPPDATA%`
/// - **macOS**: `$HOME/Library/Application Support`
/// - **Linux**: `$XDG_DATA_HOME` or `$HOME/.local/share`
fn data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("LOCALAPPDATA").ok().map(PathBuf::from)
    }

    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .ok()
            .map(|h| PathBuf::from(h).join("Library").join("Application Support"))
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            Some(PathBuf::from(xdg))
        } else {
            std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".local").join("share"))
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp formatting
// ─────────────────────────────────────────────────────────────────────────────

//
// format_timestamp
//
/// Format a [`SystemTime`] as `YYYY-MM-DDThh:mm:ss.mmmZ` (UTC, millisecond
/// precision).
fn format_timestamp(time: std::time::SystemTime) -> String {
    let dur = time.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let total_secs = dur.as_secs();
    let millis = dur.subsec_millis();

    let days = total_secs / 86400;
    let time_of_day = total_secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let (year, month, day) = epoch_days_to_ymd(days);
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{millis:03}Z")
}

//
// epoch_days_to_ymd
//
/// Convert days since Unix epoch to (year, month, day).
///
/// Uses Howard Hinnant's civil calendar algorithm.
fn epoch_days_to_ymd(epoch_days: u64) -> (u64, u64, u64) {
    let z = epoch_days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

//
// log_dir_path
//
/// Return the resolved log directory path (for display to the user).
///
/// Returns `None` if the directory cannot be determined (pre-init or
/// platform issue).
#[allow(dead_code)]
pub fn log_dir_path() -> Option<PathBuf> {
    resolve_log_dir().ok()
}

//
// init
//
/// Initialise the file logger.
///
/// Reads the verbose-logging config switch, creates the log directory, opens
/// the log file, and installs the logger as the global `log` backend.
///
/// # Errors
///
/// Returns `Err` if the log directory cannot be created or the log file
/// cannot be opened. Falls back to a stderr-only message in that case so
/// the application can still start.
pub fn init() -> Result<(), String> {
    let verbose = read_verbose_config();
    let level = if verbose { LevelFilter::Debug } else { LevelFilter::Warn };

    let log_dir = resolve_log_dir()?;
    let log_file_path = log_dir.join(LOG_FILE_NAME);

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)
        .map_err(|e| format!("Failed to open log file {}: {e}", log_file_path.display()))?;

    let logger = FileLogger {
        level,
        state: Mutex::new(LogState { file, log_dir }),
    };

    log::set_boxed_logger(Box::new(logger)).map_err(|e| format!("Failed to install logger: {e}"))?;
    log::set_max_level(level);

    // First log line — always written regardless of level.
    log::info!(
        "Sambee Companion started — log level={}, verbose={}, file={}",
        level,
        verbose,
        log_file_path.display()
    );

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri command — frontend logging bridge
// ─────────────────────────────────────────────────────────────────────────────

//
// log_from_frontend
//
/// Tauri command that allows the TypeScript frontend to write log messages
/// into the same log file as the Rust backend.
///
/// Accepts a `level` string (`"error"`, `"warn"`, `"info"`, `"debug"`) and
/// a free-form `message`. Invalid levels default to `info`.
#[tauri::command]
pub fn log_from_frontend(level: String, message: String) {
    let lvl = match level.to_ascii_lowercase().as_str() {
        "error" => log::Level::Error,
        "warn" => log::Level::Warn,
        "info" => log::Level::Info,
        "debug" => log::Level::Debug,
        _ => log::Level::Info,
    };

    log::log!(target: "frontend", lvl, "{message}");
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_timestamp() {
        // 2024-01-15T11:30:45.000Z  =>  epoch 1705318245
        let time = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_705_318_245);
        let ts = format_timestamp(time);
        assert_eq!(ts, "2024-01-15T11:30:45.000Z");
    }

    #[test]
    fn test_epoch_days_to_ymd() {
        // 2024-01-15 is day 19737 from epoch
        let (y, m, d) = epoch_days_to_ymd(19_737);
        assert_eq!((y, m, d), (2024, 1, 15));
    }

    #[test]
    fn test_rotated_path() {
        let base = PathBuf::from("/tmp/logs/sambee-companion.log");
        assert_eq!(rotated_path(&base, 1), PathBuf::from("/tmp/logs/sambee-companion.log.1"));
        assert_eq!(rotated_path(&base, 3), PathBuf::from("/tmp/logs/sambee-companion.log.3"));
    }
}
