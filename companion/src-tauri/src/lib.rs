//! Sambee Companion — Tauri application setup and plugin wiring.
//!
//! Registers all Tauri plugins (deep-link, single-instance, store, shell,
//! http, notification) and sets up the system tray, deep-link handling,
//! and the full edit lifecycle.

mod app_registry;
mod commands;
mod sync;
mod token;
mod uri;

use log::{error, info, warn};
use std::sync::{Arc, RwLock};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconId},
    Emitter, Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::sync::operations::{
    OperationStatus, OperationStore, PendingConfirmations, DEFAULT_MAX_FILE_SIZE_MB,
};
use crate::uri::SambeeUri;

/// ID used for the system tray icon, allowing retrieval via `app.tray_by_id()`.
const TRAY_ICON_ID: &str = "sambee-main";

// ─────────────────────────────────────────────────────────────────────────────
// Theme state — stores the latest theme received from the web app
// ─────────────────────────────────────────────────────────────────────────────

/// Shared state holding the current base64-encoded theme string.
///
/// Updated whenever a deep-link URI contains a `theme` parameter.
/// Emitted to every new window so it can apply the correct CSS variables.
#[derive(Clone, Default)]
pub struct ThemeState(pub Arc<RwLock<Option<String>>>);

impl ThemeState {
    //
    // get
    //
    /// Read the current theme string (base64-encoded JSON).
    pub fn get(&self) -> Option<String> {
        self.0.read().ok().and_then(|g| g.clone())
    }

    //
    // set
    //
    /// Store a new theme and broadcast it to all open webview windows.
    pub fn set(&self, app: &tauri::AppHandle, theme: String) {
        if let Ok(mut lock) = self.0.write() {
            *lock = Some(theme.clone());
        }
        // Broadcast to all windows so every UI surface picks up the new theme
        let _ = app.emit("apply-theme", &theme);
        info!("Theme updated and broadcast to all windows");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep-link handler
// ─────────────────────────────────────────────────────────────────────────────

//
// handle_deep_links
//
/// Process one or more `sambee://` URIs received via deep-link.
///
/// Called both on cold start (if the app was launched via a URI) and when a
/// running instance receives a forwarded URI from the single-instance plugin.
fn handle_deep_links(app: &tauri::AppHandle, urls: Vec<url::Url>) {
    for raw_url in urls {
        info!("Received deep-link URI: {raw_url}");

        match SambeeUri::parse(&raw_url) {
            Ok(parsed) => {
                info!(
                    "Parsed URI: server={}, conn_id={}, path={}",
                    parsed.server, parsed.conn_id, parsed.path
                );

                // Apply theme from the URI if present
                if let Some(ref theme_b64) = parsed.theme {
                    if let Some(theme_state) = app.try_state::<ThemeState>() {
                        theme_state.set(app, theme_b64.clone());
                    }
                }

                // Kick off the full edit lifecycle asynchronously
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = start_edit_lifecycle(app_handle, parsed).await {
                        error!("Edit lifecycle failed: {e}");
                    }
                });
            }
            Err(e) => {
                warn!("Ignoring invalid deep-link URI: {e}");
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit lifecycle
// ─────────────────────────────────────────────────────────────────────────────

//
// start_edit_lifecycle
//
/// Orchestrate the full edit lifecycle for a single file.
///
/// 1. Exchange URI token → session JWT
///    1.5 Fetch file info (for size check + conflict baseline)
/// 2. Acquire edit lock
/// 3. Download file to temp
/// 4. Show app picker (emit event to main window)
/// 5. Open file in native app
/// 6. Spawn "Done Editing" window
/// 7. Start file status polling + heartbeat
async fn start_edit_lifecycle(app: tauri::AppHandle, uri: SambeeUri) -> Result<(), String> {
    // 1. Exchange URI token for session JWT
    info!("Step 1: Exchanging URI token...");
    let session_token = token::exchange_uri_token(&uri.server, &uri.token).await?;

    // 1.5. Fetch file info for size check and conflict detection baseline
    info!("Step 1.5: Fetching file info...");
    let file_info =
        commands::file_info::get_file_info(&uri.server, &uri.conn_id, &uri.path, &session_token)
            .await;

    // Store server-side modified_at for later conflict detection
    let server_last_modified = file_info
        .as_ref()
        .ok()
        .and_then(|info| info.modified_at.clone());

    // Check file size against threshold
    if let Ok(ref info) = file_info {
        if let Some(size_bytes) = info.size {
            if let Some(size_mb) =
                sync::operations::exceeds_size_limit(size_bytes, DEFAULT_MAX_FILE_SIZE_MB)
            {
                info!(
                    "File {} is {} MB (limit {} MB) — requesting confirmation",
                    info.name, size_mb, DEFAULT_MAX_FILE_SIZE_MB
                );

                let confirm_id = uuid::Uuid::new_v4().to_string();
                let (tx, rx) = tokio::sync::oneshot::channel::<bool>();

                // Register the pending confirmation
                if let Some(pending) = app.try_state::<PendingConfirmations>() {
                    pending.insert(confirm_id.clone(), tx);
                }

                // Emit event to frontend for user confirmation
                let _ = app.emit(
                    "confirm-large-file",
                    serde_json::json!({
                        "confirm_id": confirm_id,
                        "filename": info.name,
                        "size_mb": size_mb,
                        "limit_mb": DEFAULT_MAX_FILE_SIZE_MB,
                    }),
                );

                // Wait for user response (blocks lifecycle until dialog answered)
                let proceed = rx.await.unwrap_or(false);
                if !proceed {
                    info!("User cancelled large file download for {}", info.name);
                    return Ok(());
                }
                info!("User confirmed large file download for {}", info.name);
            }
        }
    }

    // 2. Acquire edit lock
    info!("Step 2: Acquiring edit lock...");
    let lock_id =
        commands::upload::acquire_lock(&uri.server, &uri.conn_id, &uri.path, &session_token)
            .await?;

    // 3. Download file to local temp
    info!("Step 3: Downloading file...");
    let download_result =
        commands::download::download_file(&uri.server, &uri.conn_id, &uri.path, &session_token)
            .await
            .inspect_err(|_e| {
                // Release lock on download failure (best-effort)
                let srv = uri.server.clone();
                let cid = uri.conn_id.clone();
                let p = uri.path.clone();
                let tok = session_token.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = commands::upload::release_lock(&srv, &cid, &p, &tok).await;
                });
            })?;

    // 4. Create FileOperation and persist
    let operation = sync::operations::FileOperation {
        id: download_result.operation_id,
        server_url: uri.server.clone(),
        connection_id: uri.conn_id.clone(),
        remote_path: uri.path.clone(),
        local_path: download_result.local_path.clone(),
        token: session_token.clone(),
        downloaded_at: std::time::SystemTime::now(),
        original_mtime: download_result.original_mtime,
        status: OperationStatus::Editing,
        opened_with_app: None,
        lock_id: Some(lock_id),
        server_last_modified,
    };

    // Persist sidecar
    if let Err(e) = sync::operations::save_operation_sidecar(&operation) {
        warn!("Failed to persist operation sidecar: {e}");
    }

    // Add to in-memory store
    let store = app
        .try_state::<OperationStore>()
        .ok_or_else(|| "Operation store not available".to_string())?;
    store.add(operation.clone());

    // Refresh tray menu to show the new operation
    refresh_tray_menu(&app);

    // 5. For now, open with system default (app picker integration comes later)
    //    In the full flow, the main window emits "show-app-picker", the user picks
    //    an app, and then we open with that. For now we use xdg-open.
    info!("Step 5: Opening file in native app...");
    commands::open_file::open_in_native_app(
        &app,
        &download_result.local_path,
        "", // system default
    )
    .await?;

    // 6. Spawn Done Editing window
    info!("Step 6: Spawning Done Editing window...");
    let window_label =
        commands::open_file::spawn_done_editing_window(&app, &operation, "Default Application")?;

    // Send the current theme to the new Done Editing window
    if let Some(theme_state) = app.try_state::<ThemeState>() {
        if let Some(theme_b64) = theme_state.get() {
            let wl = window_label.clone();
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                let _ = app2.emit_to(&wl, "apply-theme", &theme_b64);
            });
        }
    }

    // 7. Start background tasks
    info!("Step 7: Starting file polling and heartbeat...");
    commands::open_file::start_file_status_polling(
        &app,
        window_label.clone(),
        download_result.local_path,
        download_result.original_mtime,
    );

    commands::open_file::start_heartbeat_task(
        &app,
        window_label,
        uri.server,
        uri.conn_id,
        uri.path,
        session_token,
    );

    info!(
        "Edit lifecycle started successfully for operation {}",
        operation.id
    );
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// System tray
// ─────────────────────────────────────────────────────────────────────────────

//
// setup_system_tray
//
/// Build the system tray icon with a context menu.
///
/// Assigns the tray ID [`TRAY_ICON_ID`] so it can be retrieved later
/// via `app.tray_by_id()` for dynamic menu rebuilds.
fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let quit = MenuItem::with_id(app, "quit", "Quit Sambee Companion", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;

    TrayIconBuilder::with_id(TRAY_ICON_ID)
        .icon(
            app.default_window_icon()
                .cloned()
                .unwrap_or_else(|| tauri::image::Image::new(&[], 0, 0)),
        )
        .tooltip("Sambee Companion")
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                info!("Quit requested from system tray");
                app.exit(0);
            }
        })
        .build(app)?;

    Ok(())
}

//
// refresh_tray_menu
//
/// Rebuild the system tray context menu to reflect active operations.
///
/// Displays one menu item per active file (status + filename), plus
/// a separator and the "Quit" item at the bottom.
fn refresh_tray_menu(app: &tauri::AppHandle) {
    let tray = match app.tray_by_id(&TrayIconId::new(TRAY_ICON_ID)) {
        Some(t) => t,
        None => {
            warn!("Cannot refresh tray menu: tray not found");
            return;
        }
    };

    let store = match app.try_state::<OperationStore>() {
        Some(s) => s,
        None => return,
    };

    let active = store.active_operations();

    // Build menu items.  We silently skip any items that fail to construct.
    let mut items: Vec<MenuItem<tauri::Wry>> = Vec::new();

    if active.is_empty() {
        if let Ok(item) =
            MenuItem::with_id(app, "no-ops", "No active operations", false, None::<&str>)
        {
            items.push(item);
        }
    } else {
        for op in &active {
            let label = match &op.status {
                OperationStatus::Editing => format!("Editing: {}", op.filename()),
                OperationStatus::Uploading(pct) => {
                    format!("Uploading ({:.0}%): {}", pct * 100.0, op.filename())
                }
                OperationStatus::UploadFailed(_) => {
                    format!("Upload failed: {}", op.filename())
                }
                OperationStatus::Downloading => format!("Downloading: {}", op.filename()),
                _ => op.filename().to_string(),
            };

            // Use the operation id as the menu item id (display-only, no action)
            if let Ok(item) = MenuItem::with_id(app, op.id.to_string(), &label, false, None::<&str>)
            {
                items.push(item);
            }
        }
    }

    // Build the final menu with a Quit action at the end
    if let Ok(quit) = MenuItem::with_id(app, "quit", "Quit Sambee Companion", true, None::<&str>) {
        items.push(quit);
    }

    // Collect references for Menu::with_items
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();

    match Menu::with_items(app, &refs) {
        Ok(menu) => {
            if let Err(e) = tray.set_menu(Some(menu)) {
                warn!("Failed to update tray menu: {e}");
            }
        }
        Err(e) => warn!("Failed to build tray menu: {e}"),
    }
}

//
// emit_leftover_operations
//
/// Load sidecars for leftover operations and emit a "leftover-operations"
/// event to the main window so the frontend can show recovery dialogs.
fn emit_leftover_operations(
    app: &tauri::AppHandle,
    leftovers: Vec<(std::path::PathBuf, std::path::PathBuf)>,
) {
    let mut infos: Vec<commands::open_file::LeftoverInfo> = Vec::new();

    for (op_dir, sidecar_path) in &leftovers {
        match sync::operations::load_operation_sidecar(sidecar_path) {
            Ok(op) => {
                // Get local file's last modified time for display
                let local_modified = op
                    .local_path
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(format_system_time_iso)
                    .unwrap_or_else(|| "unknown".to_string());

                infos.push(commands::open_file::LeftoverInfo {
                    operation_dir: op_dir.to_string_lossy().to_string(),
                    filename: op.filename().to_string(),
                    server_url: op.server_url.clone(),
                    remote_path: op.remote_path.clone(),
                    connection_id: op.connection_id.clone(),
                    local_modified,
                });
            }
            Err(e) => {
                warn!("Failed to load sidecar {}: {e}", sidecar_path.display());
            }
        }
    }

    if !infos.is_empty() {
        info!("Emitting {} leftover operation(s) to frontend", infos.len());
        let _ = app.emit("leftover-operations", &infos);
    }
}

//
// format_system_time_iso
//
/// Format a `SystemTime` as an ISO 8601-ish string (UTC).
fn format_system_time_iso(time: std::time::SystemTime) -> String {
    let secs = time
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Approximate date from epoch days (good enough for display)
    let (year, month, day) = epoch_days_to_ymd(days);
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}Z")
}

//
// epoch_days_to_ymd
//
/// Convert days since Unix epoch to (year, month, day).
///
/// Uses a simplified civil calendar algorithm. Accurate for dates
/// well past 2100.
fn epoch_days_to_ymd(epoch_days: u64) -> (u64, u64, u64) {
    // Algorithm from Howard Hinnant's chrono-compatible date library
    let z = epoch_days + 719468;
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
// App builder
// ─────────────────────────────────────────────────────────────────────────────

//
// run
//
/// Build and launch the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let mut builder = tauri::Builder::default();

    // Single-instance plugin must be registered first (with deep-link forwarding)
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            info!("Single-instance: re-opened with argv={argv:?}");

            // argv[1..] may contain deep-link URIs forwarded from the new instance
            let urls: Vec<url::Url> = argv
                .iter()
                .skip(1)
                .filter_map(|arg| url::Url::parse(arg).ok())
                .filter(|u| u.scheme() == "sambee")
                .collect();

            if !urls.is_empty() {
                handle_deep_links(app, urls);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(OperationStore::new())
        .manage(ThemeState::default())
        .manage(PendingConfirmations::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_picker::get_apps_for_file,
            commands::open_file::finish_editing,
            commands::open_file::discard_editing,
            commands::open_file::resolve_conflict_overwrite,
            commands::open_file::resolve_conflict_save_copy,
            commands::open_file::confirm_large_download,
            commands::open_file::recovery_upload,
            commands::open_file::recovery_discard,
            commands::open_file::recovery_dismiss,
        ])
        .setup(|app| {
            // Register deep-link scheme at runtime (Linux + Windows dev mode)
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                app.deep_link().register_all()?;
            }

            // Set up system tray
            if let Err(e) = setup_system_tray(app) {
                error!("Failed to set up system tray: {e}");
            }

            // Run recycle bin cleanup on startup
            let cleaned = sync::recycle::cleanup_expired();
            if cleaned > 0 {
                info!("Startup: cleaned {cleaned} expired recycled file(s)");
            }

            // Scan for leftover operations from previous sessions
            let leftovers = sync::temp::scan_leftover_operations();
            if !leftovers.is_empty() {
                info!(
                    "Startup: found {} leftover operation(s) from previous sessions",
                    leftovers.len()
                );
                // Emit recovery info to the main window after a short delay
                // (window must be ready to receive events)
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    emit_leftover_operations(&app_handle, leftovers);
                });
            }

            // Process deep-link if app was cold-started via a URI
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                handle_deep_links(app.handle(), urls);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Sambee Companion");
}
