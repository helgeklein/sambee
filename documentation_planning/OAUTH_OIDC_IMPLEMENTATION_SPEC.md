# OAuth/OIDC Authentication Implementation Specification

## Status

- **Purpose:** implementation proposal for review
- **Scope:** the OAuth/OIDC items under `TODO.md` > Authentication system
- **Target:** one standards-compliant OpenID Connect provider in the first release
- **Decisions:** product and security choices are recorded in [Resolved Decisions](#resolved-decisions)

## Goals

Add OpenID Connect (OIDC) as a Sambee authentication method alongside the existing `password` and `none` modes. Administrators must be able to configure the provider in the Sambee UI, validate the configuration, optionally auto-provision users, and map provider groups to Sambee roles.

The implementation must:

- use the OIDC Authorization Code Flow with PKCE
- validate the provider, authorization response, ID token, and user identity server-side
- preserve Sambee's existing JWT as the application session token after login
- support one OIDC provider initially without blocking a future multi-provider design
- store the client secret encrypted at rest and never return it through an API
- keep the OIDC client-secret encryption key outside the application database
- prevent an administrator from accidentally leaving the instance with no usable login method
- identify federated users by immutable OIDC `iss` and `sub` claims, not email or username
- make provisioning and role-mapping behavior deterministic and auditable
- include an end-to-end Authelia configuration example in the administrator documentation

## Non-goals

The first implementation will not:

- implement generic OAuth 2.0 login without OIDC
- act as an OAuth/OIDC provider for other applications
- support multiple simultaneous identity providers
- implement SAML, LDAP, SCIM, device authorization, or token exchange
- use provider access tokens to authorize Sambee API calls
- synchronize group membership outside login
- automatically delete users when they disappear from the identity provider
- replace Sambee's JWT/session model or local authorization checks
- guarantee that a metadata-only configuration test can prove an interactive user login will succeed

## Terminology

- **Local user:** a row in Sambee's `User` table.
- **Federated identity:** the stable pair `(issuer, subject)` from the OIDC `iss` and `sub` claims linked to a local user.
- **Auto-provisioning:** creating a local user after a valid OIDC login when no identity link exists.
- **Role synchronization:** recalculating a linked user's Sambee role from OIDC group claims at login.
- **Recovery login:** a local password login retained so an IdP outage or bad OIDC configuration does not lock out all administrators.

## Current State

### Backend

- `AuthMethod` supports `password` and `none`.
- `GET /api/auth/config` publicly exposes only `auth_method`.
- `POST /api/auth/token` verifies a local password and returns a Sambee JWT.
- Protected HTTP and WebSocket paths resolve that JWT to a local `User` and verify `token_version`, activity, and expiry.
- `none` mode resolves requests to the configured local admin user.
- User roles are `admin`, `editor`, and `viewer`; admin capabilities protect user and system settings APIs.
- Runtime system settings already support database overrides, but that generic string key/value model is not suitable for an atomic OIDC configuration containing an encrypted secret and structured mappings.
- App-level signing and encryption keys currently live in the database. OIDC client-secret encryption must use a separate environment-supplied key so a database backup alone cannot decrypt the client secret.
- Database migrations are explicit, ordered, and idempotent.

### Frontend

- The login page supports only username/password and redirects directly to the browser when auth mode is `none`.
- The frontend stores the Sambee JWT in `localStorage`; Axios and server WebSocket connections use it.
- Admin settings already have role-gated navigation and API patterns for user and advanced system settings.

### Architectural consequence

OIDC should establish or resolve a local `User`, then issue the same Sambee JWT used by password login. This keeps authorization, API clients, WebSockets, companion launch tokens, user settings, expiry checks, and token revocation on the existing code path.

## Proposed User Experience

### Administrator configuration

Add **Settings > Administration > Authentication**. The page contains:

1. **Sign-in methods**
   - OIDC enabled toggle
   - Local password login enabled toggle
   - warning when a change could remove the current administrator's login path
2. **Provider**
   - display name
   - issuer URL
   - client ID
   - client secret with `Set new secret`/`Replace secret` behavior
   - scopes, defaulting to `openid profile email groups`
3. **Identity claims**
   - username claim
   - display-name claim
   - email claim
   - groups claim
4. **Provisioning**
   - auto-provision users toggle
   - default role for a provisioned user with no matching group
5. **Role mapping**
   - zero or more exact group names for `admin`, `editor`, and `viewer`
   - role mappings synchronize on every OIDC login when at least one mapping is configured
6. **Actions**
   - **Validate configuration**
   - **Save**

The client secret is write-only. A read response exposes only `client_secret_configured: true|false`. Leaving the replacement field empty preserves the existing secret.

### Login

- If OIDC is enabled, show **Sign in with {provider display name}**.
- If password login is enabled, retain the username/password form.
- If only OIDC is enabled, make the OIDC action primary and do not render password fields.
- If auth mode is `none`, retain the current direct redirect behavior.
- Authentication errors return to the login page with a stable error code and a user-safe message. Provider responses, tokens, claim values, and secrets must not be placed in the URL or rendered verbatim.

### User management

Show linked authentication types on each user: `Local password`, `OIDC`, or both. For OIDC-linked users, show the provider display name and last successful OIDC login. Do not expose the OIDC subject in the default UI.

Password reset is hidden for OIDC-only users. An administrator may instead use an explicit **Add local password** action that converts the account to mixed authentication, requires confirmation, and writes an audit event. Disabling or expiring a local user continues to block OIDC login and must not be undone by auto-provisioning.

Password recovery uses a separate, documented recovery URL rather than adding visual noise to the primary OIDC login. It is available only to local-password accounts and does not bypass normal password verification, activity, expiry, rate limiting, or token-version checks.

## Authentication Flow

### Start authorization

`GET /api/auth/oidc/authorize?return_to=/browse/...`

1. Confirm OIDC is enabled and has a complete saved configuration.
2. Allow only relative, application-owned `return_to` paths; otherwise use `/browse`.
3. Generate cryptographically random `state`, `nonce`, and PKCE verifier values.
4. Persist a short-lived, one-time `OidcAuthorizationTransaction`:
   - hash of `state`
   - encrypted PKCE verifier
   - encrypted nonce, or a hash if the selected OIDC library can validate from the original safely
   - flow purpose: `login`, `link`, or `test`
   - initiating local user ID for `link` and initiating admin ID for `test`
   - authentication-configuration version
   - sanitized return path
   - creation and expiry timestamps
5. Build the provider authorization URL from discovered metadata using `response_type=code`, `scope`, `state`, `nonce`, `code_challenge`, and `code_challenge_method=S256`.
6. Return an HTTP redirect to the provider.

Transactions expire after five minutes, are consumed atomically, and are deleted after success or terminal failure. A periodic or opportunistic cleanup removes expired rows.

### Callback

`GET /api/auth/oidc/callback?code=...&state=...`

1. Reject missing, malformed, expired, already-consumed, or unknown state.
2. Atomically consume the transaction before exchanging the code.
3. Reject provider error responses with a generic user-facing error and a specific server log event.
4. Exchange the authorization code using the client credentials and PKCE verifier.
5. Validate the ID token using the OIDC library:
   - signature against provider JWKS
   - expected issuer
   - client ID audience and authorized-party semantics
   - expiry and issued-at constraints with bounded clock skew
   - transaction nonce
   - required `sub` claim
6. Use ID-token claims by default. Call UserInfo only when a configured required claim is absent and the provider advertises a UserInfo endpoint. If UserInfo is called, require its `sub` claim to exactly equal the validated ID-token `sub`; otherwise fail the login.
7. Resolve the local user and role as described below.
8. Reject inactive or expired local users.
9. Create a random, single-use `OidcLoginGrant`, store only its hash, and redirect to a frontend callback route with the plaintext grant in the URL fragment. Do not issue a Sambee JWT in the callback.

Example redirect:

```text
/login/oidc/callback#grant=<single-use-random-value>
```

The fragment avoids normal server and proxy request logs. The callback page immediately removes it from browser history and exchanges it through `POST /api/auth/oidc/exchange`. The grant expires after 60 seconds and can be used once. The exchange atomically consumes the grant, reloads the local user, rechecks activity, expiry, token version, and authentication-configuration version, and only then issues a Sambee JWT. It returns the same login response shape as password authentication, after which the frontend stores the Sambee JWT through its existing path.

Do not put the Sambee JWT, provider authorization code, ID token, or access token in the redirect URL.

### Identity resolution

Use this order:

1. Normalize the validated issuer according to OIDC issuer comparison rules and read `sub` as an opaque, case-sensitive string.
2. Find `OidcIdentity` by the unique `(issuer, subject)` pair.
3. If found, load its local user. Never silently re-link it to another local user.
4. If not found and explicit account linking has been approved and completed, use that link.
5. If not found and auto-provisioning is disabled, reject login with `oidc_user_not_provisioned`.
6. If not found and auto-provisioning is enabled, create the local user and identity link in one database transaction.

Email, preferred username, and display name are mutable profile attributes. They must not be used to automatically link an unknown OIDC identity to an existing user.

### Explicit identity linking

Linking is a separate authenticated flow and must never be inferred from a normal login:

1. A signed-in local-password user selects **Link OIDC account** and re-enters their current password.
2. `POST /api/auth/oidc/link/authorize` verifies the password and current user state, then creates a five-minute authorization transaction with purpose `link`, bound to that user ID and the current authentication-configuration version.
3. The normal OIDC protocol checks run during callback. The callback does not create or move an identity link.
4. If `(issuer, subject)` is already linked to any user, the flow fails without revealing the other account.
5. The callback creates a one-time pending-link grant bound to the initiating user and redirects to a confirmation page. The page may show validated display name/email for recognition but never the raw subject.
6. The user explicitly confirms. The authenticated confirmation endpoint verifies that the current user matches the initiating user, atomically consumes the grant, rechecks the uniqueness constraints and user state, creates the link, increments `token_version`, and returns a replacement Sambee JWT so the user remains signed in.

Canceling, signing out, changing users, expiry, replay, or an authentication-configuration change invalidates the flow. Administrators may unlink an identity with confirmation and an audit event, but cannot enter or reassign a provider subject manually. Self-service linking is included in the first release; admin-initiated linking is not.

### Provisioning

For a new identity:

- require non-empty configured username and subject claims
- normalize the proposed username using the existing local username rules
- reject a collision with an existing username and direct the user to link the account or ask an administrator to resolve the local username
- set name and email from configured claims when valid
- set `password_hash` to `NULL` for an OIDC-only user
- set `must_change_password=false`
- set `is_active=true`
- leave `expires_at=NULL`
- calculate the role before inserting the user
- insert `User` and `OidcIdentity` atomically

An invalid or missing optional profile claim does not invalidate a login; it is omitted and logged at debug level without its raw value. A missing required username or groups claim produces a stable configuration/claims error.

### Existing linked users

On every successful OIDC login:

- update `last_login_at` on the identity
- update name and email from the provider; per-user profile overrides are not supported in the first release
- when at least one role mapping is configured, recalculate the role from provider groups; manual role overrides are not supported in this mode
- increment `User.token_version` if the synchronized role changes, invalidating older Sambee tokens
- preserve `is_active`, `expires_at`, and local password state
- never reactivate, unexpire, or delete an account automatically

### Role resolution

Treat a missing groups claim as an error when group mapping or role synchronization is enabled. Accept only a string array; do not split a single string on commas or whitespace.

Normalize configured and received group values by trimming surrounding whitespace, applying Unicode NFKC normalization, and then Unicode case folding. Preserve the original configured value for display. This provides case-insensitive exact matching without prefixes, regular expressions, or inferred hierarchy.

For each login:

1. Compare normalized group values using exact equality.
2. Collect all matching Sambee roles.
3. If multiple roles match, select the highest privilege: `admin` > `editor` > `viewer`.
4. If no role matches during provisioning, assign the configured default role.
5. If no role matches for an existing user during synchronized login, demote the user to the configured default role.

Store mappings as structured JSON validated by a typed model. Reject empty normalized names and deduplicate normalized group names. Reject the complete configuration if two displayed values normalize to the same group but map to different roles; show the collision in validation before save. Log the resulting role and whether it changed, but do not log the user's full group list.

## Data Model

### `OidcProviderConfiguration`

A singleton table for the first release, with a schema that can later gain a provider ID without changing identities:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer/UUID primary key | singleton enforced by service in v1 |
| `enabled` | boolean | controls OIDC login availability |
| `password_login_enabled` | boolean | controls local password login availability |
| `display_name` | string | login button label; default `OpenID Connect` |
| `issuer_url` | string | canonical HTTPS issuer |
| `client_id` | string | non-secret |
| `encrypted_client_secret` | nullable string | encrypted with the external OIDC secret key |
| `scopes_json` | JSON text | must include `openid` |
| `username_claim` | string | proposed default `preferred_username` |
| `name_claim` | nullable string | proposed default `name` |
| `email_claim` | nullable string | proposed default `email` |
| `groups_claim` | nullable string | proposed default `groups` |
| `auto_provision` | boolean | default `false` |
| `default_role` | role enum | proposed default `viewer` |
| `role_mappings_json` | JSON text | role to exact group-name arrays |
| `oidc_session_expire_minutes` | integer | fixed default and maximum `60` in v1 |
| `auth_config_version` | integer | incremented for security-sensitive changes |
| `created_at`, `updated_at` | timestamp | UTC |
| `updated_by_user_id` | nullable user FK | audit attribution |

Configuration updates are all-or-nothing. The service validates and encrypts a candidate model before committing it. Updating non-secret fields without a new client secret preserves the encrypted value. A missing client secret is valid only while saving a disabled draft; validation, interactive test sign-in, and OIDC activation require a configured secret.

The decrypted secret must exist only for the outbound token request and validation request. Redaction applies to models, logs, exception strings, and diagnostics.

### External OIDC encryption key

- Read a Fernet-compatible key only from `SAMBEE_OIDC_SECRET_KEY`; never generate it automatically or persist it in the database.
- Require the key before saving a client secret or enabling OIDC. Validate it at startup without logging its value.
- If an encrypted secret exists but the key is missing or cannot decrypt it, fail OIDC closed, mark authentication health unhealthy, and emit an actionable error. Do not erase or replace the stored ciphertext.
- Keep password recovery available according to the configured recovery policy; OIDC key failure does not silently change persisted login settings.
- Document secure generation, backup, container secret injection, and file/environment permissions. Losing the key requires entering a new client secret.
- Provide a maintenance command for rotation. It reads the current key from `SAMBEE_OIDC_SECRET_KEY` and the replacement from `SAMBEE_OIDC_NEW_SECRET_KEY`, decrypts and re-encrypts the client secret in one transaction, verifies the result, and never accepts either key as a command-line argument. After rotation, deploy with the replacement as `SAMBEE_OIDC_SECRET_KEY` and remove the temporary variable.

### `OidcIdentity`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID primary key | internal identity record |
| `user_id` | user FK, indexed | linked local user |
| `issuer` | string | exact validated issuer |
| `subject` | string | opaque provider subject |
| `created_at` | timestamp | UTC |
| `last_login_at` | timestamp | nullable UTC |

Constraints:

- unique `(issuer, subject)`
- unique `(user_id, issuer)` so a user has at most one identity for a provider
- delete behavior must be explicit; deleting a user should delete its identity links in the same service transaction

### Ephemeral records

Use database-backed records so login works correctly with multiple backend workers and restarts:

- `OidcAuthorizationTransaction`: state hash, encrypted verifier/nonce material, purpose, initiating user/admin ID where applicable, auth-configuration version, return path, expiry, consumed timestamp
- `OidcLoginGrant`: grant hash, user ID, token version, auth-configuration version, return path, expiry, consumed timestamp
- `OidcPendingLinkGrant`: grant hash, initiating user ID, issuer, subject, minimal display claims, auth-configuration version, expiry, consumed timestamp

No provider tokens are retained after the callback. If the selected library requires temporary token data, keep it in memory only for the current request.

### `User` changes

- make `password_hash` nullable
- password login must fail generically when `password_hash` is absent
- normal password change requires an existing local password; the audited admin-only **Add local password** action is the sole way to add password authentication to an OIDC-only user
- add no provider subject fields directly to `User`; keep identity linkage normalized

## Configuration Precedence and Lockout Prevention

OIDC provider details and UI-managed login-method state are database-owned. Existing TOML `auth_method` remains the bootstrap/default source during migration.

Recommended transition:

1. With no OIDC configuration row, preserve current `password` or `none` behavior exactly.
2. Creating the first OIDC configuration does not enable it until validation succeeds and the administrator explicitly saves `enabled=true`.
3. Once a database auth configuration exists, it controls OIDC/password availability. `none` remains an explicit deployment-level TOML mode and cannot be combined with OIDC.
4. Reject any update that enables neither OIDC nor password while the deployment is not in `none` mode.
5. Reject OIDC-only mode unless the current administrator has a linked OIDC identity or has just completed a successful test sign-in for the candidate configuration.
6. Keep a documented emergency recovery mechanism that restores local password login from the server environment or a narrowly scoped CLI command.

Auth configuration changes must clear the frontend auth-config cache and invalidate backend discovery/JWKS configuration caches. Increment `auth_config_version` when issuer, client ID, role mappings, or enabled login methods change. Include that version in all newly issued Sambee JWTs and reject a token whose version no longer matches. Once a database auth configuration exists, reject legacy tokens without the claim. Display-name-only edits do not increment the version.

OIDC-authenticated Sambee JWTs expire after 60 minutes. This value is fixed as the v1 maximum so removal or authorization changes at the IdP cannot leave a Sambee session active for the existing 24-hour default. In OIDC-only mode, expiration automatically starts OIDC reauthentication while preserving the safe return path; an active IdP session normally makes this redirect silent. Mixed mode returns to the login page with OIDC as the primary action. Explicit logout suppresses automatic reauthentication.

## Backend API

### Public authentication API

`GET /api/auth/config`

```json
{
  "auth_method": "password",
  "password_enabled": true,
  "oidc": {
    "enabled": true,
    "display_name": "Company SSO",
    "authorization_path": "/api/auth/oidc/authorize"
  }
}
```

Compatibility: retain `auth_method` while frontend callers migrate. Define an `oidc` enum value only if a single-value mode remains useful; the boolean capability fields are authoritative because password and OIDC may coexist.

Add:

- `GET /api/auth/oidc/authorize`
- `GET /api/auth/oidc/callback`
- `POST /api/auth/oidc/exchange`

All three endpoints are public by necessity, have narrow schemas, and receive dedicated rate limits at the reverse proxy/deployment layer. Callback and exchange failures use stable error codes without exposing provider payloads.

### Admin API

Require `ACCESS_ADMIN_SETTINGS` for reads and the new `MANAGE_AUTH_SETTINGS` capability for writes. Grant the new capability to admins by default.

Add:

- `GET /api/admin/auth/oidc` returns redacted configuration
- `PUT /api/admin/auth/oidc` validates and atomically updates configuration
- `POST /api/admin/auth/oidc/validate` validates a submitted candidate without saving it
- `POST /api/admin/auth/oidc/test-login` starts the interactive test transaction required before OIDC-only activation

Validation response example:

```json
{
  "valid": true,
  "checks": [
    {"name": "issuer", "status": "passed"},
    {"name": "discovery", "status": "passed"},
    {"name": "authorization_endpoint", "status": "passed"},
    {"name": "token_endpoint", "status": "passed"},
    {"name": "jwks", "status": "passed"}
  ],
  "warnings": [
    "Client credentials and claim mappings require an interactive sign-in to verify."
  ]
}
```

Never echo secrets, discovery documents, JWKS bodies, provider error bodies, or tokens in this response.

## Configuration Validation

The non-interactive **Validate configuration** action must:

- validate field syntax and required combinations locally
- require an absolute issuer URL with no userinfo, query, or fragment
- require HTTPS except for explicitly enabled loopback development
- fetch `/.well-known/openid-configuration` using the OIDC library
- require exact issuer equality between configuration and discovery metadata
- require HTTPS authorization, token, and JWKS endpoints outside loopback development
- require `authorization_code` support when metadata lists grant types
- require an ID-token signing algorithm supported by the selected library and reject `none`
- fetch and parse JWKS with strict response size and timeout limits
- report whether configured scopes are advertised, as a warning because providers do not always publish complete scope metadata
- report that credentials, redirect URI registration, and claims remain unverified until interactive login

All discovery, JWKS, token, and UserInfo requests must use one `ValidatedOidcHttpClient`; the OIDC library must not perform network requests outside this adapter. Apply these simple rules to the issuer and every endpoint obtained from discovery:

- allow HTTPS only in production; allow HTTP only for literal loopback hosts in development
- use the operating system trust store; private certificate authorities work only when installed in the Sambee container's trust store
- reject URL userinfo and fragments, and reject schemes other than those allowed above
- do not follow HTTP redirects; configuration validation reports the redirect as an endpoint error
- allow public and RFC1918/private unicast destinations so self-hosted IdPs work without an allowlist
- reject unspecified, multicast, link-local, and reserved addresses; reject loopback in production
- resolve the hostname for each request, reject the request if any returned address is forbidden, and connect only to an approved resolved address while retaining the original hostname for TLS verification and the HTTP `Host` value
- apply short connect/read timeouts, strict response-size limits, JSON content checks, and a small concurrency limit

These rules intentionally do not provide a hostname allowlist. They block common metadata-service and DNS-rebinding paths while keeping private IdP setup straightforward. Certificate failures must produce an actionable message explaining that the issuer certificate must chain to the container's system trust store.

Cache successful discovery metadata and JWKS according to HTTP caching headers with a bounded maximum age. Refresh JWKS once when a token references an unknown key ID, then fail closed.

## OIDC Library and Dependency Work

Use a maintained OIDC client library rather than manually implementing protocol validation. The implementation spike must compare current Authlib and PyJWT/PyJWKClient capabilities against these requirements. Authlib is the preferred starting point because it supports discovery, authorization-code clients, PKCE, and OIDC claim validation in one library.

Dependency changes must follow the repository's pinned and hashed dependency update workflow before editing requirement lockfiles.

The adapter around the selected library must expose Sambee-owned typed operations:

- load and validate provider metadata
- build an authorization redirect
- exchange and validate a callback
- return a small normalized claims object

Keep library-specific token dictionaries out of provisioning and API layers.

## Security Requirements

### Protocol

- Authorization Code Flow only; no implicit flow.
- PKCE `S256`, state, and nonce are mandatory even for a confidential client.
- Exact redirect URI; no request-controlled callback host.
- Derive public callback URL from an explicitly trusted external/base URL or validated proxy configuration, not an arbitrary `Host` header.
- Validate issuer, audience, authorized party, signature, expiry, issued-at, nonce, and subject.
- Permit only allowlisted asymmetric ID-token signing algorithms, initially `RS256` and optionally `ES256` after compatibility tests.
- Do not accept unsigned tokens or dynamically trust an algorithm from the token header.
- Do not use access-token claims as identity claims.

### Application

- Encrypt the client secret with `SAMBEE_OIDC_SECRET_KEY`, which is external to the database.
- Never log authorization codes, state, nonce, PKCE verifier, grants, client secrets, provider tokens, raw claims, or full group lists.
- Hash state and login grants at rest with SHA-256; compare using constant-time behavior where applicable.
- Consume state and grants atomically to prevent replay.
- Apply existing inactive-user, expiration, and token-version checks.
- Issue OIDC-authenticated Sambee JWTs for at most 60 minutes and validate their authentication-configuration version.
- Increment `token_version` on role changes and identity unlinking.
- Rate-limit authorization starts, callbacks, exchanges, and password login separately.
- Add structured audit events for configuration updates, validation attempts, successful/failed OIDC login, provisioning, identity linking/unlinking, and role changes.
- Return generic login failures to the browser while logging a specific reason and correlation ID server-side.

### Browser

- Keep provider and Sambee tokens out of query strings.
- Set `Referrer-Policy: no-referrer` on the OIDC callback response.
- Clear the one-time fragment from history before exchange.
- Do not load third-party resources on the callback page.
- Preserve the existing localStorage session approach for scope control; migration to HttpOnly session cookies is a separate security project.

## Logging and Audit Events

Use stable event names and include only safe identifiers:

- `oidc.config.validated`
- `oidc.config.updated`
- `oidc.authorization.started`
- `oidc.login.succeeded`
- `oidc.login.failed`
- `oidc.user.provisioned`
- `oidc.identity.linked`
- `oidc.identity.unlinked`
- `oidc.user.role_changed`

Safe fields include local user ID, username after resolution, provider configuration ID, selected role, failure category, and request correlation ID. Subject may be represented by a one-way diagnostic hash, never the raw value. Configuration changes should record the acting admin and which non-secret fields changed.

## Frontend Implementation

### Types and API client

- extend the public auth config type to model password and OIDC availability
- add redacted OIDC admin configuration and validation result types
- add API methods for read, update, validate, authorization start, and one-time grant exchange
- centralize successful-token handling so password and OIDC login use the same storage, tracing initialization, current-user load, and redirect logic
- clear `authConfig` cache after saving authentication settings

### Routes and pages

- update `Login` for mixed, OIDC-only, password-only, and `none` states
- add a minimal `/login/oidc/callback` route that parses, removes, and exchanges the fragment grant
- add the admin authentication settings category/page
- add linked-authentication information to user management
- gate all admin UI with the same server-enforced capability used by the API

### Accessibility and error handling

- preserve keyboard and screen-reader access for all login and settings controls
- move focus to validation/save errors
- distinguish configuration validation warnings from failures
- disable duplicate submissions while login, exchange, validation, or save is pending
- translate stable frontend messages; never render raw backend or provider exception text

## Backend Implementation Areas

Expected modules, following current repository boundaries:

- `app/core/auth_methods.py`: represent OIDC/mixed availability without breaking `none`
- `app/core/security.py`: keep Sambee JWT validation shared; make missing password hashes safe
- `app/models/oidc.py`: provider, identity, transaction, grant, and API models
- `app/services/oidc_configuration.py`: encryption, redaction, validation, persistence, and cache invalidation
- `app/services/oidc_client.py`: library adapter, discovery/JWKS behavior, authorization and callback validation
- `app/services/oidc_identity.py`: identity resolution, provisioning, profile sync, and role sync
- `app/api/auth.py` or a focused `app/api/oidc_auth.py`: public browser flow
- `app/api/admin.py` or a focused `app/api/admin_auth.py`: admin configuration endpoints
- `app/db/migrations.py`: tables, constraints, nullable password hash migration, and indexes
- `app/main.py`: router registration and startup cache initialization

Names can change during implementation, but protocol, configuration, and identity/provisioning logic must remain separate services with typed boundaries.

## Test Plan

### Backend unit tests

- configuration validation and normalization
- secret encryption, replacement, preservation, removal, and response redaction
- issuer and endpoint URL validation
- role mapping for no match, one match, multiple matches, duplicates, malformed group claims, and each role
- stable `(issuer, subject)` lookup regardless of email/username changes
- username collision behavior
- disabled, expired, and OIDC-only users
- mandatory profile synchronization and role synchronization when mappings are configured
- token-version increment only when authorization-relevant state changes
- state/grant hashing, expiry, atomic consumption, and replay rejection
- return-path validation
- log redaction

### Backend integration tests

Use an in-process fake OIDC provider or deterministic mocked HTTP transport; do not depend on a public IdP.

- discovery and JWKS validation
- authorization redirect parameters, including state, nonce, and PKCE challenge
- successful code exchange and ID-token validation
- wrong issuer, audience, nonce, signature, algorithm, expired token, missing subject, unknown key, and rotated key
- UserInfo response with a missing or mismatched subject
- provider error callback
- auto-provision enabled/disabled
- identity link reuse on subsequent login
- role change invalidates old Sambee JWT
- OIDC callback produces a one-time grant, not a token in the URL
- grant exchange succeeds once and fails on replay/expiry
- multiple backend sessions cannot consume the same transaction or grant twice
- linking requires current-password reauthentication, explicit confirmation, the same initiating user, and an unlinked provider identity
- admin APIs reject non-admin users and never return a client secret
- lockout-prevention rules reject unsafe configuration updates
- missing, wrong, and rotated external OIDC encryption keys fail closed without destroying configuration
- authentication-sensitive configuration changes invalidate existing JWTs through `auth_config_version`
- validated outbound HTTP rejects forbidden addresses, redirects, invalid certificates, oversized responses, and DNS rebinding
- password, OIDC, mixed, and `none` modes each preserve expected behavior

### Frontend tests

- login renders correctly for all auth configurations
- OIDC button uses the backend authorization path and preserves a valid return route
- callback removes the fragment and exchanges the grant once
- successful OIDC exchange follows the same post-login initialization as password login
- stable error-code mapping and retry behavior
- admin form secret-preservation semantics
- validation checks/warnings and save states
- role mapping editor validation
- case-insensitive normalized group matching and cross-role collision errors
- admin navigation/capability visibility
- OIDC-only users do not receive password reset actions

### End-to-end tests

- local test provider login from signed-out state to `/browse`
- return to a deep browse route
- auto-provisioned viewer cannot access admin APIs/UI
- mapped admin can access admin settings
- group change updates role on next login according to policy
- disabled local account is denied despite valid provider authentication
- password recovery login works during provider outage when enabled
- OIDC session expiry reauthenticates through an existing IdP session and preserves the return route

Run the full backend test suite and type check, frontend test suite and type/lint checks, and the repository-wide test script before completion.

## Migration and Rollout

### Database migration

1. Create provider configuration, identity, transaction, and grant tables and indexes.
2. Rebuild or alter the SQLite user table safely so `password_hash` is nullable; verify all existing password hashes are preserved.
3. Add uniqueness constraints for federated identities.
4. Do not create identity links for existing users automatically.
5. Preserve current auth behavior when no provider configuration exists.

The migration must be idempotent under the repository migration runner. Back up and restore tests must cover an existing database with users and active settings.

### Recommended rollout sequence

1. Ship schema and dormant backend support with no behavior change.
2. Ship admin configuration and non-interactive validation while OIDC activation remains guarded.
3. Ship login, callback, grant exchange, and explicit linking/test-login support.
4. Ship provisioning and profile synchronization.
5. Ship group-to-role synchronization after role policy decisions are approved.
6. Ship documentation and Authelia example before marking the feature complete.

### Rollback

- Disabling OIDC restores password behavior without deleting configuration or identity links.
- Existing Sambee JWTs continue to work until normal expiry unless administrators explicitly invalidate them.
- A documented server-side recovery action can re-enable password login if the UI is inaccessible.
- Database downgrade is not required, but older application versions must not be used against the migrated database unless compatibility is verified.

## Documentation Deliverables

Update the earliest applicable documentation version using docs inheritance and the docs editor workflow:

- administrator authentication overview
- OIDC setup procedure and redirect URI
- field-by-field UI reference
- provisioning and role-mapping behavior
- lockout prevention and emergency recovery
- client-secret rotation
- troubleshooting by stable error category
- security/privacy notes about claims and local user records
- upgrade notes for the new database-owned auth configuration behavior

### Authelia example

Provide a complete, version-pinned example that includes:

- Authelia identity provider prerequisites
- an Authelia OIDC client registration for Sambee
- public and local-development redirect URI examples
- client ID and generated client secret handling
- `authorization_code` flow and PKCE settings
- scopes and claims required by Sambee
- a groups claim policy
- example Authelia groups mapped to Sambee `admin`, `editor`, and `viewer`
- corresponding values entered in Sambee's UI
- validation and first-login procedure
- expected behavior for an unmapped user
- logout limitations and troubleshooting

Validate the example against the current supported Authelia release and clearly label version-dependent syntax.

## Implementation Phases and Acceptance Criteria

### Phase 1: foundation and configuration

- add the selected OIDC dependency through the dependency workflow
- add data models and migrations
- add encrypted/redacted configuration service
- add admin read/update/validate APIs
- add authentication settings UI
- add lockout guards and emergency recovery mechanism

Acceptance criteria:

- current deployments behave identically before an OIDC configuration is created
- an admin can save and validate a provider configuration
- a non-admin cannot read or modify it
- no API, log, or database plaintext field exposes the client secret
- unsafe auth-method combinations are rejected

### Phase 2: login and identity linking

- implement discovery cache and OIDC library adapter
- implement authorization, callback, and one-time exchange flow
- add identity links and explicit link/test-login mechanism
- update login and callback frontend routes

Acceptance criteria:

- a linked OIDC user receives a normal Sambee JWT and can use HTTP, WebSocket, and companion-dependent flows allowed by their role
- all protocol validation failures fail closed
- replayed state, callback, and exchange grants are rejected
- no provider or Sambee token appears in redirect URLs or logs
- password and `none` regression tests pass

### Phase 3: provisioning and role mapping

- implement optional auto-provisioning
- implement claim normalization and profile sync
- implement deterministic group-to-role mapping and synchronization
- expose identity type in user management

Acceptance criteria:

- auto-provisioning off rejects unknown identities without creating records
- auto-provisioning on creates one local user for one `(issuer, subject)` under concurrent callbacks
- mapped roles and unmatched policies behave exactly as configured
- deactivated and expired users remain blocked
- role changes invalidate prior Sambee sessions

### Phase 4: documentation and release readiness

- complete administrator, configuration, security, and troubleshooting docs
- add and verify the Authelia example
- run all backend, frontend, end-to-end, migration, and repository checks
- perform a security review focused on OIDC protocol validation, SSRF, account linking, privilege mapping, replay, and secret handling

Acceptance criteria:

- a new administrator can configure Authelia from the documentation alone
- recovery from an invalid or unavailable IdP is tested and documented
- no unresolved high-severity security findings remain

## Resolved Decisions

The following product and security decisions are approved for the first implementation. The normative sections above incorporate them.

### 1. May password and OIDC login coexist?

**Recommended:** yes. Permit mixed mode and require at least one local recovery administrator while OIDC is enabled. Allow OIDC-only mode only after that administrator successfully links and tests their identity.

Decide whether password login should remain visible to all local users, only through a separate recovery URL, or only through a server-side emergency command.

**Decision:** use mixed mode by default. Keep local password recovery on a separate recovery URL. Permit OIDC-only mode only after the current administrator links and successfully tests their OIDC identity; retain the server-side emergency recovery command.

### 2. Who may modify authentication settings?

**Recommended:** add `MANAGE_AUTH_SETTINGS` and grant it to admins by default. This separates high-risk identity-provider changes from general system-settings access and supports future delegated capabilities.

Decide whether the existing `ACCESS_ADMIN_SETTINGS` capability is sufficient for reads and whether all admins should be allowed to change authentication.

**Decision:** add `MANAGE_AUTH_SETTINGS`, granted to admins by default. `ACCESS_ADMIN_SETTINGS` permits redacted reads; only `MANAGE_AUTH_SETTINGS` permits changes.

### 3. How are existing users linked to OIDC identities?

**Recommended:** explicit linking only. A signed-in local user initiates linking, completes OIDC, and confirms the link; an admin may unlink but may not type an arbitrary subject. Never auto-link by matching email or username.

Decide whether self-service linking is in the first release, whether admins can initiate links, and whether an OIDC-only launch can rely solely on auto-provisioning.

**Decision:** include self-service explicit linking in the first release using fresh password verification, a user-bound OIDC transaction, and explicit confirmation. Administrators may unlink but cannot enter or reassign subjects. No email/username auto-linking or admin-initiated linking.

### 4. Which claim supplies Sambee usernames?

**Recommended:** default to `preferred_username`, make it configurable, and require uniqueness. Reject provisioning on collision with instructions to link the account or resolve the local username.

Decide whether Sambee may generate a suffix on collision and whether usernames should continue syncing after provisioning. Keeping usernames stable after creation is recommended because they appear in logs and administration.

**Decision:** use configurable `preferred_username` by default, reject collisions without generated suffixes, and keep the local username stable after creation.

### 5. What happens to unknown users when auto-provisioning is disabled?

**Recommended:** deny login with a generic user message and an actionable admin log entry. Do not create a disabled placeholder account.

Decide whether the user-facing message should direct users to a named administrator/support channel.

**Decision:** deny login without creating a placeholder. Show a generic message that directs the user to their Sambee administrator; log an actionable, privacy-safe reason.

### 6. What is the default role for an auto-provisioned, unmapped user?

**Recommended:** `viewer`, matching least privilege.

Decide whether unmatched users should instead be denied login even when auto-provisioning is enabled.

**Decision:** assign `viewer` to an auto-provisioned user with no matching group.

### 7. How should roles change on later logins?

**Recommended:** synchronize on every OIDC login. Select the highest privilege among exact group matches. If no group matches, demote to the configured default role and invalidate existing sessions.

Decide whether no match should demote, preserve the current role, or deny login. Also decide whether a manually assigned role can override OIDC synchronization; if yes, the data model needs an explicit role source/override flag.

**Decision:** synchronize at every login, choose the highest matched privilege, demote an unmatched existing user to the default role, and invalidate existing sessions after a role change. Do not support manual role overrides while synchronization is enabled.

### 8. Are group names case-sensitive and are nested group paths supported?

**Recommended:** normalized, case-insensitive exact matching against values emitted by the configured groups claim. Treat nested paths as ordinary exact strings; do not infer hierarchy or accept regular expressions in the first release.

Normalize with trimming, Unicode NFKC, and Unicode case folding. Reject cross-role normalization collisions.

**Decision:** use the recommended normalized, case-insensitive exact matching. Do not support prefixes or regular expressions.

### 9. How are absent or malformed group claims handled?

**Recommended:** fail login when mappings/synchronization depend on groups; otherwise treat groups as unused. Do not silently assign a privileged or previous role when required authorization data is absent.

Decide whether missing groups should fall back to the default role instead.

**Decision:** fail login when mappings or synchronization require groups and the claim is absent or malformed. Do not fall back to a previous or privileged role.

### 10. Should OIDC update name and email on each login?

**Recommended:** yes for linked users, while keeping username stable. Treat the provider as authoritative for name/email only, and never overwrite local activity or expiry state.

Decide whether admins need per-user profile overrides.

**Decision:** synchronize name and email on each login, keep username stable, and do not support per-user profile overrides in the first release.

### 11. What happens when a user is removed from the IdP?

**Recommended:** no background deletion or deactivation in this feature. Without SCIM or provider events, Sambee cannot know immediately. Role/group changes apply at next login, and local admins retain manual disable controls.

Decide whether short Sambee token lifetimes are required for OIDC users to reduce the delay before changed IdP access takes effect.

**Decision:** do not delete or deactivate users in the background. Apply IdP changes at the next login and limit OIDC-authenticated Sambee JWTs to 60 minutes.

### 12. Is one provider sufficient for the first release?

**Recommended:** yes. Keep issuer-qualified identity records and service interfaces ready for multiple providers, but avoid provider-selection UI and multi-provider policy until there is a concrete need.

Decide whether any known deployment requires multiple providers at launch.

**Decision:** support one provider in the first release while keeping identities issuer-qualified.

### 13. Must public OIDC clients without a client secret be supported?

**Recommended:** no for the first release; Sambee's backend is a confidential client and should require a secret. PKCE remains mandatory.

Decide whether a target IdP/deployment requires `token_endpoint_auth_method=none` or private-key JWT authentication.

**Decision:** require a confidential client secret and PKCE. Do not support public clients or private-key JWT authentication in the first release.

### 14. What is the trusted external URL source?

**Recommended:** add an explicit public/base URL setting used to construct and display the redirect URI. Do not infer security-sensitive callback URLs from untrusted request headers.

Decide whether existing reverse-proxy deployment configuration already provides a trusted canonical URL and how local development should override it.

**Decision:** add an explicit public/base URL setting. Local development may override it explicitly; never derive callbacks from an untrusted request host.

### 15. What network destinations may validation and discovery access?

**Recommended:** HTTPS only, except loopback in development. Allow private-network HTTPS issuers because self-hosted IdPs are a core use case, but document the trust boundary and apply strict timeouts, size limits, URL validation, and redirect restrictions.

Decide whether production deployments need an optional hostname/IP allowlist to reduce SSRF exposure from compromised admin accounts.

**Decision:** use HTTPS only except literal loopback in development, no hostname/IP allowlist, and the container's system trust store. Allow private unicast IdPs; apply the centralized destination, redirect, DNS, timeout, and size rules in Configuration Validation.

### 16. What does “Validate configuration” promise?

**Recommended:** provide metadata/JWKS validation before save and a separate interactive **Test sign-in** before enabling OIDC-only mode. Clearly state that metadata validation alone cannot verify credentials, redirect registration, consent, or claim mappings.

Decide whether interactive test sign-in is required in the first release or may follow later.

**Decision:** include metadata/JWKS validation and a separate interactive test sign-in in the first release. Require successful test sign-in before OIDC-only activation.

### 17. What logout behavior is required?

**Recommended:** local logout only for the first release: delete the Sambee JWT and explain that the IdP session may still be active. Add RP-initiated logout only after testing provider compatibility and post-logout redirect validation.

Decide whether Authelia or another target provider requires single logout at launch.

**Decision:** local logout only in the first release. Clearly explain that the IdP session may remain active.

### 18. What happens to active sessions after auth configuration changes?

**Recommended:** keep sessions for non-security-sensitive edits such as display name; invalidate all user sessions when issuer, client ID, role mappings, synchronization policy, or enabled login methods change.

Decide whether global invalidation is acceptable operationally. Implementing it cleanly may require an application-wide auth configuration version claim in Sambee JWTs.

**Decision:** increment an authentication-configuration version and invalidate all sessions after security-sensitive changes. Keep sessions for display-name-only edits.

### 19. Can an OIDC-only user gain a local password?

**Recommended:** only through an explicit admin action that clearly changes the account to mixed authentication and records an audit event. Normal self-service password change remains unavailable without an existing password.

Decide whether password reset should be hidden entirely for OIDC-linked users or allowed for recovery.

**Decision:** hide password reset for OIDC-only users. Provide an explicit, confirmed, audited admin action named **Add local password** to create mixed authentication.

### 20. Which OIDC signing algorithms are required?

**Recommended:** require `RS256` initially and add `ES256` only if a target provider needs it and automated tests cover it. Never support `none` or symmetric provider-signed ID tokens using the client secret.

Confirm the algorithms used by required providers, especially the supported Authelia version.

**Decision:** support `RS256` initially. Add `ES256` only when a target provider requires it and automated compatibility tests exist. Never accept unsigned or symmetric provider ID tokens.

## Review Exit Criteria

This specification is ready to become implementation issues when:

- all resolved decisions are represented consistently in normative requirements and tests
- the OIDC client library spike confirms protocol and typing requirements
- the account-linking and lockout-recovery flows have security approval
- the data migration approach is validated against a copy of a current database
- the Authelia target version and claim format are confirmed
- work is split into independently testable backend, frontend, migration, and documentation issues
