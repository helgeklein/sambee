//! macOS app registry — enumerates native applications via Launch Services
//! and Core Foundation APIs.
//!
//! Uses `LSCopyApplicationURLsForURL()` and `NSWorkspace` to find applications
//! registered for a given file type.
//!
//! This is a compile-target stub. Full implementation requires the `objc2`
//! and `core-foundation` crates and can only be built/tested on macOS.

use super::{AppRegistry, NativeApp};

/// macOS-specific app registry using Launch Services.
#[allow(dead_code)]
pub struct MacosAppRegistry;

impl MacosAppRegistry {
    //
    // new
    //
    /// Create a new macOS app registry.
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self
    }
}

impl AppRegistry for MacosAppRegistry {
    //
    // apps_for_extension
    //
    fn apps_for_extension(&self, _extension: &str) -> Vec<NativeApp> {
        // TODO: Implement using LSCopyApplicationURLsForURL / NSWorkspace
        Vec::new()
    }

    //
    // apps_for_mime
    //
    fn apps_for_mime(&self, _mime: &str) -> Vec<NativeApp> {
        // TODO: Implement using LSCopyApplicationURLsForURL / NSWorkspace
        Vec::new()
    }
}
