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
- **Admission policy:** determines which valid OIDC identities may sign in and whether an unknown admitted identity is auto-provisioned.
- **Auto-provisioning:** creating a local user for an unknown identity admitted by the configured policy.
- **Role synchronization:** recalculating a linked user's Sambee role from OIDC group claims at login.
- **Recovery login:** a local password login retained in mixed mode for accounts that have a local password.
- **Identity mapping:** an administrator-approved association between an existing local user and a validated OIDC `(issuer, subject)` identity. An administrator may bootstrap it with a pending mapping to an expected IdP username; after first successful login, identity resolution uses only `(issuer, subject)`.

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

Add **Settings > Administration > Authentication** as a guided setup flow:

1. **Prerequisites**
   - show whether `SAMBEE_OIDC_SECRET_KEY` is configured without exposing it
   - read the canonical deployment URL from `SAMBEE_PUBLIC_URL` and show the exact derived redirect URI with a copy button
   - block provider setup with an actionable message when the external key or production public URL is missing
2. **Provider**
   - issuer URL
   - client ID
   - client secret with `Set new secret`/`Replace secret` behavior and a visibility toggle while editing
   - optional display name, defaulted from the issuer hostname
3. **Connect and test**
   - stage the values in a short-lived, encrypted test flow without changing the active configuration
   - run metadata and JWKS validation
   - continue directly into interactive test sign-in when those checks pass
   - show the resolved username, name, email, and groups from the test identity, never the raw token or complete claims document
4. **Access**
   - choose **Who may sign in?**: **Members of selected groups** (default) or **Any identity-provider user**
   - admission-group selector when **Members of selected groups** is chosen
   - administrator and editor group mappings populated with selectable groups observed during test sign-in
   - manual group entry for groups the testing administrator does not belong to
   - fixed `viewer` fallback for every admitted user who matches neither privileged mapping
5. **Review administrator mapping**
   - confirm that activation will map the tested identity to the current administrator
   - show the server-calculated admission result and resulting role under the proposed access policy
6. **Activate**
   - choose exactly one sign-in mode: **Password only**, **OIDC with local recovery**, or **OIDC only**
   - summarize the resulting login and provisioning behavior before confirmation
   - warn when activation invalidates active sessions or changes the current administrator's login path
   - require the tested identity to be mapped to the current administrator, admitted by the proposed policy, and resolve to `admin` under the proposed mappings before enabling **OIDC only**
   - require a fresh test sign-in before changing admission or role mappings while already in **OIDC only** mode

After activation, **Existing user mappings** lists local accounts that need to retain their existing Sambee data. For each account, an administrator may enter the expected IdP username and confirm a pending mapping. On that identity's next normal OIDC login, Sambee consumes the pending mapping and permanently binds the validated `(issuer, subject)` to the selected local account. The user receives no separate mapping link, mapping page, or approval prompt. Ordinary admitted users without a pending mapping are auto-provisioned on first OIDC sign-in. Recommend **OIDC with local recovery** during migration so existing local users can continue signing in with their passwords until mapped; before direct activation into **OIDC only**, warn that every existing user without a permanent or pending mapping will be unable to sign in to their existing account.

Standard scopes and claims are not shown in the primary flow. An **Advanced** section contains scopes, defaulting to `openid profile email groups`, and claim-name overrides defaulting to `preferred_username`, `name`, `email`, and `groups`. Each override has a reset-to-default action. The interactive test validates these choices before activation.

The client secret is write-only after submission. A read response exposes only `client_secret_configured: true|false`; the backend never returns a masked, partial, or hashed secret. While editing, the frontend may reveal only the unsent value already held in the input, preserves it after recoverable validation failures, and clears it after successful testing or navigation away. Leaving the replacement field empty preserves the existing stored secret.

### Login

- In **Password only** mode, show the username/password form.
- In **OIDC with local recovery** mode, show **Sign in with {provider display name}** as the primary action; local password login is available at `/login/local`.
- In **OIDC only** mode, show only **Sign in with {provider display name}**.
- If auth mode is `none`, retain the current direct redirect behavior.
- Authentication errors return to the login page with a stable error code and a user-safe message. Provider responses, tokens, claim values, and secrets must not be placed in the URL or rendered verbatim.
- Show **Sign in with password** after an OIDC failure only in **OIDC with local recovery** mode. Never expose `/login/local` as a usable path in **OIDC only** mode.

### User management

Show linked authentication types on each user: `Local password`, `OIDC`, or both. For OIDC-linked users, show the provider display name and last successful OIDC login. Do not expose the OIDC subject in the default UI.

Administrators manage mappings from the user-management UI and the authentication-settings **Existing user mappings** section. Users cannot initiate, approve, change, or remove their own mapping. Creating or replacing a pending username mapping, moving an existing immutable identity mapping, and unmapping require confirmation and an audit event. A pending username mapping can bind only a previously unmapped identity to a local account that has no established OIDC identity. Moving an existing identity to another unmapped local user is a separate explicit administrator action that warns that both affected users will be signed out.

Do not implement **Add local password** in v1. Preserve passwords for existing local users and allow administrators to create local accounts through the existing user-management workflow when the sign-in mode permits password authentication, but never add a password retroactively to an OIDC-provisioned account. Password reset and password change require an existing password hash and are unavailable to accounts without one. In **OIDC only** mode, hide all password-management actions because local credentials cannot be used.

Sambee retains one local `User.role` regardless of authentication method. A successful OIDC login synchronizes that role when mappings are configured. A password login uses the currently stored role without contacting the IdP. Removing an IdP group can change the stored role on the next OIDC login, but does not remove an existing local password. Disabling or expiring a local user continues to block both authentication methods and must not be undone by auto-provisioning.

Password recovery uses the documented `/login/local` route rather than adding visual noise to the primary OIDC login. It is available only in **OIDC with local recovery** mode, only to local-password accounts, and has its own password-login rate limit. It does not bypass normal password verification, activity, expiry, or token-version checks. **Password only** continues to use the normal login page.

## Authentication Flow

### Start authorization

`GET /api/auth/oidc/authorize?return_to=/browse/...`

1. Confirm OIDC is enabled and has a complete saved configuration.
2. Allow only relative, application-owned `return_to` paths; otherwise use `/browse`.
3. Generate cryptographically random `state`, `nonce`, and PKCE verifier values.
4. Persist a short-lived, one-time `OidcFlow` with status `started`:
   - store the hash of `state`, encrypted PKCE verifier, and encrypted nonce at creation
   - flow purpose: `login` or `test`
   - initiating administrator ID for `test`
   - provider configuration revision
   - sanitized return path
   - creation and expiry timestamps
5. Build the provider authorization URL from discovered metadata using `response_type=code`, `scope`, `state`, `nonce`, `code_challenge`, and `code_challenge_method=S256`.
6. Return an HTTP redirect to the provider.

Started flows expire after five minutes, transition atomically, and are deleted after terminal failure or consumption. A periodic or opportunistic cleanup removes expired rows.

### Callback

`GET /api/auth/oidc/callback?code=...&state=...`

1. Reject missing, malformed, expired, already-consumed, or unknown state.
2. Atomically transition the flow from `started` to `callback_processing` before exchanging the code so no second callback can process it. A terminal callback failure transitions it to `consumed`.
3. Reject provider error responses with a generic user-facing error and a specific server log event.
4. Exchange the authorization code using the client credentials and PKCE verifier.
5. Validate the ID token using the OIDC library:
   - signature against provider JWKS
   - expected issuer
   - client ID audience and authorized-party semantics
   - expiry and issued-at constraints with bounded clock skew
   - transaction nonce
   - required `sub` claim
6. Use ID-token claims by default and classify configured claims as follows:
   - `sub` is mandatory in the validated ID token and cannot be supplied by UserInfo
   - username is required for every interactive test and login
   - groups are required only when `selected_groups` admission or a privileged role mapping is configured
   - name and email are optional profile claims; their absence never fails authentication and never triggers UserInfo
7. When a required username or groups claim is absent and the provider advertises UserInfo, make exactly one UserInfo request for the flow through `ValidatedOidcHttpClient`, with no retry and no cross-login failure cache. Require UserInfo `sub` to exactly equal the validated ID-token `sub`, then merge only the configured missing required claims. If the subject differs, UserInfo is unavailable, or a required claim remains absent, fail login. Log category `token_claim_mismatch` with reason `user_info_subject_mismatch` for a subject mismatch without logging either subject value.
8. Complete the callback according to the flow purpose. A `login` flow resolves the local user and role, rejects inactive or expired users, and continues below. A `test` flow follows its dedicated completion rules without provisioning a user, creating a mapping, or changing authorization.
9. For `login`, generate a random, single-use login grant, store only its hash on the flow, transition the flow to `callback_validated`, and redirect to a frontend callback route with the plaintext grant in the URL fragment. Do not issue a Sambee JWT in the callback.

Example redirect:

```text
/login/oidc/callback#grant=<single-use-random-value>
```

The fragment avoids normal server and proxy request logs. The callback page immediately removes it from browser history and exchanges it through `POST /api/auth/oidc/exchange`. The grant expires after 60 seconds and can be used once. The exchange atomically transitions the flow to `consumed`, reloads the local user, rechecks activity, expiry, token version, and provider configuration revision, and only then issues a Sambee JWT. It returns the same login response shape as password authentication, after which the frontend stores the Sambee JWT through its existing path.

Do not put the Sambee JWT, provider authorization code, ID token, or access token in the redirect URL.

### Test sign-in completion

A purpose-`test` callback validates the provider response and configured claims but never creates or maps a user, changes a role, or issues a Sambee session. It stores only the safe identity preview and tested candidate configuration on the administrator-bound flow, clears the state hash, transitions to `callback_validated`, and redirects back to the setup flow with the random flow UUID in the URL fragment.

The flow UUID is a correlation identifier, not an authorization credential. The frontend removes it from browser history, keeps it only in `sessionStorage` for the current setup tab, and uses an authenticated admin endpoint to retrieve the safe preview. Preview and activation require `ACCESS_ADMIN_SETTINGS`, the same initiating administrator, purpose `test`, and status `callback_validated`. The preview shows the server-calculated admission result, matching admission group when applicable, and resulting Sambee role; it explains that mapping does not override admission.

**Activate** submits the flow ID plus the reviewed sign-in mode, admission policy, and privileged group mappings. The test flow records the active `configuration_revision`, or records that no active configuration existed, when testing begins. Inside the activation write transaction, the backend rejects a revision/existence mismatch with **Configuration changed; connect and test again**, evaluates the tested claims against the submitted access settings, and rejects activation unless the initiating administrator is admitted and resolves to `admin`. It then atomically persists the server-validated configuration, creates or verifies the tested identity mapping to the initiating administrator, and consumes the flow. An identity already mapped to another user or a conflicting identity already mapped to the administrator rejects activation. Canceling or closing the setup discards the client identifier, and the server flow expires after 30 minutes without affecting active authentication. Each **Connect and test** attempt creates a new immutable flow; editing tested provider fields or access settings that affect the preview requires a new test. Login flows retain secret, hashed one-time grants.

### Identity resolution

Use this order:

1. Normalize the validated issuer according to OIDC issuer comparison rules and read `sub` as an opaque, case-sensitive string.
2. Find `OidcIdentity` by the unique `(issuer, subject)` pair.
3. If found, load its local user. Never silently remap it to another local user.
4. Validate the identity against the admission policy on every login:
   - `selected_groups`: require a valid groups claim and at least one normalized admission-group match
   - `all_idp_users`: admit every otherwise-valid OIDC identity
5. If the identity is not admitted, reject login with `oidc_user_not_admitted` without creating a record.
6. If admitted and no immutable identity mapping exists, normalize the configured username claim by trimming surrounding whitespace while preserving case, then find an administrator-created `OidcPendingIdentityMapping` for the active provider and that exact expected username.
7. If a pending mapping exists, atomically recheck its provider revision, target-user state, absence of an established target identity, username uniqueness, and both `OidcIdentity` uniqueness constraints; consume it and bind `(issuer, subject)` to the target local user. If any check changed, fail closed with a stable mapping-conflict error and create no user or identity.
8. If no pending mapping exists, create the local user and identity mapping in one database transaction.

Email, username, and display name remain mutable profile attributes and never resolve an established identity. Username is used only once to consume an explicit administrator-created pending mapping; every later login resolves exclusively through immutable `(issuer, subject)`.

### Administrator-managed identity mapping

Users never map accounts themselves. An administrator owns every mapping operation. Sambee never infers a mapping merely because a local username or email resembles an OIDC claim and never asks users to select a local account. Because standard OIDC does not provide a portable account-directory API, an administrator bootstraps a mapping by declaring the exact IdP username expected for a selected local account. A later normal OIDC login converts that pending declaration into an immutable `(issuer, subject)` mapping.

During initial setup, the administrator maps only the successfully tested identity directly to their own local account. The backend reuses the validated `(issuer, subject)` from the administrator-bound test flow, requires explicit confirmation, and creates that mapping in the activation transaction. Other existing users receive pending username mappings only after activation.

For any other existing local user:

1. An administrator with `ACCESS_ADMIN_SETTINGS` selects **Map OIDC account** for the target local user.
2. The administrator enters the exact username emitted by the configured OIDC username claim. Sambee trims surrounding whitespace, preserves case, and rejects an empty value or an exact duplicate pending username for the provider.
3. The confirmation shows the local account, expected IdP username, local role, and a stronger warning when the target is an administrator. It explains that the mapping remains subject to admission and that the first admitted, previously unmapped OIDC identity with that exact username will claim the account.
4. If the target has no established OIDC identity, Sambee creates or replaces the target user's `OidcPendingIdentityMapping`, recording the active provider revision and initiating administrator. Pending mappings persist until consumed, replaced, canceled, invalidated by a provider-configuration change, or removed with the target user.
5. On the matching identity's next normal OIDC login, the login transaction applies admission first, verifies that `(issuer, subject)` is not already mapped, rechecks the pending mapping and target, creates the immutable `OidcIdentity`, consumes the pending mapping, updates the target's synchronized profile and role, and increments `token_version`. The user sees only the normal OIDC login flow.

An existing immutable identity always wins over any username match and can never be moved by consuming a pending mapping. To move an existing identity, an administrator selects that known mapping and an unmapped local target, then confirms an atomic reassignment; the UI never exposes or accepts the raw subject. To associate a different identity with an already mapped local account, the administrator must explicitly remove the established mapping before creating a pending username mapping. A newly established target mapping, deleted or inactive target, duplicate username, provider revision mismatch, or identity uniqueness conflict fails closed and requires administrator review.

Creating, replacing, canceling, consuming, moving, and removing mappings write audit events and increment `token_version` for every affected local user when an immutable mapping changes. In OIDC-only mode, reject removing or moving the last active mapped local administrator. Admission and role-policy edits remain subject to the separate fresh-test guard.

### Provisioning

For a new identity:

- require non-empty configured username and subject claims
- normalize the proposed username exactly like the current local model: trim surrounding whitespace, preserve case, and apply case-sensitive uniqueness; do not lowercase or rewrite characters
- reject a collision with an existing username, create no user or mapping, and direct the user to ask an administrator to map the existing local account or resolve the username collision
- set name and email from configured claims when valid
- set `password_hash` to `NULL` for a newly OIDC-provisioned user
- set `must_change_password=false`
- set `is_active=true`
- leave `expires_at=NULL`
- calculate the role before inserting the user
- insert `User` and `OidcIdentity` atomically

An invalid or missing optional profile claim does not invalidate a login; it is omitted and logged at debug level without its raw value. A missing required username produces a stable configuration/claims error.

### Existing mapped users

On every successful OIDC login:

- update `last_login_at` on the identity
- update name or email only when the corresponding provider claim is present and valid; preserve the existing local value when the claim is absent or invalid; per-user profile overrides are not supported in the first release
- when at least one role mapping is configured, recalculate the role from provider groups; manual role overrides are not supported in this mode
- increment `User.token_version` if the synchronized role changes, invalidating older Sambee tokens
- preserve `is_active`, `expires_at`, and local password state
- never reactivate, unexpire, or delete an account automatically

### Role resolution

Apply this precedence for groups:

1. When `selected_groups` admission or any privileged role mapping is configured, require a groups claim containing a string array. Missing or malformed groups fail login; do not silently demote or provision.
2. Apply admission. A valid claim with no admission-group match under `selected_groups` denies login.
3. For an admitted identity, apply privileged role mappings. A valid claim with no administrator/editor match receives `viewer`.
4. When admission is `all_idp_users` and no privileged mappings exist, groups are unused and may be absent.

Do not split a single string on commas or whitespace.

Normalize configured and received group values by trimming surrounding whitespace, applying Unicode NFKC normalization, and then Unicode case folding. Preserve the original configured value for display. This provides case-insensitive exact matching without prefixes, regular expressions, or inferred hierarchy.

For each login:

1. Compare normalized group values using exact equality.
2. Collect all matching Sambee roles.
3. If multiple roles match, select the highest privilege: `admin` > `editor` > `viewer`.
4. If no privileged role matches, assign or demote the user to `viewer`.

Store administrator and editor mappings as structured JSON validated by a typed model. Reject empty normalized names and deduplicate normalized group names. Reject the complete configuration if two displayed values normalize to the same group but map to both privileged roles; show the collision before activation. Log the resulting role and whether it changed, but do not log the user's full group list.

## Data Model

### `OidcProviderConfiguration`

A singleton table for the first release. Use integer primary key `id=1` with a database `CHECK (id = 1)` constraint so concurrent or incorrect service code cannot create a second row. A future multi-provider migration may replace this constraint without changing identity keys.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer primary key | fixed to `1` by database constraint |
| `sign_in_mode` | enum | `password_only`, `oidc_with_recovery`, or `oidc_only` |
| `display_name` | string | login button label; defaults to issuer hostname |
| `issuer_url` | string | canonical HTTPS issuer |
| `client_id` | string | non-secret |
| `encrypted_client_secret` | nullable string | encrypted with the external OIDC secret key |
| `scopes_json` | JSON text | must include `openid` |
| `username_claim` | string | proposed default `preferred_username` |
| `name_claim` | nullable string | proposed default `name` |
| `email_claim` | nullable string | proposed default `email` |
| `groups_claim` | nullable string | proposed default `groups` |
| `admission_mode` | enum | `selected_groups` (default) or `all_idp_users` |
| `admission_groups_json` | JSON text | string array used only by `selected_groups` |
| `role_mappings_json` | JSON text | strict object `{"admin": string[], "editor": string[]}` |
| `configuration_revision` | integer | invalidates in-progress flows after security-sensitive changes |
| `created_at`, `updated_at` | timestamp | UTC |
| `updated_by_user_id` | nullable user FK | audit attribution |

Active configuration updates are all-or-nothing. The service validates and encrypts a candidate model before committing it. Updating non-secret fields without a new client secret preserves the encrypted value. A missing client secret is valid only in **Password only** mode; validation, interactive test sign-in, and either OIDC mode require a configured secret.

**Connect and test** does not overwrite a working active configuration. It stores the encrypted candidate configuration on a purpose-`test` `OidcFlow`, validates it, and uses that snapshot for interactive sign-in. A successful test extends the flow just long enough for the administrator to review and activate it. Activation atomically promotes the tested snapshot to the singleton active configuration; abandoned test flows expire without affecting current login behavior.

The decrypted secret must exist only for the outbound token request and validation request. Redaction applies to models, logs, exception strings, and diagnostics.

### External OIDC encryption key

- Read a Fernet-compatible key only from `SAMBEE_OIDC_SECRET_KEY`; never generate it automatically or persist it in the database.
- Require the key before saving a client secret or enabling OIDC. Validate it at startup without logging its value.
- If an encrypted secret exists but the key is missing or cannot decrypt it, fail OIDC closed, mark authentication health unhealthy, and emit an actionable error. Do not erase or replace the stored ciphertext.
- Keep password recovery available according to the configured recovery policy; OIDC key failure does not silently change persisted login settings.
- Document secure generation, backup, container secret injection, and file/environment permissions. Losing the key requires entering a new client secret.

#### OIDC client-secret rotation

To rotate the provider-issued OIDC client secret, enter the replacement in the authentication settings and complete **Connect and test**. The active client secret remains unchanged until activation atomically promotes the tested candidate. This procedure does not use `SAMBEE_OIDC_NEW_SECRET_KEY` and does not rotate the key that encrypts the secret at rest.

#### Encryption-key rotation

Rotate the at-rest encryption key only while all Sambee application processes are stopped so no process can retain or write ciphertext using the old key. The maintenance command:

1. Reads the current key from `SAMBEE_OIDC_SECRET_KEY` and the replacement from `SAMBEE_OIDC_NEW_SECRET_KEY`; it never accepts either key as a command-line argument.
2. Acquires an exclusive database write transaction, decrypts the stored client secret with the current key, validates the replacement Fernet key, and re-encrypts the secret.
3. Deletes every ephemeral `OidcFlow` row in the same transaction because flows may contain protocol material or candidate configuration encrypted with the old key. Any open login or test browser flow must be restarted after rotation.
4. Decrypts the candidate ciphertext with the replacement key and compares it with the original plaintext before committing. Any failure rolls back both the ciphertext change and flow deletion.
5. Prints the exact next action: replace `SAMBEE_OIDC_SECRET_KEY` with the new value, remove `SAMBEE_OIDC_NEW_SECRET_KEY`, and restart Sambee. It never prints either key.

On restart, Sambee must decrypt the stored secret successfully before serving OIDC authorization requests. If rotation did not commit, restart with the old key. If rotation committed but deployment of the replacement key failed, deploy the replacement key before restarting. Do not support multiple live encryption keys in v1.

### `OidcIdentity`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID primary key | internal identity record |
| `user_id` | user FK, indexed | mapped local user |
| `issuer` | string | exact validated issuer |
| `subject` | string | opaque provider subject |
| `created_at` | timestamp | UTC |
| `last_login_at` | timestamp | nullable UTC |

Constraints:

- unique `(issuer, subject)`
- unique `(user_id, issuer)` so a user has at most one identity for a provider
- delete behavior must be explicit; deleting a user should delete its identity mappings in the same service transaction

### `OidcPendingIdentityMapping`

Stores an administrator's declaration that the next admitted, previously unmapped OIDC identity with an exact expected username should bind to a selected existing local user. It is bootstrap state only; successful consumption creates an `OidcIdentity`, after which username no longer participates in identity resolution.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID primary key | internal pending-mapping record |
| `provider_configuration_id` | provider FK | active provider owning the expected username |
| `provider_configuration_revision` | integer | invalidates the pending mapping after an active provider-configuration change |
| `expected_username` | string | trimmed, case-preserving exact value expected from the configured username claim |
| `target_user_id` | user FK, indexed | existing local account to bind |
| `created_by_user_id` | administrator user FK | audit attribution |
| `created_at`, `updated_at` | timestamp | UTC |

Constraints:

- unique `(provider_configuration_id, expected_username)`
- unique `(provider_configuration_id, target_user_id)` so a target has at most one pending mapping for the provider
- reject creation when the target already has an `OidcIdentity` for the provider
- deleting a target user deletes its pending mapping in the same service transaction
- consuming a pending mapping conditionally deletes it and creates the immutable identity in one transaction

Pending mappings are not secrets and do not expire automatically. They remain visible to administrators until consumed, replaced, canceled, invalidated, or deleted with the target. This avoids coordination windows while keeping all mapping decisions administrator-controlled. The UI must warn that reassignment of an IdP username before first consumption could let its new holder claim the pending local account.

### `OidcFlow`

Use one database-backed flow table so login and test sign-in work correctly with multiple backend workers and restarts:

| Field | Purpose |
| --- | --- |
| `id` | internal UUID |
| `purpose` | `login` or `test` |
| `status` | `started`, `callback_processing`, `callback_validated`, or `consumed` |
| `state_hash` | populated when authorization starts, verified, and cleared during callback claiming |
| `grant_hash` | populated after callback only for login exchange; absent for test flows |
| `encrypted_verifier`, `encrypted_nonce` | generated when authorization starts |
| `initiating_admin_id` | administrator binding for test flows |
| `user_id`, `user_token_version` | resolved login identity and revocation snapshot |
| `encrypted_candidate_configuration` | populated only for test flows |
| `configuration_revision` | expected active revision for test activation and active provider revision for login staleness checks; nullable only when a test records that no active configuration existed |
| `return_path`, `expires_at` | safe navigation and cleanup data |

Every transition uses a conditional database update on the expected current status. Terminal flows are consumed once and removed opportunistically. Do not build a generic workflow engine or store provider tokens in the row.

No provider tokens are retained after the callback. If the selected library requires temporary token data, keep it in memory only for the current request.

### `User` changes

- make `password_hash` nullable
- password login must fail generically when `password_hash` is absent
- normal password change and password reset require an existing local password; v1 provides no action that adds a password to a user whose hash is `NULL`
- add no provider subject fields directly to `User`; keep identity linkage normalized

## Configuration Precedence and Lockout Prevention

OIDC provider details and UI-managed login-method state are database-owned. Existing TOML `auth_method` is used only to bootstrap `sign_in_mode` when no database authentication configuration exists.

Required transition:

1. With no OIDC configuration row, preserve current `password` or `none` behavior exactly.
2. Initial provider setup keeps `sign_in_mode=password_only` until **Connect and test** succeeds and an administrator activates an OIDC mode.
3. Once a database auth configuration exists, its single `sign_in_mode` controls password/OIDC availability. Ignore TOML `auth_method` thereafter and log a deprecation warning when it is present. Deployment-level `none` remains a bootstrap mode and cannot be combined with OIDC.
4. Reject `oidc_only` unless the current administrator's tested OIDC identity is mapped to that administrator, is admitted by the proposed policy, and resolves to `admin` under the proposed group mappings. Apply the same fresh-test guard to later admission or role-mapping changes while OIDC-only remains active.
5. Provide `sambee auth set-mode password-only` as the documented emergency command. It updates only `sign_in_mode`, invalidates existing sessions through `token_version`, and does not create, reset, or bypass any password.

Auth configuration changes must clear the frontend auth-config cache and invalidate backend discovery/JWKS configuration caches. Increment `configuration_revision` for every active provider, admission, role-mapping, or sign-in-mode change so in-progress flows and pending username mappings become stale. Creating, consuming, canceling, removing, or reassigning an individual identity mapping does not change the provider revision and therefore does not invalidate unrelated pending mappings. Scope session invalidation in the same database transaction:

- sign-in-mode changes bulk-increment every user's existing `token_version`
- issuer, client ID, scopes, claim names, admission policy/groups, or role mappings bulk-increment `token_version` only for users referenced by `OidcIdentity`
- client-secret-only rotation and display-name changes do not invalidate established Sambee sessions

Existing JWT validation then performs all revocation without a new global JWT claim. Before confirmation, show the number of accounts that will be signed out; do not claim to know the number of active sessions because Sambee does not persist a session registry. If the acting administrator is included, identify that explicitly: **This includes your account. You must sign in through {provider display name} to continue.**

`POST /api/auth/oidc/exchange` always issues a Sambee JWT with the backend constant `OIDC_ACCESS_TOKEN_EXPIRE_MINUTES = 60`. `POST /api/auth/token` retains the configured password-session lifetime. Do not add an authentication-method field to `User` or a persistent authentication-method JWT claim; authorization remains identical after issuance.

The OIDC lifetime is not an administrator setting in v1. In OIDC-only mode, expiration automatically starts OIDC reauthentication once while preserving the safe return path; an active IdP session normally makes this redirect silent. Track that attempt in `sessionStorage` to prevent redirect loops, and clear the marker after successful login. On failure, render the login page with **Try OIDC again** and a generic message that sign-in is temporarily unavailable. OIDC-only intentionally provides no local-login fallback during an IdP outage. Mixed mode returns to the login page with OIDC as the primary action and retains `/login/local`. Explicit logout suppresses automatic reauthentication and clears the attempt marker.

## Backend API

### Public authentication API

`GET /api/auth/config`

```json
{
   "sign_in_mode": "oidc_with_recovery",
  "oidc": {
    "display_name": "Company SSO",
    "authorization_path": "/api/auth/oidc/authorize"
  }
}
```

`sign_in_mode` is the sole public source of truth. The frontend derives available methods from it. Do not add an `oidc` value to the legacy backend bootstrap enum; it cannot represent mixed mode correctly.

Add:

- `GET /api/auth/oidc/authorize`
- `GET /api/auth/oidc/callback`
- `POST /api/auth/oidc/exchange`

All three endpoints are public by necessity, have narrow schemas, and receive dedicated rate limits at the reverse proxy/deployment layer. Callback and exchange failures use stable error codes without exposing provider payloads.

### Admin API

Require the existing `ACCESS_ADMIN_SETTINGS` capability for reads and writes. Under the current fixed-role model this remains admin-only; add a dedicated authentication capability only when delegated/custom roles create a real distinction.

Add:

- `GET /api/admin/auth/oidc` returns redacted configuration
- `PUT /api/admin/auth/oidc` atomically updates configuration. Changing issuer, client ID, client secret, scopes, or claim names requires and consumes a successful administrator-bound test flow. Activation verifies the test flow's expected active revision before writing and creates the initiating administrator's tested identity mapping in the same transaction. Display name may be updated directly. Admission and role-mapping changes may be updated directly with confirmation and scoped session invalidation in **Password only** or **OIDC with local recovery** mode. Entering an OIDC mode requires a successful test; changing admission or role mappings while OIDC-only remains active requires a fresh test proving that the initiating administrator is admitted and still resolves to `admin`.
- `POST /api/admin/auth/oidc/validate` validates a submitted candidate without saving it
- `POST /api/admin/auth/oidc/test-login` validates a submitted candidate, stores its encrypted snapshot on an administrator-bound `OidcFlow`, and starts interactive test sign-in
- `POST /api/admin/auth/oidc/test-result` returns the safe claim preview for an unexpired test flow ID bound to the current administrator without consuming it
- `PUT /api/admin/auth/oidc/mappings/{user_id}/pending` creates or replaces a pending mapping from an exact expected IdP username to an unmapped local user, records the current provider revision, and returns the redacted pending-mapping state
- `DELETE /api/admin/auth/oidc/mappings/{user_id}/pending` cancels the target user's pending mapping
- `POST /api/admin/auth/oidc/mappings/{identity_id}/move` atomically moves a known immutable identity to a selected local user after explicit confirmation and never returns or accepts the raw subject
- `DELETE /api/admin/auth/oidc/mappings/{user_id}` confirms and removes a mapping subject to the last-administrator guard

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
- Derive the public callback URL only from deployment-owned `SAMBEE_PUBLIC_URL`, never from `Host` or forwarded request headers. Require HTTPS in production and use a fixed loopback default in development.
- Validate issuer, audience, authorized party, signature, expiry, issued-at, nonce, and subject.
- Permit only allowlisted asymmetric ID-token signing algorithms, initially `RS256` and optionally `ES256` after compatibility tests.
- Do not accept unsigned tokens or dynamically trust an algorithm from the token header.
- Do not use access-token claims as identity claims.

### Application

- Encrypt the client secret with `SAMBEE_OIDC_SECRET_KEY`, which is external to the database.
- Encrypt each flow's nonce and PKCE verifier with `SAMBEE_OIDC_SECRET_KEY`; do not persist either value or a reversible derivative in plaintext.
- Never log authorization codes, state, nonce, PKCE verifier, grants, client secrets, provider tokens, raw claims, or full group lists.
- Hash state and login grants at rest with SHA-256; compare using constant-time behavior where applicable.
- Consume state and grants atomically to prevent replay.
- Apply existing inactive-user, expiration, and token-version checks.
- Issue OIDC-authenticated Sambee JWTs for at most 60 minutes and continue validating the existing per-user `token_version`.
- Increment `token_version` on role changes and identity mapping, unmapping, or reassignment.
- Rate-limit authorization starts, callbacks, exchanges, and password login separately.
- Add structured audit events for configuration updates, validation attempts, successful/failed OIDC login, provisioning, identity mapping/unmapping/reassignment, and role changes.
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
- `oidc.identity.pending_mapping_created`
- `oidc.identity.pending_mapping_canceled`
- `oidc.identity.mapped`
- `oidc.identity.unmapped`
- `oidc.identity.reassigned`
- `oidc.user.role_changed`

Safe fields include local user ID, username after resolution, provider configuration ID, selected role, failure category, and request correlation ID. Subject may be represented by a one-way diagnostic hash, never the raw value. Configuration changes should record the acting admin and which non-secret fields changed.

## Frontend Implementation

### Types and API client

- replace the public auth config type with the canonical `sign_in_mode` contract and derive password/OIDC availability from it
- add redacted OIDC admin configuration and validation result types
- add API methods for read, update, validate, authorization start, and one-time grant exchange
- centralize successful-token handling so password and OIDC login use the same storage, tracing initialization, current-user load, and redirect logic
- clear `authConfig` cache after saving authentication settings

### Routes and pages

- update `Login` for mixed, OIDC-only, password-only, and `none` states
- add a minimal `/login/oidc/callback` route that parses, removes, and exchanges the fragment grant
- add the admin authentication settings category/page
- add linked-authentication information to user management
- add administrator-only pending username mapping, move, cancel, and unmapping controls to user management and authentication settings
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
- `app/models/oidc.py`: provider, identity, flow, and API models
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
- sign-in-mode validation and fixed standard scope/claim defaults
- singleton configuration database constraint and strict admission/mapping JSON schemas
- secret encryption, replacement, preservation, removal, and response redaction
- encrypted nonce/verifier round trips and absence of plaintext protocol material at rest
- browser-only client-secret visibility, recoverable-error preservation, and clearing after successful test/navigation
- issuer and endpoint URL validation
- role mapping for fixed viewer fallback, one privileged match, multiple matches, duplicates, malformed group claims, and both privileged roles
- stable `(issuer, subject)` lookup regardless of email/username changes
- trim-only, case-preserving username normalization and case-sensitive collision behavior
- disabled, expired, and OIDC-only users
- password change/reset require an existing hash, and no API can add a password to an OIDC-provisioned user
- mandatory profile synchronization and role synchronization when mappings are configured
- missing or invalid optional name/email claims preserve existing local values
- token-version increment only when authorization-relevant state changes
- `OidcFlow` state/grant hashing, status transitions, expiry, atomic consumption, and replay rejection
- pending username mapping validation, uniqueness, replacement, cancellation, and target-mapping guards
- exact, trim-only, case-preserving pending-username matching occurs only after admission and only for an unmapped immutable identity
- test flows are administrator-bound, expire, and never modify active configuration before activation
- activation rejects an active-configuration revision/existence mismatch and atomically commits the candidate plus initiating-administrator mapping
- return-path validation
- log redaction

### Backend integration tests

Use an in-process fake OIDC provider or deterministic mocked HTTP transport; do not depend on a public IdP.

- discovery and JWKS validation
- authorization redirect parameters, including state, nonce, and PKCE challenge
- successful code exchange and ID-token validation
- wrong issuer, audience, nonce, signature, algorithm, expired token, missing subject, unknown key, and rotated key
- UserInfo response with a missing or mismatched subject
- missing required username or groups triggers at most one UserInfo request with no retry or cross-login failure cache
- missing optional name/email does not trigger UserInfo or fail authentication
- provider error callback
- selected-groups and all-IdP-user admission behavior
- selected-groups admission rejects missing, malformed, and nonmatching group claims without creating users
- admitted unknown identities are provisioned once under concurrent callbacks
- identity mapping reuse on subsequent login
- role change invalidates old Sambee JWT
- OIDC callback produces a one-time grant, not a token in the URL
- grant exchange succeeds once and fails on replay/expiry
- OIDC exchange always issues a 60-minute JWT while password login retains the configured password-session lifetime
- multiple backend sessions cannot transition or consume the same flow twice
- an admitted, previously unmapped identity consumes one exact pending username mapping and binds to its target instead of being auto-provisioned
- a non-admitted identity cannot consume a pending mapping, and a pending mapping cannot move an already mapped immutable identity
- concurrent matching logins consume a pending mapping once; stale provider revision, target state, newly established target mapping, and uniqueness conflicts fail closed
- pending mapping creation, replacement, cancellation, and consumption are audited without exposing raw subjects
- mapping, unmapping, pending-mapping replacement, and explicit reassignment enforce identity uniqueness, verify expected mappings, increment affected token versions, and reject removal of the last viable OIDC administrator
- admin APIs reject non-admin users and never return a client secret
- lockout-prevention rules reject unsafe configuration updates
- OIDC-only activation fails unless the tested, mapped administrator remains admitted and an admin under the proposed mappings
- OIDC-only admission/mapping edits require a fresh test proving the initiating administrator remains admitted and admin
- missing, wrong, and rotated external OIDC encryption keys fail closed without destroying configuration
- stopped-application encryption-key rotation verifies replacement ciphertext, atomically deletes all ephemeral flows, rolls back both changes on failure, and requires the replacement key at next startup
- sign-in-mode changes invalidate every user; provider, claim, admission, and mapping changes invalidate only OIDC-linked users
- client-secret-only rotation and display-name changes preserve established sessions
- invalidation confirmation reports affected account count without claiming an active-session count and explicitly identifies when it includes the acting administrator
- validated outbound HTTP rejects forbidden addresses, redirects, invalid certificates, oversized responses, and DNS rebinding
- password, OIDC, mixed, and `none` modes each preserve expected behavior

### Frontend tests

- login renders correctly for all three sign-in modes and deployment-level `none`
- public auth configuration uses only canonical `sign_in_mode`
- OIDC button uses the backend authorization path and preserves a valid return route
- callback removes the fragment and exchanges the grant once
- successful OIDC exchange follows the same post-login initialization as password login
- stable error-code mapping and retry behavior
- admin form secret-preservation semantics
- client-secret visibility affects only the unsent browser value and clears after successful testing/navigation
- guided prerequisites, connect/test, access, and activation states
- admission-mode selection defaults to selected groups and explains the effect of admitting every provider user
- setup and later administration provide the same administrator-owned mapping controls; users receive no self-service mapping controls
- pending mapping confirmation shows the target local account, exact expected IdP username, local role, and administrator-account warning
- users complete pending mappings through ordinary OIDC login without a separate link, mapping screen, or approval step
- standard claims remain hidden by default, advanced overrides can be reset, and observed groups populate mapping choices
- administrator/editor mapping validation and fixed viewer fallback
- case-insensitive normalized group matching and cross-role collision errors
- admin navigation/capability visibility
- accounts without an existing password receive no password-change/reset/add action; OIDC-only mode hides all password-management actions
- pending-mapping UI explains that mapping does not override admission and that the expected IdP username is used only for first binding
- configuration-change confirmation explicitly warns when the acting administrator will be signed out

### End-to-end tests

- local test provider login from signed-out state to `/browse`
- return to a deep browse route
- admitted auto-provisioned viewer cannot access admin APIs/UI
- selected-groups admission denies nonmatching identities without creating users
- mapped admin can access admin settings
- group change updates role on next login according to policy
- disabled local account is denied despite valid provider authentication
- password recovery login works during provider outage when enabled
- OIDC session expiry reauthenticates through an existing IdP session and preserves the return route
- successful reauthentication clears the loop marker; provider failure does not trigger another automatic redirect
- the guided setup configures a provider using only issuer, client ID, and client secret before access choices
- a failed or abandoned candidate test leaves the working provider configuration unchanged
- stale tested configuration cannot overwrite a concurrent administrator update
- activation maps only the tested administrator; administrators create pending username mappings for other existing users afterward
- `/login/local` is usable only in OIDC-with-recovery mode and retains password rate limiting
- `sambee auth set-mode password-only` restores the mode without resetting or bypassing credentials

Run the full backend test suite and type check, frontend test suite and type/lint checks, and the repository-wide test script before completion.

## Migration and Rollout

### Database migration

1. Create provider configuration, immutable identity, pending identity mapping, and `OidcFlow` tables and indexes.
2. Rebuild or alter the SQLite user table safely so `password_hash` is nullable; verify all existing password hashes are preserved.
3. Add uniqueness constraints for federated identities.
4. Do not create identity mappings for existing users automatically. Preserve existing users for explicit administrator-created pending username mappings; never infer a mapping from email or an unconfirmed local/IdP username resemblance.
5. Preserve current auth behavior when no provider configuration exists.

The migration must be idempotent under the repository migration runner. Back up and restore tests must cover an existing database with users and active settings.

### Recommended rollout sequence

1. Ship schema and dormant backend support with no behavior change.
2. Ship admin configuration and non-interactive validation while OIDC activation remains guarded.
3. Ship login, callback, grant exchange, setup-administrator mapping, post-activation administrator-managed pending username mappings, and test-login support.
4. Ship admission-controlled provisioning and profile synchronization.
5. Ship administrator/editor group synchronization with the fixed viewer fallback.
6. Ship documentation and Authelia example before marking the feature complete.

### Rollback

- Disabling OIDC restores password behavior without deleting configuration or identity mappings.
- Existing Sambee JWTs continue to work until normal expiry unless administrators explicitly invalidate them.
- A documented server-side recovery action can re-enable password login if the UI is inaccessible.
- Database downgrade is not required, but older application versions must not be used against the migrated database unless compatibility is verified.

## Documentation Deliverables

Update the earliest applicable documentation version using docs inheritance and the docs editor workflow:

- administrator authentication overview
- OIDC setup procedure and redirect URI
- field-by-field UI reference
- provisioning and role-mapping behavior
- admission modes and their security implications
- lockout prevention and emergency recovery
- OIDC provider client-secret rotation through **Connect and test**
- at-rest encryption-key rotation with stopped-application, deployment, startup-verification, and rollback procedures
- troubleshooting by stable error category
- security/privacy notes about claims and local user records
- upgrade notes for the new database-owned auth configuration behavior

### Authelia example

Provide a complete, version-pinned example that includes:

- Authelia identity provider prerequisites
- an Authelia OIDC client registration for Sambee
- `SAMBEE_PUBLIC_URL`, the derived callback URI, and `/login/local` recovery behavior
- public and local-development redirect URI examples
- client ID and generated client secret handling
- `authorization_code` flow and PKCE settings
- scopes and claims required by Sambee
- admission-group and privileged-role group policies
- example Authelia admission groups plus `admin` and `editor` mappings, with an admitted unprivileged user demonstrating the fixed `viewer` fallback
- corresponding values entered in Sambee's UI
- validation and first-login procedure
- expected behavior for a non-admitted identity and for an admitted identity without a privileged mapping
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
- an admin can complete basic provider setup without editing scopes or claim names
- failed and abandoned test flows do not alter active authentication
- a non-admin cannot read or modify it
- no API, log, or database plaintext field exposes the client secret
- unsafe sign-in-mode and admission combinations are rejected

### Phase 2: login and administrator-managed identity mapping

- implement discovery cache and OIDC library adapter
- implement authorization, callback, and one-time exchange flow
- add immutable identity mappings, administrator-owned pending username mappings, and test-login mechanisms
- update login and callback frontend routes

Acceptance criteria:

- a mapped OIDC user receives a normal Sambee JWT and can use HTTP, WebSocket, and companion-dependent flows allowed by their role
- all protocol validation failures fail closed
- replayed state, callback, and exchange grants are rejected
- no provider or Sambee token appears in redirect URLs or logs
- activation rejects stale tests and maps only the tested initiating administrator; other existing accounts use the normal post-activation mapping flow
- password and `none` regression tests pass

### Phase 3: provisioning and role mapping

- implement selected-groups and all-IdP-user admission with provisioning for admitted unknown identities
- implement claim normalization and profile sync
- implement deterministic group-to-role mapping and synchronization
- expose identity type in user management

Acceptance criteria:

- selected-groups provisions only matching identities and denies missing, malformed, or nonmatching groups
- all-IdP-users provisions one local user for one `(issuer, subject)` under concurrent callbacks
- mapped roles and unmatched policies behave exactly as configured
- deactivated and expired users remain blocked
- role changes invalidate prior Sambee sessions

### Phase 4: documentation and release readiness

- complete administrator, configuration, security, and troubleshooting docs
- add and verify the Authelia example
- run all backend, frontend, end-to-end, migration, and repository checks
- perform a security review focused on OIDC protocol validation, SSRF, account mapping, privilege mapping, replay, and secret handling

Acceptance criteria:

- a new administrator can configure Authelia from the documentation alone
- administrative recovery from an invalid OIDC configuration or lost access is tested and documented; IdP availability is an accepted dependency in OIDC-only mode
- no unresolved high-severity security findings remain

## Resolved Decisions

The following product and security decisions are approved for the first implementation. The normative sections above incorporate them.

### 1. May password and OIDC login coexist?

**Recommended:** yes. Use mixed mode by default so local-password accounts remain available, but permit OIDC-only after the current administrator successfully maps and tests their identity. Treat IdP availability as a required dependency in OIDC-only mode.

Use a separate local-login route in mixed mode so OIDC remains the primary experience. Do not offer it in OIDC-only mode.

**Decision:** use mixed mode by default. Keep local password recovery at `/login/local`, available only in **OIDC with local recovery** mode. Permit OIDC-only mode only after the current administrator maps and successfully tests their OIDC identity. OIDC-only has no local fallback when the IdP is unavailable. Use `sambee auth set-mode password-only` for administrative recovery from bad configuration or lost access; it changes mode but never resets or bypasses credentials.

### 2. Who may modify authentication settings?

**Recommended:** use the existing admin-settings capability while roles are fixed and all administrators have equivalent authority. Add a dedicated capability only with delegated/custom roles.

Decide whether the existing `ACCESS_ADMIN_SETTINGS` capability is sufficient for reads and whether all admins should be allowed to change authentication.

**Decision:** use `ACCESS_ADMIN_SETTINGS` for authentication reads and writes under the current admin-only role model. Revisit a dedicated capability when it can represent a real permission difference.

### 3. How are existing users mapped to OIDC identities?

**Recommended:** administrator-managed mapping only. The administrator selects the local account and declares its exact expected IdP username. The next admitted, previously unmapped identity with that validated username atomically consumes the pending mapping and becomes permanently identified by immutable `(issuer, subject)`. Never infer a mapping from email or require users to choose a local account.

Decide whether users may map themselves, whether administrators can map and unmap later, and whether the operational simplicity of one-time username bootstrap is acceptable given that IdP usernames can be reassigned before first consumption.

**Decision:** users never map accounts themselves. Initial activation maps only the tested identity to the setup administrator. After activation, an administrator selects another existing local user, enters the exact expected IdP username, and confirms a persistent pending mapping. The next admitted, previously unmapped OIDC identity with that validated username consumes the pending mapping during ordinary login and is thereafter resolved only by immutable `(issuer, subject)`. Administrators may cancel or replace pending mappings and explicitly move or remove established mappings. Never auto-map by email, silently match similar usernames, let a pending username move an established identity, or expose or accept a raw provider subject.

### 4. Which claim supplies Sambee usernames?

**Recommended:** default to `preferred_username`, make it configurable, and require uniqueness. Reject provisioning on collision with instructions to ask an administrator to map the existing account or resolve the local username.

Decide whether Sambee may generate a suffix on collision and whether usernames should continue syncing after provisioning. Keeping usernames stable after creation is recommended because they appear in logs and administration.

**Decision:** use configurable `preferred_username` by default, trim surrounding whitespace, preserve case, enforce case-sensitive uniqueness, reject collisions without generated suffixes, and keep the local username stable after creation.

### 5. Which unknown OIDC users may sign in?

**Recommended:** make admission explicit rather than coupling it to an auto-provision toggle. Default to selected groups and require an explicit choice to admit every IdP user. Existing-user mapping is separate from admission and is not required for ordinary first-time OIDC users.

Decide whether the user-facing message should direct users to a named administrator/support channel.

**Decision:** support `selected_groups` (default) and `all_idp_users`. Deny an unknown or nonmatching identity without creating a placeholder. Auto-provision every admitted unknown identity unless its username collides with an existing local user, in which case an administrator must map that account or resolve the collision. Show a generic message directing denied users to their Sambee administrator and log an actionable, privacy-safe reason.

### 6. What role does an admitted user receive without a privileged match?

**Recommended:** use a fixed `viewer` fallback, matching least privilege, and expose mappings only for privileged roles.

Decide whether unmatched users should instead be denied login even when auto-provisioning is enabled.

**Decision:** assign `viewer` to every admitted user with no administrator/editor group match. Do not expose a configurable default role or viewer mapping in v1; admission, not the viewer fallback, controls who may enter Sambee.

### 7. How should roles change on later logins?

**Recommended:** synchronize on every OIDC login. Select the highest privilege among exact group matches. If no privileged group matches, demote to `viewer` and invalidate existing sessions.

Decide whether no match should demote, preserve the current role, or deny login. Also decide whether a manually assigned role can override OIDC synchronization; if yes, the data model needs an explicit role source/override flag.

**Decision:** synchronize at every login, choose the highest matched privilege, demote an unmatched existing user to `viewer`, and invalidate existing sessions after a role change. Do not support manual role overrides while synchronization is enabled.

### 8. Are group names case-sensitive and are nested group paths supported?

**Recommended:** normalized, case-insensitive exact matching against values emitted by the configured groups claim. Treat nested paths as ordinary exact strings; do not infer hierarchy or accept regular expressions in the first release.

Normalize with trimming, Unicode NFKC, and Unicode case folding. Reject cross-role normalization collisions.

**Decision:** use the recommended normalized, case-insensitive exact matching. Do not support prefixes or regular expressions.

### 9. How are absent or malformed group claims handled?

**Recommended:** fail login when mappings/synchronization depend on groups; otherwise treat groups as unused. Do not silently assign a privileged or previous role when required authorization data is absent.

Distinguish malformed authorization data from a valid claim that simply has no privileged match.

**Decision:** when selected-group admission or privileged mappings require groups, fail login if the claim is absent or malformed. A valid nonmatching claim denies admission under `selected_groups`; a valid admitted identity without a privileged match becomes `viewer`. Do not fall back to a previous or privileged role.

### 10. Should OIDC update name and email on each login?

**Recommended:** yes for linked users, while keeping username stable. Treat the provider as authoritative for name/email only, and never overwrite local activity or expiry state.

Decide whether admins need per-user profile overrides.

**Decision:** synchronize each valid, present name or email claim on login, preserve the existing local value when the corresponding claim is absent or invalid, keep username stable, and do not support per-user profile overrides in the first release.

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

**Recommended:** use one deployment-owned canonical public URL to construct and display the redirect URI. Do not infer security-sensitive callback URLs from request headers.

Decide whether existing reverse-proxy deployment configuration already provides a trusted canonical URL and how local development should override it.

**Decision:** require `SAMBEE_PUBLIC_URL` in production, show its derived callback URI read-only in the UI, and use a fixed loopback development default. Never derive callbacks from request headers.

### 15. What network destinations may validation and discovery access?

**Recommended:** HTTPS only, except loopback in development. Allow private-network HTTPS issuers because self-hosted IdPs are a core use case, but document the trust boundary and apply strict timeouts, size limits, URL validation, and redirect restrictions.

Decide whether production deployments need an optional hostname/IP allowlist to reduce SSRF exposure from compromised admin accounts.

**Decision:** use HTTPS only except literal loopback in development, no hostname/IP allowlist, and the container's system trust store. Allow private unicast IdPs; apply the centralized destination, redirect, DNS, timeout, and size rules in Configuration Validation.

### 16. What does “Validate configuration” promise?

**Recommended:** present one **Connect and test** action that runs metadata/JWKS validation and then interactive sign-in. Keep the backend checks separate and state that metadata validation alone cannot verify credentials, redirect registration, consent, or claim mappings.

Decide whether interactive test sign-in is required in the first release or may follow later.

**Decision:** include both checks in the first release behind one guided **Connect and test** action. Require successful test sign-in before either OIDC mode can be activated.

### 17. What logout behavior is required?

**Recommended:** local logout only for the first release: delete the Sambee JWT and explain that the IdP session may still be active. Add RP-initiated logout only after testing provider compatibility and post-logout redirect validation.

Decide whether Authelia or another target provider requires single logout at launch.

**Decision:** local logout only in the first release. Clearly explain that the IdP session may remain active.

### 18. What happens to active sessions after auth configuration changes?

**Recommended:** keep sessions for non-security-sensitive edits, invalidate all users only when sign-in mode changes, and otherwise invalidate OIDC-linked users whose authentication or authorization source changed.

Reuse the existing per-user token version and the `OidcIdentity` relation rather than adding an application-wide JWT claim or authentication-method field.

**Decision:** always increment the provider revision after active security-sensitive changes. Increment every user's `token_version` for sign-in-mode changes; increment only OIDC-linked users for issuer, client ID, scopes, claim, admission, or mapping changes; preserve sessions for client-secret-only rotation and display-name changes.

### 19. Can an OIDC-provisioned user gain a local password?

**Recommended:** no in v1. Preserve passwords for existing local users and allow normal creation of local accounts when password authentication is available, but avoid a special retroactive credential path for OIDC-provisioned users.

Decide whether the added recovery flexibility justifies a separate privileged API, UI, audit, session-invalidation, and authorization contract.

**Decision:** do not implement **Add local password** in v1. Existing local users retain their passwords and may be mapped to OIDC; administrators may create local accounts through the existing workflow when password authentication is available. OIDC-provisioned accounts remain passwordless, and password change/reset require an existing password hash.

### 20. Which OIDC signing algorithms are required?

**Recommended:** require `RS256` initially and add `ES256` only if a target provider needs it and automated tests cover it. Never support `none` or symmetric provider-signed ID tokens using the client secret.

Confirm the algorithms used by required providers, especially the supported Authelia version.

**Decision:** support `RS256` initially. Add `ES256` only when a target provider requires it and automated compatibility tests exist. Never accept unsigned or symmetric provider ID tokens.

## Review Exit Criteria

This specification is ready to become implementation issues when:

- all resolved decisions are represented consistently in normative requirements and tests
- the OIDC client library spike confirms protocol and typing requirements
- the administrator-managed account-mapping and lockout-recovery flows have security approval
- the data migration approach is validated against a copy of a current database
- the Authelia target version and claim format are confirmed
- work is split into independently testable backend, frontend, migration, and documentation issues
