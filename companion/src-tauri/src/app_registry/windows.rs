//! Windows app registry — enumerates native applications via the Windows
//! Registry and COM APIs.
//!
//! Uses `SHAssocEnumHandlers()` and Registry queries under
//! `HKEY_CLASSES_ROOT` to find applications registered for a given file type.
//!
//! This is a compile-target stub. Full implementation requires the `windows`
//! crate and can only be built/tested on Windows.

use super::{AppRegistry, NativeApp};

/// Windows-specific app registry using COM and Registry APIs.
#[allow(dead_code)]
pub struct WindowsAppRegistry;

impl WindowsAppRegistry {
    //
    // new
    //
    /// Create a new Windows app registry.
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self
    }
}

impl AppRegistry for WindowsAppRegistry {
    //
    // apps_for_extension
    //
    fn apps_for_extension(&self, _extension: &str) -> Vec<NativeApp> {
        // TODO: Implement using SHAssocEnumHandlers / Registry queries
        Vec::new()
    }

    //
    // apps_for_mime
    //
    fn apps_for_mime(&self, _mime: &str) -> Vec<NativeApp> {
        // TODO: Implement using SHAssocEnumHandlers / Registry queries
        Vec::new()
    }
}
