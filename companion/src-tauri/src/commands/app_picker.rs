//! Tauri commands for querying and selecting native applications.
//!
//! Exposes `get_apps_for_file` to the frontend, which enumerates native
//! desktop applications that can open a given file extension.

use crate::app_registry::{get_registry, NativeApp};
use crate::{PendingAppPickerRequest, PendingMainWindowAppPicker};

//
// get_apps_for_file
//
/// Returns a list of native applications that can open files with the given extension.
///
/// The extension should be provided without a leading dot (e.g. "docx", "png").
/// The default handler (if any) is marked with `is_default: true` and listed first.
#[tauri::command]
pub fn get_apps_for_file(extension: String) -> Vec<NativeApp> {
    let registry = get_registry();
    registry.apps_for_extension(&extension)
}

#[tauri::command]
pub fn consume_pending_app_picker(pending_app_picker: tauri::State<'_, PendingMainWindowAppPicker>) -> Option<PendingAppPickerRequest> {
    pending_app_picker.get()
}
