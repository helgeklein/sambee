//! HTTP request handlers for the local API server.
//!
//! Each handler mirrors the corresponding endpoint in the Sambee Python
//! backend, producing identical JSON response shapes.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use axum::Json;
use chrono::{DateTime, Utc};
use log::{info, warn};
use serde::Deserialize;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

use crate::{show_pairing_success, show_pairing_window};

use super::auth;
use super::drives;
use super::errors::ApiError;
use super::models::*;
use super::AppState;

/// Characters forbidden in file/directory names (matches backend validation).
const FORBIDDEN_NAME_CHARS: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

/// Prefix used by the frontend for synthetic local-drive connection IDs.
const LOCAL_DRIVE_PREFIX: &str = "local-drive:";

// ─── WebSocket ───────────────────────────────────────────────────────────────

/// Query parameters for WebSocket authentication.
///
/// The browser WebSocket API does not support custom headers, so HMAC
/// credentials are passed as query parameters on the upgrade request.
#[derive(Deserialize)]
pub struct WsAuthParams {
    hmac: Option<String>,
    ts: Option<String>,
    origin: Option<String>,
}

/// `GET /api/ws` — WebSocket endpoint for real-time directory change notifications.
///
/// Authenticates via query parameters (`hmac`, `ts`, `origin`), then upgrades
/// to a WebSocket connection. Uses the same JSON protocol as the backend:
///
/// **Client → Companion:**
/// - `{"action": "subscribe", "connection_id": "local-drive:c", "path": "some/dir"}`
/// - `{"action": "unsubscribe", "connection_id": "local-drive:c", "path": "some/dir"}`
/// - `{"action": "ping"}`
///
/// **Companion → Client:**
/// - `{"type": "subscribed", "connection_id": "...", "path": "..."}`
/// - `{"type": "unsubscribed", "connection_id": "...", "path": "..."}`
/// - `{"type": "directory_changed", "connection_id": "...", "path": "..."}`
/// - `{"type": "pong"}`
pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(params): Query<WsAuthParams>,
) -> Result<Response, ApiError> {
    let hmac_val = params.hmac.ok_or_else(|| ApiError::Forbidden("Missing hmac query param".into()))?;
    let ts_val = params.ts.ok_or_else(|| ApiError::Forbidden("Missing ts query param".into()))?;
    let origin_val = params
        .origin
        .ok_or_else(|| ApiError::Forbidden("Missing origin query param".into()))?;

    auth::validate_hmac_public(&state, &origin_val, &hmac_val, &ts_val)?;

    Ok(ws.on_upgrade(move |socket| handle_ws_connection(socket, state)))
}

/// Handle a single WebSocket connection after the upgrade.
async fn handle_ws_connection(mut socket: WebSocket, state: Arc<AppState>) {
    info!("WebSocket client connected");
    let mut rx = state.watcher.subscribe_events();
    let mut subscriptions: HashSet<String> = HashSet::new();

    loop {
        tokio::select! {
            // ── Incoming message from the client ──────────────────────────
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = handle_ws_message(
                            &text, &mut socket, &state, &mut subscriptions,
                        ).await {
                            warn!("WS message handling error: {e}");
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    // Ignore binary/ping/pong frames
                    _ => {}
                }
            }
            // ── Outgoing notification from the watcher ────────────────────
            event = rx.recv() => {
                if let Ok(event) = event {
                    let key = format!("{}:{}", event.drive, event.path);
                    if subscriptions.contains(&key) {
                        let payload = serde_json::json!({
                            "type": "directory_changed",
                            "connection_id": format!("{LOCAL_DRIVE_PREFIX}{}", event.drive),
                            "path": event.path,
                        });
                        if socket
                            .send(Message::Text(payload.to_string().into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        }
    }

    // Cleanup: unsubscribe from all watched directories
    for key in &subscriptions {
        if let Some((drive, path)) = key.split_once(':') {
            state.watcher.unsubscribe(drive, path).await;
        }
    }
    info!("WebSocket client disconnected");
}

/// Process a single incoming WebSocket text message.
async fn handle_ws_message(
    text: &str,
    socket: &mut WebSocket,
    state: &Arc<AppState>,
    subscriptions: &mut HashSet<String>,
) -> Result<(), String> {
    let data: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("Invalid JSON: {e}"))?;

    let action = data.get("action").and_then(|v| v.as_str());
    let conn_id = data.get("connection_id").and_then(|v| v.as_str());
    let path = data.get("path").and_then(|v| v.as_str()).unwrap_or("");

    match (action, conn_id) {
        (Some("subscribe"), Some(connection_id)) => {
            let drive = connection_id.strip_prefix(LOCAL_DRIVE_PREFIX).unwrap_or(connection_id);
            let key = format!("{drive}:{path}");

            if let Some(root) = drives::resolve_drive_path(drive) {
                match state.watcher.subscribe(drive, path, &root).await {
                    Ok(()) => {
                        subscriptions.insert(key);
                        let reply = serde_json::json!({
                            "type": "subscribed",
                            "connection_id": connection_id,
                            "path": path,
                        });
                        socket
                            .send(Message::Text(reply.to_string().into()))
                            .await
                            .map_err(|e| format!("Send failed: {e}"))?;
                    }
                    Err(e) => {
                        warn!("WS subscribe failed for {key}: {e}");
                    }
                }
            } else {
                warn!("WS subscribe: unknown drive '{drive}'");
            }
        }
        (Some("unsubscribe"), Some(connection_id)) => {
            let drive = connection_id.strip_prefix(LOCAL_DRIVE_PREFIX).unwrap_or(connection_id);
            let key = format!("{drive}:{path}");

            if subscriptions.remove(&key) {
                state.watcher.unsubscribe(drive, path).await;
            }

            let reply = serde_json::json!({
                "type": "unsubscribed",
                "connection_id": connection_id,
                "path": path,
            });
            let _ = socket.send(Message::Text(reply.to_string().into())).await;
        }
        (Some("ping"), _) => {
            let reply = serde_json::json!({"type": "pong"});
            let _ = socket.send(Message::Text(reply.to_string().into())).await;
        }
        _ => {}
    }

    Ok(())
}

// ─── Health ──────────────────────────────────────────────────────────────────

/// `GET /api/health` — unauthenticated health check.
pub async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        paired: state.pairing.has_any_pairing(),
    })
}

// ─── Pairing ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PairInitiateRequest {
    pub nonce_browser: String,
}

/// `POST /api/pair/initiate` — start a pairing exchange.
pub async fn pair_initiate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PairInitiateRequest>,
) -> Result<Json<PairInitiateResponse>, ApiError> {
    let origin = extract_origin(&headers)?;

    let (pairing_id, nonce_companion, code) = state.pairing.initiate(&body.nonce_browser, &origin).map_err(ApiError::BadRequest)?;

    show_pairing_window(&state.app, &pairing_id, &origin, &code);

    // The companion UI will be notified of the pending pairing via
    // PairingState::get_pending_pairings() and show the code in a native dialog.
    // That flow is triggered by a Tauri event (handled separately).
    log::info!("Pairing code for UI display: {code}");

    Ok(Json(PairInitiateResponse {
        pairing_id,
        nonce_companion,
    }))
}

#[derive(Deserialize)]
pub struct PairConfirmRequest {
    pub pairing_id: String,
}

/// `POST /api/pair/confirm` — complete a pairing after dual confirmation.
pub async fn pair_confirm(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PairConfirmRequest>,
) -> Result<Json<PairConfirmResponse>, ApiError> {
    let secret = state.pairing.confirm(&body.pairing_id).map_err(ApiError::BadRequest)?;

    show_pairing_success(&state.app);

    Ok(Json(PairConfirmResponse { secret }))
}

/// `GET /api/pair/status` — pairing status for the current browser origin.
pub async fn pair_status(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Json<PairStatusResponse> {
    let current_origin = extract_origin(&headers).ok();
    let current_origin_paired = current_origin
        .as_deref()
        .map(|origin| {
            let paired = state.pairing.get_secret_for_origin(origin).is_some();
            if paired && !state.pairing.is_origin_paired(origin) {
                state.pairing.record_verified_origin(origin);
            }
            paired
        })
        .unwrap_or(false);

    Json(PairStatusResponse {
        current_origin,
        current_origin_paired,
    })
}

/// `GET /api/pairings` — list all browser origins paired with this companion.
pub async fn list_pairings(State(state): State<Arc<AppState>>) -> Json<Vec<String>> {
    Json(state.pairing.get_paired_origins())
}

#[derive(Deserialize)]
pub struct UnpairQuery {
    pub origin: String,
}

/// `DELETE /api/pairings` — remove a previously paired browser origin.
pub async fn delete_pairing(State(state): State<Arc<AppState>>, Query(query): Query<UnpairQuery>) -> Result<StatusCode, ApiError> {
    state.pairing.unpair(&query.origin).map_err(ApiError::BadRequest)?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/pair/test` — validate the current browser's authenticated pairing.
pub async fn test_pairing(State(_state): State<Arc<AppState>>, headers: HeaderMap) -> Result<Json<PairTestResponse>, ApiError> {
    let origin = extract_origin(&headers)?;

    Ok(Json(PairTestResponse {
        status: "success".to_string(),
        message: format!("Pairing with {origin} is working."),
        origin,
    }))
}

// ─── Drives ──────────────────────────────────────────────────────────────────

/// `GET /api/drives` — list all accessible drives/volumes.
pub async fn list_drives() -> Json<Vec<DriveInfo>> {
    Json(drives::enumerate_drives())
}

// ─── Browse ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct BrowseQuery {
    pub path: Option<String>,
}

/// `GET /api/browse/{drive}/list` — list directory contents.
pub async fn browse_list(Path(drive): Path<String>, Query(query): Query<BrowseQuery>) -> Result<Json<DirectoryListing>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;

    let relative = query.path.as_deref().unwrap_or("");
    let full_path = resolve_safe_path(&base_path, relative)?;

    let mut items = Vec::new();

    let mut entries = tokio::fs::read_dir(&full_path).await.map_err(|e| map_io_error(e, &full_path))?;

    while let Some(entry) = entries.next_entry().await.map_err(ApiError::Io)? {
        match build_file_info(&entry, relative).await {
            Ok(info) => items.push(info),
            Err(e) => {
                // Skip entries we can't stat (e.g., broken symlinks)
                log::debug!("Skipping entry {:?}: {e}", entry.file_name());
            }
        }
    }

    let total = items.len();

    Ok(Json(DirectoryListing {
        path: relative.to_string(),
        items,
        total,
    }))
}

/// `GET /api/browse/{drive}/info` — get metadata for a single file/directory.
pub async fn browse_info(Path(drive): Path<String>, Query(query): Query<BrowseQuery>) -> Result<Json<FileInfo>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;

    let relative = query.path.as_deref().unwrap_or("");
    let full_path = resolve_safe_path(&base_path, relative)?;

    let metadata = tokio::fs::metadata(&full_path).await.map_err(|e| map_io_error(e, &full_path))?;

    let name = full_path.file_name().unwrap_or_default().to_string_lossy().to_string();

    let file_type = if metadata.is_dir() { FileType::Directory } else { FileType::File };

    let size = if metadata.is_file() { Some(metadata.len()) } else { None };

    let mime_type = if metadata.is_file() {
        mime_guess::from_path(&full_path).first().map(|m| m.to_string())
    } else {
        None
    };

    let is_hidden = name.starts_with('.');

    Ok(Json(FileInfo {
        name,
        path: relative.to_string(),
        file_type,
        size,
        mime_type,
        created_at: system_time_to_chrono(metadata.created().ok()),
        modified_at: system_time_to_chrono(metadata.modified().ok()),
        is_readable: true, // We can read it if we could stat it
        is_hidden,
    }))
}

// ─── Viewer ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ViewerQuery {
    pub path: Option<String>,
    /// Ignored — companion serves raw files without server-side resizing.
    #[serde(default)]
    #[allow(dead_code)]
    pub viewport_width: Option<u32>,
    /// Ignored — companion serves raw files without server-side resizing.
    #[serde(default)]
    #[allow(dead_code)]
    pub viewport_height: Option<u32>,
    /// Ignored — companion always serves the original file.
    #[serde(default)]
    #[allow(dead_code)]
    pub no_resizing: Option<bool>,
}

/// Default MIME type for files we can't identify.
const FALLBACK_MIME: &str = "application/octet-stream";

/// `GET /api/viewer/{drive}/file` — stream a file for inline viewing.
///
/// Sets `Content-Type` from extension (via `mime_guess`) and
/// `Content-Disposition: inline` so browsers render the content.
pub async fn viewer_file(Path(drive): Path<String>, Query(query): Query<ViewerQuery>) -> Result<Response<Body>, ApiError> {
    let (full_path, mime_type) = resolve_viewer_path(&drive, &query)?;

    let file = File::open(&full_path).await.map_err(|e| map_io_error(e, &full_path))?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let filename = full_path.file_name().unwrap_or_default().to_string_lossy();
    let disposition = format!("inline; filename=\"{filename}\"");

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", &mime_type)
        .header(
            "Content-Disposition",
            HeaderValue::from_str(&disposition).unwrap_or_else(|_| HeaderValue::from_static("inline")),
        )
        .body(body)
        .map_err(|e| ApiError::Internal(format!("Failed to build response: {e}")))
}

/// `GET /api/viewer/{drive}/download` — stream a file as a download.
///
/// Sets `Content-Disposition: attachment` so browsers trigger a file-save dialog.
pub async fn viewer_download(Path(drive): Path<String>, Query(query): Query<ViewerQuery>) -> Result<Response<Body>, ApiError> {
    let (full_path, mime_type) = resolve_viewer_path(&drive, &query)?;

    let metadata = tokio::fs::metadata(&full_path).await.map_err(|e| map_io_error(e, &full_path))?;

    let file = File::open(&full_path).await.map_err(|e| map_io_error(e, &full_path))?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let filename = full_path.file_name().unwrap_or_default().to_string_lossy();
    let disposition = format!("attachment; filename=\"{filename}\"");

    let content_length = metadata.len();

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", &mime_type)
        .header(
            "Content-Disposition",
            HeaderValue::from_str(&disposition).unwrap_or_else(|_| HeaderValue::from_static("attachment")),
        )
        .header("Content-Length", content_length)
        .body(body)
        .map_err(|e| ApiError::Internal(format!("Failed to build response: {e}")))
}

/// Resolve drive + query path for viewer endpoints, returning the full path and MIME type.
fn resolve_viewer_path(drive: &str, query: &ViewerQuery) -> Result<(PathBuf, String), ApiError> {
    let base_path = drives::resolve_drive_path(drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;

    let relative = query.path.as_deref().unwrap_or("");
    let full_path = resolve_safe_path(&base_path, relative)?;

    // Viewer endpoints must target files, not directories
    let metadata = std::fs::metadata(&full_path).map_err(|e| map_io_error(e, &full_path))?;
    if metadata.is_dir() {
        return Err(ApiError::BadRequest("Cannot view a directory".to_string()));
    }

    let mime_type = mime_guess::from_path(&full_path)
        .first()
        .map(|m| m.to_string())
        .unwrap_or_else(|| FALLBACK_MIME.to_string());

    Ok((full_path, mime_type))
}

// ─── Write Operations ────────────────────────────────────────────────────────

/// `DELETE /api/browse/{drive}/item` — delete a file or directory.
///
/// Directories are removed recursively. Refuses to delete the drive root.
pub async fn browse_delete(Path(drive): Path<String>, Query(query): Query<BrowseQuery>) -> Result<StatusCode, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;

    let relative = query.path.as_deref().unwrap_or("");
    if relative.is_empty() {
        return Err(ApiError::BadRequest("Cannot delete the drive root".to_string()));
    }

    let full_path = resolve_safe_path(&base_path, relative)?;

    let metadata = tokio::fs::metadata(&full_path).await.map_err(|e| map_io_error(e, &full_path))?;

    if metadata.is_dir() {
        tokio::fs::remove_dir_all(&full_path)
            .await
            .map_err(|e| map_io_error(e, &full_path))?;
    } else {
        tokio::fs::remove_file(&full_path).await.map_err(|e| map_io_error(e, &full_path))?;
    }

    log::info!("Deleted: {}", full_path.display());
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct RenameRequest {
    pub path: String,
    pub new_name: String,
}

/// `POST /api/browse/{drive}/rename` — rename a file or directory.
///
/// Returns the updated `FileInfo` for the renamed item.
pub async fn browse_rename(Path(drive): Path<String>, Json(body): Json<RenameRequest>) -> Result<Json<FileInfo>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;

    validate_name(&body.new_name)?;

    if body.path.is_empty() {
        return Err(ApiError::BadRequest("Cannot rename the drive root".to_string()));
    }

    let full_path = resolve_safe_path(&base_path, &body.path)?;

    let parent = full_path
        .parent()
        .ok_or_else(|| ApiError::BadRequest("Cannot determine parent directory".to_string()))?;
    let new_full_path = parent.join(&body.new_name);

    if new_full_path.exists() {
        return Err(ApiError::conflict_message(format!(
            "An item named '{}' already exists",
            body.new_name
        )));
    }

    tokio::fs::rename(&full_path, &new_full_path)
        .await
        .map_err(|e| map_io_error(e, &full_path))?;

    // Build the new relative path for the response
    let parent_relative = body.path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
    let new_relative = if parent_relative.is_empty() {
        body.new_name.clone()
    } else {
        format!("{parent_relative}/{}", body.new_name)
    };

    let info = build_file_info_from_path(&new_full_path, &new_relative).await?;

    log::info!("Renamed: {} -> {}", full_path.display(), new_full_path.display());
    Ok(Json(info))
}

#[derive(Deserialize)]
pub struct CreateItemRequest {
    pub parent_path: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: FileType,
}

/// `POST /api/browse/{drive}/create` — create a new file or directory.
///
/// Returns the `FileInfo` for the newly created item.
pub async fn browse_create(Path(drive): Path<String>, Json(body): Json<CreateItemRequest>) -> Result<Json<FileInfo>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;

    validate_name(&body.name)?;

    let parent_path = resolve_safe_path(&base_path, &body.parent_path)?;

    if !parent_path.is_dir() {
        return Err(ApiError::NotFound(format!("Parent directory not found: {}", body.parent_path)));
    }

    let new_path = parent_path.join(&body.name);
    if new_path.exists() {
        return Err(ApiError::conflict_message(format!("An item named '{}' already exists", body.name)));
    }

    match body.item_type {
        FileType::Directory => {
            tokio::fs::create_dir(&new_path).await.map_err(|e| map_io_error(e, &new_path))?;
        }
        FileType::File => {
            File::create(&new_path).await.map_err(|e| map_io_error(e, &new_path))?;
        }
    }

    let new_relative = if body.parent_path.is_empty() {
        body.name.clone()
    } else {
        format!("{}/{}", body.parent_path, body.name)
    };

    let info = build_file_info_from_path(&new_path, &new_relative).await?;

    log::info!("Created: {}", new_path.display());
    Ok(Json(info))
}

#[derive(Deserialize)]
pub struct CopyMoveRequest {
    pub source_path: String,
    pub dest_path: String,
    /// When set to a different local-drive ID, the destination is resolved
    /// on that drive instead of the source drive.
    pub dest_connection_id: Option<String>,
    #[serde(default)]
    pub overwrite: bool,
}

/// `POST /api/browse/{drive}/copy` — copy a file or directory.
///
/// Returns 204 on success. Returns 409 with `ConflictInfo` if the
/// destination already exists and `overwrite` is false.
///
/// Supports cross-drive copy when `dest_connection_id` specifies a
/// different local drive (e.g. copying from drive C to drive D).
pub async fn browse_copy(Path(drive): Path<String>, Json(body): Json<CopyMoveRequest>) -> Result<StatusCode, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let dest_base = resolve_dest_drive(&drive, &body.dest_connection_id)?;

    validate_copy_move_paths(&body.source_path, &body.dest_path)?;

    let source = resolve_safe_path(&base_path, &body.source_path)?;
    let dest = resolve_safe_path_for_new(&dest_base, &body.dest_path)?;

    if dest.exists() && !body.overwrite {
        return Err(build_conflict_error(&source, &dest, &body.source_path, &body.dest_path).await);
    }

    let source_meta = tokio::fs::metadata(&source).await.map_err(|e| map_io_error(e, &source))?;

    if source_meta.is_dir() {
        copy_dir_recursive(&source, &dest).await.map_err(|e| map_io_error(e, &source))?;
    } else {
        // Ensure parent directory exists
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| map_io_error(e, parent))?;
        }
        tokio::fs::copy(&source, &dest).await.map_err(|e| map_io_error(e, &source))?;
    }

    log::info!("Copied: {} -> {}", source.display(), dest.display());
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/browse/{drive}/move` — move/rename a file or directory.
///
/// Returns 204 on success. Returns 409 with `ConflictInfo` if the
/// destination already exists and `overwrite` is false.
///
/// Supports cross-drive move when `dest_connection_id` specifies a
/// different local drive. Cross-drive moves are implemented as copy + delete
/// since `rename()` does not work across mount points.
pub async fn browse_move(Path(drive): Path<String>, Json(body): Json<CopyMoveRequest>) -> Result<StatusCode, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let dest_base = resolve_dest_drive(&drive, &body.dest_connection_id)?;
    let is_cross_drive = base_path != dest_base;

    validate_copy_move_paths(&body.source_path, &body.dest_path)?;

    let source = resolve_safe_path(&base_path, &body.source_path)?;
    let dest = resolve_safe_path_for_new(&dest_base, &body.dest_path)?;

    if dest.exists() && !body.overwrite {
        return Err(build_conflict_error(&source, &dest, &body.source_path, &body.dest_path).await);
    }

    // If the destination exists and overwrite is true, remove it first
    if dest.exists() {
        let dest_meta = tokio::fs::metadata(&dest).await.map_err(|e| map_io_error(e, &dest))?;
        if dest_meta.is_dir() {
            tokio::fs::remove_dir_all(&dest).await.map_err(|e| map_io_error(e, &dest))?;
        } else {
            tokio::fs::remove_file(&dest).await.map_err(|e| map_io_error(e, &dest))?;
        }
    }

    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| map_io_error(e, parent))?;
    }

    if is_cross_drive {
        // rename() fails across mount points — fall back to copy + delete
        let source_meta = tokio::fs::metadata(&source).await.map_err(|e| map_io_error(e, &source))?;
        if source_meta.is_dir() {
            copy_dir_recursive(&source, &dest).await.map_err(|e| map_io_error(e, &source))?;
            tokio::fs::remove_dir_all(&source).await.map_err(|e| map_io_error(e, &source))?;
        } else {
            tokio::fs::copy(&source, &dest).await.map_err(|e| map_io_error(e, &source))?;
            tokio::fs::remove_file(&source).await.map_err(|e| map_io_error(e, &source))?;
        }
    } else {
        tokio::fs::rename(&source, &dest).await.map_err(|e| map_io_error(e, &source))?;
    }

    log::info!("Moved: {} -> {}", source.display(), dest.display());
    Ok(StatusCode::NO_CONTENT)
}

// ─── Direct Open ─────────────────────────────────────────────────────────────

/// Request body for the `POST /api/browse/{drive}/open` endpoint.
#[derive(Deserialize)]
pub struct OpenRequest {
    /// Relative path of the file to open.
    pub path: String,
}

/// `POST /api/browse/{drive}/open` — open a local file with the system default application.
///
/// This is the Phase 3a "direct local open" — instead of downloading the file,
/// acquiring an edit lock, and re-uploading, the companion opens the file
/// directly from disk. No lock, no temp copy, no upload — zero latency.
pub async fn browse_open(Path(drive): Path<String>, Json(body): Json<OpenRequest>) -> Result<StatusCode, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let file_path = resolve_safe_path(&base_path, &body.path)?;

    if !file_path.is_file() {
        return Err(ApiError::BadRequest(format!("Not a file: {}", file_path.display())));
    }

    open_with_default(&file_path)?;

    log::info!("Opened file with default app: {}", file_path.display());
    Ok(StatusCode::NO_CONTENT)
}

// ─── Directory Search ────────────────────────────────────────────────────────

/// Maximum number of directory results to return per query.
const MAX_SEARCH_RESULTS: usize = 50;

/// Maximum number of directories to index per drive.
///
/// Prevents runaway recursion on very large or deep filesystems.
const MAX_DIRECTORY_SCAN: usize = 100_000;

/// Query parameters for directory search.
#[derive(Deserialize)]
pub struct DirectorySearchQuery {
    /// Search query string (case-insensitive substring match on path).
    pub q: Option<String>,
    /// Whether to include directories with dot-prefixed path segments.
    pub include_dot_directories: Option<bool>,
}

/// `GET /api/browse/{drive}/directories` — search for directories on a local drive.
///
/// Recursively walks the drive, collects directory paths, and returns those
/// matching the query string `q`. Produces the same JSON shape as the
/// backend's `DirectorySearchResult`.
///
/// Unlike the backend, this does not maintain a persistent cache — it walks
/// the filesystem on each request. For typical local drives this is fast
/// enough (< 1s for tens of thousands of directories).
pub async fn browse_search_directories(
    Path(drive): Path<String>,
    Query(query): Query<DirectorySearchQuery>,
) -> Result<Json<DirectorySearchResult>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;

    let canonical_base = std::fs::canonicalize(&base_path).map_err(|e| ApiError::NotFound(format!("Drive root inaccessible: {e}")))?;

    let q = query.q.unwrap_or_default();
    let include_dot_directories = query.include_dot_directories.unwrap_or(false);

    // Walk the directory tree and collect directory paths
    let directories = tokio::task::spawn_blocking({
        let base = canonical_base.clone();
        move || walk_directories(&base, MAX_DIRECTORY_SCAN, include_dot_directories)
    })
    .await
    .map_err(|e| ApiError::Internal(format!("Directory scan task failed: {e}")))?;

    let directory_count = directories.len();

    // Filter by query (case-insensitive substring match)
    let (results, total_matches) = if q.is_empty() {
        (Vec::new(), 0)
    } else {
        let q_lower = q.to_lowercase();
        let matching: Vec<String> = directories
            .into_iter()
            .filter(|path| path.to_lowercase().contains(&q_lower))
            .collect();
        let total = matching.len();
        let truncated = matching.into_iter().take(MAX_SEARCH_RESULTS).collect();
        (truncated, total)
    };

    Ok(Json(DirectorySearchResult {
        results,
        total_matches,
        cache_state: "ready".to_string(),
        directory_count,
    }))
}

/// Recursively walk a directory tree and collect relative directory paths.
///
/// Optionally skips hidden directories (starting with `.`) and stops after
/// `max_dirs` directories to prevent runaway scans on very large filesystems.
fn walk_directories(base: &std::path::Path, max_dirs: usize, include_dot_directories: bool) -> Vec<String> {
    let mut result = Vec::new();
    let mut stack: Vec<PathBuf> = vec![base.to_path_buf()];

    while let Some(dir) = stack.pop() {
        if result.len() >= max_dirs {
            break;
        }

        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue, // skip unreadable directories
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let name = entry.file_name();
            let name_str = name.to_string_lossy();

            // Skip hidden directories
            if !include_dot_directories && name_str.starts_with('.') {
                continue;
            }

            // Build relative path
            if let Ok(rel) = path.strip_prefix(base) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                result.push(rel_str);
                stack.push(path);
            }

            if result.len() >= max_dirs {
                break;
            }
        }
    }

    result.sort();
    result
}

/// Open a file using the platform's default application handler.
///
/// - **Linux**: `xdg-open`
/// - **macOS**: `open`
/// - **Windows**: `ShellExecuteW` via the Win32 API
fn open_with_default(path: &std::path::Path) -> Result<(), ApiError> {
    let path_str = path
        .to_str()
        .ok_or_else(|| ApiError::Internal("Path contains invalid Unicode".to_string()))?;

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path_str)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| ApiError::Internal(format!("Failed to open with xdg-open: {e}")))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path_str)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| ApiError::Internal(format!("Failed to open: {e}")))?;
    }

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOW;

        let wide_open: Vec<u16> = OsStr::new("open").encode_wide().chain(std::iter::once(0)).collect();
        let wide_path: Vec<u16> = OsStr::new(path_str).encode_wide().chain(std::iter::once(0)).collect();

        unsafe {
            let result = ShellExecuteW(
                None,
                PCWSTR(wide_open.as_ptr()),
                PCWSTR(wide_path.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOW,
            );
            // ShellExecuteW returns an HINSTANCE; values > 32 indicate success
            if (result.0 as usize) <= 32 {
                return Err(ApiError::Internal(format!("ShellExecuteW failed with code {}", result.0 as usize)));
            }
        }
    }

    Ok(())
}

// ─── Upload ──────────────────────────────────────────────────────────────────

/// Query parameters for the upload endpoint.
#[derive(Deserialize)]
pub struct UploadQuery {
    /// Destination path (relative to drive root) where the file will be written.
    pub path: String,
}

/// `POST /api/browse/{drive}/upload` — upload a file to a local drive.
///
/// Accepts multipart form data with a single file field named `file`.
/// Writes the file to the specified `path` on the drive.
/// Returns `UploadResponse` matching the backend's contract.
pub async fn browse_upload(
    Path(drive): Path<String>,
    Query(query): Query<UploadQuery>,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<UploadResponse>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let dest = resolve_safe_path_for_new(&base_path, &query.path)?;

    // Read the file field from the multipart body
    let mut file_data: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Invalid multipart data: {e}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" {
            let bytes = field
                .bytes()
                .await
                .map_err(|e| ApiError::Internal(format!("Failed to read upload data: {e}")))?;
            file_data = Some(bytes.to_vec());
            break;
        }
    }

    let data = file_data.ok_or_else(|| ApiError::BadRequest("Missing 'file' field in multipart data".to_string()))?;

    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| map_io_error(e, parent))?;
    }

    let size = data.len() as u64;
    tokio::fs::write(&dest, &data).await.map_err(|e| map_io_error(e, &dest))?;

    // Read metadata for the response
    let last_modified = tokio::fs::metadata(&dest).await.ok().and_then(|m| m.modified().ok()).map(|t| {
        let dt: DateTime<Utc> = t.into();
        dt.to_rfc3339()
    });

    log::info!("Uploaded {} bytes to {}", size, dest.display());

    Ok(Json(UploadResponse {
        status: "ok".to_string(),
        path: query.path,
        size,
        last_modified,
    }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Resolve the destination drive for cross-drive copy/move operations.
///
/// If `dest_connection_id` is `None` or refers to the same drive, returns
/// the source `base_path`. If it refers to a different local drive, resolves
/// and returns that drive's root path.
fn resolve_dest_drive(source_drive: &str, dest_connection_id: &Option<String>) -> Result<PathBuf, ApiError> {
    let dest_drive_id = match dest_connection_id {
        Some(conn_id) => {
            // Extract drive ID from "local-drive:X" format
            conn_id.strip_prefix(LOCAL_DRIVE_PREFIX).unwrap_or(conn_id)
        }
        None => {
            return drives::resolve_drive_path(source_drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {source_drive}")))
        }
    };

    // Same drive — no cross-drive operation needed
    if dest_drive_id == source_drive {
        return drives::resolve_drive_path(source_drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {source_drive}")));
    }

    drives::resolve_drive_path(dest_drive_id).ok_or_else(|| ApiError::NotFound(format!("Unknown destination drive: {dest_drive_id}")))
}

/// Resolve a relative path against a base path, preventing path traversal.
fn resolve_safe_path(base: &std::path::Path, relative: &str) -> Result<PathBuf, ApiError> {
    // Normalize the relative path — reject any ".." components
    let clean = relative.replace('\\', "/").trim_start_matches('/').to_string();

    for component in clean.split('/') {
        if component == ".." {
            return Err(ApiError::BadRequest("Path traversal not allowed".to_string()));
        }
    }

    let full = if clean.is_empty() { base.to_path_buf() } else { base.join(&clean) };

    // Verify the resolved path is still under the base
    let canonical_base = std::fs::canonicalize(base).map_err(|e| ApiError::NotFound(format!("Drive root inaccessible: {e}")))?;

    let canonical_full = std::fs::canonicalize(&full).map_err(|e| map_io_error(e, &full))?;

    if !canonical_full.starts_with(&canonical_base) {
        return Err(ApiError::Forbidden("Path is outside the drive boundary".to_string()));
    }

    Ok(canonical_full)
}

/// Build a `FileInfo` from a `DirEntry`.
async fn build_file_info(entry: &tokio::fs::DirEntry, parent_path: &str) -> Result<FileInfo, std::io::Error> {
    let metadata = entry.metadata().await?;
    let name = entry.file_name().to_string_lossy().to_string();

    let entry_path = if parent_path.is_empty() {
        name.clone()
    } else {
        format!("{parent_path}/{name}")
    };

    let file_type = if metadata.is_dir() { FileType::Directory } else { FileType::File };

    let size = if metadata.is_file() { Some(metadata.len()) } else { None };

    let mime_type = if metadata.is_file() {
        mime_guess::from_path(&name).first().map(|m| m.to_string())
    } else {
        None
    };

    let is_hidden = name.starts_with('.');

    Ok(FileInfo {
        name,
        path: entry_path,
        file_type,
        size,
        mime_type,
        created_at: system_time_to_chrono(metadata.created().ok()),
        modified_at: system_time_to_chrono(metadata.modified().ok()),
        is_readable: true,
        is_hidden,
    })
}

/// Convert `std::time::SystemTime` to `chrono::DateTime<Utc>`.
fn system_time_to_chrono(time: Option<std::time::SystemTime>) -> Option<DateTime<Utc>> {
    time.map(DateTime::<Utc>::from)
}

/// Extract the `Origin` header value from a request's headers.
fn extract_origin(headers: &HeaderMap) -> Result<String, ApiError> {
    headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::BadRequest("Missing Origin header".to_string()))
}

/// Map an I/O error to an appropriate API error with context.
fn map_io_error(err: std::io::Error, path: &std::path::Path) -> ApiError {
    let path_display = path.display();
    match err.kind() {
        std::io::ErrorKind::NotFound => ApiError::NotFound(format!("Path not found: {path_display}")),
        std::io::ErrorKind::PermissionDenied => ApiError::Forbidden(format!("Permission denied: {path_display}")),
        _ => ApiError::Io(err),
    }
}

/// Validate a file/directory name for forbidden characters and patterns.
///
/// Matches the backend validation in `browser.py` — rejects empty names,
/// `.`/`..`, names containing `\/:*?"<>|`, and names ending with space or period.
fn validate_name(name: &str) -> Result<(), ApiError> {
    if name.is_empty() {
        return Err(ApiError::BadRequest("Name cannot be empty".to_string()));
    }
    if name == "." || name == ".." {
        return Err(ApiError::BadRequest(format!("Invalid name: '{name}'")));
    }
    if name.contains(FORBIDDEN_NAME_CHARS) {
        return Err(ApiError::BadRequest(format!("Name contains forbidden characters: '{name}'")));
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return Err(ApiError::BadRequest("Name cannot end with a space or period".to_string()));
    }
    Ok(())
}

/// Validate source/dest paths for copy/move operations.
fn validate_copy_move_paths(source: &str, dest: &str) -> Result<(), ApiError> {
    if source.is_empty() || dest.is_empty() {
        return Err(ApiError::BadRequest("Source and destination paths cannot be empty".to_string()));
    }
    if source == dest {
        return Err(ApiError::BadRequest("Source and destination paths are the same".to_string()));
    }
    // Prevent copying/moving a directory into itself
    let dest_with_sep = format!("{dest}/");
    if dest_with_sep.starts_with(&format!("{source}/")) {
        return Err(ApiError::BadRequest("Cannot copy or move a directory into itself".to_string()));
    }
    Ok(())
}

/// Resolve a path that may not exist yet (for copy/move destinations).
///
/// Unlike `resolve_safe_path`, this validates the *parent* directory exists
/// and checks the full path stays within the drive boundary.
fn resolve_safe_path_for_new(base: &std::path::Path, relative: &str) -> Result<PathBuf, ApiError> {
    let clean = relative.replace('\\', "/").trim_start_matches('/').to_string();

    for component in clean.split('/') {
        if component == ".." {
            return Err(ApiError::BadRequest("Path traversal not allowed".to_string()));
        }
    }

    let full = if clean.is_empty() { base.to_path_buf() } else { base.join(&clean) };

    // Verify the parent exists and the path is within bounds
    let canonical_base = std::fs::canonicalize(base).map_err(|e| ApiError::NotFound(format!("Drive root inaccessible: {e}")))?;

    if let Some(parent) = full.parent() {
        if parent.exists() {
            let canonical_parent = std::fs::canonicalize(parent).map_err(|e| map_io_error(e, parent))?;
            if !canonical_parent.starts_with(&canonical_base) {
                return Err(ApiError::Forbidden("Path is outside the drive boundary".to_string()));
            }
        }
    }

    Ok(full)
}

/// Build a `FileInfo` from an absolute path and its relative representation.
async fn build_file_info_from_path(path: &std::path::Path, relative: &str) -> Result<FileInfo, ApiError> {
    let metadata = tokio::fs::metadata(path).await.map_err(|e| map_io_error(e, path))?;

    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();

    let file_type = if metadata.is_dir() { FileType::Directory } else { FileType::File };

    let size = if metadata.is_file() { Some(metadata.len()) } else { None };

    let mime_type = if metadata.is_file() {
        mime_guess::from_path(path).first().map(|m| m.to_string())
    } else {
        None
    };

    let is_hidden = name.starts_with('.');

    Ok(FileInfo {
        name,
        path: relative.to_string(),
        file_type,
        size,
        mime_type,
        created_at: system_time_to_chrono(metadata.created().ok()),
        modified_at: system_time_to_chrono(metadata.modified().ok()),
        is_readable: true,
        is_hidden,
    })
}

/// Build a `ConflictInfo` 409 error from source and destination paths.
async fn build_conflict_error(source: &std::path::Path, dest: &std::path::Path, source_rel: &str, dest_rel: &str) -> ApiError {
    // Try to build ConflictInfo with metadata; fall back to plain message
    let source_info = build_file_info_from_path(source, source_rel).await;
    let dest_info = build_file_info_from_path(dest, dest_rel).await;

    match (source_info, dest_info) {
        (Ok(incoming), Ok(existing)) => {
            let conflict = ConflictInfo {
                existing_file: existing,
                incoming_file: incoming,
            };
            ApiError::Conflict(
                serde_json::to_value(conflict).unwrap_or_else(|_| serde_json::Value::String("Destination already exists".to_string())),
            )
        }
        _ => ApiError::conflict_message(format!("Destination already exists: {dest_rel}")),
    }
}

/// Recursively copy a directory and its contents.
async fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), std::io::Error> {
    tokio::fs::create_dir_all(dst).await?;

    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let entry_type = entry.file_type().await?;
        let src_child = entry.path();
        let dst_child = dst.join(entry.file_name());

        if entry_type.is_dir() {
            Box::pin(copy_dir_recursive(&src_child, &dst_child)).await?;
        } else {
            tokio::fs::copy(&src_child, &dst_child).await?;
        }
    }

    Ok(())
}
