+++
title = "Browser-to-Companion Trust Model"
+++

The browser-to-companion boundary is powerful because it crosses from the browser app into desktop-local capability. That makes it one of the most security-sensitive parts of Sambee.

## Two Distinct Trust Paths

Sambee uses two browser-to-companion interaction models.

### Deep-Link Editing Path

This path is used when the browser asks the companion to open an SMB-backed file in a native desktop app.

1. The browser asks the backend for a short-lived URI token.
1. The browser launches a `sambee://` deep link.
1. Companion exchanges the one-time token for a session token.
1. Companion downloads the file, acquires the edit lock, and later uploads the result.

Companion sends the URI token to the backend token endpoint in a JSON request body. Do not reintroduce query-string token exchange compatibility; deep-link tokens are sensitive and should not be exposed in URLs, logs, proxy access logs, or browser history.

The deep-link token is not a general browser-to-companion credential. It is a short-lived bootstrap value for one native-editing handoff.

### Localhost API Path

This path is used for local-drive access and related browser-to-desktop features.

1. the browser probes `http://localhost:21549/api/health`
1. browser and companion perform an explicit pairing flow
1. the browser uses authenticated localhost requests for local-drive operations
1. the companion sends directory-change notifications over a paired WebSocket channel

## Why Pairing Exists

Localhost alone is not a trust boundary.

The companion therefore requires explicit pairing and per-request authentication so that:

- remote network clients cannot reach it
- arbitrary websites cannot use it just because they run in the browser
- local native processes do not gain the browser's paired privileges automatically

## Pairing Model

The pairing flow is deliberately shaped like numeric-comparison pairing.

- the browser and companion exchange nonces
- both sides independently derive the same short pairing code
- the user confirms the match in both places
- the companion returns a shared secret only after dual confirmation succeeds

That dual confirmation step is what turns “something can reach localhost” into “the user intentionally paired this browser origin with this desktop app.”

## Request Authentication after Pairing

After pairing, companion-bound requests use HMAC-based authentication rather than the server's bearer-token flow.

- localhost API requests carry an HMAC derived from the shared secret and a timestamp
- the companion rejects requests outside the allowed clock window
- pairing is tracked per browser origin, not as one global switch
- the shared secret is stored in OS-protected credential storage on the companion side

## Trust Boundaries Contributors Must Preserve

- keep the companion bound to `127.0.0.1`
- do not relax CORS rules casually
- do not replace explicit pairing with silent trust-on-first-use behavior
- keep browser-to-companion auth distinct from backend bearer-token auth
- preserve the server-side edit-lock lifecycle for SMB-backed editing instead of letting the companion bypass it
- keep reverse-proxy cookies distinct from Sambee bearer tokens and companion localhost pairing secrets
- redact deep-link tokens, sessions, cookies, authorization data, and other sensitive query values before logging

Reverse-proxy authentication is a separate trust path from localhost pairing. The companion may use cookies captured in its own backend-origin authentication webview for Rust-side backend requests, but it must not import cookies from the user's normal browser session.

## What Changes Are High Risk

- anything that alters token exchange or deep-link parsing
- anything that changes pairing confirmation rules
- anything that weakens HMAC validation, timestamp checking, or origin scoping
- anything that blurs the distinction between local-drive workflows and SMB-backed edit workflows

## Where the Main Logic Lives

| Path | Responsibility |
|---|---|
| `companion/src-tauri/src/server/auth.rs` | localhost API authentication |
| `companion/src-tauri/src/server/pairing.rs` | pairing flow and secret lifecycle |
| `companion/src-tauri/src/uri/` and `token/` | deep-link parsing and token exchange support |
| `frontend/src/services/companion.ts` | browser-side pairing and companion communication |
| `frontend/src/services/backendRouter.ts` | routes browser requests to backend or companion appropriately |

## Validation Expectations

When this trust model changes, do not validate only the companion.

Run at least:

```bash
cd companion && npx tsc --noEmit
cd companion && npm run lint
cd companion/src-tauri && cargo test
cd frontend && npm test
cd frontend && npx tsc --noEmit
```

If the change alters SMB edit flows, add the relevant backend checks too.
