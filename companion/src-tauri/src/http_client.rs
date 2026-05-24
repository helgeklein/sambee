//! Shared HTTP client state for Sambee backend requests.
//!
//! Native-edit requests normally use a plain `reqwest::Client`. When Sambee is
//! behind a cookie-based reverse proxy, the proxy cookies are captured from a
//! Companion-owned Tauri webview and stored here so all lifecycle requests can
//! reuse them consistently.

use std::collections::HashMap;
use std::error::Error as _;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use log::{info, warn};
use reqwest::cookie::Jar;
use reqwest::{redirect, Client, StatusCode, Url};
use tauri::webview::Cookie;

/// Default HTTP request timeout for short backend API requests.
pub const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 30;

/// TCP/TLS connection timeout for backend HTTP requests.
pub const CONNECT_TIMEOUT_SECS: u64 = 15;

/// Prefix used in user-facing errors when reverse-proxy auth intercepted a request.
pub const PROXY_AUTH_REQUIRED_PREFIX: &str = "Proxy authentication required:";

const ERROR_BODY_PREVIEW_MAX_CHARS: usize = 200;

/// Process-local store of reverse-proxy-aware backend HTTP clients.
#[derive(Clone, Default)]
pub struct SambeeHttpClientStore {
    states_by_server: Arc<RwLock<HashMap<String, Arc<ServerHttpState>>>>,
}

struct ServerHttpState {
    jar: Arc<Jar>,
    default_client: Client,
    no_redirect_client: Client,
}

impl SambeeHttpClientStore {
    /// Return a cached backend HTTP client for the given server.
    pub fn client_for_server(&self, server_url: &str) -> Result<Client, String> {
        Ok(self.state_for_server(server_url)?.default_client.clone())
    }

    /// Return a cached backend HTTP client with redirects disabled.
    pub fn client_for_server_no_redirects(&self, server_url: &str) -> Result<Client, String> {
        Ok(self.state_for_server(server_url)?.no_redirect_client.clone())
    }

    /// Store webview cookies for future requests to this server.
    pub fn store_webview_cookies(&self, server_url: &str, cookies: Vec<Cookie<'static>>) -> Result<usize, String> {
        let normalized_server = normalize_server_url(server_url)?;
        let url = Url::parse(&normalized_server).map_err(|e| format!("Invalid server URL '{normalized_server}': {e}"))?;
        let state = self.state_for_normalized_server(&normalized_server)?;

        let mut stored_count = 0usize;
        for cookie in cookies {
            state.jar.add_cookie_str(&cookie.to_string(), &url);
            stored_count += 1;
        }

        info!("Stored {} reverse-proxy cookie(s) for {}", stored_count, normalized_server);
        Ok(stored_count)
    }

    fn state_for_server(&self, server_url: &str) -> Result<Arc<ServerHttpState>, String> {
        let normalized_server = normalize_server_url(server_url)?;
        self.state_for_normalized_server(&normalized_server)
    }

    fn state_for_normalized_server(&self, normalized_server: &str) -> Result<Arc<ServerHttpState>, String> {
        if let Some(state) = self
            .states_by_server
            .read()
            .map_err(|_| "HTTP client store lock poisoned".to_string())?
            .get(normalized_server)
            .cloned()
        {
            return Ok(state);
        }

        let mut states = self
            .states_by_server
            .write()
            .map_err(|_| "HTTP client store lock poisoned".to_string())?;

        if let Some(state) = states.get(normalized_server).cloned() {
            return Ok(state);
        }

        let state = Arc::new(ServerHttpState::new()?);
        states.insert(normalized_server.to_string(), state.clone());
        Ok(state)
    }
}

impl ServerHttpState {
    fn new() -> Result<Self, String> {
        let jar = Arc::new(Jar::default());
        let default_client = build_client_with_jar(jar.clone(), true)?;
        let no_redirect_client = build_client_with_jar(jar.clone(), false)?;

        Ok(Self {
            jar,
            default_client,
            no_redirect_client,
        })
    }
}

fn build_client_with_jar(jar: Arc<Jar>, follow_redirects: bool) -> Result<Client, String> {
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .cookie_provider(jar);

    if !follow_redirects {
        builder = builder.redirect(redirect::Policy::none());
    }

    builder.build().map_err(|error| format!("Failed to create HTTP client: {error}"))
}

pub fn format_proxy_auth_required_message(endpoint: &str, detail: &str) -> String {
    format!("{PROXY_AUTH_REQUIRED_PREFIX} {endpoint} appears to have been intercepted by a reverse proxy or SSO login flow. {detail}")
}

pub fn is_proxy_auth_required_error(message: &str) -> bool {
    message.starts_with(PROXY_AUTH_REQUIRED_PREFIX)
}

pub fn classify_proxy_auth_intercept(endpoint: &str, status: Option<StatusCode>, content_type: Option<&str>, body: &str) -> Option<String> {
    let normalized_body = body.to_ascii_lowercase();
    let normalized_content_type = content_type.unwrap_or_default().to_ascii_lowercase();
    let looks_like_html = normalized_content_type.contains("text/html") || normalized_content_type.contains("application/xhtml");
    let looks_like_login = ["sign in", "login", "log in", "single sign-on", "sso", "authenticate"]
        .iter()
        .any(|needle| normalized_body.contains(needle));

    if status.is_some_and(|value| value.is_redirection()) || (looks_like_html && looks_like_login) {
        let mut detail = String::new();
        if let Some(status) = status {
            detail.push_str(&format!("HTTP {status}. "));
        }
        if let Some(content_type) = content_type {
            if !content_type.is_empty() {
                detail.push_str(&format!("Content-Type: {content_type}. "));
            }
        }
        detail.push_str(&format!("Preview: {}", body_preview(body)));
        return Some(format_proxy_auth_required_message(endpoint, &detail));
    }

    None
}

/// Build a plain client for call sites that do not have managed state.
pub fn plain_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))
}

pub fn log_request_error(operation: &str, method: &str, url: &str, error: &reqwest::Error) -> String {
    let message = format!(
        "{} {} {} failed: {}",
        operation,
        method,
        sanitize_url_for_logging(url),
        describe_reqwest_error(error)
    );
    warn!("{message}");
    message
}

pub fn describe_reqwest_error(error: &reqwest::Error) -> String {
    let mut categories = Vec::new();
    if error.is_timeout() {
        categories.push("timeout");
    }
    if error.is_connect() {
        categories.push("connect");
    }
    if error.is_request() {
        categories.push("request");
    }
    if error.is_body() {
        categories.push("body");
    }
    if error.is_decode() {
        categories.push("decode");
    }
    if error.is_status() {
        categories.push("status");
    }

    let category_text = if categories.is_empty() {
        "kind=unknown".to_string()
    } else {
        format!("kind={}", categories.join("+"))
    };

    let mut parts = vec![category_text];
    if let Some(status) = error.status() {
        parts.push(format!("status={status}"));
    }
    if let Some(url) = error.url() {
        parts.push(format!("url={}", sanitize_url_for_logging(url.as_str())));
    }

    let message = if let Some(url) = error.url() {
        error.to_string().replace(url.as_str(), &sanitize_url_for_logging(url.as_str()))
    } else {
        error.to_string()
    };
    parts.push(format!("message={message}"));

    let mut sources = Vec::new();
    let mut source = error.source();
    while let Some(current) = source {
        sources.push(sanitize_text_for_logging(&current.to_string()));
        source = current.source();
    }
    if !sources.is_empty() {
        parts.push(format!("sources=[{}]", sources.join("; ")));
    }

    parts.join(", ")
}

pub fn sanitize_url_for_logging(raw_url: &str) -> String {
    let Ok(mut url) = Url::parse(raw_url) else {
        return sanitize_text_for_logging(raw_url);
    };

    let Some(query) = url.query() else {
        return url.to_string();
    };

    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        if is_sensitive_query_key(&key) {
            serializer.append_pair(&key, "<redacted>");
        } else if key.eq_ignore_ascii_case("theme") {
            serializer.append_pair(&key, "<present>");
        } else {
            serializer.append_pair(&key, &value);
        }
    }

    let sanitized_query = serializer.finish();
    url.set_query((!sanitized_query.is_empty()).then_some(&sanitized_query));
    url.to_string()
}

fn normalize_server_url(server_url: &str) -> Result<String, String> {
    let mut url = Url::parse(server_url.trim_end_matches('/')).map_err(|e| format!("Invalid server URL '{server_url}': {e}"))?;
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
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

fn sanitize_text_for_logging(text: &str) -> String {
    text.split_whitespace()
        .map(sanitize_url_for_logging_part)
        .collect::<Vec<_>>()
        .join(" ")
}

fn sanitize_url_for_logging_part(part: &str) -> String {
    let trimmed = part.trim_matches(|character: char| matches!(character, ',' | ';' | ')' | '(' | '[' | ']'));
    if Url::parse(trimmed).is_err() {
        return part.to_string();
    }

    part.replace(trimmed, &sanitize_url_for_logging(trimmed))
}

fn is_sensitive_query_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized.contains("token")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("cookie")
        || normalized.contains("authorization")
        || normalized.contains("session")
        || normalized == "key"
        || normalized == "theme"
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

        let count = store.store_webview_cookies("https://sambee.example.com", vec![cookie]).unwrap();

        assert_eq!(count, 1);
        assert!(store.client_for_server("https://sambee.example.com").is_ok());
    }

    #[test]
    fn test_cookie_jar_is_stable_after_client_creation() {
        use reqwest::cookie::CookieStore;

        let store = SambeeHttpClientStore::default();
        assert!(store.client_for_server("https://sambee.example.com").is_ok());

        let cookie = Cookie::build(("proxy_session", "secret"))
            .domain("sambee.example.com")
            .path("/")
            .secure(true)
            .http_only(true)
            .build();
        store.store_webview_cookies("https://sambee.example.com", vec![cookie]).unwrap();

        let state = store.state_for_server("https://sambee.example.com").unwrap();
        let url = Url::parse("https://sambee.example.com/api/companion/token").unwrap();
        let cookies = state.jar.cookies(&url).unwrap();

        assert!(cookies.to_str().unwrap().contains("proxy_session=secret"));
    }

    #[test]
    fn test_no_redirect_client_is_available() {
        let store = SambeeHttpClientStore::default();

        assert!(store.client_for_server_no_redirects("https://sambee.example.com").is_ok());
    }

    #[test]
    fn test_classify_proxy_auth_intercept_detects_login_page() {
        let message = classify_proxy_auth_intercept(
            "file info",
            Some(StatusCode::OK),
            Some("text/html; charset=utf-8"),
            "<html><body>Please sign in</body></html>",
        )
        .unwrap();

        assert!(message.starts_with(PROXY_AUTH_REQUIRED_PREFIX));
        assert!(message.contains("file info appears to have been intercepted"));
    }

    #[test]
    fn test_sanitize_url_for_logging_redacts_sensitive_query_values() {
        let sanitized =
            sanitize_url_for_logging("https://sambee.example.com/api?token=secret&theme=encoded&path=/docs/report.pdf&session_id=abc");

        assert!(sanitized.contains("token=%3Credacted%3E"));
        assert!(sanitized.contains("theme=%3Credacted%3E") || sanitized.contains("theme=%3Cpresent%3E"));
        assert!(sanitized.contains("path=%2Fdocs%2Freport.pdf"));
        assert!(sanitized.contains("session_id=%3Credacted%3E"));
        assert!(!sanitized.contains("secret"));
        assert!(!sanitized.contains("encoded"));
    }

    #[test]
    fn test_sanitize_text_for_logging_redacts_bare_url() {
        let sanitized = sanitize_text_for_logging("request failed for https://sambee.example.com/api?token=secret&path=/docs/report.pdf");

        assert!(sanitized.contains("token=%3Credacted%3E"));
        assert!(sanitized.contains("path=%2Fdocs%2Freport.pdf"));
        assert!(!sanitized.contains("token=secret"));
    }
}
