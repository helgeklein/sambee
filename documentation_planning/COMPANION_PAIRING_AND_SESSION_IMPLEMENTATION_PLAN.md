# Companion Pairing And Session Implementation Plan

## Purpose

This document turns the approved remediation architecture into an execution plan.

It is intentionally delivery-oriented. The companion/browser remediation plan defines the target model and the structural decisions. This document defines:

- the release strategy
- the task breakdown by subsystem
- the documentation work required alongside code changes
- the dependency order between tasks
- the acceptance criteria for each implementation slice
- the test and rollout requirements for the coordinated cutover

Primary source architecture:

- `documentation_planning/COMPANION_PAIRING_AND_SESSION_REMEDIATION_PLAN.md`

## Delivery Assumptions

- The product is still pre-production.
- Backend, companion, and frontend can be shipped as a coordinated release train.
- Breaking protocol, API, and schema changes are acceptable if all three surfaces are updated together.
- Mixed-version support is not a product requirement outside a short deployment window.
- The main objective is not cosmetic cleanup. The objective is to replace ambiguous trust boundaries with explicit protocol contracts.

## Delivery Strategy

The implementation should be delivered in three stages:

1. Phase 1 hardening that reduces the highest-risk exposure without changing the full edit-session contract.
2. One coordinated auth, lock, and renewal cutover that replaces the backend-companion edit protocol as a single release slice.
3. Cleanup and UX refinement after the new protocol is stable.

This sequence matters.

Phase 1 should avoid deleting the old persisted lock-token contract before the replacement ownership model is ready. The full lock redesign, operation-scoped session model, and renewal flow should land together so the system does not spend time in a half-converted state.

## Current Phase 1 Baseline

The implementation plan below still describes the full intended sequence, but Phase 1 is no longer purely prospective.

The current codebase already includes an initial Phase 1 slice with four important consequences for the rest of the plan:

- browser readiness is now origin-scoped and typed rather than inferred from global paired state
- pairing approval is now exact-origin based in production, with loopback development origins allowed without manual companion configuration
- pending pairing cancellation is a first-class transition on both the browser and native-companion UI paths
- browser-visible pairing management is limited to the current origin; browser-facing paired-origin enumeration is no longer part of the contract

The remaining Phase 1 items and all later phases should be read as follow-on work from that baseline.

## Work Breakdown Overview

### Phase 1: Localhost Hardening And Immediate Exposure Reduction

Goals:

- stop credential leakage through lock-status responses and logs
- reduce the exposed localhost surface
- correct browser pairing-state semantics
- add real cancellation behavior for pending pairings

### Phase 2: Coordinated Auth, Lock, And Renewal Cutover

Goals:

- replace generic companion bearer semantics with dedicated companion token semantics
- make backend claim enforcement real instead of implied
- move lock ownership away from stored bearer tokens
- make long-running native edits renewable and failure-aware
- cut over backend, companion, and frontend together to the new protocol

### Phase 3: Cleanup And UX Refinement

Goals:

- remove rollout-only bridges and old assumptions
- simplify state models and polling behavior
- improve operational visibility and supportability under the new architecture
- publish the final end-user, developer, and operational documentation for the new model

## Detailed Plan

## Phase 1: Localhost Hardening And Immediate Exposure Reduction

### Scope

This phase should not redesign the backend edit-session contract yet. It should only do the work that is safe and useful before the coordinated cutover.

### Backend tasks

1. Remove companion session values from lock-status response payloads. ✅
2. Remove companion session values from logs and cleanup messages. ✅
3. Confirm that no lock-related API response returns bearer-equivalent data.
4. Add regression tests covering token non-disclosure in lock responses.

### Companion tasks

1. Replace permissive localhost CORS with exact-origin validation for browser requests and preserve loopback development-origin support. ✅
2. Reclassify localhost routes into three groups:
   - public bootstrap routes
   - authenticated local-drive routes
   - companion-preferences or locally approved management routes
3. Restrict browser-managed pairing actions to the current origin and remove browser access to arbitrary pairing inventory. ✅
4. Remove any browser-facing paired-origin enumeration route from the supported browser contract. ✅
5. Add a real cancellation path for pending pairings when either UI surface closes. ✅
6. Ensure the health or status surface exposes origin-scoped readiness for browser use rather than a global paired boolean. ✅
7. Add rate limiting or equivalent guardrails for pairing-window creation.

### Frontend tasks

1. Stop inferring readiness from global paired state. ✅
2. Switch pairing detection to an origin-scoped typed status contract. ✅
3. Handle explicit states for:
   - unavailable
   - unpaired
   - pending local approval
   - paired
   - recoverable secret missing
   - rejected or cancelled
4. Update pairing UI flows so browser and native close paths both trigger cancellation behavior instead of silent timeout or orphaned pending approval. ✅
5. Separate fast-changing local companion status polling from slower backend metadata refresh. ✅

### Data and protocol tasks

1. Define the new typed browser-facing companion status response. ✅
2. Define which localhost routes remain public and which require browser-secret auth or local approval. Partially completed in code and current browser contract, but the route-classification cleanup is not fully finished.
3. Define origin normalization, exact-origin approval rules, and loopback development-origin allowance as the trusted-origin source of truth. ✅

### Documentation tasks

1. Update developer documentation to explain the tightened localhost trust boundary, exact-origin pairing approval, loopback development-origin behavior, and the new origin-scoped pairing status model. ✅
2. Update any companion setup or troubleshooting docs that currently describe global pairing state, hostname-based trust, or silently expiring pending pairings. ✅
3. Add release notes for the Phase 1 behavioral changes so internal testers know what pairing, cancellation, re-pair, and localhost behavior should now look like.

### Phase 1 implementation status

Completed in the current codebase:

1. Lock-status responses and cleanup logs no longer disclose `companion_session` values.
2. Browser-facing paired-origin enumeration has been removed from the browser contract.
3. Current-origin pair status is typed and origin-scoped.
4. Browser and native pairing-close paths now cancel pending pairings explicitly.
5. Pairing approval uses exact-origin normalization in production and allows typical loopback origins for development.
6. Frontend state now distinguishes pending local approval and repair-required states.

Still remaining inside Phase 1:

1. Add explicit rate limiting or equivalent anti-spam guardrails for pairing-window creation.
2. Add release notes for the Phase 1 behavioral changes so internal testers know what pairing, cancellation, re-pair, and localhost behavior should now look like.

### Phase 1 acceptance criteria

- Browser pairing readiness depends only on origin-scoped status. ✅
- Closing either pairing UI path leaves no orphan pending pairing. ✅
- Untrusted or non-current origins cannot use browser-facing pairing management to mutate unrelated pairing state. ✅ for current browser-facing management flows.
- Lock-status responses and logs no longer disclose companion bearer tokens. ✅
- Existing local-drive browsing still works for a properly paired browser on the approved exact Sambee origin, and local frontend development continues to work from typical loopback origins.
- Documentation reflects the new pairing states, pairing-cancellation behavior, and localhost trust restrictions introduced in Phase 1. ✅

### Phase 1 test plan

1. Backend test: lock-status response never includes `companion_session`.
2. Backend test: orphan-cleanup logging does not include bearer material.
3. Companion test: valid exact production origins and loopback development origins receive CORS permission, while invalid origins do not.
4. Companion test: browser-facing destructive management calls cannot mutate unrelated origin state.
5. Frontend test: each typed pairing state renders the expected UI branch.
6. Integration test: dismissing the browser or native pairing dialog cancels the pending pairing, including after local approval but before browser confirmation completes.

## Phase 2: Coordinated Auth, Lock, And Renewal Cutover

### Scope

This phase is one coordinated release slice. Backend, companion, and frontend should all move to the new edit-session contract in the same planned cutover.

### Phase 2A: Protocol definition

Protocol draft:

- `documentation_planning/COMPANION_PAIRING_AND_SESSION_PROTOCOL_SPEC_DRAFT.md`

Before implementation begins, write the concrete contract for:

1. URI bootstrap token claims and lifetime.
2. Companion session token claims, including:
   - token class
   - user identity
   - token version or revocation semantics
   - allowed connection ID
   - operation ID
   - token purpose
   - expiry behavior
3. Lock acquisition response payload, including:
   - lock ID
   - optional lock capability
   - operation session details if returned at acquisition time
4. Renewal endpoint request and response shapes.
5. Error codes and recovery states for:
   - invalid companion token
   - expired operation session
   - renewal required
   - lock lost
   - capability mismatch

This contract should be treated as the implementation source of truth for the cutover.

The corresponding developer and operational docs should be updated as the contract stabilizes, not deferred until after implementation.

### Phase 2B: Backend implementation

#### Token model

1. Introduce a dedicated companion token issuance path that is separate from ordinary browser access-token handling.
2. Add a mandatory token-class discriminator to companion tokens.
3. Add revocation or token-version checks equivalent to the normal user auth model.
4. Add explicit scope claims for connection ID and operation ID.
5. Enforce those claims at each companion endpoint boundary.

#### URI token replay protection

1. Add a durable URI token JTI registry in the backend database.
2. Enforce single use across restart and multi-worker scenarios.
3. Add expiry cleanup for replay records.

#### Lock ownership redesign

1. Add lock ID based ownership as the primary lock reference model.
2. Add lock capability generation and validation if the team chooses to implement the stronger model immediately.
3. Stop using stored bearer tokens as proof of lock ownership.
4. Update heartbeat and release endpoints to use lock identity and the new ownership rules.
5. Remove `companion_session` from lock request models.
6. Remove `companion_session` from lock persistence as part of this cutover.

#### Renewal model

1. Add renewable operation-scoped session support.
2. Allow renewal only while the matching operation and lock are still valid.
3. Ensure renewal failure returns an explicit machine-readable state rather than relying on generic auth failure.
4. Prevent a general refresh-token model from creeping back into the companion flow.

#### Backend observability

1. Add structured logs for token exchange, renewal, lock acquisition, lock release, and lock cleanup.
2. Add audit-friendly identifiers for operation ID, lock ID, connection ID, and user ID.
3. Confirm logs never include raw bearer or lock-secret values.

### Phase 2C: Companion implementation

1. Update backend token exchange code to request and store the new companion session shape.
2. Track operation ID, lock ID, and lock capability in native state for the life of an edit session.
3. Update file-open, download, heartbeat, upload, and release flows to use the new contract.
4. Implement renewal logic for long-running edits.
5. Surface explicit renewal-needed or re-auth-needed states in the native editing flow.
6. Stop depending on any backend response that returns a session-equivalent value from lock status.
7. Ensure retry behavior does not mask hard auth or lock-loss failures indefinitely.

### Phase 2D: Frontend implementation

1. Update browser-to-backend deep-link initiation only as needed for the narrower bootstrap model.
2. Ensure browser state and UX can represent the companion-side statuses surfaced by the new edit flow.
3. Remove any assumptions that the old lock or token contract still exists.
4. Update any companion-download or launch guidance that depends on previous edit-session behavior.

### Phase 2E: Data migration and cutover

1. Add and deploy any new backend tables or columns required for:
   - URI token replay tracking
   - operation session state, if persisted
   - lock capability storage, if persisted
2. Backfill or clear legacy lock rows in a way that does not leave stale bearer material behind.
3. Remove legacy lock-token fields from application models in the same coordinated release.
4. Cut over companion and frontend to the new protocol only after the backend contract is deployed and verified in staging.
5. Validate the full deep-link to edit, heartbeat, upload, and release lifecycle in staging before production rollout.

### Phase 2 documentation tasks

1. Publish developer documentation for the new token classes, lock ownership model, and renewal flow.
2. Document the Phase 2 protocol contract and endpoint expectations in the repository docs, using the protocol spec draft as the source.
3. Update operational troubleshooting docs for token exchange failures, renewal-required states, lock-loss handling, and replay rejection.
4. Document any schema or data migration steps needed for coordinated rollout.
5. Add release notes that call out the coordinated breaking cutover across backend, companion, and frontend.

### Phase 2 acceptance criteria

- Companion tokens are structurally distinct from normal browser access tokens.
- Every companion endpoint enforces token class, revocation validity, and scope claims.
- URI bootstrap tokens are single use across restart scenarios.
- Lock ownership no longer depends on a stored bearer token.
- Long-running edits can renew without minting a broad companion refresh token.
- Heartbeat, upload, and release all operate on the new lock and operation contract.
- Full edit-session flow succeeds end to end using only the new protocol.
- Developer and operational docs describe the new token, lock, renewal, and recovery model well enough for another engineer to implement or debug the flow without reading old code paths first.

### Phase 2 test plan

1. Backend test: companion endpoints reject normal browser access tokens.
2. Backend test: companion endpoints reject connection or operation scope mismatches.
3. Backend test: URI token replay is rejected after restart-equivalent scenarios.
4. Backend test: lock release fails without correct lock ID or capability.
5. Backend test: renewal fails when the lock or operation is no longer valid.
6. Companion integration test: long edit session renews successfully before expiry.
7. Companion integration test: renewal-needed state is surfaced clearly when renewal fails.
8. End-to-end test: deep link, lock acquisition, download, heartbeat, upload, and release work under the new protocol.

## Phase 3: Cleanup And UX Refinement

### Backend tasks

1. Remove rollout-only migration guards and dead code from the companion auth path.
2. Remove obsolete legacy DTOs, endpoints, and compatibility branches.
3. Tighten validation and log formatting based on what was learned in staging.

### Companion tasks

1. Remove rollout-only branches from the edit-session and pairing code paths.
2. Simplify preferences and pairing-management UI around the finalized trust boundary.
3. Confirm companion diagnostics reflect the new terminology: origin-scoped pairing, operation session, lock ID, renewal.

### Frontend tasks

1. Reduce unnecessary polling and move toward backoff or event-driven refresh where practical.
2. Simplify local-drive settings UX around the final typed status model.
3. Remove legacy messaging based on the old global-paired or old token assumptions.

### Documentation tasks

1. Update end-user docs for pairing, local-drive access, native edit launch, and recovery flows.
2. Update admin or operator docs for companion deployment, trusted-origin expectations, and troubleshooting.
3. Update developer docs so the final architecture, identifiers, and endpoint semantics match the shipped system rather than the transitional plan.
4. Remove or rewrite obsolete docs that describe the old bearer-token lock model, old global paired status, or the previous edit-session flow.
5. Validate all docs changes with the repository docs tooling before the phase is considered complete.

### Phase 3 acceptance criteria

- No runtime path depends on the legacy lock-token contract.
- No user-facing UI depends on the old global pairing model.
- Observability and support flows use the new identifiers and state terminology consistently.
- End-user, developer, and operational docs consistently describe the shipped behavior and no longer describe the retired protocol.

## Cross-Cutting Task List By Repository

### Backend

- token issuance and validation refactor
- URI JTI persistence and cleanup
- lock model and endpoint changes
- renewal endpoint and operation-session enforcement
- audit logging and regression coverage

### Companion

- localhost route authorization split
- pairing cancellation and origin-scoped status work
- backend token exchange update
- lock ID and capability state handling
- renewal flow and failure-state handling

### Frontend

- typed pairing status adoption
- pairing cancellation UX wiring
- local companion status polling cleanup
- edit-flow state handling for renewal or failure conditions

### Documentation

- update docs under `website/content/docs/` for pairing, native editing, and troubleshooting
- document the coordinated backend, companion, and frontend cutover requirements
- publish the new token, lock, and renewal model for developers and operators
- remove outdated descriptions of the old bearer-token lock model and old pairing semantics

## Suggested Delivery Order Within Engineering

1. Write the concrete Phase 2 protocol contract.
2. Implement and verify Phase 1 localhost and leakage hardening.
3. Build backend Phase 2 foundations first: token classes, JTI store, lock model, renewal endpoints.
4. Update companion to the new Phase 2 protocol.
5. Update frontend assumptions and state handling required by the new protocol.
6. Update the corresponding docs as Phase 2 behavior stabilizes instead of waiting until after rollout.
7. Run full staging validation for the coordinated cutover, including docs validation for the changed pages.
8. Remove rollout-only branches in Phase 3 after the new contract is stable.

## Exit Criteria For The Overall Program

- The browser-to-companion trust model is origin-scoped and no longer exposes destructive pairing management to arbitrary websites.
- The backend no longer stores or returns bearer-equivalent lock ownership data.
- Companion edit authority is represented by explicit companion token classes plus operation and lock scope.
- Long-running native edits survive routine expiry through bounded renewal, or fail into a clear recovery state.
- The full system can be operated, debugged, and tested using the new identifiers and state model.
- The documentation set under `website/content/docs/` accurately describes the shipped pairing, token, lock, renewal, rollout, and troubleshooting behavior.

## Documentation Execution Notes

- All end-user, admin, developer, and website docs changes should be made under `website/content/docs/`.
- Structural docs changes should use `website/scripts/docs-editor.py`.
- Docs validation for this work should include `cd /workspace/website && npm run docs:validate`.
- Final docs verification can use `cd /workspace/website && npm run build` if a full website build is needed.
- The planning docs in `documentation_planning/` should be kept aligned with the shipped Phase 1 trust model so later phases are not planned against stale allowlist or pairing-state assumptions.
