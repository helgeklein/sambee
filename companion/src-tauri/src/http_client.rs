//! Shared HTTP client state for Sambee backend requests.
//!
//! Native-edit requests normally use a plain `reqwest::Client`. When Sambee is
//! behind a cookie-based reverse proxy, the proxy cookies are captured from a
//! Companion-owned Tauri webview and stored here so all lifecycle requests can
//! reuse them consistently.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use log::info;
use reqwest::cookie::Jar;
use reqwest::{redirect, Client, Url};
use tauri::webview::Cookie;

/// Default HTTP request timeout for short backend API requests.
pub const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 30;

/// Process-local store of reverse-proxy cookie jars, keyed by normalized server URL.
#[derive(Clone, Default)]
pub struct SambeeHttpClientStore {
    jars_by_server: Arc<RwLock<HashMap<String, Arc<Jar>>>>,
}

impl SambeeHttpClientStore {
    /// Build a backend HTTP client for the given server.
    pub fn client_for_server(&self, server_url: &str, timeout_secs: u64) -> Result<Client, String> {
        self.client_for_server_with_redirects(server_url, timeout_secs, redirect::Policy::default())
    }

    /// Build a backend HTTP client with an explicit redirect policy.
    pub fn client_for_server_with_redirects(
        &self,
        server_url: &str,
        timeout_secs: u64,
        redirect_policy: redirect::Policy,
    ) -> Result<Client, String> {
        let mut builder = Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .redirect(redirect_policy);

        if let Some(jar) = self.cookie_jar(server_url)? {
            builder = builder.cookie_provider(jar);
        }

        builder.build().map_err(|e| format!("Failed to create HTTP client: {e}"))
    }

    /// Store webview cookies for future requests to this server.
    pub fn store_webview_cookies(&self, server_url: &str, cookies: Vec<Cookie<'static>>) -> Result<usize, String> {
        let normalized_server = normalize_server_url(server_url)?;
        let url = Url::parse(&normalized_server).map_err(|e| format!("Invalid server URL '{normalized_server}': {e}"))?;

        let jar = Arc::new(Jar::default());
        let mut stored_count = 0usize;
        for cookie in cookies {
            jar.add_cookie_str(&cookie.to_string(), &url);
            stored_count += 1;
        }

        let mut jars = self
            .jars_by_server
            .write()
            .map_err(|_| "HTTP client cookie store lock poisoned".to_string())?;
        jars.insert(normalized_server.clone(), jar);

        info!(
            "Stored {} reverse-proxy cookie(s) for {}",
            stored_count, normalized_server
        );
        Ok(stored_count)
    }

    fn cookie_jar(&self, server_url: &str) -> Result<Option<Arc<Jar>>, String> {
        let normalized_server = normalize_server_url(server_url)?;
        let jars = self
            .jars_by_server
            .read()
            .map_err(|_| "HTTP client cookie store lock poisoned".to_string())?;
        Ok(jars.get(&normalized_server).cloned())
    }
}

/// Build a plain client for call sites that do not have managed state.
pub fn plain_client(timeout_secs: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

fn normalize_server_url(server_url: &str) -> Result<String, String> {
    let mut url = Url::parse(server_url.trim_end_matches('/')).map_err(|e| format!("Invalid server URL '{server_url}': {e}"))?;
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_webview_cookies_accepts_http_only_cookie() {
        let store = SambeeHttpClientStore::default();
        let cookie = Cookie::build(("proxy_session", "secret"))
            .domain("sambee.example.com")
            .path("/")
            .secure(true)
            .http_only(true)
            .build();

        let count = store
            .store_webview_cookies("https://sambee.example.com", vec![cookie])
            .unwrap();

        assert_eq!(count, 1);
        assert!(store.client_for_server("https://sambee.example.com", 5).is_ok());
    }
}