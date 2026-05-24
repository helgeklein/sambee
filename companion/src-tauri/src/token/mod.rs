//! Companion authentication token management.
//!
//! Handles exchanging the short-lived URI token (received via deep-link) for
//! a longer-lived session JWT via `POST /api/companion/token?token=...`.

use log::{info, warn};
use reqwest::{header, redirect, Client, Response};
use serde::Deserialize;

use crate::http_client::{format_proxy_auth_required_message, SambeeHttpClientStore, DEFAULT_REQUEST_TIMEOUT_SECS};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// HTTP request timeout for token exchange.
const TOKEN_EXCHANGE_TIMEOUT_SECS: u64 = 15;

/// Upper bound for response snippets included in token exchange errors.
const ERROR_BODY_PREVIEW_MAX_CHARS: usize = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Response types
// ─────────────────────────────────────────────────────────────────────────────

/// Deserialized response from `POST /api/companion/token`.
#[derive(Debug, Deserialize)]
pub struct CompanionTokenResponse {
    /// The longer-lived session JWT.
    pub token: String,
    /// Token lifetime in seconds.
    pub expires_in: u64,
}

/// Structured token exchange failure.
#[derive(Debug)]
#[allow(dead_code)]
pub enum TokenExchangeError {
    ProxyAuthenticationRequired {
        server_url: String,
        login_url: Option<String>,
        message: String,
    },
    HttpClient {
        message: String,
    },
    Request {
        message: String,
    },
    HttpStatus {
        status: u16,
        body_preview: String,
        message: String,
    },
    InvalidResponse {
        content_type: Option<String>,
        body_preview: Option<String>,
        message: String,
    },
}

impl std::fmt::Display for TokenExchangeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ProxyAuthenticationRequired { message, .. }
            | Self::HttpClient { message }
            | Self::Request { message }
            | Self::HttpStatus { message, .. }
            | Self::InvalidResponse { message, .. } => f.write_str(message),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

//
// exchange_uri_token
//
/// Exchange a short-lived URI token for a longer-lived companion session JWT.
///
/// Calls `POST {server_url}/api/companion/token?token={uri_token}`.
/// Returns the session JWT string on success.
#[allow(dead_code)]
pub async fn exchange_uri_token(server_url: &str, uri_token: &str) -> Result<String, String> {
    let http_clients = SambeeHttpClientStore::default();
    exchange_uri_token_with_store(server_url, uri_token, &http_clients)
        .await
        .map_err(|e| e.to_string())
}

pub async fn exchange_uri_token_with_store(
    server_url: &str,
    uri_token: &str,
    http_clients: &SambeeHttpClientStore,
) -> Result<String, TokenExchangeError> {
    let url = format!("{}/api/companion/token", server_url.trim_end_matches('/'));

    info!("Exchanging URI token with server: {url}");

    let client = http_clients
        .client_for_server_with_redirects(
            server_url,
            TOKEN_EXCHANGE_TIMEOUT_SECS.max(DEFAULT_REQUEST_TIMEOUT_SECS),
            redirect::Policy::none(),
        )
        .map_err(|message| TokenExchangeError::HttpClient { message })?;

    exchange_uri_token_with_client(&client, server_url, &url, uri_token).await
}

pub async fn exchange_uri_token_with_client(
    client: &Client,
    server_url: &str,
    url: &str,
    uri_token: &str,
) -> Result<String, TokenExchangeError> {

    let response = client
        .post(url)
        .query(&[("token", uri_token)])
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| TokenExchangeError::Request {
            message: format!("Token exchange request failed: {e}"),
        })?;

    let final_url = response.url().clone();
    let status = response.status();

    if status.is_redirection() {
        let location = response
            .headers()
            .get(header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("<missing Location header>");
        let message = format_proxy_auth_required_message(
            "Token exchange",
            &format!(
                "Redirected to {location} (HTTP {status}). Companion can authenticate in an embedded window and retry if the proxy uses backend-origin cookies."
            ),
        );
        warn!("{message}");
        return Err(TokenExchangeError::ProxyAuthenticationRequired {
            server_url: server_url.to_string(),
            login_url: Some(location.to_string()),
            message,
        });
    }

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        warn!("Token exchange failed: HTTP {status} — {body}");
        return Err(TokenExchangeError::HttpStatus {
            status: status.as_u16(),
            body_preview: body_preview(&body),
            message: format!("Token exchange failed (HTTP {status}): {body}"),
        });
    }

    let body = parse_token_exchange_response(response, server_url, &final_url).await?;

    info!("Token exchange successful, session expires in {}s", body.expires_in);
    Ok(body.token)
}

async fn parse_token_exchange_response(
    response: Response,
    server_url: &str,
    final_url: &reqwest::Url,
) -> Result<CompanionTokenResponse, TokenExchangeError> {
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_default();
    let body = response
        .text()
        .await
        .map_err(|e| TokenExchangeError::InvalidResponse {
            content_type: Some(content_type.clone()),
            body_preview: None,
            message: format!("Failed to read token response body: {e}"),
        })?;

    if !content_type.to_ascii_lowercase().contains("application/json") {
        let preview = body_preview(&body);
        return Err(TokenExchangeError::ProxyAuthenticationRequired {
            server_url: server_url.to_string(),
            login_url: Some(final_url.to_string()),
            message: format_proxy_auth_required_message(
                "Token exchange",
                &format!(
                    "Returned content type '{}' from {} instead of JSON. This usually means a reverse proxy or auth gateway returned a login page. Preview: {}",
                    if content_type.is_empty() { "<missing>" } else { &content_type },
                    final_url,
                    preview
                ),
            ),
        });
    }

    serde_json::from_str::<CompanionTokenResponse>(&body).map_err(|e| {
        TokenExchangeError::InvalidResponse {
            content_type: Some(content_type.clone()),
            body_preview: Some(body_preview(&body)),
            message: format!(
                "Failed to parse token response from {} as JSON: {e}. Preview: {}",
                final_url,
                body_preview(&body)
            ),
        }
    })
}

fn body_preview(body: &str) -> String {
    let collapsed = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut preview = collapsed.chars().take(ERROR_BODY_PREVIEW_MAX_CHARS).collect::<String>();
    if collapsed.chars().count() > ERROR_BODY_PREVIEW_MAX_CHARS {
        preview.push_str("...");
    }
    if preview.is_empty() {
        "<empty body>".to_string()
    } else {
        preview
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        response::{Html, IntoResponse, Redirect},
        routing::post,
        Router,
    };
    use std::sync::Arc;
    use tauri::webview::Cookie;
    use tokio::sync::Mutex;

    async fn spawn_test_server(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    //
    // test_token_response_deserialization
    //
    #[test]
    fn test_token_response_deserialization() {
        let json = r#"{"token": "eyJhbGciOiJIUzI1NiJ9.test", "expires_in": 3600}"#;
        let resp: CompanionTokenResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.token, "eyJhbGciOiJIUzI1NiJ9.test");
        assert_eq!(resp.expires_in, 3600);
    }

    //
    // test_exchange_uri_token_bad_server
    //
    #[tokio::test]
    async fn test_exchange_uri_token_bad_server() {
        // Should fail with a connection error against a non-existent server
        let result = exchange_uri_token("http://127.0.0.1:1", "fake-token").await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("failed") || err.contains("error") || err.contains("request"),
            "Unexpected error message: {err}"
        );
    }

    #[tokio::test]
    async fn test_exchange_uri_token_redirect_reports_auth_hint() {
        let app = Router::new().route(
            "/api/companion/token",
            post(|| async { Redirect::temporary("https://auth.example.com/login") }),
        );
        let server_url = spawn_test_server(app).await;

        let result = exchange_uri_token(&server_url, "fake-token").await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Redirected to https://auth.example.com/login"), "Unexpected error message: {err}");
        assert!(
            err.starts_with("Proxy authentication required:")
                && err.contains("embedded window")
                && err.contains("backend-origin cookies"),
            "Unexpected error message: {err}"
        );
    }

    #[tokio::test]
    async fn test_exchange_uri_token_html_response_reports_login_page_hint() {
        let app = Router::new().route(
            "/api/companion/token",
            post(|| async {
                (
                    [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                    Html("<html><body>Sign in</body></html>"),
                )
                    .into_response()
            }),
        );
        let server_url = spawn_test_server(app).await;

        let result = exchange_uri_token(&server_url, "fake-token").await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("instead of JSON"), "Unexpected error message: {err}");
        assert!(err.contains("login page"), "Unexpected error message: {err}");
    }

    #[tokio::test]
    async fn test_exchange_uri_token_with_store_uses_cookie_jar() {
        #[derive(Clone, Default)]
        struct AppState {
            saw_cookie: Arc<Mutex<bool>>,
        }

        let state = AppState::default();
        let app = Router::new()
            .route(
                "/api/companion/token",
                post(
                    |State(state): State<AppState>, headers: axum::http::HeaderMap| async move {
                        let has_cookie = headers
                            .get(header::COOKIE)
                            .and_then(|value| value.to_str().ok())
                            .is_some_and(|value| value.contains("proxy_session=ok"));
                        *state.saw_cookie.lock().await = has_cookie;

                        if has_cookie {
                            axum::Json(serde_json::json!({
                                "token": "session-token",
                                "expires_in": 3600
                            }))
                            .into_response()
                        } else {
                            (
                                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                                Html("<html><body>Please sign in</body></html>"),
                            )
                                .into_response()
                        }
                    },
                ),
            )
            .with_state(state.clone());
        let server_url = spawn_test_server(app).await;

        let store = SambeeHttpClientStore::default();
        store
            .store_webview_cookies(&server_url, vec![Cookie::build(("proxy_session", "ok")).path("/").build()])
            .unwrap();

        let result = exchange_uri_token_with_store(&server_url, "fake-token", &store).await;

        assert_eq!(result.unwrap(), "session-token");
        assert!(*state.saw_cookie.lock().await);
    }
}
