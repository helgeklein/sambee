# Practical F5/F6 Copy, Move, and Archive-Member Extraction Plan

## Purpose

Restore full copy and move support for physical files and
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

The solution must give users conventional file-manager behavior: copy contents
without buffering entire files in the browser, move by copying then deleting the
original, show useful progress, allow cancellation, and never silently
overwrite a target or leave a partial file under the requested name.

## Current State and Root Cause

The original no-op came from `ContentOperation` and the API layer rejecting
moves and transfers whose source and destination were different backend kinds.
Those gates have been removed for the supported staged paths. Staged copy and
copy-then-delete F6 now work for cross-provider files and directories,
cross-drive local transfers, and cross-SMB directory transfers. A source is
retained only when its deletion fails after the destination is published, and
that partial move is reported to the user.

The browser relay must remain streamed. Reading the source into a `Blob` would
make large transfers consume browser memory and provide no useful cancellation
or progress behavior.

Likewise, treating a selected archive member as a physical source would be
incorrect. An archive member is delivered by an archive reader, not a
filesystem object with an independently deletable source identity.

## Design Decisions

### Browser-relayed staged transfer

When providers cannot transfer directly, the browser relays the source response
body to a destination endpoint. The browser does not buffer a complete file or
assert source/destination facts. The destination endpoint owns a private staging
target and publishes it only after the complete request body is written.

Same-filesystem, same-server, and same-provider operations first use a proven
native rename, move, or server-side copy capability. They use the staged relay
only when the native operation cannot provide the requested conflict policy or
factual outcome.

The destination owns staging and publication. After publication, the
orchestrator deletes the original through the existing source-provider delete
API for a move. If deletion fails, it retains the original and reports that the
copy succeeded but the move did not fully complete.

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
4. for a move only, delete the original through the source provider's normal
  delete API
5. return a factual result to the active request

Promotion before source deletion means a failed physical move can create a valid
destination while preserving its source. This is reported as
`completed_with_source_retained`, with a clear user message, never hidden as a
successful move. Direct destination writes are not used because interrupted
copies expose partial data and can damage an existing target.

Archive extraction applies the same destination collision and publication
guarantees per extracted member where the destination supports them. It does
not make a selected group atomically visible as one tree when its entries merge
with an existing destination; it records factual per-member outcomes instead.

### One transfer result contract

Use `ContentTransferResult` for all copy and move paths. Each request carries
the operation kind, source and destination locations, target policy, progress,
and factual source/destination effects. In-progress browser relays are not
durable operations and do not survive reloads or retries.

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
| SMB | Local | browser-relayed staged stream | browser-relayed staged tree | yes | yes |
| Local | SMB | browser-relayed staged stream | browser-relayed staged tree | yes | yes |

The matrix applies to one or many selected roots. A batch is sequential at the
root level. Each root has its own conflict decision, progress, and terminal
result. If destination publication succeeds but source deletion fails, the
result reports a partial move and leaves both items in place.

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

## Practical Move Safety

Moves use normal copy-then-delete behavior:

1. stage and publish the destination;
2. call the existing delete endpoint on the original source path;
3. report `completed` only when both steps succeed;
4. report `completed_with_source_retained` when destination publication
   succeeded but deletion did not.

No source identity snapshots, retained source handles, leases, or recursive
manifests are required for this feature. A cancelled, failed, or unknown
destination transfer never starts source deletion.

Directories use the same rule: delete the original directory only after the
staged destination tree has been promoted. Shortcut files copy as ordinary
files. Hard links, device files, sockets, ACLs, ownership, and exact timestamp
preservation are outside this feature unless they prevent ordinary file copies.

## Physical Transfer Destination Requirements

Implement staged destination delivery in both the backend SMB API and Companion
API.

- Validate destination access and create a private sibling temporary file or
  directory.
- Stream request bytes with backpressure, then publish the completed staging
  item under the requested name.
- On a failed or cancelled request, remove only its private staging item.
- When the target already exists, return the current structured conflict so the
  existing Target already exists dialog can choose skip or rename. Do not
  introduce a second conflict UI or protocol.

The existing upload endpoints may remain for editor save-back, but must not be
used as the cross-backend transfer protocol because they overwrite a path and
buffer multipart content.

## Transfer Orchestration

### Same-provider operations

Restore same-provider move dispatch first, using provider-native copy/move when
they provide the required target policy and factual outcome. Route through the
common result handling used by cross-provider transfers.

When a provider-native operation cannot meet the target safety contract, use
staged delivery within that provider instead.

### Cross-provider operations

The browser is the authenticated byte relay between the backend origin and the
paired Companion origin. It does not receive filesystem authority.

1. It streams chunks with backpressure from source to destination and never
  calls `response.blob()` or assembles a file in memory.
2. The destination validates and promotes the complete staged root.
3. A move deletes the original only after destination promotion succeeds.
4. A request failure discards unpromoted staging and returns a factual failure
  when known, otherwise `outcome_unknown`; retry starts a new attempt.

For directories, the coordinator creates the destination tree in a private
staging directory, including empty directories, then promotes it after all
children copy. Existing destination roots use the current Target already exists
dialog; this milestone does not merge directory trees.

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

### Browser closure and interruption

A browser-relayed transfer stops when its request is interrupted. Its
destination endpoint discards only unpromoted staging. The UI refreshes both
panes and reports a factual failure when available; otherwise it reports
`outcome_unknown` and requires the user to reconcile and retry manually. It
never automatically deletes a source after an interrupted request.

Archive operations follow their own V2 recovery rules. Backend-owned selected
extractions may remain observable through their durable archive operation, but
a live reader/session interrupted by browser, backend, or Companion loss is not
claimed to be resumable. Recovery displays the recorded aggregate result when
available, otherwise an interrupted or unknown result and refreshes the target.

## API and Type Changes

### Backend and Companion

- Keep transfers under the existing authenticated browse API namespaces.
- Authenticate backend requests as the current user and Companion requests with
  the existing origin-scoped pairing HMAC.
- Add target-resolution support to the existing staged relay endpoints. Return
  the existing structured target conflict before any destination mutation.
- Add cancellation-aware request handling and cleanup for unpromoted staging.
- Use the existing delete endpoints to complete cross-location moves after a
  published destination copy.

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

- Keep physical archive sources unavailable for generic F5/F6 transfers.
- Dispatch F5 and F6 independently, with F6 deleting the source only after
  the destination copy completes.
- Add active-request byte progress and cancellation to the existing copy/move
  dialog. The browser must not buffer a complete file to obtain progress.
- Reuse the current Target already exists dialog and its conflict result. A
  chosen rename restarts the transfer with the chosen name; skip leaves the
  existing target untouched.
- Always refresh source and destination panes after completed, skipped,
  cancelled, partial-move, and unknown results.

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

## Conflict Behavior

- Reuse the current Target already exists dialog for every physical copy/move
  path. There is no new conflict dialog or decision API.
- Skip leaves both paths unchanged. Rename retries with a different target name.
- A directory target conflict follows the same dialog. This milestone does not
  merge an incoming directory into an existing directory.

## Safety and Security Requirements

- Validate every path at the owning provider. Never accept a browser-provided
  absolute path or path traversal sequence.
- Do not expose arbitrary local filesystem paths; retain current drive-boundary
  and pairing rules.
- Ensure cancellation stops the active read/write, cleans staging, and never
  starts source deletion.
- Log source and destination provider kinds plus the terminal result. Never log
  pairing credentials.

## Implementation Phases

### Phase 1: Complete copy-then-delete moves

- Use the existing generic delete API after the staged destination result is
  completed for SMB-to-local, local-to-SMB, local cross-drive, and cross-SMB
  directory moves.
- Return `completed` after a successful delete; return
  `completed_with_source_retained` when the delete fails after destination
  publication.
- Show the retained-source outcome as a warning that names the successful copy,
  then refresh both panes.

Exit criterion: F6 removes ordinary files and directories for every matrix row;
a simulated delete failure visibly leaves both items.

### Phase 2: Route target conflicts through the existing dialog

- Extend staged relay endpoints with the target policy used by the current
  Target already exists dialog.
- Implement skip without a second dialog or decision format.
- Keep rename as a new-name retry through the same dialog.

Exit criterion: every matrix row handles skip and rename without a silent
replacement or a new conflict UI.

### Phase 3: Add progress and cancellation

- Count bytes in the browser's streaming relay and show them in the existing
  copy/move dialog.
- Keep the existing root-count progress for multi-selection batches.
- Enable Cancel during active work and use an `AbortController` to stop the
  source and destination requests.
- Stop the remaining batch after cancellation and report the result plainly.

Exit criterion: a large relay is visibly progressing, can be cancelled, leaves
no requested destination item, and never deletes the source.

### Phase 4: Verify directory and batch behavior

- Confirm staged directory copies preserve nested and empty directories.
- Test move deletion after directory promotion in every cross-location path.
- Exercise multiple selected items, conflicts, partial moves, cancellation,
  and pane refresh.

Exit criterion: normal files and folders behave consistently across all matrix
rows and are understandable when one item in a batch fails.

### Phase 5: Release hardening

- Run browser end-to-end tests against real SMB and Companion endpoints.
- Update user documentation for F5, F6, conflicts, cancellation, and the
  retained-source warning.
- Remove obsolete availability gates and tests that claim moves are unsupported.

Exit criterion: user documentation, available commands, dialogs, and observed
behavior all agree.

## Test Strategy

### Unit and contract tests

- Target policy resolution, staging cleanup, copy-then-delete result handling,
  cancellation, and progress counting.
- Frontend relay dispatch and reuse of the existing Target already exists dialog.

### Provider integration tests

- SMB-to-SMB, local-to-local, SMB-to-local, and local-to-SMB.
- Files from zero bytes through multi-chunk large files, nested and empty
  directories, unicode names, and multiple selected roots.
- Target exists, destination disconnects, browser cancellation, source deletion
  failure, and a fresh manual retry after interruption.

### End-to-end tests

- F5 and F6 open their normal dialogs for every physical provider pair.
- The Target already exists dialog is the only conflict dialog used.
- Progress updates without layout regressions; cancellation, partial moves, and
  unknown outcomes refresh both panes and show actionable results.

## Definition of Done

The work is complete when F5 copies and F6 moves ordinary files and directories
for every matrix row; transfers stream rather than buffer complete files; the
existing Target already exists dialog handles conflicts; and users can see
progress, cancel active work, and understand a partial move. A failed transfer
must not silently overwrite a target, leave a partial requested target, or
delete a source before destination publication.
