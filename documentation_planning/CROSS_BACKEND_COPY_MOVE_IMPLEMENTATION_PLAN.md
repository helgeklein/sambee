# Comprehensive Copy, Move, and Selected Archive-Member Extraction Implementation Plan

## Purpose

Restore and make durable full copy and move support for physical files and
directories between every supported storage location:

- SMB connection to the same SMB connection
- SMB connection to a different SMB connection
- local drive to the same local drive
- local drive to a different local drive
- SMB connection to a local drive
- local drive to an SMB connection

Archive members and archive virtual locations are explicitly out of scope from
the physical copy/move matrix. A physical directory may contain archive files,
which are transferred as ordinary files.

Selected ZIP members are a separate, copy-only extraction workflow. In
dual-pane mode, a user may select members in an archive pane and press F5 to
extract them into the opposite physical pane. Archive members are never moved:
F6 does not delete an archive member or mutate its containing archive.

The solution must preserve correctness when a browser is closed, requests are
retried, source or destination changes concurrently, an operation is cancelled,
or one provider becomes unavailable. A browser-relayed operation pauses when
its browser closes and may resume after reload; it does not continue in the
background unless a provider-owned worker is introduced. It must not silently
overwrite a target or delete a changed source.

## Current State and Root Cause

`ContentOperation` currently rejects every move and rejects transfers whose
source and destination are different backend kinds. The API layer repeats those
gates. The underlying SMB and Companion services only expose path-based delete
operations, while the SMB reader closes its handle before a later delete can be
requested. Separately, archive extraction currently accepts an archive location
and destination only, so it always extracts the whole archive. Its V2 contract
rejects an unknown member-selection field, and current execution rejects
different SMB connections and different local drives.

This prevents the required transfer matrix from reaching any transport. Simply
removing the gates would be unsafe: a browser-side read-to-Blob-to-upload relay
would buffer large files, bypass atomic collision handling, and cannot safely
delete a source using a handle it does not own.

Likewise, treating a selected archive member as a physical source would be
incorrect. An archive member is delivered by an archive reader, not a
filesystem object with an independently deletable source identity.

## Design Decisions

### Provider-owned transfer sessions

Each provider owns an explicit, expiring transfer session when the operation
needs a streamed fallback. A source session retains an identity-bound
read/delete capability and a destination session owns a private staging target.
The browser relays bytes only when the providers cannot transfer directly.

Same-filesystem, same-server, and same-provider operations first use a proven
native rename, move, or server-side copy capability. They use the streamed
session protocol only when the native operation cannot provide the requested
conflict policy or factual outcome.

The browser must never be trusted to assert that a source is unchanged, a
destination is complete, or a source can be deleted. Those facts are checked by
the provider that owns the relevant filesystem handle.

### Archive-owned selected-member extraction

Selected-member extraction remains on the archive operation protocol and is
not a `TransferOperation`. It reuses the archive reader, archive conflict
decisions, destination ownership, and archive-operation progress model, while
the physical transfer protocol remains responsible only for physical sources.

An archive selection identifies one ZIP virtual location and a canonical,
deduplicated set of member-root paths. A selected directory includes its
descendants, including empty directories. Overlapping selections are delivered
once, and selection never permits a member path outside the archive's validated
namespace. The selection is captured in the prepared archive operation so a
later retry cannot silently use the browser's changed selection.

The ZIP-owning provider pins the archive reader and records an archive-file
identity snapshot when it prepares the operation. It rejects a changed or
unavailable archive with `source_changed` or `source_unavailable`; it never
continues by combining records from different archive versions. Archive sources
are read-only throughout this workflow, so no source lease, guarded source
delete, or `completed_with_source_retained` move outcome applies.

### Capability ladder and staged fallback

Select the strongest available execution path for each root:

1. use a native atomic rename/move when the source and target are on the same
  filesystem or server and it implements the requested conflict policy
2. use a provider/server-side copy or move when it provides the required
  factual result
3. otherwise use a staged, streamed transfer on the destination filesystem

The staged fallback uses these logical stages:

1. inspect and reserve the requested target according to its conflict policy
2. copy bytes and create the complete destination tree in private staging
3. verify all copied content and atomically promote the staged target
4. for a move only, delete the source through its retained identity-bound
   session
5. publish a factual result and retain it for idempotent retries

Promotion before source deletion means a failed physical move can create a valid
destination while preserving its source. This is reported as
`completed_with_source_retained`, never hidden as a successful move. Direct
destination writes are not used for ordinary transfers because interrupted
copies expose partial data and can damage an existing target; they require an
explicit, documented performance-oriented mode.

Archive extraction applies the same destination collision and publication
guarantees per extracted member where the destination supports them. It does
not make a selected group atomically visible as one tree when its entries merge
with an existing destination; it records factual per-member outcomes instead.

### One logical operation protocol

Define a versioned `TransferOperation` protocol shared by the backend,
Companion, and frontend. It replaces the current source-backend-only
`copyWithinBackend` / `moveWithinBackend` assumption for cross-provider work.

The protocol must carry:

- caller-provided idempotency key and server/provider-issued operation ID
- operation kind (`copy` or `move`)
- source and destination locations
- target resolution policy and resolved final target name
- source identity snapshot and recursive manifest for directories
- destination staging identity and commit state
- byte, entry, and total progress
- factual source and destination effects
- expiry, cancellation, and recovery state

Existing `ContentTransferResult` remains the common result shape, extended only
when it cannot represent an observable terminal state. Results must always
describe what actually changed, including partial destination output.

## Supported Behavior Matrix

| Source | Destination | Files | Directories | Copy | Move |
| --- | --- | --- | --- | --- | --- |
| SMB | Same SMB connection | native SMB operation, then staged fallback | native SMB operation, then staged fallback | yes | yes |
| SMB | Other SMB connection | backend-to-backend stream | backend-to-backend staged tree | yes | yes |
| Local | Same local drive | native filesystem operation, then staged fallback | native filesystem operation, then staged fallback | yes | yes |
| Local | Other local drive | Companion-to-Companion stream | Companion staged tree | yes | yes |
| SMB | Local | browser-relayed stream between provider sessions | browser-relayed staged tree | yes | yes |
| Local | SMB | browser-relayed stream between provider sessions | browser-relayed staged tree | yes | yes |

The matrix applies to one or many selected roots. A batch is sequential at the
root level unless durable scheduling is later introduced. Each root has its own
idempotency key, receipt, conflict decision, progress, and terminal result.

### Selected ZIP-member extraction matrix

| ZIP storage location | Physical destination | Delivery owner | F5 extract | F6 move |
| --- | --- | --- | --- | --- |
| SMB | Same SMB connection | backend archive operation | yes | no |
| SMB | Other SMB connection | backend-to-backend archive stream | yes | no |
| SMB | Local drive | paired Companion relay over archive operation | yes | no |
| Local drive | Same local drive | Companion archive execution | yes | no |
| Local drive | Other local drive | Companion-to-Companion archive stream | yes | no |
| Local drive | SMB | paired Companion relay over archive operation | yes | no |

The present archive executor handles same-SMB, same-local, and mixed SMB/local
topologies. Different-SMB and different-local archive extraction are explicit
parity work in this plan, not already-supported behavior.

## Physical Source Session Requirements

### Common source contract

Introduce a source-session API with these logical operations:

- `begin_source_transfer`: validate readability, capture immutable identity and
  metadata, and retain the source lease
- `read_source_chunk`: stream a bounded offset/range from the retained source
  object; support reconnect/retry with offset and per-chunk digest
- `get_source_manifest`: return a stable tree manifest for a directory source
- `verify_source`: prove that every transferred source entry still matches the
  captured identity
- `commit_source_move`: delete only the captured source objects after a
  destination commit
- `abort_source_transfer`: close handles and release leases without mutation
- `get_transfer_receipt`: return the durable factual result for an idempotency
  retry

Source sessions expire safely: expiry closes the lease and leaves the source
unchanged. They may never delete automatically after expiry.

### SMB source implementation

Implement an SMB transfer-handle abstraction in `backend/app/storage/`.

- Open files with the access and share modes necessary to retain their identity
  and perform deletion through that same SMB handle after destination commit.
- Capture SMB file identity, size, modification time, and other stable metadata
  exposed by the server. Do not rely only on a path.
- Implement conditional deletion with the retained SMB handle or an SMB-native
  identity/lease primitive. A research spike must verify the exact `smbclient`
  / SMB server APIs and their behavior on Windows, Samba, and NAS appliances.
- If a server cannot provide the necessary conditional-delete primitive, return
  `completed_with_source_retained` after destination commit. Do not fall back
  to path-based deletion.
- For directories, capture a recursive manifest before destination promotion;
  a move removes only entries still matching their captured identities.

### Local source implementation

Implement the equivalent transfer-handle abstraction in the Companion Rust
server.

- Retain OS file handles for regular files for the duration of the session.
- Capture platform-native identity: device/inode on Unix and volume serial plus
  file ID on Windows. Include length and modification time as secondary checks.
- Implement delete-through-handle where the platform supports it. Where deletion
  remains path based, compare the current identity immediately before deletion
  and treat any mismatch as source retention; document the remaining OS-level
  race and eliminate it with a platform-specific guarded primitive before
  claiming full move support on that platform.
- Treat symlinks, Windows reparse points, and `.lnk` files as leaf entries by
  default. Do not follow them across the exposed-drive boundary during a copy or
  move. Preserve them only after an explicit per-platform link representation
  contract is implemented.
- A directory session uses a captured manifest plus per-entry identity guards;
  it must not use `remove_dir_all` on the original path after copying.

## Physical Transfer Destination Session Requirements

Implement destination sessions in both the backend SMB API and Companion API.

- `begin_destination_transfer` validates write access and target policy, then
  creates an operation-private sibling staging directory or temporary file on
  the destination filesystem.
- Write operations accept bounded chunk offsets and hashes, making retries
  idempotent and preventing duplicate or reordered writes.
- Build directory trees only beneath staging. Preserve supported file metadata
  such as modification time and permissions according to an explicit
  cross-platform policy.
- `finalize_destination_transfer` verifies entry count, lengths, and whole-file
  digests, then promotes staging to the final name using the filesystem's
  strongest atomic rename/create primitive.
- Final target reservation and promotion enforce `ask`, `skip`, `rename`,
  `replace`, and `replace_older` without check-then-write races. Return the
  existing structured conflict information whenever user resolution is needed.
- `abort_destination_transfer` removes only the operation's staging data. It
  never removes a promoted destination.

The existing upload endpoints may remain for editor save-back, but must not be
used as the cross-backend transfer protocol because they overwrite a path and
buffer multipart content.

## Transfer Orchestration

### Same-provider operations

Restore same-provider move dispatch first, using provider-native copy/move when
they provide the required target policy and factual outcome. Route through the
new operation coordinator so the UI observes the same result and receipt model
as cross-provider transfers.

When a provider-native operation cannot meet the session contract, use the
staged source/destination protocol within that provider instead.

### Cross-provider operations

The browser is the authenticated byte relay between the backend origin and the
paired Companion origin. It does not receive filesystem authority.

1. The frontend requests source and destination sessions using the single
   idempotency key and receives opaque capability-scoped session URLs/tokens.
2. It streams chunks with backpressure from source to destination; it must not
   call `response.blob()` or assemble the file in memory.
3. It resumes from the destination's acknowledged offset after a recoverable
   request failure. Digest mismatches abort the destination session and retain
   the source.
4. The destination validates and promotes the entire root.
5. For copy, the frontend asks the source session to verify and close. For move,
   it asks the source session to commit its guarded deletion.
6. Both providers persist their receipts. A retry asks for the receipt rather
   than restarting a possibly completed mutation.

For directories, the coordinator streams one manifest entry at a time and only
promotes a newly created staged root after every entry has verified. Empty
directories are manifest entries and must be preserved. A copy merged into an
existing destination tree cannot be atomic as one unit, so it records factual
per-entry results and does not delete its source entries until their target
entries have committed.

### Selected archive-member extraction

Keep the existing whole-archive Extract command unchanged. The new F5 workflow
is available only in dual-pane mode when the active pane is a ZIP virtual
location, at least one readable archive member is selected, all selected items
belong to that archive, and the opposite pane is a writable physical location.
The UI passes the canonical selected roots to the archive extraction dialog and
extracts them directly beneath the opposite pane, preserving their paths
relative to each selected root. It does not create the single sibling directory
used by whole-archive extraction unless the user explicitly chooses one.

F6 and generic physical copy/move availability remain unavailable for every
virtual item. Selection must not mix physical items with archive members or
members from different archive locations. The UI explains unavailability using
the existing command-state mechanism rather than silently treating F6 as a
copy.

The archive executor filters its central-directory traversal to the prepared
member roots and retains the existing live collision/pending-decision protocol.
It validates each archive member path before delivery and uses destination
staging/promotion where supported. Cancellation stops delivery and cleans only
unpromoted destination output; it never alters the ZIP source.

Selected member paths and their initial archive identity are durable operation
inputs. The current S1 live archive session has no member ledger or resumable
cursor, so a process interruption must report an interrupted or unknown
per-member outcome and refresh the destination. A later archive-protocol
upgrade may add resumable member delivery, but must version the contract and
cannot retrofit replay semantics into V2 checkpoints.

### Browser closure and recovery

Transfer state is durable at each provider and mirrored in browser session
storage only for UX recovery. A browser-relayed transfer pauses when the
browser closes; it may resume from provider-acknowledged offsets on reload. It
continues after browser closure only if a future provider-owned worker performs
the byte relay. On reload, the frontend queries both provider receipts and
offers exactly one of these truthful states:

- complete
- skipped
- destination committed; source retained
- cancelled before destination commit
- failed before destination mutation
- failed with staged data cleaned up
- outcome unknown; both locations must be refreshed and reconciled

An orphaned session expires and cleans only unpromoted staging data. It must
never automatically commit a source deletion.

Archive operations follow their own V2 recovery rules. Backend-owned selected
extractions may remain observable through their durable archive operation, but
a live reader/session interrupted by browser, backend, or Companion loss is not
claimed to be resumable. Recovery displays the recorded aggregate result when
available, otherwise an interrupted or unknown result and refreshes the target.

## API and Type Changes

### Backend and Companion

- Add versioned transfer-session endpoints under their existing browse API
  namespaces.
- Authenticate backend sessions as the current user and Companion sessions with
  the existing origin-scoped pairing HMAC. Session capabilities are opaque,
  short-lived, single-operation, and bound to origin, source/destination,
  operation kind, and idempotency key.
- Rate limit chunk endpoints, cap transfer concurrency, enforce maximum chunk
  size, and reject offset/digest mismatches.
- Publish progress over the existing websocket model for provider-native and
  staged transfers. Progress is advisory and must not decide correctness.
- Extend transfer receipts to include session phase and final factual result.
- Add cleanup jobs for expired source leases, destination staging, and receipts.

### Archive extraction contract and executors

- Introduce a new versioned archive extraction request contract rather than
  adding unknown fields to V2. It carries an optional canonical
  `selected_member_paths` list; omission preserves whole-archive extraction.
- Persist the resolved selection and archive identity snapshot in the archive
  operation's immutable request data, separate from V2's intentionally
  non-resumable extraction checkpoint.
- Extend backend and Companion archive executors to filter member traversal by
  selected roots, collapse duplicate/overlapping roots, and preserve selected
  empty directories.
- Add archive delivery routes or capability bindings for SMB-to-other-SMB and
  local-to-other-local extraction. Reuse the established archive relay model;
  do not force archive data through the physical `TransferOperation` API.
- Reuse target conflict policies and structured archive pending decisions.
  Destination writes must identify whether partial member output may exist.
- Keep archive operation source authority scoped to the containing ZIP and its
  selected member namespace. A capability never authorizes archive mutation or
  filesystem access outside the resolved destination root.

### Frontend

- Replace the cross-backend availability gate with capability queries from the
  transfer coordinator. Archive sources remain unavailable.
- Extend `StorageBackend` / `StorageBackendRegistry` with session factories and
  a `TransferCoordinator`; do not make the source backend responsible for a
  destination it does not own.
- Update `executeTransfer` to dispatch `copy` and `move` independently.
- Render root and byte progress from coordinator events. Preserve the current
  conflict dialog; pause the operation at a conflict and resume the same
  idempotency-backed root with the selected policy.
- Always refresh source and destination panes after every terminal result,
  including partial completion, cancellation, and unknown outcome.

### Frontend archive-member extraction

- Extend `ArchiveExtractionRequest` and the archive dialog context with the
  immutable selected member roots and extraction mode (`whole_archive` or
  `selected_members`).
- Map virtual-list selection to canonical ZIP member roots. Reject an empty,
  unreadable, mixed-location, or mixed physical/virtual selection before the
  dialog opens.
- In dual-pane ZIP browsing, route F5 to selected-member extraction and retain
  the existing whole-archive command for an unselected archive file. Do not add
  a generic virtual-item branch to `executeTransfer`.
- Make F6 unavailable for archive members and show its normal unavailable state.
- Reuse archive progress, cancellation, conflict, member-error, recovery, and
  pane-refresh behavior. Progress includes selected members only and never
  reports archive-wide totals as selection totals.

## Conflict, Metadata, and Link Policy

- Target policies apply before any source deletion and are evaluated again at
  promotion, not just at dialog display time.
- Replacement creates a recovery-safe prior-target strategy. The destination
  provider must be able to restore or retain the previous target if promotion
  fails before the commit is factual.
- Preserve file contents and names exactly. Preserve modification times where
  both providers support them; report unsupported metadata preservation rather
  than failing a valid content transfer unless policy requires it.
- Reject illegal names and names not representable on the destination before
  copying. Offer rename resolution where the policy permits it.
- Hard links, special files, device files, sockets, and unsupported links are
  rejected per entry before staging. The result must identify the failing entry
  and keep the original source.

## Safety and Security Requirements

- Validate every path at the owning provider. Never accept a browser-provided
  absolute path or path traversal sequence.
- Do not expose arbitrary local filesystem paths; retain current drive-boundary
  and pairing rules.
- Bind all session tokens to the browser origin, authenticated user/pairing,
  transfer operation, and expiry.
- Limit staging storage, total operation size, concurrent sessions, directory
  depth, entry count, and retry attempts. Clean failures predictably.
- Use structured logs and audit records with operation ID, source/destination
  provider kinds, result, and factual effects. Never log credentials or session
  capabilities.
- Ensure cancellation is cooperative: it stops future reads/writes, cleans only
  staging, and never deletes the source.

## Implementation Phases

### Phase 0: Contract and platform research

- Specify the transfer-session OpenAPI/types and state machine.
- Prove SMB delete-through-handle behavior against Samba, Windows Server, and
  a representative NAS using integration tests.
- Prove Companion identity and guarded-delete behavior on Windows, macOS, and
  Linux. Do not mark a platform move-capable until its test passes.
- Define metadata and link preservation policy.

Exit criterion: every provider/platform has either a proven guarded deletion
implementation or explicitly reports source retention after copy.

### Phase 1: Re-enable correct same-provider transfers

- Restore backend and Companion same-provider move implementations.
- Route same-provider copy/move through the new common result and receipt
  handling.
- Remove the universal move availability gate only for proven same-provider
  capability combinations.

Exit criterion: all same-provider file and directory copy/move scenarios pass
against concurrent conflict and retry tests.

### Phase 2: Destination staging sessions

- Implement backend SMB and Companion local destination sessions for files,
  then directories.
- Implement atomic promotion, target policies, cleanup, and durable receipts.

Exit criterion: staged fallback copy remains correct across conflicts,
interruption, retry, cancellation, and destination restart; native operations
are selected only when their semantics meet the common contract.

### Phase 3: Source leases and guarded deletion

- Implement regular-file source sessions, then manifest-backed directory
  sessions for SMB and local providers.
- Implement guarded move commit and the source-retained terminal outcome.

Exit criterion: tests demonstrate that changing, replacing, renaming, or
deleting a source during transfer never deletes an unverified replacement.

### Phase 4: Browser streaming coordinator

- Implement backpressure-aware, resumable browser relay between backend and
  Companion sessions.
- Integrate F5/F6, progress, conflict pause/resume, recovery, and pane refresh.
- Enable only the source/destination capability pairs whose Phase 2 and Phase 3
  checks pass.

Exit criterion: SMB-to-local and local-to-SMB regular-file copy and move work
without full-file browser buffering.

### Phase 5: Recursive directory parity

- Implement manifest creation, staged tree construction, per-entry validation,
  promotion, and guarded source deletion.
- Add batching for multiple roots and clear partial-result reporting.

Exit criterion: every matrix entry supports nested directories, empty
directories, cancellation, conflict, partial destination failure, and safe move
semantics.

### Phase 6: Documentation and release hardening

- Update user and developer documentation to describe the exact supported
  behavior and source-retained move outcome.
- Add telemetry dashboards and operational cleanup monitoring.
- Remove transitional availability checks and obsolete stabilization tests.

Exit criterion: documentation, capability reporting, and runtime behavior agree
for every supported platform and provider pair.

## Test Strategy

### Unit and contract tests

- Transfer state-machine legality, idempotency, token binding, expiry, and
  receipt replay.
- Target policy resolution, staging cleanup, chunk offset/digest checks, and
  factual result validation.
- Source identity checks and guarded-delete rejection on changed source paths.
- Frontend coordinator dispatch, retry, cancellation, progress, and dialog
  behavior.

### Provider integration tests

- SMB-to-SMB, local-to-local, SMB-to-local, and local-to-SMB.
- Files from zero bytes through multi-chunk large files, nested directories,
  empty directories, unicode and reserved names, and many selected roots.
- Destination exists, target changes during operation, source changes during
  read, source changes before move commit, destination provider disconnects,
  browser reloads, duplicate requests, and session expiry.
- Validate that move either removes exactly the original source or reports
  `completed_with_source_retained`; no other source object may be removed.

### End-to-end tests

- F5 and F6 open their dialogs for every available physical provider pair.
- Progress updates without layout regressions and both panes refresh after each
  terminal state.
- Pairing loss, backend session expiry, and Companion restart show actionable
  results without concealing partial mutations.

## Definition of Done

The work is complete only when all physical provider combinations in the matrix
support files and directories for copy and move, excluding archive sources; all
target policies have atomic semantics; no move can delete a source whose
captured identity no longer matches; every operation is idempotent and
recoverable; and automated tests cover the matrix on each supported desktop
platform.
