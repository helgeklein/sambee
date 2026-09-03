# Archive Security Mitigation Plan

## Purpose

This plan mitigates the security findings in the ZIP inspection, creation, and
extraction implementations for SMB, Companion-local, and mixed execution
topologies. It is an implementation plan, not an end-user documentation
change.

## Scope and Security Goals

The archive feature processes ZIP files and filesystem paths controlled by a
user or by an SMB server. The mitigations must preserve these invariants in
every topology:

- an archive cannot cause unbounded archive-member metadata allocation in a
   process;
- extraction cannot write outside the selected local or SMB destination;
- archive creation cannot include a file other than the preflighted source;
- backend and Companion make the same accept-or-reject decision for the same
  ZIP bytes; and
- a rejected archive or member never commits a partial successful operation.

## Priority Summary

| ID | Finding | Security risk | Delivery effort | Priority |
| --- | --- | --- | --- | --- |
| S1 | ZIP resource exhaustion | Remediated | Completed | Done |
| S2 | Local extraction symlink-swap race | Accepted (same-user local process) | Not planned | Accepted risk |
| S3 | Local creation source symlink-swap race | Accepted (same-user local process) | Not planned | Accepted risk |
| S4 | Trailing compressed-payload handling differs by executor | Compatibility | Low | P3 |
| S5 | Malformed flagged UTF-8 filename handling differs by executor | Compatibility | Low | P3 |

Risk is the impact if the issue is exploited in a deployment where a hostile
user, local process, or SMB peer can provide archive content or mutate selected
paths. Effort includes implementation, compatibility testing, and release
validation.

S2 and S3 are accepted risks for the supported desktop deployment: a local
process able to perform the substitution has the same operating-system access
as Companion and can directly read or write the redirected path. They do not
create an authorization-boundary bypass in that model. Reassess both findings
before supporting an elevated Companion, a separate service account, or local
drive access unavailable to the potentially hostile process.

## S1: Incremental Trusted-Source Archive Processing

**Risk: High. Effort: Medium.**

### Decision and Trust Boundary

The SMB backend and Companion are trusted archive executors. The executor that
holds the ZIP is authoritative for its member sequence and for member-level ZIP
validation. The browser, ZIP bytes, archive filenames, relay payload contents,
and destination paths remain untrusted inputs.

This removes the need for a complete member manifest to prove to the other
executor that a member belongs to the archive. It does not remove destination
operation scope checks, safe-relative-path validation, collision handling, or
the source executor's ZIP parsing and payload-integrity checks.

### Threat

The current readers retain one metadata object per central-directory record and
then build further full-archive projections. A ZIP with many members can exhaust
process memory before useful work begins. Complete manifests and per-member
outcome maps held in operation checkpoint JSON create the same growth in mixed
flows.

### Proposal

Process every archive incrementally. The source executor opens the archive once
and retains that handle for the operation's lifetime, reads, validates, and
transfers one member at a time, and waits for the destination's acknowledgement
before advancing. The source retains the current member; the destination retains
only bounded I/O buffers for its synchronous write. The source handle remains
open while normal operation workflows, such as a user collision decision, are
pending. S1 introduces no archive-specific scheduler, admission control,
concurrency limit, or capacity policy.

This maximizes compatibility: process every member that can be independently
parsed and safely handled. A bad member increments the appropriate aggregate
operation counter and does not discard unrelated valid members.

For a mixed relay, destination writes have terminal-on-ambiguity semantics.
Once a write request has started, an interrupted body, timeout, disconnect,
malformed response, or lost response is `destination_outcome_unknown` and ends
the operation. The direct target may have changed, so the source must not resend
that write. This deliberately avoids idempotency keys, replay receipts, payload
digests, durable delivery state, or output rereads.

A destination response is a transient `DestinationWriteResult`, not a stored
receipt. The ZIP-owning source session is the sole owner of current-member
state: it accepts that result, updates aggregate counters, and advances the
reader. The destination must not retain a per-member result or advance the
operation; when the backend is the destination, its durable operation record
still stores only lifecycle and final aggregate state.

Entries rejected by source validation before a destination write use a separate
source-finalized outcome. The source atomically classifies the known record as
skipped or failed, updates aggregate counters, discards it, and continues to the
next record. It does not allocate a delivery sequence, call a destination, or
wait for a destination result that cannot exist.

S1 supports one backend process with one Uvicorn worker and one backend service
instance. The production Docker command is the source of truth for its worker
count and must pass `--workers 1` explicitly. This still permits normal async
concurrency across clients and operations; it only ensures all backend-owned
live source sessions reside in one process.

### Core Design

1. Replace `entries()`/`read_local_archive_entries()` as the primary execution
   API with a forward-only reader over an archive handle opened once for the
   active operation. `next_entry()` returns the next parsed central-directory
   record; internally it may refill a fixed-size byte buffer or a small entry
   page.
2. Keep all existing parser defenses at the source: checked ZIP offsets and
   lengths, strict filename decoding, normalized safe-relative paths, special
   file rejection, local-header validation, allowed codecs, declared-size
   checks, and CRC validation while streaming.
3. Delete each parsed `ZipEntry`/`LocalArchiveReadEntry` after its inspection,
   transfer, or local write finishes. Do not build `EffectiveArchiveEntries`,
   `ArchiveInspectionManifest`, or a complete extraction manifest in normal
   execution.
4. When a member has definitively failed or been skipped, and the executor can
   safely continue traversal, update the appropriate aggregate counter and
   advance to the next known record boundary. Unsafe paths, unsupported types,
   unavailable codecs, invalid local headers, and payload-integrity failures
   normally meet those conditions. A collision awaiting a decision or a
   retryable partial write does not: retain that member as current and do not
   advance the cursor.
5. Stop traversal only when the next central-directory boundary cannot be
   determined, the retained source handle is lost, cancellation is requested,
   or the destination cannot safely continue. Report a partial summary instead
   of changing completed earlier members into failures.
6. Keep the current reader position, current-member state, and any pending
   collision workflow only in the live operation that owns the archive handle.
   Do not persist a source snapshot, cursor, collision decision, or per-member
   outcome. At terminal completion, persist only aggregate operation results,
   such as completed, skipped, failed, and total member counts.
7. Advance the live reader only after the current member reaches a terminal
   result. A collision awaiting a user decision or a retryable partial write
   keeps the current member and its source handle live until the regular
   operation workflow resolves it.
8. Assign each current-member delivery a monotonically increasing live sequence
   owned by the source session. The source accepts a member result only for the
   active source-session ID and sequence. Its session lock permits one result
   transition; concurrent or late duplicates fail the phase or sequence check
   without changing counters or reader position. This is stale-result fencing,
   not destination-write replay detection.
9. Treat a destination write with an unknown outcome as a terminal transport
   failure. Do not redeliver it automatically, advance the reader, or claim the
   member completed. Persist aggregate progress already known and report that
   direct partial output may exist. A destination result that explicitly reports
   a collision or retryable partial-output condition remains a known outcome and
   follows the normal user decision workflow.
10. Do not resend a result acknowledgement after the source has accepted it.
    If its caller loses the source response, it queries the source's live status
    or requests the next member. If that live session was lost, the operation is
    terminal rather than reconstructed or replayed.
11. Keep destination write handlers stateless with respect to member delivery.
   They validate scoped input, perform one direct write, and return a
   `DestinationWriteResult` that echoes the source-session ID and delivery
   sequence. Only the source session may retain the current member, accept a
   result, update counters, or advance the reader.
12. Add one shared source-session `finalize_source_outcome()` transition for a
   source-only rejection with a known central-directory record boundary. It
   updates `members_processed` and exactly one of `members_skipped` or
   `members_failed`, leaves physical-output counters unchanged, discards the
   entry, and returns to `READY` without a relay request or delivery sequence.
   Invoke it for pre-transfer path, file-type, codec, and local-header
   validation failures according to the existing user-facing error policy.
13. Keep source-only outcomes distinct from unknown-boundary parse failures and
   post-write stream-integrity failures. An unknown central-directory boundary
   ends the operation with no member outcome. A failure after destination bytes
   may exist remains the normal partial-output retry/ignore workflow and does
   not advance the reader through `finalize_source_outcome()`.
14. Treat the canonical production Docker command as the sole S1 launch
   contract. It starts one Uvicorn worker explicitly and is deployed as one
   backend service instance. Do not add topology configuration, runtime replica
   detection, a lease, a distributed lock, sticky routing, or shared live
   session state. A manual worker or replica override is unsupported rather
   than a runtime mode S1 must detect or repair.

### Inspection

1. Make SMB-hosted and Companion-local ZIP inspection consume cursor records
   directly and return stable archive-record-order pages.
2. Use an opaque cursor derived from central-directory position for listing
   requests. An extraction operation instead retains its live archive handle
   and reader position until it reaches a terminal operation state.
3. Do not compute an exact archive-wide total, global sort, last-wins duplicate
   projection, or virtual-directory index in the request path. Those features
   require global state and are explicitly outside this high-ROI design.

### Same-Executor Extraction

1. The executor holding both source and destination performs one loop:
   `next member -> validate -> resolve collision -> stream -> persist outcome ->
   advance cursor`.
2. Validate the destination-relative target before every write. Continue after
   any member-level ZIP or destination error that leaves the destination adapter
   safe to continue.
3. Preserve the existing partial-member retry/ignore behavior for a failed
   stream. Retry and collision decisions use the current member retained by the
   live operation and do not require a reconstructed complete manifest.

### Mixed SMB and Companion Extraction

Use the same source-driven protocol for both mixed directions. No complete
manifest, page manifest, or per-member membership authorization is needed.

1. For SMB ZIP to local extraction, the backend retains the SMB archive handle,
   parses and validates the next member, asks Companion to process that member,
   receives its transient write result, updates the aggregate operation counters,
   then advances its live reader. The backend `LiveSourceSession` owns this
   member state; Companion is only the destination writer.
2. For local ZIP to SMB extraction, Companion retains the local archive handle,
   parses and validates the next member, sends it to the backend destination
   writer, receives the transient write result, updates the aggregate operation
   counters, then advances its live reader. The Companion `ArchiveSession` owns
   this member state; the backend destination writer stores no member result.
3. In both directions, the receiving executor validates the operation token,
   immutable source and destination roots, normalized relative target path,
   collision policy, byte-stream outcome, and cancellation state. It does not
   verify that the member is present in a separately supplied full manifest.
4. A destination collision or retryable partial write is returned to the source
   executor as the current member's outcome. The source executor retains the
   archive handle and does not advance while the regular collision or retry
   workflow is awaiting its terminal completed, skipped, or ignored result.
5. Remove full manifest hashes from extraction relay state. Keep the signed
   operation capability; it scopes the executor to one user, operation, source,
   and destination, rather than to a full member list. It is not a resume token.
6. Include the source-session ID and current delivery sequence in every member
   exchange. The destination validates the executor-only scoped capability and
   echoes both fields in its `DestinationWriteResult`, but retains no receipt,
   result state, or delivery ledger. Browser clients may access operation status
   and user decisions only; they cannot call relay write or result endpoints.
7. After a destination write starts, classify every transport failure without a
   definitive destination result as `destination_outcome_unknown`. Close the
   source session and terminalize the operation without a second write attempt.
   Continue only after an explicit completed, skipped, collision, retryable
   partial-output, or fatal result from the destination.
8. Once the source accepts a destination result, advance its live state exactly
   once. A lost response to the caller is recovered through live status or the
   next-member action, never by resending the result acknowledgement.
9. The backend owns durable operation lifecycle and final aggregate persistence
   in both relay directions. It owns live member state only when it owns the ZIP;
   otherwise the Companion source session owns that state until it reports
   terminal completion. Do not create a backend receipt store for the
   destination-writer direction.
10. Before sending member metadata or bytes, the source internally finalizes
   every source-only rejected record with `finalize_source_outcome()` and
   continues until it reaches a transferable record or end-of-directory. The
   destination receives no command for such a record. Allocate a delivery
   sequence only after source validation permits delivery.

### Required Architecture Changes and Estimates

| Work | Scope | Effort | Delivery risk |
| --- | --- | --- | --- |
| Cursor reader in Python and Rust | Replace full member collections with forward iteration; retain current parser checks | Medium | Low |
| Incremental inspection API and UI | Record-order responses, opaque cursor, no exact global total/sort | Medium | Medium |
| Cursor-based direct extraction | Live reader position and retained source handle; final aggregate results only | Medium | Medium |
| Trusted-source mixed relay | Replace manifest-first preflight and member-membership gate with source-driven per-member transfer/acknowledgement | Medium | Medium |
| Relay result ownership | Make destination responses transient; limit member state transitions to the ZIP-owning source session; add direction-specific tests | Low | Low |
| Ambiguous-write handling | Map uncertain post-dispatch transport failures to one terminal error; fence results with the live sequence; add focused tests | Low | Low |
| Source-only outcomes | Add one shared finalization transition for known pre-transfer rejections and matching conformance tests | Low | Low |
| Singleton launch contract | Set `--workers 1` in the canonical Docker command and statically verify it during release validation | Low | Low |

### Caveats and Deliberate Tradeoffs

- This trust decision accepts that a compromised Companion or backend can submit
  a safe relative output path within the destination root already authorized to
  that operation. That is not an additional privilege within the chosen trust
  boundary.
- The browser remains untrusted. It must never be able to choose arbitrary
  source/destination roots, bypass operation capabilities, or supply unchecked
  target paths to a destination executor.
- Incremental processing bounds archive metadata and payload-buffer memory per
   active operation, but not total CPU time, disk output, or network traffic.
   S1 adds no archive-specific scheduling or concurrency limits; the existing
   process, operating system, SMB server, and storage provider supply ordinary
   backpressure and capacity behavior.
- S1 intentionally does not support resume after process restart, executor
   disconnect, or source-handle loss. End that operation and start a new one
   from the beginning; its aggregate result must not be used to skip members in
   a new operation.
- S1 intentionally retains no per-member extraction history. The terminal
  operation result contains aggregate completed, skipped, failed, and total
  member counts only.
- The source archive handle must remain open for the whole active extraction,
   including while the user resolves a collision or retry decision. Handle loss
   ends the operation rather than triggering a source re-open or snapshot check.
- A damaged central-directory record whose end cannot be safely determined ends
  traversal. Do not scan arbitrary bytes for another ZIP signature; earlier
  completed members remain valid.
- Global sorting, exact totals, virtual directory indexes, and last-wins
  duplicate semantics are not available without a durable index. Record order
  and destination collision decisions are the compatibility-oriented behavior.
- Member-level recovery can leave partial output. Continue only after the
  destination reports that it is safe to do so; otherwise preserve the current
  member state for retry, ignore, or cancellation.
- S1 intentionally sacrifices automatic recovery from an ambiguous destination
   write. That loss of availability prevents a second direct write from
   overwriting or appending to output whose first-write outcome is unknown. The
   lower-complexity policy is preferable here because replay-safe direct writes
   would require retained idempotency state, a publication protocol, or output
   inspection.
- A destination response has no independent durability or recovery role. Making
   it transient avoids an unclear backend owner and preserves the single-owner
   invariant: the ZIP-owning source session owns live member state, while the
   backend persists only durable operation lifecycle and terminal aggregates.
- Source-only failures are aggregate facts, not relay results or durable member
   history. The source may continue after a known rejected record, but it must
   terminate on a malformed central-directory record whose next boundary is not
   known. This preserves compatibility without guessing where parsing resumes.
- S1 is intentionally not cluster-capable. It has one backend service instance
   and one Uvicorn worker, while the async server continues to serve independent
   clients and archive operations concurrently. An operator who overrides this
   deployment shape is outside the S1 contract; runtime discovery or recovery of
   that unsupported topology would add coordination complexity without providing
   a supported use case.

### Acceptance Criteria

- No normal inspection, direct extraction, or mixed relay holds all archive
  member metadata in process memory.
- Processing an archive with $n$ members uses $O(1)$ member metadata and
  $O(\text{buffer size})$ payload memory, independent of $n$.
- An extraction opens its source archive once and retains that handle until the
   operation reaches a terminal state, including during collision decisions.
- Process restart, executor disconnect, or source-handle loss ends the
   operation; a later attempt starts a new operation from the first member.
- Each valid member is inspected or extracted in archive-record order without
  requiring a complete archive manifest.
- A definitively failed or skipped member updates the final aggregate result and
   does not prevent later independently parseable members from being processed
   when traversal can safely continue.
- SMB-to-local and local-to-SMB extraction use the same source-driven,
  one-member-at-a-time state machine.
- Destination writes remain constrained by the existing signed operation scope,
  safe-relative-path validation, collision policy, and cancellation checks.
- A post-dispatch write timeout, disconnect, interrupted body, malformed
   response, or lost response ends the operation as
   `destination_outcome_unknown`, records possible partial output, and makes no
   second write attempt.
- An explicit destination collision or retryable partial-output result remains
   eligible for the normal user decision workflow; it is not a transport retry.
- A lost response after the source accepts a result is recovered through the
   live status or next-member action without resending that result. A lost live
   session ends the operation.
- Concurrent or stale result reports cannot double-count or advance the reader;
   exactly one active source-session ID and delivery sequence may apply a result.
- A destination write returns only a transient `DestinationWriteResult` and
   stores no member result, receipt, or delivery state. In each relay direction,
   only the ZIP-owning source session accepts that result and advances its
   reader; the backend persists only lifecycle and final aggregate state when it
   is the destination.
- A source-only rejected record with a known boundary invokes exactly one
   source-finalized skipped or failed transition, makes no destination request,
   consumes no delivery sequence, and permits a later valid record to proceed.
   An all-rejected archive completes with correct aggregate counts; an
   unknown-boundary parse failure remains terminal with no invented member
   outcome.
- The canonical production Docker command explicitly starts one Uvicorn worker.
   S1 does not expose a multiple-worker or multi-replica deployment mode, add
   topology settings, or create runtime coordination state. Release validation
   statically rejects a production command that omits `--workers 1` or supplies
   another worker count.
- Tests cover both relay directions for an interrupted write and lost write
   response, assert exactly one destination write, and verify no reader advance.
   They also cover lost source-result responses, stale or duplicate results, and
   executor-only authorization for relay write/result endpoints. Directional
   ownership tests assert that Companion destination writes cannot mutate backend
   member state, and backend destination writes cannot mutate Companion member
   state before the source accepts the returned result.
- Shared backend and Companion tests cover unsafe paths, unsupported types or
   codecs, and pre-transfer local-header failures. They assert one aggregate
   source outcome, no destination call, no delivery sequence, and correct
   continuation to a later valid member.

## S2: Accepted Risk - Local Extraction Symlink-Swap Races

**Disposition: Accepted risk. No implementation planned.**

### Threat

The Companion validates a destination parent with `canonicalize`, then later
creates a directory or opens a file by path. A concurrent local process can
replace an already-checked directory with a symlink or Windows reparse point in
that interval. The subsequent operation can follow the replacement outside the
approved drive root.

### Proposal

No mitigation is planned for the supported same-user desktop deployment. The
root-anchored filesystem capability below remains a future design option if the
deployment trust boundary changes.

Replace check-then-use path operations with root-anchored, component-by-
component filesystem operations. The root must be opened once and every child
must be resolved relative to a trusted directory handle with symlink following
disabled.

### Design

1. Define a local extraction filesystem capability that owns a handle to the
   canonical approved drive root and a handle to the extraction root once it is
   created or opened.
2. Implement `open_or_create_directory_no_follow(parent, name)` and
   `create_file_new_no_follow(parent, name)`. Both must validate that the
   resolved object is a directory or regular file as appropriate.
3. Walk each normalized archive target one segment at a time. Reject every
   segment that resolves to a symlink, Unix special file, or Windows reparse
   point. Never reconstruct a trusted path and reopen it by absolute name.
4. Use the same handle-relative mechanism for destination-root creation,
   parent creation, exclusive file creation, replacement, and partial-file
   retry. Replacement must inspect and unlink only through the trusted parent
   handle.
5. Keep current collision semantics, but obtain metadata from the opened or
   handle-relative entry so collision decisions and writes refer to the same
   object.
6. Implement platform adapters rather than assuming Unix-only APIs:
   `openat`/`O_NOFOLLOW` and directory file descriptors on Unix; Windows APIs
   that open handles without traversing reparse points and verify handle
   attributes on Windows. If one target platform lacks a safe primitive, fail
   local extraction closed on that platform until an adapter exists.
7. Remove `revalidate_target_parent` from extraction write authorization once
   all writes use the rooted capability. It may remain only for converting an
   approved UI path into the initial root handle.

### Rollout and Tests

1. First introduce the capability behind internal functions while preserving
   current public extraction APIs.
2. Add deterministic test seams around directory open/create and file open so
   tests can replace a component after lookup. Assert the operation fails and
   no external target is written.
3. Add Unix integration tests with symlinked existing ancestors and symlink
   swaps. Add Windows tests for junctions and reparse points in CI.
4. Cover new target, nested target, overwrite, retry-partial, and collision
   paths. A fix limited to initial directory creation is insufficient.
5. After both platform adapters pass, remove the legacy path-based helpers and
   add regression coverage to the archive security corpus.

### Acceptance Criteria

- No local extraction write follows a symlink or reparse point below the
  approved root.
- A substitution at any path component causes a controlled failure or collision
  outcome, not an external write.
- The implementation does not depend on timing assumptions between validation
  and filesystem mutation.

## S3: Accepted Risk - Local Creation Source Symlink-Swap Races

**Disposition: Accepted risk. No implementation planned.**

### Threat

The local creation manifest records metadata from `symlink_metadata`, but later
uses metadata and file opening that follow symlinks. A concurrent process can
replace a selected source with a symlink to an unintended readable file between
preflight and read. Size and timestamp comparison lowers the chance of success
but does not prove the same file is read.

### Proposal

No mitigation is planned for the supported same-user desktop deployment. The
source-identity design below remains a future design option if the deployment
trust boundary changes.

Bind each source member to stable file identity at preflight, then open it with
no-follow semantics and compare the opened handle identity immediately before
archiving its bytes.

### Design

1. Extend `LocalArchiveEntry` with an opaque source identity captured from
   `symlink_metadata`: Unix device and inode plus size and mtime; Windows volume
   serial number and file ID plus size and mtime. Do not serialize host file
   identities into cross-device relay payloads.
2. At write time, open the source as a regular file without following a final
   symlink, then query metadata from the opened handle. Compare file identity,
   type, size, and normalized modification time to the preflight entry.
3. For recursively enumerated source directories, enumerate using trusted
   directory handles where supported. At minimum, reopen and verify every child
   from its containing trusted directory immediately before use.
4. Reject the archive operation with `ArchiveSourceChanged` when any identity
   check fails. Abort and delete an output owned by the operation.
5. Apply the same rule to direct local ZIP creation and the local-source side of
   local-to-SMB creation. The backend SMB creation path already uses its remote
   metadata contract and needs a separate provider-level identity assessment,
   not a local filesystem identity field.

### Rollout and Tests

1. Add a source-identity abstraction and unit tests for equality and missing
   platform metadata.
2. Add deterministic open seams that simulate: replacement with another file,
   final-component symlink substitution, and a same-size/same-mtime different
   file.
3. Add integration tests verifying the archive contains only the preflighted
   contents and the owned output is removed after rejection.
4. Verify relay behavior reports a source-changed failure without committing a
   creation member outcome.

### Acceptance Criteria

- Every local regular file archived is verified by the identity of its opened
  handle, not its path alone.
- A source replacement or symlink substitution cannot add unrelated data to a
  successful archive.

## S4: Align Recoverable Trailing Compressed-Payload Handling

**Impact: Compatibility. Effort: Low.**

### Compatibility Problem

A ZIP central-directory record declares a compressed-byte range for each
member. A Deflate or BZIP2 stream can reach a valid end marker before the end
of that range. The bytes left in the declared range do not become file output;
they can be padding, producer-specific data, or another compressed stream.

The backend currently accepts a member when its decoded output has the declared
size and CRC. Companion behavior differs or is decoder-buffer dependent. The
same ZIP can therefore extract when its source is SMB-hosted and fail when its
source is local. This is a robustness and interoperability concern, not a
standalone authorization, path-escape, or resource-exhaustion vulnerability.

S1 makes the ZIP-owning source authoritative for the operation, so a mixed
operation no longer depends on a second executor parsing the member. It does
not remove the user-visible topology difference when the same ZIP is opened
locally or through SMB.

### Compatibility Policy

Adopt permissive, member-scoped recovery consistent with common archive tools.
Treat the central directory's declared compressed-size range as the member
boundary. When a supported decompressor reaches a valid end marker before that
boundary, accept the member if, and only if, its output exactly matches the
declared uncompressed size and CRC. Ignore the remaining bytes in the declared
compressed range.

Do not scan beyond the declared member boundary, reinterpret those remaining
bytes as another ZIP record, concatenate another compression stream into the
member output, or relax header, size, CRC, codec, path, and special-file
validation. A truncated stream, output exceeding or falling short of the
declared size, CRC mismatch, unreadable declared range, invalid local header,
or unknown next central-directory boundary remains a member or operation
failure under the existing S1 rules.

### Design and Tests

1. Preserve the backend's permissive bounded-stream behavior: it must stop at
   the declared compressed-size boundary and retain its existing truncated
   stream, declared-size, and CRC checks.
2. Make Companion deliberately match that policy for Deflate and BZIP2. Do not
   reject a member solely because bytes remain after decoder EOF within the
   `take(compressed_size)` reader; decoder buffering must not make the result
   depend on chunking or library implementation details.
3. Add shared, versioned fixtures for each supported codec: a normal stream,
   a valid stream with trailing non-stream bytes, a valid stream followed by a
   second stream, a truncated stream, declared-size underflow and overflow, and
   a CRC mismatch. Each fixture must state whether extraction succeeds and the
   expected output bytes when it succeeds.
4. Test the backend and Companion against the same fixtures with multiple read
   chunk sizes. Assert identical success or failure and, for accepted members,
   identical output. Include direct extraction and both S1 relay directions so
   the authoritative source's result is visible at the operation boundary.
5. Keep inspection metadata-only. It may list a member whose payload later
   proves truncated or has a bad CRC; streaming or extraction determines that
   member-level result.

### Acceptance Criteria

- Python and Rust have identical behavior for every shared payload fixture.
- A valid supported stream with leftover bytes inside its declared compressed
  range extracts the same verified output in both runtimes.
- Trailing bytes cannot extend a member beyond its declared compressed range or
  contribute to its output.
- Truncated streams, declared-size mismatches, CRC mismatches, unavailable
  codecs, invalid headers, and unsafe members continue to fail according to the
  existing member and operation policies.

## S5: Align Recoverable Malformed UTF-8 Filename Handling

**Impact: Compatibility. Effort: Low.**

### Compatibility Problem

A ZIP entry can claim UTF-8 filename encoding while containing malformed UTF-8
bytes. There is no universally correct filename to recover: archive tools may
reject the member, substitute U+FFFD replacement characters, or make a legacy
encoding guess.

The backend currently rejects malformed flagged UTF-8 while Companion replaces
malformed byte sequences. The same ZIP can therefore be unusable when opened
from SMB but usable locally. This is a robustness and interoperability concern,
not a standalone authorization or path-escape vulnerability: both runtimes run
their normal safe-relative-path checks after decoding, and a replacement
character cannot create a path separator, traversal segment, NUL, or absolute
path.

Replacement intentionally does not preserve the original malformed byte
sequence. Distinct malformed names, or a malformed name and a literal U+FFFD
name, can decode to the same visible name. Existing archive-record order and
destination collision handling remain authoritative for that outcome. S1 makes
the ZIP-owning source authoritative during a mixed operation, but direct local
and SMB inspection must still use the same recovery rule.

### Compatibility Policy

Adopt deterministic replacement decoding for malformed names marked as UTF-8.
The backend must match Companion's U+FFFD replacement behavior exactly. Do not
guess CP437 or another legacy encoding for a UTF-8-flagged name: replacement is
predictable, produces a valid Unicode string for the UI and relay protocol, and
does not claim to recover the original byte identity.

Preserve the existing validated Info-ZIP Unicode Path and CP437 behavior for
unflagged names. Preserve raw central-directory name bytes for local-header
matching; replacement applies only to the displayed and destination-relative
name after that structural validation.

### Design and Tests

1. Change the backend's UTF-8-flagged decoding to deterministic replacement
   decoding that matches Rust's `String::from_utf8_lossy` semantics. Do not add
   a strict-invalid-name error path for this recoverable condition.
2. Confirm that the backend and Companion apply the same replacement grouping
   for malformed byte sequences, not merely the same replacement character.
   Keep decoded-name normalization, safe-relative-path validation, and
   case-folded collision keys unchanged.
3. Add shared, versioned fixtures for valid flagged UTF-8, malformed flagged
   UTF-8 with isolated and consecutive invalid bytes, invalid unflagged bytes
   with CP437 fallback, and Unicode Path extra fields with valid and invalid
   CRCs. Each fixture must state the expected decoded normalized name or safe
   rejection result.
4. Add collision fixtures for two malformed names that normalize to one
   replacement-decoded name and for a malformed name that collides with a
   literal U+FFFD name. Assert the existing record-order and destination
   collision policy rather than inventing raw-byte identity semantics.
5. Test direct inspection and extraction plus both S1 relay directions. Assert
   identical decoded names, safe-path decisions, collision outcomes, and output
   paths for backend and Companion sources.

### Acceptance Criteria

- Python and Rust produce identical decoded normalized names and safe-path
  decisions for every shared filename-encoding fixture.
- A malformed flagged UTF-8 name is recoverable with deterministic U+FFFD
  replacement when its resulting normalized path is safe.
- A replacement-decoded collision follows the existing archive-record and
  destination collision policies; it never silently overwrites a target.
- Invalid unflagged names retain their existing CP437 and validated Info-ZIP
  Unicode Path behavior.
- Raw local-header name validation, file-type validation, path restrictions,
  and all payload-integrity checks remain unchanged.

## Implementation Order

1. Land S4 and S5 compatibility alignment first. They are small, reduce parser
   divergence, and provide shared corpus patterns for later parser work.
2. S1 is complete.
3. Do not schedule S2 or S3 unless the supported deployment model changes to
   give Companion access beyond that of a potentially hostile local process.

## Cross-Cutting Requirements

- Extend `archive_testdata` with versioned, hash-verified security fixtures;
  each fixture should state its expected backend and Companion result.
- Add structured security telemetry for archive-page traversal and parser
   conformance failures. Do not log raw archive paths or filenames at info level.
- Treat a parser or filesystem integrity failure as an operation failure
  with an actionable generic client message and a specific internal error code.
- Run focused backend archive tests and Companion Rust tests after every phase,
  then the repository test suite before release.
- Do not alter collision policy, archive output naming, or relay authorization
  semantics while implementing these mitigations unless a security test proves
  the change is required.

## Deferred Assessment

The SMB provider deserves a separate race-condition assessment. SMB’s server
side identity and no-follow guarantees differ from local filesystem semantics,
and the local-handle mitigation cannot be assumed to cover a remote share.
That assessment should determine whether SMB operations need server-side file
IDs, handle-relative APIs, or a documented threat-model limitation.
