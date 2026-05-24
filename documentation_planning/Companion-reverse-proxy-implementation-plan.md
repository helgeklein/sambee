Implementation Plan

Goal: make Companion work through cookie-based authenticated reverse proxies by letting Companion authenticate in its own Tauri webview, then reusing that webview’s cookies in Rust reqwest calls.

1. Add A Shared Authenticated HTTP Client
Create a small Companion HTTP layer instead of each command creating its own reqwest::Client.

Files to touch:
Cargo.toml
mod.rs
file_info.rs
download.rs
upload.rs

Planned changes:

Enable reqwest’s cookies feature.
Add a new module, for example companion/src-tauri/src/http_client.rs.
Define a reusable client builder that preserves current behavior:
system-proxy
rustls-tls-native-roots
existing timeouts where needed
redirect policy control for token exchange
Support optional cookie injection via reqwest::cookie::Jar.
Replace direct Client::new() / Client::builder() calls with the shared client.
This is the foundation. Without it, webview cookies can be read but not consistently used.

2. Add Reverse Proxy Auth Detection
Keep the improved diagnostics, but turn the “login page / redirect” case into a recoverable signal.

Files to touch:
token/mod.rs

Planned changes:

Introduce a structured error enum instead of returning only String, for example:
TokenExchangeError::ProxyAuthenticationRequired { login_url, server_url }
TokenExchangeError::HttpStatus { status, body_preview }
TokenExchangeError::InvalidJson { ... }
TokenExchangeError::Network { ... }
Preserve user-facing messages, but allow start_edit_lifecycle() to branch when proxy auth is required.
Keep redirects disabled for token exchange initially. This lets Companion detect auth interception instead of silently parsing an HTML login page.
3. Create Companion Webview Auth Flow
Add a module that opens a Tauri window for proxy authentication and waits until the backend origin is reachable with cookies.

Likely new file:
companion/src-tauri/src/proxy_auth.rs

Files to touch:
lib.rs

Planned behavior:

When token exchange reports proxy auth required, open a dedicated Tauri WebviewWindow.
Navigate it to a backend URL under the same server origin.
Let the reverse proxy redirect to its login provider naturally.
Detect successful return to the backend origin.
Read cookies using WebviewWindow::cookies_for_url(server_url).
Close or hide the auth window after success.
Retry the token exchange with a reqwest client seeded with those cookies.
Important detail: we should not use the POST token endpoint as the browser navigation target. Add or choose a lightweight GET endpoint for auth probing.

4. Add A Lightweight Backend Probe Endpoint
Add a simple endpoint that Companion can load in a webview to force reverse-proxy auth and confirm return to Sambee.

Likely file:
companion.py

Proposed endpoint:

Behavior:

Return a tiny HTML or JSON success response.
Do not consume URI tokens.
Do not perform file operations.
It exists only to give the webview a stable backend URL after proxy authentication.
Why this helps:

The reverse proxy can protect this path like any normal backend path.
The auth webview has a deterministic “success URL.”
Companion can avoid trying to infer success from arbitrary frontend pages.
5. Convert Webview Cookies Into Reqwest Cookies
Implement a cookie bridge function.

Likely module:
companion/src-tauri/src/http_client.rs or proxy_auth.rs

Planned behavior:

Call webview.cookies_for_url(server_url).
Filter to cookies applicable to the backend origin.
Convert each cookie into a Set-Cookie-style string that reqwest::cookie::Jar::add_cookie_str() accepts.
Build a shared Arc<Jar>.
Build reqwest::Client::builder().cookie_provider(jar).
Use that client for:
/api/companion/token
/api/browse/{conn}/info
/api/viewer/{conn}/download
/api/companion/{conn}/lock
heartbeat
upload
release lock
This should include secure handling:

Never log cookie values.
Log only cookie names/domains/counts.
Avoid persisting proxy cookies unless we deliberately decide to cache them.
6. Retry Flow In Edit Lifecycle
Update start_edit_lifecycle() in lib.rs.

New flow:

Try token exchange with unauthenticated client.
If it succeeds, continue as today.
If proxy auth is required, open webview auth.
Extract cookies.
Retry token exchange using cookie-enabled client.
Pass that same client or auth context through the rest of the edit lifecycle.
If cookies expire mid-lifecycle, surface a clear “reauthenticate” prompt and retry only idempotent operations automatically.
This likely requires changing command functions to accept a client/auth context rather than constructing their own clients.

7. UX And Failure Handling
The auth window should be boring and clear.

Planned behavior:

Title: “Sambee Authentication”
Open only when needed.
Show the actual proxy/browser login page.
If auth succeeds, close automatically.
If the user closes the window, abort native editing with a clear message.
Add timeout, for example 5 minutes.
If cookies are read but retry still gets redirected, report:
auth completed but no usable backend cookie was available
likely proxy cookie domain/path configuration issue
Do not show cookie values anywhere.

8. Platform Constraints
Implement for desktop targets only.

Key Tauri caveats to code around:

Tauri says cookies_for_url() includes HTTP-only and secure cookies.
Android returns empty cookies, irrelevant for Companion desktop.
Windows can deadlock if cookie reads happen from synchronous commands/event handlers. Use async flow / separate task, not a synchronous Tauri command.
9. Tests
Add focused tests where practical.

Rust unit tests:

Cookie conversion preserves name/value/domain/path/secure/httpOnly attributes where available.
Token exchange branches on redirect/login-page into ProxyAuthenticationRequired.
Token exchange retry uses cookie jar.
HTTP client builder keeps redirects disabled for token exchange but normal behavior elsewhere.
Integration-ish tests with mock HTTP server:

First /api/companion/token returns redirect to /login.
Auth probe sets a cookie.
Retried token exchange succeeds when cookie is present.
Download/upload/lock calls include cookies plus Sambee bearer token.
Manual verification:

Existing no-proxy local setup still works.
Reverse-proxy setup opens auth webview and completes native editing.
Expired proxy session triggers auth window again.
User closing auth window cancels cleanly.
Validation commands:

10. Documentation
Update Companion architecture docs because this changes the trust model.

Likely doc:
index.md

Document:

Browser-to-Companion HMAC pairing remains separate.
Sambee bearer token remains separate.
New proxy-cookie path exists only inside Companion-owned Tauri webview.
External browser cookies are not read.
Reverse proxy cookies are not logged.
Reverse proxy compatibility requirements:
cookie must be valid for backend origin
auth flow must work in embedded webview
proxy must not require browser features unavailable in system webview
Recommended Implementation Order

Refactor shared reqwest client without changing behavior.
Add structured token exchange errors.
Add backend auth probe endpoint.
Add webview auth module and cookie extraction.
Wire retry into edit lifecycle.
Convert remaining edit lifecycle calls to shared cookie-enabled client.
Add tests and docs.
Test with both local no-proxy and real Caddy-auth deployment.
