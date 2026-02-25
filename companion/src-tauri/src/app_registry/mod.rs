//! Native application registry.
//!
//! Enumerates desktop applications registered to handle specific file types.
//! Platform-specific implementations query the OS app registry (Windows Registry,
//! macOS Launch Services, Linux mimeapps.list) to build the app picker UI.

#[cfg(target_os = "linux")]
pub mod linux;

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "macos")]
pub mod macos;

use std::path::PathBuf;

use serde::Serialize;

/// A native desktop application that can open a given file type.
#[derive(Debug, Clone, Serialize)]
pub struct NativeApp {
    /// Display name shown in the app picker (e.g. "LibreOffice Writer").
    pub name: String,

    /// Path to the application executable.
    pub executable: PathBuf,

    /// Optional Base64-encoded PNG icon bytes for display in the picker UI.
    pub icon: Option<String>,

    /// Whether this app is the OS default handler for the file type.
    pub is_default: bool,
}

/// Trait for platform-specific app enumeration.
///
/// Each supported OS implements this trait to query its native app registry.
#[allow(dead_code)]
pub trait AppRegistry {
    /// Returns applications registered to handle the given file extension
    /// (without leading dot, e.g. "docx").
    fn apps_for_extension(&self, extension: &str) -> Vec<NativeApp>;

    /// Returns applications registered to handle the given MIME type
    /// (e.g. "application/vnd.openxmlformats-officedocument.wordprocessingml.document").
    fn apps_for_mime(&self, mime: &str) -> Vec<NativeApp>;
}

//
// get_registry
//
/// Returns the platform-appropriate `AppRegistry` implementation.
pub fn get_registry() -> Box<dyn AppRegistry> {
    #[cfg(target_os = "windows")]
    {
        Box::new(windows::WindowsAppRegistry::new())
    }

    #[cfg(target_os = "macos")]
    {
        Box::new(macos::MacosAppRegistry::new())
    }

    #[cfg(target_os = "linux")]
    {
        Box::new(linux::LinuxAppRegistry::new())
    }
}
