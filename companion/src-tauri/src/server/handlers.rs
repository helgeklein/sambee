//! HTTP request handlers for the local API server.
//!
//! Each handler mirrors the corresponding endpoint in the Sambee Python
//! backend, producing identical JSON response shapes.

use std::collections::HashSet;
use std::future::Future;
use std::io::Write;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use axum::Json;
use chrono::{DateTime, Utc};
use log::{info, warn};
use reqwest::{Client, Response as ReqwestResponse};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio::task::JoinSet;
use tokio_util::io::{ReaderStream, SyncIoBridge};

use crate::http_client::{classify_proxy_auth_intercept, log_request_error, SambeeHttpClientStore};
use crate::{commands, show_pairing_success, show_pairing_window};

use super::archive::{
    build_local_archive_manifest, build_local_archive_manifest_for_remote_target, create_local_archive, create_local_archive_relay_writer,
    create_local_extraction_root, ensure_local_extraction_directory, open_local_extraction_file, project_local_archive_creation_manifest,
    reopen_partial_local_extraction_file, stream_local_archive_member, validate_local_archive_extraction,
    validate_local_extraction_member_path, ArchiveCreationManifest, ArchiveCreationManifestState, ArchiveExtractionManifest,
    ArchiveExtractionManifestMember, ArchiveExtractionRelayExecutionPlan, ArchiveExtractionRelayState, ArchiveInspectionCoordinator,
    LocalArchiveCreationResult, LocalArchiveEntry, LocalArchiveError, LocalArchiveReadEntry, LocalArchiveRelayChunk,
    ARCHIVE_COPY_BUFFER_SIZE,
};
use super::archive_sessions::{ArchiveSessionProgress, ArchiveSessionStatus, LocalArchiveOperationCoordinator};
use super::auth;
use super::drives;
use super::edit_locks::EDIT_LOCK_LOST_CODE;
use super::errors::{
    ApiError, LOCAL_ARCHIVE_CREATION_PARTIAL_CODE, LOCAL_ARCHIVE_EXTRACTION_PARTIAL_CODE, LOCAL_LINK_TARGET_ACCESS_DENIED_CODE,
    LOCAL_LINK_TARGET_MISSING_CODE, LOCAL_LINK_TARGET_UNMAPPED_DRIVE_CODE, LOCAL_LINK_TARGET_UNRESOLVABLE_CODE,
    LOCAL_LINK_TARGET_UNSUPPORTED_TYPE_CODE, PAIR_CONFIRMATION_PENDING_CODE, RECENT_FILE_NATIVE_LAUNCH_FAILED_CODE,
    RECENT_FILE_TARGET_MISSING_CODE, RECENT_FILE_TARGET_NOT_FILE_CODE,
};
use super::links::{resolve_activation_target, LinkResolutionError};
use super::models::*;
use super::pairing::{PairingInitiateError, PairingState};
use super::AppState;

/// Characters forbidden in file/directory names (matches backend validation).
const FORBIDDEN_NAME_CHARS: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
/// Prefix used by the frontend for synthetic local-drive connection IDs.
const LOCAL_DRIVE_PREFIX: &str = "local-drive:";
/// Maximum number of potentially blocking local target resolutions per batch.
const LINK_TARGET_RESOLUTION_CONCURRENCY: usize = 4;
#[cfg(any(windows, test))]
const WINDOWS_EXTENDED_PATH_PREFIX: &str = "\\\\?\\";
#[cfg(any(windows, test))]
const WINDOWS_EXTENDED_UNC_PATH_PREFIX: &str = "\\\\?\\UNC\\";
#[cfg(any(windows, test))]
const WINDOWS_UNC_PATH_PREFIX: &str = "\\\\";

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

    let log_context = auth::AuthLogContext {
        auth_transport: "query",
        method: "GET",
        path: "/api/ws",
    };

    auth::validate_hmac_public(&state, &origin_val, &hmac_val, &ts_val, &log_context)?;

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
            let normalized_path = match normalize_drive_relative_path(drive, path) {
                Ok(normalized) => normalized,
                Err(e) => {
                    warn!("WS subscribe failed for {drive}:{path}: {e}");
                    return Ok(());
                }
            };
            let key = format!("{drive}:{normalized_path}");

            if let Some(root) = drives::resolve_drive_path(drive) {
                match state.watcher.subscribe(drive, &normalized_path, &root).await {
                    Ok(()) => {
                        subscriptions.insert(key);
                        let reply = serde_json::json!({
                            "type": "subscribed",
                            "connection_id": connection_id,
                            "path": normalized_path,
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
            let normalized_path = match normalize_drive_relative_path(drive, path) {
                Ok(normalized) => normalized,
                Err(e) => {
                    warn!("WS unsubscribe failed for {drive}:{path}: {e}");
                    return Ok(());
                }
            };
            let key = format!("{drive}:{normalized_path}");

            if subscriptions.remove(&key) {
                state.watcher.unsubscribe(drive, &normalized_path).await;
            }

            let reply = serde_json::json!({
                "type": "unsubscribed",
                "connection_id": connection_id,
                "path": normalized_path,
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
    pub origin: Option<String>,
}

/// `POST /api/pair/initiate` — start a pairing exchange.
pub async fn pair_initiate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PairInitiateRequest>,
) -> Result<Json<PairInitiateResponse>, ApiError> {
    let origin = extract_origin(&headers).or_else(|_| extract_origin_from_pair_initiate_request(&body))?;

    let (pairing_id, nonce_companion, code) = state.pairing.initiate(&body.nonce_browser, &origin).map_err(|err| match err {
        PairingInitiateError::Validation(msg) => ApiError::BadRequest(msg),
        PairingInitiateError::RateLimited(msg) => ApiError::TooManyRequests(msg),
    })?;

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
    pub origin: Option<String>,
}

/// `POST /api/pair/confirm` — complete a pairing after dual confirmation.
pub async fn pair_confirm(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PairConfirmRequest>,
) -> Result<Json<PairConfirmResponse>, ApiError> {
    let origin = resolve_pair_confirm_origin(&headers, body.origin.as_deref())?;
    let secret = state.pairing.confirm(&body.pairing_id, &origin).map_err(map_pair_confirm_error)?;

    show_pairing_success(&state.app);

    Ok(Json(PairConfirmResponse { secret }))
}

/// `POST /api/localization` — synchronize browser localization to the companion.
pub async fn sync_localization(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<LocalizationSyncRequest>,
) -> Result<Json<LocalizationSyncResponse>, ApiError> {
    let origin = extract_origin(&headers)?;
    let (current, applied) = state
        .localization
        .apply_update(&state.app, &origin, body)
        .map_err(ApiError::BadRequest)?;

    if applied {
        let _ = state.app.emit("localization-updated", &current);
    }

    Ok(Json(LocalizationSyncResponse { applied, state: current }))
}

#[derive(Deserialize)]
pub struct PairStatusQuery {
    pub origin: Option<String>,
}

/// `GET /api/pair/status` — pairing status for the current browser origin.
pub async fn pair_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<PairStatusQuery>,
) -> Json<PairStatusResponse> {
    let origin = resolve_pair_status_origin(&headers, query.origin.as_deref()).ok();
    Json(build_pair_status_response(&state.pairing, origin.as_deref()))
}

#[derive(Deserialize)]
pub struct PairCancelRequest {
    pub pairing_id: String,
    pub origin: Option<String>,
}

/// `POST /api/pair/cancel` — explicitly cancel a pending browser-side pairing.
pub async fn pair_cancel(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PairCancelRequest>,
) -> Result<StatusCode, ApiError> {
    let origin = resolve_pair_cancel_origin(&headers, body.origin.as_deref())?;

    state.pairing.cancel(&body.pairing_id, &origin).map_err(ApiError::BadRequest)?;
    Ok(StatusCode::NO_CONTENT)
}

/// `DELETE /api/pair/current` — remove the current browser origin's pairing.
pub async fn delete_current_pairing(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Result<StatusCode, ApiError> {
    let origin = extract_origin(&headers)?;
    state.pairing.unpair(&origin).map_err(ApiError::BadRequest)?;
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

#[derive(Deserialize)]
pub struct ArchiveListQuery {
    pub archive_path: String,
    pub virtual_path: Option<String>,
    pub cursor: Option<String>,
    pub page_size: Option<usize>,
}

/// `GET /api/browse/{drive}/list` — list directory contents.
pub async fn browse_list(Path(drive): Path<String>, Query(query): Query<BrowseQuery>) -> Result<Json<DirectoryListing>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;

    let relative = query.path.as_deref().unwrap_or("");
    let normalized_relative = normalize_drive_relative_path(&drive, relative)?;
    let full_path = resolve_safe_path(&base_path, &drive, relative)?;

    let mut items = Vec::new();

    let mut entries = tokio::fs::read_dir(&full_path).await.map_err(|e| map_io_error(e, &full_path))?;

    while let Some(entry) = entries.next_entry().await.map_err(ApiError::Io)? {
        match build_file_info(&entry, &normalized_relative).await {
            Ok(info) => items.push(info),
            Err(e) => {
                // Skip entries we can't stat (e.g., broken symlinks)
                log::debug!("Skipping entry {:?}: {e}", entry.file_name());
            }
        }
    }

    let total = items.len();

    Ok(Json(DirectoryListing {
        path: normalized_relative,
        items,
        total,
    }))
}

/// `GET /api/browse/{drive}/archive/list` — list a bounded virtual ZIP directory page.
pub async fn browse_list_archive(
    Path(drive): Path<String>,
    Query(query): Query<ArchiveListQuery>,
) -> Result<Json<ArchiveDirectoryListing>, ApiError> {
    if query.archive_path.trim().is_empty() {
        return Err(ApiError::BadRequest("Archive path is required".to_string()));
    }
    let page_size = query.page_size.unwrap_or(100);
    if !(1..=500).contains(&page_size) {
        return Err(ApiError::BadRequest(
            "Archive listing page size must be between 1 and 500".to_string(),
        ));
    }
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let archive_path = resolve_safe_path(&base_path, &drive, &query.archive_path)?;
    let metadata = tokio::fs::metadata(&archive_path)
        .await
        .map_err(|error| map_io_error(error, &archive_path))?;
    if !metadata.is_file() {
        return Err(ApiError::BadRequest("Archive path must identify a regular file".to_string()));
    }
    let archive_size = metadata.len();
    let archive_modified_at = metadata.modified().ok().map(DateTime::<Utc>::from);
    let virtual_path = query.virtual_path.unwrap_or_default();
    let requested_virtual_path = virtual_path.clone();
    let cursor = query.cursor;
    let page = tokio::task::spawn_blocking(move || {
        ArchiveInspectionCoordinator::from_archive_path(&archive_path)?.list_directory(
            &requested_virtual_path,
            cursor.as_deref(),
            page_size,
        )
    })
    .await
    .map_err(|error| ApiError::Internal(format!("Local archive listing task failed: {error}")))?
    .map_err(map_local_archive_read_error)?;

    let items = page
        .entries
        .into_iter()
        .map(|entry| ArchiveEntryInfo {
            name: entry.name.clone(),
            path: entry.path,
            file_type: if entry.is_directory { FileType::Directory } else { FileType::File },
            size: entry.uncompressed_size,
            compressed_size: entry.compressed_size,
            compression_method: entry.compression_method,
            crc32: entry.crc32,
            modified_at: entry.modified_at,
            state: if entry.encrypted {
                ArchiveEntryState::Blocked
            } else if entry.is_available {
                ArchiveEntryState::Readable
            } else {
                ArchiveEntryState::Unavailable
            },
            is_hidden: entry.name.starts_with('.'),
        })
        .collect();
    Ok(Json(ArchiveDirectoryListing {
        archive: ArchiveIdentity {
            path: query.archive_path,
            size: archive_size,
            modified_at: archive_modified_at,
        },
        path: virtual_path.trim_end_matches('/').to_string(),
        items,
        total: page.total,
        next_cursor: page.next_cursor,
        page_size,
    }))
}

/// `GET /api/browse/{drive}/link-targets` — resolve display-safe target metadata for links in one directory.
///
/// This intentionally runs separately from directory listing so unavailable
/// link targets never delay the file browser's initial render.
pub async fn browse_list_link_targets(
    Path(drive): Path<String>,
    Query(query): Query<BrowseQuery>,
) -> Result<Json<LinkTargetListing>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let relative = query.path.as_deref().unwrap_or("");
    let normalized_relative = normalize_drive_relative_path(&drive, relative)?;
    let full_path = resolve_safe_path(&base_path, &drive, relative)?;
    let mut entries = tokio::fs::read_dir(&full_path)
        .await
        .map_err(|error| map_io_error(error, &full_path))?;
    let mut pending = JoinSet::new();
    let mut items = Vec::new();

    while let Some(entry) = entries.next_entry().await.map_err(ApiError::Io)? {
        let source_path = entry.path();
        let is_link = match source_link_kind(&source_path).await {
            Ok(Some(_)) => true,
            Ok(None) => false,
            Err(error) => {
                log::debug!("Skipping link target metadata for {:?}: {error}", entry.file_name());
                false
            }
        };
        if !is_link {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let source_relative_path = if normalized_relative.is_empty() {
            name
        } else {
            format!("{normalized_relative}/{name}")
        };

        if pending.len() >= LINK_TARGET_RESOLUTION_CONCURRENCY {
            collect_link_target_resolution(&mut pending, &mut items).await?;
        }
        pending.spawn_blocking(move || resolve_link_target_metadata(source_relative_path, source_path));
    }

    while !pending.is_empty() {
        collect_link_target_resolution(&mut pending, &mut items).await?;
    }

    items.sort_by(|left: &LinkTargetResolution, right: &LinkTargetResolution| left.source_path.cmp(&right.source_path));
    Ok(Json(LinkTargetListing { items }))
}

/// `GET /api/browse/{drive}/info` — get metadata for a single file/directory.
pub async fn browse_info(Path(drive): Path<String>, Query(query): Query<BrowseQuery>) -> Result<Json<FileInfo>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;

    let relative = query.path.as_deref().unwrap_or("");
    let normalized_relative = normalize_drive_relative_path(&drive, relative)?;
    let source_path = resolve_drive_relative_source_path(&base_path, &drive, relative)?;
    let full_path = resolve_safe_path(&base_path, &drive, relative)?;

    let metadata = tokio::fs::metadata(&full_path).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            ApiError::not_found_code(format!("Path not found: {}", full_path.display()), RECENT_FILE_TARGET_MISSING_CODE)
        } else {
            map_io_error(error, &full_path)
        }
    })?;

    let name = source_path.file_name().unwrap_or_default().to_string_lossy().to_string();

    let file_type = if metadata.is_dir() { FileType::Directory } else { FileType::File };

    let size = if metadata.is_file() { Some(metadata.len()) } else { None };

    let mime_type = if metadata.is_file() {
        mime_guess::from_path(&full_path).first().map(|m| m.to_string())
    } else {
        None
    };

    let is_hidden = name.starts_with('.');
    let link_kind = source_link_kind(&source_path)
        .await
        .map_err(|error| map_io_error(error, &source_path))?;

    Ok(Json(FileInfo {
        name,
        path: normalized_relative,
        file_type,
        size,
        mime_type,
        created_at: system_time_to_chrono(metadata.created().ok()),
        modified_at: system_time_to_chrono(metadata.modified().ok()),
        is_readable: true, // We can read it if we could stat it
        is_hidden,
        link_kind,
    }))
}

/// `GET /api/browse/{drive}/resolve-activation` — resolve a local entry before opening it.
///
/// The response always uses a canonical path rooted in an exposed local drive,
/// including when a filesystem link or Windows shortcut points to another drive.
pub async fn browse_resolve_activation(
    Path(drive): Path<String>,
    Query(query): Query<BrowseQuery>,
) -> Result<Json<ActivationResolution>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let relative = query.path.as_deref().unwrap_or("");
    let source_path = resolve_activation_source_path(&base_path, &drive, relative)?;
    let target_path = tokio::task::spawn_blocking(move || resolve_activation_target(&source_path))
        .await
        .map_err(|error| ApiError::Internal(format!("Link resolution task failed: {error}")))?
        .map_err(map_link_resolution_error)?;

    if classify_link_target(&target_path).await? == LinkTargetType::Other {
        return Err(ApiError::bad_request_code(
            "The link target is not a regular file or directory",
            LOCAL_LINK_TARGET_UNSUPPORTED_TYPE_CODE,
        ));
    }

    let (target_drive_id, target_relative_path) = drives::drive_for_path(&target_path).ok_or_else(|| {
        ApiError::forbidden_code(
            "The link target is not on an accessible local drive",
            LOCAL_LINK_TARGET_UNMAPPED_DRIVE_CODE,
        )
    })?;
    let target_relative = target_relative_path.to_string_lossy().replace('\\', "/");
    let item = build_file_info_from_path(&target_path, &target_relative).await?;

    Ok(Json(ActivationResolution {
        drive_id: target_drive_id,
        path: target_relative,
        item,
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

#[derive(Deserialize)]
pub struct ArchiveMemberQuery {
    pub archive_path: String,
    pub member_path: String,
    #[serde(default)]
    pub download: bool,
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

/// `GET /api/viewer/{drive}/archive/member` — stream a parser-validated archive member.
pub async fn viewer_archive_member(Path(drive): Path<String>, Query(query): Query<ArchiveMemberQuery>) -> Result<Response<Body>, ApiError> {
    if query.archive_path.trim().is_empty() || query.member_path.trim().is_empty() {
        return Err(ApiError::BadRequest("Archive and member paths are required".to_string()));
    }
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let archive_path = resolve_safe_path(&base_path, &drive, &query.archive_path)?;
    let metadata = tokio::fs::metadata(&archive_path)
        .await
        .map_err(|error| map_io_error(error, &archive_path))?;
    if !metadata.is_file() {
        return Err(ApiError::BadRequest("Archive path must identify a regular file".to_string()));
    }

    let member_path = query.member_path.replace('\\', "/");
    let inspection_path = archive_path.clone();
    let inspection_member_path = member_path.clone();
    let member = tokio::task::spawn_blocking(move || {
        ArchiveInspectionCoordinator::from_archive_path(&inspection_path)
            .and_then(|coordinator| coordinator.member(&inspection_member_path).cloned())
    })
    .await
    .map_err(|error| ApiError::Internal(format!("Local archive validation task failed: {error}")))?
    .map_err(map_local_archive_read_error)?;
    if !query.download && !member.is_inline_preview_eligible() {
        return Err(ApiError::PayloadTooLarge(
            "Archive member exceeds the inline preview size limit".to_string(),
        ));
    }

    let (writer, reader) = tokio::io::duplex(ARCHIVE_COPY_BUFFER_SIZE);
    tokio::task::spawn_blocking(move || {
        let mut output = SyncIoBridge::new(writer);
        if let Err(error) = stream_local_archive_member(&archive_path, &member_path, &mut output) {
            warn!("Local archive member stream failed: {error}");
        }
    });

    let normalized_member_path = query.member_path.replace('\\', "/");
    let member_name = normalized_member_path.rsplit('/').next().unwrap_or("download");
    let mime_type = mime_guess::from_path(member_name).first_or_octet_stream().to_string();
    let disposition = format!(
        "{}; filename=\"{member_name}\"",
        if query.download { "attachment" } else { "inline" }
    );
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime_type)
        .header(
            "Content-Disposition",
            HeaderValue::from_str(&disposition).unwrap_or_else(|_| HeaderValue::from_static("attachment")),
        )
        .body(Body::from_stream(ReaderStream::new(reader)))
        .map_err(|error| ApiError::Internal(format!("Failed to build archive member response: {error}")))
}

/// Resolve drive + query path for viewer endpoints, returning the full path and MIME type.
fn resolve_viewer_path(drive: &str, query: &ViewerQuery) -> Result<(PathBuf, String), ApiError> {
    let base_path = drives::resolve_drive_path(drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;

    let relative = query.path.as_deref().unwrap_or("");
    let full_path = resolve_safe_path(&base_path, drive, relative)?;

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

    let relative = normalize_drive_relative_path(&drive, query.path.as_deref().unwrap_or(""))?;
    if relative.is_empty() {
        return Err(ApiError::BadRequest("Cannot delete the drive root".to_string()));
    }

    let full_path = resolve_safe_path(&base_path, &drive, &relative)?;

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

    let relative_path = normalize_drive_relative_path(&drive, &body.path)?;

    if relative_path.is_empty() {
        return Err(ApiError::BadRequest("Cannot rename the drive root".to_string()));
    }

    let full_path = resolve_safe_path(&base_path, &drive, &body.path)?;

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
    let parent_relative = relative_path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
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

    let parent_relative = normalize_drive_relative_path(&drive, &body.parent_path)?;
    let parent_path = resolve_safe_path(&base_path, &drive, &body.parent_path)?;

    if !parent_path.is_dir() {
        return Err(ApiError::NotFound(format!("Parent directory not found: {parent_relative}")));
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

    let new_relative = if parent_relative.is_empty() {
        body.name.clone()
    } else {
        format!("{}/{}", parent_relative, body.name)
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
    let (dest_drive, dest_base) = resolve_dest_drive(&drive, &body.dest_connection_id)?;

    validate_copy_move_paths(&body.source_path, &body.dest_path)?;

    let source = resolve_safe_path(&base_path, &drive, &body.source_path)?;
    let dest = resolve_safe_path_for_new(&dest_base, &dest_drive, &body.dest_path)?;

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
    let (dest_drive, dest_base) = resolve_dest_drive(&drive, &body.dest_connection_id)?;
    let is_cross_drive = base_path != dest_base;

    validate_copy_move_paths(&body.source_path, &body.dest_path)?;

    let source = resolve_safe_path(&base_path, &drive, &body.source_path)?;
    let dest = resolve_safe_path_for_new(&dest_base, &dest_drive, &body.dest_path)?;

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
    /// Whether to force the native app picker instead of auto-using a saved app.
    #[serde(default)]
    pub force_picker: bool,
}

/// `POST /api/browse/{drive}/open` — open a local file through the companion app picker.
///
/// This keeps local-drive Ctrl+Enter behavior aligned with SMB native editing
/// while still opening the real on-disk file directly, without a temp-copy
/// lifecycle.
pub async fn browse_open(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    Json(body): Json<OpenRequest>,
) -> Result<StatusCode, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let file_path = resolve_safe_path(&base_path, &drive, &body.path)?;

    let metadata = tokio::fs::metadata(&file_path).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            ApiError::not_found_code(format!("Path not found: {}", file_path.display()), RECENT_FILE_TARGET_MISSING_CODE)
        } else {
            map_io_error(error, &file_path)
        }
    })?;
    if !metadata.is_file() {
        return Err(ApiError::bad_request_code(
            format!("Not a file: {}", file_path.display()),
            RECENT_FILE_TARGET_NOT_FILE_CODE,
        ));
    }

    let extension = file_path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
    let selection = commands::open_file::prompt_for_app_selection(&state.app, extension, body.force_picker)
        .await
        .map_err(ApiError::Internal)?;

    let Some(selected_app) = selection else {
        log::info!("User cancelled app picker for local file: {}", file_path.display());
        return Ok(StatusCode::NO_CONTENT);
    };

    commands::open_file::open_in_native_app(&state.app, &file_path, &selected_app.executable, selected_app.handler_id.as_deref())
        .await
        .map_err(|error| ApiError::internal_code(error, RECENT_FILE_NATIVE_LAUNCH_FAILED_CODE))?;

    log::info!(
        "Opened local file with selected app: {} ({})",
        file_path.display(),
        selected_app.name
    );
    Ok(StatusCode::NO_CONTENT)
}

// ─── Archive Creation ───────────────────────────────────────────────────────

/// `POST /api/browse/{drive}/archive` — write a ZIP directly from local selections.
pub async fn browse_create_archive(
    Path(drive): Path<String>,
    Json(body): Json<ArchiveCreateRequest>,
) -> Result<Json<ArchiveCreationResponse>, ApiError> {
    if body.source_paths.is_empty() || body.target_path.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Archive creation requires source paths and a target path".to_string(),
        ));
    }
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let sources = body
        .source_paths
        .iter()
        .map(|source_path| resolve_safe_path(&base_path, &drive, source_path))
        .collect::<Result<Vec<_>, _>>()?;
    let target = resolve_safe_path_for_new(&base_path, &drive, &body.target_path)?;
    let Some(parent) = target.parent() else {
        return Err(ApiError::BadRequest("Archive target path is invalid".to_string()));
    };
    if !parent.is_dir() {
        return Err(ApiError::BadRequest("Archive target parent directory does not exist".to_string()));
    }

    let result = tokio::task::spawn_blocking(move || {
        let manifest = build_local_archive_manifest(&sources, &target)?;
        create_local_archive(&base_path, &target, &manifest, || false)
    })
    .await
    .map_err(|error| ApiError::Internal(format!("Local archive task failed: {error}")))?
    .map_err(map_local_archive_error)?;

    info!(
        "Created local archive with {} files and {} directories",
        result.files_created, result.directories_created
    );
    Ok(Json(ArchiveCreationResponse {
        files_created: result.files_created,
        directories_created: result.directories_created,
        source_bytes: result.source_bytes,
    }))
}

fn archive_creation_response(result: LocalArchiveCreationResult) -> ArchiveCreationResponse {
    ArchiveCreationResponse {
        files_created: result.files_created,
        directories_created: result.directories_created,
        source_bytes: result.source_bytes,
    }
}

#[derive(Serialize)]
struct ArchiveCreationMemberCompletion<'a> {
    archive_path: &'a str,
    status: &'static str,
    source_bytes: u64,
}

#[derive(Serialize)]
struct ArchiveRelayFailure<'a> {
    message: &'a str,
}

struct ArchiveRelayTransport {
    client: Client,
    relay_url: String,
    operation_token: String,
}

enum ArchiveRelayBinding {
    LocalZipToSmbExtract,
    SmbZipToLocalExtract,
    SmbToLocalZipCreate,
    LocalToSmbZipCreate,
}

impl ArchiveRelayBinding {
    const fn path_segment(self) -> &'static str {
        match self {
            Self::LocalZipToSmbExtract => "local_zip_to_smb_extract",
            Self::SmbZipToLocalExtract => "smb_zip_to_local_extract",
            Self::SmbToLocalZipCreate => "smb_to_local_zip_create",
            Self::LocalToSmbZipCreate => "local_to_smb_zip_create",
        }
    }
}

impl ArchiveRelayTransport {
    fn new(client: Client, relay_url: String, operation_token: String) -> Self {
        Self {
            client,
            relay_url,
            operation_token,
        }
    }

    fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .get(format!("{}/{}", self.relay_url, path))
            .bearer_auth(&self.operation_token)
    }

    fn post(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .post(format!("{}/{}", self.relay_url, path))
            .bearer_auth(&self.operation_token)
    }

    fn put(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .put(format!("{}/{}", self.relay_url, path))
            .bearer_auth(&self.operation_token)
    }

    async fn begin<T: DeserializeOwned>(&self, request_context: &str) -> Result<T, ApiError> {
        decode_archive_relay_json(
            self.post("begin")
                .send()
                .await
                .map_err(|error| ApiError::Internal(log_request_error(request_context, "POST", self.url(), &error)))?,
            "start",
        )
        .await
    }

    async fn begin_with_json<T: Serialize + ?Sized, R: DeserializeOwned>(&self, payload: &T, request_context: &str) -> Result<R, ApiError> {
        decode_archive_relay_json(
            self.post("begin")
                .json(payload)
                .send()
                .await
                .map_err(|error| ApiError::Internal(log_request_error(request_context, "POST", self.url(), &error)))?,
            "start",
        )
        .await
    }

    async fn complete(&self, request_context: &str) -> Result<(), ApiError> {
        relay_archive_response(
            self.post("complete")
                .send()
                .await
                .map_err(|error| ApiError::Internal(log_request_error(request_context, "POST", self.url(), &error)))?,
            "complete",
        )
        .await
    }

    async fn complete_with_json<T: Serialize + ?Sized>(&self, payload: &T, request_context: &str) -> Result<(), ApiError> {
        self.post_json_without_result("complete", payload, request_context, "complete")
            .await
    }

    async fn post_json_without_result<T: Serialize + ?Sized>(
        &self,
        path: &str,
        payload: &T,
        request_context: &str,
        action: &str,
    ) -> Result<(), ApiError> {
        relay_archive_response(
            self.post(path)
                .json(payload)
                .send()
                .await
                .map_err(|error| ApiError::Internal(log_request_error(request_context, "POST", self.url(), &error)))?,
            action,
        )
        .await
    }

    async fn post_json<T: Serialize + ?Sized, R: DeserializeOwned>(
        &self,
        path: &str,
        payload: &T,
        request_context: &str,
        action: &str,
    ) -> Result<R, ApiError> {
        decode_archive_relay_json(
            self.post(path)
                .json(payload)
                .send()
                .await
                .map_err(|error| ApiError::Internal(log_request_error(request_context, "POST", self.url(), &error)))?,
            action,
        )
        .await
    }

    async fn fail(&self, message: &str, request_context: &str) -> Result<(), ApiError> {
        self.post_json_without_result("fail", &ArchiveRelayFailure { message }, request_context, "record failure")
            .await
    }

    fn url(&self) -> &str {
        &self.relay_url
    }
}

fn archive_relay_transport(
    state: &AppState,
    headers: &HeaderMap,
    server_url: &str,
    operation_id: &str,
    operation_token: String,
    binding: ArchiveRelayBinding,
) -> Result<ArchiveRelayTransport, ApiError> {
    let operation_id =
        uuid::Uuid::parse_str(operation_id).map_err(|_| ApiError::BadRequest("Archive operation ID is invalid".to_string()))?;
    let server_url = normalize_archive_server_url(server_url)?;
    if url::Url::parse(&server_url)
        .map_err(|_| ApiError::BadRequest("Archive server URL is invalid".to_string()))?
        .origin()
        .ascii_serialization()
        != extract_origin(headers)?
    {
        return Err(ApiError::Forbidden(
            "Archive server URL must match the paired browser origin".to_string(),
        ));
    }
    let http_clients = state
        .app
        .try_state::<SambeeHttpClientStore>()
        .map(|clients| clients.inner().clone())
        .ok_or_else(|| ApiError::Internal("Companion backend HTTP client is unavailable".to_string()))?;
    let client = http_clients
        .client_for_server_no_redirects(&server_url)
        .map_err(ApiError::Internal)?;
    Ok(ArchiveRelayTransport::new(
        client,
        archive_relay_url(&server_url, operation_id, binding),
        operation_token,
    ))
}

struct ArchiveCreationRelay {
    transport: ArchiveRelayTransport,
}

enum ArchiveCreationAdapterBinding {
    RemoteSourceToLocalDestination {
        manifest: ArchiveCreationManifest,
        drive_root: PathBuf,
        target_path: PathBuf,
    },
    LocalSourceToRemoteDestination {
        entries: Vec<LocalArchiveEntry>,
    },
}

struct ArchiveCreationCoordinator {
    relay: ArchiveCreationRelay,
    binding: ArchiveCreationAdapterBinding,
}

async fn execute_archive_relay<T>(
    operation: impl Future<Output = Result<T, ApiError>>,
    failure_report: impl Future<Output = Result<(), ApiError>>,
) -> Result<T, ApiError> {
    match operation.await {
        Ok(result) => Ok(result),
        Err(error) => {
            let _ = failure_report.await;
            Err(error)
        }
    }
}

impl ArchiveCreationCoordinator {
    async fn execute(self) -> Result<ArchiveCreationResponse, ApiError> {
        let Self { relay, binding } = self;
        let result = execute_archive_relay(
            async {
                match binding {
                    ArchiveCreationAdapterBinding::RemoteSourceToLocalDestination {
                        manifest,
                        drive_root,
                        target_path,
                    } => match create_smb_archive_manifest_locally(&relay, &drive_root, &target_path, manifest).await {
                        Ok(result) => Ok(result),
                        Err(_) if target_path.exists() => Err(ApiError::internal_code(
                            "Archive creation failed after creating incomplete output",
                            LOCAL_ARCHIVE_CREATION_PARTIAL_CODE,
                        )),
                        Err(error) => Err(error),
                    },
                    ArchiveCreationAdapterBinding::LocalSourceToRemoteDestination { entries } => {
                        create_local_archive_for_smb_destination(&relay, entries).await
                    }
                }
            },
            relay.fail(),
        )
        .await?;
        relay.complete(&result).await?;
        Ok(result)
    }
}

impl ArchiveCreationRelay {
    fn from_transport(transport: ArchiveRelayTransport) -> Self {
        Self { transport }
    }

    async fn begin_remote_source(&self) -> Result<ArchiveCreationManifest, ApiError> {
        let manifest: ArchiveCreationManifest = self.transport.begin("Archive creation start").await?;
        ArchiveCreationManifest::from_entries(manifest.entries).map_err(map_local_archive_error)
    }

    async fn begin_local_source(&self, manifest: &ArchiveCreationManifest) -> Result<(), ApiError> {
        self.transport
            .post_json_without_result("begin", manifest, "Archive creation start", "start")
            .await
    }

    async fn read_source_member(&self, archive_path: &str) -> Result<ReqwestResponse, ApiError> {
        self.transport
            .get("member")
            .query(&[("archive_path", archive_path)])
            .send()
            .await
            .map_err(|error| ApiError::Internal(log_request_error("Archive member relay", "GET", self.transport.url(), &error)))
    }

    async fn complete_source_member(&self, archive_path: &str, status: &'static str, source_bytes: u64) -> Result<(), ApiError> {
        let payload = ArchiveCreationMemberCompletion {
            archive_path,
            status,
            source_bytes,
        };
        self.transport
            .post_json_without_result("member-complete", &payload, "Archive creation member completion", "complete member")
            .await
    }

    async fn stream_source_member(&self, archive_path: &str, source: reqwest::Body) -> Result<ReqwestResponse, ApiError> {
        self.transport
            .put("member")
            .query(&[("archive_path", archive_path)])
            .body(source)
            .send()
            .await
            .map_err(|error| {
                ApiError::Internal(log_request_error(
                    "Archive creation member relay",
                    "PUT",
                    self.transport.url(),
                    &error,
                ))
            })
    }

    async fn complete(&self, result: &ArchiveCreationResponse) -> Result<(), ApiError> {
        self.transport.complete_with_json(result, "Archive creation completion").await
    }

    async fn fail(&self) -> Result<(), ApiError> {
        self.transport
            .fail("Companion local archive creation failed", "Archive creation failure")
            .await
    }
}

struct ArchiveExtractionRelay {
    transport: ArchiveRelayTransport,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum ArchiveRelayDestinationStatus {
    Directory,
    Extracted,
    Skipped,
    Ignored,
}

struct ArchiveRelayDestinationResult {
    status: ArchiveRelayDestinationStatus,
    target_path: String,
    directories_created: u64,
    extracted_bytes: u64,
    replaced: bool,
    renamed: bool,
}

impl ArchiveRelayDestinationResult {
    fn directory(target_path: String, renamed: bool, directories_created: u64) -> Self {
        Self {
            status: ArchiveRelayDestinationStatus::Directory,
            target_path,
            directories_created,
            extracted_bytes: 0,
            replaced: false,
            renamed,
        }
    }

    fn extracted(target_path: String, renamed: bool, directories_created: u64, extracted_bytes: u64, replaced: bool) -> Self {
        Self {
            status: ArchiveRelayDestinationStatus::Extracted,
            target_path,
            directories_created,
            extracted_bytes,
            replaced,
            renamed,
        }
    }

    fn skipped(target_path: String, renamed: bool) -> Self {
        Self {
            status: ArchiveRelayDestinationStatus::Skipped,
            target_path,
            directories_created: 0,
            extracted_bytes: 0,
            replaced: false,
            renamed,
        }
    }

    fn ignored(target_path: String, renamed: bool) -> Self {
        Self {
            status: ArchiveRelayDestinationStatus::Ignored,
            target_path,
            directories_created: 0,
            extracted_bytes: 0,
            replaced: false,
            renamed,
        }
    }
}

#[derive(Serialize)]
struct ArchiveExtractionMemberCompletion<'a> {
    member_path: &'a str,
    status: ArchiveRelayDestinationStatus,
    target_path: &'a str,
    directories_created: u64,
    extracted_bytes: u64,
    replaced: bool,
    renamed: bool,
}

#[derive(Serialize)]
struct ArchiveExtractionCollision<'a> {
    member_path: &'a str,
    is_directory: bool,
    target_size: Option<u64>,
    target_modified_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct ArchiveExtractionMemberError<'a> {
    member_path: &'a str,
    message: &'a str,
    partial_output: bool,
}

#[derive(Serialize)]
struct ArchiveExtractionSummary {
    destination_root_created: bool,
}

impl ArchiveExtractionRelay {
    fn from_transport(transport: ArchiveRelayTransport) -> Self {
        Self { transport }
    }

    async fn begin<T: DeserializeOwned>(&self) -> Result<T, ApiError> {
        self.transport.begin("Archive extraction start").await
    }

    async fn begin_local_source(&self, manifest: &ArchiveExtractionManifest) -> Result<ArchiveRelayOperation, ApiError> {
        self.transport.begin_with_json(manifest, "Archive extraction start").await
    }

    async fn write_directory(&self, member_path: &str) -> Result<ArchiveRelayOperation, ApiError> {
        let response = self
            .transport
            .put("member")
            .query(&[("member_path", member_path), ("is_directory", "true")])
            .send()
            .await
            .map_err(|error| ApiError::Internal(log_request_error("Archive directory relay", "PUT", self.transport.url(), &error)))?;
        decode_archive_relay_json(response, "create directory").await
    }

    async fn write_file(&self, archive_path: &FsPath, entry: &LocalArchiveReadEntry) -> Result<ArchiveRelayOperation, ApiError> {
        let (writer, reader) = tokio::io::duplex(ARCHIVE_COPY_BUFFER_SIZE * 2);
        let archive_path = archive_path.to_path_buf();
        let member_path = entry.path.clone();
        let writer_task = tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut output = SyncIoBridge::new(writer);
            stream_local_archive_member(&archive_path, &member_path, &mut output).map_err(|error| error.to_string())?;
            output.flush().map_err(|error| error.to_string())
        });
        let request = self.transport.put("member").query(&[("member_path", entry.path.as_str())]);
        let request = if let Some(modified_at) = entry.modified_at {
            request.query(&[("source_modified_at", modified_at.to_rfc3339())])
        } else {
            request
        };
        let response = request.body(reqwest::Body::wrap_stream(ReaderStream::new(reader))).send().await;
        let writer_result = writer_task
            .await
            .map_err(|error| ApiError::Internal(format!("Archive member streaming task failed: {error}")))?;
        let response =
            response.map_err(|error| ApiError::Internal(log_request_error("Archive member relay", "PUT", self.transport.url(), &error)))?;
        if !response.status().is_success() {
            relay_archive_response(response, "write member").await?;
            return Err(ApiError::Internal("Archive relay returned an unexpected success state".to_string()));
        }
        writer_result.map_err(|error| ApiError::Internal(format!("Archive member streaming failed: {error}")))?;
        decode_archive_relay_json(response, "write member").await
    }

    async fn complete_source_member(
        &self,
        entry: &ArchiveExtractionManifestMember,
        result: ArchiveRelayDestinationResult,
    ) -> Result<ArchiveRelayOperation, ApiError> {
        let payload = ArchiveExtractionMemberCompletion {
            member_path: &entry.path,
            status: result.status,
            target_path: &result.target_path,
            directories_created: result.directories_created,
            extracted_bytes: result.extracted_bytes,
            replaced: result.replaced,
            renamed: result.renamed,
        };
        self.transport
            .post_json("member-complete", &payload, "Archive member completion", "complete member")
            .await
    }

    async fn pause_source_member_for_collision(
        &self,
        entry: &ArchiveExtractionManifestMember,
        target_metadata: Option<std::fs::Metadata>,
    ) -> Result<ArchiveRelayOperation, ApiError> {
        let target_size = target_metadata
            .as_ref()
            .filter(|metadata| metadata.is_file())
            .map(std::fs::Metadata::len);
        let target_modified_at = target_metadata
            .and_then(|metadata| metadata.modified().ok())
            .map(DateTime::<Utc>::from);
        let payload = ArchiveExtractionCollision {
            member_path: &entry.path,
            is_directory: entry.is_directory,
            target_size,
            target_modified_at,
        };
        self.transport
            .post_json("member-collision", &payload, "Archive collision pause", "pause for collision")
            .await
    }

    async fn pause_source_member_for_error(
        &self,
        member_path: &str,
        message: String,
        partial_output: bool,
    ) -> Result<ArchiveRelayOperation, ApiError> {
        let payload = ArchiveExtractionMemberError {
            member_path,
            message: &message,
            partial_output,
        };
        self.transport
            .post_json("member-error", &payload, "Archive member error pause", "pause for member error")
            .await
    }

    async fn pause_source_member_with_error_result(
        &self,
        member_path: &str,
        message: String,
        partial_output: bool,
    ) -> Result<ArchiveExtractionRelayResult, ApiError> {
        let operation = self.pause_source_member_for_error(member_path, message, partial_output).await?;
        Ok(ArchiveExtractionRelayResult::Paused(operation))
    }

    async fn read_source_member(&self, member_path: &str) -> Result<ReqwestResponse, String> {
        self.transport
            .get("member")
            .query(&[("member_path", member_path)])
            .send()
            .await
            .map_err(|error| self.source_read_error(&error))
    }

    fn source_read_error(&self, error: &reqwest::Error) -> String {
        log_request_error("Archive member relay", "GET", self.transport.url(), error)
    }

    async fn complete_remote_destination(&self) -> Result<(), ApiError> {
        self.transport.complete("Archive extraction completion").await
    }

    async fn complete_remote_source(&self, destination_root_created: bool) -> Result<ArchiveRelayOperation, ApiError> {
        let payload = ArchiveExtractionSummary { destination_root_created };
        self.transport
            .post_json("complete", &payload, "Archive extraction completion", "complete extraction")
            .await
    }

    async fn fail(&self) -> Result<(), ApiError> {
        self.transport
            .fail("Companion local archive extraction failed", "Archive extraction failure")
            .await
    }
}

enum ArchiveExtractionAdapterBinding {
    LocalArchiveToRemoteDestination {
        archive_path: PathBuf,
        archive_entries: Vec<LocalArchiveReadEntry>,
    },
    RemoteSourceToLocalDestination {
        drive_root: PathBuf,
        destination_path: PathBuf,
    },
}

struct ArchiveExtractionCoordinator {
    relay: ArchiveExtractionRelay,
    binding: ArchiveExtractionAdapterBinding,
}

impl ArchiveExtractionCoordinator {
    async fn execute(self) -> Result<ArchiveExtractionResponse, ApiError> {
        let Self { relay, binding } = self;
        execute_archive_relay(
            async {
                match binding {
                    ArchiveExtractionAdapterBinding::LocalArchiveToRemoteDestination {
                        archive_path,
                        archive_entries,
                    } => {
                        let manifest = ArchiveExtractionManifest::from_entries(
                            archive_entries
                                .iter()
                                .map(|entry| ArchiveExtractionManifestMember {
                                    path: entry.path.clone(),
                                    is_directory: entry.is_directory,
                                    uncompressed_size: entry.uncompressed_size,
                                    modified_at: entry.modified_at,
                                })
                                .collect(),
                        )
                        .map_err(map_local_archive_error)?;
                        let operation = relay.begin_local_source(&manifest).await?;
                        let execution_plan = archive_relay_extraction_plan(&operation, manifest)?;
                        extract_local_archive_to_smb_destination(&relay, archive_path, archive_entries, execution_plan).await
                    }
                    ArchiveExtractionAdapterBinding::RemoteSourceToLocalDestination {
                        drive_root,
                        destination_path,
                    } => {
                        let mut relay_manifest: ArchiveRelayManifest = relay.begin().await?;
                        relay_manifest.manifest =
                            ArchiveExtractionManifest::from_entries(relay_manifest.manifest.entries).map_err(map_local_archive_error)?;
                        let execution_plan = archive_relay_extraction_plan(&relay_manifest.operation, relay_manifest.manifest)?;
                        extract_smb_archive_to_local_destination(
                            &relay,
                            drive_root,
                            destination_path,
                            relay_manifest.operation,
                            execution_plan,
                        )
                        .await
                    }
                }
            },
            relay.fail(),
        )
        .await
    }
}

/// `POST /api/browse/{drive}/archive/create-from-smb` — create a new local ZIP from scoped SMB sources.
pub async fn browse_create_archive_from_smb(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ArchiveCreateFromSmbRequest>,
) -> Result<Json<ArchiveCreationResponse>, ApiError> {
    if body.target_path.trim().is_empty()
        || body.server_url.trim().is_empty()
        || body.operation_id.trim().is_empty()
        || body.operation_token.trim().is_empty()
    {
        return Err(ApiError::BadRequest(
            "Archive target, server, operation, and operation token are required".to_string(),
        ));
    }
    let transport = archive_relay_transport(
        &state,
        &headers,
        &body.server_url,
        &body.operation_id,
        body.operation_token,
        ArchiveRelayBinding::SmbToLocalZipCreate,
    )?;
    let drive_root = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let target_path = resolve_safe_path_for_new(&drive_root, &drive, &body.target_path)?;
    if target_path.exists() {
        return Err(ApiError::conflict_message("Archive output already exists"));
    }
    let relay = ArchiveCreationRelay::from_transport(transport);
    let manifest = relay.begin_remote_source().await?;
    let result = ArchiveCreationCoordinator {
        relay,
        binding: ArchiveCreationAdapterBinding::RemoteSourceToLocalDestination {
            manifest,
            drive_root,
            target_path,
        },
    }
    .execute()
    .await?;

    Ok(Json(result))
}

/// `POST /api/browse/{drive}/archive/create-to-smb` — stream a local ZIP into its scoped SMB target.
pub async fn browse_create_archive_to_smb(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ArchiveCreateToSmbRequest>,
) -> Result<Json<ArchiveCreationResponse>, ApiError> {
    if body.source_paths.is_empty()
        || body.target_path.trim().is_empty()
        || body.server_url.trim().is_empty()
        || body.operation_id.trim().is_empty()
        || body.operation_token.trim().is_empty()
    {
        return Err(ApiError::BadRequest(
            "Archive sources, target, server, operation, and operation token are required".to_string(),
        ));
    }
    let transport = archive_relay_transport(
        &state,
        &headers,
        &body.server_url,
        &body.operation_id,
        body.operation_token,
        ArchiveRelayBinding::LocalToSmbZipCreate,
    )?;
    let drive_root = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let sources = body
        .source_paths
        .iter()
        .map(|source_path| resolve_safe_path(&drive_root, &drive, source_path))
        .collect::<Result<Vec<_>, _>>()?;
    let entries = tokio::task::spawn_blocking(move || build_local_archive_manifest_for_remote_target(&sources))
        .await
        .map_err(|error| ApiError::Internal(format!("Local archive validation task failed: {error}")))?
        .map_err(map_local_archive_error)?;
    let relay = ArchiveCreationRelay::from_transport(transport);
    let result = ArchiveCreationCoordinator {
        relay,
        binding: ArchiveCreationAdapterBinding::LocalSourceToRemoteDestination { entries },
    }
    .execute()
    .await?;
    Ok(Json(result))
}

async fn create_local_archive_for_smb_destination(
    relay: &ArchiveCreationRelay,
    entries: Vec<LocalArchiveEntry>,
) -> Result<ArchiveCreationResponse, ApiError> {
    let manifest = project_local_archive_creation_manifest(&entries).map_err(map_local_archive_error)?;
    let mut creation_state = ArchiveCreationManifestState::new(manifest.clone());
    relay.begin_local_source(&manifest).await?;

    for (entry, manifest_entry) in entries.into_iter().zip(&manifest.entries) {
        let archive_path = manifest_entry.archive_path.clone();
        let source = if entry.is_directory {
            reqwest::Body::default()
        } else {
            let source_file = File::open(&entry.source_path)
                .await
                .map_err(|error| map_io_error(error, &entry.source_path))?;
            reqwest::Body::wrap_stream(ReaderStream::new(source_file))
        };
        let response = relay.stream_source_member(&archive_path, source).await?;
        relay_archive_response(response, "write archive member").await?;
        creation_state.record_expected(&archive_path).map_err(map_local_archive_error)?;
    }
    creation_state
        .terminal_summary()
        .map(archive_creation_response)
        .map_err(map_local_archive_error)
}

async fn create_smb_archive_manifest_locally(
    relay: &ArchiveCreationRelay,
    drive_root: &FsPath,
    target_path: &FsPath,
    manifest: ArchiveCreationManifest,
) -> Result<ArchiveCreationResponse, ApiError> {
    let mut creation_state = ArchiveCreationManifestState::new(manifest.clone());
    let root_drive = drive_root.to_path_buf();
    let target = target_path.to_path_buf();
    let writer_manifest = manifest.clone();
    let mut writer = tokio::task::spawn_blocking(move || create_local_archive_relay_writer(&root_drive, &target, writer_manifest))
        .await
        .map_err(|error| ApiError::Internal(format!("Local archive creation task failed: {error}")))?
        .map_err(map_local_archive_error)?;

    for entry in manifest.entries {
        if entry.is_directory {
            let archive_path = entry.archive_path;
            let report_path = archive_path.clone();
            writer = tokio::task::spawn_blocking(move || writer.add_directory(&archive_path))
                .await
                .map_err(|error| ApiError::Internal(format!("Local archive directory task failed: {error}")))?
                .map_err(map_local_archive_error)?;
            relay.complete_source_member(&report_path, "directory", 0).await?;
            creation_state.record_expected(&report_path).map_err(map_local_archive_error)?;
            continue;
        }

        let archive_path = entry.archive_path;
        let member_path = archive_path.clone();
        let (sender, receiver) = tokio::sync::mpsc::channel(2);
        let write_task = tokio::task::spawn_blocking(move || writer.write_file(&archive_path, receiver));
        let mut response = relay.read_source_member(&member_path).await?;
        if !response.status().is_success() {
            let _ = sender.send(LocalArchiveRelayChunk::Failed).await;
            let _ = write_task.await;
            relay_archive_response(response, "read member").await?;
            return Err(ApiError::Internal("Archive member read failed".to_string()));
        }
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    for chunk in chunk.chunks(ARCHIVE_COPY_BUFFER_SIZE) {
                        sender
                            .send(LocalArchiveRelayChunk::Data(chunk.to_vec()))
                            .await
                            .map_err(|_| ApiError::Internal("Local archive writer stopped accepting source data".to_string()))?;
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    let _ = sender.send(LocalArchiveRelayChunk::Failed).await;
                    let _ = write_task.await;
                    return Err(ApiError::Internal(log_request_error(
                        "Archive member relay",
                        "GET",
                        relay.transport.url(),
                        &error,
                    )));
                }
            }
        }
        sender
            .send(LocalArchiveRelayChunk::Complete)
            .await
            .map_err(|_| ApiError::Internal("Local archive writer stopped accepting source data".to_string()))?;
        drop(sender);
        writer = write_task
            .await
            .map_err(|error| ApiError::Internal(format!("Local archive member task failed: {error}")))?
            .map_err(map_local_archive_error)?;
        relay.complete_source_member(&member_path, "created", entry.source_size).await?;
        creation_state.record_expected(&member_path).map_err(map_local_archive_error)?;
    }

    tokio::task::spawn_blocking(move || writer.finish())
        .await
        .map_err(|error| ApiError::Internal(format!("Local archive finalization task failed: {error}")))?
        .map_err(map_local_archive_error)?;
    creation_state
        .terminal_summary()
        .map(archive_creation_response)
        .map_err(map_local_archive_error)
}

/// `POST /api/browse/{drive}/archive/executions` — start a cancellable local archive execution.
pub async fn browse_start_archive_execution(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ArchiveExecutionStartRequest>,
) -> Result<Json<ArchiveExecutionResponse>, ApiError> {
    let owner_origin = extract_origin(&headers)?;
    let execution = match body {
        ArchiveExecutionStartRequest::Create { source_paths, target_path } => {
            let body = ArchiveCreateRequest { source_paths, target_path };
            let (base_path, source_paths, target_path) = resolve_local_archive_creation_request(&drive, &body)?;
            state
                .archive_sessions
                .create_creation(drive.clone(), owner_origin.clone(), base_path, source_paths, target_path)
                .await
        }
        ArchiveExecutionStartRequest::Extract {
            archive_path,
            destination_path,
        } => {
            let body = ArchiveExtractRequest {
                archive_path,
                destination_path,
            };
            let (base_path, archive_path, destination_path) = resolve_local_archive_extraction_request(&drive, &body)?;
            state
                .archive_sessions
                .create_extraction(drive.clone(), owner_origin.clone(), base_path, archive_path, destination_path)
                .await
        }
    };
    LocalArchiveOperationCoordinator::new(state.archive_sessions.clone())
        .start(&execution.execution_id)
        .await?;
    let execution = state.archive_sessions.get(&drive, &owner_origin, &execution.execution_id).await?;
    Ok(Json(archive_execution_response(execution)))
}

/// `GET /api/browse/{drive}/archive/executions/{execution_id}` — retrieve lifecycle state.
pub async fn browse_get_archive_execution(
    State(state): State<Arc<AppState>>,
    Path((drive, execution_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<ArchiveExecutionResponse>, ApiError> {
    let execution = state
        .archive_sessions
        .get(&drive, &extract_origin(&headers)?, &execution_id)
        .await?;
    Ok(Json(archive_execution_response(execution)))
}

/// `POST /api/browse/{drive}/archive/executions/{execution_id}/cancellation` — request cancellation at the next member boundary.
pub async fn browse_cancel_archive_execution(
    State(state): State<Arc<AppState>>,
    Path((drive, execution_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<ArchiveExecutionCancellationRequest>,
) -> Result<Json<ArchiveExecutionResponse>, ApiError> {
    let execution = state
        .archive_sessions
        .cancel(&drive, &extract_origin(&headers)?, &execution_id, body.expected_revision)
        .await?;
    Ok(Json(archive_execution_response(execution)))
}

/// `POST /api/browse/{drive}/archive/executions/{execution_id}/decision` — apply a paused local extraction decision.
pub async fn browse_decide_archive_execution(
    State(state): State<Arc<AppState>>,
    Path((drive, execution_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<ArchiveExecutionDecisionRequest>,
) -> Result<Json<ArchiveExecutionResponse>, ApiError> {
    let action = match body.action {
        ArchiveExecutionDecisionAction::Skip => super::archive_sessions::ArchiveSessionDecisionAction::Skip,
        ArchiveExecutionDecisionAction::SkipAll => super::archive_sessions::ArchiveSessionDecisionAction::SkipAll,
        ArchiveExecutionDecisionAction::Replace => super::archive_sessions::ArchiveSessionDecisionAction::Replace,
        ArchiveExecutionDecisionAction::ReplaceAll => super::archive_sessions::ArchiveSessionDecisionAction::ReplaceAll,
        ArchiveExecutionDecisionAction::ReplaceOlder => super::archive_sessions::ArchiveSessionDecisionAction::ReplaceOlder,
        ArchiveExecutionDecisionAction::Rename => super::archive_sessions::ArchiveSessionDecisionAction::Rename,
        ArchiveExecutionDecisionAction::Retry => super::archive_sessions::ArchiveSessionDecisionAction::Retry,
        ArchiveExecutionDecisionAction::Ignore => super::archive_sessions::ArchiveSessionDecisionAction::Ignore,
    };
    let execution = LocalArchiveOperationCoordinator::new(state.archive_sessions.clone())
        .decide(
            &drive,
            &extract_origin(&headers)?,
            &execution_id,
            body.expected_revision,
            super::archive_sessions::ArchiveSessionDecision {
                member_path: body.member_path,
                action,
                target_path: body.target_path,
            },
        )
        .await?;
    Ok(Json(archive_execution_response(execution)))
}

/// `POST /api/browse/{drive}/archive/extract-to-smb` — relay a local ZIP into one scoped SMB extraction operation.
pub async fn browse_extract_archive_to_smb(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ArchiveExtractToSmbRequest>,
) -> Result<Json<ArchiveExtractionResponse>, ApiError> {
    if body.archive_path.trim().is_empty()
        || body.server_url.trim().is_empty()
        || body.operation_id.trim().is_empty()
        || body.operation_token.trim().is_empty()
    {
        return Err(ApiError::BadRequest(
            "Archive, server, operation, and operation token are required".to_string(),
        ));
    }
    let transport = archive_relay_transport(
        &state,
        &headers,
        &body.server_url,
        &body.operation_id,
        body.operation_token,
        ArchiveRelayBinding::LocalZipToSmbExtract,
    )?;
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let archive_path = resolve_safe_path(&base_path, &drive, &body.archive_path)?;
    let archive_entries = tokio::task::spawn_blocking({
        let archive_path = archive_path.clone();
        move || validate_local_archive_extraction(&archive_path)
    })
    .await
    .map_err(|error| ApiError::Internal(format!("Local archive validation task failed: {error}")))?
    .map_err(map_local_archive_error)?;

    let relay = ArchiveExtractionRelay::from_transport(transport);
    let result = ArchiveExtractionCoordinator {
        relay,
        binding: ArchiveExtractionAdapterBinding::LocalArchiveToRemoteDestination {
            archive_path,
            archive_entries,
        },
    }
    .execute()
    .await?;
    Ok(Json(result))
}

async fn extract_local_archive_to_smb_destination(
    relay: &ArchiveExtractionRelay,
    archive_path: PathBuf,
    archive_entries: Vec<LocalArchiveReadEntry>,
    mut checkpoint: ArchiveExtractionRelayExecutionPlan,
) -> Result<ArchiveExtractionResponse, ApiError> {
    let extraction_manifest = checkpoint.manifest().clone();
    let completed_members = checkpoint.completed_members().map_err(map_local_archive_error)?;
    for entry in archive_entries {
        if completed_members.contains(&entry.path) {
            continue;
        }
        let member_result = if entry.is_directory {
            relay.write_directory(&entry.path).await?
        } else {
            relay.write_file(&archive_path, &entry).await?
        };
        checkpoint = match archive_extraction_member_step(member_result, &extraction_manifest)? {
            ArchiveExtractionRelayMemberStep::Continue(checkpoint) => *checkpoint,
            ArchiveExtractionRelayMemberStep::Paused(operation) => return archive_extraction_response_from_operation(operation),
        };
    }

    relay.complete_remote_destination().await?;
    Ok(archive_extraction_response_from_checkpoint(&checkpoint))
}

#[derive(Debug, Deserialize)]
struct ArchiveRelayManifest {
    operation: ArchiveRelayOperation,
    #[serde(flatten)]
    manifest: ArchiveExtractionManifest,
}

#[derive(Debug, Deserialize)]
struct ArchiveRelayOperation {
    phase: String,
    destination_path: String,
    checkpoint_json: String,
    pending_decision_json: Option<String>,
}

enum ArchiveExtractionRelayResult {
    Completed { destination_root_created: bool },
    Paused(ArchiveRelayOperation),
}

enum ArchiveExtractionRelayMemberStep {
    Continue(Box<ArchiveExtractionRelayExecutionPlan>),
    Paused(ArchiveRelayOperation),
}

#[cfg(test)]
fn relay_completed_members(operation: &ArchiveRelayOperation) -> Result<HashSet<String>, ApiError> {
    archive_relay_extraction_state(operation)?
        .completed_members()
        .map_err(map_local_archive_error)
}

fn archive_relay_extraction_state(operation: &ArchiveRelayOperation) -> Result<ArchiveExtractionRelayState, ApiError> {
    ArchiveExtractionRelayState::from_checkpoint_json(&operation.checkpoint_json).map_err(map_local_archive_error)
}

fn archive_relay_extraction_plan(
    operation: &ArchiveRelayOperation,
    manifest: ArchiveExtractionManifest,
) -> Result<ArchiveExtractionRelayExecutionPlan, ApiError> {
    ArchiveExtractionRelayExecutionPlan::from_checkpoint_json(manifest, &operation.checkpoint_json).map_err(map_local_archive_error)
}

fn archive_extraction_member_step(
    operation: ArchiveRelayOperation,
    manifest: &ArchiveExtractionManifest,
) -> Result<ArchiveExtractionRelayMemberStep, ApiError> {
    if operation.phase != "streaming" {
        return Ok(ArchiveExtractionRelayMemberStep::Paused(operation));
    }
    let checkpoint = archive_relay_extraction_plan(&operation, manifest.clone())?;
    Ok(ArchiveExtractionRelayMemberStep::Continue(Box::new(checkpoint)))
}

fn archive_extraction_response_from_checkpoint(checkpoint: &ArchiveExtractionRelayState) -> ArchiveExtractionResponse {
    let progress = checkpoint.progress();
    ArchiveExtractionResponse {
        files_extracted: progress.files_extracted,
        directories_created: progress.directories_created,
        extracted_bytes: progress.extracted_bytes,
        files_skipped: progress.files_skipped,
        phase: None,
        checkpoint_json: None,
        pending_decision_json: None,
    }
}

fn archive_extraction_response_from_operation(operation: ArchiveRelayOperation) -> Result<ArchiveExtractionResponse, ApiError> {
    let checkpoint = archive_relay_extraction_state(&operation)?;
    Ok(ArchiveExtractionResponse {
        phase: Some(operation.phase),
        checkpoint_json: Some(operation.checkpoint_json),
        pending_decision_json: operation.pending_decision_json,
        ..archive_extraction_response_from_checkpoint(&checkpoint)
    })
}

/// `POST /api/browse/{drive}/archive/extract-from-smb` — write scoped SMB ZIP members to a local directory.
pub async fn browse_extract_archive_from_smb(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ArchiveExtractFromSmbRequest>,
) -> Result<Json<ArchiveExtractionResponse>, ApiError> {
    if body.destination_path.trim().is_empty()
        || body.server_url.trim().is_empty()
        || body.operation_id.trim().is_empty()
        || body.operation_token.trim().is_empty()
    {
        return Err(ApiError::BadRequest(
            "Destination, server, operation, and operation token are required".to_string(),
        ));
    }
    let transport = archive_relay_transport(
        &state,
        &headers,
        &body.server_url,
        &body.operation_id,
        body.operation_token,
        ArchiveRelayBinding::SmbZipToLocalExtract,
    )?;
    let drive_root = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let destination_path = resolve_safe_path_for_new(&drive_root, &drive, &body.destination_path)?;
    let relay = ArchiveExtractionRelay::from_transport(transport);
    let result = ArchiveExtractionCoordinator {
        relay,
        binding: ArchiveExtractionAdapterBinding::RemoteSourceToLocalDestination {
            drive_root,
            destination_path,
        },
    }
    .execute()
    .await?;
    Ok(Json(result))
}

async fn extract_smb_archive_to_local_destination(
    relay: &ArchiveExtractionRelay,
    drive_root: PathBuf,
    destination_path: PathBuf,
    operation: ArchiveRelayOperation,
    checkpoint: ArchiveExtractionRelayExecutionPlan,
) -> Result<ArchiveExtractionResponse, ApiError> {
    let extraction_result = extract_smb_archive_manifest_to_local(relay, &drive_root, &destination_path, operation, checkpoint).await;
    let destination_root_created = match extraction_result {
        Ok(ArchiveExtractionRelayResult::Completed { destination_root_created }) => destination_root_created,
        Ok(ArchiveExtractionRelayResult::Paused(operation)) => return archive_extraction_response_from_operation(operation),
        Err(error) => {
            if destination_path.exists() {
                return Err(ApiError::internal_code(
                    "Archive extraction failed after creating incomplete output",
                    LOCAL_ARCHIVE_EXTRACTION_PARTIAL_CODE,
                ));
            }
            return Err(error);
        }
    };

    let completed_operation = relay.complete_remote_source(destination_root_created).await?;
    archive_extraction_response_from_operation(completed_operation)
}

async fn extract_smb_archive_manifest_to_local(
    relay: &ArchiveExtractionRelay,
    drive_root: &FsPath,
    destination_path: &FsPath,
    operation: ArchiveRelayOperation,
    mut checkpoint: ArchiveExtractionRelayExecutionPlan,
) -> Result<ArchiveExtractionRelayResult, ApiError> {
    let extraction_manifest = checkpoint.manifest().clone();
    let completed_members = checkpoint.completed_members().map_err(map_local_archive_error)?;
    let root = destination_path.to_path_buf();
    let root_drive = drive_root.to_path_buf();
    let root_created = tokio::task::spawn_blocking(move || create_local_extraction_root(&root_drive, &root))
        .await
        .map_err(|error| ApiError::Internal(format!("Local archive root task failed: {error}")))?
        .map_err(map_local_archive_error)?;

    for entry in extraction_manifest.entries.clone() {
        validate_local_extraction_member_path(&entry.path, entry.is_directory).map_err(map_local_archive_error)?;
        if completed_members.contains(&entry.path) {
            continue;
        }
        let target_member_path = checkpoint.target_member_path(&entry.path);
        validate_local_extraction_member_path(target_member_path, entry.is_directory).map_err(map_local_archive_error)?;
        let target_path = destination_path.join(target_member_path);
        let reported_target_path = format!("{}/{}", operation.destination_path.trim_end_matches('/'), target_member_path);
        let renamed = target_member_path != entry.path;
        let retrying_partial_member = checkpoint.is_retrying(&entry.path);
        if checkpoint.is_ignored(&entry.path) {
            let member_result = relay
                .complete_source_member(&entry, ArchiveRelayDestinationResult::ignored(reported_target_path, renamed))
                .await?;
            checkpoint = match archive_extraction_member_step(member_result, &extraction_manifest)? {
                ArchiveExtractionRelayMemberStep::Continue(checkpoint) => *checkpoint,
                ArchiveExtractionRelayMemberStep::Paused(operation) => return Ok(ArchiveExtractionRelayResult::Paused(operation)),
            };
            continue;
        }
        let target_metadata = match std::fs::symlink_metadata(&target_path) {
            Ok(metadata) => Some(metadata),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return relay
                    .pause_source_member_with_error_result(&entry.path, error.to_string(), false)
                    .await
            }
        };
        if entry.is_directory {
            if let Some(metadata) = target_metadata {
                if !metadata.is_dir() {
                    let operation = relay.pause_source_member_for_collision(&entry, Some(metadata)).await?;
                    return Ok(ArchiveExtractionRelayResult::Paused(operation));
                }
                let member_result = relay
                    .complete_source_member(&entry, ArchiveRelayDestinationResult::directory(reported_target_path, renamed, 0))
                    .await?;
                checkpoint = match archive_extraction_member_step(member_result, &extraction_manifest)? {
                    ArchiveExtractionRelayMemberStep::Continue(checkpoint) => *checkpoint,
                    ArchiveExtractionRelayMemberStep::Paused(operation) => return Ok(ArchiveExtractionRelayResult::Paused(operation)),
                };
                continue;
            }
            let root = destination_path.to_path_buf();
            let drive_root = drive_root.to_path_buf();
            let directories_created =
                match tokio::task::spawn_blocking(move || ensure_local_extraction_directory(&drive_root, &root, &target_path))
                    .await
                    .map_err(|error| ApiError::Internal(format!("Local archive directory task failed: {error}")))?
                {
                    Ok(created) => created,
                    Err(error) => {
                        return relay
                            .pause_source_member_with_error_result(&entry.path, error.to_string(), false)
                            .await
                    }
                };
            let member_result = relay
                .complete_source_member(
                    &entry,
                    ArchiveRelayDestinationResult::directory(reported_target_path, renamed, directories_created),
                )
                .await?;
            checkpoint = match archive_extraction_member_step(member_result, &extraction_manifest)? {
                ArchiveExtractionRelayMemberStep::Continue(checkpoint) => *checkpoint,
                ArchiveExtractionRelayMemberStep::Paused(operation) => return Ok(ArchiveExtractionRelayResult::Paused(operation)),
            };
            continue;
        }
        if let Some(metadata) = target_metadata {
            if retrying_partial_member && metadata.is_file() {
                // The backend recorded this member as partial before authorizing Retry.
            } else {
                let action = checkpoint.collision_action(&entry.path);
                let skip = matches!(action, Some("skip") | Some("skip_all"))
                    || (action == Some("replace_older")
                        && !entry.modified_at.is_some_and(|source| {
                            metadata
                                .modified()
                                .ok()
                                .map(DateTime::<Utc>::from)
                                .is_some_and(|target| source > target)
                        }));
                if skip {
                    let member_result = relay
                        .complete_source_member(&entry, ArchiveRelayDestinationResult::skipped(reported_target_path, renamed))
                        .await?;
                    checkpoint = match archive_extraction_member_step(member_result, &extraction_manifest)? {
                        ArchiveExtractionRelayMemberStep::Continue(checkpoint) => *checkpoint,
                        ArchiveExtractionRelayMemberStep::Paused(operation) => return Ok(ArchiveExtractionRelayResult::Paused(operation)),
                    };
                    continue;
                }
                if matches!(action, Some("replace") | Some("replace_all") | Some("replace_older")) && metadata.is_file() {
                    if let Err(error) = std::fs::remove_file(&target_path) {
                        return relay
                            .pause_source_member_with_error_result(&entry.path, error.to_string(), false)
                            .await;
                    }
                } else {
                    let operation = relay.pause_source_member_for_collision(&entry, Some(metadata)).await?;
                    return Ok(ArchiveExtractionRelayResult::Paused(operation));
                }
            }
        }
        let parent = target_path
            .parent()
            .ok_or_else(|| ApiError::BadRequest("Archive member target is invalid".to_string()))?
            .to_path_buf();
        let root = destination_path.to_path_buf();
        let parent_drive_root = drive_root.to_path_buf();
        let directories_created =
            tokio::task::spawn_blocking(move || ensure_local_extraction_directory(&parent_drive_root, &root, &parent))
                .await
                .map_err(|error| ApiError::Internal(format!("Local archive directory task failed: {error}")))?
                .map_err(map_local_archive_error)?;
        let output_drive_root = drive_root.to_path_buf();
        let output = match tokio::task::spawn_blocking(move || {
            if retrying_partial_member {
                reopen_partial_local_extraction_file(&output_drive_root, &target_path)
            } else {
                open_local_extraction_file(&output_drive_root, &target_path)
            }
        })
        .await
        .map_err(|error| ApiError::Internal(format!("Local archive file task failed: {error}")))?
        {
            Ok(output) => output,
            Err(error) => {
                return relay
                    .pause_source_member_with_error_result(&entry.path, error.to_string(), false)
                    .await
            }
        };
        let mut output = File::from_std(output);
        let mut response = match relay.read_source_member(&entry.path).await {
            Ok(response) => response,
            Err(message) => return relay.pause_source_member_with_error_result(&entry.path, message, true).await,
        };
        if !response.status().is_success() {
            let message = relay_archive_response(response, "read member")
                .await
                .err()
                .map_or_else(|| "Archive member read failed".to_string(), |error| error.to_string());
            return relay.pause_source_member_with_error_result(&entry.path, message, true).await;
        }
        let mut member_bytes = 0_u64;
        while let Some(chunk) = match response.chunk().await {
            Ok(chunk) => chunk,
            Err(error) => {
                return relay
                    .pause_source_member_with_error_result(&entry.path, relay.source_read_error(&error), true)
                    .await;
            }
        } {
            if let Err(error) = output.write_all(&chunk).await {
                return relay
                    .pause_source_member_with_error_result(&entry.path, error.to_string(), true)
                    .await;
            }
            member_bytes = member_bytes
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| ApiError::Internal("Archive member size overflow".to_string()))?;
        }
        if let Err(error) = output.flush().await {
            return relay
                .pause_source_member_with_error_result(&entry.path, error.to_string(), true)
                .await;
        }
        if member_bytes != entry.uncompressed_size {
            return relay
                .pause_source_member_with_error_result(&entry.path, "Archive member size does not match its manifest".to_string(), true)
                .await;
        }
        let member_result = relay
            .complete_source_member(
                &entry,
                ArchiveRelayDestinationResult::extracted(
                    reported_target_path,
                    renamed,
                    directories_created,
                    member_bytes,
                    matches!(
                        checkpoint.collision_action(&entry.path),
                        Some("replace") | Some("replace_all") | Some("replace_older")
                    ),
                ),
            )
            .await?;
        checkpoint = match archive_extraction_member_step(member_result, &extraction_manifest)? {
            ArchiveExtractionRelayMemberStep::Continue(checkpoint) => *checkpoint,
            ArchiveExtractionRelayMemberStep::Paused(operation) => return Ok(ArchiveExtractionRelayResult::Paused(operation)),
        };
    }
    Ok(ArchiveExtractionRelayResult::Completed {
        destination_root_created: root_created,
    })
}

async fn decode_archive_relay_json<T: DeserializeOwned>(response: ReqwestResponse, action: &str) -> Result<T, ApiError> {
    if !response.status().is_success() {
        relay_archive_response(response, action).await?;
        return Err(ApiError::Internal("Archive relay returned an unexpected success state".to_string()));
    }
    response
        .json::<T>()
        .await
        .map_err(|error| ApiError::Internal(format!("Archive relay returned an invalid {action} response: {error}")))
}

fn normalize_archive_server_url(value: &str) -> Result<String, ApiError> {
    let mut url = url::Url::parse(value.trim()).map_err(|_| ApiError::BadRequest("Archive server URL is invalid".to_string()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err(ApiError::BadRequest("Archive server URL is invalid".to_string()));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(ApiError::BadRequest(
            "Archive server URL must not contain query parameters or a fragment".to_string(),
        ));
    }
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn archive_relay_url(server_url: &str, operation_id: uuid::Uuid, binding: ArchiveRelayBinding) -> String {
    format!(
        "{server_url}/api/archive/operations/{operation_id}/companion-relay/{}",
        binding.path_segment()
    )
}

async fn relay_archive_response(response: ReqwestResponse, action: &str) -> Result<(), ApiError> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response.text().await.unwrap_or_default();
    if let Some(message) = classify_proxy_auth_intercept("Archive relay", Some(status), content_type.as_deref(), &body) {
        return Err(ApiError::Forbidden(message));
    }
    let message = format!("Archive relay could not {action}: backend returned HTTP {status}");
    match status {
        reqwest::StatusCode::CONFLICT => Err(ApiError::conflict_message(message)),
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => Err(ApiError::Forbidden(message)),
        reqwest::StatusCode::BAD_REQUEST | reqwest::StatusCode::UNPROCESSABLE_ENTITY => Err(ApiError::BadRequest(message)),
        _ => Err(ApiError::Internal(message)),
    }
}

fn map_local_archive_error(error: LocalArchiveError) -> ApiError {
    match error {
        LocalArchiveError::TargetExists | LocalArchiveError::ExtractionTargetExists => {
            ApiError::conflict_message("Archive output already exists")
        }
        LocalArchiveError::ArchiveSourceChanged => ApiError::conflict_message("Archive source changed since extraction began"),
        LocalArchiveError::TargetInsideSource => {
            ApiError::BadRequest("Archive output cannot be inside a selected source directory".to_string())
        }
        LocalArchiveError::UnsafeEntryPath
        | LocalArchiveError::UnsupportedArchiveMember
        | LocalArchiveError::TargetOutsideRoot
        | LocalArchiveError::DuplicateEntryPath
        | LocalArchiveError::EmptyCreationManifest
        | LocalArchiveError::InvalidDirectorySourceSize
        | LocalArchiveError::UnknownCreationMember
        | LocalArchiveError::InvalidCreationOutcome
        | LocalArchiveError::ConflictingCreationOutcome
        | LocalArchiveError::IncompleteCreationManifest
        | LocalArchiveError::CheckpointMemberUnavailable
        | LocalArchiveError::IncompleteExtractionManifest
        | LocalArchiveError::UnsupportedSource => ApiError::BadRequest(error.to_string()),
        LocalArchiveError::Cancelled => ApiError::BadRequest("Archive creation was cancelled".to_string()),
        LocalArchiveError::PartialOutput(error) => {
            warn!("Local archive extraction left partial output: {error}");
            ApiError::internal_code(
                "Archive extraction failed after creating incomplete output",
                LOCAL_ARCHIVE_EXTRACTION_PARTIAL_CODE,
            )
        }
        LocalArchiveError::PartialArchiveOutput(error) => {
            warn!("Local archive creation left partial output: {error}");
            ApiError::internal_code(
                "Archive creation failed after creating incomplete output",
                LOCAL_ARCHIVE_CREATION_PARTIAL_CODE,
            )
        }
        LocalArchiveError::Io(error) => ApiError::Io(error),
        LocalArchiveError::Zip(error) => {
            warn!("Local archive creation failed while writing ZIP data: {error}");
            ApiError::Internal("Local archive creation failed".to_string())
        }
        LocalArchiveError::ArchiveRead(error) => map_local_archive_read_error(error),
    }
}

fn map_local_archive_read_error(error: super::archive::LocalArchiveReadError) -> ApiError {
    warn!("Local archive could not be parsed: {error}");
    ApiError::BadRequest(error.to_string())
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

// ─── Upload ──────────────────────────────────────────────────────────────────

/// Query parameters for the upload endpoint.
#[derive(Deserialize)]
pub struct UploadQuery {
    /// Destination path (relative to drive root) where the file will be written.
    pub path: String,
    /// Browser editor lease context. All three values are required when any is supplied.
    pub editor_operation_id: Option<String>,
    pub editor_lock_id: Option<String>,
    pub editor_lock_capability: Option<String>,
}

/// Query parameters used to identify the file covered by an edit lock.
#[derive(Deserialize)]
pub struct EditLockPathQuery {
    pub path: String,
}

async fn validate_editor_write_target(dest: &FsPath) -> Result<(), ApiError> {
    match tokio::fs::metadata(dest).await {
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(ApiError::BadRequest("Editor writes cannot replace a directory".to_string())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(map_io_error(error, dest)),
    }
}

fn lock_response(lock: super::edit_locks::LocalEditLock) -> EditLockResponse {
    EditLockResponse {
        lock_id: lock.lock_id,
        lock_capability: lock.lock_capability,
        operation_id: lock.operation_id,
        file_path: lock.file_path,
        locked_by: lock.locked_by,
        locked_at: lock.locked_at.to_rfc3339(),
    }
}

/// `POST /api/browse/{drive}/lock` — acquire an exclusive local editor lease.
pub async fn browse_acquire_edit_lock(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    Query(query): Query<EditLockPathQuery>,
    headers: HeaderMap,
) -> Result<Json<EditLockResponse>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let path = normalize_drive_relative_path(&drive, &query.path)?;
    let full_path = resolve_safe_path(&base_path, &drive, &query.path)?;
    if !tokio::fs::metadata(&full_path)
        .await
        .map_err(|error| map_io_error(error, &full_path))?
        .is_file()
    {
        return Err(ApiError::BadRequest("Edit locks require an existing regular file".to_string()));
    }
    let lock = state.edit_locks.acquire(&drive, &path, extract_origin(&headers)?).await?;
    Ok(Json(lock_response(lock)))
}

/// `POST /api/browse/{drive}/lock/heartbeat` — renew an active local editor lease.
pub async fn browse_heartbeat_edit_lock(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    Query(query): Query<EditLockPathQuery>,
    headers: HeaderMap,
    Json(control): Json<EditLockControlRequest>,
) -> Result<StatusCode, ApiError> {
    let path = normalize_drive_relative_path(&drive, &query.path)?;
    state
        .edit_locks
        .heartbeat(
            &drive,
            &path,
            &extract_origin(&headers)?,
            &control.operation_id,
            &control.lock_id,
            &control.lock_capability,
        )
        .await?;
    Ok(StatusCode::OK)
}

/// `DELETE /api/browse/{drive}/lock` — release an active local editor lease.
pub async fn browse_release_edit_lock(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    Query(query): Query<EditLockPathQuery>,
    headers: HeaderMap,
    Json(control): Json<EditLockControlRequest>,
) -> Result<StatusCode, ApiError> {
    let path = normalize_drive_relative_path(&drive, &query.path)?;
    state
        .edit_locks
        .release(
            &drive,
            &path,
            &extract_origin(&headers)?,
            &control.operation_id,
            &control.lock_id,
            &control.lock_capability,
        )
        .await?;
    Ok(StatusCode::OK)
}

/// `GET /api/browse/{drive}/lock-status` — return display-safe local lease state.
pub async fn browse_edit_lock_status(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    Query(query): Query<EditLockPathQuery>,
) -> Result<Json<EditLockStatusResponse>, ApiError> {
    let path = normalize_drive_relative_path(&drive, &query.path)?;
    let response = match state.edit_locks.status(&drive, &path).await {
        Some(lock) => EditLockStatusResponse {
            locked: true,
            locked_by: Some(lock.locked_by),
            locked_at: Some(lock.locked_at.to_rfc3339()),
        },
        None => EditLockStatusResponse {
            locked: false,
            locked_by: None,
            locked_at: None,
        },
    };
    Ok(Json(response))
}

/// `POST /api/browse/{drive}/upload` — upload a file to a local drive.
///
/// Accepts multipart form data with a single file field named `file`.
/// Writes the file to the specified `path` on the drive.
/// Returns `UploadResponse` matching the backend's contract.
pub async fn browse_upload(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<UploadResponse>, ApiError> {
    let base_path = drives::resolve_drive_path(&drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let normalized_path = normalize_drive_relative_path(&drive, &query.path)?;
    let dest = resolve_safe_path_for_new(&base_path, &drive, &query.path)?;

    let has_editor_lock_context =
        query.editor_operation_id.is_some() || query.editor_lock_id.is_some() || query.editor_lock_capability.is_some();
    if has_editor_lock_context {
        let operation_id = query
            .editor_operation_id
            .as_deref()
            .ok_or_else(|| ApiError::BadRequest("Missing browser editor lock context".to_string()))?;
        let lock_id = query
            .editor_lock_id
            .as_deref()
            .ok_or_else(|| ApiError::BadRequest("Missing browser editor lock context".to_string()))?;
        let lock_capability = query
            .editor_lock_capability
            .as_deref()
            .ok_or_else(|| ApiError::BadRequest("Missing browser editor lock context".to_string()))?;
        validate_editor_write_target(&dest).await?;
        state
            .edit_locks
            .validate(
                &drive,
                &normalized_path,
                &extract_origin(&headers)?,
                operation_id,
                lock_id,
                lock_capability,
            )
            .await
            .map_err(|error| match error {
                ApiError::NotFoundWithCode { .. } => ApiError::not_found_code("Edit lock not found or expired", EDIT_LOCK_LOST_CODE),
                other => other,
            })?;
    }

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
        path: normalized_path,
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
fn resolve_dest_drive(source_drive: &str, dest_connection_id: &Option<String>) -> Result<(String, PathBuf), ApiError> {
    let dest_drive_id = match dest_connection_id {
        Some(conn_id) => {
            // Extract drive ID from "local-drive:X" format
            conn_id.strip_prefix(LOCAL_DRIVE_PREFIX).unwrap_or(conn_id).to_string()
        }
        None => {
            let base =
                drives::resolve_drive_path(source_drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {source_drive}")))?;
            return Ok((source_drive.to_string(), base));
        }
    };

    // Same drive — no cross-drive operation needed
    if dest_drive_id == source_drive {
        let base = drives::resolve_drive_path(source_drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {source_drive}")))?;
        return Ok((source_drive.to_string(), base));
    }

    let base = drives::resolve_drive_path(&dest_drive_id)
        .ok_or_else(|| ApiError::NotFound(format!("Unknown destination drive: {dest_drive_id}")))?;
    Ok((dest_drive_id, base))
}

fn normalize_drive_relative_path(drive: &str, path: &str) -> Result<String, ApiError> {
    let normalized = path.replace('\\', "/");

    if drive.len() == 1 {
        let bytes = normalized.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            let requested_drive = normalized[..1].to_ascii_lowercase();
            let active_drive = drive.to_ascii_lowercase();

            if requested_drive == active_drive {
                return Ok(normalized[2..].trim_start_matches('/').to_string());
            }

            return Err(ApiError::BadRequest(format!(
                "Path targets drive {requested_drive}, not drive {active_drive}"
            )));
        }
    }

    Ok(normalized.trim_start_matches('/').to_string())
}

/// Resolve a relative path against a base path, preventing path traversal.
fn resolve_safe_path(base: &std::path::Path, drive: &str, relative: &str) -> Result<PathBuf, ApiError> {
    let full = resolve_drive_relative_source_path(base, drive, relative)?;

    // Verify the resolved path is still under the base.
    let canonical_base = std::fs::canonicalize(base).map_err(|e| ApiError::NotFound(format!("Drive root inaccessible: {e}")))?;

    let canonical_full = std::fs::canonicalize(&full).map_err(|e| map_io_error(e, &full))?;

    if !canonical_full.starts_with(&canonical_base) {
        return Err(ApiError::Forbidden("Path is outside the drive boundary".to_string()));
    }

    Ok(canonical_full)
}

/// Build an uncanonicalized path under a drive root after rejecting traversal.
fn resolve_drive_relative_source_path(base: &std::path::Path, drive: &str, relative: &str) -> Result<PathBuf, ApiError> {
    let clean = normalize_drive_relative_path(drive, relative)?;

    for component in clean.split('/') {
        if component == ".." {
            return Err(ApiError::BadRequest("Path traversal not allowed".to_string()));
        }
    }

    let full = if clean.is_empty() { base.to_path_buf() } else { base.join(&clean) };
    Ok(full)
}

/// Validate an activation source without resolving its links.
///
/// Resolution is deliberately deferred to `resolve_activation_target` so a
/// valid link may cross to another exposed local drive. Other browse actions
/// continue to use `resolve_safe_path` and therefore remain root-bound.
fn resolve_activation_source_path(base: &std::path::Path, drive: &str, relative: &str) -> Result<PathBuf, ApiError> {
    resolve_drive_relative_source_path(base, drive, relative)
}

fn map_link_resolution_error(error: LinkResolutionError) -> ApiError {
    match error {
        LinkResolutionError::TargetMissing => ApiError::not_found_code("The link target no longer exists", LOCAL_LINK_TARGET_MISSING_CODE),
        LinkResolutionError::TargetAccessDenied => {
            ApiError::forbidden_code("The link target is not accessible", LOCAL_LINK_TARGET_ACCESS_DENIED_CODE)
        }
        LinkResolutionError::Unresolvable(message) => ApiError::bad_request_code(message, LOCAL_LINK_TARGET_UNRESOLVABLE_CODE),
    }
}

async fn source_link_kind(path: &std::path::Path) -> Result<Option<LinkKind>, std::io::Error> {
    let metadata = tokio::fs::symlink_metadata(path).await?;
    if metadata.file_type().is_symlink() {
        return Ok(Some(LinkKind::FilesystemLink));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;

        use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
            return Ok(Some(LinkKind::FilesystemLink));
        }
        if path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("lnk")) {
            return Ok(Some(LinkKind::WindowsShortcut));
        }
    }

    Ok(None)
}

fn classify_link_target_metadata(metadata: &std::fs::Metadata) -> LinkTargetType {
    if metadata.is_dir() {
        LinkTargetType::Directory
    } else if metadata.is_file() {
        LinkTargetType::File
    } else {
        LinkTargetType::Other
    }
}

async fn classify_link_target(path: &std::path::Path) -> Result<LinkTargetType, ApiError> {
    let metadata = tokio::fs::metadata(path).await.map_err(|error| map_io_error(error, path))?;
    Ok(classify_link_target_metadata(&metadata))
}

fn link_target_state_from_error(error: LinkResolutionError) -> LinkTargetState {
    match error {
        LinkResolutionError::TargetMissing => LinkTargetState::Missing,
        LinkResolutionError::TargetAccessDenied => LinkTargetState::AccessDenied,
        LinkResolutionError::Unresolvable(_) => LinkTargetState::Unresolvable,
    }
}

fn link_target_state_from_io_error(error: &std::io::Error) -> LinkTargetState {
    match error.kind() {
        std::io::ErrorKind::NotFound => LinkTargetState::Missing,
        std::io::ErrorKind::PermissionDenied => LinkTargetState::AccessDenied,
        _ => LinkTargetState::Unresolvable,
    }
}

fn display_target_path(path: &std::path::Path) -> String {
    let path = path.to_string_lossy();

    #[cfg(windows)]
    {
        normalize_windows_display_path(&path)
    }

    #[cfg(not(windows))]
    {
        path.into_owned()
    }
}

#[cfg(any(windows, test))]
fn normalize_windows_display_path(path: &str) -> String {
    if let Some(unc_path) = path.strip_prefix(WINDOWS_EXTENDED_UNC_PATH_PREFIX) {
        return format!("{WINDOWS_UNC_PATH_PREFIX}{unc_path}");
    }

    path.strip_prefix(WINDOWS_EXTENDED_PATH_PREFIX).unwrap_or(path).to_string()
}

fn resolve_link_target_metadata(source_path: String, source: PathBuf) -> LinkTargetResolution {
    let target_path = match resolve_activation_target(&source) {
        Ok(path) => path,
        Err(error) => {
            return LinkTargetResolution {
                source_path,
                state: link_target_state_from_error(error),
                target: None,
            };
        }
    };
    let metadata = match std::fs::metadata(&target_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return LinkTargetResolution {
                source_path,
                state: link_target_state_from_io_error(&error),
                target: None,
            };
        }
    };
    let target_type = classify_link_target_metadata(&metadata);
    let target_name = target_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty());
    let (state, target_display_path) = if drives::drive_for_path(&target_path).is_some() {
        (LinkTargetState::Resolved, Some(display_target_path(&target_path)))
    } else {
        (LinkTargetState::UnmappedDrive, None)
    };

    LinkTargetResolution {
        source_path,
        state,
        target: target_name.map(|name| LinkTargetInfo {
            name,
            path: target_display_path,
            target_type,
        }),
    }
}

async fn collect_link_target_resolution(
    pending: &mut JoinSet<LinkTargetResolution>,
    items: &mut Vec<LinkTargetResolution>,
) -> Result<(), ApiError> {
    if let Some(result) = pending.join_next().await {
        let item = result.map_err(|error| ApiError::Internal(format!("Link target resolution task failed: {error}")))?;
        items.push(item);
    }
    Ok(())
}

/// Build a `FileInfo` from a `DirEntry`.
async fn build_file_info(entry: &tokio::fs::DirEntry, parent_path: &str) -> Result<FileInfo, std::io::Error> {
    let filesystem_path = entry.path();
    let link_kind = source_link_kind(&filesystem_path).await?;
    let (metadata, is_readable) = match tokio::fs::metadata(&filesystem_path).await {
        Ok(metadata) => (metadata, true),
        Err(metadata_error) => {
            let fallback = tokio::fs::symlink_metadata(&filesystem_path).await?;
            if !fallback.file_type().is_symlink() {
                return Err(metadata_error);
            }
            // Preserve a broken link in the listing so activation can report
            // its classified resolution error instead of making it disappear.
            (fallback, false)
        }
    };
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
        is_readable,
        is_hidden,
        link_kind,
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
        .and_then(auth::normalize_browser_origin)
        .ok_or_else(|| ApiError::BadRequest("Missing Origin header".to_string()))
}

fn extract_origin_from_pair_initiate_request(body: &PairInitiateRequest) -> Result<String, ApiError> {
    extract_normalized_request_origin(body.origin.as_deref(), "Missing origin in pairing request")
}

fn extract_origin_from_pair_confirm_request(body_origin: Option<&str>) -> Result<String, ApiError> {
    extract_normalized_request_origin(body_origin, "Missing origin in pairing request")
}

fn extract_normalized_request_origin(request_origin: Option<&str>, missing_message: &str) -> Result<String, ApiError> {
    request_origin
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .and_then(auth::normalize_browser_origin)
        .ok_or_else(|| ApiError::BadRequest(missing_message.to_string()))
}

fn build_pair_status_response(pairing: &PairingState, current_origin: Option<&str>) -> PairStatusResponse {
    let (current_origin_paired, status) = current_origin.map_or((false, PublicPairingStatus::Unpaired), |origin| {
        let paired = pairing.get_secret_for_origin(origin).is_some();
        if paired && !pairing.is_origin_paired(origin) {
            pairing.record_verified_origin(
                origin,
                crate::server::pairing::VerifiedOriginRecordReason::RecoveredFromAuthenticatedRequest,
            );
        }

        let status = if paired {
            PublicPairingStatus::Paired
        } else if pairing.has_pending_pairing_for_origin(origin) {
            PublicPairingStatus::PendingLocalApproval
        } else {
            PublicPairingStatus::Unpaired
        };

        (paired, status)
    });

    PairStatusResponse {
        current_origin: current_origin.map(ToOwned::to_owned),
        current_origin_paired,
        status,
    }
}

fn resolve_pair_cancel_origin(headers: &HeaderMap, request_origin: Option<&str>) -> Result<String, ApiError> {
    extract_origin(headers).or_else(|_| extract_normalized_request_origin(request_origin, "Missing origin in pairing cancel request"))
}

fn resolve_pair_confirm_origin(headers: &HeaderMap, request_origin: Option<&str>) -> Result<String, ApiError> {
    extract_origin(headers).or_else(|_| extract_origin_from_pair_confirm_request(request_origin))
}

fn resolve_pair_status_origin(headers: &HeaderMap, request_origin: Option<&str>) -> Result<String, ApiError> {
    extract_origin(headers).or_else(|_| extract_normalized_request_origin(request_origin, "Missing origin in pairing status request"))
}

fn map_pair_confirm_error(message: String) -> ApiError {
    if message == "Waiting for companion confirmation" {
        return ApiError::conflict_code(message, PAIR_CONFIRMATION_PENDING_CODE);
    }

    ApiError::BadRequest(message)
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
fn resolve_safe_path_for_new(base: &std::path::Path, drive: &str, relative: &str) -> Result<PathBuf, ApiError> {
    let clean = normalize_drive_relative_path(drive, relative)?;

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

fn resolve_local_archive_extraction_request(drive: &str, body: &ArchiveExtractRequest) -> Result<(PathBuf, PathBuf, PathBuf), ApiError> {
    if body.archive_path.trim().is_empty() || body.destination_path.trim().is_empty() {
        return Err(ApiError::BadRequest("Archive and destination paths are required".to_string()));
    }
    let base_path = drives::resolve_drive_path(drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let archive_path = resolve_safe_path(&base_path, drive, &body.archive_path)?;
    let destination_path = resolve_safe_path_for_new(&base_path, drive, &body.destination_path)?;
    Ok((base_path, archive_path, destination_path))
}

fn resolve_local_archive_creation_request(drive: &str, body: &ArchiveCreateRequest) -> Result<(PathBuf, Vec<PathBuf>, PathBuf), ApiError> {
    if body.source_paths.is_empty() || body.target_path.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Archive creation requires source paths and a target path".to_string(),
        ));
    }
    let base_path = drives::resolve_drive_path(drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let source_paths = body
        .source_paths
        .iter()
        .map(|source_path| resolve_safe_path(&base_path, drive, source_path))
        .collect::<Result<Vec<_>, _>>()?;
    let target_path = resolve_safe_path_for_new(&base_path, drive, &body.target_path)?;
    let Some(parent) = target_path.parent() else {
        return Err(ApiError::BadRequest("Archive target path is invalid".to_string()));
    };
    if !parent.is_dir() {
        return Err(ApiError::BadRequest("Archive target parent directory does not exist".to_string()));
    }
    Ok((base_path, source_paths, target_path))
}

fn archive_execution_response(execution: ArchiveSessionStatus) -> ArchiveExecutionResponse {
    let progress = execution.result.unwrap_or(execution.progress);
    let mut response = ArchiveExecutionResponse {
        execution_id: execution.execution_id,
        kind: execution.kind.as_str().to_string(),
        phase: execution.phase.as_str().to_string(),
        revision: execution.revision,
        progress: ArchiveExecutionProgress {
            completed_members: 0,
            skipped_members: 0,
            failed_members: 0,
            partial_members: 0,
        },
        cancellation_requested: execution.cancellation_requested,
        files_extracted: None,
        directories_created: None,
        extracted_bytes: None,
        files_skipped: None,
        files_created: None,
        source_bytes: None,
        error: execution.error,
        pending_decision: execution.pending_decision.map(|pending| match pending.member_error {
            Some(error) => ArchiveExecutionPendingDecision {
                kind: "member_error".to_string(),
                member_path: pending.member_path,
                target_path: Some(error.target_path),
                is_directory: None,
                message: Some(error.message),
                partial_output: Some(error.partial_output),
                allowed_actions: vec!["retry".to_string(), "ignore".to_string()],
            },
            None => ArchiveExecutionPendingDecision {
                kind: "collision".to_string(),
                member_path: pending.member_path,
                target_path: pending.target_path,
                is_directory: Some(pending.is_directory),
                message: None,
                partial_output: None,
                allowed_actions: if pending.is_directory {
                    vec!["rename".to_string()]
                } else {
                    vec![
                        "skip".to_string(),
                        "skip_all".to_string(),
                        "replace".to_string(),
                        "replace_all".to_string(),
                        "replace_older".to_string(),
                        "rename".to_string(),
                    ]
                },
            },
        }),
    };
    match progress {
        ArchiveSessionProgress::Creation(progress) => {
            response.files_created = Some(progress.files_created);
            response.directories_created = Some(progress.directories_created);
            response.source_bytes = Some(progress.source_bytes);
            response.progress.completed_members = progress.files_created.saturating_add(progress.directories_created);
        }
        ArchiveSessionProgress::Extraction(progress) => {
            response.files_extracted = Some(progress.files_extracted);
            response.directories_created = Some(progress.directories_created);
            response.extracted_bytes = Some(progress.extracted_bytes);
            response.files_skipped = Some(progress.files_skipped);
            response.progress.completed_members = progress.files_extracted.saturating_add(progress.directories_created);
            response.progress.skipped_members = progress.files_skipped;
            response.progress.failed_members = progress.files_failed;
            response.progress.partial_members = progress.partial_members;
        }
    }
    response
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
        link_kind: None,
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

#[cfg(test)]
mod tests {
    use super::{
        archive_creation_response, archive_execution_response, build_file_info, build_pair_status_response, classify_link_target,
        execute_archive_relay, map_local_archive_error, normalize_drive_relative_path, normalize_windows_display_path,
        relay_completed_members, resolve_drive_relative_source_path, resolve_link_target_metadata, resolve_pair_cancel_origin,
        resolve_pair_confirm_origin, resolve_pair_status_origin, resolve_safe_path, source_link_kind, validate_editor_write_target,
        ArchiveCreationAdapterBinding, ArchiveCreationCoordinator, ArchiveCreationMemberCompletion, ArchiveCreationRelay,
        ArchiveExtractionAdapterBinding, ArchiveExtractionCollision, ArchiveExtractionCoordinator, ArchiveExtractionMemberCompletion,
        ArchiveExtractionMemberError, ArchiveExtractionRelay, ArchiveExtractionSummary, ArchiveRelayBinding, ArchiveRelayDestinationStatus,
        ArchiveRelayFailure, ArchiveRelayOperation, ArchiveRelayTransport,
    };
    use crate::server::archive::{
        build_local_archive_manifest, build_local_archive_manifest_for_remote_target, create_local_archive,
        validate_local_archive_extraction, ArchiveCreationManifest, ArchiveCreationManifestMember, LocalArchiveCreationResult,
        LocalArchiveError, LocalArchiveExtractionMemberError, LocalArchiveExtractionResult, LocalArchiveReadError,
    };
    use crate::server::archive_sessions::{
        ArchiveSessionKind, ArchiveSessionPendingDecision, ArchiveSessionPhase, ArchiveSessionProgress, ArchiveSessionStatus,
    };
    use crate::server::errors::{ApiError, LOCAL_ARCHIVE_CREATION_PARTIAL_CODE, LOCAL_ARCHIVE_EXTRACTION_PARTIAL_CODE};
    use crate::server::models::{FileType, LinkKind, LinkTargetState, LinkTargetType, PublicPairingStatus};
    use crate::server::pairing::PairingState;
    use axum::body::to_bytes;
    use axum::extract::State;
    use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri};
    use axum::response::IntoResponse;
    use serde::Deserialize;
    use std::collections::VecDeque;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use std::sync::Arc;
    use tokio::sync::Mutex;
    const NONCE_A: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    #[derive(Deserialize)]
    struct ExtractionOutcomeConformanceCorpus {
        version: u8,
        scenarios: Vec<ExtractionOutcomeConformanceScenario>,
    }

    #[derive(Deserialize)]
    struct ExtractionOutcomeConformanceScenario {
        checkpoint: Option<serde_json::Value>,
        #[serde(default)]
        result_reports: Vec<serde_json::Value>,
        #[serde(default)]
        completed_members: Vec<String>,
        #[serde(default)]
        progress: std::collections::HashMap<String, u64>,
        error: Option<String>,
    }

    fn relay_control_payload_example(name: &str) -> serde_json::Value {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v1/relay-control-payloads-v1.json"))
                .expect("relay control payload fixture should be valid JSON");
        assert_eq!(fixture["version"], 1);
        fixture["payloads"]
            .as_array()
            .expect("relay control payload fixture should contain payloads")
            .iter()
            .find(|payload| payload["name"] == name)
            .unwrap_or_else(|| panic!("relay control payload fixture should define {name}"))["example"]
            .clone()
    }

    fn expected_topology_trace(case_name: &str) -> serde_json::Value {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v1/topology-execution-traces-v1.json"))
                .expect("topology trace fixture should be valid JSON");
        fixture["cases"]
            .as_array()
            .expect("topology trace fixture should define cases")
            .iter()
            .find(|case| case["name"] == case_name)
            .unwrap_or_else(|| panic!("topology trace fixture should define {case_name}"))["expected_trace"]
            .clone()
    }

    #[derive(Clone)]
    struct FixtureRelayServer {
        url: String,
        playback: Arc<Mutex<FixtureRelayPlayback>>,
    }

    struct FixtureRelayPlayback {
        remaining: VecDeque<serde_json::Value>,
        expected_traffic: Vec<serde_json::Value>,
        observed_traffic: Vec<serde_json::Value>,
    }

    impl FixtureRelayServer {
        async fn assert_consumed(&self) {
            let playback = self.playback.lock().await;
            assert!(playback.remaining.is_empty(), "fixture relay playback has unconsumed responses");
            assert_eq!(playback.observed_traffic, playback.expected_traffic);
        }
    }

    async fn fixture_relay_handler(
        State(playback): State<Arc<Mutex<FixtureRelayPlayback>>>,
        method: Method,
        uri: Uri,
        body: axum::body::Bytes,
    ) -> axum::response::Response {
        let observed = serde_json::json!({
            "method": method.as_str(),
            "path": uri.path(),
            "query": uri.query(),
            "body": if body.is_empty() {
                "empty"
            } else if matches!(serde_json::from_slice::<serde_json::Value>(&body), Ok(serde_json::Value::Object(_))) {
                "json"
            } else {
                "bytes"
            },
        });
        let step = {
            let mut playback = playback.lock().await;
            playback.observed_traffic.push(observed.clone());
            playback.remaining.pop_front()
        };
        let Some(step) = step else {
            return (StatusCode::INTERNAL_SERVER_ERROR, "unexpected relay request").into_response();
        };
        if observed != step["request"] {
            eprintln!("fixture relay request mismatch: expected {}, observed {observed}", step["request"]);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "relay request does not match fixture: expected {}, observed {observed}",
                    step["request"]
                ),
            )
                .into_response();
        }
        let response = &step["response"];
        let status = response["status"]
            .as_u64()
            .and_then(|value| StatusCode::from_u16(value as u16).ok())
            .expect("fixture response status should be valid");
        let body = response
            .get("json")
            .map(serde_json::Value::to_string)
            .or_else(|| response.get("text").and_then(serde_json::Value::as_str).map(str::to_string))
            .unwrap_or_default();
        let mut response = (status, body).into_response();
        if step["response"].get("json").is_some() {
            response
                .headers_mut()
                .insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        }
        response
    }

    async fn spawn_fixture_relay_server(case_name: &str) -> FixtureRelayServer {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v1/topology-execution-traces-v1.json"))
                .expect("topology trace fixture should be valid JSON");
        let case = fixture["cases"]
            .as_array()
            .expect("topology trace fixture should define cases")
            .iter()
            .find(|case| case["name"] == case_name)
            .unwrap_or_else(|| panic!("topology trace fixture should define {case_name}"));
        let steps = case["relay_playback"]
            .as_array()
            .unwrap_or_else(|| panic!("topology trace fixture should define relay playback for {case_name}"))
            .clone();
        let playback = Arc::new(Mutex::new(FixtureRelayPlayback {
            expected_traffic: steps.iter().map(|step| step["request"].clone()).collect(),
            remaining: steps.into(),
            observed_traffic: Vec::new(),
        }));
        let app = axum::Router::new()
            .fallback(axum::routing::any(fixture_relay_handler))
            .with_state(playback.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("fixture relay server should bind");
        let address = listener.local_addr().expect("fixture relay server should have an address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("fixture relay server should remain available");
        });
        FixtureRelayServer {
            url: format!("http://{address}"),
            playback,
        }
    }

    #[test]
    fn topology_trace_fixture_assigns_mixed_execution_to_companion_relay_coordinators() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v1/topology-execution-traces-v1.json"))
                .expect("topology trace fixture should be valid JSON");
        assert_eq!(fixture["version"], 1);
        assert_eq!(
            fixture["adapter_faults"],
            serde_json::json!([
                "malformed_input",
                "collision",
                "partial_write",
                "cancellation",
                "source_changed",
                "transport_failure"
            ])
        );
        let companion_topologies = fixture["topologies"]
            .as_array()
            .expect("topology trace fixture should define topologies")
            .iter()
            .filter(|topology| topology["owner"] == "companion")
            .map(|topology| topology["name"].as_str().expect("topology name should be a string"))
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            companion_topologies,
            std::collections::HashSet::from(["local_to_local", "smb_to_local", "local_to_smb"])
        );
        for topology in fixture["topologies"]
            .as_array()
            .expect("topology trace fixture should define topologies")
            .iter()
            .filter(|topology| topology["name"] == "smb_to_local" || topology["name"] == "local_to_smb")
        {
            assert!(topology["exercises"]
                .as_array()
                .expect("mixed topology must declare execution seams")
                .contains(&serde_json::json!("companion_relay_coordinator")));
            assert!(topology["exercises"]
                .as_array()
                .expect("mixed topology must declare execution seams")
                .contains(&serde_json::json!("relay_transport")));
        }
    }

    #[test]
    fn v1_relay_binding_fixture_matches_companion_route_bindings() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../../archive-contract/v1/relay-bindings-v1.json"))
            .expect("relay binding fixture should be valid JSON");
        assert_eq!(fixture["version"], 1);
        assert_eq!(
            fixture["bindings"],
            serde_json::json!([
                {
                    "purpose": ArchiveRelayBinding::LocalZipToSmbExtract.path_segment(),
                    "kind": "extract",
                    "source": "local",
                    "destination": "smb",
                },
                {
                    "purpose": ArchiveRelayBinding::SmbZipToLocalExtract.path_segment(),
                    "kind": "extract",
                    "source": "smb",
                    "destination": "local",
                },
                {
                    "purpose": ArchiveRelayBinding::SmbToLocalZipCreate.path_segment(),
                    "kind": "create",
                    "source": "smb",
                    "destination": "local",
                },
                {
                    "purpose": ArchiveRelayBinding::LocalToSmbZipCreate.path_segment(),
                    "kind": "create",
                    "source": "local",
                    "destination": "smb",
                },
            ])
        );
    }

    async fn spawn_archive_relay_transport_test_server() -> String {
        let app = axum::Router::new()
            .route("/begin", axum::routing::post(|| async { (StatusCode::OK, "invalid JSON") }))
            .route(
                "/member-complete",
                axum::routing::post(|| async { (StatusCode::OK, "ignored response") }),
            )
            .route("/fail", axum::routing::post(|| async { StatusCode::CONFLICT }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("relay transport test server should bind");
        let address = listener.local_addr().expect("relay transport test server should have an address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("relay transport test server should remain available");
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn archive_relay_transport_handles_acknowledgements_and_response_errors() {
        let transport = ArchiveRelayTransport::new(
            reqwest::Client::new(),
            spawn_archive_relay_transport_test_server().await,
            "test-token".to_string(),
        );

        transport
            .post_json_without_result(
                "member-complete",
                &serde_json::json!({"archive_path": "readme.txt", "status": "created", "source_bytes": 5}),
                "Archive creation member completion",
                "complete member",
            )
            .await
            .expect("successful acknowledgements must not require a response body");

        let begin_error = transport
            .begin::<serde_json::Value>("Archive start")
            .await
            .expect_err("a begin response must contain valid JSON");
        assert!(matches!(begin_error, ApiError::Internal(message) if message.contains("invalid start response")));

        let failure_error = transport
            .fail("Archive relay failed", "Archive failure")
            .await
            .expect_err("a failed acknowledgement must retain its HTTP classification");
        assert!(
            matches!(failure_error, ApiError::Conflict(message) if message.as_str().is_some_and(|value| value.contains("record failure")))
        );
        assert_eq!(
            expected_topology_trace("extract_malformed_input")["error_category"],
            "invalid_input"
        );
        assert_eq!(
            expected_topology_trace("extract_transport_failure")["error_category"],
            "transport_failure"
        );
    }

    #[allow(dead_code)]
    async fn spawn_remote_creation_source_server() -> String {
        let app = axum::Router::new()
            .route(
                "/begin",
                axum::routing::post(|| async {
                    axum::Json(serde_json::json!({
                        "entries": [{
                            "archive_path": "source.txt",
                            "is_directory": false,
                            "source_size": 6,
                            "source_modified_at": null
                        }]
                    }))
                }),
            )
            .route("/member", axum::routing::get(|| async { (StatusCode::OK, "source") }))
            .route("/member-complete", axum::routing::post(|| async { StatusCode::NO_CONTENT }))
            .route("/complete", axum::routing::post(|| async { StatusCode::NO_CONTENT }))
            .route("/fail", axum::routing::post(|| async { StatusCode::NO_CONTENT }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("relay source test server should bind");
        let address = listener.local_addr().expect("relay source test server should have an address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("relay source test server should remain available");
        });
        format!("http://{address}")
    }

    #[allow(dead_code)]
    async fn spawn_remote_creation_destination_server() -> String {
        let app = axum::Router::new()
            .route("/begin", axum::routing::post(|| async { StatusCode::NO_CONTENT }))
            .route(
                "/member",
                axum::routing::put(|_: axum::body::Bytes| async { StatusCode::NO_CONTENT }),
            )
            .route("/complete", axum::routing::post(|| async { StatusCode::NO_CONTENT }))
            .route("/fail", axum::routing::post(|| async { StatusCode::NO_CONTENT }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("relay destination test server should bind");
        let address = listener.local_addr().expect("relay destination test server should have an address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("relay destination test server should remain available");
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn actual_relay_creation_coordinator_executes_both_mixed_topologies() {
        let directory = tempfile::tempdir().expect("temporary archive directory should be created");
        let remote_target = directory.path().join("from-smb.zip");
        let remote_playback = spawn_fixture_relay_server("create_smb_to_local_success").await;
        let remote_manifest = ArchiveCreationManifest::from_entries(vec![ArchiveCreationManifestMember {
            archive_path: "source.txt".to_string(),
            is_directory: false,
            source_size: 6,
            source_modified_at: None,
        }])
        .expect("test manifest should be valid");
        let remote_result = ArchiveCreationCoordinator {
            relay: ArchiveCreationRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                remote_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveCreationAdapterBinding::RemoteSourceToLocalDestination {
                manifest: remote_manifest,
                drive_root: directory.path().to_path_buf(),
                target_path: remote_target.clone(),
            },
        }
        .execute()
        .await
        .expect("SMB-to-local creation coordinator should complete");
        let remote_expected = expected_topology_trace("create_smb_to_local_success");
        assert_eq!(remote_result.files_created, remote_expected["terminal_summary"]["files_created"]);
        assert_eq!(remote_result.source_bytes, remote_expected["terminal_summary"]["source_bytes"]);
        assert!(remote_target.is_file());
        remote_playback.assert_consumed().await;

        let local_source = directory.path().join("local-source.txt");
        std::fs::write(&local_source, b"local source").expect("local source should be written");
        let local_entries =
            build_local_archive_manifest_for_remote_target(&[local_source]).expect("local source should produce a valid creation manifest");
        let local_playback = spawn_fixture_relay_server("create_local_to_smb_success").await;
        let local_result = ArchiveCreationCoordinator {
            relay: ArchiveCreationRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                local_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveCreationAdapterBinding::LocalSourceToRemoteDestination { entries: local_entries },
        }
        .execute()
        .await
        .expect("local-to-SMB creation coordinator should complete");
        let local_expected = expected_topology_trace("create_local_to_smb_success");
        assert_eq!(local_result.files_created, local_expected["terminal_summary"]["files_created"]);
        assert_eq!(local_result.source_bytes, local_expected["terminal_summary"]["source_bytes"]);
        local_playback.assert_consumed().await;
    }

    #[allow(dead_code)]
    fn streaming_relay_operation(checkpoint_json: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "phase": "streaming",
            "destination_path": "output",
            "checkpoint_json": checkpoint_json.to_string(),
            "pending_decision_json": null
        })
    }

    #[allow(dead_code)]
    async fn spawn_remote_extraction_source_server() -> String {
        let completed = streaming_relay_operation(serde_json::json!({
            "extraction_outcome_checkpoint_version": 1,
            "member_outcomes": {
                "entry.txt": {
                    "status": "extracted",
                    "target_path": "output/entry.txt",
                    "extracted_bytes": 5,
                    "directories_created": 0,
                    "replaced": false,
                    "renamed": false
                }
            }
        }));
        let app = axum::Router::new()
            .route(
                "/begin",
                axum::routing::post(|| async {
                    axum::Json(serde_json::json!({
                        "operation": streaming_relay_operation(serde_json::json!({
                            "extraction_outcome_checkpoint_version": 1,
                            "member_outcomes": {}
                        })),
                        "entries": [{
                            "path": "entry.txt",
                            "is_directory": false,
                            "uncompressed_size": 5,
                            "modified_at": null
                        }]
                    }))
                }),
            )
            .route("/member", axum::routing::get(|| async { (StatusCode::OK, "entry") }))
            .route(
                "/member-complete",
                axum::routing::post(|| async {
                    axum::Json(streaming_relay_operation(serde_json::json!({
                        "extraction_outcome_checkpoint_version": 1,
                        "member_outcomes": {}
                    })))
                }),
            )
            .route(
                "/complete",
                axum::routing::post(move || {
                    let completed = completed.clone();
                    async move { axum::Json(completed) }
                }),
            )
            .route("/fail", axum::routing::post(|| async { StatusCode::NO_CONTENT }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("remote extraction source test server should bind");
        let address = listener
            .local_addr()
            .expect("remote extraction source test server should have an address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("remote extraction source test server should remain available");
        });
        format!("http://{address}")
    }

    #[allow(dead_code)]
    async fn spawn_remote_extraction_destination_server() -> String {
        let app = axum::Router::new()
            .route(
                "/begin",
                axum::routing::post(|| async {
                    axum::Json(streaming_relay_operation(serde_json::json!({
                        "extraction_outcome_checkpoint_version": 1,
                        "member_outcomes": {}
                    })))
                }),
            )
            .route(
                "/member",
                axum::routing::put(|| async {
                    axum::Json(streaming_relay_operation(serde_json::json!({
                        "extraction_outcome_checkpoint_version": 1,
                        "member_outcomes": {}
                    })))
                }),
            )
            .route("/complete", axum::routing::post(|| async { StatusCode::NO_CONTENT }))
            .route("/fail", axum::routing::post(|| async { StatusCode::NO_CONTENT }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("remote extraction destination test server should bind");
        let address = listener
            .local_addr()
            .expect("remote extraction destination test server should have an address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("remote extraction destination test server should remain available");
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn actual_relay_extraction_coordinator_executes_both_mixed_topologies() {
        let directory = tempfile::tempdir().expect("temporary archive directory should be created");
        let local_destination = directory.path().join("from-smb");
        let remote_playback = spawn_fixture_relay_server("extract_smb_to_local_success").await;
        let remote_result = ArchiveExtractionCoordinator {
            relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                remote_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveExtractionAdapterBinding::RemoteSourceToLocalDestination {
                drive_root: directory.path().to_path_buf(),
                destination_path: local_destination.clone(),
            },
        }
        .execute()
        .await
        .expect("SMB-to-local extraction coordinator should complete");
        let remote_expected = expected_topology_trace("extract_smb_to_local_success");
        assert_eq!(
            remote_result.files_extracted,
            remote_expected["terminal_summary"]["files_extracted"]
        );
        assert_eq!(
            remote_result.extracted_bytes,
            remote_expected["terminal_summary"]["extracted_bytes"]
        );
        assert_eq!(
            std::fs::read(local_destination.join("entry.txt")).expect("relayed member should be written"),
            b"entry"
        );
        remote_playback.assert_consumed().await;

        let local_source = directory.path().join("local.zip");
        let local_member = directory.path().join("source.txt");
        std::fs::write(&local_member, b"entry").expect("local source should be written");
        let entries = build_local_archive_manifest(&[local_member], &local_source).expect("local archive manifest should be valid");
        create_local_archive(directory.path(), &local_source, &entries, || false).expect("local archive should be created");
        let archive_entries = validate_local_archive_extraction(&local_source).expect("local archive entries should be valid");
        let local_playback = spawn_fixture_relay_server("extract_local_to_smb_success").await;
        let local_result = ArchiveExtractionCoordinator {
            relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                local_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveExtractionAdapterBinding::LocalArchiveToRemoteDestination {
                archive_path: local_source,
                archive_entries,
            },
        }
        .execute()
        .await
        .expect("local-to-SMB extraction coordinator should complete");
        let local_expected = expected_topology_trace("extract_local_to_smb_success");
        assert_eq!(local_result.files_extracted, local_expected["terminal_summary"]["files_extracted"]);
        assert_eq!(local_result.extracted_bytes, local_expected["terminal_summary"]["extracted_bytes"]);
        local_playback.assert_consumed().await;
    }

    #[tokio::test]
    async fn archive_relay_failure_envelope_preserves_execution_error() {
        let error = execute_archive_relay(
            async { Err::<(), _>(ApiError::BadRequest("Archive operation failed".to_string())) },
            async { Err::<(), _>(ApiError::Internal("Failure reporting also failed".to_string())) },
        )
        .await
        .expect_err("the relay execution error must not be replaced by a failure-report error");

        assert!(matches!(error, ApiError::BadRequest(message) if message == "Archive operation failed"));
    }

    #[test]
    fn serializes_v1_relay_control_payloads() {
        let completion = ArchiveExtractionMemberCompletion {
            member_path: "docs/readme.txt",
            status: ArchiveRelayDestinationStatus::Extracted,
            target_path: "output/docs/readme.txt",
            directories_created: 1,
            extracted_bytes: 5,
            replaced: false,
            renamed: false,
        };
        let collision = ArchiveExtractionCollision {
            member_path: "docs/readme.txt",
            is_directory: false,
            target_size: Some(5),
            target_modified_at: None,
        };
        let member_error = ArchiveExtractionMemberError {
            member_path: "docs/readme.txt",
            message: "read failed",
            partial_output: true,
        };

        assert_eq!(
            serde_json::to_value(completion).unwrap(),
            relay_control_payload_example("extraction_member_completion")
        );
        assert_eq!(
            serde_json::to_value(collision).unwrap(),
            relay_control_payload_example("extraction_collision")
        );
        assert_eq!(
            serde_json::to_value(member_error).unwrap(),
            relay_control_payload_example("extraction_member_error")
        );
        assert_eq!(
            serde_json::to_value(ArchiveExtractionSummary {
                destination_root_created: true,
            })
            .unwrap(),
            relay_control_payload_example("extraction_summary")
        );
        assert_eq!(
            serde_json::to_value(ArchiveCreationMemberCompletion {
                archive_path: "docs/readme.txt",
                status: "created",
                source_bytes: 5,
            })
            .unwrap(),
            relay_control_payload_example("creation_member_completion")
        );
        assert_eq!(
            serde_json::to_value(archive_creation_response(LocalArchiveCreationResult {
                files_created: 1,
                directories_created: 1,
                source_bytes: 5,
            }))
            .unwrap(),
            relay_control_payload_example("creation_summary")
        );
        assert_eq!(
            serde_json::to_value(ArchiveRelayFailure {
                message: "Archive relay failed",
            })
            .unwrap(),
            relay_control_payload_example("failure")
        );
    }

    #[test]
    fn derives_creation_summary_from_manifest() {
        let manifest = ArchiveCreationManifest::from_entries(vec![
            ArchiveCreationManifestMember {
                archive_path: "docs".to_string(),
                is_directory: true,
                source_size: 0,
                source_modified_at: None,
            },
            ArchiveCreationManifestMember {
                archive_path: "docs/readme.txt".to_string(),
                is_directory: false,
                source_size: 7,
                source_modified_at: None,
            },
        ])
        .expect("manifest entries should be valid");

        let summary = manifest.summary().expect("manifest totals should be representable");

        assert_eq!(summary.files_created, 1);
        assert_eq!(summary.directories_created, 1);
        assert_eq!(summary.source_bytes, 7);
    }

    #[test]
    fn passes_v1_extraction_outcome_conformance_corpus() {
        let corpus_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("archive-contract/v1/extraction-outcome-scenarios-v1.json");
        let corpus: ExtractionOutcomeConformanceCorpus =
            serde_json::from_slice(&std::fs::read(corpus_path).expect("shared extraction outcome corpus should be readable"))
                .expect("shared extraction outcome corpus should be valid JSON");
        assert_eq!(corpus.version, 1);

        for scenario in corpus.scenarios {
            if !scenario.result_reports.is_empty() {
                continue;
            }
            let checkpoint = scenario.checkpoint.expect("checkpoint replay scenario should include a checkpoint");
            let operation = ArchiveRelayOperation {
                phase: "streaming".to_string(),
                destination_path: "output".to_string(),
                checkpoint_json: checkpoint.to_string(),
                pending_decision_json: None,
            };
            let completed = relay_completed_members(&operation);
            if scenario.error.is_some() {
                assert!(completed.is_err(), "shared extraction outcome scenario should be rejected");
                continue;
            }
            let completed = completed.expect("shared extraction outcome scenario should be valid");
            let expected: std::collections::HashSet<String> = scenario.completed_members.into_iter().collect();
            assert_eq!(completed, expected);
            for (key, value) in scenario.progress {
                assert_eq!(checkpoint.get(&key).and_then(serde_json::Value::as_u64).unwrap_or(0), value);
            }
        }
    }

    #[test]
    fn archive_execution_response_emits_contract_progress_counters() {
        let progress = ArchiveSessionProgress::Extraction(LocalArchiveExtractionResult {
            files_extracted: 2,
            directories_created: 1,
            extracted_bytes: 12,
            files_skipped: 3,
            files_replaced: 0,
            files_failed: 0,
            partial_members: 0,
        });
        let response = archive_execution_response(ArchiveSessionStatus {
            execution_id: "execution-id".to_string(),
            kind: ArchiveSessionKind::Extract,
            phase: ArchiveSessionPhase::Streaming,
            revision: 4,
            cancellation_requested: false,
            progress,
            result: None,
            error: None,
            pending_decision: None,
        });

        let serialized = serde_json::to_value(response).expect("archive execution response should serialize");
        assert_eq!(
            serialized["progress"],
            serde_json::json!({
                "completedMembers": 3,
                "skippedMembers": 3,
                "failedMembers": 0,
                "partialMembers": 0,
            })
        );
    }

    #[test]
    fn archive_execution_response_serializes_a_paused_member_error() {
        let response = archive_execution_response(ArchiveSessionStatus {
            execution_id: "execution-id".to_string(),
            kind: ArchiveSessionKind::Extract,
            phase: ArchiveSessionPhase::AwaitingUserDecision,
            revision: 4,
            cancellation_requested: false,
            progress: ArchiveSessionProgress::Extraction(LocalArchiveExtractionResult {
                files_extracted: 0,
                directories_created: 1,
                extracted_bytes: 0,
                files_skipped: 0,
                files_replaced: 0,
                files_failed: 0,
                partial_members: 1,
            }),
            result: None,
            error: None,
            pending_decision: Some(ArchiveSessionPendingDecision {
                member_path: "source.txt".to_string(),
                target_path: None,
                is_directory: false,
                member_error: Some(LocalArchiveExtractionMemberError {
                    member_path: "source.txt".to_string(),
                    target_path: "output/source.txt".to_string(),
                    message: "archive member integrity check failed".to_string(),
                    partial_output: true,
                }),
            }),
        });

        let serialized = serde_json::to_value(response).expect("archive execution response should serialize");
        assert_eq!(
            serialized["pendingDecision"],
            serde_json::json!({
                "kind": "member_error",
                "memberPath": "source.txt",
                "targetPath": "output/source.txt",
                "message": "archive member integrity check failed",
                "partialOutput": true,
                "allowedActions": ["retry", "ignore"],
            })
        );
        assert_eq!(serialized["progress"]["partialMembers"], 1);
    }

    #[tokio::test]
    async fn maps_partial_local_archive_output_to_a_stable_error_code() {
        let response = map_local_archive_error(LocalArchiveError::PartialOutput(Box::new(LocalArchiveError::ArchiveRead(
            LocalArchiveReadError::MemberIntegrityFailure,
        ))))
        .into_response();

        assert_eq!(response.status(), axum::http::StatusCode::INTERNAL_SERVER_ERROR);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("response body should be JSON"),
            serde_json::json!({
                "detail": "Archive extraction failed after creating incomplete output",
                "code": LOCAL_ARCHIVE_EXTRACTION_PARTIAL_CODE,
            })
        );
    }

    #[tokio::test]
    async fn permits_missing_editor_write_targets_but_rejects_directories() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let target = directory.path().join("recreated.md");

        validate_editor_write_target(&target)
            .await
            .expect("a missing editor target should be recreatable");

        tokio::fs::create_dir(&target).await.expect("target directory should be created");
        let response = validate_editor_write_target(&target)
            .await
            .expect_err("an editor write must not replace a directory")
            .into_response();
        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn maps_partial_local_archive_creation_to_a_stable_error_code() {
        let response = map_local_archive_error(LocalArchiveError::PartialArchiveOutput(Box::new(LocalArchiveError::Io(
            std::io::Error::other("source read failed"),
        ))))
        .into_response();

        assert_eq!(response.status(), axum::http::StatusCode::INTERNAL_SERVER_ERROR);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("response body should be JSON"),
            serde_json::json!({
                "detail": "Archive creation failed after creating incomplete output",
                "code": LOCAL_ARCHIVE_CREATION_PARTIAL_CODE,
            })
        );
    }

    #[test]
    fn normalizes_windows_extended_paths_for_display() {
        assert_eq!(
            normalize_windows_display_path(r"\\?\C:\Users\Sambee\report.pdf"),
            r"C:\Users\Sambee\report.pdf"
        );
        assert_eq!(
            normalize_windows_display_path(r"\\?\UNC\server\share\report.pdf"),
            r"\\server\share\report.pdf"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn lists_a_broken_symbolic_link_for_activation_error_handling() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let link = directory.path().join("missing-target");
        symlink(directory.path().join("does-not-exist"), &link).expect("symbolic link should be created");
        let mut entries = tokio::fs::read_dir(directory.path()).await.expect("directory should be readable");
        let entry = entries
            .next_entry()
            .await
            .expect("directory entry should be readable")
            .expect("symbolic link should be listed");
        let info = build_file_info(&entry, "")
            .await
            .expect("broken symbolic link should have fallback metadata");

        assert_eq!(info.name, "missing-target");
        assert_eq!(info.file_type, FileType::File);
        assert!(!info.is_readable);
        assert_eq!(info.link_kind, Some(LinkKind::FilesystemLink));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn lists_a_directory_symbolic_link_as_a_directory() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let target = directory.path().join("target-directory");
        let link = directory.path().join("directory-link");
        std::fs::create_dir(&target).expect("target directory should be created");
        symlink(&target, &link).expect("symbolic link should be created");
        let mut entries = tokio::fs::read_dir(directory.path()).await.expect("directory should be readable");
        let entry = loop {
            let entry = entries
                .next_entry()
                .await
                .expect("directory entry should be readable")
                .expect("directory symbolic link should be listed");
            if entry.file_name() == "directory-link" {
                break entry;
            }
        };

        let info = build_file_info(&entry, "")
            .await
            .expect("directory symbolic link should have target metadata");

        assert_eq!(info.name, "directory-link");
        assert_eq!(info.file_type, FileType::Directory);
        assert!(info.is_readable);
        assert_eq!(info.link_kind, Some(LinkKind::FilesystemLink));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn preserves_symlink_source_identity_for_browse_info() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let target = directory.path().join("target.txt");
        let link = directory.path().join("source-link");
        std::fs::write(&target, "target").expect("temporary file should be written");
        symlink(&target, &link).expect("symbolic link should be created");

        let source_path = resolve_drive_relative_source_path(directory.path(), "", "source-link").expect("source path should be valid");
        let resolved_path = resolve_safe_path(directory.path(), "", "source-link").expect("target should remain in the drive");

        assert_eq!(source_path, link);
        assert_eq!(
            source_link_kind(&source_path).await.expect("source should be readable"),
            Some(LinkKind::FilesystemLink)
        );
        assert_eq!(resolved_path, std::fs::canonicalize(target).expect("target should canonicalize"));
    }

    #[cfg(unix)]
    #[test]
    fn returns_target_path_only_for_an_exposed_drive() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let target = directory.path().join("report.txt");
        let link = directory.path().join("report-link");
        std::fs::write(&target, "report").expect("target file should be created");
        symlink(&target, &link).expect("symbolic link should be created");

        let resolution = resolve_link_target_metadata("report-link".to_string(), link);

        assert_eq!(resolution.source_path, "report-link");
        assert!(matches!(
            resolution.state,
            LinkTargetState::Resolved | LinkTargetState::UnmappedDrive
        ));
        assert_eq!(
            resolution.target,
            Some(crate::server::models::LinkTargetInfo {
                name: "report.txt".to_string(),
                path: if resolution.state == LinkTargetState::Resolved {
                    Some(
                        std::fs::canonicalize(target)
                            .expect("target should canonicalize")
                            .to_string_lossy()
                            .to_string(),
                    )
                } else {
                    None
                },
                target_type: LinkTargetType::File,
            })
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn classifies_non_file_non_directory_targets_as_other() {
        assert_eq!(
            classify_link_target(std::path::Path::new("/dev/null"))
                .await
                .expect("device metadata should be readable"),
            LinkTargetType::Other
        );
    }

    #[test]
    fn normalizes_same_drive_absolute_windows_paths() {
        assert_eq!(normalize_drive_relative_path("d", r"d:\temp").unwrap(), "temp");
        assert_eq!(normalize_drive_relative_path("d", "d:/temp").unwrap(), "temp");
        assert_eq!(normalize_drive_relative_path("d", "d:temp").unwrap(), "temp");
    }

    #[test]
    fn rejects_absolute_paths_for_different_windows_drive() {
        let err = normalize_drive_relative_path("d", r"c:\temp").unwrap_err();
        assert!(format!("{err}").contains("Path targets drive c, not drive d"));
    }

    #[test]
    fn pair_status_reports_pending_local_approval_for_current_origin() {
        let pairing = PairingState::new();
        pairing.initiate(NONCE_A, "https://sambee.example").unwrap();

        let response = build_pair_status_response(&pairing, Some("https://sambee.example"));

        assert_eq!(response.current_origin.as_deref(), Some("https://sambee.example"));
        assert!(!response.current_origin_paired);
        assert_eq!(response.status, PublicPairingStatus::PendingLocalApproval);
    }

    #[test]
    fn resolve_pair_cancel_origin_prefers_header_origin() {
        let mut headers = HeaderMap::new();
        headers.insert("origin", HeaderValue::from_static("https://sambee.example"));

        let origin = resolve_pair_cancel_origin(&headers, Some("https://fallback.example")).unwrap();

        assert_eq!(origin, "https://sambee.example");
    }

    #[test]
    fn resolve_pair_cancel_origin_falls_back_to_request_body() {
        let headers = HeaderMap::new();

        let origin = resolve_pair_cancel_origin(&headers, Some("https://Sambee.Example:8443")).unwrap();

        assert_eq!(origin, "https://sambee.example:8443");
    }

    #[test]
    fn resolve_pair_confirm_origin_falls_back_to_request_body() {
        let headers = HeaderMap::new();

        let origin = resolve_pair_confirm_origin(&headers, Some("https://fallback.example")).unwrap();

        assert_eq!(origin, "https://fallback.example");
    }

    #[test]
    fn resolve_pair_status_origin_falls_back_to_query_origin() {
        let headers = HeaderMap::new();

        let origin = resolve_pair_status_origin(&headers, Some("https://Sambee.Example")).unwrap();

        assert_eq!(origin, "https://sambee.example");
    }
}
