//! HTTP request handlers for the local API server.
//!
//! Each handler mirrors the corresponding endpoint in the Sambee Python
//! backend, producing identical JSON response shapes.

use std::collections::HashSet;
use std::future::Future;
use std::io::Write;
use std::path::{Path as FsPath, PathBuf};
#[cfg(test)]
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::{AtomicBool, Ordering};
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
use tokio::sync::mpsc;
use tokio::task::JoinSet;
use tokio_util::io::{ReaderStream, SyncIoBridge};

use crate::http_client::{classify_proxy_auth_intercept, log_request_error, SambeeHttpClientStore};
use crate::{commands, show_pairing_success, show_pairing_window};

use super::archive::{
    build_local_archive_manifest_for_remote_target, build_local_archive_manifest_with_cancellation, create_local_archive_relay_writer,
    create_local_archive_with_execution_plan_progress_and_state, create_local_extraction_root, ensure_local_extraction_directory,
    extract_local_archive_with_checkpoint_and_progress, open_local_extraction_file, project_local_archive_creation_manifest,
    reopen_partial_local_extraction_file, resolve_companion_archive_inspection_topology_plan, resolve_companion_archive_topology_plan,
    stream_local_archive_member, validate_local_archive_extraction, validate_local_extraction_member_path,
    validate_local_extraction_rename_target, ArchiveCreationManifest, ArchiveCreationManifestState, ArchiveDirectoryListingPresentation,
    ArchiveExtractionManifest, ArchiveExtractionManifestMember, ArchiveExtractionRelayExecutionPlan, ArchiveExtractionRelayState,
    ArchiveInspectionCoordinator, ArchiveInspectionPlan, ArchiveInspectionPresentation, ArchiveMemberReadDelivery,
    ArchiveMemberReadPresentation, CompanionArchiveBinding, CompanionArchiveExecutionDriver, CompanionArchiveOperationKind,
    CompanionArchiveRelayPurpose, CompanionArchiveTopology, CompanionArchiveTopologyPlan, LocalArchiveCreationExecutionPlan,
    LocalArchiveCreationResult, LocalArchiveEntry, LocalArchiveError, LocalArchiveExtractionCollisionAction,
    LocalArchiveExtractionExecutionPlan, LocalArchiveExtractionRunResult, LocalArchiveInspectionSource, LocalArchiveReadEntry,
    LocalArchiveRelayChunk, ARCHIVE_COPY_BUFFER_SIZE,
};
use super::archive_sessions::{
    ArchiveSessionCompletion, ArchiveSessionManager, ArchiveSessionProgress, ArchiveSessionStatus, ArchiveSessionWork,
    PreparedLocalArchiveCreation,
};
use super::auth;
use super::drives;
use super::edit_locks::EDIT_LOCK_LOST_CODE;
use super::errors::{
    ApiError, ArchiveV2Error, ArchiveV2Json, ArchiveV2NoQuery, ArchiveV2Query, LOCAL_ARCHIVE_CREATION_PARTIAL_CODE,
    LOCAL_ARCHIVE_EXTRACTION_PARTIAL_CODE, LOCAL_LINK_TARGET_ACCESS_DENIED_CODE, LOCAL_LINK_TARGET_MISSING_CODE,
    LOCAL_LINK_TARGET_UNMAPPED_DRIVE_CODE, LOCAL_LINK_TARGET_UNRESOLVABLE_CODE, LOCAL_LINK_TARGET_UNSUPPORTED_TYPE_CODE,
    PAIR_CONFIRMATION_PENDING_CODE, RECENT_FILE_NATIVE_LAUNCH_FAILED_CODE, RECENT_FILE_TARGET_MISSING_CODE,
    RECENT_FILE_TARGET_NOT_FILE_CODE,
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
const ARCHIVE_RELAY_IDEMPOTENCY_HEADER: &str = "Idempotency-Key";
const ARCHIVE_RELAY_ACKNOWLEDGEMENT_ATTEMPTS: usize = 2;
#[cfg(test)]
static INSPECTION_RESOLVER_CALL_COUNT: AtomicUsize = AtomicUsize::new(0);
#[cfg(test)]
static INSPECTION_RESOLVER_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[cfg(any(windows, test))]
const WINDOWS_EXTENDED_PATH_PREFIX: &str = "\\\\?\\";
#[cfg(any(windows, test))]
const WINDOWS_EXTENDED_UNC_PATH_PREFIX: &str = "\\\\?\\UNC\\";
#[cfg(any(windows, test))]
const WINDOWS_UNC_PATH_PREFIX: &str = "\\\\";

fn resolve_companion_archive_topology(
    kind: CompanionArchiveOperationKind,
    source_is_local: bool,
    destination_is_local: bool,
) -> Result<CompanionArchiveTopology, ApiError> {
    resolve_companion_archive_topology_plan(kind, source_is_local, destination_is_local)
        .map(|plan| plan.topology)
        .map_err(map_local_archive_error)
}

fn require_archive_v2_contract_version(contract_version: ArchiveContractVersion) -> Result<(), ApiError> {
    if contract_version != ArchiveContractVersion::V2 {
        return Err(ApiError::BadRequest("Unsupported archive contract version".to_string()));
    }
    Ok(())
}

fn resolve_companion_inspection_coordinator(
    topology_plan: CompanionArchiveTopologyPlan,
    plan: ArchiveInspectionPlan,
) -> Result<ArchiveInspectionCoordinator, ApiError> {
    #[cfg(test)]
    INSPECTION_RESOLVER_CALL_COUNT.fetch_add(1, Ordering::Relaxed);
    if matches!(
        (
            topology_plan.kind,
            topology_plan.driver,
            topology_plan.topology,
            topology_plan.source_is_local,
            topology_plan.destination_is_local,
            topology_plan.binding,
        ),
        (
            CompanionArchiveOperationKind::Inspect,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::LocalInspection,
            true,
            None,
            CompanionArchiveBinding::LocalInspection,
        )
    ) {
        Ok(ArchiveInspectionCoordinator::from_plan(plan))
    } else {
        Err(ApiError::Internal(
            "Archive inspection topology did not resolve to a compatible Companion binding".to_string(),
        ))
    }
}

#[cfg(test)]
fn inspection_resolver_call_count() -> usize {
    INSPECTION_RESOLVER_CALL_COUNT.load(Ordering::Relaxed)
}

#[cfg(test)]
fn reset_inspection_resolver_call_count() {
    INSPECTION_RESOLVER_CALL_COUNT.store(0, Ordering::Relaxed);
}

fn resolve_local_archive_inspection_coordinator(
    archive_path: PathBuf,
    presentation: ArchiveInspectionPresentation,
) -> Result<ArchiveInspectionCoordinator, ApiError> {
    let topology_plan = resolve_companion_archive_inspection_topology_plan(true).map_err(map_local_archive_error)?;
    let plan = ArchiveInspectionPlan::from_local_source(LocalArchiveInspectionSource::from_archive_path(archive_path), presentation)
        .map_err(map_local_archive_read_error)?;
    resolve_companion_inspection_coordinator(topology_plan, plan)
}

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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveV2ListQuery {
    pub contract_version: ArchiveContractVersion,
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

/// Shared implementation for a bounded virtual ZIP directory page.
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
    let virtual_path = query.virtual_path.unwrap_or_default();
    let presentation = ArchiveDirectoryListingPresentation::new(
        query.archive_path,
        metadata.len(),
        metadata.modified().ok().map(DateTime::<Utc>::from),
        virtual_path,
        query.cursor,
        page_size,
    );
    let listing = tokio::task::spawn_blocking(move || {
        resolve_local_archive_inspection_coordinator(archive_path, ArchiveInspectionPresentation::DirectoryListing(presentation))?
            .directory_listing()
            .map_err(map_local_archive_read_error)
    })
    .await
    .map_err(|error| ApiError::Internal(format!("Local archive listing task failed: {error}")))??;
    Ok(Json(listing))
}

/// `GET /api/browse/{drive}/archive/v2/list` — list a V2 local archive directory.
pub async fn browse_list_v2_archive(
    Path(drive): Path<String>,
    ArchiveV2Query(query): ArchiveV2Query<ArchiveV2ListQuery>,
) -> Result<Json<ArchiveDirectoryListing>, ArchiveV2Error> {
    let _contract_version = query.contract_version;
    browse_list_archive(
        Path(drive),
        Query(ArchiveListQuery {
            archive_path: query.archive_path,
            virtual_path: query.virtual_path,
            cursor: query.cursor,
            page_size: query.page_size,
        }),
    )
    .await
    .map_err(ArchiveV2Error::from)
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveV2MemberQuery {
    pub contract_version: ArchiveContractVersion,
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

/// Shared implementation for a parser-validated archive member stream.
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
    let presentation = ArchiveMemberReadPresentation::new(member_path, query.download);
    let member = tokio::task::spawn_blocking(move || {
        resolve_local_archive_inspection_coordinator(inspection_path, ArchiveInspectionPresentation::MemberRead(presentation))
            .and_then(|coordinator| coordinator.member_read().map_err(map_local_archive_read_error))
    })
    .await
    .map_err(|error| ApiError::Internal(format!("Local archive validation task failed: {error}")))??;
    if member.delivery == ArchiveMemberReadDelivery::PreviewUnavailable {
        return Err(ApiError::PayloadTooLarge(
            "Archive member exceeds the inline preview size limit".to_string(),
        ));
    }

    let (writer, reader) = tokio::io::duplex(ARCHIVE_COPY_BUFFER_SIZE);
    tokio::task::spawn_blocking(move || {
        let mut output = SyncIoBridge::new(writer);
        if let Err(error) = stream_local_archive_member(&archive_path, &member.member_path, &mut output) {
            warn!("Local archive member stream failed: {error}");
        }
    });

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", member.content_type)
        .header(
            "Content-Disposition",
            HeaderValue::from_str(&member.content_disposition).unwrap_or_else(|_| HeaderValue::from_static("attachment")),
        )
        .body(Body::from_stream(ReaderStream::new(reader)))
        .map_err(|error| ApiError::Internal(format!("Failed to build archive member response: {error}")))
}

/// `GET /api/viewer/{drive}/archive/v2/member` — stream a V2 local archive member.
pub async fn viewer_v2_archive_member(
    Path(drive): Path<String>,
    ArchiveV2Query(query): ArchiveV2Query<ArchiveV2MemberQuery>,
) -> Result<Response<Body>, ArchiveV2Error> {
    let _contract_version = query.contract_version;
    viewer_archive_member(
        Path(drive),
        Query(ArchiveMemberQuery {
            archive_path: query.archive_path,
            member_path: query.member_path,
            download: query.download,
        }),
    )
    .await
    .map_err(ArchiveV2Error::from)
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

type ArchiveRelayBinding = CompanionArchiveRelayPurpose;

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
        self.post_without_result("complete", request_context, "complete").await
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
        let idempotency_key = uuid::Uuid::new_v4().to_string();
        let response = self
            .send_acknowledgement(
                || {
                    self.post(path)
                        .header(ARCHIVE_RELAY_IDEMPOTENCY_HEADER, &idempotency_key)
                        .json(payload)
                },
                request_context,
            )
            .await?;
        relay_archive_response(response, action).await
    }

    async fn post_json_once_without_result<T: Serialize + ?Sized>(
        &self,
        path: &str,
        payload: &T,
        request_context: &str,
        action: &str,
    ) -> Result<(), ApiError> {
        let response = self
            .post(path)
            .json(payload)
            .send()
            .await
            .map_err(|error| ApiError::Internal(log_request_error(request_context, "POST", self.url(), &error)))?;
        relay_archive_response(response, action).await
    }

    async fn post_without_result(&self, path: &str, request_context: &str, action: &str) -> Result<(), ApiError> {
        let idempotency_key = uuid::Uuid::new_v4().to_string();
        self.post_without_result_with_idempotency_key(path, &idempotency_key, request_context, action)
            .await
    }

    async fn post_without_result_with_idempotency_key(
        &self,
        path: &str,
        idempotency_key: &str,
        request_context: &str,
        action: &str,
    ) -> Result<(), ApiError> {
        let response = self
            .send_acknowledgement(
                || self.post(path).header(ARCHIVE_RELAY_IDEMPOTENCY_HEADER, idempotency_key),
                request_context,
            )
            .await?;
        relay_archive_response(response, action).await
    }

    async fn send_acknowledgement(
        &self,
        request: impl Fn() -> reqwest::RequestBuilder,
        request_context: &str,
    ) -> Result<ReqwestResponse, ApiError> {
        let mut last_error = None;
        for _ in 0..ARCHIVE_RELAY_ACKNOWLEDGEMENT_ATTEMPTS {
            match request().send().await {
                Ok(response) => return Ok(response),
                Err(error) => last_error = Some(error),
            }
        }
        let error = last_error.expect("relay acknowledgement attempts should run at least once");
        Err(ApiError::Internal(log_request_error(request_context, "POST", self.url(), &error)))
    }

    async fn post_json<T: Serialize + ?Sized, R: DeserializeOwned>(
        &self,
        path: &str,
        payload: &T,
        request_context: &str,
        action: &str,
    ) -> Result<R, ApiError> {
        let idempotency_key = uuid::Uuid::new_v4().to_string();
        let response = self
            .send_acknowledgement(
                || {
                    self.post(path)
                        .header(ARCHIVE_RELAY_IDEMPOTENCY_HEADER, &idempotency_key)
                        .json(payload)
                },
                request_context,
            )
            .await?;
        decode_archive_relay_json(response, action).await
    }

    async fn fail(&self, message: &str, request_context: &str) -> Result<(), ApiError> {
        self.post_json_once_without_result("fail", &ArchiveRelayFailure { message }, request_context, "record failure")
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

#[cfg(test)]
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

#[cfg(test)]
impl ArchiveCreationAdapterBinding {
    fn topology_plan(&self) -> Result<CompanionArchiveTopologyPlan, ApiError> {
        match self {
            Self::RemoteSourceToLocalDestination { .. } => {
                resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Create, false, true)
            }
            Self::LocalSourceToRemoteDestination { .. } => {
                resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Create, true, false)
            }
        }
        .map_err(map_local_archive_error)
    }

    fn prepare(self) -> Result<PreparedArchiveCreationBinding, ApiError> {
        match self {
            Self::RemoteSourceToLocalDestination {
                manifest,
                drive_root,
                target_path,
            } => Ok(PreparedArchiveCreationBinding::RemoteSourceToLocalDestination {
                manifest,
                drive_root,
                target_path,
            }),
            Self::LocalSourceToRemoteDestination { entries } => {
                let manifest = project_local_archive_creation_manifest(&entries).map_err(map_local_archive_error)?;
                Ok(PreparedArchiveCreationBinding::LocalSourceToRemoteDestination { entries, manifest })
            }
        }
    }
}

enum PreparedArchiveCreationBinding {
    RemoteSourceToLocalDestination {
        manifest: ArchiveCreationManifest,
        drive_root: PathBuf,
        target_path: PathBuf,
    },
    LocalSourceToRemoteDestination {
        entries: Vec<LocalArchiveEntry>,
        manifest: ArchiveCreationManifest,
    },
}

#[derive(Clone)]
struct DirectLocalCreationBinding {
    drive_root: PathBuf,
    source_paths: Vec<PathBuf>,
    target_path: PathBuf,
    prepared_plan: Option<(Vec<LocalArchiveEntry>, LocalArchiveCreationExecutionPlan)>,
    #[cfg(test)]
    pre_write_action: Option<super::archive_sessions::CreationPreWriteAction>,
}

enum CompanionArchiveCreationPlan {
    DirectLocal {
        state_store: Arc<ArchiveSessionManager>,
        execution_id: String,
        binding: DirectLocalCreationBinding,
    },
    #[cfg(test)]
    DirectLocalDeferred {
        state_store: Arc<ArchiveSessionManager>,
        execution_id: String,
    },
    Relay {
        relay: ArchiveCreationRelay,
        binding: PreparedArchiveCreationBinding,
    },
    RelayPreflightFailure {
        relay: ArchiveCreationRelay,
        error: ApiError,
    },
}

enum CompanionArchiveCreationResult {
    DirectLocalStarted,
    Relay(ArchiveCreationResponse),
}

enum DirectLocalCreationWorkerEvent {
    Plan {
        entries: Vec<LocalArchiveEntry>,
        execution_plan: LocalArchiveCreationExecutionPlan,
    },
    Progress(ArchiveSessionProgress),
}

/// Select and execute the Companion-owned creation adapter for one immutable topology plan.
struct CompanionArchiveCreationCoordinator {
    plan: CompanionArchiveCreationPlan,
}

impl CompanionArchiveCreationCoordinator {
    fn into_plan(self) -> CompanionArchiveCreationPlan {
        self.plan
    }

    fn direct_local(state_store: Arc<ArchiveSessionManager>, execution_id: String, binding: DirectLocalCreationBinding) -> Self {
        Self {
            plan: CompanionArchiveCreationPlan::DirectLocal {
                state_store,
                execution_id,
                binding,
            },
        }
    }

    async fn direct_local_from_session(state_store: Arc<ArchiveSessionManager>, execution_id: String) -> Result<Self, ApiError> {
        let (drive_root, source_paths, target_path) = state_store.direct_local_creation_work(&execution_id).await?;
        let Some((entries, execution_plan)) = state_store.direct_local_creation_plan(&execution_id).await? else {
            #[cfg(not(test))]
            return Err(ApiError::Internal(
                "Direct-local creation preflight plan is unavailable".to_string(),
            ));
            #[cfg(test)]
            return Ok(Self {
                plan: CompanionArchiveCreationPlan::DirectLocalDeferred { state_store, execution_id },
            });
        };
        Ok(Self::direct_local(
            state_store,
            execution_id,
            DirectLocalCreationBinding {
                drive_root,
                source_paths,
                target_path,
                prepared_plan: Some((entries, execution_plan)),
                #[cfg(test)]
                pre_write_action: None,
            },
        ))
    }

    fn relay(relay: ArchiveCreationRelay, binding: PreparedArchiveCreationBinding) -> Self {
        Self {
            plan: CompanionArchiveCreationPlan::Relay { relay, binding },
        }
    }

    fn relay_preflight_failure(relay: ArchiveCreationRelay, error: ApiError) -> Self {
        Self {
            plan: CompanionArchiveCreationPlan::RelayPreflightFailure { relay, error },
        }
    }

    async fn execute(self) -> Result<CompanionArchiveCreationResult, ApiError> {
        match self.plan {
            CompanionArchiveCreationPlan::DirectLocal {
                state_store,
                execution_id,
                binding,
            } => {
                Self::execute_direct_local(state_store, execution_id, binding).await?;
                Ok(CompanionArchiveCreationResult::DirectLocalStarted)
            }
            #[cfg(test)]
            CompanionArchiveCreationPlan::DirectLocalDeferred { state_store, execution_id } => {
                Self::execute_direct_local_deferred(state_store, execution_id).await?;
                Ok(CompanionArchiveCreationResult::DirectLocalStarted)
            }
            CompanionArchiveCreationPlan::Relay { relay, binding } => {
                Self::execute_relay(relay, binding).await.map(CompanionArchiveCreationResult::Relay)
            }
            CompanionArchiveCreationPlan::RelayPreflightFailure { relay, error } => {
                execute_archive_relay(async { Err(error) }, relay.fail()).await
            }
        }
    }

    fn relay_result(result: CompanionArchiveCreationResult) -> Result<ArchiveCreationResponse, ApiError> {
        match result {
            CompanionArchiveCreationResult::Relay(result) => Ok(result),
            CompanionArchiveCreationResult::DirectLocalStarted => Err(ApiError::Internal(
                "Archive creation topology did not produce a relay result".to_string(),
            )),
        }
    }

    async fn execute_relay(
        relay: ArchiveCreationRelay,
        binding: PreparedArchiveCreationBinding,
    ) -> Result<ArchiveCreationResponse, ApiError> {
        let result = execute_archive_relay(
            async {
                match binding {
                    PreparedArchiveCreationBinding::RemoteSourceToLocalDestination {
                        manifest,
                        drive_root,
                        target_path,
                    } => match create_smb_archive_manifest_locally(&relay, &drive_root, &target_path, manifest).await {
                        Ok(result) => Ok(result),
                        Err(error)
                            if target_path.exists()
                                && !is_archive_relay_cancellation(&error)
                                && !is_archive_relay_source_changed(&error)
                                && !is_archive_relay_collision(&error)
                                && !is_archive_relay_transport_failure(&error) =>
                        {
                            Err(ApiError::internal_code(
                                "Archive creation failed after creating incomplete output",
                                LOCAL_ARCHIVE_CREATION_PARTIAL_CODE,
                            ))
                        }
                        Err(error) => Err(error),
                    },
                    PreparedArchiveCreationBinding::LocalSourceToRemoteDestination { entries, manifest } => {
                        create_local_archive_for_smb_destination(&relay, entries, manifest).await
                    }
                }
            },
            relay.fail(),
        )
        .await?;
        relay.complete(&result).await?;
        Ok(result)
    }

    async fn execute_direct_local(
        state_store: Arc<ArchiveSessionManager>,
        execution_id: String,
        binding: DirectLocalCreationBinding,
    ) -> Result<(), ApiError> {
        let (_, work, cancellation_requested, _) = state_store.start_state(&execution_id).await?;
        if !matches!(work, ArchiveSessionWork::Creation { .. }) {
            return Err(ApiError::conflict_message("Archive execution is not a creation operation"));
        }
        Self::spawn_direct_local_creation(state_store, execution_id, binding, cancellation_requested);
        Ok(())
    }

    #[cfg(test)]
    async fn execute_direct_local_deferred(state_store: Arc<ArchiveSessionManager>, execution_id: String) -> Result<(), ApiError> {
        let (drive_root, work, cancellation_requested, _) = state_store.start_state(&execution_id).await?;
        let ArchiveSessionWork::Creation { source_paths, target_path } = work else {
            return Err(ApiError::conflict_message("Archive execution is not a creation operation"));
        };
        Self::spawn_direct_local_creation(
            state_store,
            execution_id,
            DirectLocalCreationBinding {
                drive_root,
                source_paths,
                target_path,
                prepared_plan: None,
                pre_write_action: None,
            },
            cancellation_requested,
        );
        Ok(())
    }

    fn spawn_direct_local_creation(
        state_store: Arc<ArchiveSessionManager>,
        execution_id: String,
        binding: DirectLocalCreationBinding,
        cancellation_requested: Arc<AtomicBool>,
    ) {
        tokio::spawn(async move {
            let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
            let mut archive_task = tokio::task::spawn_blocking(move || {
                if cancellation_requested.load(Ordering::Acquire) {
                    return Err(LocalArchiveError::Cancelled);
                }
                let (entries, execution_plan) = match binding.prepared_plan {
                    Some(plan) => plan,
                    None => {
                        let entries = build_local_archive_manifest_with_cancellation(&binding.source_paths, &binding.target_path, || {
                            cancellation_requested.load(Ordering::Acquire)
                        })?;
                        let execution_plan = LocalArchiveCreationExecutionPlan::from_entries(&entries)?;
                        let _ = event_sender.send(DirectLocalCreationWorkerEvent::Plan {
                            entries: entries.clone(),
                            execution_plan: execution_plan.clone(),
                        });
                        (entries, execution_plan)
                    }
                };
                #[cfg(test)]
                if let Some(action) = binding.pre_write_action {
                    action.apply(&binding.source_paths, &cancellation_requested)?;
                }
                create_local_archive_with_execution_plan_progress_and_state(
                    &binding.drive_root,
                    &binding.target_path,
                    &entries,
                    execution_plan,
                    || cancellation_requested.load(Ordering::Acquire),
                    |progress| {
                        let _ = event_sender.send(DirectLocalCreationWorkerEvent::Progress(ArchiveSessionProgress::Creation(progress)));
                    },
                )
                .map(|(result, state)| ArchiveSessionCompletion::CreationCompleted { result, state })
            });
            let result = loop {
                tokio::select! {
                    Some(event) = event_receiver.recv() => match event {
                        DirectLocalCreationWorkerEvent::Plan { entries, execution_plan } => {
                            state_store.record_creation_plan(&execution_id, entries, execution_plan).await;
                        }
                        DirectLocalCreationWorkerEvent::Progress(progress) => state_store.update_progress(&execution_id, progress).await,
                    },
                    result = &mut archive_task => {
                        while let Ok(event) = event_receiver.try_recv() {
                            match event {
                                DirectLocalCreationWorkerEvent::Plan { entries, execution_plan } => {
                                    state_store.record_creation_plan(&execution_id, entries, execution_plan).await;
                                }
                                DirectLocalCreationWorkerEvent::Progress(progress) => state_store.update_progress(&execution_id, progress).await,
                            }
                        }
                        break result
                            .map_err(|error| LocalArchiveError::Io(std::io::Error::other(format!("Archive execution task failed: {error}"))))
                            .and_then(|result| result);
                    }
                }
            };
            state_store.complete(&execution_id, result).await;
        });
    }
}

fn resolve_companion_creation_coordinator(
    topology_plan: CompanionArchiveTopologyPlan,
    plan: CompanionArchiveCreationPlan,
) -> Result<CompanionArchiveCreationCoordinator, ApiError> {
    let binding_matches_topology = matches!(
        (
            topology_plan.kind,
            topology_plan.driver,
            topology_plan.topology,
            topology_plan.source_is_local,
            topology_plan.destination_is_local,
            topology_plan.binding,
            &plan,
        ),
        (
            CompanionArchiveOperationKind::Create,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::LocalToLocal,
            true,
            Some(true),
            CompanionArchiveBinding::LocalToLocal,
            CompanionArchiveCreationPlan::DirectLocal { .. }
        ) | (
            CompanionArchiveOperationKind::Create,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::SmbToLocal,
            false,
            Some(true),
            CompanionArchiveBinding::SmbToLocalRelay,
            CompanionArchiveCreationPlan::Relay { .. }
        ) | (
            CompanionArchiveOperationKind::Create,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::LocalToSmb,
            true,
            Some(false),
            CompanionArchiveBinding::LocalToSmbRelay,
            CompanionArchiveCreationPlan::Relay { .. }
        ) | (
            CompanionArchiveOperationKind::Create,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::SmbToLocal,
            false,
            Some(true),
            CompanionArchiveBinding::SmbToLocalRelay,
            CompanionArchiveCreationPlan::RelayPreflightFailure { .. }
        ) | (
            CompanionArchiveOperationKind::Create,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::LocalToSmb,
            true,
            Some(false),
            CompanionArchiveBinding::LocalToSmbRelay,
            CompanionArchiveCreationPlan::RelayPreflightFailure { .. }
        )
    );
    #[cfg(test)]
    let binding_matches_topology = binding_matches_topology
        || matches!(
            (
                topology_plan.kind,
                topology_plan.driver,
                topology_plan.topology,
                topology_plan.source_is_local,
                topology_plan.destination_is_local,
                topology_plan.binding,
                &plan,
            ),
            (
                CompanionArchiveOperationKind::Create,
                CompanionArchiveExecutionDriver::Companion,
                CompanionArchiveTopology::LocalToLocal,
                true,
                Some(true),
                CompanionArchiveBinding::LocalToLocal,
                CompanionArchiveCreationPlan::DirectLocalDeferred { .. }
            )
        );
    if binding_matches_topology {
        Ok(CompanionArchiveCreationCoordinator { plan })
    } else {
        Err(ApiError::Internal(
            "Archive creation topology did not resolve to a compatible Companion binding".to_string(),
        ))
    }
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

#[cfg(test)]
struct FixtureArchiveCreationInvocation {
    relay: ArchiveCreationRelay,
    binding: ArchiveCreationAdapterBinding,
}

#[cfg(test)]
impl FixtureArchiveCreationInvocation {
    async fn execute(self) -> Result<ArchiveCreationResponse, ApiError> {
        let topology_plan = self.binding.topology_plan()?;
        let coordinator = match self.binding.prepare() {
            Ok(binding) => CompanionArchiveCreationCoordinator::relay(self.relay, binding),
            Err(error) => CompanionArchiveCreationCoordinator::relay_preflight_failure(self.relay, error),
        };
        let result = resolve_companion_creation_coordinator(topology_plan, coordinator.into_plan())?
            .execute()
            .await?;
        CompanionArchiveCreationCoordinator::relay_result(result)
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
            .post_json_once_without_result("begin", manifest, "Archive creation start", "start")
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

#[cfg(test)]
pub(crate) async fn start_direct_local_archive_session(
    state_store: Arc<ArchiveSessionManager>,
    execution_id: &str,
) -> Result<(), ApiError> {
    match state_store.session_kind(execution_id).await? {
        super::archive_sessions::ArchiveSessionKind::Create => {
            resolve_companion_creation_coordinator(
                resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Create, true, true)
                    .map_err(map_local_archive_error)?,
                CompanionArchiveCreationCoordinator::direct_local_from_session(state_store, execution_id.to_string())
                    .await?
                    .into_plan(),
            )?
            .execute()
            .await?;
        }
        super::archive_sessions::ArchiveSessionKind::Extract => {
            resolve_companion_extraction_coordinator(
                resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Extract, true, true)
                    .map_err(map_local_archive_error)?,
                CompanionArchiveExtractionCoordinator::direct_local_from_session(state_store, execution_id.to_string())
                    .await?
                    .into_plan(),
            )?
            .execute()
            .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) async fn start_direct_local_archive_session_with_creation_pre_write_action(
    state_store: Arc<ArchiveSessionManager>,
    execution_id: &str,
    pre_write_action: super::archive_sessions::CreationPreWriteAction,
) -> Result<(), ApiError> {
    let (drive_root, source_paths, target_path) = state_store.direct_local_creation_work(execution_id).await?;
    let preflight_sources = source_paths.clone();
    let preflight_target = target_path.clone();
    let entries = tokio::task::spawn_blocking(move || {
        build_local_archive_manifest_with_cancellation(&preflight_sources, &preflight_target, || false)
    })
    .await
    .map_err(|error| ApiError::Internal(format!("Local archive validation task failed: {error}")))?
    .map_err(map_local_archive_error)?;
    let execution_plan = LocalArchiveCreationExecutionPlan::from_entries(&entries).map_err(map_local_archive_error)?;
    state_store
        .record_creation_plan(execution_id, entries.clone(), execution_plan.clone())
        .await;
    resolve_companion_creation_coordinator(
        resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Create, true, true).map_err(map_local_archive_error)?,
        CompanionArchiveCreationCoordinator::direct_local(
            state_store,
            execution_id.to_string(),
            DirectLocalCreationBinding {
                drive_root,
                source_paths,
                target_path,
                prepared_plan: Some((entries, execution_plan)),
                pre_write_action: Some(pre_write_action),
            },
        )
        .into_plan(),
    )?
    .execute()
    .await?;
    Ok(())
}

#[cfg(test)]
pub(crate) async fn decide_direct_local_archive_session(
    state_store: Arc<ArchiveSessionManager>,
    drive: &str,
    owner_origin: &str,
    execution_id: &str,
    expected_revision: u64,
    decision: super::archive_sessions::ArchiveSessionDecision,
) -> Result<ArchiveSessionStatus, ApiError> {
    resolve_companion_extraction_coordinator(
        resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Extract, true, true).map_err(map_local_archive_error)?,
        CompanionArchiveExtractionCoordinator::direct_local_from_session(state_store, execution_id.to_string())
            .await?
            .into_plan(),
    )?
    .decide(drive, owner_origin, execution_id, expected_revision, decision)
    .await
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

#[cfg(test)]
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

#[cfg(test)]
impl ArchiveExtractionAdapterBinding {
    fn topology_plan(&self) -> Result<CompanionArchiveTopologyPlan, ApiError> {
        match self {
            Self::LocalArchiveToRemoteDestination { .. } => {
                resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Extract, true, false)
            }
            Self::RemoteSourceToLocalDestination { .. } => {
                resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Extract, false, true)
            }
        }
        .map_err(map_local_archive_error)
    }

    async fn prepare(self, relay: &ArchiveExtractionRelay) -> Result<PreparedArchiveExtractionBinding, ApiError> {
        match self {
            Self::LocalArchiveToRemoteDestination {
                archive_path,
                archive_entries,
            } => prepare_local_archive_extraction_relay_binding(relay, archive_path, archive_entries).await,
            Self::RemoteSourceToLocalDestination {
                drive_root,
                destination_path,
            } => prepare_smb_archive_extraction_relay_binding(relay, drive_root, destination_path).await,
        }
    }
}

enum PreparedArchiveExtractionBinding {
    LocalArchiveToRemoteDestination {
        archive_path: PathBuf,
        archive_entries: Vec<LocalArchiveReadEntry>,
        manifest: ArchiveExtractionManifest,
        operation: ArchiveRelayOperation,
        execution_plan: Option<ArchiveExtractionRelayExecutionPlan>,
    },
    RemoteSourceToLocalDestination {
        drive_root: PathBuf,
        destination_path: PathBuf,
        manifest: ArchiveExtractionManifest,
        operation: ArchiveRelayOperation,
        execution_plan: Option<ArchiveExtractionRelayExecutionPlan>,
    },
}

#[derive(Clone)]
struct DirectLocalExtractionBinding {
    drive_root: PathBuf,
    archive_path: PathBuf,
    destination_path: PathBuf,
    execution_plan: LocalArchiveExtractionExecutionPlan,
}

enum CompanionArchiveExtractionPlan {
    DirectLocal {
        state_store: Arc<ArchiveSessionManager>,
        execution_id: String,
        binding: Box<DirectLocalExtractionBinding>,
    },
    #[cfg(test)]
    DirectLocalDeferred {
        state_store: Arc<ArchiveSessionManager>,
        execution_id: String,
    },
    Relay {
        relay: ArchiveExtractionRelay,
        binding: Box<PreparedArchiveExtractionBinding>,
    },
    RelayPreflightFailure {
        relay: ArchiveExtractionRelay,
        error: ApiError,
    },
}

enum CompanionArchiveExtractionResult {
    DirectLocalStarted,
    Relay(ArchiveExtractionResponse),
}

enum DirectLocalExtractionWorkerEvent {
    Progress(ArchiveSessionProgress),
}

/// Select and execute the Companion-owned extraction adapter for one immutable topology plan.
struct CompanionArchiveExtractionCoordinator {
    plan: CompanionArchiveExtractionPlan,
}

impl CompanionArchiveExtractionCoordinator {
    fn into_plan(self) -> CompanionArchiveExtractionPlan {
        self.plan
    }

    fn direct_local(state_store: Arc<ArchiveSessionManager>, execution_id: String, binding: DirectLocalExtractionBinding) -> Self {
        Self {
            plan: CompanionArchiveExtractionPlan::DirectLocal {
                state_store,
                execution_id,
                binding: Box::new(binding),
            },
        }
    }

    async fn direct_local_from_session(state_store: Arc<ArchiveSessionManager>, execution_id: String) -> Result<Self, ApiError> {
        let (drive_root, archive_path, destination_path) = state_store.direct_local_extraction_work(&execution_id).await?;
        let Some(execution_plan) = state_store.direct_local_extraction_plan(&execution_id).await? else {
            #[cfg(not(test))]
            return Err(ApiError::Internal(
                "Direct-local extraction preflight plan is unavailable".to_string(),
            ));
            #[cfg(test)]
            return Ok(Self {
                plan: CompanionArchiveExtractionPlan::DirectLocalDeferred { state_store, execution_id },
            });
        };
        Ok(Self::direct_local(
            state_store,
            execution_id,
            DirectLocalExtractionBinding {
                drive_root,
                archive_path,
                destination_path,
                execution_plan,
            },
        ))
    }

    fn relay(relay: ArchiveExtractionRelay, binding: PreparedArchiveExtractionBinding) -> Self {
        Self {
            plan: CompanionArchiveExtractionPlan::Relay {
                relay,
                binding: Box::new(binding),
            },
        }
    }

    fn relay_preflight_failure(relay: ArchiveExtractionRelay, error: ApiError) -> Self {
        Self {
            plan: CompanionArchiveExtractionPlan::RelayPreflightFailure { relay, error },
        }
    }

    async fn execute(self) -> Result<CompanionArchiveExtractionResult, ApiError> {
        match self.plan {
            CompanionArchiveExtractionPlan::DirectLocal {
                state_store,
                execution_id,
                binding,
            } => {
                Self::execute_direct_local(state_store, execution_id, *binding).await?;
                Ok(CompanionArchiveExtractionResult::DirectLocalStarted)
            }
            #[cfg(test)]
            CompanionArchiveExtractionPlan::DirectLocalDeferred { state_store, execution_id } => {
                Self::execute_direct_local_deferred(state_store, execution_id).await?;
                Ok(CompanionArchiveExtractionResult::DirectLocalStarted)
            }
            CompanionArchiveExtractionPlan::Relay { relay, binding } => Self::execute_relay(relay, *binding)
                .await
                .map(CompanionArchiveExtractionResult::Relay),
            CompanionArchiveExtractionPlan::RelayPreflightFailure { relay, error } => {
                execute_archive_relay(async { Err(error) }, relay.fail()).await
            }
        }
    }

    async fn decide(
        self,
        drive: &str,
        owner_origin: &str,
        execution_id: &str,
        expected_revision: u64,
        decision: super::archive_sessions::ArchiveSessionDecision,
    ) -> Result<ArchiveSessionStatus, ApiError> {
        match self.plan {
            CompanionArchiveExtractionPlan::DirectLocal { state_store, binding, .. } => {
                let binding = *binding;
                let decision_state = state_store.decision_state(drive, owner_origin, execution_id).await?;
                if decision_state.revision != expected_revision {
                    return Err(ApiError::conflict_code(
                        "Archive execution changed before the decision could be applied",
                        super::archive_sessions::ARCHIVE_SESSION_STALE_REVISION_CODE,
                    ));
                }
                if decision_state.phase != super::archive_sessions::ArchiveSessionPhase::AwaitingUserDecision {
                    return Err(ApiError::conflict_message("Archive execution is not awaiting a user decision"));
                }
                let pending_decision = decision_state
                    .pending_decision
                    .ok_or_else(|| ApiError::Internal("Archive extraction decision details are unavailable".to_string()))?;
                if pending_decision.member_path != decision.member_path {
                    return Err(ApiError::conflict_message("Archive decision does not match the pending member"));
                }
                let is_member_error = pending_decision.member_error.is_some();
                let is_directory = pending_decision.is_directory;
                if !matches!(
                    (is_member_error, decision.action),
                    (false, super::archive_sessions::ArchiveSessionDecisionAction::Skip)
                        | (false, super::archive_sessions::ArchiveSessionDecisionAction::SkipAll)
                        | (false, super::archive_sessions::ArchiveSessionDecisionAction::Replace)
                        | (false, super::archive_sessions::ArchiveSessionDecisionAction::ReplaceAll)
                        | (false, super::archive_sessions::ArchiveSessionDecisionAction::ReplaceOlder)
                        | (false, super::archive_sessions::ArchiveSessionDecisionAction::Rename)
                        | (true, super::archive_sessions::ArchiveSessionDecisionAction::Retry)
                        | (true, super::archive_sessions::ArchiveSessionDecisionAction::Ignore)
                ) {
                    return Err(ApiError::conflict_message("Archive decision is not allowed for the pending member"));
                }
                if is_directory && !matches!(decision.action, super::archive_sessions::ArchiveSessionDecisionAction::Rename) {
                    return Err(ApiError::conflict_message("Directory collisions may only be resolved by renaming"));
                }
                let rename_target = if matches!(decision.action, super::archive_sessions::ArchiveSessionDecisionAction::Rename) {
                    Some(
                        decision
                            .target_path
                            .as_deref()
                            .ok_or_else(|| ApiError::BadRequest("Archive rename decisions require a target path".to_string()))?,
                    )
                } else {
                    if decision.target_path.is_some() {
                        return Err(ApiError::BadRequest(
                            "Only archive rename decisions may include a target path".to_string(),
                        ));
                    }
                    None
                };
                let mut checkpoint = decision_state
                    .checkpoint
                    .ok_or_else(|| ApiError::Internal("Archive extraction checkpoint is unavailable".to_string()))?;
                if matches!(decision.action, super::archive_sessions::ArchiveSessionDecisionAction::Rename) {
                    validate_local_extraction_rename_target(
                        decision_state
                            .archive_path
                            .as_deref()
                            .ok_or_else(|| ApiError::Internal("Archive extraction source is unavailable".to_string()))?,
                        &checkpoint,
                        &decision.member_path,
                        rename_target.ok_or_else(|| ApiError::Internal("Archive rename target is unavailable".to_string()))?,
                        is_directory,
                    )
                    .map_err(|_| {
                        ApiError::BadRequest("Archive rename target is invalid or conflicts with another archive member".to_string())
                    })?;
                }
                match decision.action {
                    super::archive_sessions::ArchiveSessionDecisionAction::Skip => {
                        checkpoint.resolve_collision(decision.member_path, LocalArchiveExtractionCollisionAction::Skip);
                    }
                    super::archive_sessions::ArchiveSessionDecisionAction::SkipAll => {
                        checkpoint.resolve_all_collisions(LocalArchiveExtractionCollisionAction::Skip);
                    }
                    super::archive_sessions::ArchiveSessionDecisionAction::Replace => {
                        checkpoint.resolve_collision(decision.member_path, LocalArchiveExtractionCollisionAction::Replace);
                    }
                    super::archive_sessions::ArchiveSessionDecisionAction::ReplaceAll => {
                        checkpoint.resolve_all_collisions(LocalArchiveExtractionCollisionAction::Replace);
                    }
                    super::archive_sessions::ArchiveSessionDecisionAction::ReplaceOlder => {
                        checkpoint.resolve_all_collisions(LocalArchiveExtractionCollisionAction::ReplaceOlder);
                    }
                    super::archive_sessions::ArchiveSessionDecisionAction::Rename => {
                        checkpoint.rename_member(
                            decision.member_path,
                            rename_target
                                .ok_or_else(|| ApiError::Internal("Archive rename target is unavailable".to_string()))?
                                .to_string(),
                        );
                    }
                    super::archive_sessions::ArchiveSessionDecisionAction::Retry => {}
                    super::archive_sessions::ArchiveSessionDecisionAction::Ignore => checkpoint.ignore_member_error(decision.member_path),
                }
                let execution_plan = binding
                    .execution_plan
                    .with_checkpoint(checkpoint.clone())
                    .map_err(map_local_archive_error)?;
                let (_, work, cancellation_requested, status) = state_store
                    .resume_extraction(drive, owner_origin, execution_id, expected_revision)
                    .await?;
                if !matches!(work, ArchiveSessionWork::Extraction { .. }) {
                    return Err(ApiError::conflict_message("Archive execution is not an extraction operation"));
                }
                Self::spawn_direct_local_extraction(
                    state_store,
                    execution_id.to_string(),
                    binding.drive_root,
                    binding.archive_path,
                    binding.destination_path,
                    cancellation_requested,
                    Some(execution_plan.into_checkpoint()),
                );
                Ok(status)
            }
            CompanionArchiveExtractionPlan::Relay { .. } => Err(ApiError::conflict_message(
                "Relay extraction decisions are owned by the paired archive operation".to_string(),
            )),
            CompanionArchiveExtractionPlan::RelayPreflightFailure { .. } => Err(ApiError::conflict_message(
                "Relay extraction preflight did not produce a resumable operation".to_string(),
            )),
            #[cfg(test)]
            CompanionArchiveExtractionPlan::DirectLocalDeferred { .. } => Err(ApiError::conflict_message(
                "Archive execution does not have a prepared direct-local extraction plan".to_string(),
            )),
        }
    }

    fn relay_result(result: CompanionArchiveExtractionResult) -> Result<ArchiveExtractionResponse, ApiError> {
        match result {
            CompanionArchiveExtractionResult::Relay(result) => Ok(result),
            CompanionArchiveExtractionResult::DirectLocalStarted => Err(ApiError::Internal(
                "Archive extraction topology did not produce a relay result".to_string(),
            )),
        }
    }
}

fn resolve_companion_extraction_coordinator(
    topology_plan: CompanionArchiveTopologyPlan,
    plan: CompanionArchiveExtractionPlan,
) -> Result<CompanionArchiveExtractionCoordinator, ApiError> {
    let binding_matches_topology = matches!(
        (
            topology_plan.kind,
            topology_plan.driver,
            topology_plan.topology,
            topology_plan.source_is_local,
            topology_plan.destination_is_local,
            topology_plan.binding,
            &plan,
        ),
        (
            CompanionArchiveOperationKind::Extract,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::LocalToLocal,
            true,
            Some(true),
            CompanionArchiveBinding::LocalToLocal,
            CompanionArchiveExtractionPlan::DirectLocal { .. }
        ) | (
            CompanionArchiveOperationKind::Extract,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::SmbToLocal,
            false,
            Some(true),
            CompanionArchiveBinding::SmbToLocalRelay,
            CompanionArchiveExtractionPlan::Relay { .. }
        ) | (
            CompanionArchiveOperationKind::Extract,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::LocalToSmb,
            true,
            Some(false),
            CompanionArchiveBinding::LocalToSmbRelay,
            CompanionArchiveExtractionPlan::Relay { .. }
        ) | (
            CompanionArchiveOperationKind::Extract,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::SmbToLocal,
            false,
            Some(true),
            CompanionArchiveBinding::SmbToLocalRelay,
            CompanionArchiveExtractionPlan::RelayPreflightFailure { .. }
        ) | (
            CompanionArchiveOperationKind::Extract,
            CompanionArchiveExecutionDriver::Companion,
            CompanionArchiveTopology::LocalToSmb,
            true,
            Some(false),
            CompanionArchiveBinding::LocalToSmbRelay,
            CompanionArchiveExtractionPlan::RelayPreflightFailure { .. }
        )
    );
    #[cfg(test)]
    let binding_matches_topology = binding_matches_topology
        || matches!(
            (
                topology_plan.kind,
                topology_plan.driver,
                topology_plan.topology,
                topology_plan.source_is_local,
                topology_plan.destination_is_local,
                topology_plan.binding,
                &plan,
            ),
            (
                CompanionArchiveOperationKind::Extract,
                CompanionArchiveExecutionDriver::Companion,
                CompanionArchiveTopology::LocalToLocal,
                true,
                Some(true),
                CompanionArchiveBinding::LocalToLocal,
                CompanionArchiveExtractionPlan::DirectLocalDeferred { .. }
            )
        );
    if binding_matches_topology {
        Ok(CompanionArchiveExtractionCoordinator { plan })
    } else {
        Err(ApiError::Internal(
            "Archive extraction topology did not resolve to a compatible Companion binding".to_string(),
        ))
    }
}

impl CompanionArchiveExtractionCoordinator {
    async fn execute_relay(
        relay: ArchiveExtractionRelay,
        binding: PreparedArchiveExtractionBinding,
    ) -> Result<ArchiveExtractionResponse, ApiError> {
        execute_archive_relay(
            async {
                match binding {
                    PreparedArchiveExtractionBinding::LocalArchiveToRemoteDestination {
                        archive_path,
                        archive_entries,
                        manifest,
                        operation,
                        execution_plan,
                    } => {
                        if operation.phase != "streaming" {
                            return archive_extraction_response_from_operation(operation);
                        }
                        let execution_plan = execution_plan
                            .ok_or_else(|| ApiError::Internal("Archive extraction relay execution plan is unavailable".to_string()))?;
                        if execution_plan.manifest() != &manifest {
                            return Err(ApiError::Internal(
                                "Archive extraction relay manifest does not match its execution plan".to_string(),
                            ));
                        }
                        extract_local_archive_to_smb_destination(&relay, archive_path, archive_entries, execution_plan).await
                    }
                    PreparedArchiveExtractionBinding::RemoteSourceToLocalDestination {
                        drive_root,
                        destination_path,
                        manifest,
                        operation,
                        execution_plan,
                    } => {
                        if operation.phase != "streaming" {
                            return archive_extraction_response_from_operation(operation);
                        }
                        let execution_plan = execution_plan
                            .ok_or_else(|| ApiError::Internal("Archive extraction relay execution plan is unavailable".to_string()))?;
                        if execution_plan.manifest() != &manifest {
                            return Err(ApiError::Internal(
                                "Archive extraction relay manifest does not match its execution plan".to_string(),
                            ));
                        }
                        extract_smb_archive_to_local_destination(&relay, drive_root, destination_path, operation, execution_plan).await
                    }
                }
            },
            relay.fail(),
        )
        .await
    }

    async fn execute_direct_local(
        state_store: Arc<ArchiveSessionManager>,
        execution_id: String,
        binding: DirectLocalExtractionBinding,
    ) -> Result<(), ApiError> {
        let (_, work, cancellation_requested, checkpoint) = state_store.start_state(&execution_id).await?;
        if !matches!(work, ArchiveSessionWork::Extraction { .. }) {
            return Err(ApiError::conflict_message("Archive execution is not an extraction operation"));
        }
        let checkpoint = checkpoint.unwrap_or_else(|| binding.execution_plan.checkpoint());
        Self::spawn_direct_local_extraction(
            state_store,
            execution_id,
            binding.drive_root,
            binding.archive_path,
            binding.destination_path,
            cancellation_requested,
            Some(checkpoint),
        );
        Ok(())
    }

    #[cfg(test)]
    async fn execute_direct_local_deferred(state_store: Arc<ArchiveSessionManager>, execution_id: String) -> Result<(), ApiError> {
        let (drive_root, work, cancellation_requested, checkpoint) = state_store.start_state(&execution_id).await?;
        let ArchiveSessionWork::Extraction {
            archive_path,
            destination_path,
        } = work
        else {
            return Err(ApiError::conflict_message("Archive execution is not an extraction operation"));
        };
        Self::spawn_direct_local_extraction(
            state_store,
            execution_id,
            drive_root,
            archive_path,
            destination_path,
            cancellation_requested,
            checkpoint,
        );
        Ok(())
    }

    fn spawn_direct_local_extraction(
        state_store: Arc<ArchiveSessionManager>,
        execution_id: String,
        drive_root: PathBuf,
        archive_path: PathBuf,
        destination_path: PathBuf,
        cancellation_requested: Arc<AtomicBool>,
        checkpoint: Option<super::archive::LocalArchiveExtractionCheckpoint>,
    ) {
        tokio::spawn(async move {
            let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
            let mut archive_task = tokio::task::spawn_blocking(move || {
                extract_local_archive_with_checkpoint_and_progress(
                    &drive_root,
                    &archive_path,
                    &destination_path,
                    checkpoint.unwrap_or_default(),
                    || cancellation_requested.load(Ordering::Acquire),
                    |progress| {
                        let _ = event_sender.send(DirectLocalExtractionWorkerEvent::Progress(ArchiveSessionProgress::Extraction(
                            progress,
                        )));
                    },
                )
                .map(|result| match result {
                    LocalArchiveExtractionRunResult::Completed(checkpoint) => ArchiveSessionCompletion::ExtractionCompleted {
                        result: checkpoint.result(),
                        checkpoint,
                    },
                    LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => {
                        ArchiveSessionCompletion::AwaitingCollision { checkpoint, collision }
                    }
                    LocalArchiveExtractionRunResult::AwaitingMemberError { checkpoint, error } => {
                        ArchiveSessionCompletion::AwaitingMemberError { checkpoint, error }
                    }
                })
            });
            let result = loop {
                tokio::select! {
                    Some(DirectLocalExtractionWorkerEvent::Progress(progress)) = event_receiver.recv() => {
                        state_store.update_progress(&execution_id, progress).await;
                    }
                    result = &mut archive_task => {
                        while let Ok(DirectLocalExtractionWorkerEvent::Progress(progress)) = event_receiver.try_recv() {
                            state_store.update_progress(&execution_id, progress).await;
                        }
                        break result
                            .map_err(|error| LocalArchiveError::Io(std::io::Error::other(format!("Archive execution task failed: {error}"))))
                            .and_then(|result| result);
                    }
                }
            };
            state_store.complete(&execution_id, result).await;
        });
    }
}

#[cfg(test)]
struct FixtureArchiveExtractionInvocation {
    relay: ArchiveExtractionRelay,
    binding: ArchiveExtractionAdapterBinding,
}

#[cfg(test)]
impl FixtureArchiveExtractionInvocation {
    async fn execute(self) -> Result<ArchiveExtractionResponse, ApiError> {
        let topology_plan = self.binding.topology_plan()?;
        let coordinator = match self.binding.prepare(&self.relay).await {
            Ok(binding) => CompanionArchiveExtractionCoordinator::relay(self.relay, binding),
            Err(error) => CompanionArchiveExtractionCoordinator::relay_preflight_failure(self.relay, error),
        };
        let result = resolve_companion_extraction_coordinator(topology_plan, coordinator.into_plan())?
            .execute()
            .await?;
        CompanionArchiveExtractionCoordinator::relay_result(result)
    }
}

async fn execute_relay_creation_to_local_destination(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    body: ArchiveV2RelayCreationLocalDestinationRequest,
) -> Result<Json<ArchiveCreationResponse>, ApiError> {
    let _contract_version = body.contract_version;
    match resolve_companion_archive_topology(CompanionArchiveOperationKind::Create, false, true)? {
        CompanionArchiveTopology::SmbToLocal => {}
        _ => {
            return Err(ApiError::Internal(
                "Archive topology resolution returned an invalid creation owner".to_string(),
            ))
        }
    }
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
    let result = resolve_companion_creation_coordinator(
        resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Create, false, true).map_err(map_local_archive_error)?,
        CompanionArchiveCreationCoordinator::relay(
            relay,
            PreparedArchiveCreationBinding::RemoteSourceToLocalDestination {
                manifest,
                drive_root,
                target_path,
            },
        )
        .into_plan(),
    )?
    .execute()
    .await?;
    let result = CompanionArchiveCreationCoordinator::relay_result(result)?;

    Ok(Json(result))
}

async fn execute_relay_creation_from_local_source(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    body: ArchiveV2RelayCreationLocalSourceRequest,
) -> Result<Json<ArchiveCreationResponse>, ApiError> {
    let _contract_version = body.contract_version;
    match resolve_companion_archive_topology(CompanionArchiveOperationKind::Create, true, false)? {
        CompanionArchiveTopology::LocalToSmb => {}
        _ => {
            return Err(ApiError::Internal(
                "Archive topology resolution returned an invalid creation owner".to_string(),
            ))
        }
    }
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
    let coordinator = match project_local_archive_creation_manifest(&entries).map_err(map_local_archive_error) {
        Ok(manifest) => CompanionArchiveCreationCoordinator::relay(
            relay,
            PreparedArchiveCreationBinding::LocalSourceToRemoteDestination { entries, manifest },
        ),
        Err(error) => CompanionArchiveCreationCoordinator::relay_preflight_failure(relay, error),
    };
    let result = resolve_companion_creation_coordinator(
        resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Create, true, false).map_err(map_local_archive_error)?,
        coordinator.into_plan(),
    )?
    .execute()
    .await?;
    let result = CompanionArchiveCreationCoordinator::relay_result(result)?;
    Ok(Json(result))
}

/// `POST /api/browse/{drive}/archive/v2/relay/creation` — run one scoped mixed creation operation.
pub async fn browse_relay_v2_archive_creation(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    ArchiveV2Json(body): ArchiveV2Json<ArchiveV2RelayCreationRequest>,
) -> Result<Json<ArchiveCreationResponse>, ArchiveV2Error> {
    match body {
        ArchiveV2RelayCreationRequest::LocalDestination(body) => {
            execute_relay_creation_to_local_destination(State(state), Path(drive), headers, body)
                .await
                .map_err(ArchiveV2Error::from)
        }
        ArchiveV2RelayCreationRequest::LocalSource(body) => {
            execute_relay_creation_from_local_source(State(state), Path(drive), headers, body)
                .await
                .map_err(ArchiveV2Error::from)
        }
    }
}

async fn create_local_archive_for_smb_destination(
    relay: &ArchiveCreationRelay,
    entries: Vec<LocalArchiveEntry>,
    manifest: ArchiveCreationManifest,
) -> Result<ArchiveCreationResponse, ApiError> {
    let mut creation_state = ArchiveCreationManifestState::new(manifest.clone());
    relay.begin_local_source(&manifest).await?;

    for (entry, manifest_entry) in entries.into_iter().zip(&manifest.entries) {
        let archive_path = manifest_entry.archive_path.clone();
        let source = if entry.is_directory {
            reqwest::Body::default()
        } else {
            super::archive::revalidate_local_archive_creation_source(&entry).map_err(map_local_archive_error)?;
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

/// Start a V2-pinned cancellable local archive execution.
async fn start_v2_local_archive_execution(
    state: Arc<AppState>,
    drive: String,
    headers: HeaderMap,
    body: ArchiveV2ExecutionStartRequest,
) -> Result<ArchiveExecutionResponse, ApiError> {
    let owner_origin = extract_origin(&headers)?;
    let execution = match body {
        ArchiveV2ExecutionStartRequest::Create {
            contract_version,
            source_paths,
            target_path,
        } => {
            require_archive_v2_contract_version(contract_version)?;
            match resolve_companion_archive_topology(CompanionArchiveOperationKind::Create, true, true)? {
                CompanionArchiveTopology::LocalToLocal => {}
                _ => {
                    return Err(ApiError::Internal(
                        "Archive topology resolution returned an invalid creation owner".to_string(),
                    ))
                }
            }
            let (base_path, source_paths, target_path) = resolve_local_archive_creation_request(&drive, &source_paths, &target_path)?;
            let preflight_sources = source_paths.clone();
            let preflight_target = target_path.clone();
            let entries = tokio::task::spawn_blocking(move || {
                build_local_archive_manifest_with_cancellation(&preflight_sources, &preflight_target, || false)
            })
            .await
            .map_err(|error| ApiError::Internal(format!("Local archive validation task failed: {error}")))?
            .map_err(map_local_archive_error)?;
            let execution_plan = LocalArchiveCreationExecutionPlan::from_entries(&entries).map_err(map_local_archive_error)?;
            state
                .archive_sessions
                .create_prepared_creation(
                    drive.clone(),
                    owner_origin.clone(),
                    base_path,
                    PreparedLocalArchiveCreation {
                        source_paths,
                        target_path,
                        entries,
                        execution_plan,
                    },
                )
                .await
        }
        ArchiveV2ExecutionStartRequest::Extract {
            contract_version,
            archive_path,
            destination_path,
        } => {
            require_archive_v2_contract_version(contract_version)?;
            match resolve_companion_archive_topology(CompanionArchiveOperationKind::Extract, true, true)? {
                CompanionArchiveTopology::LocalToLocal => {}
                _ => {
                    return Err(ApiError::Internal(
                        "Archive topology resolution returned an invalid extraction owner".to_string(),
                    ))
                }
            }
            let (base_path, archive_path, destination_path) =
                resolve_local_archive_extraction_request(&drive, &archive_path, &destination_path)?;
            let preflight_archive_path = archive_path.clone();
            let entries = tokio::task::spawn_blocking(move || validate_local_archive_extraction(&preflight_archive_path))
                .await
                .map_err(|error| ApiError::Internal(format!("Local archive validation task failed: {error}")))?
                .map_err(map_local_archive_error)?;
            let manifest = ArchiveExtractionManifest::from_entries(
                entries
                    .into_iter()
                    .map(|entry| ArchiveExtractionManifestMember {
                        path: entry.path,
                        is_directory: entry.is_directory,
                        uncompressed_size: entry.uncompressed_size,
                        modified_at: entry.modified_at,
                    })
                    .collect(),
            )
            .map_err(map_local_archive_error)?;
            let execution_plan =
                LocalArchiveExtractionExecutionPlan::from_manifest(manifest, Default::default()).map_err(map_local_archive_error)?;
            state
                .archive_sessions
                .create_prepared_extraction(
                    drive.clone(),
                    owner_origin.clone(),
                    base_path,
                    archive_path,
                    destination_path,
                    execution_plan,
                )
                .await
        }
    };
    match execution.kind {
        super::archive_sessions::ArchiveSessionKind::Create => {
            let result = resolve_companion_creation_coordinator(
                resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Create, true, true)
                    .map_err(map_local_archive_error)?,
                CompanionArchiveCreationCoordinator::direct_local_from_session(
                    state.archive_sessions.clone(),
                    execution.execution_id.clone(),
                )
                .await?
                .into_plan(),
            )?
            .execute()
            .await?;
            if !matches!(result, CompanionArchiveCreationResult::DirectLocalStarted) {
                return Err(ApiError::Internal(
                    "Archive creation topology did not start a direct-local session".to_string(),
                ));
            }
        }
        super::archive_sessions::ArchiveSessionKind::Extract => {
            let result = resolve_companion_extraction_coordinator(
                resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Extract, true, true)
                    .map_err(map_local_archive_error)?,
                CompanionArchiveExtractionCoordinator::direct_local_from_session(
                    state.archive_sessions.clone(),
                    execution.execution_id.clone(),
                )
                .await?
                .into_plan(),
            )?
            .execute()
            .await?;
            if !matches!(result, CompanionArchiveExtractionResult::DirectLocalStarted) {
                return Err(ApiError::Internal(
                    "Archive extraction topology did not start a direct-local session".to_string(),
                ));
            }
        }
    }
    let execution = state.archive_sessions.get(&drive, &owner_origin, &execution.execution_id).await?;
    Ok(archive_execution_response(execution))
}

/// `POST /api/browse/{drive}/archive/v2/executions` — start a V2 direct-local execution.
pub async fn browse_start_v2_archive_execution(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    ArchiveV2Json(body): ArchiveV2Json<ArchiveV2ExecutionStartRequest>,
) -> Result<Json<ArchiveExecutionResponse>, ArchiveV2Error> {
    Ok(Json(start_v2_local_archive_execution(state, drive, headers, body).await?))
}

/// `GET /api/browse/{drive}/archive/v2/executions/{execution_id}` — retrieve V2 local lifecycle state.
pub async fn browse_get_v2_archive_execution(
    State(state): State<Arc<AppState>>,
    Path((drive, execution_id)): Path<(String, String)>,
    headers: HeaderMap,
    _query: ArchiveV2NoQuery,
) -> Result<Json<ArchiveExecutionResponse>, ArchiveV2Error> {
    let execution = state
        .archive_sessions
        .get_v2(&drive, &extract_origin(&headers)?, &execution_id)
        .await?;
    let response = archive_execution_response(execution);
    Ok(Json(response))
}

/// Request cancellation at the next V2 local archive member boundary.
async fn cancel_v2_local_archive_execution(
    state: Arc<AppState>,
    drive: String,
    execution_id: String,
    headers: HeaderMap,
    expected_revision: u64,
) -> Result<ArchiveExecutionResponse, ApiError> {
    let execution = state
        .archive_sessions
        .cancel(&drive, &extract_origin(&headers)?, &execution_id, expected_revision)
        .await?;
    Ok(archive_execution_response(execution))
}

/// `POST /api/browse/{drive}/archive/v2/executions/{execution_id}/cancellation` — cancel a V2 local execution.
pub async fn browse_cancel_v2_archive_execution(
    State(state): State<Arc<AppState>>,
    Path((drive, execution_id)): Path<(String, String)>,
    headers: HeaderMap,
    ArchiveV2Json(body): ArchiveV2Json<ArchiveV2ExecutionCancellationRequest>,
) -> Result<Json<ArchiveExecutionResponse>, ArchiveV2Error> {
    let ArchiveV2ExecutionCancellationRequest {
        contract_version,
        expected_revision,
    } = body;
    require_archive_v2_contract_version(contract_version)?;
    Ok(Json(
        cancel_v2_local_archive_execution(state, drive, execution_id, headers, expected_revision).await?,
    ))
}

/// Apply a V2 decision to a paused local extraction execution.
async fn decide_v2_local_archive_execution(
    state: Arc<AppState>,
    drive: String,
    execution_id: String,
    headers: HeaderMap,
    body: ArchiveV2ExecutionDecisionRequest,
) -> Result<ArchiveExecutionResponse, ApiError> {
    let ArchiveV2ExecutionDecisionRequest {
        contract_version,
        expected_revision,
        member_path,
        action,
        target_path,
    } = body;
    require_archive_v2_contract_version(contract_version)?;
    let action = match action {
        ArchiveExecutionDecisionAction::Skip => super::archive_sessions::ArchiveSessionDecisionAction::Skip,
        ArchiveExecutionDecisionAction::SkipAll => super::archive_sessions::ArchiveSessionDecisionAction::SkipAll,
        ArchiveExecutionDecisionAction::Replace => super::archive_sessions::ArchiveSessionDecisionAction::Replace,
        ArchiveExecutionDecisionAction::ReplaceAll => super::archive_sessions::ArchiveSessionDecisionAction::ReplaceAll,
        ArchiveExecutionDecisionAction::ReplaceOlder => super::archive_sessions::ArchiveSessionDecisionAction::ReplaceOlder,
        ArchiveExecutionDecisionAction::Rename => super::archive_sessions::ArchiveSessionDecisionAction::Rename,
        ArchiveExecutionDecisionAction::Retry => super::archive_sessions::ArchiveSessionDecisionAction::Retry,
        ArchiveExecutionDecisionAction::Ignore => super::archive_sessions::ArchiveSessionDecisionAction::Ignore,
    };
    let execution = resolve_companion_extraction_coordinator(
        resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Extract, true, true).map_err(map_local_archive_error)?,
        CompanionArchiveExtractionCoordinator::direct_local_from_session(state.archive_sessions.clone(), execution_id.clone())
            .await?
            .into_plan(),
    )?
    .decide(
        &drive,
        &extract_origin(&headers)?,
        &execution_id,
        expected_revision,
        super::archive_sessions::ArchiveSessionDecision {
            member_path,
            action,
            target_path,
        },
    )
    .await?;
    Ok(archive_execution_response(execution))
}

/// `POST /api/browse/{drive}/archive/v2/executions/{execution_id}/decision` — decide a V2 local extraction pause.
pub async fn browse_decide_v2_archive_execution(
    State(state): State<Arc<AppState>>,
    Path((drive, execution_id)): Path<(String, String)>,
    headers: HeaderMap,
    ArchiveV2Json(body): ArchiveV2Json<ArchiveV2ExecutionDecisionRequest>,
) -> Result<Json<ArchiveExecutionResponse>, ArchiveV2Error> {
    Ok(Json(
        decide_v2_local_archive_execution(state, drive, execution_id, headers, body).await?,
    ))
}

async fn execute_relay_extraction_from_local_source(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    body: ArchiveV2RelayExtractionLocalSourceRequest,
) -> Result<Json<ArchiveExtractionResponse>, ApiError> {
    let _contract_version = body.contract_version;
    match resolve_companion_archive_topology(CompanionArchiveOperationKind::Extract, true, false)? {
        CompanionArchiveTopology::LocalToSmb => {}
        _ => {
            return Err(ApiError::Internal(
                "Archive topology resolution returned an invalid extraction owner".to_string(),
            ))
        }
    }
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
    let coordinator = match prepare_local_archive_extraction_relay_binding(&relay, archive_path, archive_entries).await {
        Ok(binding) => CompanionArchiveExtractionCoordinator::relay(relay, binding),
        Err(error) => CompanionArchiveExtractionCoordinator::relay_preflight_failure(relay, error),
    };
    let result = resolve_companion_extraction_coordinator(
        resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Extract, true, false).map_err(map_local_archive_error)?,
        coordinator.into_plan(),
    )?
    .execute()
    .await?;
    let result = CompanionArchiveExtractionCoordinator::relay_result(result)?;
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
    collision_policy: Option<String>,
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
    ArchiveExtractionRelayExecutionPlan::from_checkpoint_json(manifest, &operation.checkpoint_json)
        .map(|plan| plan.with_collision_policy(operation.collision_policy.clone()))
        .map_err(map_local_archive_error)
}

async fn prepare_local_archive_extraction_relay_binding(
    relay: &ArchiveExtractionRelay,
    archive_path: PathBuf,
    archive_entries: Vec<LocalArchiveReadEntry>,
) -> Result<PreparedArchiveExtractionBinding, ApiError> {
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
    let execution_plan = (operation.phase == "streaming")
        .then(|| archive_relay_extraction_plan(&operation, manifest.clone()))
        .transpose()?;
    Ok(PreparedArchiveExtractionBinding::LocalArchiveToRemoteDestination {
        archive_path,
        archive_entries,
        manifest,
        operation,
        execution_plan,
    })
}

async fn prepare_smb_archive_extraction_relay_binding(
    relay: &ArchiveExtractionRelay,
    drive_root: PathBuf,
    destination_path: PathBuf,
) -> Result<PreparedArchiveExtractionBinding, ApiError> {
    let mut relay_manifest: ArchiveRelayManifest = relay.begin().await?;
    relay_manifest.manifest = ArchiveExtractionManifest::from_entries(relay_manifest.manifest.entries).map_err(map_local_archive_error)?;
    let execution_plan = (relay_manifest.operation.phase == "streaming")
        .then(|| archive_relay_extraction_plan(&relay_manifest.operation, relay_manifest.manifest.clone()))
        .transpose()?;
    Ok(PreparedArchiveExtractionBinding::RemoteSourceToLocalDestination {
        drive_root,
        destination_path,
        manifest: relay_manifest.manifest,
        operation: relay_manifest.operation,
        execution_plan,
    })
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

async fn execute_relay_extraction_to_local_destination(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    body: ArchiveV2RelayExtractionLocalDestinationRequest,
) -> Result<Json<ArchiveExtractionResponse>, ApiError> {
    let _contract_version = body.contract_version;
    match resolve_companion_archive_topology(CompanionArchiveOperationKind::Extract, false, true)? {
        CompanionArchiveTopology::SmbToLocal => {}
        _ => {
            return Err(ApiError::Internal(
                "Archive topology resolution returned an invalid extraction owner".to_string(),
            ))
        }
    }
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
    let coordinator = match prepare_smb_archive_extraction_relay_binding(&relay, drive_root, destination_path).await {
        Ok(binding) => CompanionArchiveExtractionCoordinator::relay(relay, binding),
        Err(error) => CompanionArchiveExtractionCoordinator::relay_preflight_failure(relay, error),
    };
    let result = resolve_companion_extraction_coordinator(
        resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Extract, false, true).map_err(map_local_archive_error)?,
        coordinator.into_plan(),
    )?
    .execute()
    .await?;
    let result = CompanionArchiveExtractionCoordinator::relay_result(result)?;
    Ok(Json(result))
}

/// `POST /api/browse/{drive}/archive/v2/relay/extraction` — run one scoped mixed extraction operation.
pub async fn browse_relay_v2_archive_extraction(
    State(state): State<Arc<AppState>>,
    Path(drive): Path<String>,
    headers: HeaderMap,
    ArchiveV2Json(body): ArchiveV2Json<ArchiveV2RelayExtractionRequest>,
) -> Result<Json<ArchiveExtractionResponse>, ArchiveV2Error> {
    match body {
        ArchiveV2RelayExtractionRequest::LocalSource(body) => {
            execute_relay_extraction_from_local_source(State(state), Path(drive), headers, body)
                .await
                .map_err(ArchiveV2Error::from)
        }
        ArchiveV2RelayExtractionRequest::LocalDestination(body) => {
            execute_relay_extraction_to_local_destination(State(state), Path(drive), headers, body)
                .await
                .map_err(ArchiveV2Error::from)
        }
    }
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
                .pause_source_member_with_error_result(
                    &entry.path,
                    format!(
                        "Archive member size {member_bytes} does not match manifest size {}",
                        entry.uncompressed_size
                    ),
                    true,
                )
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
        "{server_url}/api/archive/v2/operations/{operation_id}/relay/{}",
        binding.operation_segment()
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
    let detail = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| value.get("detail").and_then(serde_json::Value::as_str).map(str::to_owned));
    let message = match detail {
        Some(detail) => format!("Archive relay could not {action}: backend returned HTTP {status}: {detail}"),
        None => format!("Archive relay could not {action}: backend returned HTTP {status}"),
    };
    match status {
        reqwest::StatusCode::CONFLICT => Err(ApiError::conflict_message(message)),
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => Err(ApiError::Forbidden(message)),
        reqwest::StatusCode::BAD_REQUEST | reqwest::StatusCode::UNPROCESSABLE_ENTITY => Err(ApiError::BadRequest(message)),
        _ => Err(ApiError::Internal(message)),
    }
}

fn is_archive_relay_cancellation(error: &ApiError) -> bool {
    match error {
        ApiError::Conflict(serde_json::Value::String(message))
        | ApiError::ConflictWithCode { message, .. }
        | ApiError::BadRequest(message)
        | ApiError::Internal(message)
        | ApiError::Forbidden(message) => message.contains("was cancelled"),
        _ => false,
    }
}

fn is_archive_relay_source_changed(error: &ApiError) -> bool {
    match error {
        ApiError::Conflict(serde_json::Value::String(message))
        | ApiError::ConflictWithCode { message, .. }
        | ApiError::BadRequest(message)
        | ApiError::Internal(message)
        | ApiError::Forbidden(message) => message.contains("source changed"),
        _ => false,
    }
}

fn is_archive_relay_collision(error: &ApiError) -> bool {
    match error {
        ApiError::Conflict(serde_json::Value::String(message)) | ApiError::ConflictWithCode { message, .. } => {
            message.contains("output already exists")
        }
        _ => false,
    }
}

fn is_archive_relay_transport_failure(error: &ApiError) -> bool {
    match error {
        ApiError::Conflict(serde_json::Value::String(message))
        | ApiError::ConflictWithCode { message, .. }
        | ApiError::BadRequest(message)
        | ApiError::BadRequestWithCode { message, .. }
        | ApiError::Internal(message)
        | ApiError::InternalWithCode { message, .. }
        | ApiError::Forbidden(message)
        | ApiError::ForbiddenWithCode { message, .. } => message.contains("HTTP"),
        ApiError::Io(_) => true,
        _ => false,
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

fn resolve_local_archive_extraction_request(
    drive: &str,
    archive_path: &str,
    destination_path: &str,
) -> Result<(PathBuf, PathBuf, PathBuf), ApiError> {
    if archive_path.trim().is_empty() || destination_path.trim().is_empty() {
        return Err(ApiError::BadRequest("Archive and destination paths are required".to_string()));
    }
    let base_path = drives::resolve_drive_path(drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let archive_path = resolve_safe_path(&base_path, drive, archive_path)?;
    let destination_path = resolve_safe_path_for_new(&base_path, drive, destination_path)?;
    Ok((base_path, archive_path, destination_path))
}

fn resolve_local_archive_creation_request(
    drive: &str,
    source_paths: &[String],
    target_path: &str,
) -> Result<(PathBuf, Vec<PathBuf>, PathBuf), ApiError> {
    if source_paths.is_empty() || target_path.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Archive creation requires source paths and a target path".to_string(),
        ));
    }
    let base_path = drives::resolve_drive_path(drive).ok_or_else(|| ApiError::NotFound(format!("Unknown drive: {drive}")))?;
    let source_paths = source_paths
        .iter()
        .map(|source_path| resolve_safe_path(&base_path, drive, source_path))
        .collect::<Result<Vec<_>, _>>()?;
    let target_path = resolve_safe_path_for_new(&base_path, drive, target_path)?;
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
        contract_version: execution.contract_version,
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
            Some(error) => ArchiveExecutionPendingDecision::MemberError {
                kind: "member_error",
                member_path: pending.member_path,
                target_path: error.target_path,
                message: error.message,
                partial_output: error.partial_output,
                allowed_actions: vec!["retry".to_string(), "ignore".to_string()],
            },
            None => ArchiveExecutionPendingDecision::ExistingFiles {
                kind: "existing_files",
                conflicts: vec![super::models::ArchiveExecutionConflict {
                    member_path: pending.member_path.clone(),
                    target_path: pending.target_path.unwrap_or(pending.member_path),
                    is_directory: pending.is_directory,
                }],
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
        archive_creation_response, archive_execution_response, browse_list_archive, build_file_info, build_pair_status_response,
        classify_link_target, execute_archive_relay, inspection_resolver_call_count, map_local_archive_error,
        normalize_drive_relative_path, normalize_windows_display_path, relay_completed_members, reset_inspection_resolver_call_count,
        resolve_companion_archive_topology, resolve_companion_creation_coordinator, resolve_companion_extraction_coordinator,
        resolve_companion_inspection_coordinator, resolve_drive_relative_source_path, resolve_link_target_metadata,
        resolve_local_archive_inspection_coordinator, resolve_pair_cancel_origin, resolve_pair_confirm_origin, resolve_pair_status_origin,
        resolve_safe_path, source_link_kind, validate_editor_write_target, viewer_archive_member, ArchiveCreationAdapterBinding,
        ArchiveCreationMemberCompletion, ArchiveCreationRelay, ArchiveExtractionAdapterBinding, ArchiveExtractionCollision,
        ArchiveExtractionMemberCompletion, ArchiveExtractionMemberError, ArchiveExtractionRelay, ArchiveExtractionSummary,
        ArchiveListQuery, ArchiveMemberQuery, ArchiveRelayBinding, ArchiveRelayDestinationStatus, ArchiveRelayFailure,
        ArchiveRelayOperation, ArchiveRelayTransport, CompanionArchiveCreationPlan, CompanionArchiveExtractionPlan,
        FixtureArchiveCreationInvocation, FixtureArchiveExtractionInvocation, ARCHIVE_RELAY_ACKNOWLEDGEMENT_ATTEMPTS,
        INSPECTION_RESOLVER_TEST_LOCK,
    };
    use crate::server::archive::{
        build_local_archive_manifest, build_local_archive_manifest_for_remote_target, create_local_archive,
        resolve_companion_archive_inspection_topology_plan, resolve_companion_archive_topology_plan, validate_local_archive_extraction,
        ArchiveCreationManifest, ArchiveCreationManifestMember, ArchiveDirectoryListingPresentation, ArchiveInspectionPlan,
        ArchiveInspectionPresentation, CompanionArchiveBinding, CompanionArchiveExecutionDriver, CompanionArchiveOperationKind,
        CompanionArchiveTopology, CompanionArchiveTopologyPlan, LocalArchiveCreationResult, LocalArchiveEntry, LocalArchiveError,
        LocalArchiveExtractionMemberError, LocalArchiveExtractionResult, LocalArchiveInspectionSource, LocalArchiveReadEntry,
        LocalArchiveReadError, ARCHIVE_INLINE_PREVIEW_MAX_BYTES,
    };
    use crate::server::archive_sessions::{
        ArchiveSessionKind, ArchiveSessionManager, ArchiveSessionPendingDecision, ArchiveSessionPhase, ArchiveSessionProgress,
        ArchiveSessionStatus,
    };
    use crate::server::errors::{ApiError, LOCAL_ARCHIVE_CREATION_PARTIAL_CODE, LOCAL_ARCHIVE_EXTRACTION_PARTIAL_CODE};
    use crate::server::models::{
        ArchiveContractVersion, ArchiveCreationResponse, ArchiveExtractionResponse, FileType, LinkKind, LinkTargetState, LinkTargetType,
        PublicPairingStatus,
    };
    use crate::server::pairing::PairingState;
    use axum::body::to_bytes;
    use axum::extract::{Path, Query, State};
    use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri};
    use axum::response::IntoResponse;
    use std::collections::VecDeque;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::{oneshot, Mutex};
    const NONCE_A: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    fn relay_control_payload_example(name: &str) -> serde_json::Value {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/relay-control-payloads-v2.json"
        ))
        .expect("relay control payload fixture should be valid JSON");
        assert_eq!(fixture["version"], 2);
        fixture["payloads"]
            .as_array()
            .expect("relay control payload fixture should contain payloads")
            .iter()
            .find(|payload| payload["name"] == name)
            .unwrap_or_else(|| panic!("relay control payload fixture should define {name}"))["example"]
            .clone()
    }

    fn expected_topology_trace(case_name: &str) -> serde_json::Value {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        fixture["cases"]
            .as_array()
            .expect("topology trace fixture should define cases")
            .iter()
            .find(|case| case["name"] == case_name)
            .unwrap_or_else(|| panic!("topology trace fixture should define {case_name}"))["expected_trace"]
            .clone()
    }

    #[test]
    fn companion_topology_fixtures_resolve_through_the_production_plan() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        for case in fixture["cases"]
            .as_array()
            .expect("topology trace fixture should define cases")
            .iter()
            .chain(
                fixture["trajectory_cases"]
                    .as_array()
                    .expect("topology trace fixture should define trajectory cases"),
            )
        {
            let (source_is_local, destination_is_local, expected_topology) =
                match case["topology"].as_str().expect("fixture topology must be a string") {
                    "local_to_local" => (true, true, CompanionArchiveTopology::LocalToLocal),
                    "smb_to_local" => (false, true, CompanionArchiveTopology::SmbToLocal),
                    "local_to_smb" => (true, false, CompanionArchiveTopology::LocalToSmb),
                    "smb_to_smb" => continue,
                    topology => panic!("unsupported fixture topology {topology}"),
                };
            let kind = match case["operation"].as_str().expect("fixture operation must be a string") {
                "create" => CompanionArchiveOperationKind::Create,
                "extract" => CompanionArchiveOperationKind::Extract,
                operation => panic!("unsupported fixture operation {operation}"),
            };
            assert_eq!(
                resolve_companion_archive_topology(kind, source_is_local, destination_is_local).unwrap(),
                expected_topology
            );
        }
    }

    #[test]
    fn companion_inspection_resolver_accepts_only_a_local_inspection_plan() {
        let _resolver_test_guard = INSPECTION_RESOLVER_TEST_LOCK
            .lock()
            .expect("inspection resolver test lock should not be poisoned");
        let directory = tempfile::tempdir().expect("temporary archive directory should be created");
        let source = directory.path().join("source.txt");
        let target = directory.path().join("archive.zip");
        std::fs::write(&source, b"source").expect("source file should be written");
        let entries = build_local_archive_manifest(&[source], &target).expect("archive manifest should be built");
        create_local_archive(directory.path(), &target, &entries, || false).expect("archive should be created");

        let coordinator = resolve_local_archive_inspection_coordinator(
            target.clone(),
            ArchiveInspectionPresentation::DirectoryListing(ArchiveDirectoryListingPresentation::new(
                "archive.zip".to_string(),
                0,
                None,
                String::new(),
                None,
                10,
            )),
        )
        .expect("local inspection route binding should resolve");
        assert_eq!(coordinator.directory_listing().expect("directory listing should succeed").total, 1);

        let plan = ArchiveInspectionPlan::from_local_source(
            LocalArchiveInspectionSource::from_archive_path(target),
            ArchiveInspectionPresentation::DirectoryListing(ArchiveDirectoryListingPresentation::new(
                "archive.zip".to_string(),
                0,
                None,
                String::new(),
                None,
                10,
            )),
        )
        .expect("inspection plan should be built");
        let inspection_topology =
            resolve_companion_archive_inspection_topology_plan(true).expect("local inspection topology should resolve");
        assert_eq!(inspection_topology.kind, CompanionArchiveOperationKind::Inspect);
        assert_eq!(inspection_topology.driver, CompanionArchiveExecutionDriver::Companion);
        assert_eq!(inspection_topology.topology, CompanionArchiveTopology::LocalInspection);
        assert!(inspection_topology.source_is_local);
        assert_eq!(inspection_topology.destination_is_local, None);
        assert_eq!(inspection_topology.binding, CompanionArchiveBinding::LocalInspection);
        let incompatible_binding = CompanionArchiveTopologyPlan {
            binding: CompanionArchiveBinding::LocalToLocal,
            ..inspection_topology
        };
        assert!(resolve_companion_inspection_coordinator(incompatible_binding, plan.clone()).is_err());
        let create_topology = resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Create, true, true)
            .expect("creation topology should resolve");
        assert!(resolve_companion_inspection_coordinator(create_topology, plan).is_err());
        assert!(resolve_companion_archive_inspection_topology_plan(false).is_err());
    }

    #[test]
    fn companion_operation_resolvers_reject_incomplete_topology_contracts() {
        let state_store = Arc::new(ArchiveSessionManager::new());
        let creation_plan = CompanionArchiveCreationPlan::DirectLocalDeferred {
            state_store: state_store.clone(),
            execution_id: "creation".to_string(),
        };
        let extraction_plan = CompanionArchiveExtractionPlan::DirectLocalDeferred {
            state_store,
            execution_id: "extraction".to_string(),
        };
        let creation_topology = resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Create, true, true)
            .expect("creation topology should resolve");
        let extraction_topology = resolve_companion_archive_topology_plan(CompanionArchiveOperationKind::Extract, true, true)
            .expect("extraction topology should resolve");

        assert!(resolve_companion_creation_coordinator(
            CompanionArchiveTopologyPlan {
                binding: CompanionArchiveBinding::LocalToSmbRelay,
                ..creation_topology
            },
            creation_plan,
        )
        .is_err());
        assert!(resolve_companion_extraction_coordinator(
            CompanionArchiveTopologyPlan {
                source_is_local: false,
                ..extraction_topology
            },
            extraction_plan,
        )
        .is_err());
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn companion_archive_inspection_routes_invoke_the_production_resolver() {
        let _resolver_test_guard = INSPECTION_RESOLVER_TEST_LOCK
            .lock()
            .expect("inspection resolver test lock should not be poisoned");
        reset_inspection_resolver_call_count();
        let directory = tempfile::tempdir().expect("temporary archive directory should be created");
        let source = directory.path().join("source.txt");
        let target = directory.path().join("archive.zip");
        std::fs::write(&source, b"source").expect("source file should be written");
        let entries = build_local_archive_manifest(&[source], &target).expect("archive manifest should be built");
        create_local_archive(directory.path(), &target, &entries, || false).expect("archive should be created");
        let drive_id = format!("test-drive-{}", uuid::Uuid::new_v4());
        crate::server::drives::register_test_drive_path(drive_id.clone(), directory.path().to_path_buf());
        let archive_path = "archive.zip".to_string();

        let listing = browse_list_archive(
            Path(drive_id.clone()),
            Query(ArchiveListQuery {
                archive_path: archive_path.clone(),
                virtual_path: None,
                cursor: None,
                page_size: Some(10),
            }),
        )
        .await
        .expect("archive listing route should succeed");
        assert_eq!(listing.0.items[0].name, "source.txt");
        assert_eq!(inspection_resolver_call_count(), 1);

        let member_response = viewer_archive_member(
            Path(drive_id.clone()),
            Query(ArchiveMemberQuery {
                archive_path: archive_path.clone(),
                member_path: "source.txt".to_string(),
                download: false,
            }),
        )
        .await
        .expect("archive member route should succeed");
        assert_eq!(member_response.headers()["content-type"], "text/plain");
        assert_eq!(to_bytes(member_response.into_body(), usize::MAX).await.unwrap(), "source");
        assert_eq!(inspection_resolver_call_count(), 2);

        let invalid_cursor = browse_list_archive(
            Path(drive_id.clone()),
            Query(ArchiveListQuery {
                archive_path: archive_path.clone(),
                virtual_path: None,
                cursor: Some("not-a-cursor".to_string()),
                page_size: Some(10),
            }),
        )
        .await
        .expect_err("invalid archive cursor should be rejected");
        assert!(matches!(invalid_cursor, ApiError::BadRequest(message) if message.contains("cursor is invalid")));
        assert_eq!(inspection_resolver_call_count(), 3);

        let missing_member = viewer_archive_member(
            Path(drive_id.clone()),
            Query(ArchiveMemberQuery {
                archive_path: archive_path.clone(),
                member_path: "missing.txt".to_string(),
                download: false,
            }),
        )
        .await
        .expect_err("unknown archive member should be rejected");
        assert!(matches!(missing_member, ApiError::BadRequest(message) if message.contains("member was not found")));
        assert_eq!(inspection_resolver_call_count(), 4);

        let unavailable_target = directory.path().join("unavailable.zip");
        std::fs::copy(&target, &unavailable_target).expect("archive should be copied for codec mutation");
        mark_zip_member_codec_unavailable(&unavailable_target);
        let unavailable_member = viewer_archive_member(
            Path(drive_id.clone()),
            Query(ArchiveMemberQuery {
                archive_path: "unavailable.zip".to_string(),
                member_path: "source.txt".to_string(),
                download: false,
            }),
        )
        .await
        .expect_err("unavailable archive member should be rejected");
        assert!(matches!(unavailable_member, ApiError::BadRequest(message) if message.contains("unavailable codec")));
        assert_eq!(inspection_resolver_call_count(), 5);

        let encrypted_target = directory.path().join("encrypted.zip");
        std::fs::copy(&target, &encrypted_target).expect("archive should be copied for encryption mutation");
        mark_zip_member_encrypted(&encrypted_target);
        let encrypted_member = viewer_archive_member(
            Path(drive_id.clone()),
            Query(ArchiveMemberQuery {
                archive_path: "encrypted.zip".to_string(),
                member_path: "source.txt".to_string(),
                download: false,
            }),
        )
        .await
        .expect_err("encrypted archive member should be rejected");
        assert!(matches!(encrypted_member, ApiError::BadRequest(message) if message.contains("blocked feature")));
        assert_eq!(inspection_resolver_call_count(), 6);

        let large_source = directory.path().join("large.txt");
        let large_target = directory.path().join("large.zip");
        std::fs::write(&large_source, vec![b'x'; (ARCHIVE_INLINE_PREVIEW_MAX_BYTES + 1) as usize])
            .expect("large source file should be written");
        let large_entries = build_local_archive_manifest(&[large_source], &large_target).expect("large archive manifest should be built");
        create_local_archive(directory.path(), &large_target, &large_entries, || false).expect("large archive should be created");
        let oversized_preview = viewer_archive_member(
            Path(drive_id),
            Query(ArchiveMemberQuery {
                archive_path: "large.zip".to_string(),
                member_path: "large.txt".to_string(),
                download: false,
            }),
        )
        .await
        .expect_err("oversized archive preview should be rejected");
        assert!(matches!(oversized_preview, ApiError::PayloadTooLarge(message) if message.contains("inline preview size limit")));
        assert_eq!(inspection_resolver_call_count(), 7);
    }

    fn mark_zip_member_codec_unavailable(archive_path: &std::path::Path) {
        update_zip_member_header_u16(archive_path, 8, 10, 99);
    }

    fn mark_zip_member_encrypted(archive_path: &std::path::Path) {
        update_zip_member_header_u16(archive_path, 6, 8, 1);
    }

    fn update_zip_member_header_u16(
        archive_path: &std::path::Path,
        local_header_offset: usize,
        central_directory_offset: usize,
        value: u16,
    ) {
        const LOCAL_HEADER: &[u8; 4] = b"PK\x03\x04";
        const CENTRAL_DIRECTORY_HEADER: &[u8; 4] = b"PK\x01\x02";

        let mut archive = std::fs::read(archive_path).expect("archive should be readable for codec mutation");
        for offset in 0..archive.len().saturating_sub(3) {
            let signature = &archive[offset..offset + 4];
            let method_offset = if signature == LOCAL_HEADER {
                offset + local_header_offset
            } else if signature == CENTRAL_DIRECTORY_HEADER {
                offset + central_directory_offset
            } else {
                continue;
            };
            archive[method_offset..method_offset + 2].copy_from_slice(&value.to_le_bytes());
        }
        std::fs::write(archive_path, archive).expect("mutated archive should be written");
    }

    #[derive(Clone)]
    struct FixtureRelayServer {
        url: String,
        playback: Arc<Mutex<FixtureRelayPlayback>>,
    }

    struct FixtureRelayPlayback {
        remaining: VecDeque<serde_json::Value>,
        expected_traffic: Vec<serde_json::Value>,
        expected_responses: Vec<serde_json::Value>,
        observed_traffic: Vec<serde_json::Value>,
        observed_responses: Vec<serde_json::Value>,
    }

    impl FixtureRelayServer {
        async fn assert_consumed(&self) {
            let playback = self.playback.lock().await;
            assert!(playback.remaining.is_empty(), "fixture relay playback has unconsumed responses");
            assert_eq!(playback.observed_traffic.len(), playback.expected_traffic.len());
            assert!(
                playback
                    .expected_traffic
                    .iter()
                    .zip(&playback.observed_traffic)
                    .all(|(expected, observed)| fixture_request_matches(expected, observed)),
                "fixture relay traffic must match every static request definition"
            );
            assert_eq!(playback.observed_responses, playback.expected_responses);
        }
    }

    fn fixture_request_matches(expected: &serde_json::Value, observed: &serde_json::Value) -> bool {
        ["method", "path", "query", "body"]
            .iter()
            .all(|field| expected[*field] == "*" || expected[*field] == observed[*field])
    }

    async fn fixture_relay_handler(
        State(playback): State<Arc<Mutex<FixtureRelayPlayback>>>,
        method: Method,
        uri: Uri,
        body: axum::body::Bytes,
    ) -> axum::response::Response {
        let json_body = serde_json::from_slice::<serde_json::Value>(&body)
            .ok()
            .filter(serde_json::Value::is_object);
        let observed = serde_json::json!({
            "method": method.as_str(),
            "path": uri.path(),
            "query": uri.query(),
            "body": if body.is_empty() {
                "empty"
            } else if json_body.is_some() {
                "json"
            } else {
                "bytes"
            },
            "json": json_body,
        });
        let step = {
            let mut playback = playback.lock().await;
            playback.observed_traffic.push(observed.clone());
            playback.remaining.pop_front()
        };
        let Some(step) = step else {
            return (StatusCode::INTERNAL_SERVER_ERROR, "unexpected relay request").into_response();
        };
        if !fixture_request_matches(&step["request"], &observed) {
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
        {
            let mut playback = playback.lock().await;
            playback.observed_responses.push(response.clone());
        }
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
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        let case = fixture["cases"]
            .as_array()
            .expect("topology trace fixture should define cases")
            .iter()
            .find(|case| case["name"] == case_name)
            .unwrap_or_else(|| panic!("topology trace fixture should define {case_name}"));
        spawn_fixture_relay_playback(
            case["relay_playback"]
                .as_array()
                .unwrap_or_else(|| panic!("topology trace fixture should define relay playback for {case_name}"))
                .clone(),
        )
        .await
    }

    async fn spawn_fixture_relay_playback(steps: Vec<serde_json::Value>) -> FixtureRelayServer {
        let playback = Arc::new(Mutex::new(FixtureRelayPlayback {
            expected_traffic: steps.iter().map(|step| step["request"].clone()).collect(),
            expected_responses: steps.iter().map(|step| step["response"].clone()).collect(),
            remaining: steps.into(),
            observed_traffic: Vec::new(),
            observed_responses: Vec::new(),
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

    fn mixed_creation_trajectory_cases() -> Vec<serde_json::Value> {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        fixture["trajectory_cases"]
            .as_array()
            .expect("topology trace fixture should define trajectory cases")
            .iter()
            .filter(|case| case["operation"] == "create" && matches!(case["topology"].as_str(), Some("smb_to_local" | "local_to_smb")))
            .cloned()
            .collect()
    }

    fn segmented_mixed_extraction_trajectory_cases() -> Vec<serde_json::Value> {
        let topology_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        assert_eq!(
            topology_fixture["segmented_mixed_extraction_trajectory_fixture"],
            "segmented-mixed-extraction-trajectories-v2.json"
        );
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/segmented-mixed-extraction-trajectories-v2.json"
        ))
        .expect("segmented mixed extraction fixture should be valid JSON");
        assert_eq!(fixture["version"], 2);
        fixture["cases"]
            .as_array()
            .expect("segmented mixed extraction fixture should define cases")
            .clone()
    }

    fn segmented_mixed_extraction_trace(
        trajectory: &serde_json::Value,
        phase_transitions: Vec<String>,
        result: Option<&ArchiveExtractionResponse>,
        error_category: Option<&str>,
    ) -> serde_json::Value {
        serde_json::json!({
            "owner": "companion",
            "manifest_snapshot": trajectory["expected_trace"]["manifest_snapshot"].clone(),
            "phase_transitions": phase_transitions,
            "pending_decision": null,
            "member_outcomes": if error_category.is_some() {
                serde_json::json!([])
            } else {
                trajectory["expected_trace"]["member_outcomes"].clone()
            },
            "terminal_summary": result.map(|result| serde_json::json!({
                "files_extracted": result.files_extracted,
                "files_skipped": result.files_skipped,
                "extracted_bytes": result.extracted_bytes,
            })),
            "error_category": error_category,
        })
    }

    fn creation_corpus_scenario(name: &str) -> serde_json::Value {
        let corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/creation-trajectory-scenarios-v2.json"
        ))
        .expect("creation trajectory corpus should be valid JSON");
        corpus["scenarios"]
            .as_array()
            .expect("creation corpus should define scenarios")
            .iter()
            .find(|scenario| scenario["name"] == name)
            .unwrap_or_else(|| panic!("creation corpus should define {name}"))
            .clone()
    }

    fn mixed_creation_trace(manifest: &ArchiveCreationManifest, result: &ArchiveCreationResponse) -> serde_json::Value {
        serde_json::json!({
            "owner": "companion",
            "manifest_snapshot": manifest.entries.iter().map(|entry| entry.archive_path.as_str()).collect::<Vec<_>>(),
            "phase_transitions": ["streaming", "completed"],
            "pending_decision": null,
            "member_outcomes": manifest.entries.iter().map(|entry| entry.archive_path.as_str()).collect::<Vec<_>>(),
            "terminal_summary": {
                "files_created": result.files_created,
                "directories_created": result.directories_created,
                "source_bytes": result.source_bytes,
            },
            "error_category": null,
        })
    }

    fn mixed_creation_failure_trace(manifest: &ArchiveCreationManifest, error_category: &str) -> serde_json::Value {
        serde_json::json!({
            "owner": "companion",
            "manifest_snapshot": manifest.entries.iter().map(|entry| entry.archive_path.as_str()).collect::<Vec<_>>(),
            "phase_transitions": ["streaming", if error_category == "cancelled" { "cancelled" } else { "failed" }],
            "pending_decision": null,
            "member_outcomes": [],
            "terminal_summary": null,
            "error_category": error_category,
        })
    }

    fn mixed_extraction_trace(manifest_snapshot: &str, member_outcome: &str, result: &ArchiveExtractionResponse) -> serde_json::Value {
        serde_json::json!({
            "owner": "companion",
            "manifest_snapshot": [manifest_snapshot],
            "phase_transitions": ["streaming", "completed"],
            "pending_decision": null,
            "member_outcomes": [member_outcome],
            "terminal_summary": {
                "files_extracted": result.files_extracted,
                "files_skipped": result.files_skipped,
                "extracted_bytes": result.extracted_bytes,
            },
            "error_category": null,
        })
    }

    fn mixed_extraction_paused_trace(
        manifest_snapshot: &str,
        result: &ArchiveExtractionResponse,
        error_category: Option<&str>,
    ) -> serde_json::Value {
        let pending_decision = result
            .pending_decision_json
            .as_deref()
            .and_then(|decision| serde_json::from_str::<serde_json::Value>(decision).ok())
            .and_then(|decision| decision["kind"].as_str().map(str::to_string))
            .expect("paused extraction result should include a pending decision kind");
        serde_json::json!({
            "owner": "companion",
            "manifest_snapshot": [manifest_snapshot],
            "phase_transitions": ["streaming", result.phase],
            "pending_decision": pending_decision,
            "member_outcomes": [],
            "terminal_summary": null,
            "error_category": error_category,
        })
    }

    fn mixed_extraction_failure_trace(manifest_snapshot: &[&str], error_category: &str) -> serde_json::Value {
        serde_json::json!({
            "owner": "companion",
            "manifest_snapshot": manifest_snapshot,
            "phase_transitions": ["streaming", "failed"],
            "pending_decision": null,
            "member_outcomes": [],
            "terminal_summary": null,
            "error_category": error_category,
        })
    }

    fn mixed_relay_error_category(error: &ApiError) -> &'static str {
        let message = match error {
            ApiError::Conflict(serde_json::Value::String(message)) => message.clone(),
            ApiError::ConflictWithCode { message, .. }
            | ApiError::BadRequest(message)
            | ApiError::BadRequestWithCode { message, .. }
            | ApiError::Internal(message)
            | ApiError::InternalWithCode { message, .. }
            | ApiError::Forbidden(message)
            | ApiError::ForbiddenWithCode { message, .. } => message.clone(),
            _ => error.to_string(),
        };
        if message.contains("was cancelled") {
            "cancelled"
        } else if message.contains("source changed") {
            "source_changed"
        } else if message.contains("partial") || message.contains("incomplete output") {
            "partial_write"
        } else if message.contains("output already exists") {
            "collision"
        } else if message.contains("HTTP") {
            "transport_failure"
        } else {
            "invalid_input"
        }
    }

    #[test]
    fn topology_trace_fixture_assigns_mixed_execution_to_companion_relay_coordinators() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        assert_eq!(fixture["version"], 2);
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
        let fixture_cases = fixture["cases"].as_array().expect("topology trace fixture should define cases");
        let required_mixed_extraction_faults = [
            "malformed_input",
            "collision",
            "partial_write",
            "cancellation",
            "source_changed",
            "transport_failure",
        ];
        for topology in ["smb_to_local", "local_to_smb"] {
            let declared_faults = fixture_cases
                .iter()
                .filter(|case| case["operation"] == "extract" && case["topology"] == topology)
                .filter_map(|case| case["fault"].as_str())
                .collect::<std::collections::HashSet<_>>();
            assert!(required_mixed_extraction_faults.iter().all(|fault| declared_faults.contains(fault)));
        }
        let creation_corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/creation-trajectory-scenarios-v2.json"
        ))
        .expect("creation trajectory corpus should be valid JSON");
        let extraction_corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/extraction-trajectory-scenarios-v2.json"
        ))
        .expect("extraction trajectory corpus should be valid JSON");
        let corpus_scenarios = [("create", &creation_corpus), ("extract", &extraction_corpus)];
        for (operation, corpus) in corpus_scenarios {
            let expected_scenarios = corpus["scenarios"]
                .as_array()
                .expect("trajectory corpus should define scenarios")
                .iter()
                .filter_map(|scenario| scenario["name"].as_str())
                .collect::<std::collections::HashSet<_>>();
            for topology in ["local_to_local", "smb_to_local", "local_to_smb"] {
                let declared_scenarios = fixture["trajectory_cases"]
                    .as_array()
                    .expect("topology trace fixture should define trajectory cases")
                    .iter()
                    .filter(|case| case["operation"] == operation && case["topology"] == topology)
                    .filter_map(|case| case["scenario"].as_str())
                    .collect::<std::collections::HashSet<_>>();
                assert_eq!(declared_scenarios, expected_scenarios);
            }
        }
    }

    #[test]
    fn v2_relay_binding_fixture_matches_companion_route_bindings() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v2/fixtures/relay-bindings-v2.json"))
                .expect("relay binding fixture should be valid JSON");
        assert_eq!(fixture["version"], 2);
        assert_eq!(
            fixture["bindings"],
            serde_json::json!([
                {
                    "purpose": ArchiveRelayBinding::LocalZipToSmbExtract.capability_purpose(),
                    "kind": "extract",
                    "source": "local",
                    "destination": "smb",
                },
                {
                    "purpose": ArchiveRelayBinding::SmbZipToLocalExtract.capability_purpose(),
                    "kind": "extract",
                    "source": "smb",
                    "destination": "local",
                },
                {
                    "purpose": ArchiveRelayBinding::SmbToLocalZipCreate.capability_purpose(),
                    "kind": "create",
                    "source": "smb",
                    "destination": "local",
                },
                {
                    "purpose": ArchiveRelayBinding::LocalToSmbZipCreate.capability_purpose(),
                    "kind": "create",
                    "source": "local",
                    "destination": "smb",
                },
            ])
        );
    }

    #[tokio::test]
    async fn archive_relay_transport_interoperates_with_fastapi_when_configured() {
        let serialized_cases = match std::env::var("SAMBEE_ARCHIVE_RELAY_INTEROP_CASES") {
            Ok(value) => value,
            Err(_) => return,
        };
        let cases: Vec<serde_json::Value> = serde_json::from_str(&serialized_cases).expect("interop cases should be valid JSON");
        assert_eq!(cases.len(), 4, "interop fixture must cover every mixed V2 relay binding");

        for case in &cases {
            let relay_url = case["relay_url"].as_str().expect("interop case must define a relay URL");
            let token = case["token"].as_str().expect("interop case must define a capability token");
            let action = case["action"].as_str().expect("interop case must define an action");
            let transport = ArchiveRelayTransport::new(reqwest::Client::new(), relay_url.to_string(), token.to_string());
            match action {
                "complete_replay" => {
                    let idempotency_key = "f265e81c-c6ce-4f4d-9a4a-293b28a6ec95";
                    transport
                        .post_without_result_with_idempotency_key("complete", idempotency_key, "FastAPI relay interoperability", "complete")
                        .await
                        .expect("initial relay completion should succeed");
                    transport
                        .post_without_result_with_idempotency_key("complete", idempotency_key, "FastAPI relay interoperability", "complete")
                        .await
                        .expect("idempotent relay completion replay should succeed");
                }
                "extraction_complete" => transport
                    .complete_with_json(
                        &serde_json::json!({"destination_root_created": false}),
                        "FastAPI relay interoperability",
                    )
                    .await
                    .expect("extraction completion should succeed"),
                "creation_complete" => transport
                    .complete_with_json(
                        &serde_json::json!({"files_created": 0, "directories_created": 0, "source_bytes": 0}),
                        "FastAPI relay interoperability",
                    )
                    .await
                    .expect("creation completion should succeed"),
                "fail" => transport
                    .fail("loopback relay failure", "FastAPI relay interoperability")
                    .await
                    .expect("relay failure report should succeed"),
                _ => panic!("interop case action is invalid"),
            }
        }

        let rejected_transport = ArchiveRelayTransport::new(
            reqwest::Client::new(),
            cases[0]["relay_url"]
                .as_str()
                .expect("interop case must define a relay URL")
                .to_string(),
            "invalid-capability".to_string(),
        );
        assert!(rejected_transport.complete("FastAPI relay interoperability").await.is_err());
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

    async fn spawn_dropped_acknowledgement_server() -> (String, oneshot::Receiver<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("dropped acknowledgement test server should bind");
        let address = listener
            .local_addr()
            .expect("dropped acknowledgement test server should have an address");
        let (sender, receiver) = oneshot::channel();
        tokio::spawn(async move {
            let mut requests = Vec::new();
            for attempt in 0..ARCHIVE_RELAY_ACKNOWLEDGEMENT_ATTEMPTS {
                let (mut stream, _) = listener
                    .accept()
                    .await
                    .expect("dropped acknowledgement test server should accept a request");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    let bytes_read = stream
                        .read(&mut buffer)
                        .await
                        .expect("dropped acknowledgement test server should read a request");
                    assert_ne!(bytes_read, 0, "request must include complete headers");
                    request.extend_from_slice(&buffer[..bytes_read]);
                }
                requests.push(String::from_utf8(request).expect("relay request headers should be UTF-8"));
                if attempt + 1 == ARCHIVE_RELAY_ACKNOWLEDGEMENT_ATTEMPTS {
                    stream
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .await
                        .expect("dropped acknowledgement test server should respond to retry");
                }
            }
            sender
                .send(requests)
                .expect("test should receive captured acknowledgement requests");
        });
        (format!("http://{address}"), receiver)
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
            expected_topology_trace("extract_smb_to_local_transport_failure")["error_category"],
            "transport_failure"
        );
    }

    #[tokio::test]
    async fn archive_relay_transport_reuses_idempotency_key_after_dropped_acknowledgement_response() {
        let (relay_url, captured_requests) = spawn_dropped_acknowledgement_server().await;
        let transport = ArchiveRelayTransport::new(reqwest::Client::new(), relay_url, "test-token".to_string());

        transport
            .post_json_without_result(
                "member-complete",
                &serde_json::json!({"archive_path": "readme.txt", "status": "created", "source_bytes": 5}),
                "Archive creation member completion",
                "complete member",
            )
            .await
            .expect("a dropped acknowledgement response should retry successfully");

        let requests = captured_requests
            .await
            .expect("dropped acknowledgement test server should capture both requests");
        assert_eq!(requests.len(), ARCHIVE_RELAY_ACKNOWLEDGEMENT_ATTEMPTS);
        let idempotency_keys = requests
            .iter()
            .map(|request| {
                request
                    .lines()
                    .find_map(|line| line.strip_prefix("idempotency-key: "))
                    .expect("acknowledgement should include an idempotency key")
            })
            .collect::<Vec<_>>();
        assert_eq!(idempotency_keys[0], idempotency_keys[1]);
        assert!(uuid::Uuid::parse_str(idempotency_keys[0]).is_ok());
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
        let remote_result = FixtureArchiveCreationInvocation {
            relay: ArchiveCreationRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                remote_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveCreationAdapterBinding::RemoteSourceToLocalDestination {
                manifest: remote_manifest.clone(),
                drive_root: directory.path().to_path_buf(),
                target_path: remote_target.clone(),
            },
        }
        .execute()
        .await
        .expect("SMB-to-local creation coordinator should complete");
        let remote_expected = expected_topology_trace("create_smb_to_local_success");
        assert_eq!(mixed_creation_trace(&remote_manifest, &remote_result), remote_expected);
        assert!(remote_target.is_file());
        remote_playback.assert_consumed().await;

        let local_source = directory.path().join("local-source.txt");
        std::fs::write(&local_source, b"local source").expect("local source should be written");
        let local_entries =
            build_local_archive_manifest_for_remote_target(&[local_source]).expect("local source should produce a valid creation manifest");
        let local_playback = spawn_fixture_relay_server("create_local_to_smb_success").await;
        let local_result = FixtureArchiveCreationInvocation {
            relay: ArchiveCreationRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                local_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveCreationAdapterBinding::LocalSourceToRemoteDestination {
                entries: local_entries.clone(),
            },
        }
        .execute()
        .await
        .expect("local-to-SMB creation coordinator should complete");
        let local_expected = expected_topology_trace("create_local_to_smb_success");
        let local_manifest = ArchiveCreationManifest::from_entries(
            local_entries
                .iter()
                .map(|entry| ArchiveCreationManifestMember {
                    archive_path: entry.archive_path.clone(),
                    is_directory: entry.is_directory,
                    source_size: entry.source_size,
                    source_modified_at: entry.source_modified_at.clone(),
                })
                .collect(),
        )
        .expect("local creation manifest should be valid");
        assert_eq!(mixed_creation_trace(&local_manifest, &local_result), local_expected);
        local_playback.assert_consumed().await;
    }

    #[tokio::test]
    async fn actual_relay_creation_coordinator_dispatches_every_mixed_fault() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        let cases = fixture["cases"]
            .as_array()
            .expect("topology trace fixture should define cases")
            .iter()
            .filter(|case| {
                case["operation"] == "create"
                    && matches!(case["topology"].as_str(), Some("smb_to_local" | "local_to_smb"))
                    && case["fault"].is_string()
            })
            .cloned()
            .collect::<Vec<_>>();
        let expected_cases = cases
            .iter()
            .map(|case| case["name"].as_str().expect("fault case must have a name"))
            .collect::<std::collections::HashSet<_>>();
        let dispatched_cases = [
            "create_smb_to_local_malformed_input",
            "create_smb_to_local_collision",
            "create_smb_to_local_partial_write",
            "create_smb_to_local_cancellation",
            "create_smb_to_local_source_changed",
            "create_smb_to_local_transport_failure",
            "create_local_to_smb_malformed_input",
            "create_local_to_smb_collision",
            "create_local_to_smb_partial_write",
            "create_local_to_smb_cancellation",
            "create_local_to_smb_source_changed",
            "create_local_to_smb_transport_failure",
        ]
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            dispatched_cases, expected_cases,
            "mixed creation dispatcher must cover every declared fault"
        );

        for case in cases {
            let case_name = case["name"].as_str().expect("fault case must have a name");
            let fault = case["fault"].as_str().expect("fault case must name a fault");
            let topology = case["topology"].as_str().expect("fault case must name a topology");
            let playback = spawn_fixture_relay_playback(
                case["relay_playback"]
                    .as_array()
                    .expect("mixed creation fault must define passive relay playback")
                    .clone(),
            )
            .await;
            let directory = tempfile::tempdir().expect("temporary archive directory should be created");
            let (manifest, result) = if topology == "smb_to_local" {
                let relay = ArchiveCreationRelay::from_transport(ArchiveRelayTransport::new(
                    reqwest::Client::new(),
                    playback.url.clone(),
                    "test-token".to_string(),
                ));
                match relay.begin_remote_source().await {
                    Ok(manifest) => {
                        let target_path = directory.path().join("target.zip");
                        if fault == "collision" {
                            std::fs::write(&target_path, b"existing").expect("collision target should be written");
                        }
                        let result = FixtureArchiveCreationInvocation {
                            relay,
                            binding: ArchiveCreationAdapterBinding::RemoteSourceToLocalDestination {
                                manifest: manifest.clone(),
                                drive_root: directory.path().to_path_buf(),
                                target_path,
                            },
                        }
                        .execute()
                        .await;
                        (manifest, result)
                    }
                    Err(error) => (ArchiveCreationManifest { entries: Vec::new() }, Err(error)),
                }
            } else {
                let source = directory.path().join("entry.txt");
                std::fs::write(&source, b"entry").expect("local source should be written");
                let entries = if fault == "malformed_input" {
                    vec![LocalArchiveEntry {
                        source_path: source.clone(),
                        archive_path: "../entry.txt".to_string(),
                        is_directory: false,
                        source_size: 5,
                        source_modified_at: None,
                    }]
                } else {
                    build_local_archive_manifest_for_remote_target(std::slice::from_ref(&source))
                        .expect("local source should produce a creation manifest")
                };
                if fault == "source_changed" {
                    std::fs::write(&source, b"changed entry").expect("local source should change after manifest construction");
                }
                let manifest = ArchiveCreationManifest::from_entries(
                    entries
                        .iter()
                        .map(|entry| ArchiveCreationManifestMember {
                            archive_path: entry.archive_path.clone(),
                            is_directory: entry.is_directory,
                            source_size: entry.source_size,
                            source_modified_at: entry.source_modified_at.clone(),
                        })
                        .collect(),
                )
                .unwrap_or(ArchiveCreationManifest { entries: Vec::new() });
                let result = FixtureArchiveCreationInvocation {
                    relay: ArchiveCreationRelay::from_transport(ArchiveRelayTransport::new(
                        reqwest::Client::new(),
                        playback.url.clone(),
                        "test-token".to_string(),
                    )),
                    binding: ArchiveCreationAdapterBinding::LocalSourceToRemoteDestination { entries },
                }
                .execute()
                .await;
                (manifest, result)
            };
            let error = result.expect_err("fault fixture should fail creation");
            let category = mixed_relay_error_category(&error);
            assert_eq!(
                category,
                case["expected_trace"]["error_category"]
                    .as_str()
                    .expect("fault trace must name an error category")
            );
            assert_eq!(
                mixed_creation_failure_trace(&manifest, category),
                case["expected_trace"],
                "{case_name} must match its complete fixture trace"
            );
            playback.assert_consumed().await;
        }
    }

    #[tokio::test]
    async fn mixed_creation_trajectory_matrix_dispatches_actual_coordinators() {
        let trajectories = mixed_creation_trajectory_cases();
        let topology_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        let expected_cases = topology_fixture["trajectory_cases"]
            .as_array()
            .expect("topology trace fixture should define trajectory cases")
            .iter()
            .filter(|case| case["operation"] == "create" && matches!(case["topology"].as_str(), Some("smb_to_local" | "local_to_smb")))
            .map(|case| {
                (
                    case["topology"].as_str().expect("trajectory topology must be a string"),
                    case["scenario"].as_str().expect("trajectory scenario must be a string"),
                )
            })
            .collect::<std::collections::HashSet<_>>();
        let dispatched_cases = trajectories
            .iter()
            .map(|case| {
                (
                    case["topology"].as_str().expect("mixed topology must be a string"),
                    case["scenario"].as_str().expect("mixed scenario must be a string"),
                )
            })
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            dispatched_cases, expected_cases,
            "mixed fixture must cover every creation trajectory"
        );

        for trajectory in trajectories {
            let scenario_name = trajectory["scenario"].as_str().expect("trajectory should name a scenario");
            let scenario = creation_corpus_scenario(scenario_name);
            let directory = tempfile::tempdir().expect("temporary archive directory should be created");
            let playback = spawn_fixture_relay_playback(
                trajectory["relay_playback"]
                    .as_array()
                    .expect("mixed creation trajectory should define passive relay playback")
                    .clone(),
            )
            .await;
            let (manifest, result) = if trajectory["topology"] == "smb_to_local" {
                let manifest = ArchiveCreationManifest::from_entries(
                    scenario["entries"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|entry| ArchiveCreationManifestMember {
                            archive_path: entry["archive_path"].as_str().unwrap().to_string(),
                            is_directory: entry["is_directory"].as_bool().unwrap(),
                            source_size: entry["source_size"].as_u64().unwrap(),
                            source_modified_at: None,
                        })
                        .collect(),
                )
                .expect("corpus creation manifest should be valid");
                let result = FixtureArchiveCreationInvocation {
                    relay: ArchiveCreationRelay::from_transport(ArchiveRelayTransport::new(
                        reqwest::Client::new(),
                        playback.url.clone(),
                        "test-token".to_string(),
                    )),
                    binding: ArchiveCreationAdapterBinding::RemoteSourceToLocalDestination {
                        manifest: manifest.clone(),
                        drive_root: directory.path().to_path_buf(),
                        target_path: directory.path().join("target.zip"),
                    },
                }
                .execute()
                .await;
                (manifest, result)
            } else {
                let source_root = directory.path().join("source");
                std::fs::create_dir(&source_root).expect("source root should be created");
                let mut source_paths = Vec::new();
                for entry in scenario["entries"].as_array().unwrap() {
                    let archive_path = entry["archive_path"].as_str().unwrap();
                    let source_path = source_root.join(archive_path);
                    if entry["is_directory"].as_bool().unwrap() {
                        std::fs::create_dir_all(&source_path).expect("source directory should be created");
                    } else {
                        std::fs::create_dir_all(source_path.parent().unwrap()).expect("source parent should be created");
                        std::fs::write(&source_path, vec![b'x'; entry["source_size"].as_u64().unwrap() as usize])
                            .expect("source file should be written");
                    }
                    let top_level = source_root.join(archive_path.split('/').next().unwrap());
                    if !source_paths.contains(&top_level) {
                        source_paths.push(top_level);
                    }
                }
                let entries =
                    build_local_archive_manifest_for_remote_target(&source_paths).expect("corpus local sources should produce a manifest");
                let manifest = ArchiveCreationManifest::from_entries(
                    entries
                        .iter()
                        .map(|entry| ArchiveCreationManifestMember {
                            archive_path: entry.archive_path.clone(),
                            is_directory: entry.is_directory,
                            source_size: entry.source_size,
                            source_modified_at: entry.source_modified_at.clone(),
                        })
                        .collect(),
                )
                .expect("corpus local creation manifest should be valid");
                let result = FixtureArchiveCreationInvocation {
                    relay: ArchiveCreationRelay::from_transport(ArchiveRelayTransport::new(
                        reqwest::Client::new(),
                        playback.url.clone(),
                        "test-token".to_string(),
                    )),
                    binding: ArchiveCreationAdapterBinding::LocalSourceToRemoteDestination { entries },
                }
                .execute()
                .await;
                (manifest, result)
            };
            let expected = &trajectory["expected_trace"];
            let trace = match result {
                Ok(result) => mixed_creation_trace(&manifest, &result),
                Err(error) => mixed_creation_failure_trace(&manifest, mixed_relay_error_category(&error)),
            };
            assert_eq!(
                trace, *expected,
                "creation trajectory {scenario_name} must match its complete fixture trace"
            );
            playback.assert_consumed().await;
        }
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
        let remote_result = FixtureArchiveExtractionInvocation {
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
        assert_eq!(mixed_extraction_trace("entry.txt", "entry.txt", &remote_result), remote_expected);
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
        let local_result = FixtureArchiveExtractionInvocation {
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
        assert_eq!(mixed_extraction_trace("source.txt", "source.txt", &local_result), local_expected);
        local_playback.assert_consumed().await;
    }

    #[tokio::test]
    async fn segmented_mixed_extraction_trajectories_dispatch_actual_coordinators() {
        let cases = segmented_mixed_extraction_trajectory_cases();
        let topology_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        let expected_cases = topology_fixture["trajectory_cases"]
            .as_array()
            .expect("topology trace fixture should define trajectory cases")
            .iter()
            .filter(|case| case["operation"] == "extract" && matches!(case["topology"].as_str(), Some("smb_to_local" | "local_to_smb")))
            .map(|case| {
                (
                    case["topology"].as_str().expect("trajectory topology must be a string"),
                    case["scenario"].as_str().expect("trajectory scenario must be a string"),
                )
            })
            .collect::<std::collections::HashSet<_>>();
        let dispatched_cases = cases
            .iter()
            .map(|case| {
                (
                    case["topology"].as_str().expect("segmented topology must be a string"),
                    case["scenario"].as_str().expect("segmented scenario must be a string"),
                )
            })
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            dispatched_cases, expected_cases,
            "segmented fixture must cover every mixed extraction trajectory"
        );

        for trajectory in cases {
            let scenario = trajectory["scenario"].as_str().expect("trajectory must name a scenario");
            let topology = trajectory["topology"].as_str().expect("trajectory must name a topology");
            let member_paths = trajectory["expected_trace"]["manifest_snapshot"]
                .as_array()
                .expect("trajectory must define a manifest snapshot")
                .iter()
                .map(|path| path.as_str().expect("manifest paths must be strings").to_string())
                .collect::<Vec<_>>();
            let relay_steps = trajectory["segments"]
                .as_array()
                .expect("trajectory must define explicit relay segments")
                .iter()
                .flat_map(|segment| {
                    segment["relay_playback"]
                        .as_array()
                        .expect("relay segment must define static playback")
                        .iter()
                        .cloned()
                })
                .collect::<Vec<_>>();
            let playback = spawn_fixture_relay_playback(relay_steps).await;
            let directory = tempfile::tempdir().expect("temporary extraction directory should be created");
            let destination_path = directory.path().join("destination");
            let mut archive_path = None;
            let mut archive_entries = None;

            if topology == "smb_to_local" && scenario == "collision_decisions_resume_to_terminal_summary" {
                std::fs::create_dir(&destination_path).expect("collision destination should be created");
                for member_path in &member_paths {
                    std::fs::write(destination_path.join(member_path), b"existing").expect("collision member should be written");
                }
            }

            if topology == "local_to_smb" {
                let source_root = directory.path().join("source");
                std::fs::create_dir(&source_root).expect("local source root should be created");
                let mut source_paths = Vec::new();
                for member_path in &member_paths {
                    let content = trajectory["member_contents"][member_path]
                        .as_str()
                        .expect("local fixture member must provide content");
                    let source_path = source_root.join(member_path);
                    std::fs::create_dir_all(source_path.parent().expect("member path must have a parent"))
                        .expect("local fixture member parent should be created");
                    std::fs::write(&source_path, content).expect("local fixture member should be written");
                    source_paths.push(source_path);
                }
                let path = directory.path().join("source.zip");
                let manifest = build_local_archive_manifest(&source_paths, &path).expect("local fixture archive manifest should be valid");
                create_local_archive(directory.path(), &path, &manifest, || false).expect("local fixture archive should be created");
                archive_entries = Some(validate_local_archive_extraction(&path).expect("local fixture archive should be valid"));
                archive_path = Some(path);
            }

            let mut phase_transitions = vec!["streaming".to_string()];
            let mut terminal_result = None;
            let mut error_category = None;
            let segments = trajectory["segments"].as_array().expect("trajectory must define relay segments");
            for (segment_index, _) in segments.iter().enumerate() {
                if segment_index > 0 {
                    phase_transitions.push("streaming".to_string());
                }
                let binding = if topology == "smb_to_local" {
                    ArchiveExtractionAdapterBinding::RemoteSourceToLocalDestination {
                        drive_root: directory.path().to_path_buf(),
                        destination_path: destination_path.clone(),
                    }
                } else {
                    ArchiveExtractionAdapterBinding::LocalArchiveToRemoteDestination {
                        archive_path: archive_path.clone().expect("local fixture archive must exist"),
                        archive_entries: archive_entries.clone().expect("local fixture entries must exist"),
                    }
                };
                match (FixtureArchiveExtractionInvocation {
                    relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                        reqwest::Client::new(),
                        playback.url.clone(),
                        "test-token".to_string(),
                    )),
                    binding,
                })
                .execute()
                .await
                {
                    Ok(result) if result.phase.as_deref() == Some("awaiting_user_decision") => {
                        phase_transitions.push("awaiting_user_decision".to_string());
                    }
                    Ok(result) => {
                        phase_transitions.push("completed".to_string());
                        terminal_result = Some(result);
                    }
                    Err(error) => {
                        let category = mixed_relay_error_category(&error);
                        phase_transitions.push(category.to_string());
                        error_category = Some(category);
                    }
                }
            }

            let trace = segmented_mixed_extraction_trace(&trajectory, phase_transitions, terminal_result.as_ref(), error_category);
            assert_eq!(
                trace, trajectory["expected_trace"],
                "{topology} {scenario} must match its complete fixture trace"
            );
            playback.assert_consumed().await;
        }
    }

    #[tokio::test]
    async fn actual_relay_extraction_coordinator_matches_mixed_fault_traces() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        let expected_cases = fixture["cases"]
            .as_array()
            .expect("topology trace fixture should define cases")
            .iter()
            .filter(|case| {
                case["operation"] == "extract"
                    && matches!(case["topology"].as_str(), Some("smb_to_local" | "local_to_smb"))
                    && case["fault"].is_string()
            })
            .map(|case| case["name"].as_str().expect("fault case name must be a string"))
            .collect::<std::collections::HashSet<_>>();
        let dispatched_cases = [
            "extract_smb_to_local_malformed_input",
            "extract_smb_to_local_collision",
            "extract_smb_to_local_partial_write",
            "extract_smb_to_local_transport_failure",
            "extract_smb_to_local_cancellation",
            "extract_smb_to_local_source_changed",
            "extract_local_to_smb_malformed_input",
            "extract_local_to_smb_collision",
            "extract_local_to_smb_partial_write",
            "extract_local_to_smb_transport_failure",
            "extract_local_to_smb_cancellation",
            "extract_local_to_smb_source_changed",
        ]
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            dispatched_cases, expected_cases,
            "relay fault dispatcher must cover every declared mixed extraction fault"
        );

        let directory = tempfile::tempdir().expect("temporary archive directory should be created");

        let remote_malformed_playback = spawn_fixture_relay_server("extract_smb_to_local_malformed_input").await;
        let remote_malformed_error = FixtureArchiveExtractionInvocation {
            relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                remote_malformed_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveExtractionAdapterBinding::RemoteSourceToLocalDestination {
                drive_root: directory.path().to_path_buf(),
                destination_path: directory.path().join("from-smb-malformed"),
            },
        }
        .execute()
        .await
        .expect_err("duplicate SMB manifest entries should be rejected");
        assert!(matches!(remote_malformed_error, ApiError::BadRequest(_)));
        assert_eq!(
            mixed_extraction_failure_trace(&[], "invalid_input"),
            expected_topology_trace("extract_smb_to_local_malformed_input")
        );
        remote_malformed_playback.assert_consumed().await;

        let remote_collision_destination = directory.path().join("from-smb-collision");
        std::fs::create_dir(&remote_collision_destination).expect("collision destination should be created");
        std::fs::write(remote_collision_destination.join("entry.txt"), b"existing").expect("collision target should be written");
        let remote_collision_playback = spawn_fixture_relay_server("extract_smb_to_local_collision").await;
        let remote_collision_result = FixtureArchiveExtractionInvocation {
            relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                remote_collision_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveExtractionAdapterBinding::RemoteSourceToLocalDestination {
                drive_root: directory.path().to_path_buf(),
                destination_path: remote_collision_destination,
            },
        }
        .execute()
        .await
        .expect("SMB collision should pause extraction");
        assert_eq!(
            mixed_extraction_paused_trace("entry.txt", &remote_collision_result, None),
            expected_topology_trace("extract_smb_to_local_collision")
        );
        remote_collision_playback.assert_consumed().await;

        let remote_partial_playback = spawn_fixture_relay_server("extract_smb_to_local_partial_write").await;
        let remote_partial_destination = directory.path().join("from-smb-partial");
        let remote_partial_result = FixtureArchiveExtractionInvocation {
            relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                remote_partial_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveExtractionAdapterBinding::RemoteSourceToLocalDestination {
                drive_root: directory.path().to_path_buf(),
                destination_path: remote_partial_destination.clone(),
            },
        }
        .execute()
        .await
        .expect("short SMB member should pause extraction");
        assert_eq!(
            mixed_extraction_paused_trace("entry.txt", &remote_partial_result, Some("partial_write")),
            expected_topology_trace("extract_smb_to_local_partial_write")
        );
        assert_eq!(std::fs::read(remote_partial_destination.join("entry.txt")).unwrap(), b"bad");
        remote_partial_playback.assert_consumed().await;

        let remote_transport_playback = spawn_fixture_relay_server("extract_smb_to_local_transport_failure").await;
        let remote_transport_error = FixtureArchiveExtractionInvocation {
            relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                remote_transport_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveExtractionAdapterBinding::RemoteSourceToLocalDestination {
                drive_root: directory.path().to_path_buf(),
                destination_path: directory.path().join("from-smb-transport"),
            },
        }
        .execute()
        .await
        .expect_err("SMB relay start failure should fail extraction");
        assert!(matches!(remote_transport_error, ApiError::Internal(_)));
        assert_eq!(
            mixed_extraction_failure_trace(&[], "transport_failure"),
            expected_topology_trace("extract_smb_to_local_transport_failure")
        );
        remote_transport_playback.assert_consumed().await;

        for (case_name, expected_category) in [
            ("extract_smb_to_local_cancellation", "cancelled"),
            ("extract_smb_to_local_source_changed", "source_changed"),
        ] {
            let playback = spawn_fixture_relay_server(case_name).await;
            let error = FixtureArchiveExtractionInvocation {
                relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                    reqwest::Client::new(),
                    playback.url.clone(),
                    "test-token".to_string(),
                )),
                binding: ArchiveExtractionAdapterBinding::RemoteSourceToLocalDestination {
                    drive_root: directory.path().to_path_buf(),
                    destination_path: directory.path().join(case_name),
                },
            }
            .execute()
            .await
            .expect_err("terminal backend extraction state should stop local execution");
            assert_eq!(mixed_relay_error_category(&error), expected_category);
            assert_eq!(
                mixed_extraction_failure_trace(&[], mixed_relay_error_category(&error)),
                expected_topology_trace(case_name)
            );
            playback.assert_consumed().await;
        }

        let local_member = directory.path().join("source.txt");
        let local_archive = directory.path().join("local.zip");
        std::fs::write(&local_member, b"entry").expect("local source should be written");
        let manifest = build_local_archive_manifest(&[local_member], &local_archive).expect("local archive manifest should be valid");
        create_local_archive(directory.path(), &local_archive, &manifest, || false).expect("local archive should be created");
        let archive_entries = validate_local_archive_extraction(&local_archive).expect("local archive entries should be valid");

        let local_malformed_playback = spawn_fixture_relay_server("extract_local_to_smb_malformed_input").await;
        let mut malformed_entries: Vec<LocalArchiveReadEntry> = archive_entries.clone();
        malformed_entries[0].path = "../source.txt".to_string();
        let local_malformed_error = FixtureArchiveExtractionInvocation {
            relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                local_malformed_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveExtractionAdapterBinding::LocalArchiveToRemoteDestination {
                archive_path: local_archive.clone(),
                archive_entries: malformed_entries,
            },
        }
        .execute()
        .await
        .expect_err("unsafe local archive member should be rejected");
        assert!(matches!(local_malformed_error, ApiError::BadRequest(_)));
        assert_eq!(
            mixed_extraction_failure_trace(&[], "invalid_input"),
            expected_topology_trace("extract_local_to_smb_malformed_input")
        );
        local_malformed_playback.assert_consumed().await;

        let local_collision_playback = spawn_fixture_relay_server("extract_local_to_smb_collision").await;
        let local_collision_result = FixtureArchiveExtractionInvocation {
            relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                local_collision_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveExtractionAdapterBinding::LocalArchiveToRemoteDestination {
                archive_path: local_archive.clone(),
                archive_entries: archive_entries.clone(),
            },
        }
        .execute()
        .await
        .expect("SMB destination collision should pause extraction");
        assert_eq!(
            mixed_extraction_paused_trace("source.txt", &local_collision_result, None),
            expected_topology_trace("extract_local_to_smb_collision")
        );
        local_collision_playback.assert_consumed().await;

        let local_partial_playback = spawn_fixture_relay_server("extract_local_to_smb_partial_write").await;
        let local_partial_result = FixtureArchiveExtractionInvocation {
            relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                local_partial_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveExtractionAdapterBinding::LocalArchiveToRemoteDestination {
                archive_path: local_archive.clone(),
                archive_entries: archive_entries.clone(),
            },
        }
        .execute()
        .await
        .expect("SMB destination partial write should pause extraction");
        assert_eq!(
            mixed_extraction_paused_trace("source.txt", &local_partial_result, Some("partial_write")),
            expected_topology_trace("extract_local_to_smb_partial_write")
        );
        local_partial_playback.assert_consumed().await;

        let local_transport_playback = spawn_fixture_relay_server("extract_local_to_smb_transport_failure").await;
        let local_transport_error = FixtureArchiveExtractionInvocation {
            relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                reqwest::Client::new(),
                local_transport_playback.url.clone(),
                "test-token".to_string(),
            )),
            binding: ArchiveExtractionAdapterBinding::LocalArchiveToRemoteDestination {
                archive_path: local_archive,
                archive_entries: archive_entries.clone(),
            },
        }
        .execute()
        .await
        .expect_err("SMB relay start failure should fail extraction");
        assert!(matches!(local_transport_error, ApiError::Internal(_)));
        assert_eq!(
            mixed_extraction_failure_trace(&["source.txt"], "transport_failure"),
            expected_topology_trace("extract_local_to_smb_transport_failure")
        );
        local_transport_playback.assert_consumed().await;

        for (case_name, expected_category) in [
            ("extract_local_to_smb_cancellation", "cancelled"),
            ("extract_local_to_smb_source_changed", "source_changed"),
        ] {
            let playback = spawn_fixture_relay_server(case_name).await;
            let error = FixtureArchiveExtractionInvocation {
                relay: ArchiveExtractionRelay::from_transport(ArchiveRelayTransport::new(
                    reqwest::Client::new(),
                    playback.url.clone(),
                    "test-token".to_string(),
                )),
                binding: ArchiveExtractionAdapterBinding::LocalArchiveToRemoteDestination {
                    archive_path: directory.path().join("local.zip"),
                    archive_entries: archive_entries.clone(),
                },
            }
            .execute()
            .await
            .expect_err("terminal backend extraction state should stop local execution");
            assert_eq!(mixed_relay_error_category(&error), expected_category);
            assert_eq!(
                mixed_extraction_failure_trace(&["source.txt"], mixed_relay_error_category(&error)),
                expected_topology_trace(case_name)
            );
            playback.assert_consumed().await;
        }
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
    fn serializes_v2_relay_control_payloads() {
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
    fn v2_extraction_checkpoint_rejects_legacy_shapes_and_derives_completed_members() {
        let operation = ArchiveRelayOperation {
            phase: "streaming".to_string(),
            destination_path: "output".to_string(),
            checkpoint_json: serde_json::json!({
                "version": 2,
                "manifest": [{"path": "entry.txt", "is_directory": false, "uncompressed_size": 5, "modified_at": null}],
                "source_snapshot": {"size": 5, "modified_at": null},
                "member_outcomes": {"entry.txt": {"status": "extracted", "target_path": "output/entry.txt", "extracted_bytes": 5, "directories_created": 0, "replaced": false, "renamed": false}},
                "decisions": {"collision_actions": {}, "rename_targets": {}, "ignored_members": [], "retry_members": []},
                "pending_decision": null,
                "delivery_ids": {},
            })
            .to_string(),
            pending_decision_json: None,
            collision_policy: None,
        };
        assert_eq!(
            relay_completed_members(&operation).unwrap(),
            ["entry.txt".to_string()].into_iter().collect()
        );

        let legacy = ArchiveRelayOperation {
            checkpoint_json: serde_json::json!({"member_outcomes": {}}).to_string(),
            ..operation
        };
        assert!(relay_completed_members(&legacy).is_err());
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
            contract_version: ArchiveContractVersion::V2,
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
        assert_eq!(serialized["contract_version"], "v2");
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
            contract_version: ArchiveContractVersion::V2,
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
                "member_path": "source.txt",
                "target_path": "output/source.txt",
                "message": "archive member integrity check failed",
                "partial_output": true,
                "allowed_actions": ["retry", "ignore"],
            })
        );
        assert_eq!(serialized["progress"]["partialMembers"], 1);
    }

    #[test]
    fn archive_execution_response_serializes_a_pending_existing_files_decision() {
        let response = archive_execution_response(ArchiveSessionStatus {
            execution_id: "execution-id".to_string(),
            contract_version: ArchiveContractVersion::V2,
            kind: ArchiveSessionKind::Extract,
            phase: ArchiveSessionPhase::AwaitingUserDecision,
            revision: 4,
            cancellation_requested: false,
            progress: ArchiveSessionProgress::Extraction(LocalArchiveExtractionResult::default()),
            result: None,
            error: None,
            pending_decision: Some(ArchiveSessionPendingDecision {
                member_path: "source.txt".to_string(),
                target_path: Some("renamed.txt".to_string()),
                is_directory: false,
                member_error: None,
            }),
        });

        let serialized = serde_json::to_value(response).expect("archive execution response should serialize");
        assert_eq!(
            serialized["pendingDecision"],
            serde_json::json!({
                "kind": "existing_files",
                "allowed_actions": ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
                "conflicts": [{
                    "member_path": "source.txt",
                    "target_path": "renamed.txt",
                    "is_directory": false,
                }],
            })
        );
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
