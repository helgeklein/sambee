# Companion Pairing And Session Remediation Plan

## Purpose

This document turns the companion/browser review into an implementation-focused architectural plan.

For the task-level delivery plan derived from this architecture, see `documentation_planning/COMPANION_PAIRING_AND_SESSION_IMPLEMENTATION_PLAN.md`.

It covers two related surfaces:

- browser-to-companion pairing and local-drive communication over the localhost API
- companion-to-backend JWT and session handling for native edit workflows

The goal is to define structural remediations, target architecture, and phased implementation work that reduces security risk without creating another round of protocol debt.

## Current Implementation Snapshot

The plan below describes the full target architecture. A first Phase 1 slice is now implemented and should be treated as the current baseline for future work.

That implemented slice includes:

- origin-scoped browser pairing status instead of browser-visible global pairing state
- exact-origin pairing approval in production, inferred from the requesting browser and shown in the native companion approval window
- loopback development support for typical local browser origins such as `localhost`, `127.0.0.1`, and `::1`
- browser-side cancellation of pending pairings when the browser dialog closes
- companion-side cancellation of pending pairings when the native pairing window closes, including after local approval but before browser confirmation
- removal of browser-facing paired-origin enumeration from the browser contract
- current-origin-only authenticated unpairing instead of arbitrary browser-driven pairing deletion
- removal of companion session leakage from backend lock-status responses and cleanup logs

The remaining sections describe the durable architectural direction that should build on that baseline rather than re-open it.

## Scope

This plan focuses on:

- trust boundaries
- token and session design
- lock ownership design
- localhost API exposure
- lifecycle resilience for long-running edit sessions
- rollout and migration strategy

This plan does not try to redesign the full UX or rewrite unrelated viewer and file-browser behavior.

## Design Principles

### Explicit trust boundaries

- Treat the browser, localhost companion API, desktop app, and backend as separate trust domains.
- Do not rely on implied trust from network location alone.
- Make every privileged transition explicit and auditable.

### Capability-oriented design

- Tokens should authorize a specific class of action, not represent general ambient authority.
- Locks should be identified by opaque lock capabilities or lock IDs, not by replayable bearer secrets stored in application state.

### Least privilege

- Pairing should authorize local-drive access for one browser origin only.
- Companion session tokens should be scoped to the file operation or connection they were created for.
- Public localhost endpoints should expose the minimum data needed for UX.

### Recovery without silent downgrade

- Long-running sessions should fail predictably and recover intentionally.
- When auth or pairing becomes invalid, the system should surface a clear recovery state rather than continue in a misleading half-connected state.

## Current Architecture Summary

### Local pairing path

Current flow:

1. The browser calls the companion localhost API on `127.0.0.1:21549`.
2. Pairing is initiated through public localhost endpoints.
3. The companion shows a native approval window.
4. The browser stores a shared secret in browser local storage.
5. Subsequent localhost requests use HMAC over timestamp plus the browser `Origin`.

Key structural problems:

- localhost API pairing-management endpoints are broadly exposed
- CORS is effectively permissive
- pairing state is partly origin-specific and partly global, which leads to incorrect browser status classification
- pairing cancellation is not modeled as a first-class state transition
- browser secret storage is bearer-equivalent to XSS on the Sambee origin

### Backend-native-edit path

Current flow:

1. The browser asks the backend for a short-lived URI token.
2. The companion exchanges that token for a longer-lived session JWT.
3. The companion uses the resulting bearer token for file metadata lookup, lock acquisition, download, heartbeat, upload, and release.
4. The backend stores the provided `companion_session` on the lock row.

Key structural problems:

- lock rows store a live bearer credential
- lock status exposes that credential back to clients
- companion session claims are carried in tokens but not enforced at the endpoint boundary
- URI token replay prevention is process-local rather than durable
- long-running edit sessions can outlive token expiry without a refresh model
- companion token issuance is not clearly separated from normal user access-token semantics

## Target End State

## Architectural Overview

The target design should separate three capabilities that are currently blurred together:

1. pairing authority for browser-to-companion local access
2. companion operation authority for backend edit workflows
3. lock ownership authority for maintaining or releasing an active edit session

These should be modeled independently.

### Target local pairing model

- The localhost API exposes only a minimal public bootstrap surface.
- Production trust is established by exact-origin approval during pairing, not by hostname heuristics or preconfigured frontend allowlists.
- Development access remains available for typical loopback browser origins so local frontend work does not require manual per-port configuration.
- Routine local-drive access continues to use a long-lived browser identity secret that is bound to one Sambee origin.
- That browser-held secret should be treated as durable identity proof, not as approval for every sensitive management action.
- Origin-specific pairing state is the only state the browser uses to determine readiness.
- Pairing cancellation is explicit and immediate.
- Browser-visible status and companion-internal trust state cannot drift independently.

### Practical interpretation of the target pairing boundary

In the current direction, the public bootstrap surface is intentionally narrow but not pre-approved by configured site list alone.

The trust decision happens in this order:

1. A valid browser origin may ask to start pairing.
2. The companion normalizes that exact origin and shows it in a native approval window.
3. The user approves or rejects that exact origin locally.
4. Once approved, that exact origin becomes the bound browser origin for future HMAC-authenticated local-drive access.

This keeps production UX simple because the user does not need to pre-register Sambee frontend URLs in the companion, while still making trust explicit and origin-specific.

### Target backend session model

- URI tokens become single-use bootstrap capabilities with durable replay protection.
- Companion session tokens become a dedicated token class with explicit validation rules.
- Companion session tokens are scoped to a connection and, when practical, an operation or file.
- Lock ownership is represented by lock identity, not by storing or returning the session bearer token.
- Long-running edit sessions use renewable operation-scoped credentials, with a bounded recovery path if renewal fails.

## Remediation Workstreams

## Workstream 1: Harden The Localhost Trust Boundary

### Objectives

- prevent arbitrary websites from managing pairing state or spamming pairing prompts
- shrink the unauthenticated localhost surface
- align browser status with origin-specific trust only

### Required structural changes

- Replace permissive localhost CORS with exact-origin validation for browser origins, while preserving loopback development access for typical local frontend origins.
- Treat pairing-management routes as a separate authorization class from passive health checks.
- Keep the current origin-bound browser identity model, but harden how the browser stores and uses that secret.
- Split the localhost API into:
  - public bootstrap endpoints
  - pairing-approval endpoints
  - authenticated local-drive endpoints
- Keep paired-origin enumeration inside companion preferences rather than exposing it to the browser.
- Limit browser-managed pairing actions to the current origin rather than allowing arbitrary pairing inventory or arbitrary-origin deletion.

### Endpoint direction

Public bootstrap endpoints should be limited to low-risk availability and initiation surfaces, for example:

- companion availability probe
- pairing start request
- origin-specific status request

High-risk routes should not remain openly scriptable by any origin, including:

- any browser-facing paired-origin inventory endpoint
- delete an arbitrary pairing
- repeated pairing-window creation without rate or origin controls

The production browser-trust boundary should no longer be described as an origin allowlist in the configuration sense. The real trust boundary is exact-origin normalization plus explicit native approval of that origin during pairing.

Routine local-drive browse and read actions can continue to use the browser's origin-bound long-lived identity secret. The main boundary change is that sensitive management and trust-shaping actions should not rely on that secret alone.

### State-model changes

- Replace the global `paired` health signal with an origin-scoped readiness signal for browser use.
- Keep any global paired-origins state internal to the companion preferences surface only.
- Add explicit pairing states such as:
  - unavailable
  - unpaired
  - pending_local_approval
  - paired
  - recoverable_secret_missing
  - rejected_or_cancelled

In the implemented browser UX, the most important distinct recovery states are:

- `pending_local_approval`: pairing has started and the companion is waiting on local approval or rejection
- `recoverable_secret_missing`: the companion still recognizes the origin, but this browser no longer has the local secret it needs to authenticate

### UX-adjacent protocol change

- Closing either side of the pairing UI should call a real cancellation path.
- Pending pairings should not survive merely because a dialog was dismissed.
- Local approval alone should not strand a pairing request if the native window is closed before browser confirmation completes.

## Workstream 2: Redesign Companion Token Classes

### Objectives

- make companion tokens structurally distinct from ordinary browser access tokens
- ensure token claims are enforced, not just embedded
- make replay and revocation behavior explicit

### Required structural changes

- Introduce a dedicated token issuance and validation path for companion tokens instead of routing them entirely through the general access-token dependency.
- Define separate token classes:
  - URI bootstrap token
  - companion session token

### Companion session token requirements

- Include a token class discriminator that is mandatory during validation.
- Include the same revocation/version semantics used for normal user access so companion sessions respect password reset and admin revocation.
- Include explicit scope claims such as:
  - allowed connection ID
  - optional allowed file path or operation ID
  - token purpose
- Validate those claims at the endpoint boundary.

### Validation direction

Companion endpoints should not only ask "who is the user?" They should also ask:

- is this a companion token?
- is this token still revocation-valid?
- is this token allowed to act on this connection?
- is this token allowed to act on this file or operation?

### Replay protection direction

- Move URI token single-use tracking out of process memory.
- Store token JTIs in a durable backing store with expiry.
- Design the store to work correctly across restarts and multi-worker deployments.

Possible implementations:

- database table keyed by JTI with expiry timestamp
- Redis set with TTL

For this project, a database-backed JTI registry is likely the simplest consistent choice.

## Workstream 3: Remove Bearer Tokens From Lock State

### Objectives

- stop storing live bearer credentials in persistent lock rows
- prevent lock-status and logs from becoming credential disclosure surfaces
- decouple lock ownership from session-token leakage

### Required structural changes

- Remove `companion_session` from the lock persistence and API response model.
- Do not log raw companion session tokens.
- Replace bearer-token-in-lock ownership with one of these patterns:
  - lock ID plus authenticated user ownership
  - lock ID plus opaque lock capability secret returned only at acquisition time

### Recommended direction

Prefer:

- companion session JWT authenticates the companion user and operation scope
- lock acquisition returns a lock ID and an optional lock-secret capability
- heartbeat and release require that lock ID, and optionally the lock capability
- backend verifies:
  - caller is authenticated as the expected companion principal
  - requested lock exists and belongs to the authenticated principal
  - optional lock capability matches

This prevents lock-state disclosure from becoming token disclosure.

### API model changes

- `LockRequest` should stop carrying `companion_session` in the JSON body.
- `LockStatusResponse` should stop returning any session-equivalent identifier.
- orphan cleanup logs should log lock metadata and ownership context, never credentials.

## Workstream 4: Add A Renewal Model For Long-Running Edit Sessions

### Objectives

- prevent multi-hour edit sessions from silently degrading after token expiry
- preserve lock continuity without requiring restart of the whole edit flow

### Required structural changes

- Adopt a renewable operation-session model.
- Keep the initial URI bootstrap narrow.
- Mint operation-scoped companion session authority once the edit operation begins.
- Allow renewal only for the active operation while lock ownership remains intact.
- Avoid introducing a broad companion refresh token that outlives the active edit operation.

### Failure behavior

- Heartbeat failures due to expired auth should transition the operation into a visible re-auth or renewal-needed state.
- The system should not remain in an indefinite retry loop with no user-visible state change.

## Workstream 5: Normalize Status, Errors, And Recovery States

### Objectives

- eliminate misleading status transitions
- make recovery steps deterministic

### Required structural changes

- Unify browser-facing companion status around a typed protocol rather than inference from mixed signals.
- Separate these conditions cleanly:
  - companion unavailable
  - origin not paired
  - origin paired but local secret missing
  - paired but auth invalid
  - paired and ready
  - edit session renewal required
- Stop using one browser's pairing state as a readiness signal for another browser.

### Polling and refresh direction

- Split fast-changing local status from slow-changing backend metadata.
- Poll local companion status with backoff or event triggers.
- Cache companion installer metadata independently with a long TTL.

## Workstream 6: Observability, Testing, And Migration Safety

### Objectives

- make the security changes operable
- prevent protocol drift during rollout

### Required structural changes

- Add structured audit logs for:
  - pairing initiation
  - pairing approval
  - pairing cancellation
  - token exchange
  - token renewal
  - lock acquisition
  - lock release
  - lock orphan cleanup
- Add integration tests for:
  - exact-origin normalization and pairing approval on localhost API
  - loopback development-origin allowance on localhost API
  - URI token replay rejection across process restart assumptions
  - companion session claim enforcement
  - long-running edit renewal behavior
  - no token leakage in lock status responses

### Migration strategy

- Treat backend, companion, and frontend as a coordinated pre-production release train.
- Breaking protocol, API, and schema changes are acceptable if all three surfaces are updated in the same planned cutover.
- Prefer one-way migrations and immediate contract replacement over long-lived compatibility shims.
- Reject mixed-version assumptions explicitly: the rollout plan does not need to support old companion or frontend clients against the new backend beyond the controlled deployment window.
- Sequence breaking changes so ownership and renewal replacements land before, or in the same cutover as, removal of the old lock-token contract.
- Migrate any persisted pairing or lock state needed for the new model as part of the coordinated release rather than preserving dual formats indefinitely.

## Proposed Implementation Phases

## Phase 1: Immediate Risk Reduction

Priority goals:

- remove bearer-token leakage from lock responses and logs immediately, and only remove the persisted lock-token contract when the replacement ownership model is ready in the coordinated release
- lock down localhost CORS and public pairing-management routes without introducing a preconfigured production frontend allowlist requirement
- correct browser status detection to use origin-specific pairing only
- add explicit pairing cancellation

Expected outcome:

- the most serious credential exposure and localhost abuse paths are closed early, without requiring long-lived backward-compatibility support

## Phase 2: Coordinated Auth, Lock, And Renewal Redesign

Priority goals:

- create dedicated companion token validation
- add explicit token class and revocation semantics
- enforce connection and operation scope claims
- move URI token replay protection to durable storage
- move lock ownership to lock IDs or lock capabilities
- introduce an explicit edit-session renewal model
- update heartbeat and release flows accordingly
- remove the old persisted lock-token contract as part of the same coordinated cutover

Expected outcome:

- companion sessions stop behaving like generic user bearer tokens, and long-running edit workflows become structurally robust instead of best-effort

## Phase 3: Protocol Cleanup And UX Refinement

Priority goals:

- remove temporary migration guards and rollout-only code paths
- simplify status models and polling behavior
- align companion preferences and browser settings UX with the new protocol boundaries

Expected outcome:

- a cleaner steady-state architecture with less incidental complexity

## Suggested Data Model Changes

### Companion localhost pairing domain

- `paired_origins` remains internal companion state
- `pending_pairings` gains explicit cancellation semantics
- browser status endpoint returns origin-scoped typed status rather than derived booleans

### Backend companion session domain

Add explicit persisted concepts as needed:

- URI token replay registry
- operation session or companion session record if renewal is introduced
- lock capability or lock secret if chosen

### Edit lock domain

Keep:

- lock ID
- file path
- connection ID
- owner
- timestamps

Remove:

- raw companion bearer token from persistent storage and API responses

## Resolved Design Decisions

The following decisions are now part of the working architecture direction for this plan.

### 1. Pairing enumeration remains inside companion preferences

Decision:

Do not expose full paired-origin enumeration to the browser. The browser should only learn its own origin-specific pairing state. The full paired-browser list belongs in the companion preferences UI.

Layman's terms:

The website should know whether this browser is paired. It should not automatically be able to ask the companion for a master list of every browser that has ever been trusted on this machine.

Architectural implications:

- browser-facing localhost endpoints should return origin-scoped status only
- paired-origin inventory stays a native-companion management concern
- browser troubleshooting flows should use "is this browser paired?" rather than "show all pairings"

### 2. Companion session scope uses the hybrid model

Decision:

Use a broader bootstrap step only long enough to start the flow, then shift the steady-state edit lifecycle to operation-scoped authority.

Layman's terms:

The companion can use a general-purpose handoff token to start work, but once it is editing one file, it should switch to a narrower token that is valid only for that specific edit session.

Architectural implications:

- initial deep-link bootstrapping can stay simple
- active edit operations should receive operation-scoped session authority
- renewal, auditing, and lock ownership checks should be tied to the operation-scoped token, not to the initial bootstrap token

### 3. Lock release requires a lock capability

Decision:

Long term, lock control should require both authenticated user or companion-session identity and possession of a lock capability returned at lock acquisition time.

Layman's terms:

It should not be enough to say, "I am the same user." The caller should also have a second proof that it is the actual holder of that specific lock.

Architectural implications:

- lock acquisition should return a lock ID and lock capability
- heartbeat and release should be keyed to lock identity rather than path alone
- backend lock control should no longer depend on any stored bearer token
- if delivery needs a smaller first step, lock ID plus strict owner binding can be used as a temporary bridge

### 4. Long-running native edits use renewable operation sessions

Decision:

Use renewable operation-scoped sessions rather than broad refresh tokens or routine short re-auth prompts.

Layman's terms:

If someone edits a file for a long time, the system should be able to keep that one edit session alive safely, without giving the companion a broad forever-renew credential and without constantly interrupting the user.

Architectural implications:

- renewal should be allowed only while the specific operation and lock are still valid
- heartbeat failures due to expiry should move the operation into a visible renewal-needed state
- upload and release flows should be built around renewable operation state, not a single static one-hour token

### 5. Browser-side pairing-secret direction remains two-stage

Decision:

Near term, improve storage so the secret is less easily exposed where platform support allows it. Long term, keep a long-lived browser identity secret, but make sure it is tightly origin-bound, better protected, and not sufficient by itself for the most sensitive actions.

Layman's terms:

Right now the browser keeps a reusable secret in a place page scripts can read. The realistic long-term goal is not to eliminate the browser's durable identity proof entirely, because that would force terrible UX. The goal is to keep that proof tied to our origin, protect it better, and make sure it does not automatically authorize every sensitive action on its own.

#### What the long-term redesign would mean in practice

Layman's terms:

The browser will probably still need a long-lived "I am this paired browser" credential. The real improvement is to make that credential safer and less overpowered, not to pretend the browser can work smoothly without any durable identity proof.

In practical terms, that likely means:

- the browser keeps a long-lived secret or equivalent credential that proves "this is the paired browser for this Sambee origin"
- that credential remains bound to the specific Sambee origin and must not be accepted for other origins
- routine local-drive actions can continue to use that credential without prompting the user
- especially sensitive actions such as unpairing, pairing enumeration, or other trust-management operations can require stronger checks than possession of the browser secret alone
- the main improvement areas become storage protection, origin binding, XSS resistance, and limiting what the credential authorizes by itself

#### Planned improvement direction for item 5

Phase 1 improvements:

- keep the current protocol shape but reduce casual exposure where practical
- review whether the pairing secret can move out of plain local storage in supported environments
- tighten browser-side lifecycle handling so stale or missing secrets are detected and recovered cleanly
- clearly distinguish routine local-drive access from higher-risk management actions in the localhost API

Phase 2 and Phase 3 improvements:

- preserve the browser's long-lived origin-bound identity proof, but reduce how much authority it carries by itself
- ensure sensitive trust-management actions have stronger gates than simple browser-secret possession
- explore whether some request classes should use additional derived proofs or tighter request binding without breaking the no-prompt UX for routine usage

Target end-state characteristics:

- the paired browser can continue to use local drives without prompting on every action
- the browser's durable identity proof remains limited to one Sambee origin
- stealing the browser secret should not automatically grant every sensitive companion-side management action
- rotating or invalidating browser access should be easier and more localized
- browser compromise should have a smaller blast radius than it has under the current reusable-secret model, even if active XSS on our origin remains a serious threat

Architectural implications:

- item 5 is primarily about hardening and bounding a long-lived origin-bound browser identity secret, not removing it entirely
- storage hardening matters, but XSS resistance on the Sambee origin remains a first-order requirement for this model
- the companion should treat the browser secret as proof of paired identity for routine access, not as blanket authorization for every trust-management action
- the near-term work can proceed without waiting for the long-term redesign
- the long-term design should stay aligned with the same least-privilege goals driving token scoping and lock capabilities elsewhere in this plan

## Recommended First Moves

The first implementation batch should focus on the highest-risk structural problems:

1. Remove `companion_session` from lock-status responses and logs immediately, but defer removal from backend lock persistence until the replacement ownership model is shipped in the coordinated auth-and-lock cutover.
2. Tighten localhost CORS and authorization for pairing-management routes.
3. Change browser pairing state to use only origin-specific status.
4. Add a real cancellation path for pending pairings.
5. Build the coordinated auth-and-lock redesign as one release slice: dedicated companion-token validation, operation-scoped authority, lock ownership replacement, and renewal.

These changes deliver immediate risk reduction while preparing the codebase for the deeper token and renewal redesign.
