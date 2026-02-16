//! Companion authentication token management.
//!
//! Handles exchanging the short-lived URI token (received via deep-link) for
//! a longer-lived session JWT via `POST /api/companion/token?token=...`.

use log::{info, warn};
use reqwest::Client;
use serde::Deserialize;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// HTTP request timeout for token exchange.
const TOKEN_EXCHANGE_TIMEOUT_SECS: u64 = 15;

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
pub async fn exchange_uri_token(server_url: &str, uri_token: &str) -> Result<String, String> {
    let url = format!("{}/api/companion/token", server_url.trim_end_matches('/'));

    info!("Exchanging URI token with server: {url}");

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(TOKEN_EXCHANGE_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .post(&url)
        .query(&[("token", uri_token)])
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        warn!("Token exchange failed: HTTP {status} — {body}");
        return Err(format!("Token exchange failed (HTTP {status}): {body}"));
    }

    let body: CompanionTokenResponse = response.json().await.map_err(|e| format!("Failed to parse token response: {e}"))?;

    info!("Token exchange successful, session expires in {}s", body.expires_in);
    Ok(body.token)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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
}
