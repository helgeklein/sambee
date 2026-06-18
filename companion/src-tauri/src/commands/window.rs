//! Tauri commands for Rust-managed companion window operations.

use log::info;
use tauri::{AppHandle, Manager};

/// Hide an existing companion window by label.
#[tauri::command]
pub fn hide_window(app: AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window not found: {label}"))?;

    window.hide().map_err(|err| err.to_string())?;
    info!("Companion window hidden: {}", label);
    Ok(())
}
