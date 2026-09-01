# Phase 10 Transfer Stabilization Plan

## Decision

The original Phase 10 objective is too broad for an archive-unification follow-up.
It combines a useful shared target-policy improvement with a new distributed file
transfer system: scoped relay capabilities, cross-owner staging, source identity
proof, guarded deletion, target replacement, and exactly-once outcome recovery.

This plan supersedes the implementation portion of Phase 10 in
`ARCHIVE_UNIFICATION_IMPLEMENTATION_PLAN.md`. The original Phase 10 section is
retained only as a deferred-feature proposal and must link here as its active
implementation authority. This plan produces a safe, supportable transfer
baseline now and moves cross-owner transfer completion into a separately funded
feature proposal.

## Supported Baseline

Regular-file copy remains supported only where one runtime owns both source and
target. A public Move action is unavailable until its owner proves conditional
deletion of the exact source snapshot; a copy that leaves its source is never
presented as a completed move. This applies to UI availability, transfer
starters, and every public copy/move route; direct callers cannot bypass it.

The complete Move inventory for this stabilization is limited to:

- File Browser move commands and their enablement;
- `getTransferAvailability()` and `executeTransfer()`;
- `apiService.moveItem()` and the `StorageBackend.moveWithinBackend()`
   delegation in `storageBackends.ts`;
- backend `POST /api/browse/{connection_id}/move`; and
- Companion `POST /api/browse/{drive}/move`.

No other endpoint, archive operation, storage abstraction, or migration path is
part of the Move removal.

| Source | Target | Owner | Copy | Move |
| --- | --- | --- | --- | --- |
| SMB | SMB | Backend | Supported | Unavailable |
| local | local | Companion | Supported | Unavailable |
| SMB | local | None | Unavailable | Unavailable |
| local | SMB | None | Unavailable | Unavailable |

For the supported paths:

- `ask`, `skip`, and renamed-target retries are available;
- creation publishes only an owned private stage to a missing target;
- `replace` and `replace_older` remain unavailable until a target adapter proves
  guarded replacement;
- the existing `completed_with_source_retained` result type remains compatible,
   but stabilization adds no producer, UI behavior, or test work for it; and
- directory transfer behavior is preserved without refactoring. Retain only its
   existing factual partial-output reporting; do not change recursion, collision
   policy, cleanup, or routing.

### Proven Capability Matrix

This table is the final supported-baseline snapshot for the stabilized release.
A blank, inferred, or untested capability is unavailable.

| Topology | Missing-target create | Source proof before commit | Guarded replacement | Guarded source deletion | Exposed actions |
| --- | --- | --- | --- | --- | --- |
| SMB -> SMB | Owned stage and exclusive publish | Existing check retained; no new proof work | No | No | Copy, Skip, Rename |
| local -> local | Owned stage and exclusive publish | Existing check retained; no new proof work | No | No | Copy, Skip, Rename |
| SMB -> local | Not implemented | Not implemented | No | No | None |
| local -> SMB | Not implemented | Not implemented | No | No | None |

It is release documentation, not a new runtime capability registry. Any future
change requires a separately approved deferred-feature plan.
Use the existing per-owner action constants and availability checks to expose
only the listed actions. Any capability beyond this baseline belongs to the
deferred feature and requires its own proof and test plan.

### Idempotency And Unknown Outcomes

Each submission includes a caller-generated UUID. A target owner may replay a
matching result while its receipt remains available, but this is an optimization,
not durable transfer recovery. The browser sends one HTTP submission per key.
If the browser does not obtain a response, it returns `outcome_unknown`,
refreshes both locations, and never submits that key again. It does not query
for receipt recovery, retry the request, or distinguish expiry from owner
restart. Retrying after an unknown outcome is an explicit new user action with
a new key.

`executeTransfer()` is the sole production UUID issuer. It supplies that key to
the storage adapter, which only forwards it. Remove the fallback UUID generation
from `apiService.copyItem()` and `apiService.moveItem()` so their key parameter
is required; direct API tests supply an explicit known UUID.

The backend and Companion HTTP results use `{ code: "unavailable", detail: ... }`.
At the existing `apiService.postTransfer()` boundary, normalize only that error
to the unchanged frontend result shape
`{ code: "unavailable", reason: "unsupported" }`. Do not change the public
TypeScript result union or add another error code; cover the one normalization in
the focused API test below.

## Keep

1. Keep the operation-neutral Python and Rust target-resolution vocabulary,
   pure reducer, and bounded two-attempt controller. Archive extraction and
   same-owner regular-file transfer use this policy vocabulary; TypeScript only
   carries policy and result types.
2. Keep explicit caller-supplied UUID idempotency keys and factual transfer
   result states. Remove HTTP-test key injection and update only the transfer
   callers plus fixtures in `backend/tests/test_browser.py`,
   `backend/tests/test_content_transfer.py`, and the Companion direct-transfer
   handler tests. Keep receipts only for duplicate known-result replay; a
   browser-side missing response is `outcome_unknown` without a recovery request.
3. Keep exclusive stage-and-commit for a missing regular target, stage cleanup,
   and existing source snapshot checks. Do not strengthen or generalize source
   proof in this stabilization.
4. Keep factual partial-directory failure reporting. A visible root created
   before a recursive failure remains `failed` with destination mutation. This
   is preservation coverage only, not directory-transfer redesign.
5. Keep the generic overwrite-resolution dialog, but expose only actions backed
   by the resolved target adapter. Current file-transfer actions are `skip` and
   `rename`; archive extraction remains unchanged.

## Remove

1. Remove the preliminary SMB-to-local production flow before release:
    - from `backend/app/api/browser.py`,
       `SmbToLocalTransferPrepareRequest`, `SmbToLocalTransferCapability`,
       `TRANSFER_RELAY_TOKEN_*`, `_transfer_snapshot_from_claims()`,
       `_validate_transfer_relay_token()`,
       `create_smb_to_local_transfer_capability()`, and
       `relay_smb_transfer_source()`;
    - from `companion/src-tauri/src/server/mod.rs`, the `smb-source` route
       registration; from `handlers.rs`, `SmbSourceTransferRequest`,
       `browse_transfer_smb_source()`, and only private dependencies made
       unreferenced by deleting that handler;
    - from `frontend/src/pages/FileBrowser/contentOperations.ts`, the
       SMB-to-local branch; from `frontend/src/services/api.ts`,
       `SmbToLocalTransferCapability` and `transferSmbToLocal()`; and from
       `frontend/src/services/storageBackends.ts`, `transferSmbToLocal()`.
    Archive relay code, including `ArchiveExtractionRelaySourceSnapshot` in
    `companion/src-tauri/src/server/archive.rs`, is expressly out of scope and
    must remain unchanged.
2. Restore one clear cross-topology contract. Align the backend
   `ContentTransferError` literal with the frontend's existing `unavailable`
   code; do not add any other result vocabulary. The server response uses the
   existing `detail` field and `apiService.postTransfer()` performs the single
   documented frontend normalization. File Browser availability returns
   `{ available: false, reason: "unsupported-destination" }`. For a valid
   physical request rejected only by transfer policy, `executeTransfer()` returns
   the normalized frontend `failed` result without resolving storage or doing
   I/O; malformed caller data retains its current exception behavior. After
   normal request validation succeeds, either listed server Move route returns
   HTTP 200 with `failed`, `replaced: false`, unchanged effects, and
   `{ code: "unavailable", detail: "Transfers are unavailable in this release" }`.
   Missing or malformed request fields retain their existing validation failures.
   The only mixed-transfer seams in scope are the File Browser routing branch,
   `transferSmbToLocal`, backend capability and relay-source endpoints, and the
   Companion `smb-source` route. Remove them; the remaining routing for both
   mixed directions returns this result before source reads or mutations.
3. Remove only tests, capability types, and adapter APIs that directly import
   or call the named withdrawn surfaces. Retain tests that enforce the
   no-browser streaming/deletion boundary for both mixed directions; do not
   alter archive relay tests or types.
4. Do not add a local-to-SMB counterpart, a source-delete relay action,
   cancellation relay plumbing, or a replacement fallback as part of this work.

## Execution Order

1. Add the supersession note to the original Phase 10 heading, record the
   capability matrix, and align the backend error literal with the existing
   frontend `unavailable` code. Do not add a target-capability registry, a
   transfer coordinator, new bindings, or any other result vocabulary.
2. Add focused characterization tests for the retained baseline: same-owner
   create, skip, refreshed conflict, renamed retry, late create collision,
   rejected Move availability at the listed UI, starter, and route boundaries,
   and partial directory output. Add only these frontend cases:
   `phase_10_stabilization_move_is_unavailable`,
   `phase_10_stabilization_mixed_transfers_do_no_io`,
   `phase_10_stabilization_move_commands_are_disabled`,
   `phase_10_stabilization_transfer_policy_exposes_skip_and_rename`,
   `phase_10_stabilization_api_requires_a_supplied_idempotency_key`,
   `phase_10_stabilization_no_response_returns_unknown_without_retry`, and
   `phase_10_stabilization_normalizes_unavailable_response`. This limits only
   new frontend tests. Add only these backend tests in
   `backend/tests/test_browser.py`:
   `test_copy_rejects_missing_or_malformed_idempotency_key`,
   `test_move_is_unavailable_after_validation`, and
   `test_smb_to_local_routes_are_absent`; the last test is parameterized for
   both withdrawn backend routes. The focused Companion tests in the next step
   remain permitted; no other new test category is part of this plan.
3. Remove only the named SMB-to-local route family end to end, starting at
   frontend routing and `transferSmbToLocal`, then Companion `smb-source`
   registration/handler, then backend capability/relay endpoints. Add only two
   Companion tests: `phase_10_stabilization_move_route_unavailable` and
   `phase_10_stabilization_mixed_transfer_does_no_io`. Confirm both mixed
   directions fail before any source reader, browser blob operation, or source
   delete is invoked.
4. Replace HTTP-test key injection with explicit UUIDs only in the named backend
   and Companion transfer test files. Remove the two `apiService` fallback keys;
   `executeTransfer()` remains the sole production issuer. Add negative API
   tests proving that a missing or malformed key is rejected. Remove automatic
   transfer retries after a missing response and test one browser-side
   `outcome_unknown` result with no second HTTP submission. Do not add expiry,
   restart, durable receipt, or receipt-recovery behavior.
5. Update only File Browser transfer command enablement and its existing batch
   result handler. Move remains disabled for every currently unproven owner;
   Copy continues to apply cache effects only for a factual completed result.
6. Keep action selection in the existing per-owner availability code. Do not add
   a capability registry or make UI availability infer replacement or deletion
   from a policy enum.
7. Remove dead types, imports, and tests introduced exclusively for withdrawn
   relay behavior. Keep the public TypeScript result union and target-policy
   vocabulary stable.

## Stop When

This stabilization work is complete immediately after the following bounded
changes are implemented and validated:

1. The named SMB-to-local relay seams are removed and both mixed directions use
   the documented `unavailable` result without source I/O or mutation.
2. Every public Move entry point is unavailable; same-owner Copy retains only
   the already-proven missing-target, skip, and rename behavior.
3. `executeTransfer()` supplies every production UUID, direct transfer callers
   and tests supply explicit UUID idempotency keys, and one missing-response path
   returns `outcome_unknown` without a second submission.
4. The bounded completion-gate commands in Acceptance Criteria pass, including
   existing partial-directory compatibility behavior. A repository health-signal
   failure outside the named inventory is recorded as baseline debt and does
   not reopen this plan.

Do not extend this work with source/target binding interfaces, a generic
capability registry, guarded replacement or deletion feasibility work, relay
transport, cancellation propagation, durable receipts, new storage abstractions,
or any local-to-SMB implementation. Those are all deferred-feature work.

## Acceptance Criteria

- The named transfer tests in the completion gates remain green. Existing
   archive target-resolution corpus coverage is unchanged and is outside this
   stabilization gate.
- The File Browser mixed-routing branch and `transferSmbToLocal`, backend
  capability/relay-source endpoints, and Companion `smb-source` route are
  removed. The remaining routing returns `unavailable` before source reads or
  mutations.
- Both cross-topology directions return the documented typed `unavailable`
   result before source reads or mutations.
- Existing-target replacement is unavailable unless the owning adapter has a
  tested guarded-replacement capability; no delete-then-copy/rename path exists.
- Every public copy request requires an explicit UUID idempotency key.
   `executeTransfer()` creates it for production calls and lower transport methods
   never generate a fallback. A browser-side ambiguous response is
   `outcome_unknown`, never an automatic re-execution or receipt-recovery request.
- Every public Move entry point is unavailable until its target owner proves
   guarded source deletion. The existing source-retained result type gains no
   new implementation work in this stabilization.
- Directory collision policy never propagates recursively to child files, and
  known partial output is reported factually.
- The following bounded completion gates pass:

   ```bash
   cd /workspace && git diff --check
   cd backend && rg -P '^\s*(async )?def test_copy_rejects_missing_or_malformed_idempotency_key\(' tests/test_browser.py >/dev/null && rg -P '^\s*(async )?def test_move_is_unavailable_after_validation\(' tests/test_browser.py >/dev/null && rg -P '^\s*(async )?def test_smb_to_local_routes_are_absent\(' tests/test_browser.py >/dev/null && .venv/bin/python -m pytest -q --no-cov tests/test_content_transfer.py tests/test_browser.py::test_in_flight_transfer_receipt_waits_for_the_owner_result tests/test_browser.py::test_unrecorded_transfer_reservation_returns_unknown_outcome tests/test_browser.py::test_copy_rejects_missing_or_malformed_idempotency_key tests/test_browser.py::test_move_is_unavailable_after_validation tests/test_browser.py::test_smb_to_local_routes_are_absent tests/test_browser.py::TestCopyItem tests/test_browser.py::TestMoveItem
   cd companion/src-tauri && tests="$(cargo test --lib -- --list)" && rg -F 'phase_10_stabilization_move_route_unavailable:' <<<"$tests" >/dev/null && rg -F 'phase_10_stabilization_mixed_transfer_does_no_io:' <<<"$tests" >/dev/null && cargo test --lib --quiet phase_10_stabilization_
   cd frontend && rg -F 'it("phase_10_stabilization_move_is_unavailable"' src/pages/FileBrowser/contentOperations.test.ts >/dev/null && rg -F 'it("phase_10_stabilization_mixed_transfers_do_no_io"' src/pages/FileBrowser/contentOperations.test.ts >/dev/null && rg -F 'it("phase_10_stabilization_move_commands_are_disabled"' src/pages/__tests__/FileBrowser-interactions.test.tsx >/dev/null && rg -F 'it("phase_10_stabilization_transfer_policy_exposes_skip_and_rename"' src/pages/__tests__/FileBrowser-transferPolicies.test.ts >/dev/null && rg -F 'it("phase_10_stabilization_api_requires_a_supplied_idempotency_key"' src/services/__tests__/api.test.ts >/dev/null && rg -F 'it("phase_10_stabilization_no_response_returns_unknown_without_retry"' src/services/__tests__/api.test.ts >/dev/null && rg -F 'it("phase_10_stabilization_normalizes_unavailable_response"' src/services/__tests__/api.test.ts >/dev/null && npm run test -- src/pages/FileBrowser/contentOperations.test.ts src/pages/__tests__/FileBrowser-interactions.test.tsx src/pages/__tests__/FileBrowser-transferPolicies.test.ts src/services/__tests__/api.test.ts -t phase_10_stabilization_
   ```

   The two Companion tests named in Execution Order must use the
   `phase_10_stabilization_` prefix; the discovery check fails if the list
   command fails or either exact test is absent. The three backend test names
   listed in Execution Order are likewise required; their discovery checks fail
   if any one is absent.

   After the completion gates pass, run these non-blocking repository health
   signals separately:

   ```bash
   cd backend && .venv/bin/python -m mypy app
   cd companion/src-tauri && cargo fmt --check && cargo clippy --lib --tests -- -D warnings
   cd frontend && npx tsc --noEmit && npm run lint
   ```

   Repair a health-signal failure only when a changed diff hunk, or its immediate
   compiler/type dependency, causes it. Otherwise record it as baseline debt and
   stop; it does not prevent completion or justify expanding this plan. A full
   module or repository suite is also a non-blocking health signal.

## Deferred Feature: Cross-Owner File Transfer

Reconsider mixed SMB/local copy and move only with explicit product demand and
dedicated design review. A proposal must first specify and prove, independently
for each owner, the following:

1. a source binding that provides a fresh bounded reader, verifies the snapshot
   before target commit, and conditionally deletes the exact source identity;
2. a target binding that atomically creates a missing target or conditionally
   replaces the exact observed regular target;
3. a scoped, origin-pinned relay capability bound to topology, operation kind,
   source snapshot, target scope, expiry, and idempotency key;
4. durable-enough result receipts and unknown-outcome behavior for dropped
   target-owner responses;
5. cancellation, cleanup, permission, lock, source-change, target-race, and
   source-retained tests for both mixed directions.

Until all five are proven, mixed transfer remains unavailable rather than
partially implemented.
