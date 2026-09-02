# Incremental Trusted-Source Archive Processing Specification

## Purpose

Implement S1 from `ARCHIVE_SECURITY_MITIGATION_PLAN.md` for ZIP inspection and
extraction. Replace full central-directory collections, complete extraction
manifests, resumable checkpoints, and manifest-gated mixed relays with live,
source-owned processing.

This specification covers ZIP extraction only. ZIP creation remains outside its
scope.

## Decisions

- The backend and Companion are trusted archive executors. The executor that
   holds the ZIP is authoritative for its delivery sequence and ZIP validation.
   The sequence is an opaque live fencing token for one delivery of the current
   record, not that record's archive position or a progress counter.
- The source executor opens the ZIP once and retains that handle until the
  operation reaches a terminal state. The handle remains open while a regular
  collision or retry workflow waits for user input.
- A known central-directory record rejected by source-only validation reaches a
   final aggregate outcome locally. It is never delivered to, acknowledged by,
   or retained for the destination.
- A destination write returns one transient `DestinationWriteResult`. Only the
   ZIP-owning source session accepts it, changes current-member state, and
   updates aggregate counters. The backend persists the terminal aggregate
   result after source completion; neither executor keeps a member receipt.
- The retained handle is an archive-specific pinned reader. SMB and Windows
   source opens deny new writers and delete/rename opens for its lifetime. Unix
   sources retain one descriptor and detect ordinary in-place modification from
   descriptor metadata; they do not claim unavailable mandatory writer denial.
- Extraction writes member bytes directly to the resolved target path. It does
   not stage output in temporary files, reread output for verification, or add a
   separate publication/commit protocol.
- A process restart, executor disconnect, source-handle loss, or source-session
  timeout ends the operation. A new attempt starts at the first ZIP member.
- Each live source session has one serial owner for its reader cursor and
   current member. This is per-operation correctness, not a scheduler,
   admission-control mechanism, or archive-wide concurrency limit.
- No extraction source snapshot, persisted reader cursor, persisted collision
  decision, complete member manifest, or per-member result history is retained.
- A durable extraction operation may record that it is awaiting a decision and
   its revision, but its actionable collision/retry details and decisions exist
   only in the retained live source session.
- The only terminal extraction result is an aggregate summary: member outcome
   counts, extracted bytes, created directories, and replaced files. It does not
   claim an archive-wide total-member count.
- S1 adds no archive-specific scheduler, admission control, concurrency limit,
  capacity policy, or durable resumption mechanism.
- S1 supports one backend service instance. Its canonical production Docker
   command explicitly starts Uvicorn with `--workers 1`; this live-session
   launch contract does not limit normal async concurrency across operations.
   Manual worker or replica overrides are unsupported. S1 does not add topology
   configuration, runtime detection, routing, or recovery for them.
- Inspection returns bounded, record-order pages. It does not provide global
  sorting, exact full-archive totals, virtual directory indexing, or global
  duplicate resolution.

## Security Invariants

- ZIP bytes, archive names, relay payloads, browser requests, and output paths
  are untrusted.
- Before transfer, the source validates ZIP offsets and lengths, filename
   decoding, normalized safe-relative path, file type, local header, and codec.
   It validates declared uncompressed size and CRC while streaming the member.
- The destination validates the scoped operation capability, immutable source
  and destination roots, normalized target path, collision policy, cancellation
  state, and the destination write itself.
- The source never reopens an archive by path after its pinned reader is
   created. A source open that cannot obtain its required platform semantics
   fails the operation; it must not silently use a less restrictive alternative.
- S1 extraction obtains archive bytes only through an explicit pinned-reader
   capability. It must not call a general-purpose random-access reader with an
   optional flag or fallback behavior.
- A destination must never write outside the selected root. S2's rooted,
  no-follow destination operations remain required.
- A member may advance only after it has a final result and the destination is
  safe to continue. A collision awaiting input and a retryable partial write
  retain the current member and source handle.
- A payload-integrity failure discovered at the end of a direct target write is
  a partial-output member failure. The existing retry/ignore workflow handles
  the target; the operation must not report that member as completed or advance
  the reader before that workflow reaches a final result.
- A clean transport EOF is not a successful extraction result. The source alone
   accepts or rejects a destination member result after its stream validator
   completes; no relay trailer, terminal frame, or output reread is required.
- A destination result is transient and cannot advance a reader, update a source
   aggregate, or become durable member state until the owning source session
   accepts it for its current delivery sequence.
- Only the live source session's current record may change aggregate counters
   or reader position. When accepting a destination result, the current
   source-session ID and delivery sequence are also required. A source-only final
   outcome has no delivery sequence. A stale, duplicate, or concurrent delivery
   request must not apply a result to another member or delivery attempt.
- A live backend-owned source session must never be routed to another backend
   process or replica. S1 relies on the canonical single-instance launch
   contract rather than sticky routing or cross-process session reconstruction.
- A damaged central-directory record with an unknown next boundary ends the
  operation. Do not search arbitrary bytes for another ZIP signature.

## Runtime Model

Each active extraction owns exactly one source session:

```text
source archive handle
   + platform-specific source pin
  + forward central-directory reader
   + current member, delivery sequence, and pending decision, if any
   + live effective collision policy
  + aggregate counters
  + cancellation state
  + terminal/awaiting-decision state
```

The source session is in-memory execution state. It is not reconstructed from
`ArchiveOperation.checkpoint_json`, Companion session storage, or a relay
request. Its normal loop is:

```text
open source archive once
while active:
    entry = next_entry()
   validate entry for safe extraction
   if validation is a final source-only rejection:
      finalize_source_outcome(entry, skipped or failed)
      continue
   direct-stream this entry to its resolved destination target
   result = receive DestinationWriteResult
   apply_destination_write_result(result)
   if the source session returned to READY:
      continue
   if the source session awaits a decision:
      await the normal decision workflow
   otherwise:
      end operation
source reports terminal aggregate result to backend
close source archive handle
```

The operation lifecycle may remain durable for ownership, cancellation,
user-visible phase, error reporting, and final aggregate result. It must not be
used to recreate an interrupted source session.

`finalize_source_outcome()` is the shared source-session transition for a known
current record that reaches a final outcome without a destination interaction.
It is valid only after `next_entry()` has completely parsed that record and
established its next central-directory boundary. Under the session lock, it
updates exactly one aggregate member outcome and `members_processed` using the
same checked aggregate-update primitive as an accepted final destination result,
clears the temporary current record, and returns to `READY`. It does not assign
or consume a delivery sequence, make a destination request, create a pending
decision, or persist member state. `next_member` may then obtain the next
record. A parse failure whose record identity or next boundary is unknown must
terminalize the operation without calling this transition or inventing a member
outcome.

`DestinationWriteResult` is the existing destination-write response normalized
to carry the source-session ID, echoed delivery sequence, one destination
outcome (`completed`, `skipped`, `awaiting collision`, `awaiting retry/ignore`,
or `fatal`), and only bounded details needed for the current decision or
physical aggregate counters. It is not a source-integrity assertion, a receipt,
or durable state. Do not add an endpoint, acknowledgement round trip, replay
key, result ledger, or receipt store for it.

`fatal` is a confirmed final failure of the known current member. The destination
must not use it when the direct-write outcome is uncertain. A timeout,
disconnect, interrupted body, malformed response, or lost response is instead
`destination_outcome_unknown`: it produces no accepted
`DestinationWriteResult`, leaves the current member uncounted, and terminalizes
the operation because direct target bytes may exist.

`apply_destination_write_result()` is the sole source-session transition that
accepts this response. Under the source-session lock, it verifies the session
ID, delivery sequence, phase, and source stream validation state. It then uses
the shared final aggregate update and clears the current record for `completed`
or `skipped`, retains the current record and enters the existing live decision
state for an awaiting-decision result, or increments `members_failed` and
`members_processed`, clears the current record, and terminalizes for an accepted
`fatal` result. The destination does not mutate source-session state or aggregate
counters, retain delivery state, or persist a per-member result. A stale,
duplicate, or otherwise invalid result is rejected without changing the current
record or aggregate counters. A transport failure with no valid
`DestinationWriteResult` never calls this transition.

The backend is the only durable operation owner. A backend-held ZIP source
persists its own terminal aggregate result locally after end-of-directory. A
Companion-held ZIP source submits that aggregate through the existing completion
command after end-of-directory, and the backend persists it. A destination
never persists an extraction completion merely because it wrote a member.

The destination writes directly to its final target while it receives member
bytes. Source size and CRC checks complete as the stream ends. On a clean stream
completion, the source moves the current member to `AWAITING_RESULT`; only then
may it accept the destination's `DestinationWriteResult`. If the stream aborts or
the source detects a final integrity failure, it rejects a completed result and
uses the existing partial-output workflow to retain the current member and
source handle for retry or ignore. It does not reread, stage, atomically publish
the output, or send a separate terminal stream frame.

### Pinned Source Handle

Use one archive-specific pinned reader open path, rather than a general locking
framework. The pin is live state bound to the retained reader/handle and is
never stored in a checkpoint or used to resume an operation.

The backend extraction source contract declares only this archive-specific
operation in addition to source metadata lookup:

```text
open_archive_source_reader(path) -> pinned RandomAccessReader
```

It has no `pinned` boolean parameter and no default implementation. The S1
source session and direct backend extraction call this method exclusively. A
source that does not implement it fails with a typed source-unavailable error
before ZIP parsing or output writes begin.

- For an SMB archive source, open the existing operation-scoped reader with
   `share_access="r"`, rather than the current permissive `"rwd"`. This permits
   concurrent readers while denying new SMB write, delete, and rename opens for
   the handle lifetime. If the server rejects that share mode, fail the operation
   with a clear source-unavailable error; do not fall back to `"rwd"`.
- For a local Windows archive source, open the retained `FsFile` with read
   sharing only (`FILE_SHARE_READ`), denying new write and delete opens for the
   session lifetime. Use the platform `OpenOptionsExt` API in the archive reader;
   do not add a cross-platform lock service.
- For a local Unix archive source, one open descriptor pins the original inode
   across rename or unlink but cannot portably forbid an unrelated writer from
   modifying that inode. Capture descriptor metadata (`device`, inode, size,
   modification time, and change time) at open, then compare it before each
   member and after every stream. A difference ends the operation as
   source-changed.
- Do not add advisory Unix file locking. It is cooperative, can introduce
   avoidable compatibility failures, and cannot provide the mandatory protection
   that this design would otherwise imply.

The Unix metadata comparison detects ordinary concurrent modifications but is
not a cryptographic immutability guarantee against a writer that can alter an
already-open inode while preserving all observed metadata. Stronger protection
would require filesystem-specific mandatory controls or a source copy, both
outside this direct, retained-handle design. Treat any read error, metadata
change, or final stream-integrity failure as source failure; do not reopen by
path, restart, or resume.

### Aggregate Result Contract

Extraction exposes these checked, non-negative aggregate counters:

```text
members_processed
members_completed
members_skipped
members_failed
files_extracted
directories_created
extracted_bytes
files_replaced
```

They satisfy:

$$
members\_processed = members\_completed + members\_skipped + members\_failed
$$

`members_completed` counts one known central-directory record that completed as
an archive directory or extracted file. `members_skipped` counts one known
record that was skipped by policy, unsupported-member handling, or explicit
ignore. `members_failed` counts one known record whose failure is final, whether
the reader can later continue or the operation then terminates. Do not change an
outcome count while a member is awaiting retry or collision input.

`files_extracted`, `directories_created`, `extracted_bytes`, and
`files_replaced` are secondary physical-result facts. In particular,
`directories_created` includes implicit parent creation and therefore must not
be used to infer `members_completed`.

A malformed central-directory record whose boundary or identity cannot be known
has no member outcome and does not increment these counters. Do not expose
`total_members` in S1. If a later UI needs a denominator, add a separately named
optional `declared_member_count` from EOCD/ZIP64 metadata; it must never control
completion, validation, or safety decisions.

### Live Session Serialization

Use one in-memory `LiveSourceSession` per operation, protected by a per-session
async lock (`asyncio.Lock` in the backend and `tokio::sync::Mutex` in
Companion). A registry lock may locate the session, but it must not be held for
archive, network, or destination I/O. This is the complete S1 coordination
mechanism; do not add a scheduler, queue, distributed lock, or worker pool.

The live source session contains only the retained reader/handle, phase, current
entry, monotonically increasing delivery sequence, aggregate counters,
cancellation flag, pending user decision, live effective collision policy, and
no idempotency, replay, or receipt state. Do not introduce a replay registry,
database table, checkpoint field, or durable delivery ledger.

A pending decision contains its own monotonically increasing decision revision,
kind, current member/target details, and bounded error details when applicable.
It is bounded live state, not member history.

Use these states for extraction:

```text
READY
   -> CURRENT(no delivery sequence, source-only rejected record)
   -> READY

READY
   -> CURRENT(delivery_sequence=N, directory)
   -> AWAITING_RESULT
   -> READY | AWAITING_DECISION | TERMINAL

AWAITING_DECISION
   -> CURRENT(delivery_sequence=N+1, directory)
   -> AWAITING_RESULT

READY
   -> CURRENT(delivery_sequence=N, regular file)
   -> STREAMING_CURRENT
   -> AWAITING_RESULT
   -> READY | AWAITING_DECISION | TERMINAL

AWAITING_DECISION
   -> CURRENT(delivery_sequence=N+1, regular file)
   -> STREAMING_CURRENT
   -> AWAITING_RESULT
```

`next_member` is the only transition that calls the reader's `next_entry()`.
It is accepted only in `READY`. It temporarily installs a fully parsed record
for source validation. For a source-only final rejection, it calls
`finalize_source_outcome()` and continues to the next record without assigning a
delivery sequence or returning a destination-facing member. Otherwise, it
assigns the record's first delivery sequence and returns metadata or bytes. A
source resolving a collision or retryable partial-output decision may instead
redeliver the retained current entry. That transition must not call
`next_entry()`: it increments the delivery sequence and returns the same entry
under the new sequence. A request while another member is streaming or awaiting
a decision is rejected as an invalid operation state.

For a regular-file response, set `STREAMING_CURRENT` before the first byte is
sent. The stream producer has exclusive use of the reader until it reaches EOF
and validates size and CRC. It then changes to `AWAITING_RESULT`. No completion
result is accepted before that change. Do not create a generalized stream-lease
framework, terminal relay frame, or HTTP-trailer protocol: this phase and the
ordinary `DestinationWriteResult` acknowledgement are sufficient. Cancellation
uses the existing atomic cancellation flag, which the bounded stream loop checks between chunks
without waiting on the session lock.

`record_result` must include the live source-session ID and current delivery
sequence. A user decision must additionally include the delivery sequence and
live decision revision returned by the status endpoint. Under the per-session
lock, reject a wrong session ID, delivery sequence, decision revision, illegal
phase, or terminal session. The source-session lock serializes concurrent result
requests: after one accepted final result changes state, any later result for the
same delivery fails the phase or delivery-sequence check.

`record_result` receives the transient `DestinationWriteResult` and delegates
to `apply_destination_write_result()`; it must not update counters or reader
state through an independent destination-owned path. A known current-member
`fatal` result records `members_failed` before the session terminalizes. An
unknown destination outcome is not a result request and terminalizes without an
invented member outcome.

A completed file result is valid only in `AWAITING_RESULT`, after the source
validator reached clean EOF. A final accepted result updates aggregate counters,
clears the current entry, and returns to `READY` in one transition. It does not
retain a prior result response. A caller that loses this response must obtain live
status or request the next member; it must not resend the result. Only a
collision or retryable partial-output result enters `AWAITING_DECISION` and
retains the current entry.

The write request/response is the existing two-stage acknowledgement boundary.
For a Companion source streaming to SMB, the backend writes the request body
directly to its target but treats its HTTP response only as a destination write
result; the Companion accepts that result only after its local stream validator
succeeds.
For an SMB source streaming to Companion, the Companion treats clean response
EOF only as evidence that the backend source stream ended. Once its local writer
has a known outcome, the Companion returns a `DestinationWriteResult`; the
backend accepts that result only after its response generator completes size/CRC
validation. EOF alone cannot change counters, clear the current record, or
advance the reader.
Neither direction needs to place integrity status inside the payload stream.

On entering `AWAITING_DECISION`, persist only the operation phase and durable
revision. For extraction, always clear and leave
`ArchiveOperation.pending_decision_json` unset. Expose the actionable pending
decision through the owning executor's live-session status response. This lets a
browser refresh recover the prompt while the source session remains alive, but
an expired or lost session exposes no recoverable decision.

Apply `skip`, `replace`, `rename`, `retry`, and `ignore` only to the current
member held by the live session. Apply `skip_all`, `replace_all`, and
`replace_older` by changing the one live effective collision-policy scalar for
the remaining session. Do not write collision-action maps, rename maps, retry
sets, ignored-member sets, or a decision payload to an extraction checkpoint or
operation. The initial collision policy selected when the operation is prepared
may remain immutable durable operation configuration. A decision that writes the
current member again must start a new delivery sequence before the write. A
decision that skips or ignores it records its final member outcome without
creating another delivery.

Cancellation, source/relay failure, or expiry immediately fences the session
from new transitions and requests cancellation through its atomic flag. The
active stream exits at its next chunk boundary, after which cleanup closes the
reader and removes the session. Requests after the terminal fence return
`operation_unavailable`; they must not recreate the session.

The backend source-session registry is process-local because it owns a live SMB
handle. S1 supports one backend service instance for every backend archive
endpoint: begin, next member, destination write, result acknowledgement, status,
decision, cancellation, and completion. The canonical production Docker command
is the source of truth and explicitly starts one Uvicorn worker with
`--workers 1`. Do not use sticky routing, a shared session store, a distributed
lock, a replacement-reader fallback, topology configuration, or runtime worker
or replica detection.

This launch contract is an ownership requirement, not an archive scheduler or
concurrency limit. The one process may run concurrent operations under the
normal application, operating system, SMB, and storage backpressure behavior.
A server restart or replacement loses live sessions and terminalizes their
operations as already specified. A worker or replica override is unsupported;
S1 does not detect, repair, or coordinate that topology. Multi-instance archive
execution requires a separately designed, deployed, and tested affinity
architecture.

## ZIP Reader Contract

### Common Requirements

Implement equivalent forward-only readers in Python and Rust. Their APIs may
use local naming, but must have these semantics:

```text
open_archive(handle) -> reader
next_entry() -> entry | end-of-directory | format error
validate_entry(entry) -> validated entry | member error
stream_validated_entry(validated entry) -> bounded byte stream | member error
```

- Initialization reads and validates EOCD/ZIP64 directory metadata once.
- `open_archive(handle)` receives a pinned handle. All metadata validation and
   payload streaming use that handle or a safe duplicate of it, never a new open
   by archive path.
- The Python S1 extraction source protocol exposes
   `open_archive_source_reader(path)`, not `open_random_access_reader(path)`.
   The latter remains a general-purpose API and must not appear in a new
   extraction source-session path.
- `next_entry()` holds only the fixed central-directory record, its bounded
  variable portion, and a bounded refill buffer. It validates that each record
  ends within the declared central-directory range before returning it.
- It advances only after the caller has reached a terminal outcome for the
  current record. Its internal position need not be serializable.
- `ZipEntry` and `LocalArchiveReadEntry` retain the raw name, flags, offsets,
  and attributes required to validate and stream that same record.
- A returned entry is valid only for the reader and source handle that produced
   it. Keep the existing reader-identity checks in Python and equivalent
   ownership in Rust.
- Directory entries require no payload stream. Regular entries are checked for
  safe path and supported file type before a destination request.
- An unsafe path, unsupported special type, encryption, or unsupported codec
   for a fully parsed record is a source-only final rejection. The source calls
   `finalize_source_outcome()` with the existing `failed` or `skipped` policy,
   then obtains the next record without a destination request or delivery
   sequence. It does not substitute an older duplicate.
- A malformed record whose identity or next boundary cannot be established is
   a terminal parser failure, not a source-only final rejection.

### Deliberate Compatibility Change

Do not build `EffectiveArchiveEntries`, `EffectiveLocalArchiveEntries`,
`ArchiveInspectionManifest`, or any last-wins/global directory projection in
the S1 execution path. Process central-directory records in their original
order.

Global duplicate resolution, inferred directory indexes, globally sorted views,
and archive-wide exact totals require global state. They are outside S1.

## Backend Changes

### `backend/app/services/archive/zip_reader.py`

1. Introduce a `ZipReader` initialization step that reads `_directory()` and
   returns a live forward reader bound to the caller's `RandomAccessReader`.
   It owns directory offset, end offset, remaining entry count, position, and
   the existing bounded byte buffer.
2. Add `next_entry()` to parse exactly one central-directory entry. Reuse the
   current logic in `entries()` for checked arithmetic, record signature,
   variable-length validation, ZIP64 fields, name decoding, path normalization,
   and file-type detection.
3. Make `entries()`, `effective_entries()`, and `inspection_manifest()` legacy
   compatibility APIs only during migration. New inspection and extraction
   paths must not call them. Remove their cached full collections after callers
   are migrated and tests no longer require them.
4. Keep `_validate_entry()` and `stream_validated_entry()` as the local-header
   and payload validators. They must operate on the entry returned by the live
   reader, not on a member reconstructed from path or manifest metadata.
5. Ensure `stream_validated_entry()` continues to use bounded
   `_ARCHIVE_IO_CHUNK_BYTES` reads and detects declared-size and CRC mismatch.
   On a final streaming validation failure, raise the existing member error so
   the direct target writer enters its partial-output retry/ignore workflow;
   never move the member to `AWAITING_RESULT`, accept a completed destination
   result, or advance the reader. S4 will additionally require exact
   compressed-payload consumption.
6. Add a record-order inspection DTO builder that maps only the current
   `ZipEntry` into a listing item. It must not retain earlier items.
7. Change every direct backend extraction entry point to require an
   `ArchiveExtractionSource` that implements
   `open_archive_source_reader(path)`. Do not broaden `StorageBackend` with
   this archive-only method; update only S1 extraction adapters and their test
   fakes.

### `backend/app/storage/smb.py`

1. Add an archive-source pinned-reader open method, used only by the S1 source
   session. Reuse `_SMBRandomAccessReader` and its pooled connection lease, but
   open the source with `share_access="r"`. Name it
   `open_archive_source_reader()` to implement the explicit extraction source
   contract.
2. Keep the existing permissive `open_random_access_reader()` behavior for
   unrelated browsing, viewing, and legacy callers during migration. Do not
   weaken the archive-source open mode to preserve those callers, and do not
   add a `pinned` option to this general-purpose method.
3. Propagate an unavailable restrictive SMB open as a bounded source-open
   failure. Log the archive path and server error without exposing credentials.

### Backend Inspection API

1. Replace manifest-backed directory listing with a record-order page endpoint
   that parses at most the requested page plus bounded parser state.
2. A listing cursor identifies a central-directory position and is scoped to
   one listing request/session. Validate cursor shape and bounds before use.
3. Return `entries` and `next_cursor`; omit archive-wide `total` and global
   directory presentation. The UI consumes appended record-order pages.
4. Inspection requests may reopen the archive for each independent page. Their
   cursor is a listing continuation, not extraction-resume state. If the source
   changes between requests, the request may fail or return a new listing; it
   must never be used to resume extraction.

### `backend/app/services/archive/coordinator.py`

1. Remove extraction execution's dependency on `ArchiveExtractionManifest`,
   `ArchiveExtractionManifestMember`, and
   `ArchiveExtractionExecutionPlan.member()`. No destination write is
   authorized by lookup in a complete member list.
2. Replace `ArchiveExtractionState` and `ArchiveExtractionExecutionPlan` with
   a small destination-decision view. It may read operation-level collision
   policy selected at preparation and the live pending-decision state, but it
   contains no member list, completed-member set, source snapshot, or persisted
   per-member decision.
   Add a process-local source-session registry whose entries own the retained
   pinned SMB reader and implement the `READY`/`CURRENT`/`STREAMING_CURRENT`/
   `AWAITING_RESULT`/`AWAITING_DECISION` state transitions above. Guard each
   entry with one per-session async lock; never hold the registry lock during
   I/O. This registry is valid only under the S1 single-instance launch
   contract; do not make it shared across workers.
3. Replace `record_extraction_member_outcome()` and
   `persist_extraction_member_outcome()` with an aggregate update operation.
   It accepts one final known-member result and increments exactly one of
   `members_completed`, `members_skipped`, or `members_failed`, then increments
   `members_processed` in the same checked transition. It separately updates
   physical counters as applicable and does not store member path, target path,
   or an outcome object.
   Implement `LiveSourceSession.finalize_source_outcome()` on top of this same
   primitive for known pre-transfer validation rejections. It clears the
   temporary current record and returns to `READY` without allocating a delivery
   sequence, contacting a destination, or creating a decision state.
   Add `apply_destination_write_result()` as the only live-session caller for a
   destination final result. It verifies the live session ID and sequence,
   delegates accepted final outcomes to the same aggregate primitive, and never
   stores a destination result or receipt.
4. Replace `extraction_outcome_summary()` with an accessor that validates and
   returns already-accumulated counters. It must not derive totals by iterating
   a ledger.
5. Keep `pause_for_collision()` and `pause_for_member_error()` as ordinary
   operation transitions, but make them set only phase and durable revision for
   extraction. The pending decision, current-member target, retry error, and
   evolving collision policy belong exclusively to the live source session; no
   decision is valid after source-session loss. Do not call the legacy
   `apply_existing_file_decision()` extraction path, which reads and writes
   checkpoint decisions and `pending_decision_json`.
6. Remove `completed_extraction_member_paths()`, terminal-coverage checks, and
   all manifest-comparison completion checks. Completion means the live source
   reader reached end-of-directory with no current member.
7. Do not change creation manifest/outcome behavior in this implementation.

### `backend/app/services/archive/v2_checkpoint.py`

Replace the extraction checkpoint schema. The extraction-specific V2 envelope
must contain only bounded operation metadata needed while a live operation is
active, plus aggregate counters if they are exposed before terminal completion:

```json
{
  "version": 2,
  "aggregate_counters": {
      "members_processed": 0,
      "members_completed": 0,
      "members_skipped": 0,
      "members_failed": 0,
    "files_extracted": 0,
    "directories_created": 0,
    "extracted_bytes": 0,
    "files_replaced": 0
  }
}
```

1. Remove `manifest`, `source_snapshot`, `member_outcomes`, `decisions`,
   `pending_decision`, and `delivery_ids` from extraction checkpoint validation
   and constructors. The immutable initial collision policy may remain in the
   operation's prepared configuration. Pending decisions, live policy changes,
   and all replay state are outside the checkpoint and operation fields.
2. Validate every counter as a non-negative integer and use checked addition.
   Reject unknown checkpoint fields, including the ambiguous legacy
   `total_members`, `files_skipped`, and `files_failed` fields. Enforce the
   member-outcome arithmetic invariant whenever counters are read or updated.
3. Existing V2 extraction checkpoints are not migrated. On first access after
   deployment, terminate the old operation with a clear incompatible-operation
   error and require a new extraction. This matches the no-resume decision and
   avoids converting untrusted, unbounded legacy ledgers.
4. Do not change the V2 creation checkpoint schema under S1.

### `backend/app/api/archive_operations.py`

1. Remove `manifest_hash` from extraction capability claims and from
   `_get_scoped_companion_operation_from_claims()` extraction comparisons. Keep
   user, token version, purpose, operation ID, contract version, source root,
   and destination root bindings.
2. Remove `_companion_extraction_manifest_response()`,
   `_companion_extraction_manifest()`, `_local_manifest_source_snapshot()`,
   `_archive_source_identity()` extraction use, and
   `_validate_smb_to_local_manifest()` from the new relay flow.
3. Replace `begin_companion_archive_extraction()` and
   `begin_companion_local_archive_extraction()` with a source-session begin:
   it opens the source archive once, creates and registers an in-memory source
   session with a fresh opaque source-session ID and pinned source reader,
   initializes aggregate
   counters, and moves the operation to `STREAMING`. It returns operation
   metadata only, not a member manifest. Every backend-owned source begin and
   `next-member` stream must obtain that reader through
   `open_archive_source_reader()`; never call `open_random_access_reader()` as
   an S1 fallback.
4. Replace `stream_companion_local_archive_member(member_path)` with a
   source-owned `next-member` action. It returns the next validated member's
   metadata and, for a regular file, its stream. The caller cannot select an
   arbitrary member path. After a source-owned collision or retry decision, the
   same source action redelivers the retained member under a new delivery
   sequence rather than calling `next_entry()`.
   A known source-only rejected record is finalized internally and is never
   returned by this action as a destination-facing member.
5. Replace `write_companion_archive_member(member_path, ...)` with a write
   action that receives the source executor's current member metadata and body.
   It validates the scoped destination and path but performs no complete
   manifest lookup.
6. Make the destination reply with one of: completed, skipped, awaiting
   collision, awaiting retry/ignore, or fatal. The source session alone decides
   whether to discard the entry and request the next one.
   Destination writes remain direct to the final target. A stream that fails its
   final source size or CRC check is returned as the existing partial-output
   error, not as a successful destination write.
   Reuse the existing member write response and completion acknowledgement as
   the source-validation gate; do not add a terminal relay frame, HTTP trailer,
   or output verification request.
   Normalize that response as the transient `DestinationWriteResult`: it echoes
   the source-session ID and delivery sequence and contains only the bounded
   current-member outcome details. The destination does not update source
   aggregates, advance the reader, or retain the result.
   Define `fatal` as a confirmed known-member failure: the source records that
   member as failed before terminalizing. A lost, malformed, or otherwise
   uncertain destination response is `destination_outcome_unknown`, not `fatal`,
   and terminalizes without inventing a member outcome.
7. Do not add idempotency keys, replay detection, payload digests, or response
   receipts to S1 extraction commands. The source session assigns and checks the
   current delivery sequence for result correlation. A write response is a
   destination write result, not a source-integrity assertion. The source
   accepts it only after its own stream validation and current-member state allow
   that result. A lost destination-write response terminalizes the operation
   rather than causing a repeated write request.
8. `complete_v2_companion_relay_extraction()` must accept completion only from
   the source session after it has reached end-of-directory. The backend
   persists the aggregate result and the source closes its handle. A destination
   member write is never a completion persistence trigger.
9. On cancellation, fatal member failure, relay transport failure, source
   session timeout, or handle close, fail/cancel the operation and close the
   source handle. Do not reopen, revalidate a snapshot, or continue from a
   checkpoint.
10. Add a scoped live-extraction status response for the source owner. It
   returns the live source-session ID, phase, aggregate progress, and, only
   while awaiting a decision, the current decision details and decision
   revision. Resolve the decision endpoint through this session; do not read
   `pending_decision_json` or a checkpoint to rebuild a prompt.
11. Document the S1 backend launch contract in the canonical production Docker
   command: one explicit Uvicorn worker (`--workers 1`) and one supported backend
   service instance. Add a release-time static check for that command. Do not
   add topology settings, runtime worker or replica detection, endpoint gating,
   sticky routing, or coordination for manual overrides; those are unsupported.

## Companion Changes

### `companion/src-tauri/src/server/archive.rs`

1. Replace `read_local_archive_entries()` as the execution primitive with a
   `LocalArchiveReader::open_pinned(archive_path)` constructor that owns one
   `FsFile`, archive size, central-directory bounds, current offset, remaining
   count, bounded parse buffer, and any platform-specific live source pin.
   This is the only constructor used for local S1 extraction and relay-source
   paths; do not offer an ordinary-path fallback for them.
2. Move the existing EOCD, ZIP64, record-length, filename, path, file-type, and
   offset checks into initialization and `next_entry()`. Return one
   `LocalArchiveReadEntry` per call.
3. Change `validate_local_archive_entry()` to receive the retained reader/file
   handle or a safe duplicate of that same open handle. It must not reopen the
   archive by path. `ValidatedLocalArchiveEntry` remains bound to that handle.
   On Windows, the reader open uses read sharing only. On Unix, retain the
   descriptor metadata captured at open and compare it before each member and
   after each stream; a change ends the operation as source-changed. Do not add
   advisory locking or reopen the source path to compare metadata.
4. Change direct local extraction to create its source reader once, consume
   entries forward, and retain its `LocalArchiveExtractionSession` while
   `AwaitingCollision` or `AwaitingMemberError` is active.
   Add the same private `finalize_source_outcome()` transition used by the
   backend session for known pre-transfer validation rejections. It uses the
   shared aggregate update, clears the current record, and continues traversal
   without assigning a delivery sequence or invoking local target resolution.
5. Remove execution-path use of `EffectiveLocalArchiveEntries`,
   `ArchiveExtractionManifest`, `LocalArchiveExtractionCheckpoint` member
   ledgers, `LocalArchiveSourceIdentity`, and
   `LocalArchiveExtractionExecutionPlan`. Retain these only temporarily for
   creation or explicitly unsupported legacy paths, then delete them.
6. Replace `validate_local_archive_extraction()` with start-of-operation source
   reader creation. It must not preflight every member or hold a `Vec` of all
   entries before writing the first one.
7. Replace per-member checkpoint recording with checked updates to
   `LocalArchiveExtractionResult`: `members_processed`, completed, skipped, and
   failed member counts plus the physical-result counters above. Preserve direct
   writes to the output target and the existing partial-output retry/ignore path
   when a final source stream validation fails. The final response contains
   aggregate counts only. The source must not send or accept the existing
   completed-member acknowledgement until its local stream validator succeeds.

### `companion/src-tauri/src/server/archive_sessions.rs`

1. Replace `extraction_plan` and `extraction_checkpoint` in `ArchiveSession`
   with one non-serializable live extraction session that owns the archive
   reader/handle, current member, aggregate progress, destination state, and
   pending user decision.
2. Store a pending collision or retry decision only while that session exists.
   The session keeps the archive handle open; it does not serialize the reader
   position. Add the shared source-session state machine and use its existing
   per-session `tokio::sync::Mutex` to serialize reader/current-member changes.
   Keep the decision revision, current-only rename/retry choice, and any
   `*_all` policy change in that session; do not write them to a local checkpoint
   or backend operation payload.
   For a Companion-held ZIP, keep a transient `DestinationWriteResult` only for
   the duration of its locked source-session acceptance transition. Do not let
   the SMB destination response update aggregate counters directly or survive
   as a receipt.
3. On `ARCHIVE_SESSION_TIMEOUT`, session removal, app shutdown, handle error,
   or relay disconnect, close the handle and transition the operation to a
   terminal interrupted/failed state. A later request must create a new
   execution ID.
4. Remove unqualified archive total-member and total-byte reporting for
   extraction. Report outcome-based aggregate progress only; do not add a
   declared-member denominator in S1.
5. Retain revision checks for a live collision decision so stale browser
   decisions cannot be applied to a newer current member.

### `companion/src-tauri/src/server/handlers.rs`

1. In `start_v2_local_archive_execution`, do not call
   `validate_local_archive_extraction()` or construct
   `ArchiveExtractionManifest` before creating the session. Open the local ZIP
   and start the live extraction session instead.
2. Update `CompanionArchiveExtractionCoordinator::direct_local_from_session()`
   and its decision path to resume the retained session object after a user
   decision, not re-enter `extract_local_archive_with_checkpoint_and_progress`.
3. Replace `execute_relay_extraction_from_local_source()` preflight of
   `Vec<LocalArchiveReadEntry>` and `prepare_local_archive_extraction_relay_binding()`
   with opening one retained local source reader. The relay sends the current
   member to SMB and waits for its result before `next_entry()`. A retry or
   collision decision resends the retained member with a new delivery sequence
   and does not advance the reader.
4. Replace `prepare_smb_archive_extraction_relay_binding()` and
   `extract_smb_archive_manifest_to_local()` with a source-driven client loop:
   request the backend's next member, create/write it locally, report the
   result, then request the next member. Do not deserialize an
   `ArchiveRelayManifest` or `ArchiveExtractionRelayExecutionPlan`.
5. Keep target path normalization, target-resolution policy, collision UI,
   cancellation checks, and S2-compatible no-follow write operations. Remove
   only membership validation and full-manifest restart logic.

## Mixed Relay Protocol

The protocol is symmetric. The executor holding the ZIP drives it; the other
executor is a scoped destination writer.

### Source-Owned Member Exchange

1. Source begins the relay and retains its archive handle.
2. Source obtains `next_entry()` and validates the current member.
   A known source-only rejected record is finalized locally, then the source
   obtains the next record; it is not an exchange.
3. For a directory, source sends metadata and waits for the destination result.
   For a regular file, source sends metadata and a bounded stream from the
   validated entry directly to the destination target.
4. Destination validates operation scope and target path, resolves the normal
   collision policy, writes the member directly to its final target, and returns
   a transient `DestinationWriteResult`. It echoes the source-session ID and
   delivery sequence but does not advance the reader, update source aggregates,
   or retain delivery state. A clean payload EOF is not itself a completed
   extraction result.
5. After its stream validator reaches clean EOF, source accepts the
   `DestinationWriteResult` through `apply_destination_write_result()`. It alone
   applies aggregate counters, discards the entry after an accepted final
   outcome, and calls `next_entry()` only when continuation is safe. The update
   follows the aggregate result contract and cannot be inferred from
   created-directory counts.
6. At end-of-directory, source sends its aggregate result through the existing
   completion command. The backend persists the terminal operation result in
   both relay directions.

### Required Message Properties

Every member exchange includes:

- operation ID and short-lived scoped capability;
   this capability is executor-only and is never exposed to a browser client;
- a source-session identifier and monotonically increasing delivery sequence;
   this opaque token identifies one delivery of the current record, not its
   archive-record position;
- normalized relative member path and `is_directory` flag;
- source modification time only when collision policy needs it;
- the existing request/response boundary for one transient
   `DestinationWriteResult` or non-success result.

Regular-file payloads remain raw streamed bytes. Do not introduce a relay
envelope, terminal payload frame, HTTP trailer, or second output-validation
request. Source-side size/CRC validation must complete before the source accepts
a completed result: the source session's `AWAITING_RESULT` state is the required
integrity gate.

An extraction decision request includes the live source-session ID, current
delivery sequence, and live decision revision. Its status response returns the
same values with the collision or retry details. These are live executor data,
not persisted relay or operation fields.

The destination validates the executor-only capability, path, and operation
scope, then returns a transient `DestinationWriteResult` that echoes the
supplied session ID and delivery sequence. It does not retain delivery state,
advance source state, update source aggregates, persist a member result, or
accept browser-originated write commands. The source rejects a result whose
session ID or delivery sequence is not current, or any completed result before a
regular-member source session reached `AWAITING_RESULT`. After a redelivery or
final transition, an old result is stale. No endpoint replays a destination
write or result acknowledgement. The destination does not check a manifest hash
or complete member list.

### Failure Rules

- The source parser detects malformed ZIP metadata or payload integrity
  failures. It records the appropriate aggregate member result only when the
  next record boundary is known and continuation is safe.
- A known pre-transfer validation rejection is finalized by the source session
   through `finalize_source_outcome()`. It makes no destination request, consumes
   no delivery sequence, and may continue with the following record. A malformed
   record with an unknown boundary remains terminal and has no member outcome.
- A source payload-integrity failure after the destination accepted bytes is a
   partial-output error. Leave the direct target in the existing retry/ignore
   workflow; do not reread it, move it through a temporary path, or count the
   member as completed. Reject a completed destination result with a typed
   source-validation-failed response; do not add an in-stream integrity frame.
- An interrupted destination write or lost destination-write response is a
   terminal transport failure. Do not replay the member because direct target
   bytes may exist or have been modified; record that partial output may exist.
- A confirmed `fatal` `DestinationWriteResult` for the known current member
   increments `members_failed` and `members_processed`, clears that member, then
   terminalizes. `destination_outcome_unknown` is not a result and leaves the
   current member uncounted.
- If the source accepted a destination result but the caller loses the response,
   the caller obtains live status or requests the next member. It must not resend
   the result; a lost source session terminalizes the operation.
- A destination result is never durable evidence of a completed member. Only an
   accepted result can alter the source aggregate, and only the backend's
   accepted source completion can persist the terminal aggregate result.
- A destination collision or retryable partial write pauses the source session.
  Its handle and current member stay open until the normal operation decision
  resolves it.
- A destination error that invalidates rooted output safety, a lost source
  session, or a transport failure that cannot be safely retried ends the
  operation.
- A pinned-source open failure, SMB share violation, local descriptor-metadata
   change, or archive read error ends the operation as source-unavailable or
   source-changed. If direct target bytes were already accepted, report partial
   output as applicable, then do not continue with later members.
- Capability expiration while a live source session waits for user input must
  be handled by an authenticated capability refresh scoped to the same live
  operation. Refreshing a capability does not reconstruct a session after its
  handle has been lost.

## Operation Persistence and Cleanup

1. Continue persisting operation ownership, roots, lifecycle phase,
   cancellation request, immutable prepared collision policy, bounded generic
   error information, revision, and final aggregate result.
2. Do not persist a reader cursor, an entry object, a source file identity, a
   source snapshot, live source-pin metadata, member paths, target paths, member outcomes, retry sets, or
   ignored-member sets. For extraction, do not write a pending decision payload,
   collision-action map, rename map, or changed `*_all` collision policy to the
   operation or checkpoint; `pending_decision_json` remains null. Do not persist
   delivery IDs, idempotency keys, payload digests, or returned write/result
   responses.
3. A final aggregate result is written atomically when the source session ends
   normally. If it ends abnormally, persist a terminal failure/cancellation and
   any aggregate progress already known, clearly marked non-successful.
4. All terminal transitions close the source reader and release destination
   resources. Session registries must also close source handles when evicting
   stale sessions. An active bounded stream observes cancellation, exits, and
   releases the reader before its session is removed.
5. Ensure cancellation and decision handlers cannot operate after terminal
   cleanup. Return an explicit operation-unavailable response rather than
   accepting a stale decision.
6. Do not use checkpoint updates for live-member serialization. The operation
   revision remains a durable fence for lifecycle and browser decision changes;
   the live source-session lock, ID, and sequence are authoritative for member
   transitions.

## Migration and Rollout

1. Add the forward readers and focused parser conformance tests first. Keep
   legacy full-manifest paths temporarily unused by the new flow.
2. Convert local inspection to record-order pages and remove any UI assumption
   of global sorting or exact totals.
3. Convert direct backend and direct Companion extraction to live source
   sessions, including collision pauses that retain the pinned source handle.
   Add the SMB restrictive share mode and local platform pin/check behavior
   before converting relay execution. Add the explicit backend
   `open_archive_source_reader()` protocol method and Companion
   `LocalArchiveReader::open_pinned()` constructor at the same step, then route
   every S1 source entry point through them. Add the shared source-only
   `finalize_source_outcome()` transition in both source-session
   implementations before converting relay execution.
4. Convert local-ZIP-to-SMB and SMB-ZIP-to-local relays to the source-owned
   exchange. Normalize the existing destination write response as
   `DestinationWriteResult` and route every accepted result through the source
   session's one acceptance transition. Remove manifest DTOs, manifest
   capability claims, and membership checks once both directions use the new
   protocol.
5. Replace extraction checkpoint validation with the aggregate-only schema.
   Mark existing in-flight V2 extraction operations incompatible and terminal;
   do not migrate or resume them.
6. Remove extraction `delivery_ids`, idempotency keys, payload digests, and
   replay logic from routes, checkpoint parsing, storage, and tests.
   Reuse the existing sequence only as the source-owned delivery fence,
   incrementing it for every first delivery and authorized redelivery of the
   retained current member.
7. Replace extraction decision persistence with live-session decision status
   and application. Leave the database column and legacy creation behavior in
   place, but require `pending_decision_json` to be null for every S1 extraction
   state. Remove extraction use of checkpoint decision maps and
   `apply_existing_file_decision()`.
8. Delete obsolete manifest, snapshot, per-member outcome, and resume code only
   after the direct and relay test suites cover the new path. Leave creation
   types untouched unless they are extraction-only shared code.
9. Update deployment documentation to name the canonical production Docker
   command as the S1 launch contract: one backend service instance and an
   explicit `--workers 1`. Add release-time static validation that the command
   contains that worker count. Do not add topology settings, runtime detection,
   release checks for arbitrary manual replica overrides, sticky routing, or
   other coordination as an S1 alternative.

## Required Tests

### Shared ZIP Corpus

Add matching Python and Rust tests for:

- large central directories processed with fixed parser-memory behavior;
- valid record-order traversal across buffer boundaries;
- malformed fixed, variable, ZIP64, and end-of-directory records;
- invalid filename encoding, unsafe paths, special file types, unavailable
  codecs, invalid local headers, truncated payloads, declared-size overflow,
  CRC mismatch, and S4 trailing-payload fixtures;
- a bad member followed by a valid independently parseable member; and
- corruption whose next record boundary is unknowable, proving traversal ends.

Primary locations: `backend/tests/test_archive_zip_reader.py` and the archive
module tests in `companion/src-tauri/src/server/archive.rs`.

### Direct Extraction

Test in `backend/tests/test_archive_extraction.py`,
`backend/tests/test_archive_execution_conformance.py`, and Companion archive
session/handler tests:

- one handle opens once for an operation and remains live during collision and
  retry prompts;
- SMB archive-source opens request `share_access="r"` and reject a failed
   restrictive open without falling back to permissive sharing;
- every S1 backend source entry point calls `open_archive_source_reader()`;
   `open_random_access_reader()` is neither called nor accepted as a fallback;
- an extraction test source that lacks the explicit pinned-reader capability
   fails before ZIP parsing or target mutation;
- a local Windows source uses read sharing only, and a local Unix source detects
   descriptor-metadata change before later member processing or after streaming;
- local rename/unlink after source open continues to read the original open
   descriptor, without reopening the archive path;
- a source-pin failure or detected source change ends the operation, retains any
   applicable partial-output result, and never resumes from a path reopen;
- member bytes are written directly to the resolved target; no temporary output
   file, output reread, or publication step is introduced;
- a clean transport EOF alone does not complete a file member; source size/CRC
   validation must move the live session to `AWAITING_RESULT` before its
   `DestinationWriteResult` can be accepted;
- a destination write response is transient and only the live source session
   can accept it, update aggregate counters, clear the current record, or enter
   a decision state; and
- a confirmed known-member `fatal` result increments failed and processed
   counters before terminalization, while a lost or uncertain write outcome has
   no accepted result and leaves the current member uncounted; and
- concurrent `next_member`, result, decision, and cancellation requests leave
   exactly one current member and cannot advance the reader twice;
- no full entry vector, extraction manifest, source snapshot, or member ledger
  is created by the new execution path;
- completed, skipped, failed, directory, byte, and replacement counters are
   correct, including the member-outcome arithmetic invariant;
- implicit parent-directory creation does not alter `members_completed`, and an
   unidentifiable malformed central-directory record does not alter any member
   outcome count;
- unsafe paths, special types, encrypted entries, and unavailable codecs with a
   known record boundary invoke exactly one source-only final outcome, consume
   no delivery sequence, issue no destination write, and allow a later valid
   record to proceed;
- an all-source-only-rejected archive completes with correct aggregate counts,
   while an unknown-boundary parser failure remains terminal with no invented
   member outcome;
- cancellation, session expiry, explicit handle failure, and process/session
  loss end the operation and require a new execution from the first member;
- the canonical production Docker command explicitly supplies `--workers 1`;
   the release-time static check rejects an omitted or different worker count;
- the documented S1 deployment has one backend service instance, while manual
   worker or replica overrides remain unsupported and are not runtime-detected;
- stale decision revisions fail without changing the active member; and
- an extraction pause persists only `AWAITING_USER_DECISION` and its durable
   revision; its database pending-decision payload remains null;
- a browser status refresh reads the same active decision from the live session,
   while source-session loss makes that decision unavailable and terminalizes the
   operation; and
- later safe members are attempted after a terminal bad-member result.

### Mixed Relays

Test in `backend/tests/test_archive_operations.py`,
`backend/tests/test_archive_relay_companion_interop.py`,
`backend/tests/test_archive_contract.py`, and Companion handler tests:

- backend-to-Companion and Companion-to-backend follow the same one-member
  source-driven sequence;
- destination writes reject an invalid executor-only capability, out-of-scope
   root, malformed relative target, and wrong relay purpose;
- no route accepts or returns a complete extraction manifest;
- a destination write returns a `DestinationWriteResult` that echoes the live
   session ID and delivery sequence but leaves no destination receipt or
   per-member durable state;
- only the ZIP-owning source session accepts a destination result and applies
   aggregate changes; the backend persists completion only after the source
   reports end-of-directory;
- source-only rejected records are not emitted as relay exchanges, do not
   allocate delivery sequences, and do not cause destination write requests;
- an active-sequence destination result advances exactly one current member;
- a clean source-stream EOF alone does not change aggregate counters or reader
   position; only a subsequent valid `DestinationWriteResult` may do so;
- a confirmed `fatal` result records one failed known member before
   terminalization, while `destination_outcome_unknown` terminalizes without an
   invented member outcome;
- a lost destination-write response terminalizes the operation without a second
   write, while a lost result response is recovered by live status or next-member
   discovery without resending the result;
- a collision, rename, replace, or retry decision redelivers the retained record
   with a new delivery sequence; delayed results for its prior delivery sequence
   are rejected without changing counters or current-member state;
- collision and retry pauses keep the source handle open and do not request the
  next member;
- a final source size/CRC failure after destination bytes were accepted becomes
   a partial-output retry/ignore result and never advances or counts as success;
- both relay directions use only existing write responses and member-result
   acknowledgements as the integrity gate, with no terminal payload frame, HTTP
   trailer, output reread, or publication step;
- an interrupted transfer or lost destination-write response terminalizes the
   operation without automatically replaying the member;
- a wrong source-session ID, wrong delivery sequence, or premature file
   completion is rejected without changing counters or current-member state;
- a wrong or stale live decision revision is rejected without changing the
   current member, and a `*_all` decision affects only the remaining live
   session; and
- concurrent duplicate current-member results cause exactly one accepted state
   transition and aggregate update; later duplicates fail phase or sequence
   validation; and
- relay disconnect closes the source session and rejects subsequent member or
  decision requests as unavailable; and
- operation completion is accepted only after the source reports
  end-of-directory.

### Checkpoint and Contract Tests

Update `backend/tests/test_archive_v2_checkpoint.py` to assert:

- the aggregate-only extraction shape is accepted;
- manifest, source snapshot, member outcome, cursor, and decision fields are
  rejected for new extraction operations;
- `delivery_ids` and every idempotency/replay field are rejected for new
   extraction operations;
- `total_members`, `files_skipped`, and `files_failed` are rejected for new
   extraction operations;
- counters reject negative, non-integer, overflow, and invalid member-outcome
   arithmetic values; and
- legacy in-flight extraction checkpoints become terminal incompatible
  operations rather than being migrated or resumed.

## Acceptance Criteria

- ZIP inspection and extraction do not retain member metadata proportional to
  archive member count.
- Direct and mixed extraction retain one source archive handle throughout the
  active operation, including user collision/retry pauses.
- One live source session serializes every reader/current-member transition;
   stale or duplicate relay requests cannot advance the reader or double-count
   aggregate results.
- A delivery sequence is an opaque live fence for one delivery of the current
   record. Redelivery after a collision or retry decision increments it without
   advancing the reader or changing aggregate counters.
- A known pre-transfer source-only rejection uses the shared finalization
   transition: it applies exactly one aggregate `skipped` or `failed` outcome,
   assigns no delivery sequence, performs no destination interaction, and may
   continue to the next fully parseable record. An unknown-boundary parse failure
   remains terminal with no member outcome.
- S1 does not replay side-effecting relay commands. A lost destination-write
   response ends the operation, while a lost result response is resolved through
   live status or next-member discovery.
- A destination write response is one transient `DestinationWriteResult`.
   Only the ZIP-owning source session may accept it and change live member state
   or aggregate counters; the backend persists terminal aggregates only after
   source completion.
- Source-only finalization changes counters for its current record without a
   delivery sequence. An accepted known-member `fatal` result records one failed
   member before terminalization; `destination_outcome_unknown` is not a result
   and leaves the current member uncounted.
- S1 supports one backend service instance. The canonical production Docker
   command explicitly starts one Uvicorn worker with `--workers 1`; normal async
   operation concurrency remains supported. No topology configuration, runtime
   detection, sticky routing, shared live-session store, or cross-process reader
   recovery is required or supported, and manual overrides are unsupported.
- Extraction decision details and evolving collision policy exist only in the
   live source session. The durable operation records only its awaiting phase and
   revision, so source-session loss cannot leave a resumable stale decision.
- Mixed destination writers trust the source executor for membership but retain
  all operation-scope and safe-output validation.
- No extraction flow constructs a complete member manifest, membership index,
  source snapshot, resumable cursor, or per-member result ledger.
- Terminal extraction state stores aggregate results only.
- Aggregate member result counts have explicit outcome semantics and satisfy the
   member-outcome arithmetic invariant; no result presents `total_members` as an
   archive-wide fact.
- Handle loss, process restart, executor disconnect, or source-session timeout
  ends the operation; no endpoint resumes it.
- Archive source reads use pinned handles: SMB and Windows reject new writer and
   delete/rename opens, while Unix detects descriptor-visible source changes and
   fails rather than continuing from a reopened path.
- Every S1 source path uses the explicit archive pinned-reader capability;
   general-purpose random-access readers remain unavailable to extraction.
- Direct target bytes become completed extraction output only after the source
   validator succeeds and the source accepts the transient
   `DestinationWriteResult`;
   transport EOF alone does not establish success.
- Both runtimes process the same shared ZIP corpus in record order and make the
  same parser acceptance decisions.
