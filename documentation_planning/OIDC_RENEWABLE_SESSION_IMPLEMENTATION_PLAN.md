# Renewable OIDC Sessions and Draft Recovery Plan

## Status

Planning complete. This document defines the renewable OIDC-session behavior to implement. It is not end-user documentation.

## Objective

For OIDC users, Sambee must:

1. Refresh a short-lived Sambee API token in the background, normally at half of its lifetime, without navigating away from Sambee.
2. Permit a user returning after days of inactivity to resume without an interactive redirect while the administrator-configured maximum interactive session age is still valid.
3. Require a verified, interactive OIDC authentication after that maximum age, defaulting to 30 days, or when security policy requires it.
4. Preserve unsaved Markdown and text-editor work before every unavoidable top-level OIDC redirect.

The result must work with a confidential Authelia OIDC client and must never expose an IdP refresh token to JavaScript, browser storage, URLs, logs, audit events, or API responses.

## Confirmed Current Behavior

- `POST /api/auth/oidc/exchange` always returns a Sambee JWT with a fixed 60-minute lifetime.
- The OIDC code exchange validates the provider response but discards its refresh token.
- Any API `401` clears `localStorage.access_token` and navigates to `/login`; in OIDC-only mode `/login` immediately redirects to the IdP.
- Markdown and text editor drafts live only in React state, so a top-level redirect destroys them.
- `User.token_version` already invalidates existing Sambee browser JWTs when users, mappings, or relevant OIDC policy change.

The 30-60 minute redirect therefore originates in Sambee's fixed OIDC JWT lifetime, not necessarily in Authelia.

## Agreed Policy

| Policy | Value | Notes |
| --- | --- | --- |
| Sambee OIDC API token lifetime | 60 minutes initially | Keep short-lived bearer tokens. Make it a named backend constant, not a magic value. |
| Normal background refresh | Half the token lifetime | Schedule at 30 minutes for a 60-minute token. Add only a small bounded jitter. |
| Retry safety margin | 5 minutes before token expiry | Retry only pre-token-grant failures with bounded backoff while this margin remains. Never replay a refresh token after an ambiguous token-grant outcome. |
| Maximum interactive OIDC session age | Administrator configured; default 30 days | Measured from verified OIDC `auth_time`, not callback time. Refreshes never extend it. At the deadline Sambee requires `prompt=login`, `max_age=0`, and a fresh `auth_time`. |
| OIDC browser-session lifetime | Same absolute deadline | Session cookie and server record expire at this time. |
| API-token browser storage | Memory only | Never persist an API bearer token in `localStorage` or `sessionStorage`; recover it on application startup through the HttpOnly OIDC-session cookie. |
| Draft persistence | `sessionStorage`, tab-scoped | Never use `localStorage` for potentially sensitive file content. |

Refresh when the visible tab becomes active, gains focus, or returns online if it is already past the halfway point. Pause periodic refresh timers while hidden; background timers are throttled and hidden tabs should not keep a session alive merely by existing. A request that needs a near-expiry token still awaits the shared refresh operation.

## Architecture Decision

Use a server-side renewable OIDC session:

```mermaid
sequenceDiagram
    participant Browser
    participant Sambee
    participant Authelia

    Browser->>Sambee: OIDC authorization-code callback
    Sambee->>Authelia: Exchange code, PKCE, client_secret_basic
    Authelia-->>Sambee: ID/access/refresh token set
    Sambee->>Sambee: Validate identity; encrypt refresh token in pending session
    Browser->>Sambee: Exchange one-time Sambee login grant
    Sambee-->>Browser: Short-lived API JWT + HttpOnly opaque session cookie
    Browser->>Sambee: POST /api/auth/oidc/refresh at half-life
    Sambee->>Authelia: Refresh-token grant
    Authelia-->>Sambee: Rotated token set
    Sambee-->>Browser: Fresh short-lived API JWT
```

The browser holds two separate credentials:

- A short-lived Sambee API JWT, held only in JavaScript memory and sent in the existing bearer-token integration. OIDC JWTs carry the opaque browser-session ID (`sid`); every protected request validates that this session is active and has not reached its absolute deadline, so logout and revocation invalidate already-issued OIDC JWTs immediately.
- A `Secure`, `HttpOnly`, host-only opaque OIDC-session cookie, used only for the refresh and logout endpoints. Use a `__Host-` cookie name, `Path=/`, no `Domain`, `SameSite=Strict` unless a deployment requirement establishes that `Lax` is needed, and `Max-Age` no later than the absolute session deadline.

The browser must never receive the IdP refresh token. On application startup or after a full page reload, the auth-session manager obtains a new in-memory API JWT through the cookie-authenticated refresh endpoint before calling protected APIs. In production, Sambee API traffic must remain same-origin so the host-only cookie is meaningful. The existing cross-origin development/test API mode needs explicit test configuration, not a production exception.

## Provider and Operator Prerequisites

1. Request the standard `offline_access` scope in addition to `openid`, `profile`, `email`, and optional `groups`.
2. Configure the Authelia client to allow both `authorization_code` and `refresh_token` grants.
3. Configure the client-specific Authelia **refresh-token** lifespan to be at least the selected Sambee maximum interactive age, plus named clock-skew and maintenance headroom. Keep Authelia access-token and ID-token lifespans short; every successful refresh provides a current token set and does not require those token types to last 30 days.
4. Configure Authelia's session `expiration` or `remember_me` policy for the desired later interactive-authentication experience. This browser session does not authorize Sambee's server-to-server refresh-token grant, but it can make the eventual forced reauthentication smoother or require the user to sign in earlier when the provider's own policy requires it.
5. Expect the initial authorization that requests `offline_access` to require provider consent. That is an IdP/OIDC requirement, not a repeat background interaction.

Sambee's OIDC configuration requires `offline_access` whenever renewable sessions are enabled. **Connect and test** must report an actionable error when the provider does not return a refresh token, because Sambee cannot provide the required background-refresh behavior without it. It must also confirm that the provider supports the authorization-code and refresh-token grants, accepts PKCE S256, and returns a valid `auth_time` when `max_age` is requested.

## Administrative Configuration

Add `interactive_reauthentication_max_age_days` to the database-owned OIDC configuration, with a default of 30 and validated lower and upper bounds defined as named constants. It belongs in:

- `OidcProviderConfiguration`.
- `OidcConfigurationCandidate`, `RedactedOidcConfiguration`, normalization, review, and finalization models.
- The OIDC authentication settings page, adjacent to sign-in/session policy, with the value expressed in days.

Changing this setting does not itself require a new IdP connection test and does not invalidate every active session. The refresh endpoint recalculates the deadline from the original, validated `auth_time` using the current configured value. Reducing it can therefore require reauthentication at the next protected request or refresh; increasing it can extend a still-valid session only up to the provider's refresh-token lifetime.

`offline_access` is mandatory only for an OIDC mode that enables renewable sessions. Keep its validation separate from generic OIDC scope validation so the error clearly explains the operator action required.

## Backend Work Plan

### 1. Add explicit token timing to the API contract

Extend the existing login response and frontend `AuthToken` type with `access_token_expires_at` in UTC. The current `expires_at` field is the local user-account expiry and must not be reused for token scheduling.

Update `_build_login_response` so OIDC exchange and refresh responses both provide the token expiry. Retain the current 60-minute OIDC token lifetime as `OIDC_ACCESS_TOKEN_LIFETIME_MINUTES`. All Sambee endpoints that return an API JWT, including password login and OIDC grant exchange, must return `Cache-Control: no-store` and `Pragma: no-cache`; no token-bearing response is cacheable.

Extend `build_user_access_token` to accept an OIDC browser-session ID and emit it as `sid` only for OIDC JWTs. The existing authentication dependency must load and validate that session on every request carrying an OIDC `sid`: it must be active, belong to the JWT subject, match the recorded user token version, and remain before `absolute_expires_at`. A revoked or expired session produces the same machine-readable reauthentication outcome as the refresh endpoint. Password JWT behavior remains unchanged.

### 2. Create a per-browser OIDC session record

Add an `OidcBrowserSession` model. A record must include at least:

- UUID primary key.
- User ID and the user's `token_version` snapshot.
- OIDC provider configuration revision and identity-mapping revision snapshots.
- Original OIDC issuer and subject, verified `authenticated_at` from the ID-token `auth_time`, `absolute_expires_at`, `last_refreshed_at`, and `last_seen_at`.
- A hash of a high-entropy browser session secret. The cookie value should contain the row ID and secret; only the secret hash is persisted.
- The IdP refresh token encrypted with a separate, domain-separated OIDC session cipher and the cipher-key ID used to encrypt it. The cipher is a keyring: new tokens use the active key, retired keys remain decrypt-only until no session uses them, and successful refreshes re-encrypt with the active key. Losing a key permanently revokes only sessions using that key without logging token material.
- Refresh generation, last completed generation, a short-lived refresh lease, and a recorded refresh outcome to coordinate concurrent refreshes from tabs and server workers.
- Pending, active, refresh-uncertain, and revoked state; pending-grant expiry; revocation timestamp; and a non-sensitive revocation reason.

Create a pending session after a successful OIDC callback, not during the later frontend grant exchange: that callback is the only point where the IdP refresh token is available. Associate the pending session with the existing one-time OIDC flow/grant and activate it atomically during `/oidc/exchange`, where Sambee can set the opaque cookie and issue an OIDC JWT carrying that session's `sid`. If the request presents an older Sambee browser-session cookie, revoke that session after the replacement activates; this prevents same-browser session fixation while retaining other devices. Delete pending rows when their login grant expires or fails.

Do not put a refresh token on `OidcProviderConfiguration`, which is a singleton provider definition and not a user/device session. Do not add it to the existing `OidcFlow` row, which is intentionally a short-lived flow record with strong no-token retention rules.

### 3. Extend the OIDC client service

Refactor `exchange_and_validate_callback` to return a typed validated token set containing claims, ID-token `auth_time`, access token where needed for userinfo, and refresh token. Keep normal test-flow tokens in memory only; validate that a test requesting renewable sessions actually receives a refresh token.

Extend the authorization-flow record with a server-issued purpose of normal login, provider test, or forced reauthentication. The browser must never be allowed to select that purpose through a query parameter. Every user login requests `max_age` equal to the current configured maximum age, which requires an ID-token `auth_time` and prevents Sambee from starting a renewable session from an already-too-old IdP authentication. A forced reauthentication additionally sends `prompt=login` and `max_age=0`; its callback must reject a missing, malformed, future, or insufficiently fresh `auth_time` before it updates `authenticated_at`. This is the only event that resets the maximum interactive-authentication deadline.

Continue to use authorization code plus PKCE S256, transaction-bound `state`, and a one-time nonce. Require the normal authorization-code ID token to match that nonce before using any token or claim. Do not impose a nonce requirement on an ID token returned by a refresh-token grant, because OIDC defines that such a token may omit it.

Add a refresh-token exchange function that:

- Loads discovery metadata through the existing SSRF-safe HTTP client.
- Sends `grant_type=refresh_token` using `client_secret_basic`.
- Applies existing response-size limits and validates response structure without logging provider payloads.
- Validates an ID token when present without imposing an authorization-code nonce requirement; otherwise resolves identity claims through authenticated userinfo and verifies the returned subject against the session's original issuer/subject.
- Re-evaluates admission, role assignment, user activity, expiry, and the local immutable identity link on every successful refresh.
- Atomically stores a returned rotated refresh token. If a provider intentionally omits a replacement, retain the prior token only when its documented behavior permits it; Authelia rotation should return a replacement.

Represent permanent provider rejection, session deadline expiry, configuration/mapping change, refresh outcome uncertainty, and transient metadata/provider failure as distinct internal error categories. External responses must stay generic and stable.

### 4. Add refresh and logout endpoints

Add `POST /api/auth/oidc/refresh`:

1. Read and validate the opaque session cookie; the endpoint must not depend on the expired bearer JWT.
2. Reject missing, revoked, pending, expired, stale-token-version, stale-configuration, disabled, or locally expired sessions.
3. Enforce `authenticated_at + interactive_reauthentication_max_age_days` before contacting the IdP.
4. Acquire the durable per-session refresh lease and capture the refresh generation. A concurrent request waits briefly; if it observes a completed later generation, it skips the IdP call and issues its own fresh Sambee JWT from the validated session. It must never use the old refresh token in parallel.
5. Refresh at the IdP, re-evaluate identity and authorization, persist rotation and the completed generation atomically, then issue a fresh Sambee JWT carrying the session `sid`.
6. Return `Cache-Control: no-store`, `Pragma: no-cache`, and the explicit API-token expiry. Clear and revoke the cookie only for permanent invalidation, not for ambiguous network failures.

Use a machine-readable `oidc_reauthentication_required` response for expired absolute sessions and permanent refresh-token rejection. Use a distinct transient response for failures that occur before a token-grant request is sent, such as discovery or connection setup. Once the refresh-token request might have reached the IdP, mark the session `refresh-uncertain`, retain the current Sambee JWT only until its normal expiry, and do not submit the old refresh token again. The default is to treat every exception from the token-grant transport as ambiguous unless the HTTP client can prove no request bytes were sent. Browser retries of `/refresh` must see that state rather than causing another IdP request; after the current API JWT expires, require normal reauthentication.

Add `POST /api/auth/oidc/logout` to revoke the cookie's active session and clear the cookie. The frontend logout flow must call it before clearing local state and navigating to `/login`. A password-only or no-auth configuration can return a harmless success response while retaining current behavior.

Use `POST` only for cookie-authenticated refresh and logout. For production's same-origin deployment, require an exact match between the request `Origin` and the configured public origin; when `Origin` is absent, require an exact same-origin `Referer`; reject requests with neither header. Keep `SameSite=Strict` as defense in depth. Do not enable credentialed cross-origin production API access. Development and test cross-origin mode must use an explicit allowlist and an integration test, never a wildcard origin. Rate-limit refresh independently from login, while avoiding a limit so low that normal multi-tab activity becomes a self-inflicted logout.

### 5. Apply existing revocation rules to renewable sessions

The refresh endpoint must compare its stored user `token_version` snapshot to the current user. Existing token-version changes immediately invalidate bearer tokens and prevent the OIDC session from minting another one.

Store and validate provider configuration revision as well. Relevant OIDC policy changes already increment user token versions for affected users; mark a session revoked on its next refresh and clean it up. A future centralized revocation helper may proactively mark records, but correctness must not depend on every user-management call site remembering to use it.

Configuration changes that change issuer, client, claim mapping, scopes, admission, or roles must continue to invalidate relevant sessions. Client-secret-only rotation and display-name changes should retain the established behavior unless the provider makes refresh impossible.

Add concise audit events for session creation, refresh success, refresh rejection category, refresh-uncertain outcome, session replacement, and logout. Include user/session correlation only through safe IDs or hashes. Do not record raw session secrets, refresh tokens, access tokens, provider payloads, or draft data.

### 6. Provide controlled session revocation

Expose a minimal authenticated account-session view backed by `OidcBrowserSession`: current-session marker, creation time, last seen time, and a privacy-preserving device label if one can be derived without retaining a full user-agent string. Provide revoke-this-session, revoke-another-session, and revoke-all-other-sessions operations. Each operation revokes the matching server sessions, clears the current cookie when applicable, and immediately invalidates their `sid` JWTs through the request-time session check. The account view must never expose refresh-token state, session secrets, provider payloads, or precise device fingerprints.

## Frontend Work Plan

### 1. Centralize token lifecycle management

Introduce a single auth-session manager owned at application startup, rather than placing timers in individual pages or the backend-recovery hook. It must:

- Keep a new API JWT and `access_token_expires_at` in memory after password login, OIDC grant exchange, or OIDC refresh. Remove the existing `localStorage.access_token` persistence; `sessionStorage` is also prohibited for bearer tokens.
- Bootstrap an OIDC session after application startup or reload by calling the cookie-authenticated refresh endpoint before protected API requests. A missing cookie is an unauthenticated state, not an error loop; a confirmed reauthentication response follows the normal login flow.
- Schedule OIDC refresh for half the issued lifetime, with a small bounded jitter only while visible. Pause its periodic timer while hidden and re-evaluate on visibility, focus, and online events.
- Refresh on visibility, focus, and online events when past that threshold.
- Before any API request using an expired or near-expiry OIDC token, await one shared refresh promise.
- Coordinate tabs through `navigator.locks` when available and `BroadcastChannel` as a fallback, so tabs do not race an IdP refresh-token rotation. Broadcast only lifecycle events and refresh generations, never bearer tokens; each tab keeps its own token in memory and the backend generation check prevents an extra IdP refresh for concurrent tabs.
- Expose explicit states: active, refreshing, transiently-unavailable, and reauthentication-required.

Only OIDC sessions should use the refresh path. Password sessions retain their current configured lifetime and login behavior.

### 2. Make the Axios `401` path refresh-aware

Refactor the global interceptor in `frontend/src/services/api.ts` so it does not immediately clear the token or set `window.location.href` on a `401`.

- Exclude public authentication endpoints and the refresh endpoint itself from recursive refresh handling.
- On the first eligible `401`, await the shared refresh manager once.
- Retry only safe/idempotent requests automatically. Do not replay writes, lock operations, saves, or other non-idempotent requests after a `401`; surface their outcome safely instead.
- When refresh succeeds, retry the original safe request with the new bearer token.
- When Sambee says reauthentication is required, ask the draft-recovery coordinator to snapshot work, preserve the safe current route, and then navigate to `/login`.
- When the error is transient, retain the token and surface the existing backend-recovery state. Do not redirect merely because Authelia is briefly unavailable.
- When the session is `refresh-uncertain`, explain that sign-in is required once the still-valid in-memory API token expires. Do not retry the IdP grant or repeatedly redirect the user.

The existing backend-recovery lock remains a separate availability concern. It must not suppress a genuine, confirmed reauthentication requirement indefinitely.

### 3. Preserve drafts before an unavoidable navigation

Build a small draft-recovery service and use it from MarkdownViewer and TextViewer.

- While editing, write a debounced tab-scoped `sessionStorage` snapshot and update it before an auth redirect or `pagehide`.
- Key snapshots by authenticated user, connection ID, normalized file path, and editor type. Include draft content, baseline content hash, creation/update time, edit mode, and cursor/selection where each editor supports safe restoration.
- Enforce a named byte limit and report a visible recovery warning if a draft cannot be stored. Do not silently claim protection when browser quota prevents it.
- On return from OIDC login, locate compatible snapshots for the return route. Fetch the current remote file, restore directly only when its content matches the stored baseline hash, and remove the snapshot after successful save or deliberate discard.
- Verify that the newly authenticated user matches the snapshot key before offering recovery. A user who signs in as a different account must never see another account's snapshot.
- On a remote change, open a recovery/conflict UI that lets the user inspect or keep the recovered draft without overwriting the remote file automatically.
- Clear snapshots on explicit discard, successful save, user logout, snapshot expiry, and after their recovery decision. Keep them long enough to survive the OIDC round trip but not indefinitely.

This protects both the planned 30-day interactive reauthentication and unavoidable failures such as a revoked refresh token. It must not depend solely on the Axios interceptor because a browser navigation or unexpected top-level sign-in action can also unmount the editor.

### 4. Preserve OIDC-only login semantics

Keep the existing one-attempt and explicit-logout markers in `oidcAuth.ts`. A successful background refresh must never visit `/login` or Authelia. When reauthentication is required, the application must finish draft snapshotting before it starts the existing OIDC-only login redirect and preserve the safe `return_path`. The server-side OIDC flow, not a frontend-controlled URL flag, decides whether that authorization request is a forced reauthentication and therefore includes `prompt=login` and `max_age=0`.

## Implementation Sequence

1. Implement the OIDC browser-session model, keyring-backed encryption, session-bound JWT validation, token-client changes, and backend unit tests.
2. Add the administrator configuration, provider-readiness validation, API contracts, provider-lifetime guidance, and frontend types.
3. Implement the central in-memory frontend refresh manager, startup bootstrap, and refresh-aware Axios behavior with focused unit tests.
4. Implement Markdown and text-editor draft persistence and recovery, with unit and browser tests.
5. Add the controlled account-session revocation view and endpoints with focused tests.
6. Write the administrator and user documentation described below.
7. Exercise the complete flow against a real Authelia staging instance, including refresh-token rotation, ambiguity handling, and a 30-day policy simulated with a short test lifetime.

Every renewable session begins with a successful authorization-code login. Sambee creates its server-side browser-session record from that login and never derives a renewable session from a bearer token alone.

## Documentation Requirements

Update the OIDC administrator guide to describe:

- The default 30-day maximum interactive-authentication age and how an administrator changes it.
- Background refresh at half the Sambee API-token lifetime. Explain that it does not navigate away from Sambee or interrupt active editing.
- The required `offline_access` scope and Authelia client `refresh_token` grant.
- The need to set the client-specific Authelia refresh-token lifetime, rather than access-token or ID-token lifetime, to at least Sambee's configured maximum age. Explain separately that Authelia session/remember-me policy affects the later interactive sign-in experience.
- The fact that logout, account or access-policy changes, provider revocation, refresh uncertainty, or the maximum interactive-authentication age can still require an interactive sign-in. At the configured deadline Sambee requests a fresh IdP login rather than silently reusing an IdP SSO session.
- The security model: IdP refresh tokens stay encrypted in Sambee, API bearer tokens stay in memory only, and server-side browser-session revocation immediately invalidates OIDC API JWTs.
- The account-session controls for reviewing and revoking browser sessions without exposing device fingerprints or token details.

Document the user-visible behavior in the appropriate user guide:

- Normal authentication refreshes are invisible.
- A deliberate reauthentication returns the user to the same Sambee route after sign-in.
- A forced reauthentication may display the IdP sign-in or MFA screen even when an IdP browser session exists; it is required by the administrator's configured maximum authentication age.
- Unsaved Markdown and text drafts are preserved across a required sign-in whenever browser storage is available.
- When the remote file changed while the user was away, Sambee presents a recovery choice and never overwrites it automatically.

## Test Plan

### Backend

- OIDC callback creates an encrypted pending browser session and no raw tokens are stored in flow, audit, or logs.
- Grant exchange atomically activates the pending session, sets the correct cookie attributes, and returns API-token expiry.
- Every Sambee API-token response has `Cache-Control: no-store` and `Pragma: no-cache`.
- A normal login requests the configured `max_age`, validates `auth_time`, and calculates its deadline from that value. A deadline-triggered flow uses server-recorded forced-reauthentication intent, sends `prompt=login` and `max_age=0`, and rejects an insufficiently fresh `auth_time`.
- Refresh succeeds at half-life, issues a new JWT, rotates the IdP refresh token, and retains the original interactive-auth timestamp.
- Parallel refresh requests from separate tabs/server workers perform one IdP refresh, advance one generation, and leave every waiting caller able to obtain a session-bound JWT without another IdP refresh.
- Missing cookie, tampered secret, revoked session, disabled/expired user, stale user token version, and stale OIDC configuration cannot mint a JWT.
- A revoked, replaced, or absolute-expired OIDC browser session invalidates an already-issued `sid` JWT on the next protected request, while password JWT behavior is unchanged.
- Absolute-session deadline produces `oidc_reauthentication_required` even if the IdP refresh token remains valid.
- A failure before the token-grant request is sent is retryable within the safety margin. An unknown token-grant outcome marks the session refresh-uncertain and proves that no subsequent request reuses the old refresh token; permanent `invalid_grant` revokes it and requires reauthentication.
- Every user/configuration invalidation path rejects the renewable session, including password changes, mapping changes, provider replacement, and password-only recovery.
- Refresh and logout enforce the exact Origin/Referer policy, rate limits, no-store headers, redacted audit data, and no credentialed wildcard CORS.
- Key rotation re-encrypts an active session token with the current cipher key; a missing retired key revokes only sessions encrypted by that key without leaking token data.
- Session-list and per-session/all-other-session revocation enforce ownership and immediately invalidate affected `sid` JWTs.

### Frontend

- API JWTs are never written to persistent browser storage; an OIDC page reload bootstraps a new in-memory token from the HttpOnly cookie without a visible navigation.
- Scheduler runs around half-life only while visible, refreshes on visible/focus/online return, and cancels timers on logout/unmount.
- Multiple simultaneous API requests and tabs share one refresh operation.
- Broadcast-channel coordination contains no bearer token and a waiting tab receives a usable JWT without causing a second IdP refresh.
- A successful refresh does not navigate or clear state.
- A safe failed request retries once after refresh; a mutation is not replayed automatically.
- A confirmed reauthentication requirement snapshots both Markdown and text drafts before navigation, retains the return path, and restores a matching baseline after sign-in.
- Changed remote content produces the conflict/recovery UI rather than an overwrite.
- Session-storage quota and expired snapshots are handled visibly and safely.
- Explicit logout calls the backend endpoint, clears token/cookie state, removes drafts, and preserves the existing OIDC signed-out screen.
- A refresh-uncertain state remains non-disruptive until the current API JWT expires, then leads to one controlled reauthentication flow.

### Browser and Provider Integration

- Run against Authelia with `authorization_code`, `refresh_token`, and `offline_access` enabled.
- Verify the active-user case refreshes repeatedly without a visible URL change.
- Verify a user returning after several idle days refreshes invisibly before the 30-day deadline.
- Verify the client-specific Authelia refresh-token lifetime supports the configured deadline while access and ID tokens remain short; deliberately test a shorter refresh-token lifetime as a graceful reauthentication case.
- Verify the deadline-triggered flow displays or requires the IdP's login/MFA interaction even with an otherwise active IdP browser session, and that an ordinary background refresh never does.
- Simulate an ambiguous refresh-token HTTP outcome and prove the old token is never retried.
- Verify a Markdown and text draft survives the controlled interactive reauthentication flow.

## Review Findings and Resolved Decisions

1. **Refresh data location:** The refresh token exists at the OIDC callback, not at the frontend grant-exchange endpoint. The design therefore creates a pending per-browser session at callback and activates it when the one-time grant is exchanged.
2. **No shared provider token field:** A refresh token must be per user and browser session. Storing it on the singleton provider configuration would be both incorrect and unsafe.
3. **Expiry API ambiguity:** The existing `expires_at` means account expiry. A separate API-token expiry is required for deterministic half-life scheduling.
4. **Logout and revocation gap:** Current logout only clears browser storage. It must revoke the server session, clear the cookie, and invalidate OIDC JWTs carrying that session `sid` so a stolen cookie or already-issued API JWT cannot continue access.
5. **Rotation concurrency:** Authelia revokes the previous refresh token during refresh. Client-only coordination is insufficient; a durable server-side lease and refresh-generation check are required so concurrent callers cause one IdP refresh and receive usable local JWTs without another rotation.
6. **Provider independence:** Sambee's deadline is calculated from validated IdP `auth_time`. The Authelia refresh-token lifespan must support that duration; its browser-session policy affects the later interactive experience but does not authorize server-to-server refresh. Documentation must distinguish those controls rather than promising a deadline Sambee cannot enforce against the IdP.
7. **Unsaved-work scope:** The current risk affects both MarkdownViewer and TextViewer. A reusable coordinator is preferable to a Markdown-only patch.
8. **Security boundary:** `offline_access` is necessary for the inactive-days scenario. It must be requested only after the operator knowingly configures the IdP client, and the token must remain encrypted server-side.
9. **Forced reauthentication semantics:** A redirect alone is not an authentication prompt because an IdP can silently reuse its browser session. A normal login requests the configured `max_age`; a deadline-triggered flow must be server-marked, send `prompt=login` and `max_age=0`, and verify the returned `auth_time` before it resets the deadline.
10. **Unknown refresh outcome:** After the refresh-token request might have reached the IdP, retrying the old token can be interpreted as replay and revoke the rotated token. The session therefore enters `refresh-uncertain`, permits no second IdP grant with that token, and requires controlled reauthentication after the current API JWT expires.
11. **Bearer-token exposure:** Protecting the IdP refresh token is insufficient if an XSS can persistently extract Sambee API JWTs. OIDC API JWTs are memory-only; reload recovery uses the HttpOnly session cookie.
12. **Cookie-authenticated endpoint CSRF:** `SameSite=Strict` is defense in depth, not the only control. Refresh and logout use exact Origin validation with exact same-origin Referer fallback and reject missing provenance.
13. **At-rest secret lifecycle:** Encrypted refresh tokens require a domain-separated keyring with key IDs, active-key re-encryption, and scoped revocation on key loss or retirement.
14. **User control:** Per-browser sessions require a privacy-preserving session list and immediate, user-directed single-session or all-other-session revocation.

## Implementation Acceptance Criteria

The work is complete when an OIDC-only user can continuously use Sambee for a normal workday without an Authelia URL transition at the 60-minute token boundary; can return after several days and resume through a background refresh; is explicitly prompted by Authelia to authenticate at the configured 30-day deadline even when an IdP browser session exists; and can recover unsaved Markdown or text edits when a real reauthentication redirect is unavoidable. Logout, session revocation, and the absolute deadline must invalidate an OIDC API JWT immediately, while normal reloads recover an in-memory JWT without persisting it in browser storage.
