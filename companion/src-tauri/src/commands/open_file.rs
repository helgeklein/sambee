//! Tauri command for opening a downloaded file in a native application
//! and spawning the "Done Editing" window.
//!
//! Also includes conflict detection: before uploading, the companion
//! re-checks the server-side `modified_at` and shows a conflict dialog
//! if the file was modified by another user during the edit session.

use std::fs;
use std::path::Path;
use std::time::SystemTime;

use log::{error, info, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

use crate::sync::operations::{FileOperation, OperationStatus, OperationStore, FILE_POLL_INTERVAL_SECS, HEARTBEAT_INTERVAL_SECS};

fn launch_explicit_app(app: &AppHandle, app_executable: &str, path_str: &str) -> Result<(), String> {
    let _child = app.shell().command(app_executable).arg(path_str).spawn().map_err(|e| {
        error!("Failed to launch {}: {e}", app_executable);
        format!("Failed to launch {app_executable}: {e}")
    })?;

    info!("Process spawned successfully for {}", app_executable);
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit context (sent to the Done Editing window)
// ─────────────────────────────────────────────────────────────────────────────

/// Context payload emitted to the "Done Editing" webview window.
#[derive(Clone, serde::Serialize)]
pub struct EditContext {
    /// UUID identifying this edit operation.
    pub operation_id: String,
    /// Display filename (e.g. "report-copy.docx").
    pub filename: String,
    /// Display name of the native application.
    pub app_name: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Done Editing window dimensions
// ─────────────────────────────────────────────────────────────────────────────

/// Width of the Done Editing window in logical pixels.
const DONE_EDITING_WIDTH: f64 = 340.0;

/// Height of the Done Editing window in logical pixels.
const DONE_EDITING_HEIGHT: f64 = 200.0;

/// Margin from the top-left screen edge for the first window (logical pixels).
const DONE_EDITING_MARGIN: f64 = 24.0;

/// Vertical offset between cascaded windows (logical pixels).
const DONE_EDITING_CASCADE_STEP: f64 = 32.0;

/// Label prefix for Done Editing windows (used to count open instances).
pub(crate) const DONE_EDITING_LABEL_PREFIX: &str = "done-editing-";

/// Prefix used to distinguish a conflict result from a normal success in
/// `finish_editing`. The frontend checks for this prefix to show the
/// conflict resolution dialog.
const CONFLICT_PREFIX: &str = "conflict:";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/// Returns true if the given window label belongs to a Done Editing window.
pub(crate) fn is_done_editing_window_label(label: &str) -> bool {
    label.starts_with(DONE_EDITING_LABEL_PREFIX)
}

/// Returns the operation ID encoded into a Done Editing window label.
fn operation_id_from_window_label(window_label: &str) -> Result<uuid::Uuid, String> {
    let operation_id = window_label
        .strip_prefix(DONE_EDITING_LABEL_PREFIX)
        .ok_or_else(|| format!("Window '{window_label}' is not a Done Editing window"))?;

    operation_id
        .parse()
        .map_err(|_| format!("Window '{window_label}' has an invalid operation ID"))
}

#[tauri::command]
pub fn get_done_editing_context(app: AppHandle, window_label: String) -> Result<EditContext, String> {
    let op_id = operation_id_from_window_label(&window_label)?;

    let store = app
        .try_state::<OperationStore>()
        .ok_or_else(|| "Operation store not available".to_string())?;

    let operation = store.get(op_id).ok_or_else(|| format!("Operation {op_id} not found"))?;

    let app_name = operation
        .opened_with_app
        .clone()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Unknown app".to_string());

    Ok(EditContext {
        operation_id: operation.id.to_string(),
        filename: operation.filename().to_string(),
        app_name,
    })
}

//
// open_in_native_app
//
/// Open a local file in the specified native application.
///
/// Uses `tauri_plugin_shell` `open()` API. Falls back to the system default
/// if `app_executable` is empty.
pub async fn open_in_native_app(app: &AppHandle, local_path: &Path, app_executable: &str) -> Result<(), String> {
    let path_str = local_path.to_str().ok_or_else(|| "Invalid file path encoding".to_string())?;

    info!(
        "open_in_native_app: executable={:?}, path={:?}, exists={}",
        app_executable,
        path_str,
        local_path.exists()
    );

    if app_executable.is_empty() {
        // Use system default via xdg-open / open / start
        info!("Opening with system default: {}", local_path.display());
        #[allow(deprecated)] // tauri-plugin-opener is not yet adopted
        app.shell().open(path_str, None).map_err(|e| {
            error!("shell.open() failed for {}: {e}", local_path.display());
            format!("Failed to open file with system default: {e}")
        })?;
        info!("shell.open() succeeded for {}", local_path.display());
    } else {
        info!("Opening with {}: {}", app_executable, local_path.display());

        // On Windows, use IAssocHandler::Invoke() which properly handles both
        // traditional Win32 applications and UWP/Store apps (e.g. Windows
        // Photos). UWP apps cannot be launched via CreateProcess — they
        // require activation through the Windows Shell infrastructure.
        #[cfg(target_os = "windows")]
        {
            let extension = local_path.extension().and_then(|e| e.to_str()).unwrap_or("");

            info!("Windows: attempting IAssocHandler::Invoke() for extension={:?}", extension);

            match crate::app_registry::windows::invoke_assoc_handler(extension, app_executable, path_str) {
                Ok(()) => {
                    info!("IAssocHandler::Invoke() succeeded for {}", local_path.display());
                }
                Err(handler_err) => {
                    warn!(
                        "IAssocHandler invocation failed ({}), trying direct launch of selected executable",
                        handler_err
                    );

                    match launch_explicit_app(app, app_executable, path_str) {
                        Ok(()) => {
                            info!("Direct launch fallback succeeded for {}", local_path.display());
                        }
                        Err(launch_err) => {
                            warn!(
                                "Direct launch fallback failed ({}), falling back to system default shell open",
                                launch_err
                            );

                            // Final fallback: delegate to the OS default handler.
                            info!("Fallback: opening {:?} via system default (shell open)", path_str);
                            #[allow(deprecated)] // tauri-plugin-opener is not yet adopted
                            app.shell().open(path_str, None).map_err(|e| {
                                error!("Fallback shell.open() also failed for {}: {e}", local_path.display());
                                format!("Failed to open file: {e}")
                            })?;
                            info!("Fallback shell.open() succeeded for {}", local_path.display());
                        }
                    }
                }
            }
        }

        // On non-Windows platforms, spawn the application directly
        #[cfg(not(target_os = "windows"))]
        {
            launch_explicit_app(app, app_executable, path_str)?;
        }
    }

    Ok(())
}

//
// spawn_done_editing_window
//
/// Create and show the "Done Editing" webview window for an active operation.
///
/// The window is always-on-top, non-resizable, non-closable, and non-minimizable.
/// It emits an `edit-context` event so the frontend knows which file is being edited.
pub fn spawn_done_editing_window(app: &AppHandle, operation: &FileOperation, app_display_name: &str) -> Result<String, String> {
    let window_label = format!("{}{}", DONE_EDITING_LABEL_PREFIX, operation.id);

    // Count existing Done Editing windows for cascade positioning
    let existing_count = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with(DONE_EDITING_LABEL_PREFIX))
        .count() as f64;

    let pos_x = DONE_EDITING_MARGIN;
    let pos_y = DONE_EDITING_MARGIN + existing_count * DONE_EDITING_CASCADE_STEP;

    let _window = tauri::WebviewWindowBuilder::new(app, &window_label, tauri::WebviewUrl::App("/done-editing".into()))
        .title("Sambee — Editing")
        .inner_size(DONE_EDITING_WIDTH, DONE_EDITING_HEIGHT)
        .position(pos_x, pos_y)
        .resizable(false)
        .maximizable(false)
        .fullscreen(false)
        .always_on_top(true)
        .closable(false)
        .minimizable(false)
        .build()
        .map_err(|e| format!("Failed to create Done Editing window: {e}"))?;

    // Send edit context to the window
    let context = EditContext {
        operation_id: operation.id.to_string(),
        filename: operation.filename().to_string(),
        app_name: app_display_name.to_string(),
    };

    // Use a short delay to ensure the window is ready to receive events
    let window_label_clone = window_label.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Err(e) = app_clone.emit_to(&window_label_clone, "edit-context", &context) {
            warn!("Failed to emit edit-context: {e}");
        }
    });

    info!("Spawned Done Editing window: {} for {}", window_label, operation.filename());

    Ok(window_label)
}

//
// start_file_status_polling
//
/// Start a background task that polls the temp file's mtime every 2 seconds
/// and emits `file-status` events to the Done Editing window.
pub fn start_file_status_polling(app: &AppHandle, window_label: String, local_path: std::path::PathBuf, original_mtime: SystemTime) {
    let app_clone = app.clone();

    tauri::async_runtime::spawn(async move {
        let interval = std::time::Duration::from_secs(FILE_POLL_INTERVAL_SECS);

        loop {
            tokio::time::sleep(interval).await;

            // Check if the window still exists
            if app_clone.get_webview_window(&window_label).is_none() {
                info!("File status polling stopped: window {} closed", window_label);
                break;
            }

            // Read current mtime
            let current_mtime = match fs::metadata(&local_path).and_then(|m| m.modified()) {
                Ok(mtime) => mtime,
                Err(_) => continue,
            };

            let status = if current_mtime != original_mtime {
                // File has been modified — format the time
                let time_str = format_system_time(current_mtime);
                serde_json::json!({ "kind": "modified", "modifiedAt": time_str })
            } else {
                serde_json::json!({ "kind": "unchanged" })
            };

            let _ = app_clone.emit_to(&window_label, "file-status", &status);
        }
    });
}

//
// start_heartbeat_task
//
/// Start a background task that sends lock heartbeats every 30 seconds.
///
/// Stops when the Done Editing window is closed.
pub fn start_heartbeat_task(
    app: &AppHandle,
    window_label: String,
    server_url: String,
    connection_id: String,
    remote_path: String,
    session_token: String,
) {
    let app_clone = app.clone();

    tauri::async_runtime::spawn(async move {
        let interval = std::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS);

        loop {
            tokio::time::sleep(interval).await;

            // Stop if window is gone
            if app_clone.get_webview_window(&window_label).is_none() {
                info!("Heartbeat stopped: window {} closed", window_label);
                break;
            }

            match super::upload::send_heartbeat(&server_url, &connection_id, &remote_path, &session_token).await {
                Ok(()) => {}
                Err(e) => {
                    warn!("Heartbeat failed (will retry next interval): {e}");
                }
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri commands (invoked from the frontend)
// ─────────────────────────────────────────────────────────────────────────────

//
// finish_editing
//
/// Tauri command: user confirmed "Done Editing".
///
/// If the file is modified → upload, release lock, recycle, close window.
/// If unchanged → release lock, recycle, close window.
#[tauri::command]
pub async fn finish_editing(app: AppHandle, operation_id: String) -> Result<String, String> {
    let op_id: uuid::Uuid = operation_id.parse().map_err(|_| "Invalid operation ID".to_string())?;

    let store = app
        .try_state::<OperationStore>()
        .ok_or_else(|| "Operation store not available".to_string())?;

    let operation = store.get(op_id).ok_or_else(|| format!("Operation {op_id} not found"))?;

    let window_label = format!("done-editing-{}", operation.id);
    let local_path = operation.local_path.clone();
    let server_url = operation.server_url.clone();
    let connection_id = operation.connection_id.clone();
    let remote_path = operation.remote_path.clone();
    let token = operation.token.clone();
    let original_mtime = operation.original_mtime;
    let filename = operation.filename();

    // Check if file was modified
    let current_mtime = fs::metadata(&local_path).and_then(|m| m.modified()).unwrap_or(original_mtime);

    let is_modified = current_mtime != original_mtime;

    if is_modified {
        // ── Conflict detection ─────────────────────────────────────────
        // Before uploading, check if the server-side file was modified
        // by another user while we held our lock.
        if let Some(ref download_modified_at) = operation.server_last_modified {
            match super::file_info::get_file_info(&server_url, &connection_id, &remote_path, &token).await {
                Ok(current_info) => {
                    if let Some(ref current_modified) = current_info.modified_at {
                        if current_modified != download_modified_at {
                            // Server file changed since our download → conflict!
                            warn!(
                                "Conflict detected for {}: download_modified={}, server_modified={}",
                                filename, download_modified_at, current_modified
                            );
                            let conflict_json = serde_json::json!({
                                "operation_id": operation.id.to_string(),
                                "filename": filename,
                                "download_modified": download_modified_at,
                                "server_modified": current_modified,
                            });
                            return Ok(format!("{CONFLICT_PREFIX}{}", conflict_json));
                        }
                    }
                }
                Err(e) => {
                    // Could not check — log but proceed with upload
                    warn!("Conflict check failed (proceeding with upload): {e}");
                }
            }
        }

        // Upload the file
        info!("Uploading modified file: {}", local_path.display());
        store.update_status(op_id, OperationStatus::Uploading(0.0));
        crate::refresh_tray_menu(&app);

        match super::upload::upload_file(&app, &window_label, &server_url, &connection_id, &remote_path, &local_path, &token).await {
            Ok(_resp) => {
                info!("Upload successful for {}", filename);
            }
            Err(e) => {
                error!("Upload failed for {}: {e}", filename);
                store.update_status(op_id, OperationStatus::UploadFailed(e.clone()));
                crate::refresh_tray_menu(&app);
                return Err(format!("Upload failed: {e}"));
            }
        }
    }

    // Release lock (best-effort)
    let _ = super::upload::release_lock(&server_url, &connection_id, &remote_path, &token).await;

    // Move temp file to recycle bin
    let _ = crate::sync::recycle::recycle_file(&local_path);

    // Update status
    store.update_status(op_id, OperationStatus::Completed);
    crate::refresh_tray_menu(&app);

    // Close the Done Editing window
    if let Some(window) = app.get_webview_window(&window_label) {
        let _ = window.destroy();
    }

    // Send notification
    let message = if is_modified {
        format!("✓ {} — saved to server.", filename)
    } else {
        format!("✓ {} — no changes, lock released.", filename)
    };

    let _ = app.emit("notification", serde_json::json!({ "message": message }));

    info!("Edit session completed: {}", filename);
    Ok(message)
}

//
// discard_editing
//
/// Tauri command: user confirmed "Discard Changes".
///
/// Releases lock, moves temp file to recycle bin, closes window.
#[tauri::command]
pub async fn discard_editing(app: AppHandle, operation_id: String) -> Result<String, String> {
    let op_id: uuid::Uuid = operation_id.parse().map_err(|_| "Invalid operation ID".to_string())?;

    let store = app
        .try_state::<OperationStore>()
        .ok_or_else(|| "Operation store not available".to_string())?;

    let operation = store.get(op_id).ok_or_else(|| format!("Operation {op_id} not found"))?;

    let window_label = format!("done-editing-{}", operation.id);
    let local_path = operation.local_path.clone();
    let server_url = operation.server_url.clone();
    let connection_id = operation.connection_id.clone();
    let remote_path = operation.remote_path.clone();
    let token = operation.token.clone();
    let filename = operation.filename();

    // Release lock (best-effort)
    let _ = super::upload::release_lock(&server_url, &connection_id, &remote_path, &token).await;

    // Move temp file to recycle bin
    let _ = crate::sync::recycle::recycle_file(&local_path);

    // Update status
    store.update_status(op_id, OperationStatus::Discarded);
    crate::refresh_tray_menu(&app);

    // Close the Done Editing window
    if let Some(window) = app.get_webview_window(&window_label) {
        let _ = window.destroy();
    }

    let message = format!("{} — changes discarded (recoverable for 7 days).", filename);
    let _ = app.emit("notification", serde_json::json!({ "message": message }));

    info!("Edit session discarded: {}", filename);
    Ok(message)
}

// ─────────────────────────────────────────────────────────────────────────────
// Conflict resolution commands
// ─────────────────────────────────────────────────────────────────────────────

//
// resolve_conflict_overwrite
//
/// Tauri command: user chose "Overwrite" in the conflict dialog.
///
/// Skips the conflict check and force-uploads the local file.
#[tauri::command]
pub async fn resolve_conflict_overwrite(app: AppHandle, operation_id: String) -> Result<String, String> {
    upload_and_finish(&app, &operation_id, None).await
}

//
// resolve_conflict_save_copy
//
/// Tauri command: user chose "Save as Copy" in the conflict dialog.
///
/// Uploads the local file to a different path on the server, preserving
/// both the current server version and the user's local edits.
/// Copy path: `{stem} (conflict copy).{ext}` or `{name} (conflict copy)`.
#[tauri::command]
pub async fn resolve_conflict_save_copy(app: AppHandle, operation_id: String) -> Result<String, String> {
    let op_id: uuid::Uuid = operation_id.parse().map_err(|_| "Invalid operation ID".to_string())?;

    let store = app
        .try_state::<OperationStore>()
        .ok_or_else(|| "Operation store not available".to_string())?;

    let operation = store.get(op_id).ok_or_else(|| format!("Operation {op_id} not found"))?;

    let copy_path = make_conflict_copy_path(&operation.remote_path);
    info!("Saving conflict copy: {} → {}", operation.remote_path, copy_path);

    upload_and_finish(&app, &operation_id, Some(&copy_path)).await
}

//
// upload_and_finish
//
/// Shared helper: upload a file (optionally to a different path) then
/// release lock, recycle, close window, notify.
async fn upload_and_finish(app: &AppHandle, operation_id: &str, upload_path_override: Option<&str>) -> Result<String, String> {
    let op_id: uuid::Uuid = operation_id.parse().map_err(|_| "Invalid operation ID".to_string())?;

    let store = app
        .try_state::<OperationStore>()
        .ok_or_else(|| "Operation store not available".to_string())?;

    let operation = store.get(op_id).ok_or_else(|| format!("Operation {op_id} not found"))?;

    let window_label = format!("done-editing-{}", operation.id);
    let local_path = operation.local_path.clone();
    let server_url = operation.server_url.clone();
    let connection_id = operation.connection_id.clone();
    let remote_path = upload_path_override.unwrap_or(&operation.remote_path);
    let token = operation.token.clone();
    let filename = operation.filename();

    // Upload
    store.update_status(op_id, OperationStatus::Uploading(0.0));
    crate::refresh_tray_menu(app);
    match super::upload::upload_file(app, &window_label, &server_url, &connection_id, remote_path, &local_path, &token).await {
        Ok(_) => {
            info!("Upload successful (conflict resolved) for {}", filename);
        }
        Err(e) => {
            error!("Upload failed for {}: {e}", filename);
            store.update_status(op_id, OperationStatus::UploadFailed(e.clone()));
            crate::refresh_tray_menu(app);
            return Err(format!("Upload failed: {e}"));
        }
    }

    // Release lock
    let _ = super::upload::release_lock(
        &server_url,
        &connection_id,
        &operation.remote_path, // Always release lock on the original path
        &token,
    )
    .await;

    // Recycle temp file
    let _ = crate::sync::recycle::recycle_file(&local_path);

    store.update_status(op_id, OperationStatus::Completed);
    crate::refresh_tray_menu(app);

    if let Some(window) = app.get_webview_window(&window_label) {
        let _ = window.destroy();
    }

    let message = if upload_path_override.is_some() {
        format!("✓ {} — saved as copy on server.", filename)
    } else {
        format!("✓ {} — saved to server (overwritten).", filename)
    };
    let _ = app.emit("notification", serde_json::json!({ "message": message }));

    info!("Conflict resolved for {}", filename);
    Ok(message)
}

//
// make_conflict_copy_path
//
/// Generate a server path for a conflict copy.
///
/// `/docs/report.docx` → `/docs/report (conflict copy).docx`
/// `/docs/Makefile` → `/docs/Makefile (conflict copy)`
fn make_conflict_copy_path(remote_path: &str) -> String {
    // Split into directory + filename
    let (dir, name) = match remote_path.rfind('/') {
        Some(pos) => (&remote_path[..=pos], &remote_path[pos + 1..]),
        None => ("", remote_path),
    };

    // Split filename into stem + extension
    match name.rfind('.') {
        Some(dot) if dot > 0 => {
            let stem = &name[..dot];
            let ext = &name[dot..];
            format!("{dir}{stem} (conflict copy){ext}")
        }
        _ => format!("{dir}{name} (conflict copy)"),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Large-file confirmation
// ─────────────────────────────────────────────────────────────────────────────

//
// confirm_large_download
//
/// Tauri command: user responded to the large-file warning dialog.
///
/// Signals the pending lifecycle to proceed (`true`) or abort (`false`).
#[tauri::command]
pub fn confirm_large_download(app: AppHandle, confirm_id: String, proceed: bool) -> Result<(), String> {
    let pending = app
        .try_state::<crate::sync::operations::PendingConfirmations>()
        .ok_or_else(|| "PendingConfirmations not available".to_string())?;

    if pending.respond(&confirm_id, proceed) {
        info!("Large download confirmation {}: proceed={}", confirm_id, proceed);
        Ok(())
    } else {
        warn!("No pending confirmation found for {}", confirm_id);
        Err(format!("No pending confirmation: {confirm_id}"))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// App picker response
// ─────────────────────────────────────────────────────────────────────────────

//
// respond_app_selection
//
/// Tauri command: user selected an app (or cancelled) in the app picker dialog.
///
/// When the user picks an app, `executable` and `app_name` are provided.
/// When the user cancels, `executable` is an empty string, which signals
/// cancellation to the waiting lifecycle.
#[tauri::command]
pub fn respond_app_selection(app: AppHandle, request_id: String, executable: String, app_name: String) -> Result<(), String> {
    let pending = app
        .try_state::<crate::sync::operations::PendingAppSelections>()
        .ok_or_else(|| "PendingAppSelections not available".to_string())?;

    let selection = if executable.is_empty() {
        None
    } else {
        Some(crate::sync::operations::SelectedApp {
            executable,
            name: app_name,
        })
    };

    if pending.respond(&request_id, selection) {
        info!("App selection received for request {}", request_id);
        Ok(())
    } else {
        warn!("No pending app selection found for {}", request_id);
        Err(format!("No pending app selection: {request_id}"))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup recovery commands
// ─────────────────────────────────────────────────────────────────────────────

/// Payload describing a leftover operation from a previous session.
#[derive(Clone, Serialize)]
pub struct LeftoverInfo {
    /// Path to the operation directory.
    pub operation_dir: String,
    /// Filename of the temp file (display name).
    pub filename: String,
    /// Server URL from the sidecar.
    pub server_url: String,
    /// Remote path on the server.
    pub remote_path: String,
    /// Connection ID from the sidecar.
    pub connection_id: String,
    /// Last modified time of the local file (formatted).
    pub local_modified: String,
}

//
// recovery_upload
//
/// Tauri command: user chose "Upload to Server" for a leftover file.
///
/// Re-exchanges a session (or uses existing token), uploads, then recycles.
#[tauri::command]
pub async fn recovery_upload(app: AppHandle, operation_dir: String) -> Result<String, String> {
    let sidecar_path = std::path::PathBuf::from(&operation_dir).join(crate::sync::operations::SIDECAR_FILENAME);

    let op = crate::sync::operations::load_operation_sidecar(&sidecar_path)?;
    let filename = op.filename().to_string();
    let local_path = op.local_path.clone();

    // Attempt upload with existing token (may fail if expired)
    let upload_result = super::upload::upload_file(
        &app,
        "main", // no Done Editing window for recovery
        &op.server_url,
        &op.connection_id,
        &op.remote_path,
        &local_path,
        &op.token,
    )
    .await;

    match upload_result {
        Ok(_) => {
            let _ = crate::sync::recycle::recycle_file(&local_path);
            let message = format!("✓ {} — recovered and uploaded to server.", filename);
            let _ = app.emit("notification", serde_json::json!({ "message": &message }));
            info!("Recovery upload successful: {}", filename);
            Ok(message)
        }
        Err(e) => {
            error!("Recovery upload failed for {}: {e}", filename);
            Err(format!("Upload failed: {e}"))
        }
    }
}

//
// recovery_discard
//
/// Tauri command: user chose "Discard" for a leftover file.
///
/// Moves the temp file to the recycle bin.
#[tauri::command]
pub async fn recovery_discard(_app: AppHandle, operation_dir: String) -> Result<String, String> {
    let sidecar_path = std::path::PathBuf::from(&operation_dir).join(crate::sync::operations::SIDECAR_FILENAME);

    let op = crate::sync::operations::load_operation_sidecar(&sidecar_path)?;
    let filename = op.filename().to_string();

    let _ = crate::sync::recycle::recycle_file(&op.local_path);
    info!("Recovery discard: {}", filename);

    Ok(format!("{} — discarded (recoverable for 7 days).", filename))
}

//
// recovery_dismiss
//
/// Tauri command: user chose "Keep for Later" for a leftover file.
///
/// Does nothing — the file stays in place for the next startup scan.
#[tauri::command]
pub async fn recovery_dismiss(_app: AppHandle, operation_dir: String) -> Result<String, String> {
    info!("Recovery dismissed: {}", operation_dir);
    Ok("Kept for later".to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

//
// format_system_time
//
/// Format a `SystemTime` as `HH:MM:SS` (UTC).
fn format_system_time(time: SystemTime) -> String {
    use std::time::UNIX_EPOCH;

    let secs = time.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();

    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

//
// has_active_operations
//
/// Returns `true` if any file-editing operation is currently active.
///
/// Used by the frontend auto-updater to avoid installing an update while
/// the user is in the middle of editing a file.
#[tauri::command]
pub fn has_active_operations(app: AppHandle) -> bool {
    let Some(store) = app.try_state::<OperationStore>() else {
        return false;
    };
    !store.active_operations().is_empty()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    //
    // test_format_system_time
    //
    #[test]
    fn test_format_system_time() {
        // 1_770_853_822 secs since epoch → time of day = 23:50:22 UTC
        let time = UNIX_EPOCH + Duration::from_secs(1_770_853_822);
        let formatted = format_system_time(time);
        assert_eq!(formatted, "23:50:22");
    }

    //
    // test_format_system_time_midnight
    //
    #[test]
    fn test_format_system_time_midnight() {
        // Exact midnight
        let time = UNIX_EPOCH + Duration::from_secs(86400 * 20000);
        let formatted = format_system_time(time);
        assert_eq!(formatted, "00:00:00");
    }

    //
    // test_edit_context_serialize
    //
    #[test]
    fn test_edit_context_serialize() {
        let ctx = EditContext {
            operation_id: "abc-123".to_string(),
            filename: "report-copy.docx".to_string(),
            app_name: "LibreOffice Writer".to_string(),
        };
        let json = serde_json::to_string(&ctx).unwrap();
        assert!(json.contains("report-copy.docx"));
        assert!(json.contains("LibreOffice Writer"));
    }

    //
    // test_conflict_copy_path_with_extension
    //
    #[test]
    fn test_conflict_copy_path_with_extension() {
        assert_eq!(make_conflict_copy_path("/docs/report.docx"), "/docs/report (conflict copy).docx");
    }

    //
    // test_conflict_copy_path_no_extension
    //
    #[test]
    fn test_conflict_copy_path_no_extension() {
        assert_eq!(make_conflict_copy_path("/docs/Makefile"), "/docs/Makefile (conflict copy)");
    }

    //
    // test_conflict_copy_path_nested
    //
    #[test]
    fn test_conflict_copy_path_nested() {
        assert_eq!(
            make_conflict_copy_path("/deep/nested/data.csv"),
            "/deep/nested/data (conflict copy).csv"
        );
    }
}
