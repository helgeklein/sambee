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
- **Usable administrator:** an active, unexpired local administrator with at least one credential usable under the current sign-in mode: a local password when password login is enabled or an established OIDC identity when OIDC login is enabled.
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
   - keep standard scopes and claim names under **Advanced** in this step because changing them requires another test
3. **Connect and test**
   - stage the values in a short-lived, encrypted test flow without changing the active configuration
   - run metadata and JWKS validation
   - continue directly into interactive test sign-in when those checks pass
   - require and show the resolved groups because every OIDC activation must map the tested administrator through an administrator group
   - show the resolved username, name, and email, never the raw token or complete claims document
4. **Access policy and roles**
   - choose the intended OIDC mode: **OIDC with local recovery** (default) or **OIDC only**
   - choose **Who may sign in?**: **Members of selected groups** (default) or **Any identity-provider user**
   - admission-group selector when **Members of selected groups** is chosen
   - administrator and editor group mappings populated with selectable groups observed during test sign-in
   - manual group entry for groups the testing administrator does not belong to
   - fixed `viewer` fallback for every admitted user who matches neither privileged mapping
   - show the tested identity's live server-calculated admission result and resulting role beside the access controls
   - keep the active sign-in mode unchanged until activation
   - require explicit confirmation that activation will map the tested identity to the current administrator before continuing
5. **Review existing accounts**
   - when other local users exist, show the same stateless mapping-plan table used for provider replacement before activation
   - select a previous pending username by default; show a last-seen IdP username as **Last seen** and a local username as **Unverified**, leaving either hint unselected until the administrator confirms or edits it
   - keep this step optional in **OIDC with local recovery**, but emphasize omitted active passwordless accounts and explain that any existing user who signs in through OIDC before being mapped may encounter a username collision or receive a separate auto-provisioned account
   - before enabling **OIDC only**, require review of the plan and explicit acknowledgement for every omitted active account because local passwords are unusable in that mode
   - show inactive or expired accounts separately as non-selectable and state that they must be reactivated and mapped later
6. **Activate**
   - summarize the resulting login and provisioning behavior before confirmation
   - warn when activation invalidates active sessions or changes the current administrator's login path
   - require the tested identity to be mapped to the current administrator, admitted by the proposed policy, and resolve to `admin` under the proposed mappings before enabling either OIDC mode
   - require a fresh test sign-in before changing admission or role mappings while already in **OIDC only** mode

Manage **Password only** outside the OIDC setup flow as a direct sign-in-mode action. Before switching, show the number of active, unexpired accounts without a local password, state that OIDC will become unavailable, and require explicit confirmation. Block the UI action unless at least one active, unexpired administrator has a local password; direct deliberate containment without one remains available only through the explicitly warned CLI `--force` path. The action does not run an OIDC test or create, replace, or remove identity mappings. Existing provider configuration and mappings remain dormant so OIDC can be re-enabled through a fresh **Connect and test** flow.

Before or after activation, **Existing user mappings** lists local accounts that need to retain their existing Sambee data. For each account, an administrator may enter the expected IdP username and confirm a pending mapping. On that identity's next normal OIDC login, Sambee consumes the pending mapping and permanently binds the validated `(issuer, subject)` to the selected local account. The user receives no separate mapping link, mapping page, or approval prompt. Ordinary admitted users without a pending mapping are auto-provisioned on first OIDC sign-in. Recommend **OIDC with local recovery** during migration so existing local users can continue signing in with their passwords until mapped. Activation of either OIDC mode creates the tested administrator identity and every selected pending mapping in one transaction, preventing an avoidable post-activation access gap.

For migrations with multiple existing accounts, **Existing user mappings** also provides a batch review table. It lists unmapped local accounts and allows inline correction and row selection. Select an existing pending username by default. Show a linked identity's non-authoritative last-seen IdP username as **Last seen** and a local-username fallback as **Unverified**; both are hints and remain unselected until the administrator confirms or edits them. Before confirmation, the backend validates every selected row for empty or duplicate usernames, existing pending or immutable mappings, inactive or deleted targets, and target conflicts. Show all validation errors in the review table and create the complete selected batch atomically only when every row is valid. Show inactive and expired accounts in a separate non-selectable section and explain that their old OIDC links will be removed during replacement and that they may be mapped after reactivation. Do not add CSV import in v1.

After activation, an Advanced provider action named **Remap all OIDC accounts** handles an IdP reinstall or migration that changed subjects even when issuer, client ID, and other provider fields remain unchanged. Supporting text states that it removes every current OIDC account link, signs out affected users, and preserves local users and their data. It starts **Connect and test** with immutable replacement intent and then opens the shared mapping-plan review before making changes. The server assigns the same intent automatically when the tested issuer or client ID differs from the active configuration; Sambee never infers identity continuity from one test account. The server derives the preview from current mappings without storing reviewed rows on the flow. It shows established and pending mapping counts; maps the tested administrator directly; and prefills every other active target. Previous pending usernames are selected by default. A non-authoritative last-seen IdP username is labeled **Last seen**, a local-username fallback is labeled **Unverified**, and both remain unselected until confirmed or edited. Inactive and expired targets appear separately as non-selectable accounts whose old links will be removed. In OIDC-only mode, omitting any active target requires explicit acknowledgement that the user will lose access to their existing local account; in recovery mode, emphasize omitted passwordless targets. Confirmation submits the reviewed rows and expected mapping revision and applies them in one transaction rather than deleting mappings before remapping is prepared.

Standard scopes and claims are not shown in the primary flow. An **Advanced** section contains scopes, defaulting to `openid profile email groups`, and claim-name overrides defaulting to `preferred_username`, `name`, `email`, and `groups`. Each override has a reset-to-default action. The interactive test validates that the configured username claim is present and string-valued, but OIDC does not guarantee that `preferred_username` or another configurable claim is unique, stable, or non-reassignable. Before enabling administrator-created username mappings, require the administrator to confirm from the provider's documentation that the selected claim uniquely identifies one current account for the configured issuer and client ID. Aliases and display names are unsuitable. Document the verified claim for every supported provider; disable pending username mappings for a provider whose claim uniqueness cannot be established. The confirmation records administrator risk acceptance, not a Sambee verification. Changing issuer, client ID, or username claim discards the inherited confirmation, but the administrator may explicitly confirm the newly tested issuer/client-ID/claim tuple on the same review screen and persist that fresh confirmation during activation.

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

Administrators manage mappings from the user-management UI and the authentication-settings **Existing user mappings** section. Users cannot initiate, approve, change, or remove their own mapping. Creating or replacing a pending username mapping, moving an existing immutable identity mapping, changing the identity expected for a local account, and detaching a mapping require confirmation and an audit event. A pending username mapping can bind only a previously unmapped identity to a local account that has no established OIDC identity. Present **Change OIDC account** as the normal linked-user action. It atomically detaches the local account's current identity and creates a pending mapping for a different expected IdP username; it warns that the previous identity remains governed by normal admission and may later auto-provision or encounter a username collision. Place **Move identity to another local user** and **Detach OIDC identity** in an Advanced menu. Moving atomically reassigns a known immutable identity to another unmapped local user and warns that both affected users will be signed out. Detaching carries the same explicit warning that it does not revoke IdP access. Access revocation must use IdP membership, Sambee admission policy, or local account disabling.

Do not implement **Add local password** in v1. Preserve passwords for existing local users and allow administrators to create local accounts through the existing user-management workflow when the sign-in mode permits password authentication, but never add a password retroactively to an OIDC-provisioned account. Password reset and password change require an existing password hash and are unavailable to accounts without one. In **OIDC only** mode, hide all password-management actions because local credentials cannot be used.

Sambee retains one local `User.role` regardless of authentication method. Every successful OIDC login recalculates and synchronizes that role: an admitted identity with no administrator/editor match becomes `viewer`, including when both privileged mapping lists are empty. A password login uses the currently stored role without contacting the IdP. Removing an IdP group can change the stored role on the next OIDC login, but does not remove an existing local password. If synchronization would leave no usable administrator, fail that OIDC login with a stable configuration error, preserve the stored administrator role and mapping, increment `token_version` to revoke every existing session for that user, and emit an actionable audit event. This narrow lockout guard does not grant an OIDC session contrary to current group policy. Recovery requires restoring the administrator's IdP group or switching to password-only and using an existing local password; the error and audit event state when that password does not exist. Disabling or expiring a local user continues to block both authentication methods and must not be undone by auto-provisioning.

Password recovery uses the documented `/login/local` route rather than adding visual noise to the primary OIDC login. It is available only in **OIDC with local recovery** mode and only to local-password accounts. Recovery and Password-only login use the same backend password endpoint and the same IP and normalized-username rate-limit buckets; neither the limiter nor its response distinguishes the current sign-in mode or whether the request came from recovery UI. Recovery does not bypass normal password verification, activity, expiry, or token-version checks. **Password only** continues to use the normal login page.

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

`started` and `callback_processing` flows expire five minutes after authorization begins. Expiry is enforced on every read and transition, so an expired row is unusable even before cleanup deletes it. Flows transition atomically and are deleted after terminal failure or consumption. A periodic or opportunistic cleanup removes expired rows.

### Callback

`GET /api/auth/oidc/callback?code=...&state=...`

1. Reject missing, malformed, expired, already-consumed, or unknown state.
2. Atomically transition exactly one unexpired flow from `started` to `callback_processing` before exchanging the code so no second callback can process it. Check the affected-row count; if it is not exactly one, return `oidc_authorization_state_invalid`, perform no provider request or further mutation, and log only a redacted race, replay, or expiry reason. Any later terminal callback failure conditionally deletes the flow from `callback_processing`; retain the redacted failure audit event separately.
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
   - groups are required for every purpose-`test` flow because activation must prove an administrator group mapping; for login flows they are required only when `selected_groups` admission or a privileged role mapping is configured
   - name and email are optional profile claims; their absence never fails authentication and never triggers UserInfo
7. When a required username or groups claim is absent and the provider advertises UserInfo, make exactly one UserInfo request for the flow through `ValidatedOidcHttpClient`, with no retry and no cross-login failure cache. Require UserInfo `sub` to exactly equal the validated ID-token `sub`, then merge only the configured missing required claims. If the subject differs, UserInfo is unavailable, or a required claim remains absent, fail login. Log a safe internal reason of `user_info_subject_mismatch`, `user_info_unavailable`, or `required_claim_missing_after_user_info` as applicable, without logging claim values, provider bodies, or either subject value.
8. After successful token, nonce, and required-claim validation, conditionally clear `encrypted_verifier` and `encrypted_nonce` on exactly one unexpired `callback_processing` flow while retaining that status for purpose-specific completion. If the affected-row count is not exactly one, return `oidc_authorization_state_invalid`, perform no purpose-specific completion, and retain only a redacted race, cancellation, or expiry event. A terminal validation failure conditionally deletes the flow directly from `callback_processing` instead.
9. Complete the callback according to the flow purpose. A `login` flow resolves the local user and role, rejects inactive or expired users, and continues below. A `test` flow follows its dedicated completion rules without provisioning a user, creating a mapping, or changing authorization.
10. For `login`, generate a random, single-use login grant, store only its hash on the flow, transition the flow to `callback_validated`, and redirect to a frontend callback route with the plaintext grant in the URL fragment. Do not issue a Sambee JWT in the callback.

Example redirect:

```text
/login/oidc/callback#grant=<single-use-random-value>
```

The fragment avoids normal server and proxy request logs. The callback page immediately removes it from browser history and exchanges it through `POST /api/auth/oidc/exchange`. A successful login callback sets `grant_expires_at=now+60 seconds`; the grant can be used once, and exchange rejects it immediately after that deadline regardless of physical row cleanup. The exchange atomically transitions the flow to `consumed`, reloads the local user, rechecks activity, expiry, token version, and provider configuration revision, and only then issues a Sambee JWT. It returns the same login response shape as password authentication, after which the frontend stores the Sambee JWT through its existing path.

Do not put the Sambee JWT, provider authorization code, ID token, or access token in the redirect URL.

### Test sign-in completion

A purpose-`test` callback validates the provider response and configured claims but never creates or maps a user, changes a role, or issues a Sambee session. It encrypts one typed tested-identity snapshot containing only normalized `issuer`, `subject`, `username`, optional `name` and `email`, and the normalized groups array. It stores that snapshot on the administrator-bound flow after clearing the state hash, encrypted verifier, and encrypted nonce; transitions to `callback_validated`; replaces `expires_at` with `now+30 minutes`; and redirects back to the setup flow with the random flow UUID in the URL fragment. It never stores the raw claims document or provider tokens.

If an activation test cannot obtain a valid groups claim from the ID token or the single permitted UserInfo request, delete the terminal flow and redirect to the fixed setup route with only `#error=oidc_required_claim_missing`. The authenticated setup UI removes the fragment from browser history immediately, maps that safe code locally to an explanation that groups are required even with **Any identity-provider user** so the first administrator can be authorized, and suggests checking the requested scopes, configured groups claim, provider claim mapping, and UserInfo support. Never include a group or claim value in the URL or message, and do not create a second server-side error object.

The flow UUID is a correlation identifier, not an authorization credential. The frontend removes it from browser history, keeps it only in `sessionStorage` for the current setup tab, and uses an authenticated admin endpoint to retrieve a safe preview derived from the encrypted tested-identity snapshot. Preview and activation require `ACCESS_ADMIN_SETTINGS`, the same initiating administrator, purpose `test`, status `callback_validated`, and an unexpired row. The preview returns username, optional name and email, groups, server-calculated admission result, matching admission group when applicable, and resulting Sambee role; it never returns issuer, subject, or a subject hash and explains that mapping does not override admission.

**Activate** submits the flow ID, reviewed OIDC sign-in mode, admission policy, privileged group mappings, any fresh username-claim uniqueness confirmation, selected mapping-plan rows, expected `identity_mapping_revision`, and required omitted-account acknowledgements. Operation intent is immutable flow state and is not accepted by the final request. For initial setup, the preview returns and activation must submit `identity_mapping_revision=null`. The test flow records the active `configuration_revision`, or records that no active configuration existed, when testing begins. Inside the activation write transaction, the backend rejects an active-configuration revision/existence mismatch with **Configuration changed; connect and test again**. If no configuration existed when testing began, a newly appeared configuration rejects activation with `oidc_configuration_changed`; otherwise a null mapping revision is required. For an existing configuration, a null or mismatched mapping revision returns `oidc_mapping_review_stale`. It revalidates every submitted row and mode-dependent omitted-account acknowledgement against current users and mappings. It also requires the initiating administrator to remain active and unexpired, the tested identity to be admitted and resolve to `admin`, that identity to map uniquely to the initiating administrator, and the committed result to contain at least one usable administrator. It then atomically persists the server-validated configuration according to the flow intent, creates or verifies the tested identity mapping, creates every selected pending mapping, increments the mapping revision, clears the encrypted candidate and tested identity, and consumes the flow with a minimal non-secret completion receipt containing the committed configuration and mapping revisions. Any conflict or failed write rolls back the entire transaction and leaves the unexpired flow available for correction and retry. A repeated finalization by the same initiating administrator for a consumed flow with that receipt returns the original successful receipt without another mutation; other consumed flows remain unusable. Retain the receipt only until the flow's existing 30-minute expiry, then delete it. The frontend treats a timeout as ambiguous and retries the same flow ID before starting another test. **Cancel** calls the authenticated test-flow deletion endpoint, which conditionally consumes and deletes the initiating administrator's unexpired test flow, encrypted candidate configuration, and encrypted tested identity; closing the setup only discards the browser's flow UUID, while the server deletes the abandoned encrypted values after the flow expires. Neither action affects active authentication. Each **Connect and test** attempt creates a new immutable flow, including immutable `configure` or `replace_identity_namespace` intent. During one unexpired setup flow, intended OIDC mode, admission mode/groups, and role-mapping edits recompute the stateless preview and omission requirements server-side from the encrypted tested identity without another IdP login. Editing issuer, client ID, client secret, scopes, or claim names, or allowing the test to expire, requires a new test. Starting a later admission or role-policy edit while OIDC-only remains active still requires a fresh test sign-in.

Treat issuer and client ID as the identity-namespace boundary. Changing either field makes the server assign `replace_identity_namespace` intent when the test flow starts; do not infer continuity by comparing one tested identity. Administrators may also invoke **Remap all OIDC accounts** without changing provider fields when an IdP reinstall or migration regenerated subjects; that action explicitly requests replacement intent at test start. Replacement requires a fresh interactive test and the shared mapping-plan review before any mapping changes. The final request carries the reviewed rows and expected `identity_mapping_revision`; the flow stores immutable intent but does not persist reviewed rows. The confirmation transaction verifies both revisions and repeats every administrator, row, acknowledgement, uniqueness, and usable-administrator check required by activation; persists the tested provider update; deletes the old established and pending mappings; maps the tested administrator; creates the complete reviewed set of pending mappings for other selected targets; increments affected users' `token_version`; increments both revisions, including for same-configuration replacement; consumes the flow; and writes the audit event. Any failed check or write rolls back the entire transaction. It never reconnects another user by username or email without an administrator-reviewed pending mapping. Recommend **OIDC with local recovery** during replacement. A correctly migrated reinstall that preserves issuer, client ID, and every subject needs no replacement and retains all mappings.

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
7. If a pending mapping exists, atomically recheck that it still exists, the target user remains active and unmapped, the exact expected claim still matches, and `(issuer, subject)` remains unmapped; consume it and create the constrained `OidcIdentity` with `last_seen_username` set to the validated username in the same transaction. If any check changed or a database identity constraint fails, fail closed with a stable mapping-conflict error and create no user or identity.
8. If no pending mapping exists, create the local user and identity mapping, including its initial `last_seen_username`, in one database transaction.

Email, username, and display name remain mutable profile attributes and never resolve an established identity. Username is used only once to consume an explicit administrator-created pending mapping; every later login resolves exclusively through immutable `(issuer, subject)`.

### Administrator-managed identity mapping

Users never map accounts themselves. An administrator owns every mapping operation. Sambee never infers a mapping merely because a local username or email resembles an OIDC claim and never asks users to select a local account. Because standard OIDC does not provide a portable account-directory API, an administrator bootstraps a mapping by declaring the exact IdP username expected for a selected local account. A later normal OIDC login converts that pending declaration into an immutable `(issuer, subject)` mapping.

During initial setup, the administrator maps the successfully tested identity directly to their own local account and may prepare pending mappings for other existing users in the shared mapping-plan review. The backend reuses the validated `(issuer, subject)` from the administrator-bound test flow, requires explicit confirmation, applies the same uniqueness and target-state validators used by normal batch mapping, and creates the administrator identity and every selected pending mapping in the activation transaction. It never maps another user directly from the test identity or an inferred username.

For any other existing local user:

1. An administrator with `ACCESS_ADMIN_SETTINGS` selects **Map OIDC account** for the target local user.
2. The administrator enters the exact username emitted by the configured OIDC username claim. Prefer a previous pending value or non-authoritative last-seen IdP username when available. Otherwise prefill the local username as **Unverified**. Keep the field editable, require explicit confirmation, trim surrounding whitespace, preserve case, and reject an empty value or an exact duplicate pending username for the provider.
3. The confirmation shows the local account, expected IdP username, current local role, pending-mapping age when replacing one, and a stronger warning when the target is an administrator. It explains that mapping remains subject to admission, role will be recalculated from current IdP groups on first login, the current local role may not survive, and the first admitted, previously unmapped OIDC identity with that exact username will claim the account.
4. If the target has no established OIDC identity, Sambee creates or replaces the target user's `OidcPendingIdentityMapping`, recording the initiating administrator. Pending mappings persist until consumed, replaced, canceled, replaced as part of an issuer, client-ID, username-claim, or explicit account-remapping transaction, or removed with the target user. Display them as **Waiting for first OIDC login** with expected username, creator, age, and **Cancel**; established mappings display as **OIDC linked**.
5. On the matching identity's next normal OIDC login, the login transaction applies admission first, verifies that `(issuer, subject)` is not already mapped, rechecks the pending mapping and target, creates the immutable `OidcIdentity`, consumes the pending mapping, updates the target's synchronized profile and role, and increments `token_version`. The user sees only the normal OIDC login flow.

An existing immutable identity always wins over any username match and can never be moved by consuming a pending mapping. To move an existing identity, an administrator selects that known mapping and an unmapped local target, then confirms an atomic reassignment; the UI never exposes or accepts the raw subject. To associate a different identity with an already mapped local account, **Change mapping** atomically verifies the current mapping and target state, detaches the established identity, creates the pending username mapping, increments the target's `token_version`, and writes one audit event. If any precondition changed, the whole transaction fails. A newly established target mapping, deleted or inactive target, duplicate username, deleted pending mapping, or identity uniqueness conflict fails closed and requires administrator review. Detaching or changing an identity does not deny the previous identity future login when admission still permits it.

Creating, replacing, batch-creating, canceling, consuming, moving, changing, and removing mappings write audit events and increment `token_version` for every affected local user when an immutable mapping changes. In OIDC-only mode, reject removing, moving, or changing the last active mapped local administrator. Admission and role-policy edits remain subject to the separate fresh-test guard.

### Provisioning

For a new identity:

- require non-empty configured username and subject claims
- normalize the proposed username exactly like the current local model: trim surrounding whitespace, preserve case, and apply case-sensitive uniqueness; do not lowercase or rewrite characters
- reject a collision with an existing username, create no user or mapping, and direct the user to ask an administrator to map the existing local account or resolve the username collision
- set name and email from configured claims only after applying the existing `User` model validators
- set `password_hash` to `NULL` for a newly OIDC-provisioned user
- set `must_change_password=false`
- set `is_active=true`
- leave `expires_at=NULL`
- calculate the role before inserting the user
- insert `User` and `OidcIdentity` atomically

An invalid or missing optional profile claim does not invalidate a login; it is omitted and logged at debug level without its raw value. A missing required username produces a stable configuration/claims error.

Profile synchronization trims surrounding whitespace, applies the existing `User` field-length and email-format validators, and rejects empty values. It does not invent a second OIDC-specific definition of a valid user profile. Invalid values preserve the existing local value and are logged without raw claim data.

### Existing mapped users

On every successful OIDC login:

- update `last_login_at` on the identity
- update the identity's non-authoritative `last_seen_username` from the validated, trimmed configured username claim; use it only for administrator-visible mapping prefills and never for established identity resolution
- update name or email only when the corresponding provider claim is present and passes the existing `User` model validators; preserve the existing local value when the claim is absent or invalid; per-user profile overrides are not supported in the first release
- recalculate the role from provider groups on every OIDC login; assign `viewer` when no privileged mapping matches, including when both privileged mapping lists are empty; manual role overrides are not supported
- if the calculated role would leave no usable administrator, preserve the stored role and mapping, increment `token_version`, emit an audit event that records whether a local recovery password exists, fail the login with `oidc_last_administrator_role_conflict` or its `oidc_last_administrator_role_conflict_no_recovery` variant as applicable, and issue no Sambee JWT
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
| `username_claim_uniqueness_confirmed` | boolean | administrator risk-acceptance attestation for the current issuer/client-ID/username-claim tuple; required before creating pending mappings; inherited value is discarded when any component changes, while a fresh explicit confirmation may be saved with the tested update |
| `name_claim` | nullable string | proposed default `name` |
| `email_claim` | nullable string | proposed default `email` |
| `groups_claim` | nullable string | proposed default `groups` |
| `admission_mode` | enum | `selected_groups` (default) or `all_idp_users` |
| `admission_groups_json` | JSON text | string array used only by `selected_groups` |
| `role_mappings_json` | JSON text | strict object `{"admin": string[], "editor": string[]}` |
| `configuration_revision` | integer | invalidates in-progress flows after security-sensitive changes |
| `identity_mapping_revision` | integer | increments once per committed transaction containing one or more established or pending mapping mutations and guards reviewed plans against concurrent changes |
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
| `last_seen_username` | nullable string | latest validated, trimmed configured username claim; display and mapping-prefill aid only, never an identity key |
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

Pending mappings are not secrets and do not expire automatically. They remain visible to administrators until consumed, replaced, canceled, or deleted with the target. This avoids coordination windows while keeping all mapping decisions administrator-controlled. Changing the active issuer, client ID, or configured username claim deletes every pending mapping and discards the inherited uniqueness attestation in the same configuration transaction because those changes alter the declaration's meaning. The tested update may store a new explicit attestation for its issuer/client-ID/username-claim tuple in that transaction; Sambee must describe it as administrator risk acceptance rather than verified uniqueness. Explicitly remapping all OIDC accounts also deletes every old pending mapping but preserves the attestation when that tuple is unchanged. Before confirmation, show the number of pending mappings that will be replaced. Admission, role, scope, client secret, display-name, and sign-in-mode changes do not invalidate pending mappings. Current admission and role policy are evaluated when the mapping is consumed. The UI must warn that reassignment of an IdP username before first consumption could let its new holder claim the pending local account.

### `OidcFlow`

Use one database-backed flow table so login and test sign-in work correctly with multiple backend workers and restarts:

| Field | Purpose |
| --- | --- |
| `id` | internal UUID |
| `purpose` | `login` or `test` |
| `intent` | purpose-`test` immutable `configure` or `replace_identity_namespace`; the server derives replacement for issuer/client-ID changes |
| `status` | `started`, `callback_processing`, `callback_validated`, or `consumed` |
| `state_hash` | populated when authorization starts, verified, and cleared during callback claiming |
| `grant_hash` | populated after callback only for login exchange; absent for test flows |
| `encrypted_verifier`, `encrypted_nonce` | generated when authorization starts and cleared immediately after successful callback validation |
| `initiating_admin_id` | administrator binding for test flows |
| `user_id`, `user_token_version` | resolved login identity and revocation snapshot |
| `encrypted_candidate_configuration` | populated only for test flows |
| `encrypted_tested_identity` | purpose-`test` normalized identity snapshot containing issuer, subject, username, optional name/email, and groups; never returned directly |
| `configuration_revision` | expected active revision for test activation and active provider revision for login staleness checks; nullable only when a test records that no active configuration existed |
| `return_path`, `expires_at` | safe navigation and authorization/test lifetime; successful test callback resets expiry to 30 minutes |
| `grant_expires_at` | nullable; set to 60 seconds after a successful login callback and enforced independently of row cleanup |
| `finalized_at`, `finalized_configuration_revision`, `finalized_identity_mapping_revision` | nullable purpose-`test` non-secret completion receipt used only to make provider finalization idempotent until normal flow expiry |

Every transition uses a conditional database update on the expected current status and verifies that exactly one row changed. A zero-row transition returns the generic invalid-state error and performs no later network request or state mutation. Successful one-time exchange and explicit cancellation may transition a flow to `consumed` before deletion or opportunistic cleanup. Successful provider finalization retains only its non-secret completion receipt until normal expiry so an identical retry can return success. Terminal callback failures conditionally delete the row directly from `callback_processing` and write only a separate redacted audit event; they never transition to `consumed`. Do not build a generic workflow engine or store provider tokens in the row.

No provider tokens or raw claims documents are retained after the callback. If the selected library requires temporary token data, keep it in memory only for the current request. Delete encrypted tested identity and candidate configuration with the flow on cancellation, expiry cleanup, terminal failure, or consumption.

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
5. Provide `sambee auth set-mode password-only` as the documented emergency command. Before changing state, list the number of active, unexpired administrators with local passwords and active passwordless accounts that will lose access. Refuse by default when no usable local-password administrator exists. Permit `--force` only after an explicit lockout warning for deliberate containment of a compromised IdP. Recompute both counts after confirmation and abort with a refreshed warning if either changed. On confirmation of unchanged counts, update only `sign_in_mode`, invalidate existing sessions through `token_version`, and never create, reset, or bypass a password.
6. If login-time role synchronization would leave no usable administrator, increment that user's `token_version` to revoke existing sessions and deny the OIDC login without changing the stored role or mapping. Log and audit the policy conflict and whether a local recovery password exists so an operator can restore the IdP group mapping or use the emergency command with that password.

Auth configuration changes must clear the frontend auth-config cache and invalidate backend discovery/JWKS configuration caches. Increment `configuration_revision` for every active provider, admission, role-mapping, or sign-in-mode change so in-progress browser flows become stale. Every replacement increments it even when provider fields are unchanged. Changing issuer, client ID, or username claim deletes all pending username mappings and discards the inherited uniqueness attestation in the same transaction; the reviewed update may include a fresh explicit attestation. Issuer changes, client-ID changes, and explicit account remapping replace established and pending identities only after the administrator reviews the complete replacement plan. Other configuration changes preserve mappings. Increment `identity_mapping_revision` once in every committed transaction that creates, consumes, replaces, cancels, moves, changes, removes, or cascade-deletes one or more pending or established mappings, including provider replacement. Updating only `last_seen_username` or `last_login_at` is profile metadata and does not increment it. Ordinary login and test flows ignore this revision; replacement confirmation rejects a mismatch so concurrent mapping administration cannot invalidate its preview silently. Mapping operations do not change `configuration_revision` and therefore do not invalidate unrelated login flows or pending mappings. Scope session invalidation in the same database transaction:

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

All three endpoints are public by necessity, have narrow schemas, and receive dedicated application-enforced rate limits enabled by default. A reverse proxy may add stricter defense-in-depth limits but is not required for correct enforcement. Callback and exchange failures use stable error codes without exposing provider payloads.

### Admin API

Require the existing `ACCESS_ADMIN_SETTINGS` capability for reads and writes. Under the current fixed-role model this remains admin-only; add a dedicated authentication capability only when delegated/custom roles create a real distinction.

Add:

- `GET /api/admin/auth/oidc` returns redacted configuration
- `PUT /api/admin/auth/mode` accepts only `sign_in_mode=password_only`, the expected `configuration_revision`, `expected_passwordless_account_count`, and explicit acknowledgement when that expected count is nonzero. Inside the write transaction it returns `oidc_configuration_changed` for a stale configuration revision, `passwordless_account_count_changed` when the recomputed active-and-unexpired count differs, or `password_only_no_local_administrator` when no active, unexpired administrator has a local password, without changing mode or sessions. The UI cannot override the last condition; only the separately authenticated CLI command supports warned `--force`. Otherwise it bulk-increments user token versions and preserves provider configuration and mappings. It cannot enable either OIDC mode; those transitions require the tested OIDC finalization flow
- `PUT /api/admin/auth/oidc` is the sole provider finalization endpoint and atomically updates configuration according to immutable test-flow intent; it does not accept an operation field. Changing issuer or client ID makes the server create a `replace_identity_namespace` test flow automatically, while the explicit **Remap all OIDC accounts** action requests that intent with unchanged provider fields. Changing issuer, client ID, client secret, scopes, or claim names requires and consumes a successful administrator-bound test flow. For initial activation or replacement, it accepts selected `{target_user_id, expected_username}` mapping-plan rows, the nullable expected mapping revision, and omitted-account acknowledgements. Activation verifies the test flow's expected active revision and all submitted mapping state before writing, then creates or verifies the initiating administrator's tested identity mapping and selected pending mappings in the same transaction. The successful transaction clears encrypted flow payloads and stores only the non-secret completion receipt. A retry by the same initiating administrator with the same finalized flow ID returns that receipt with `200` and performs no mutation; a consumed flow without a matching receipt remains unusable. Changing issuer, client ID, or username claim reports and replaces affected pending mappings, discards the inherited username-claim uniqueness attestation, and may persist a fresh explicit attestation from the same review. Display name may be updated directly. Admission and role-mapping changes may be updated directly with confirmation and scoped session invalidation in **OIDC with local recovery** mode. Entering either OIDC mode requires a successful test proving that the initiating administrator is admitted and resolves to `admin`; changing admission or role mappings while OIDC-only remains active requires the same fresh proof. Switching to Password-only uses the separate direct mode action and never this finalization flow.
- `POST /api/admin/auth/oidc/test-login` validates a submitted candidate and requested intent without saving active configuration; on validation failure it returns the structured check report, and on success it stores the encrypted candidate configuration and immutable server-derived intent on an administrator-bound `OidcFlow`, sets `Cache-Control: no-store`, and returns a server-generated `authorization_url` from validated discovery metadata. The frontend starts interactive test sign-in with a top-level `window.location.assign`; it never follows the provider redirect as an Axios or Fetch request and never accepts an authorization URL from the client
- `POST /api/admin/auth/oidc/test-flows/{flow_id}/preview` accepts a typed proposed OIDC sign-in mode, admission mode/groups, and administrator/editor role mappings. It derives the redacted identity evaluation and, when accounts require migration or replacement, a mapping-plan preview plus nullable `identity_mapping_revision` from `encrypted_tested_identity` without consuming or mutating the flow or storing reviewed rows. The revision is `null` when no active configuration exists. Rows include target state, prefill source, selection default, and mode-dependent omission acknowledgement. Require the initiating administrator, purpose `test`, status `callback_validated`, and an unexpired row; return `404` when the flow does not exist, is expired, or belongs to another administrator, and set `Cache-Control: no-store`
- `DELETE /api/admin/auth/oidc/test-flows/{flow_id}` conditionally consumes and deletes an unexpired purpose-`test` flow belonging to the current administrator, including its encrypted candidate and tested identity, and returns `204`; return `404` when it does not exist, is expired, is already terminal, or belongs to another administrator
- `PUT /api/admin/auth/oidc/mappings/pending` requires `username_claim_uniqueness_confirmed=true` and accepts a structured JSON array of `{target_user_id, expected_username}` rows for both individual and batch operations. It returns row-keyed validation errors containing `target_user_id`, `field`, and stable `error_code`, creates or replaces the complete selected set atomically only when every row is valid, and returns the redacted pending-mapping states. It does not accept CSV
- `DELETE /api/admin/auth/oidc/mappings/{user_id}/pending` cancels the target user's pending mapping
- `POST /api/admin/auth/oidc/mappings/{identity_id}/move` atomically moves a known immutable identity to a selected local user after explicit confirmation and never returns or accepts the raw subject
- `POST /api/admin/auth/oidc/mappings/{user_id}/change` atomically verifies and detaches the target user's current immutable identity, creates a pending mapping for the submitted expected username, invalidates the target's sessions, and emits one audit event
- `DELETE /api/admin/auth/oidc/mappings/{user_id}` confirms and removes a mapping subject to the last-administrator guard

Candidate-validation failure response example from `POST /api/admin/auth/oidc/test-login`:

```json
{
   "valid": false,
  "checks": [
    {"name": "issuer", "status": "passed"},
      {
         "name": "discovery",
         "status": "failed",
         "error": "The issuer metadata could not be validated.",
         "suggestion": "Verify the issuer URL and that its certificate is trusted by the Sambee container."
      }
  ]
}
```

Successful test-start response:

```json
{
   "authorization_url": "https://idp.example.com/authorize?..."
}
```

Each failed check returns a safe, actionable `error` and optional `suggestion`; it never includes raw remote content. Never echo secrets, discovery documents, JWKS bodies, provider error bodies, or tokens in this response.

### Stable authentication errors

Public authentication failures use this compact registry. The frontend renders only the listed user-safe message plus an optional correlation ID; detailed causes remain in redacted server logs.

| Code | HTTP status | User-safe message |
| --- | --- | --- |
| `oidc_authorization_state_invalid` | 400 | **This sign-in request expired or is invalid. Start again.** |
| `oidc_provider_unavailable` | 502 | **The identity provider is temporarily unavailable. Try again later.** |
| `oidc_required_claim_missing` | 502 | **The identity provider did not supply required account information. Contact your Sambee administrator.** |
| `oidc_user_not_admitted` | 403 | **You do not have permission to sign in to this Sambee instance.** |
| `oidc_username_collision` | 409 | **This identity cannot be connected automatically. Contact your Sambee administrator.** |
| `oidc_mapping_conflict` | 409 | **The account mapping changed or conflicts with another account. Contact your Sambee administrator.** |
| `oidc_mapping_review_stale` | 409 | **OIDC account mappings changed. Review the updated mapping plan and confirm again.** |
| `oidc_configuration_changed` | 409 | **Authentication settings changed during sign-in. Start again.** |
| `passwordless_account_count_changed` | 409 | **The number of accounts that would lose access changed. Review the updated warning and confirm again.** |
| `password_only_no_local_administrator` | 409 | **Password only requires an active administrator with a local password. Use the documented server command for emergency recovery or deliberate containment.** |
| `oidc_last_administrator_role_conflict` | 409 | **Your administrator access changed. Restore the IdP group or use local recovery after the operator enables Password only.** |
| `oidc_last_administrator_role_conflict_no_recovery` | 409 | **Your administrator access changed and no local recovery password exists. Restore the administrator group at the identity provider.** |
| `oidc_rate_limited` | 429 API / 303 navigation | **Too many sign-in attempts. Wait and try again.** |

`oidc_rate_limited` is one logical error with endpoint-specific transport. Authorization-start and callback browser navigations return `303 See Other` to the fixed `/login#error=oidc_rate_limited` location. That redirect must not reflect any request value. Exchange and password-login APIs return `429 Too Many Requests`, include `Retry-After`, and use their canonical generic JSON bodies. The password response must not disclose account existence, sign-in mode, or recovery intent.

`oidc_mapping_review_stale`, `passwordless_account_count_changed`, and `password_only_no_local_administrator` are admin-only. On a stale mapping review, the frontend discards the stale reviewed plan, refetches the complete server-derived plan, and shows **Mappings changed while you were reviewing. Review the refreshed plan before continuing.** It never merges or silently resubmits stale edits. On a changed passwordless-account count, it refreshes the count and requires a new acknowledgement. When no local-password administrator exists, it blocks the UI action and points to the documented server command without offering a force control. Other admin validation and mapping APIs use the same codes where applicable and may add safe field and row context. Do not expose provider payloads, claim values, subjects, secrets, or internal exception text.

## Configuration Validation

The non-interactive validation stage at the start of **Connect and test** must:

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
- report that an interactive test can verify that the username claim is present and string-valued but cannot prove that the provider issues it uniquely; administrator-created pending mappings require a provider-documented uniqueness guarantee

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
- Increment `token_version` when last-administrator protection blocks a role change so previously issued administrator sessions are revoked even though the recovery role is preserved.
- Enforce bounded application-level rate limits by default: authorization starts at 20 requests per source IP per 5 minutes, callbacks at 60 per source IP per 5 minutes, exchanges at 30 per source IP per 5 minutes, and password login at 10 attempts per source IP per 5 minutes plus 10 attempts per normalized username per 15 minutes. Authorization, callback, exchange, and the shared password endpoint use independent buckets; the normalized-username password bucket is an additional check rather than a separate endpoint bucket. The password limits apply in Password-only and recovery modes.
- Use bounded in-memory TTL/LRU maps for the supported single-application-process deployment, with separate capacities of 10,000 source-IP keys and 10,000 username keys. Remove expired entries before evicting the least-recently-used entry at capacity; capacity is handled only through eviction, never blanket rejection of unseen keys. A restart may clear baseline limits. Multi-instance deployments require a shared limiter before horizontal scaling.
- Build the password username-bucket key by trimming surrounding whitespace while preserving case and Unicode code points. Values longer than the named 256-code-point limiter-input maximum share one fixed overlength bucket and continue through the generic invalid-credentials path. Store only a SHA-256 hash of the normalized limiter key, and do not change the exact submitted username used for password lookup.
- Derive source IP from the direct peer by default and keep framework-level proxy-header rewriting disabled. `SAMBEE_TRUSTED_PROXY_CIDRS` is an optional comma-separated environment variable containing validated IP addresses or CIDR ranges and defaults to empty. Only when the direct peer matches a configured range, parse `X-Forwarded-For` strictly from right to left, skip trusted addresses, and select the first untrusted address. Use the direct peer when the chain is malformed or contains no untrusted address. Support IPv4 and IPv6; never accept hostnames, partial addresses, or arbitrary client-supplied forwarding headers as rate-limit keys.
- Treat reverse-proxy limits as optional defense in depth. Documented proxy examples may strengthen but must not replace or weaken the application defaults.
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
- `oidc.identity.pending_mapping_batch_created`
- `oidc.identity.pending_mapping_canceled`
- `oidc.identity.mapped`
- `oidc.identity.unmapped`
- `oidc.identity.reassigned`
- `oidc.identity.mapping_changed`
- `oidc.provider.identity_namespace_replaced`
- `oidc.user.role_changed`
- `oidc.user.role_sync_blocked`

Safe fields include local user ID, username after resolution, provider configuration ID, selected role, failure category, and request correlation ID. Subject may be represented by a one-way diagnostic hash, never the raw value. Configuration changes should record the acting admin and which non-secret fields changed.

## Frontend Implementation

### Types and API client

- replace the public auth config type with the canonical `sign_in_mode` contract and derive password/OIDC availability from it
- add redacted OIDC admin configuration, validation result, successful test-start, tested-identity preview request/response, mapping-plan, and direct-mode request/error types
- add API methods for read, update, intent-bound connect/test, stateless body-bearing preview, authorization start, direct Password-only mode change, and one-time grant exchange
- schema-check that the server-generated test-start `authorization_url` is absolute and uses HTTPS, allowing HTTP only for a literal loopback development URL, then pass it unchanged to top-level `window.location.assign`; never follow it in Axios or Fetch, modify it, or construct or accept it from client input
- treat provider-finalization timeout as ambiguous and retry the same flow ID so the server's completion receipt can return the original success; do not start a replacement test until that retry resolves
- centralize successful-token handling so password and OIDC login use the same storage, tracing initialization, current-user load, and redirect logic
- clear `authConfig` cache after saving authentication settings

### Routes and pages

- update `Login` for mixed, OIDC-only, password-only, and `none` states
- add a minimal `/login/oidc/callback` route that parses, removes, and exchanges the fragment grant
- add the admin authentication settings category/page
- keep protocol fields and Advanced scope/claim overrides in Provider, run **Connect and test**, then choose intended OIDC mode, admission, and role mappings together in **Access policy and roles** using the observed identity; expose Password-only as a separate direct mode action rather than an OIDC activation result
- on test failure, parse only the allowlisted safe error code from the fragment, remove it from history immediately, and render authenticated setup guidance locally
- add linked-authentication information to user management
- add one administrator-only individual/batch pending-mapping control and a normal **Change OIDC account** action; place move and detach controls in an Advanced menu
- add the shared stateless mapping-plan review to initial activation and route the Advanced **Remap all OIDC accounts** action through the same component before confirmation
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
- encrypted nonce/verifier round trips, absence of plaintext protocol material at rest, and immediate ciphertext clearing after successful callback validation
- encrypted tested-identity round trips, typed field limits, preview redaction, and deletion on cancellation, expiry cleanup, terminal failure, and consumption
- browser-only client-secret visibility, recoverable-error preservation, and clearing after successful test/navigation
- issuer and endpoint URL validation
- role mapping for fixed viewer fallback, one privileged match, multiple matches, duplicates, malformed group claims, and both privileged roles
- stable `(issuer, subject)` lookup regardless of email/username changes
- `last_seen_username` updates only from a validated configured username claim, remains nullable for migrated identities, and never participates in established identity lookup
- trim-only, case-preserving username normalization and case-sensitive collision behavior
- disabled, expired, and OIDC-only users
- password change/reset require an existing hash, and no API can add a password to an OIDC-provisioned user
- mandatory profile synchronization and role synchronization on every OIDC login
- optional name/email claims use existing `User` model validators; missing or invalid values preserve existing local values
- role synchronization that would leave no usable administrator increments `token_version` and fails login without changing the stored role or mapping
- token-version increment only when authorization-relevant state changes
- `OidcFlow` state/grant hashing, status transitions, expiry, atomic consumption, and replay rejection
- every conditional flow transition requires exactly one affected row; zero-row callback claims and completions return `oidc_authorization_state_invalid` and perform no subsequent network request or purpose-specific mutation
- authenticated body-bearing test-flow preview is stateless and enforces purpose, status, expiry, initiating-administrator binding, request typing, response redaction, and `Cache-Control: no-store`
- terminal callback failures conditionally delete only from `callback_processing`, retain no candidate or tested-identity ciphertext, emit a separate redacted audit event, and never transition to `consumed`
- explicit cancellation enforces purpose, status, initiating-administrator binding, terminal-state handling, and encrypted-candidate deletion
- pending username mapping validation, uniqueness, replacement, cancellation, and target-mapping guards
- the unified pending-mapping operation accepts one or many rows, reports each error by target user and field, and commits no rows unless the complete selected set is valid
- **Change mapping** atomically detaches the expected current identity, creates the pending mapping, invalidates the target's sessions, and rolls back on any conflict
- exact, trim-only, case-preserving pending-username matching occurs only after admission and only for an unmapped immutable identity
- provider username claims without a documented uniqueness guarantee cannot enable pending mappings
- issuer, client-ID, or explicit account remapping replaces pending mappings only from a reviewed plan while unrelated configuration changes preserve them
- inherited username-claim uniqueness confirmation is discarded after issuer, client-ID, or username-claim changes, while a fresh explicit confirmation for the tested tuple may be persisted in the same activation
- issuer and client-ID changes require provider replacement; explicit replacement also works when provider fields are unchanged
- every transaction containing one or more pending or established mapping mutations increments `identity_mapping_revision` once, while metadata-only identity updates and ordinary login flows remain independent of it
- server-derived mapping-plan previews persist no reviewed rows, select only prior pending usernames by default, and present last-seen IdP and local usernames as unselected confirmation-required hints
- final initial-activation and replacement requests submit reviewed rows and the expected mapping revision; a mismatch returns `oidc_mapping_review_stale` without changing configuration, mappings, sessions, or the test flow
- initial setup returns and requires a null mapping revision; a concurrently created configuration returns `oidc_configuration_changed`, while existing configurations require an exact non-null revision
- activation and replacement both recheck that the initiating administrator remains active and unexpired, the tested identity is admitted and resolves to `admin`, its mapping is unique, and the result contains a usable administrator
- a replacement transaction either persists the provider update, replaces old mappings with the tested administrator and all reviewed pending rows, invalidates affected sessions, increments both revisions, consumes the flow, and audits the operation together, or rolls back every effect
- `PUT /api/admin/auth/oidc` is the only provider-finalization endpoint and accepts no operation field; issuer/client-ID changes derive immutable replacement intent at test start, while unchanged fields require the explicit remapping action to start a replacement-intent flow
- test flows are administrator-bound, expire, and never modify active configuration before activation
- flow lifetimes enforce five minutes before callback completion, 30 minutes after successful test callback, and a separate 60-second login-grant deadline regardless of cleanup timing
- activation rejects an active-configuration revision/existence mismatch and atomically commits the candidate plus initiating-administrator mapping
- successful finalization clears encrypted flow payloads, stores only the non-secret revision receipt until test-flow expiry, and returns the same receipt without mutation when the initiating administrator retries the finalized flow ID
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
- UserInfo unavailability, subject mismatch, and a still-missing required claim produce distinct safe internal reason codes without provider bodies, claims, or raw subjects
- a missing activation-test groups claim deletes the flow and redirects with only the allowlisted fragment code; the authenticated setup UI removes it immediately and gives actionable scope, claim-mapping, and UserInfo guidance without claim values or provider payloads
- missing optional name/email does not trigger UserInfo or fail authentication
- provider error callback
- selected-groups and all-IdP-user admission behavior
- selected-groups admission rejects missing, malformed, and nonmatching group claims without creating users
- admitted unknown identities are provisioned once under concurrent callbacks
- identity mapping reuse on subsequent login
- role change invalidates old Sambee JWT
- attempted role synchronization that would leave no usable administrator increments `token_version`, invalidates existing sessions, fails the OIDC login, preserves the stored role and mapping, emits the expected audit event, and selects the stable error variant according to local-password availability
- OIDC callback produces a one-time grant, not a token in the URL
- grant exchange succeeds once and fails on replay/expiry
- OIDC exchange always issues a 60-minute JWT while password login retains the configured password-session lifetime
- multiple backend sessions cannot transition or consume the same flow twice
- an admitted, previously unmapped identity consumes one exact pending username mapping and binds to its target instead of being auto-provisioned
- a non-admitted identity cannot consume a pending mapping, and a pending mapping cannot move an already mapped immutable identity
- concurrent matching logins consume a pending mapping once; deleted pending state, target state, newly established target mapping, and identity uniqueness conflicts fail closed
- pending mapping creation, replacement, cancellation, and consumption are audited without exposing raw subjects
- unified individual/batch pending-mapping creation returns row-keyed errors and succeeds completely or leaves every row unchanged
- atomic **Change mapping** leaves no detached-without-pending intermediate state
- mapping, unmapping, pending-mapping replacement, and explicit reassignment enforce identity uniqueness, verify expected mappings, increment affected token versions, and reject removal of the last viable OIDC administrator
- detaching an admitted identity is not treated as access revocation; the confirmation and tests cover subsequent auto-provisioning or username-collision behavior
- admin APIs reject non-admin users and never return a client secret
- lockout-prevention rules reject unsafe configuration updates
- the direct mode endpoint can only select Password-only, rejects a stale configuration revision, requires the displayed expected active-and-unexpired passwordless-account count, returns `passwordless_account_count_changed` when the transactional count differs, refuses with `password_only_no_local_administrator` when no active unexpired local-password administrator exists, preserves OIDC configuration and mappings, and cannot enable OIDC without a test
- OIDC-only activation fails unless the tested, mapped administrator remains admitted and an admin under the proposed mappings
- activation of either OIDC mode creates reviewed pending mappings in the same transaction as the tested administrator identity; OIDC-only requires acknowledgement for every omitted active account, and recovery mode emphasizes omitted passwordless accounts
- mode, admission, and role-mapping edits on an unexpired validated setup flow are reevaluated from the encrypted tested-identity snapshot without another IdP login; provider fields, scopes, and claim-name edits require a fresh test
- missing, wrong, and rotated external OIDC encryption keys fail closed without destroying configuration
- stopped-application encryption-key rotation verifies replacement ciphertext, atomically deletes all ephemeral flows, rolls back both changes on failure, and requires the replacement key at next startup
- sign-in-mode changes invalidate every user; provider, claim, admission, and mapping changes invalidate only OIDC-linked users
- client-secret-only rotation and display-name changes preserve established sessions
- invalidation confirmation reports affected account count without claiming an active-session count and explicitly identifies when it includes the acting administrator
- switching to password-only reports the count of passwordless accounts that will lose sign-in access, requires explicit confirmation of that count, and returns `passwordless_account_count_changed` without side effects when concurrent user changes make it stale
- issuer, client-ID, or username-claim changes report affected pending mappings, discard the inherited uniqueness attestation, and can persist a fresh explicit confirmation for the tested tuple
- issuer changes, client-ID changes, and explicit same-configuration replacement preserve local users and data while atomically replacing established and pending identity mappings from the reviewed plan
- concurrent mapping administration after replacement review changes `identity_mapping_revision` and rejects the stale replacement without partial deletion
- stale mapping-plan recovery discards stale edits, refetches the complete authoritative plan, shows the required review-again message, and never merges or silently resubmits
- inactive and expired targets are shown as non-selectable, have old links removed during replacement, and can be mapped only after reactivation
- explicit test-flow cancellation immediately deletes the initiating administrator's encrypted candidate, while closing the page leaves it for expiry cleanup
- a committed provider finalization whose response is lost succeeds idempotently when the same administrator retries the same flow ID; a failed transaction leaves the unexpired flow correctable and reusable
- test callback stores only the encrypted typed identity snapshot and candidate configuration, returns no issuer or subject in preview, and retains no provider token or raw claims document
- successful callback validation clears encrypted nonce and verifier fields before login resolution or test preview storage
- provider updates and explicit same-configuration remapping use the same `PUT` contract and transaction service
- the Password-only emergency command reports usable local-password administrators and affected passwordless accounts, refuses a lockout by default, rechecks both counts after confirmation, and requires `--force` plus an explicit warning for deliberate IdP containment
- validated outbound HTTP rejects forbidden addresses, redirects, invalid certificates, oversized responses, and DNS rebinding
- password, OIDC, mixed, and `none` modes each preserve expected behavior

### Frontend tests

- login renders correctly for all three sign-in modes and deployment-level `none`
- public auth configuration uses only canonical `sign_in_mode`
- OIDC button uses the backend authorization path and preserves a valid return route
- callback removes the fragment and exchanges the grant once
- successful OIDC exchange follows the same post-login initialization as password login
- every stable authentication error code maps to its specified status, user-safe message, and retry behavior
- admin form secret-preservation semantics
- client-secret visibility affects only the unsent browser value and clears after successful testing/navigation
- guided prerequisites, provider, connect/test, combined access-policy-and-roles, review-existing-accounts, and activation states
- successful test start schema-checks the server-generated `authorization_url` as absolute HTTPS or literal-loopback development HTTP and passes it unchanged to top-level `window.location.assign` without an Axios/Fetch redirect or a client-built URL
- tested-identity preview submits the proposed mode, admission, and role mappings in a typed `POST`, uses the returned stateless evaluation, and does not cache the response
- intended OIDC mode, admission, and role mappings are chosen together after connect/test using the observed identity, the active mode remains unchanged during review, and Password-only is not offered as an OIDC activation result
- admission-mode selection defaults to selected groups and explains the effect of admitting every provider user
- setup and later administration provide the same administrator-owned mapping controls; users receive no self-service mapping controls
- pending mapping confirmation shows the target local account, exact expected IdP username, local role, and administrator-account warning
- users complete pending mappings through ordinary OIDC login without a separate link, mapping screen, or approval step
- pending mapping UI uses **Waiting for first OIDC login** and shows expected username, creator, age, and cancellation; established mappings use **OIDC linked**
- a previous pending username is selected by default; a last-seen IdP username is labeled **Last seen** and a local fallback **Unverified**, with both hints unselected until confirmed or edited
- batch mapping review prefills usernames, permits inline corrections and row selection, shows all conflicts, and has no CSV import
- individual and batch mapping use the same request contract and show row-keyed validation errors
- pending mappings are unavailable until the administrator confirms the provider-documented uniqueness of the configured username claim
- issuer, client-ID, or username-claim edits visibly discard the inherited uniqueness confirmation and allow a fresh confirmation for the tested tuple on the same review screen
- standard claims remain hidden by default, advanced overrides can be reset, and observed groups populate mapping choices
- administrator/editor mapping validation and fixed viewer fallback
- case-insensitive normalized group matching and cross-role collision errors
- admin navigation/capability visibility
- accounts without an existing password receive no password-change/reset/add action; OIDC-only mode hides all password-management actions
- pending-mapping UI explains that mapping does not override admission and that the expected IdP username is used only for first binding
- **Change OIDC account** is the normal confirmed action and never exposes a detached-without-pending intermediate state
- move and detach are Advanced actions, and detach warns that it does not revoke admitted IdP access
- issuer or client-ID changes require account remapping and show affected mapping counts without a continuity choice
- **Remap all OIDC accounts** is available without editing provider fields; its supporting text clearly states that current OIDC links will be removed, affected users signed out, and local data preserved
- the same stateless mapping-plan review is available during initial OIDC activation and replacement, permits inline correction and omission, requires acknowledgement for every omitted active target in OIDC-only mode, and emphasizes omitted passwordless targets in recovery mode
- inactive and expired accounts appear in a separate non-selectable section explaining that replacement removes their old links and reactivation is required before mapping
- a stale-plan response discards stale edits, refetches the complete plan, displays the review-again message, and never merges or silently resubmits
- canceling setup calls the test-flow deletion API, while merely closing the setup explains that server cleanup occurs at expiry
- switching to **Password only** shows and confirms the count of accounts without local passwords that will lose sign-in access
- the Password-only confirmation sends the displayed count to the direct mode endpoint and refreshes both the count and acknowledgement after `passwordless_account_count_changed` or a stale configuration revision
- the Password-only UI action is blocked with `password_only_no_local_administrator` when no active unexpired administrator has a local password and never offers the CLI-only force behavior
- a missing groups claim during setup arrives only as an allowlisted fragment error code; the UI removes it from history and explains the required administrator-role check plus scopes, claim mapping, and UserInfo configuration without rendering raw claims
- an ambiguous provider-finalization timeout retries the same flow ID and renders the retained successful receipt rather than starting another test
- configuration-change confirmation explicitly warns when the acting administrator will be signed out

### End-to-end tests

- local test provider login from signed-out state to `/browse`
- return to a deep browse route
- admitted auto-provisioned viewer cannot access admin APIs/UI
- selected-groups admission denies nonmatching identities without creating users
- mapped admin can access admin settings
- group change updates role on next login according to policy
- removal of the last administrator's IdP group revokes existing sessions and denies that login without destroying the local administrator role needed for recovery
- a passwordless last administrator receives an explicit instruction to restore the IdP group rather than attempt unavailable local recovery
- disabled local account is denied despite valid provider authentication
- password recovery login works during provider outage when enabled
- OIDC session expiry reauthenticates through an existing IdP session and preserves the return route
- successful reauthentication clears the loop marker; provider failure does not trigger another automatic redirect
- the guided setup configures a provider using only issuer, client ID, and client secret before access choices
- a failed or abandoned candidate test leaves the working provider configuration unchanged
- explicit setup cancellation immediately removes the administrator-bound encrypted candidate and cannot cancel another administrator's flow
- stale tested configuration cannot overwrite a concurrent administrator update
- initial setup access-policy edits recompute the stored test preview without another IdP login
- successful test start leaves the API client at Sambee and navigates the browser top level to the server-generated provider URL
- concurrent user changes after Password-only review return `passwordless_account_count_changed`; the UI refreshes the warning and no mode or session state changes
- switching to Password-only through the UI is rejected without side effects when no active unexpired local-password administrator exists, while the warned CLI `--force` remains the only override
- a lost finalization response followed by a same-flow retry returns the committed revisions once and does not repeat configuration, mapping, session, or audit mutations
- initial activation of either OIDC mode atomically maps the tested administrator and creates every selected pending mapping from the shared plan; OIDC-only requires acknowledgement for every omitted active user
- batch pending-mapping review atomically prepares multiple existing users without CSV import
- an IdP reinstall with preserved issuer, client ID, and subjects retains mappings; an explicit same-configuration replacement stages all retained-user mappings before one atomic commit and preserves local data
- a concurrent mapping change after replacement review rejects confirmation and preserves every old mapping and session state
- OIDC-only replacement never commits before every omitted active target is explicitly acknowledged, and selected targets receive pending mappings in the replacement transaction
- a replacement test whose initiating administrator became inactive, expired, non-admitted, non-admin, or no longer uniquely mappable rolls back without changing the active provider or mappings
- `/login/local` is usable only in OIDC-with-recovery mode and retains password rate limiting
- switching to password-only warns about passwordless accounts, verifies the acknowledged count transactionally, and only then invalidates sessions
- detaching an admitted identity shows that the operation does not revoke access and its next login follows normal provisioning or collision rules
- `sambee auth set-mode password-only` restores the mode without resetting or bypassing credentials, refuses by default when no usable local-password administrator exists, and permits deliberate IdP containment only through the warned `--force` path

Run the full backend test suite and type check, frontend test suite and type/lint checks, and the repository-wide test script before completion.

## Migration and Rollout

### Database migration

1. Create provider configuration, immutable identity, pending identity mapping, and `OidcFlow` tables and indexes. Initialize `configuration_revision` and `identity_mapping_revision` to zero for a new or migrated singleton configuration, with non-null database defaults; initialize migrated identities' nullable `last_seen_username` to `NULL`; add nullable test intent, encrypted tested-identity, grant-expiry, and non-secret finalization-receipt flow columns.
2. Rebuild or alter the SQLite user table safely so `password_hash` is nullable; verify all existing password hashes are preserved.
3. Add uniqueness constraints for federated identities.
4. Do not create identity mappings for existing users automatically. Preserve existing users for explicit administrator-created pending username mappings; never infer a mapping from email or an unconfirmed local/IdP username resemblance.
5. Preserve current auth behavior when no provider configuration exists.

The migration must be idempotent under the repository migration runner. Back up and restore tests must cover an existing database with users and active settings.

### Recommended rollout sequence

1. Ship schema and dormant backend support with no behavior change.
2. Ship admin configuration and non-interactive validation while OIDC activation remains guarded.
3. Ship login, callback, grant exchange, setup-administrator mapping, shared pre-commit mapping-plan review, administrator-managed pending username mappings, and test-login support.
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
- pending username mapping prerequisites, provider claim uniqueness, and detach-versus-revoke behavior
- IdP reinstall and migration guidance for preserving issuer, client ID, subject identifiers, and pairwise-subject state
- initial account migration and **Remap all OIDC accounts**, including the shared stateless pre-commit mapping-plan review, affected-user sign-out, inactive-user disposition, omitted-user access consequences, and mixed-mode recovery
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
- add admin read/update APIs with validation integrated into **Connect and test**
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
- Password-only is changed through a direct confirmed action that creates no OIDC mapping, while either OIDC mode requires an intent-bound successful test whose identity is admitted and resolves to `admin`
- the Password-only UI transition refuses to commit unless an active, unexpired local-password administrator exists; only the documented CLI command exposes warned force behavior
- pending username mappings remain disabled until provider claim uniqueness is confirmed for the issuer/client-ID/username-claim tuple and are replaced only through reviewed plans when issuer, client ID, username claim, or explicit account remapping changes their trust context

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
- activation rejects stale tests, maps the tested initiating administrator, and atomically creates selected pending mappings from the shared plan without requiring a post-activation migration step
- provider finalization is idempotent by flow ID, so a lost successful response can be retried without repeating configuration, mapping, session, or audit mutations
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

**Decision:** use mixed mode by default. Keep local password recovery at `/login/local`, available only in **OIDC with local recovery** mode. Permit either OIDC mode only after the current administrator maps and successfully tests an identity that is admitted and resolves to `admin`; OIDC-only has no local fallback when the IdP is unavailable. Treat Password-only as a direct mode action outside OIDC setup. Its API transaction verifies the administrator-acknowledged active-and-unexpired passwordless-account count, requires renewed review if the count changed, and refuses the UI action unless an active unexpired administrator has a local password. Use `sambee auth set-mode password-only` for administrative recovery from bad configuration or lost access; it reports usable local-password administrators and affected passwordless accounts, refuses a lockout by default, rechecks both counts after confirmation, permits an explicitly warned CLI-only `--force` for deliberate IdP containment, and never resets or bypasses credentials.

### 2. Who may modify authentication settings?

**Recommended:** use the existing admin-settings capability while roles are fixed and all administrators have equivalent authority. Add a dedicated capability only with delegated/custom roles.

Decide whether the existing `ACCESS_ADMIN_SETTINGS` capability is sufficient for reads and whether all admins should be allowed to change authentication.

**Decision:** use `ACCESS_ADMIN_SETTINGS` for authentication reads and writes under the current admin-only role model. Revisit a dedicated capability when it can represent a real permission difference.

### 3. How are existing users mapped to OIDC identities?

**Recommended:** administrator-managed mapping only. The administrator selects the local account and declares its exact expected IdP username after verifying that the provider guarantees the configured claim is unique within the issuer. The next admitted, previously unmapped identity with that validated username atomically consumes the pending mapping and becomes permanently identified by immutable `(issuer, subject)`. Never infer a mapping from email or require users to choose a local account.

Decide whether users may map themselves, whether administrators can map and unmap later, and whether the operational simplicity of one-time username bootstrap is acceptable given that IdP usernames can be reassigned before first consumption.

**Decision:** users never map accounts themselves. Activation of either OIDC mode maps the tested identity to the setup administrator and may atomically create administrator-reviewed pending mappings for other existing users through the same stateless pre-commit mapping-plan flow used for provider replacement. Password-only is a separate direct mode action and never creates or changes mappings. Only a previous pending username is selected by default; non-authoritative last-seen IdP and local usernames are unselected hints requiring explicit confirmation. OIDC-only requires acknowledgement for every omitted active account, and recovery mode emphasizes omitted passwordless accounts. After activation, administrators retain the same individual and batch controls. The next admitted, previously unmapped OIDC identity with a validated username consumes its pending mapping during ordinary login and is thereafter resolved only by immutable `(issuer, subject)`. Administrators may cancel or replace pending mappings, atomically change the identity expected for an already mapped account, and explicitly move or detach established mappings. Detaching or changing a mapping does not revoke an identity that remains admitted. Never auto-map by email, silently accept an unreviewed username hint, let a pending username move an established identity, or expose or accept a raw provider subject.

### 4. Which claim supplies Sambee usernames?

**Recommended:** default to `preferred_username`, make it configurable, and require uniqueness. Reject provisioning on collision with instructions to ask an administrator to map the existing account or resolve the local username.

Decide whether Sambee may generate a suffix on collision and whether usernames should continue syncing after provisioning. Keeping usernames stable after creation is recommended because they appear in logs and administration.

**Decision:** use configurable `preferred_username` by default, trim surrounding whitespace, preserve case, enforce case-sensitive local uniqueness, reject collisions without generated suffixes, and keep the local username stable after creation. OIDC does not guarantee that this claim is unique; pending mappings require provider documentation establishing that the configured claim uniquely identifies one current account within the issuer.

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

**Decision:** synchronize at every login, choose the highest matched privilege, demote an unmatched existing user to `viewer`, and invalidate existing sessions after a role change. If that result would leave no usable administrator under the current sign-in mode, increment `token_version` to revoke existing sessions, deny the OIDC login, and preserve the stored role and mapping solely for recovery. Do not support manual role overrides while synchronization is enabled.

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

**Decision:** synchronize each present name or email claim that passes the existing `User` model validators, preserve the existing local value when the corresponding claim is absent or invalid, keep username stable, and do not support per-user profile overrides in the first release.

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

**Recommended:** present one **Connect and test** action that runs metadata/JWKS validation and then interactive sign-in. Keep validation as a separate internal typed operation, not a separate public admin endpoint, and state that metadata validation alone cannot verify credentials, redirect registration, consent, or claim mappings.

Decide whether interactive test sign-in is required in the first release or may follow later.

**Decision:** include both checks in the first release behind one guided **Connect and test** action and one test-start endpoint. Test the Provider fields first, then choose intended OIDC mode, admission, and role mappings together from the observed identity; require groups for every activation test and require the successful tested identity to be admitted and resolve to `admin` before either OIDC mode can be activated. On successful test start, return a server-generated absolute HTTPS authorization URL, allowing HTTP only for literal loopback development, for unchanged top-level browser navigation. Store only an encrypted typed tested-identity snapshot, derive redacted evaluations through a stateless body-bearing `POST` preview, and clear encrypted nonce and verifier values immediately after successful callback validation. Bind immutable `configure` or `replace_identity_namespace` intent to the test flow and use one operation-free, flow-ID-idempotent provider-finalization endpoint with a short-lived non-secret completion receipt. During an unexpired setup flow, reevaluate intended mode, admission, and role mappings from the snapshot without another IdP login; require a new test only after provider fields, scopes, or claim names change, the test expires, or an active OIDC-only policy is edited outside that setup flow.

### 17. What logout behavior is required?

**Recommended:** local logout only for the first release: delete the Sambee JWT and explain that the IdP session may still be active. Add RP-initiated logout only after testing provider compatibility and post-logout redirect validation.

Decide whether Authelia or another target provider requires single logout at launch.

**Decision:** local logout only in the first release. Clearly explain that the IdP session may remain active.

### 18. What happens to active sessions after auth configuration changes?

**Recommended:** keep sessions for non-security-sensitive edits, invalidate all users only when sign-in mode changes, and otherwise invalidate OIDC-linked users whose authentication or authorization source changed.

Reuse the existing per-user token version and the `OidcIdentity` relation rather than adding an application-wide JWT claim or authentication-method field.

**Decision:** always increment the provider revision after active security-sensitive changes, including same-configuration account remapping, and increment a separate mapping revision once per transaction containing one or more pending or established mapping mutations. Metadata-only identity updates do not increment it. Increment every user's `token_version` for sign-in-mode changes; increment only OIDC-linked users for issuer, client ID, scopes, claim, admission, or mapping changes; preserve sessions for client-secret-only rotation and display-name changes. Treat issuer and client ID as the identity-namespace boundary, so changing either always requires a reviewed replacement plan that atomically replaces established and pending mappings while preserving local users and data. Also provide **Remap all OIDC accounts** for an IdP reinstall that regenerated subjects without changing provider fields; a reinstall that preserves issuer, client ID, and every subject retains mappings without any Sambee action.

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
