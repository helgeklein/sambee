//! URI parser for `sambee://` deep-link URIs.
//!
//! URI format:
//!   sambee://open?server=<base_url>&token=<jwt>&connId=<uuid>&path=<file_path>
//!
//! The parser extracts and validates all required query parameters.

use thiserror::Error;
use url::Url;

/// Errors that can occur when parsing a `sambee://` URI.
#[derive(Debug, Error)]
pub enum UriParseError {
    #[error("unsupported scheme: expected 'sambee', got '{0}'")]
    InvalidScheme(String),

    #[error("unsupported action: expected 'open', got '{0}'")]
    InvalidAction(String),

    #[error("missing required parameter: {0}")]
    MissingParam(&'static str),
}

/// Parsed representation of a `sambee://open?...` URI.
#[derive(Debug, Clone)]
pub struct SambeeUri {
    /// Base URL of the Sambee backend (e.g. "https://sambee.example.com")
    pub server: String,

    /// Short-lived JWT token for companion authentication
    pub token: String,

    /// UUID of the SMB connection to use
    pub conn_id: String,

    /// Path to the file on the SMB share (e.g. "/docs/report.docx")
    pub path: String,

    /// Optional base64-encoded JSON theme from the web app.
    /// When present, the companion applies these colors to its UI.
    pub theme: Option<String>,
}

impl SambeeUri {
    //
    // parse
    //
    /// Parse a `sambee://` URL into its components.
    ///
    /// Returns an error if the scheme is not `sambee`, the action (host) is not
    /// `open`, or any required query parameter is missing.
    pub fn parse(url: &Url) -> Result<Self, UriParseError> {
        // Validate scheme
        if url.scheme() != "sambee" {
            return Err(UriParseError::InvalidScheme(url.scheme().to_string()));
        }

        // The "host" portion is the action (e.g. "open")
        let action = url.host_str().unwrap_or("");
        if action != "open" {
            return Err(UriParseError::InvalidAction(action.to_string()));
        }

        // Extract required query parameters
        let params: std::collections::HashMap<String, String> = url
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();

        let server = params
            .get("server")
            .filter(|s| !s.is_empty())
            .ok_or(UriParseError::MissingParam("server"))?
            .clone();

        let token = params
            .get("token")
            .filter(|s| !s.is_empty())
            .ok_or(UriParseError::MissingParam("token"))?
            .clone();

        let conn_id = params
            .get("connId")
            .filter(|s| !s.is_empty())
            .ok_or(UriParseError::MissingParam("connId"))?
            .clone();

        let path = params
            .get("path")
            .filter(|s| !s.is_empty())
            .ok_or(UriParseError::MissingParam("path"))?
            .clone();

        // Optional: theme (base64-encoded JSON CompanionTheme)
        let theme = params.get("theme").filter(|s| !s.is_empty()).cloned();

        Ok(Self {
            server,
            token,
            conn_id,
            path,
            theme,
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    //
    // test_parse_valid_uri
    //
    #[test]
    fn test_parse_valid_uri() {
        let url = Url::parse(
            "sambee://open?server=https://sambee.example.com&token=abc123&connId=550e8400-e29b-41d4-a716-446655440000&path=/docs/report.docx"
        ).unwrap();

        let parsed = SambeeUri::parse(&url).unwrap();
        assert_eq!(parsed.server, "https://sambee.example.com");
        assert_eq!(parsed.token, "abc123");
        assert_eq!(parsed.conn_id, "550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(parsed.path, "/docs/report.docx");
    }

    //
    // test_parse_wrong_scheme
    //
    #[test]
    fn test_parse_wrong_scheme() {
        let url = Url::parse("https://open?server=x&token=y&connId=z&path=/f").unwrap();
        let err = SambeeUri::parse(&url).unwrap_err();
        assert!(matches!(err, UriParseError::InvalidScheme(_)));
    }

    //
    // test_parse_wrong_action
    //
    #[test]
    fn test_parse_wrong_action() {
        let url = Url::parse("sambee://close?server=x&token=y&connId=z&path=/f").unwrap();
        let err = SambeeUri::parse(&url).unwrap_err();
        assert!(matches!(err, UriParseError::InvalidAction(_)));
    }

    //
    // test_parse_missing_server
    //
    #[test]
    fn test_parse_missing_server() {
        let url = Url::parse("sambee://open?token=y&connId=z&path=/f").unwrap();
        let err = SambeeUri::parse(&url).unwrap_err();
        assert!(matches!(err, UriParseError::MissingParam("server")));
    }

    //
    // test_parse_missing_token
    //
    #[test]
    fn test_parse_missing_token() {
        let url = Url::parse("sambee://open?server=x&connId=z&path=/f").unwrap();
        let err = SambeeUri::parse(&url).unwrap_err();
        assert!(matches!(err, UriParseError::MissingParam("token")));
    }

    //
    // test_parse_missing_conn_id
    //
    #[test]
    fn test_parse_missing_conn_id() {
        let url = Url::parse("sambee://open?server=x&token=y&path=/f").unwrap();
        let err = SambeeUri::parse(&url).unwrap_err();
        assert!(matches!(err, UriParseError::MissingParam("connId")));
    }

    //
    // test_parse_missing_path
    //
    #[test]
    fn test_parse_missing_path() {
        let url = Url::parse("sambee://open?server=x&token=y&connId=z").unwrap();
        let err = SambeeUri::parse(&url).unwrap_err();
        assert!(matches!(err, UriParseError::MissingParam("path")));
    }

    //
    // test_parse_empty_param_treated_as_missing
    //
    #[test]
    fn test_parse_empty_param_treated_as_missing() {
        let url = Url::parse("sambee://open?server=&token=y&connId=z&path=/f").unwrap();
        let err = SambeeUri::parse(&url).unwrap_err();
        assert!(matches!(err, UriParseError::MissingParam("server")));
    }

    //
    // test_parse_theme_param
    //
    #[test]
    fn test_parse_theme_param() {
        // With theme
        let url = Url::parse(
            "sambee://open?server=https://example.com&token=t&connId=c&path=/f&theme=eyJtb2RlIjoiZGFyayJ9"
        ).unwrap();
        let parsed = SambeeUri::parse(&url).unwrap();
        assert_eq!(parsed.theme.as_deref(), Some("eyJtb2RlIjoiZGFyayJ9"));

        // Without theme
        let url2 = Url::parse("sambee://open?server=https://example.com&token=t&connId=c&path=/f")
            .unwrap();
        let parsed2 = SambeeUri::parse(&url2).unwrap();
        assert!(parsed2.theme.is_none());
    }

    //
    // test_parse_url_encoded_path
    //
    #[test]
    fn test_parse_url_encoded_path() {
        let url = Url::parse(
            "sambee://open?server=https://example.com&token=t&connId=c&path=%2Fdocs%2Fmy%20file.docx"
        ).unwrap();

        let parsed = SambeeUri::parse(&url).unwrap();
        assert_eq!(parsed.path, "/docs/my file.docx");
    }
}
