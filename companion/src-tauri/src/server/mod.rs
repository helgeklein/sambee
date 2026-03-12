//! Local drive HTTP API server.
//!
//! Embeds an axum HTTP server on `127.0.0.1:21549` that enables the Sambee
//! frontend to browse and manage local drives through the same API contract
//! used by the main Python backend for SMB shares.

pub mod auth;
pub mod drives;
pub mod errors;
pub mod handlers;
pub mod models;
pub mod pairing;
pub mod watcher;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use log::{error, info};
use tauri::AppHandle;
use tower_http::cors::CorsLayer;

use self::auth::AuthState;
use self::pairing::PairingState;
use self::watcher::DirectoryWatcher;

/// The port the local HTTP server listens on.
pub const SERVER_PORT: u16 = 21549;

/// Shared application state accessible from all request handlers.
#[allow(dead_code)]
pub struct AppState {
    pub app: AppHandle,
    pub pairing: Arc<PairingState>,
    pub auth: AuthState,
    pub watcher: DirectoryWatcher,
}

/// Start the local HTTP API server.
///
/// This spawns the axum server on a background Tokio task. It binds to
/// `127.0.0.1:21549` (localhost only — no remote access).
///
/// Designed to be called from the Tauri `setup()` hook.
pub fn start_server(app: AppHandle, pairing: Arc<PairingState>) {
    tauri::async_runtime::spawn(async {
        if let Err(e) = run_server(app, pairing).await {
            error!("Local API server failed: {e}");
        }
    });
}

async fn run_server(app: AppHandle, pairing: Arc<PairingState>) -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(AppState {
        app,
        pairing,
        auth: AuthState::new(),
        watcher: DirectoryWatcher::new(),
    });

    let app = build_router(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], SERVER_PORT));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("Local API server listening on http://{addr}");

    axum::serve(listener, app).await?;
    Ok(())
}

/// Build the axum [`Router`] with all routes and middleware.
fn build_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::permissive();

    let public_routes = Router::new()
        .route("/api/health", axum::routing::get(handlers::health))
        .route("/api/pair/status", axum::routing::get(handlers::pair_status))
        .route(
            "/api/pairings",
            axum::routing::get(handlers::list_pairings).delete(handlers::delete_pairing),
        )
        .route("/api/pair/initiate", axum::routing::post(handlers::pair_initiate))
        .route("/api/pair/confirm", axum::routing::post(handlers::pair_confirm));

    let authenticated_routes = Router::new()
        .route("/api/pair/test", axum::routing::post(handlers::test_pairing))
        .route("/api/drives", axum::routing::get(handlers::list_drives))
        .route("/api/browse/{drive}/list", axum::routing::get(handlers::browse_list))
        .route("/api/browse/{drive}/info", axum::routing::get(handlers::browse_info))
        .route("/api/browse/{drive}/item", axum::routing::delete(handlers::browse_delete))
        .route("/api/browse/{drive}/rename", axum::routing::post(handlers::browse_rename))
        .route("/api/browse/{drive}/create", axum::routing::post(handlers::browse_create))
        .route("/api/browse/{drive}/copy", axum::routing::post(handlers::browse_copy))
        .route("/api/browse/{drive}/move", axum::routing::post(handlers::browse_move))
        .route("/api/browse/{drive}/open", axum::routing::post(handlers::browse_open))
        .route(
            "/api/browse/{drive}/directories",
            axum::routing::get(handlers::browse_search_directories),
        )
        .route("/api/browse/{drive}/upload", axum::routing::post(handlers::browse_upload))
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth::require_auth));

    // Viewer routes support both header-based and query-param auth so that
    // URLs can be used directly in <img src> / <iframe> attributes.
    let viewer_routes = Router::new()
        .route("/api/viewer/{drive}/file", axum::routing::get(handlers::viewer_file))
        .route("/api/viewer/{drive}/download", axum::routing::get(handlers::viewer_download))
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth::require_auth_or_query));

    // WebSocket route — uses query-param auth (browser WS API has no custom headers).
    let ws_routes = Router::new().route("/api/ws", axum::routing::get(handlers::ws_upgrade));

    Router::new()
        .merge(public_routes)
        .merge(authenticated_routes)
        .merge(viewer_routes)
        .merge(ws_routes)
        .layer(cors)
        .with_state(state)
}
