# OAuth/OIDC Authentication Implementation Plan

## Status

- **Purpose:** dependency-ordered execution plan for the approved OAuth/OIDC specification
- **Normative source:** [OAuth/OIDC Authentication Implementation Specification](OAUTH_OIDC_IMPLEMENTATION_SPEC.md)
- **Target:** one standards-compliant OpenID Connect provider in the first release
- **Repository baseline:** Sambee `0.9.0`
- **Implementation state:** planning only; no application code is changed by this document

This plan translates the normative specification into readiness gates and reviewable implementation issues. If this plan and the specification conflict, the specification wins. Update the specification and record approval before implementing a behavior that differs from it.

## Delivery Principles

- Preserve current `password` and deployment-level `none` authentication semantics until an administrator completes tested OIDC activation. The application-enforced password rate limit introduced by PR 12 is an approved security hardening for every password-enabled mode, including existing Password-only deployments, rather than an OIDC activation behavior.
- Keep every intermediate pull request deployable with OIDC dormant or unavailable.
- Keep protocol, outbound HTTP, configuration, identity, and API concerns behind typed boundaries.
- Use the same Sambee JWT and authorization path after either password or OIDC authentication.
- Make migrations idempotent and rehearse them against a copy of a current database before activation code ships.
- Keep secrets, protocol material, provider tokens, raw claims, and raw OIDC subjects out of APIs, URLs, logs, audit rows, and diagnostics.
- Make account mapping and provider replacement transactional. Never expose a detached or partially replaced state.
- Use canonical backend request and response models as the source for frontend types and contract tests.
- Roll out breaking backend/frontend contracts through an explicit compatibility bridge or one atomic pull request; never leave a deployed frontend expecting a removed field.
- Add focused tests in the same pull request as each behavior. Do not defer security-negative tests to final hardening.
- Follow the pinned and hashed backend dependency workflow before changing requirement or lock files.

## Scope And Non-goals

This plan covers the complete first-release OIDC feature described by the specification: provider configuration, validated OIDC networking, interactive testing, login, admission, provisioning, role synchronization, administrator-owned mapping, recovery, frontend workflows, audit persistence, documentation, and release validation.

It does not add generic OAuth 2.0, multiple active providers, self-service account linking, SAML, LDAP, SCIM, background group synchronization, RP-initiated logout, public OIDC clients, private-key JWT authentication, local passwords for OIDC-provisioned users, or a replacement for Sambee JWTs. It does not extend the legacy `AuthMethod` enum with OIDC values; database-owned `sign_in_mode` becomes authoritative only after an authentication configuration row exists.

## Current Repository Anchors

### Backend

- `backend/app/core/auth_methods.py` owns only bootstrap `none` and `password` modes and should remain limited to those values.
- `backend/app/core/config.py` and `backend/app/core/environment.py` are the existing deployment configuration boundaries.
- `backend/app/core/security.py` owns password hashing and Sambee JWT behavior.
- `backend/app/api/auth.py` owns the current public auth config and password token endpoints.
- `backend/app/api/admin.py` is the existing administrator API surface; focused OIDC routers may be introduced instead of enlarging it.
- `backend/app/models/user.py` currently requires `password_hash` and contains reusable profile validators, roles, activity, expiry, and `token_version`.
- `backend/app/db/migrations.py` is the explicit, ordered, idempotent migration runner.
- `backend/app/main.py` registers routers and startup behavior.
- No database-backed audit-event model, reusable validated OIDC HTTP adapter, or packaged `sambee` CLI entry point currently exists.
- `backend/requirements.txt` includes PyJWT and cryptography but no complete OIDC client implementation.

### Frontend

- `frontend/src/services/authConfig.ts` owns the public auth configuration cache and currently falls back to password mode when the request fails.
- `frontend/src/services/api.ts` and neighboring service modules provide the existing API-client patterns.
- `frontend/src/pages/Login.tsx` owns password login and deployment-level `none` behavior.
- `frontend/src/App.tsx` owns route registration.
- `frontend/src/pages/UserManagementSettings.tsx` owns user-management presentation.
- `frontend/src/components/Settings/settingsNavigation.ts` owns settings navigation and capability visibility.
- `frontend/src/i18n/resources.ts` owns user-visible translated strings.

### Validation And Documentation

- `scripts/refresh-backend-lockfiles` is the required lockfile refresh path.
- `scripts/test` is the repository-wide validation entry point.
- End-user documentation belongs under `website/content/docs/` and must follow the docs inheritance and docs-editor workflow.

## Readiness Gates

The gates below are implementation prerequisites, not new product decisions. A gate is complete only when its listed artifact and checks are reviewed. Work explicitly identified as independent may proceed in parallel, but no dependent production behavior may merge first.

### Gate R1: OIDC library and validated HTTP adapter proof

**Owner:** backend/security

**Required before:** public authorization, callback, token exchange, UserInfo, or production provider validation.

Build a focused spike comparing current Authlib and PyJWT/PyJWKClient behavior against the specification. Authlib is the preferred starting point, but selection must be evidence-based. Prove that all library network access can be routed through a Sambee-owned `ValidatedOidcHttpClient`; reject a library path that performs hidden discovery, JWKS, token, or UserInfo requests.

The spike must prove or document the Sambee wrapper for:

- discovery and exact issuer validation
- authorization URL construction with PKCE S256, state, and nonce
- confidential-client code exchange through the validated transport
- ID-token signature, issuer, audience, `azp`, time, nonce, algorithm, and subject validation
- one forced JWKS refresh for an unknown key ID
- normalized typed claims without leaking library token dictionaries
- deterministic mocked-transport tests with no public IdP dependency

**Artifact:** a short decision record in the implementation pull request describing the selected library, version, extension points, rejected alternative, and any Sambee-owned validation retained around it.

**Exit check:** the adapter test fails if the library attempts an unapproved network call.

### Gate R2: quantitative protocol and network constants

**Owner:** backend/security

**Required before:** Gate R1 production adapter merges.

Define named constants in the adapter, with tests at every boundary. Initial values should be reviewed during the spike rather than hidden in client defaults:

| Control | Proposed initial value |
| --- | --- |
| Connect timeout | 3 seconds |
| Read timeout | 5 seconds |
| Discovery response limit | 1 MiB |
| JWKS response limit | 1 MiB |
| Token response limit | 256 KiB |
| UserInfo response limit | 256 KiB |
| Password form body limit | 64 KiB |
| Concurrent OIDC outbound requests per process | 4 |
| Discovery/JWKS cache maximum age | 1 hour, further bounded by valid HTTP cache directives |
| ID-token clock skew | 60 seconds |
| Maximum future `iat` tolerance | 60 seconds |
| Pre-callback flow lifetime | 5 minutes |
| Validated test-flow lifetime | 30 minutes |
| Login-grant lifetime | 60 seconds |
| OIDC Sambee JWT lifetime | 60 minutes |

The implementation issue may revise a proposed value with security-review approval and a corresponding specification update when behavior changes. Redirect count remains zero. UserInfo retries remain zero. JWKS gets only the one unknown-key refresh required by the specification.

**Exit check:** tests cover timeout, exact-size acceptance, one-byte-over rejection, concurrency, redirect, cache-age, and clock-skew boundaries.

### Gate R3: canonical API and error models

**Owner:** backend with frontend review

**Required before:** backend and frontend API implementation proceed independently.

Create canonical Pydantic models and enums for:

- public auth configuration and the three sign-in modes
- redacted administrator configuration
- candidate configuration and validation checks
- test-start success
- typed test-flow preview request and response
- tested identity presentation
- mapping-plan rows, prefill sources, target states, and omission acknowledgements
- provider finalization request and completion receipt
- direct Password-only transition request and response
- pending mapping batch requests and row-keyed errors
- move, change, detach, and cancellation operations
- one-time grant exchange and existing login response reuse
- stable public and administrator error codes
- administrator prerequisites and authentication health, with exact fields for `oidc_secret_key_configured`, `public_url_configured`, safe canonical `public_url`, derived `redirect_uri`, `status` (`healthy` or `unhealthy`), and an ordered `reasons` array. Freeze the reason enum as `oidc_secret_key_missing`, `oidc_secret_key_invalid`, `oidc_secret_decryption_failed`, `public_url_missing`, `public_url_invalid`, and `no_active_administrator`; an empty array is the only healthy result. Return simultaneous failures in that listed order and reject unknown codes in backend and frontend contract parsing
- administrator-only user authentication state containing `has_local_password`, pending-mapping state, and a nullable redacted OIDC object with opaque `identity_id`, provider display name, and last successful OIDC login; this is the read source for the move endpoint and never includes issuer, subject, or a subject hash

Generate and snapshot the relevant OpenAPI component schemas. Frontend types may be generated from or manually mirrored against that reviewed snapshot, but contract tests must detect drift.

**Exit check:** secret fields, issuer, subject, subject hash, provider payloads, and raw claims are absent from every response model where the specification forbids them. OpenAPI and frontend contract tests cover every authentication-health reason, deterministic ordering of simultaneous failures, empty-reasons healthy state, and unknown-code rejection.

### Gate R4: transactional audit persistence

**Owner:** backend/security

**Required before:** configuration, mapping, provisioning, or role-sync mutations merge.

Add a database-backed audit record rather than relying on application logs. The model must support the stable event names in the specification, UTC timestamp, acting user when known, affected local user when safe and applicable, provider configuration ID, request correlation ID, result/failure category, and a strict typed safe-details object or allowlisted JSON schema.

Audit writes that describe a committed mutation must occur in the same database transaction as that mutation. Failed operations may write a separate redacted failure event after rollback. Audit insertion failure must fail and roll back a security-sensitive mutation rather than silently losing the record.

Retain OIDC audit rows indefinitely in v1; document database growth and backup implications. An audit UI is not required. Transactional persistence and field allowlisting close this gate. The operator export is a separate operational deliverable owned by Gate R5 and PR 10 and is required before activation cutover, not before earlier audited mutations merge.

**Exit check:** tests prove mutation rollback on audit-write failure and prove that forbidden values cannot enter serialized audit details.

### Gate R5: emergency CLI delivery contract

**Owner:** backend/operations

**Required before:** OIDC-only activation is available.

Choose and document one supported invocation that works in the production container. Preferred contract: a packaged console entry point named `sambee`, implemented by a focused module such as `backend/app/cli.py`, yielding:

```text
sambee auth set-mode password-only [--force]
sambee auth rotate-oidc-secret-key
sambee auth audit export [--since <timestamp>] [--event <name>]
```

If repository packaging cannot reliably install a console script, use an explicitly supported module invocation and provide a container wrapper; do not document an accidental `python -c` command. The mutation commands must reuse application services and transaction logic rather than duplicate database mutations. Audit export is read-only, accepts only typed filters, returns only allowlisted persisted fields, and never decrypts OIDC data.

**Exit check:** container-level tests invoke all documented commands, cover confirmation and stale-count rechecks, prove that no command accepts or prints encryption keys, and prove that audit-export filters cannot expose arbitrary tables or fields.

### Gate R6: migration rehearsal

**Owner:** backend/data

**Required before:** the activation-cutover pull request may register provider finalization or expose an OIDC mode.

Rehearse the migration against:

- a fresh database
- a copy of a current database with users and system settings
- a database where all existing users have passwords
- rollback from an intentionally failed table rebuild
- backup and restore after migration

Verify row counts, password-hash preservation, indexes, foreign keys, singleton and uniqueness constraints, non-null revision defaults, and idempotent reruns.

**Exit check:** migration tests retain a fixture representing the oldest supported upgrade state, and the activation-cutover review links the successful current-database backup/upgrade/restore rehearsal.

### Gate R7: enforceable authentication rate limits

**Owner:** backend/security

**Required before:** public OIDC routes or `/login/local` are usable in an active OIDC mode.

Implement baseline limits in the backend so direct-container and proxied deployments receive the same protection. Use four independent endpoint buckets: authorization starts, callbacks, exchanges, and the shared `POST /api/auth/token` password endpoint. Password login also uses an additional normalized-username bucket. Password-only and recovery login intentionally share both password checks because they use the same backend endpoint; the limiter must not infer database sign-in mode or authentication intent.

Use centrally defined limits and window constants:

- authorization starts: 20 requests per source IP per 5 minutes
- callbacks: 60 requests per source IP per 5 minutes
- exchanges: 30 requests per source IP per 5 minutes
- password endpoint: 10 attempts per source IP per 5 minutes and 10 attempts per normalized username per 15 minutes

Use token buckets with capacity equal to each stated request count and continuous refill across its stated duration. A rejected request does not consume a token. Calculate `Retry-After` as the ceiling of the monotonic-clock duration until one token is available. For each request, refill, allow/reject, token consumption, last-used update, and `Retry-After` calculation occur atomically under one process-local lock or an equivalent primitive; never hold that lock across an `await` or any I/O.

Treat the password IP and username buckets as one atomic admission decision under that lock. Refill both, then admit only when both contain a token. If either is empty, consume neither, update both LRU positions, and return the maximum ceiling wait until both can admit a request. Otherwise consume one token from each and update both LRU positions before releasing the lock. Endpoint buckets that apply alone retain the single-bucket rule.

The supported single-process deployment may use bounded in-memory TTL/LRU maps with separate capacities of 10,000 source-IP keys and 10,000 username keys. Remove fully refilled inactive entries first and then evict the least-recently-used entry when a map is full; capacity is handled only through eviction, never blanket rejection of unseen keys. A username under active attack remains recently used, while cardinality flooding cannot create an unbounded map or a global fail-closed login outage. A process restart may clear these baseline buckets. Document that a shared limiter with equivalent atomic semantics is required before supporting multiple application instances.

Define `SAMBEE_TRUSTED_PROXY_CIDRS` as an optional environment variable containing a comma-separated list of validated IP addresses or CIDR ranges. Its default is empty. Every repository-maintained Uvicorn launch path, including production and development commands, must pass `--no-proxy-headers` so the limiter observes the socket peer and Sambee remains the sole forwarding-header authority. When the direct peer is not trusted, ignore forwarding headers. When it is trusted, parse `X-Forwarded-For` strictly from right to left, skip addresses covered by the configured trusted ranges, and use the first untrusted address. Fall back to the direct peer when the chain is malformed or contains no untrusted address. Support IPv4 and IPv6 without accepting hostnames or partial addresses.

For the password username bucket, trim surrounding whitespace while preserving case and Unicode code points, matching stored-username normalization without changing the exact password lookup. Hash the complete normalized UTF-8 value with SHA-256 before storage so the map retains a fixed-size key and never stores submitted usernames. Enforce the named 64 KiB password-form body limit before form parsing and return a generic `413` without reading credentials into application models; do not merge long usernames into a shared limiter key.

After the transport-level body guard, resolve password-endpoint availability separately from the limiter. With no database authentication configuration, permit only legacy `password`; with a database configuration, permit only `password_only` and `oidc_with_recovery`. Legacy `none` and `oidc_only` return the existing fixed `404` before form parsing and without reading or changing any limiter bucket. The limiter receives no sign-in-mode or recovery-intent input. The 64 KiB ASGI guard intentionally remains an earlier transport-safety exception and may return generic `413` in any mode.

Authorization and callback are top-level browser navigations and return `303 See Other` exactly to `/login#error=oidc_rate_limited` when throttled. Exchange returns the canonical JSON `429` contract for `oidc_rate_limited`; the shared password endpoint returns a generic JSON `429`. Both API responses include `Retry-After`. Navigation throttling must never reflect a return path, provider parameter, query value, header, or request body. The frontend removes the allowlisted fragment from browser history before rendering its local translated message. Optional reverse-proxy limits are defense in depth and may strengthen, but must not replace or weaken, these defaults.

**Exit check:** deterministic-monotonic-clock and simultaneous-request tests cover exact token capacity, continuous refill boundaries, rejected-request behavior, atomic check-and-consume, and `Retry-After`. Backend tests independently exhaust every endpoint bucket and both password keys without affecting unrelated buckets; prove 10,000-entry capacity, fully-refilled cleanup, LRU eviction, complete long-username hashing, fixed-size stored keys, exact-size and one-byte-over password-form handling, and restart semantics; and verify malformed or spoofed forwarding headers cannot select another key. Trusted-proxy tests cover empty configuration, invalid CIDRs, IPv4, IPv6, multiple trusted hops, and an integration assertion that forwarding headers never rewrite the ASGI socket peer before Sambee evaluates trust. API tests cover Password-only and OIDC recovery limiting; prove normal-sized legacy `none` and `oidc_only` requests always return fixed `404` without parsing the form or changing limiter state; prove the transport guard may return generic `413` first; and verify the canonical exchange response and generic password response without account, mode, or recovery-intent disclosure. Browser tests verify fixed authorization/callback redirects contain only the allowlisted fragment, immediately remove it from history, render the local safe message, and never reflect request data.

### Gate R8: target provider confirmation

**Owner:** backend, documentation, and release reviewer

**Required before:** feature-complete release approval.

Select the supported Authelia version, confirm its issuer/discovery behavior, `RS256` support, client authentication, PKCE, group claim shape, UserInfo behavior, and uniqueness properties of the documented username claim. Record version-dependent syntax for the final example.

**Exit check:** the version-pinned example passes an automated or controlled end-to-end setup rehearsal.

## Dependency Graph

```mermaid
flowchart TD
    P00[PR 00: library and HTTP spike] --> P01[PR 01: dependency and adapter]
    P00 --> P03[PR 03: canonical API contracts and frontend bridge]
    P02[PR 02: schema and audit foundation] --> P04[PR 04: secrets and configuration service]
    P03 --> P04
    P03 --> P05[PR 05: public auth config and direct mode]
    P04 --> P05
    P04 --> P06[PR 06: candidate validation and test-flow start]
    P01 --> P06
    P02 --> P07[PR 07: identity and mapping service]
    P03 --> P07
    P06 --> P08[PR 08: dormant callback and tested-identity preview]
    P01 --> P08
    P07 --> P08
    P07 --> P07A[PR 07A: mapping and user-auth admin APIs]
    P05 --> P07A
    P07 --> P09[PR 09: dormant finalization engine]
    P08 --> P09
    P05 --> P09
    P05 --> P10[PR 10: recovery CLI and key rotation]
    P04 --> P10
    P07 --> P11[PR 11: login resolution and synchronization]
    P08 --> P11
    P11 --> P12[PR 12: dormant grant exchange and login completion]
    P03 --> P13[PR 13: frontend auth foundation]
    P05 --> P13
    P12 --> P13
    P09 --> P14[PR 14: dormant admin setup UI]
    P10 --> P14
    P13 --> P14
    P07A --> P15[PR 15: user-management mapping UI]
    P13 --> P15
    P09 --> P16[PR 16: activation cutover]
    P10 --> P16
    P12 --> P16
    P13 --> P16
    P14 --> P16
    P15 --> P16
    P16 --> P17[PR 17: docs, E2E, and release review]
```

PR numbers describe dependency order, not necessarily merge order. Parallel work is described below.

## Pull Request Plan

### PR 00: OIDC library and HTTP adapter spike

**Goal:** close Gates R1 and R2 before production protocol code depends on a library.

**Primary files:**

- `backend/requirements-dev.txt` if an isolated spike dependency is needed
- new focused tests under `backend/tests/`
- pull-request decision record; do not add a second normative design document

**Work:**

- Compare current Authlib with PyJWT/PyJWKClient against every Gate R1 operation.
- Prototype transport injection, approved-address connection pinning, original-host TLS verification, bounded response streaming, no redirects, and cache integration.
- Confirm `RS256`; record what is required before adding `ES256`.
- Confirm errors can be converted into safe internal categories without retaining response bodies or token dictionaries.
- Finalize the Gate R2 constants.

**Tests:** deterministic fake DNS and HTTP transport tests for hidden network access, redirect rejection, DNS rebinding, forbidden addresses, TLS host behavior, response limits, timeout limits, unknown-key refresh, algorithms, issuer, audience, `azp`, nonce, and time claims.

**Acceptance:** selected library and adapter architecture are approved; no production route or behavior is enabled.

**Non-goals:** migrations, provider persistence, UI, real-user provisioning, and public IdP tests.

### PR 01: dependency and validated OIDC client foundation

**Depends on:** PR 00.

**Goal:** add the selected pinned dependency and the production typed client boundary.

**Primary files:**

- `backend/requirements.txt`
- `backend/requirements.lock.txt`
- `backend/requirements-dev.lock.txt` when required by the workflow
- new `backend/app/services/oidc_http.py`
- new `backend/app/services/oidc_client.py`
- focused tests under `backend/tests/services/`

**Work:**

- Follow the documented dependency-update workflow and use `scripts/refresh-backend-lockfiles`.
- Implement `ValidatedOidcHttpClient` with the approved DNS, destination, TLS, redirect, timeout, size, JSON, concurrency, and cache rules.
- Implement typed operations for metadata validation, authorization URL construction, callback exchange/validation, optional one-shot UserInfo, and normalized claims.
- Keep library response dictionaries and provider tokens inside the service call.
- Add cache invalidation hooks but do not yet register public routes.

**Security invariants:** all OIDC network traffic uses the adapter; algorithms are allowlisted; redirects are disabled; resolved addresses are pinned for connection; secrets and bodies are redacted.

**Acceptance:** focused tests and backend type checking pass; dependency files are reproducibly generated; no active auth behavior changes.

### PR 02: schema, nullable passwords, password guards, and audit foundation

**Goal:** add dormant storage and close the data-model part of Gates R4 and R6.

**Primary files:**

- new `backend/app/models/oidc.py`
- new `backend/app/models/audit.py`
- `backend/app/models/user.py`
- `backend/app/models/__init__.py` if model import registration requires it
- `backend/app/db/migrations.py`
- new migration and model tests under `backend/tests/`

**Work:**

- Add the singleton provider configuration, immutable identity, pending mapping, and flow tables exactly as specified.
- Add audit persistence with allowlisted safe details.
- Rebuild or alter `User` safely so `password_hash` is nullable.
- Add all database checks, unique constraints, indexes, foreign keys, revision defaults, and explicit delete behavior.
- Add a reusable audit writer that participates in a caller-owned transaction.
- Update password login, password change, and administrator password reset in the same pull request so every `password_hash` caller handles `NULL` safely. Password login must fail through the generic invalid-credentials path; change and reset must reject accounts without an existing hash so no endpoint adds a password to an OIDC-provisioned account.
- Do not seed a provider row or infer mappings for existing users.

**Security invariants:** no plaintext client secret, verifier, nonce, tested identity, or candidate configuration column; immutable identity uniqueness is database-enforced; audit data rejects raw subjects and arbitrary dictionaries.

**Tests:** fresh migration, upgrade fixture, idempotent rerun, failed-rebuild rollback, password preservation, null-password login/change/reset behavior, strict mypy coverage of every password-hash caller, singleton race/constraint, mapping constraints, cascade transaction behavior, and audit-write rollback.

**Acceptance:** old databases retain identical password behavior; a database without a provider row behaves exactly as before.

### PR 03: canonical API contracts and frontend compatibility bridge

**Can run with:** PR 02 after PR 00 establishes library-facing shapes.

**Goal:** close Gate R3 and unblock independent frontend work.

**Primary files:**

- new `backend/app/models/oidc_api.py` or API models colocated in `backend/app/models/oidc.py`
- new contract tests under `backend/tests/api/`
- a checked contract fixture under the existing test-fixture convention
- `frontend/src/services/authConfig.ts`
- existing frontend auth-config consumers, mocks, and tests as required by the compatibility bridge

**Work:**

- Define strict enums, bounded strings and arrays, request models, redacted response models, stable error codes, mapping-plan discriminated states, and completion receipts.
- Reuse the existing password login response for successful grant exchange.
- Define omitted-account acknowledgements as row-bound structured values, not a single unscoped boolean.
- Define candidate secret semantics so absence preserves an existing secret and no read model can contain it.
- Snapshot relevant OpenAPI schemas for frontend drift tests.
- Before changing the backend wire response, make the frontend parser prefer a valid canonical `sign_in_mode`, temporarily accept the legacy `auth_method` only when the canonical field is absent, and render authentication unavailable rather than inferring Password-only when neither schema is valid or the request fails.
- Keep existing `none` and password behavior unchanged against the old backend. Do not render OIDC controls in this bridge; PR 13 owns the complete mode-aware login experience and removes the legacy parser after the backend transition is deployed.

**Acceptance:** Gate R3 exit checks pass; frontend reviewers approve field names, nullability, and error handling; the compatibility tests run the new frontend parser against both old and canonical backend responses, malformed responses, and fetch failure.

### PR 04: environment, encryption, and configuration service

**Depends on:** PR 02 and PR 03.

**Goal:** implement external-key handling and transactional configuration logic without OIDC activation.

**Primary files:**

- `backend/app/core/config.py`
- `backend/app/core/environment.py`
- new `backend/app/services/oidc_configuration.py`
- `backend/app/main.py` for startup health initialization only
- focused tests under `backend/tests/core/` and `backend/tests/services/`

**Work:**

- Load and validate `SAMBEE_OIDC_SECRET_KEY` and `SAMBEE_PUBLIC_URL` explicitly.
- Derive the fixed callback URI only from the trusted public URL.
- Add Fernet encryption/redaction helpers for client secrets and encrypted flow payloads.
- Add typed candidate normalization, secret-preserve/replace behavior, group normalization, mapping collision checks, revision calculation, and cache invalidation hooks.
- Produce the typed administrator prerequisites/health model defined in Gate R3 without logging key material. Health reason codes are allowlisted and contain no exception text.
- Populate the five environment/configuration health reasons from Gate R3 in canonical order, preserving simultaneous failures. PR 11 later composes `no_active_administrator` without replacing existing reasons.
- Fail OIDC closed when ciphertext cannot be decrypted; preserve configured recovery behavior and stored ciphertext.

**Security invariants:** no automatic OIDC key generation; no database fallback key; decrypted values have request-local lifetime; exceptions and model representations redact values.

**Acceptance:** missing or bad keys cannot enable OIDC, while provider-free password and `none` deployments continue normally.

### PR 05: public auth config and direct Password-only mode

**Depends on:** PR 03 and PR 04. The frontend compatibility bridge must merge before this backend response changes.

**Goal:** introduce canonical sign-in-mode reads and the guarded direct transition without enabling OIDC login.

**Primary files:**

- `backend/app/api/auth.py`
- new `backend/app/api/admin_auth.py`
- `backend/app/main.py`
- `backend/app/core/security.py`
- focused API tests under `backend/tests/api/`

**Work:**

- Return canonical `sign_in_mode` from `GET /api/auth/config`, preserving legacy behavior when no database row exists.
- Add the administrator redacted configuration read.
- Add `PUT /api/admin/auth/mode`, limited to Password-only with expected configuration revision, expected active/unexpired passwordless count, and required acknowledgement.
- Recompute counts and local-password administrator availability in the write transaction.
- Increment every existing user token version only after a valid transition.
- Add the legacy TOML deprecation warning only after a database configuration exists.

**Security invariants:** the endpoint cannot enable OIDC; it preserves provider configuration and mappings; the UI path has no force option; absent hashes do not produce timing-sensitive or internal errors.

**Acceptance:** all existing auth regression tests pass; stable stale-count, stale-revision, and no-local-administrator errors have no side effects.

### PR 06: provider validation and test-flow start

**Depends on:** PR 01, PR 03, and PR 04.

**Goal:** implement non-destructive **Connect and test** initiation.

**Primary files:**

- `backend/app/services/oidc_configuration.py`
- `backend/app/services/oidc_client.py`
- new `backend/app/services/oidc_flow.py`
- `backend/app/api/admin_auth.py`
- focused service and API tests

**Work:**

- Implement `POST /api/admin/auth/oidc/test-login` without registering it in the production router. Exercise it through an isolated test router or direct handler invocation; PR 16 registers it with the complete interactive flow.
- Validate local fields, metadata, JWKS, endpoint safety, advertised capabilities, and warnings.
- Encrypt and persist the candidate, state verifier material, initiating administrator, active configuration existence/revision, and immutable server-derived intent.
- Return only the safe validation report or a server-generated authorization URL with `Cache-Control: no-store`.
- Add opportunistic expired-flow cleanup.

**Security invariants:** active configuration is untouched; authorization URLs never come from client input; each attempt creates a fresh immutable flow; flow material is encrypted or hashed as specified.

**Acceptance:** abandoned and failed candidates leave active login unchanged; a successful response contains no secret or provider document; the production application returns `404` for test-login.

### PR 07: identity, admission, roles, and mapping service

**Depends on:** PR 02 and PR 03.

**Goal:** build the transaction services used by login, activation, and administrator mapping APIs.

**Primary files:**

- new `backend/app/services/oidc_identity.py`
- new `backend/app/services/oidc_mapping.py` if separation improves clarity
- `backend/app/models/user.py`
- focused tests under `backend/tests/services/`

**Work:**

- Implement immutable `(issuer, subject)` lookup and exact pending-username consumption order.
- Implement admission, Unicode group normalization, cross-role collision rejection, precedence, and fixed viewer fallback.
- Implement provisioning and existing-user profile/role synchronization using current `User` validators.
- Implement last-administrator role-sync protection and token-version changes.
- Implement atomic pending batch create/replace/cancel/consume, mapping move/change/detach, revision increments, affected-user session invalidation, and transactional audit events.
- Implement stateless mapping-plan derivation from current users and mappings.

**Security invariants:** admission precedes mapping consumption; usernames never resolve established identities; identity moves require a known internal identity ID and never a raw subject; every mapping mutation increments the mapping revision once per transaction.

**Acceptance:** concurrency tests prove one provisioning or consumption result; every partial-write and audit failure rolls back.

### PR 07A: administrator mapping and user-authentication APIs

**Depends on:** PR 05 and PR 07.

**Goal:** expose the complete administrator-owned mapping surface and the redacted user authentication state required by frontend user management.

**Primary files:**

- `backend/app/api/admin_auth.py`
- `backend/app/api/admin.py`
- `backend/app/models/user.py`
- canonical API models from PR 03
- focused API and integration tests under `backend/tests/`

**Work:**

- Add the unified individual/batch pending-mapping endpoint, pending cancellation, immutable identity move, mapped-account change, and detach endpoints from the specification.
- Require the specified administrator capability, confirmations, expected state/revisions, stable row-keyed errors, and transactional audit behavior.
- Extend the administrator user read model with `has_local_password`, pending-mapping state, and a nullable nested OIDC object containing the opaque internal `identity_id`, provider display name, and last successful OIDC login. This administrator-only object is the read source for `POST /api/admin/auth/oidc/mappings/{identity_id}/move`; never expose issuer, subject, or a subject hash.
- Keep authentication fields absent from ordinary current-user responses unless required by the specification.
- Map database uniqueness failures and concurrent state changes to stable conflict errors after rolling back the complete operation.

**Security invariants:** no self-service route exists; all operations compose PR 07 services in one caller-owned transaction; changing a mapping cannot expose a detached-without-pending intermediate state; removing or moving the last viable OIDC administrator is rejected.

**Acceptance:** every mapping API has capability, redaction, stale-state, concurrency, audit-failure, rollback, and last-administrator integration coverage; administrator user-list tests cover Local password, OIDC, both, and pending states; a contract test obtains `identity_id` from the administrator user response and successfully invokes the move endpoint without any raw provider identifier.

### PR 08: dormant callback validation and tested-identity preview

**Depends on:** PR 01, PR 06, and PR 07.

**Goal:** finish purpose-`test` callback processing without registering a publicly reachable callback or changing active authorization.

**Primary files:**

- new `backend/app/api/oidc_auth.py`
- `backend/app/api/admin_auth.py`
- `backend/app/services/oidc_flow.py`
- `backend/app/services/oidc_client.py`
- `backend/app/main.py`
- focused callback and preview tests

**Work:**

- Claim exactly one unexpired `started` flow before provider exchange.
- Validate callback, code exchange, token, nonce, required claims, and at most one UserInfo request.
- Clear verifier and nonce ciphertext through an exactly-one-row conditional update before purpose-specific completion.
- Store only the encrypted typed tested-identity snapshot, set 30-minute expiry, and redirect with only the flow UUID fragment.
- Add the setup-only allowlisted missing-groups fragment failure.
- Add the authenticated stateless body-bearing preview and test-flow deletion endpoints.
- Delete terminal callback failures conditionally from `callback_processing` and retain only a separate redacted failure audit event.
- Keep the public callback route unregistered in the production router. Exercise it through an isolated test router or direct handler invocation; PR 16 registers it with the complete backend and frontend flow after Gate R7 is closed.

**Security invariants:** no provisioning, mapping, role mutation, or Sambee JWT for test purpose; no issuer or subject in preview; zero-row transitions make no later provider request or mutation.

**Acceptance:** race, replay, expiry, cancellation, redaction, UserInfo reason, and ciphertext-deletion tests pass; the production application returns `404` for the public OIDC callback.

### PR 09: dormant provider finalization and identity-namespace replacement engine

**Depends on:** PR 05, PR 07, and PR 08.

**Goal:** implement and exhaustively test atomic reviewed activation/replacement without yet making OIDC activation reachable in a deployed application.

**Primary files:**

- `backend/app/api/admin_auth.py`
- `backend/app/services/oidc_configuration.py`
- `backend/app/services/oidc_identity.py`
- `backend/app/services/oidc_flow.py`
- focused integration tests

**Work:**

- Implement the `PUT /api/admin/auth/oidc` handler and transaction service without registering the finalization route in the production router. PR 16 owns route registration and activation availability.
- Recheck flow ownership/status/expiry, configuration existence/revision, mapping revision, every row, omission acknowledgements, uniqueness attestation, administrator state, tested identity admission/role, unique administrator mapping, and resulting usable administrator.
- For initial activation, promote the candidate, map the tested administrator, and create reviewed pending rows in one transaction.
- For replacement intent, replace established and pending mappings from the complete reviewed plan, invalidate affected sessions, and increment both revisions in one transaction.
- Add direct allowed updates in recovery mode with scoped invalidation and fresh-test enforcement for OIDC-only policy changes.
- Clear encrypted payloads and retain only the short-lived completion receipt.
- Make same-administrator retry of a finalized flow return the receipt without another mutation or audit event.

**Security invariants:** no delete-before-replace state; request cannot override flow intent; stale reviews have no effects; failed writes leave the unexpired flow correctable.

**Acceptance:** transaction-failure injection, concurrency, stale-plan, stale-config, lost-response retry, and administrator-lockout tests pass through an isolated test router or direct handler invocation; the production application returns `404` for provider finalization and cannot enter an OIDC mode.

### PR 10: emergency mode and encryption-key rotation CLI

**Depends on:** PR 04 and PR 05. Must close Gate R5 before OIDC-only UI ships.

**Goal:** provide supported server-side recovery and maintenance commands.

**Primary files:**

- `backend/pyproject.toml` when using a console entry point
- new `backend/app/cli.py` and focused command modules as needed
- existing container/build files only when required to install the command
- CLI and container invocation tests

**Work:**

- Implement `sambee auth set-mode password-only` using the same transition service as the API.
- Report usable local-password administrators and active/unexpired passwordless accounts; recheck both after confirmation.
- Refuse lockout by default and allow only an explicitly warned `--force` containment path.
- Implement stopped-application OIDC encryption-key rotation using environment variables only.
- Implement the read-only `sambee auth audit export` command with validated time and event filters and JSON Lines output containing only persisted allowlisted fields.
- Re-encrypt and verify the client secret, delete all ephemeral flows, and commit both changes atomically.
- Print exact deployment next steps without printing keys.

**Security invariants:** no password reset or bypass; no key command-line arguments; no duplicated direct SQL mutation path; no multiple live keys.

**Acceptance:** documented production-container invocation passes tests, including rollback, stale-count, audit-export filtering/redaction, and an assertion that the Docker image actually installs or exposes the selected command entry point.

### PR 11: login identity resolution, provisioning, and synchronization

**Depends on:** PR 07 and PR 08.

**Goal:** complete purpose-`login` callback behavior up to creation of the one-time grant.

**Primary files:**

- `backend/app/api/oidc_auth.py`
- `backend/app/main.py`
- `backend/app/services/oidc_identity.py`
- `backend/app/services/oidc_flow.py`
- integration tests with the deterministic fake provider

**Work:**

- Apply admission, immutable identity lookup, pending mapping consumption, or atomic provisioning in the specified order.
- Reject collisions, inactive users, expired users, missing required claims, malformed groups, and policy failures with stable errors.
- Synchronize valid profile fields and role; apply the last-administrator guard.
- Replace restart-time bootstrap mutation with a first-run-only rule. Create the configured bootstrap administrator only when both the user table is empty and no database authentication configuration exists. Once either exists, startup must never create a missing configured administrator or change any existing user's role, activity, expiry, or password. Add `no_active_administrator` to the ordered authentication-health reasons without dropping PR 04 reasons, and emit actionable redacted logs rather than mutating authorization state.
- Generate a random login grant, store only its hash and revocation snapshot, set the 60-second deadline, transition to `callback_validated`, and redirect with the fragment.
- Add all required audit events without claim or subject leakage.

**Security invariants:** callback URL contains only the one-time grant fragment; no Sambee JWT is issued in callback; concurrent callbacks cannot create duplicate users or identities; application restart cannot create, reactivate, unexpire, or promote a user after initialization.

**Acceptance:** admission, mapping, provisioning, role, profile, concurrency, and failure-path integration tests pass. Restart tests cover first-run creation and preserve an existing user's OIDC-synchronized demotion, disabled state, expiry, and deletion without recreating or promoting the configured bootstrap username. Missing-administrator health contains no credentials or identity claims.

### PR 12: dormant grant exchange and login completion

**Depends on:** PR 01 and PR 11. Closes Gate R7 before activation cutover.

**Goal:** implement and test issuance of the existing Sambee JWT after atomic one-time grant exchange without exposing an incomplete browser flow.

**Primary files:**

- `backend/app/api/oidc_auth.py`
- `backend/app/api/auth.py`
- `backend/app/services/oidc_flow.py`
- `backend/app/core/security.py`
- `backend/app/core/config.py`
- `Dockerfile` and every repository-maintained Uvicorn development launch script
- `config.example.toml` only for a comment directing operators to the environment-owned trusted-proxy setting
- backend requirements and generated lock files only when the application limiter adds a dependency
- focused API and integration tests

**Work:**

- Implement `GET /api/auth/oidc/authorize`, complete `GET /api/auth/oidc/callback`, and implement `POST /api/auth/oidc/exchange` without registering any interactive OIDC route in the production router. Exercise the handlers through an isolated test router; PR 16 owns atomic production registration.
- Sanitize `return_to` to application-owned relative routes.
- Atomically consume a valid grant and recheck user activity, expiry, token version, and configuration revision.
- Issue a 60-minute OIDC-authenticated Sambee JWT through the existing token path.
- Add `Referrer-Policy: no-referrer` and safe cache headers to callback responses.
- Implement the bounded application limiter from Gate R7, including four independent endpoint buckets, both password keys, expiry and capacity behavior, trusted-proxy semantics, and endpoint-specific navigation/API responses.
- Implement atomic token-bucket refill/check/consume and deterministic `Retry-After` behavior using a monotonic clock and a process-local synchronization primitive.
- Load and validate `SAMBEE_TRUSTED_PROXY_CIDRS`, add `--no-proxy-headers` to every repository-maintained Uvicorn command, retain socket-peer visibility at the ASGI boundary, and implement the strict right-to-left forwarding-chain algorithm from Gate R7.
- Enforce the 64 KiB password-form body limit at the ASGI boundary before form parsing; accept the exact limit, reject one byte over with a generic `413`, and do not log or reflect body content.
- Add a separate password-availability dependency after the body guard and before form parsing. It uses the effective-mode service from PR 05, returns fixed `404` for legacy `none` and `oidc_only`, and does not inspect or mutate limiter state.
- Replace the password handler's direct `OAuth2PasswordRequestForm` dependency with one cached dependency that runs only after availability succeeds, parses the form exactly once, performs the atomic two-bucket password admission decision after parsing but before credential lookup, and returns the unchanged form. The exact untrimmed submitted username continues to control database lookup.
- Document optional reverse-proxy limits as defense in depth without making a proxy mandatory or trusting its forwarding headers by default.

**Acceptance:** grant replay/expiry, stale configuration, return-path, password lifetime, WebSocket, companion-dependent session regression, Password-only rate-limit regression, and Gate R7 backend/browser tests pass. A contract test proves the availability gate precedes form parsing and limiter access; normal-sized disabled-mode requests leave both buckets unchanged; the password form is parsed once in enabled modes; both password buckets are checked before credential lookup; lookup receives the unchanged username; rejection by either bucket consumes neither token; and exhaustion of both returns the maximum wait. Fixed safe navigation redirects and canonical API `429` responses follow the normative transport contract, buckets remain independent, bounded, and atomic, trusted-proxy behavior is configuration-driven and spoof resistant, every maintained Uvicorn command disables framework proxy-header rewriting, and the production application returns `404` for test-login, authorization, callback, and exchange.

### PR 13: frontend authentication foundation

**Depends on:** PR 03 contract, PR 05 public config, and PR 12 public OIDC endpoints.

**Goal:** adopt canonical auth configuration and add login/callback routing without the administrator wizard.

**Primary files:**

- `frontend/src/services/authConfig.ts`
- new `frontend/src/services/oidcAuthApi.ts`
- `frontend/src/services/api.ts` when shared token completion belongs there
- `frontend/src/pages/Login.tsx`
- new `frontend/src/pages/OidcCallback.tsx`
- `frontend/src/App.tsx`
- `frontend/src/i18n/resources.ts`
- existing auth tests and new focused tests

**Work:**

- Replace `auth_method` with canonical `sign_in_mode` and derive method availability.
- Replace fetch-failure fallback-to-password with an authentication-unavailable retry state. Never infer that local login is enabled after a failed config read.
- Implement `/login/local` and `/login/oidc/callback` with correct mode gates, but keep both routes unavailable in the production router until PR 16. Exercise them through focused router tests and fixtures backed by PR 12's isolated test router.
- Parse and remove the callback fragment before exchange; load no third-party resources on the callback page.
- Centralize successful-token storage, tracing initialization, current-user load, and safe return navigation for password and OIDC.
- Implement one automatic OIDC-only reauthentication attempt and loop suppression in `sessionStorage`.
- Map only stable server errors and safe allowlisted fragment errors to translated messages.
- Treat `oidc_rate_limited` as an allowlisted navigation fragment error, remove it from history before rendering, and never render reflected URL or provider content.
- Remove the temporary legacy `auth_method` parser only after the canonical backend response from PR 05 is the supported deployment baseline.

**Acceptance:** all four effective states (`none`, Password-only, recovery, OIDC-only), outage behavior, callback replay prevention, rate-limited navigation fragment removal, logout suppression, deep return routes, and accessibility tests pass; the production application has no reachable OIDC callback or local-recovery frontend route.

### PR 14: dormant administrator authentication setup and replacement UI

**Depends on:** PR 09, PR 10, and PR 13.

**Goal:** build and test the six-step administrator workflow and direct Password-only action without exposing an activation control before the backend cutover gate is complete.

**Primary files:**

- new `frontend/src/pages/AuthenticationSettings.tsx`
- new focused components under `frontend/src/components/Settings/Authentication/`
- new `frontend/src/services/oidcAdminApi.ts`
- `frontend/src/components/Settings/settingsNavigation.ts`
- `frontend/src/App.tsx`
- `frontend/src/i18n/resources.ts`
- focused page, component, and integration tests

**Work:**

- Implement Prerequisites, Provider, Connect and test, Access policy and roles, Review existing accounts, and Activate.
- Keep provider fields separate from post-test policy choices; hide standard scopes/claims under Advanced.
- Schema-check the server authorization URL and navigate unchanged with top-level `window.location.assign`.
- Keep the flow UUID only in setup-tab `sessionStorage`; remove safe error fragments immediately.
- Use body-bearing preview for every policy/mapping-plan reevaluation and never cache it.
- Implement shared initial/replacement mapping review, inline row errors, omission acknowledgements, stale-plan replacement, uniqueness attestation, and inactive-account presentation.
- Retry an ambiguous finalization with the same flow ID before permitting a new test.
- Add explicit cancel through the deletion endpoint.
- Add direct Password-only confirmation with displayed count, stale refresh, local-administrator block, and no force control.
- Clear auth-config cache after committed settings changes.
- Keep the production settings navigation entry and finalization submission disabled or unregistered. PR 16 exposes them only after all cutover dependencies and Gates R5-R7 are complete.

**Acceptance:** frontend tests cover every wizard state, secret semantics, URL validation, fresh-test boundaries, stale reviews, timeout retry, focus/error behavior, and capability gating; the production application exposes no route or control that can activate OIDC.

### PR 15: user-management authentication and mapping UI

**Depends on:** PR 07A APIs and PR 13 frontend contracts. May merge after PR 14 if shared components are first introduced there.

**Goal:** expose administrator-owned mapping operations and authentication status in existing user management.

**Primary files:**

- `frontend/src/pages/UserManagementSettings.tsx`
- shared mapping components under `frontend/src/components/Settings/Authentication/`
- `frontend/src/services/oidcAdminApi.ts`
- `frontend/src/i18n/resources.ts`
- focused user-management tests

**Work:**

- Show Local password, OIDC, or both, provider display name, last OIDC login, and pending state without subject data.
- Add individual and batch pending mappings through one request contract.
- Add normal **Change OIDC account** and Advanced move/detach actions with required warnings.
- Hide password actions for accounts without a hash and in OIDC-only mode.
- Explain mapping-versus-admission and detach-versus-revoke behavior.
- Refresh affected user, mapping revision, and auth configuration after mutations.

**Acceptance:** no self-service control exists; raw identity IDs are used only internally where required and raw subjects are never displayed or accepted; all confirmation and rollback states are tested.

### PR 16: activation cutover

**Depends on:** PR 09, PR 10, PR 12, PR 13, PR 14, PR 15, and completed Gate R6 evidence.

**Goal:** make OIDC activation reachable only after login, recovery, rate limiting, mapping administration, and migration safety are complete.

**Primary files:**

- `backend/app/main.py` and OIDC router registration
- `frontend/src/App.tsx`
- `frontend/src/components/Settings/settingsNavigation.ts`
- final cross-layer auth and deployment tests

**Work:**

- Verify and link closure evidence for Gates R1-R7, including the audit export, production-container CLI, application rate limits, and current-database migration rehearsal.
- Atomically register the administrator test-login handler; public authorization, callback, and exchange handlers; and frontend local-recovery and OIDC-callback routes implemented in PRs 06, 08, 12, and 13.
- Register the sole provider-finalization route implemented in PR 09.
- Register and expose the administrator Authentication settings route/navigation implemented in PR 14.
- Confirm the public authorize/callback/exchange routes, mode-aware frontend login, mapping administration, and recovery command are present in the same deployable artifact.
- Run a pre-cutover smoke matrix that activates recovery mode and OIDC-only mode, signs out the acting administrator, signs back in through OIDC, and restores Password-only through the documented CLI.
- Confirm failed or incomplete readiness checks leave finalization unavailable rather than relying on an undocumented feature flag.

**Security invariants:** no build artifact can persist an OIDC mode unless every required login and recovery surface is included; finalization remains guarded by the tested identity, revisions, mapping plan, and usable-administrator checks from PR 09.

**Acceptance:** one production-like artifact completes the cutover smoke matrix; `none` and Password-only regression suites remain unchanged; route and navigation availability tests prove activation is impossible in every earlier milestone.

### PR 17: documentation, E2E, operations, and release review

**Depends on:** PR 16. Gate R8 closes here.

**Goal:** complete operator guidance, cross-layer validation, and security release approval.

**Primary files:**

- earliest applicable pages under `website/content/docs/`
- version-pinned Authelia example and configuration assets
- frontend E2E tests under `frontend/e2e/`
- backend deterministic provider fixtures under `backend/tests/`
- deployment examples such as `config.example.toml` and `docker-compose.example.yml` only where required by the approved docs

**Work:**

- Use the docs editor and inheritance workflow for every website-doc change.
- Document setup, callback URL, claims, admission, roles, mappings, replacement, recovery, secret rotation, key rotation, stable errors, privacy, upgrade behavior, and logout limitations.
- Add the complete supported Authelia example and validate it against the selected version.
- Run the full specification E2E matrix, migration rehearsal, dependency checks, frontend checks, backend tests/type check, repository script, and a focused security review.
- Verify optional reverse-proxy defense-in-depth examples for authorization, callback, exchange, and password login without making them prerequisites for backend enforcement.
- Document the application's default authentication limits, bounded single-process behavior, forwarding-header trust boundary, multi-instance shared-limiter requirement, and optional stricter proxy limits.

**Acceptance:** all specification acceptance criteria pass; no unresolved high-severity protocol, SSRF, replay, mapping, privilege, lockout, or secret-handling finding remains.

## Parallelization Guidance

After PR 00 resolves the library boundary, the following lanes may proceed concurrently:

| Lane | Work | Constraints |
| --- | --- | --- |
| A | PR 01 validated client | Must close R1/R2; blocks all provider network behavior. |
| B | PR 02 schema/audit | Can proceed independently; coordinate model names with PR 03. |
| C | PR 03 API contracts | Requires backend and frontend joint review before either side branches widely. |
| D | Gate R5 CLI packaging design | May prototype invocation only; production mutations wait for PR 04/05 services. |
| E | Gate R8 Authelia research | May confirm version and claim behavior early; final docs wait for implemented behavior. |

After PR 03 merges, frontend PR 13 may start against mocked canonical schemas while backend PRs 04-09 proceed. The administrator wizard can be component-tested against mock handlers after the preview/finalization contract is frozen, but it must not merge with fabricated fields or error semantics.

PR 07 identity services and PR 08 callback/test completion may be developed in parallel only after agreeing on the normalized tested-identity type and transaction ownership. PR 09 owns the finalization transaction and must not duplicate validators from PR 07; it composes them within one caller-owned session.

Public OIDC routes may merge dormant after PR 01 proves all network calls are controlled, but no OIDC mode may be persisted before PR 16. PR 16 must verify the recovery CLI in the production container, close Gate R6, and include the complete frontend login path. Release documentation must not claim support before the Authelia rehearsal and full security review pass.

## Cross-cutting Contracts

### Transaction ownership

Service functions that participate in activation, replacement, provisioning, mapping, role synchronization, or direct mode changes accept a caller-owned database session and do not commit internally. The outer operation owns commit/rollback and includes its audit write. Read-only validation may use independent sessions where it cannot create a time-of-check/time-of-use assumption.

### Revision ownership

- Configuration service increments `configuration_revision` for the exact changes listed in the specification.
- Mapping service increments `identity_mapping_revision` exactly once per committed transaction containing one or more mapping mutations.
- `token_version` changes happen in the same transaction as authorization-relevant state.
- Flow service snapshots and verifies revisions but never invents replacement intent at finalization time.

### Flow transitions

Every flow mutation uses a conditional update containing ID, expected status, purpose when relevant, ownership when relevant, and unexpired deadline. The caller verifies exactly one affected row before any later provider request or purpose-specific mutation. Keep this primitive centralized in `oidc_flow.py` and test it with independent database sessions.

### Error handling

Domain services raise typed internal errors containing a stable code and safe context only. API layers select the approved HTTP status and public message. Provider/library exceptions are wrapped at the client boundary; raw exception strings never cross into API responses or audit details. Logs include a correlation ID and safe reason category.

### Frontend contract discipline

Frontend code derives available methods solely from `sign_in_mode`. API parsing rejects unknown modes, malformed mapping rows, unsafe authorization URLs, and malformed completion receipts. A failed public auth-config request renders authentication unavailable with retry; it never enables a login method by assumption.

### Dormant rollout

Schema, services, and routes may ship before UI only when no provider row exists by default and no OIDC mode can become active without the complete tested finalization guard. Feature incompleteness must fail closed and must not reinterpret legacy TOML values.

## Validation Strategy

### Per-pull-request minimum

- Run the narrow unit/integration tests for the touched behavior immediately after the first substantive edit.
- Run backend mypy for backend model/service/API changes.
- Run frontend type check and lint for frontend changes.
- Run migration tests for every schema change.
- Run contract drift tests for every API-model change.
- Run `git diff --check` before review.

### Milestone suites

| Milestone | Required validation |
| --- | --- |
| After PR 02 | Fresh/upgrade/idempotency migration suite and complete password/`none` regressions. |
| After PR 06 | Validated HTTP negative suite and candidate-flow persistence/redaction tests. |
| After PR 09 | Activation, replacement, stale review, audit rollback, revision, and idempotent retry integration suites. |
| After PR 12 | Full backend auth suite using deterministic fake provider, including WebSocket and companion-dependent session behavior. |
| After PR 15 | Full frontend unit/integration suite and all auth/settings accessibility checks. |
| Before PR 16 | Gates R1-R7, current-database migration rehearsal, production-container CLI and audit export, bounded application rate limiting, safe navigation/API throttle responses, and dormant-route assertions. |
| Before release | Backend tests and mypy, frontend tests/type/lint, E2E matrix, migration rehearsal, repository-wide `scripts/test`, docs validation, Authelia rehearsal, and security review. |

Tests must not call a public IdP. The final supported-provider rehearsal may use a controlled local/containerized Authelia instance.

## Documentation Impact By Issue

| Issue | Documentation impact |
| --- | --- |
| PR 00-01 | Developer note for selected dependency and transport boundary; no end-user claims. |
| PR 02 | Upgrade note draft for nullable passwords and new tables; publish only with feature release. |
| PR 04 | Deployment variables, key generation, backup, trust-store, and health behavior. |
| PR 05 | Database-owned mode precedence and Password-only transition semantics. |
| PR 06-09 | Setup, test, mapping-plan, activation, replacement, errors, and audit behavior. |
| PR 10 | Emergency mode, audit export, and stopped-application encryption-key rotation runbooks. |
| PR 11-12 | Login, recovery, session lifetime, provisioning, admission, role synchronization, and logout. |
| PR 14-15 | Field-level UI reference and administrator mapping workflows. |
| PR 16 | Activation cutover notes and verified recovery/migration evidence. |
| PR 17 | Consolidation, Authelia example, troubleshooting, security/privacy, and release notes. |

Website documentation is intentionally delivered near feature completion so it describes verified behavior, but each implementation PR must note its documentation impact and PR 17 may not omit it.

## Requirement Traceability

The matrix maps normative specification sections to the implementation issue that owns behavior and the issue that proves integration. A section may have additional unit coverage in prerequisite issues.

| Specification requirement | Primary implementation | Integration/release proof |
| --- | --- | --- |
| Goals, non-goals, legacy JWT consequence | PR 03, PR 05, PR 12 | PR 16 |
| Administrator six-step setup UX | PR 14, PR 16 | PR 17 |
| Login modes and `/login/local` | PR 05, PR 13, PR 16 | PR 17 |
| User-management authentication state | PR 07A, PR 15 | PR 17 |
| Authorization start, state, nonce, PKCE | PR 01, PR 06, PR 12 | PR 16, PR 17 |
| Callback claim and token validation | PR 01, PR 08, PR 11 | PR 17 |
| One-shot UserInfo and diagnostic reasons | PR 01, PR 08 | PR 17 |
| Exactly-one-row flow transitions | PR 06, PR 08, PR 12 | PR 17 |
| Login grant and 60-second exchange | PR 11, PR 12, PR 13 | PR 16, PR 17 |
| Test snapshot, preview, cancel, and expiry | PR 06, PR 08, PR 14 | PR 17 |
| Idempotent finalization receipt | PR 09, PR 14 | PR 16, PR 17 |
| Immutable identity resolution | PR 02, PR 07, PR 11 | PR 17 |
| Pending username mapping | PR 07, PR 07A, PR 09, PR 15 | PR 17 |
| Initial and replacement mapping plans | PR 07, PR 09, PR 14 | PR 16, PR 17 |
| Admission and auto-provisioning | PR 07, PR 11 | PR 17 |
| Profile and role synchronization | PR 07, PR 11 | PR 17 |
| Last-administrator role guard | PR 07, PR 11 | PR 17 |
| Group normalization and precedence | PR 07 | PR 14, PR 17 |
| Provider singleton and revision model | PR 02, PR 04 | PR 09, PR 16, PR 17 |
| External encryption key and rotation | PR 04, PR 10 | PR 16, PR 17 |
| Nullable user passwords | PR 02 | PR 13, PR 17 |
| Bootstrap/configuration precedence and first-run administrator creation | PR 04, PR 05, PR 11 | PR 16, PR 17 |
| Session invalidation scope | PR 05, PR 07, PR 09 | PR 16, PR 17 |
| Public authentication API | PR 03, PR 05, PR 12 | PR 13, PR 16, PR 17 |
| Administrator API | PR 03, PR 05-09, PR 07A | PR 14-17 |
| Stable error registry | PR 03, PR 05, PR 08-12 | PR 13-17 |
| Validated outbound HTTP and SSRF controls | PR 00, PR 01 | PR 17 security review |
| Enforceable authentication rate limits | Gate R7, PR 12 | PR 16, PR 17 |
| OIDC dependency/library requirement | PR 00, PR 01 | PR 17 dependency validation |
| Protocol security requirements | PR 01, PR 06, PR 08, PR 12 | PR 17 security review |
| Application/browser security requirements | PR 02-16 | PR 17 security review |
| Durable logging and audit events | PR 02, PR 05-12 | PR 10 export, PR 17 audit review |
| Frontend types, routes, and accessibility | PR 03, PR 13-16 | PR 17 |
| Database migration and dormant rollout | PR 02, PR 04-05 | Gate R6, PR 16-17 |
| Rollback and emergency recovery | PR 05, PR 10 | PR 16-17 operations rehearsal |
| Administrator documentation | PR 17 | PR 17 docs validation |
| Version-pinned Authelia example | Gate R8, PR 17 | PR 17 provider rehearsal |
| All 20 resolved decisions | PR 00-17 and PR 07A according to rows above | PR 17 specification checklist |

## Release Checklist

- [ ] Gates R1-R8 are closed with linked evidence.
- [ ] All canonical API schemas and stable errors match frontend parsing and tests.
- [ ] No active behavior changes when no provider configuration exists.
- [ ] Password, `none`, recovery, and OIDC-only suites pass.
- [ ] Migration rehearsal and backup/restore pass on a current database copy.
- [ ] Secrets and protocol material are absent from API, URL, log, audit, and database plaintext checks.
- [ ] Flow replay, race, expiry, and exactly-one-row transition tests pass.
- [ ] Activation and replacement rollback, stale-review, and idempotent-retry tests pass.
- [ ] Last-administrator and Password-only recovery paths are tested in UI and CLI.
- [ ] Restart tests prove initialized databases never recreate, reactivate, unexpire, or promote the configured bootstrap user.
- [ ] The documented CLI runs in the production container.
- [ ] The backend enforces independent bounded authentication buckets, honors forwarding headers only from configured trusted proxies, and returns fixed allowlisted navigation redirects or canonical API `429` responses with `Retry-After` as appropriate.
- [ ] The version-pinned Authelia setup works from the published instructions.
- [ ] Backend tests and mypy pass.
- [ ] Frontend tests, type check, and lint pass.
- [ ] End-to-end and repository-wide checks pass.
- [ ] Documentation validation and derived-artifact refresh pass.
- [ ] Focused security review has no unresolved high-severity finding.

## Definition Of Done

The implementation is complete only when an administrator can configure the supported Authelia version from the documentation, test and safely activate either OIDC mode, migrate or replace account mappings atomically, recover through the documented password-only command when credentials permit, and sign in through a protocol flow that passes the complete negative security test matrix. The activation cutover must be the first point at which an OIDC mode can be persisted, and it must include the complete backend login, frontend login, recovery CLI, mapping administration, rate limiting, and migration evidence in one deployable artifact. Existing password and `none` deployments must remain behaviorally compatible, and no implementation step may weaken the specification's identity, replay, SSRF, privilege, lockout, audit, or secret-handling invariants.
