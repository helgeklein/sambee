# Archive Implementation Plan

## Current Implementation Status

The current implementation delivers foreground ZIP browsing, creation, and
extraction for same-provider and SMB/local transfers. It includes:

- portable Stored/Deflate creation with the 64 KiB adaptive probe in the
  backend and Companion writers;
- conditional ZIP64 records in the backend streaming writer;
- validated Info-ZIP Unicode Path decoding in both readers and CP437 fallback
  in Companion;
- `Alt+F5` archive creation and contextual `Alt+F9` extraction shortcuts; and
- correlation-scoped, path-free archive lifecycle and decision audit events.
- a shared, hash-verified v1 reader conformance corpus consumed by both the
  backend and Companion for Stored/Deflate, data-descriptor, unsafe path, and
  Unicode Path ZIPs.

The locale-ranked encoding override UI, expanded ZIP64/data-descriptor/malformed
corpus coverage, and paired browser mutation qualification remain planned work.

## Scope And Invariants

Deliver ZIP inspection, virtual browsing, entry viewing/downloading, extraction,
and creation for SMB and local drives. ZIP is the first supported format.

- Never stage or copy a source archive.
- Create archive output directly at its requested final target with exclusive
  creation; never overwrite an existing file.
- Do not impose an archive-size limit. Process data in bounded chunks instead.
- Support single-pane, same-executor dual-pane, and mixed SMB/local dual-pane
  operations in the first release.
- Treat source consistency as best effort. Detect obvious changes with size and
  modification-time checks, but do not promise snapshots or locks.
- Use one portable ZIP creation profile in the first release: Deflate at zlib
  level 6 for broadly compatible, balanced compression. Read a 64 KiB first-read
  probe per regular member and choose Stored only when it saves less than 1 KiB
  and less than 5 percent after method overhead. Feed that probe buffer to the
  chosen writer; never pre-scan, reread, or retain an entire source member to
  select compression. Native creation profiles are out of scope for this release.
- Do not overwrite or merge existing destinations.
- Archive execution is foreground and nonresumable. Durable backend records
  secure, authorize, cancel, and report backend-backed work; they are not a
  background job queue or evidence that an executor survives navigation,
  reload, Companion restart, or backend restart.
- The active Create or Extract dialog is the only operation control surface.
  Do not add an archive history, activity panel, global active-operations
  affordance, or operation re-entry UI for this release.
- On `pagehide`, request best-effort cancellation for a backend-backed
  operation and abort a direct-local browser request. `beforeunload` warns when
  work is active. A reload never resumes work: it retries cancellation for a
  stored backend operation ID and reports that the previous work was
  interrupted. The marker contains only an operation ID and timestamp; it must
  never contain paths, credentials, manifests, or capability tokens.

## Foreground Execution And Interruption Model

Same-SMB and mixed operations use persisted `ArchiveOperation` state for
operation-scoped authorization, immutable source/destination metadata,
cancellation, and terminal reporting. Streaming requests refresh a heartbeat.
The backend monitor checks every 30 seconds and marks a nonterminal operation
whose heartbeat is older than 120 seconds as `failed` with
`archive_interrupted`. It does not restart, queue, or resume that operation;
the user must prepare a new archive action.

Direct local create and extract requests do not have a backend operation ID.
Their foreground request is controlled by an in-memory `AbortController`. An
abort ends the browser request, but the Companion's synchronous direct handler
may already have written output. Do not claim server-side cancellation,
rollback, cleanup, or completion for a direct-local request after its browser
connection is interrupted.

## Storage Capabilities

Add archive capabilities to the storage abstraction:

- operation-scoped random-access reader with `read_at(offset, length)` and
  deterministic `close()`;
- exclusive streaming writer opened at a path that must not exist, with a
  readable share mode while creation is active; and
- `abort_and_delete_if_owned()` on that writer, which attempts cleanup only
  while its active handle remains usable and the provider reports deletion as
  safe.

The SMB implementation uses one SMB connection and one open archive handle per
inspection/read operation. Its reader serializes range requests on that handle.
Separate concurrent operations use separate handles. Providers that lack random
access, exclusive creation, or streaming writes do not support archives;
source-copy fallback is forbidden.

## Executor ZIP Capability Profiles

Each backend and Companion executor publishes a versioned, runtime-probed ZIP
capability profile. Persist the selected source-reader and target-writer profiles
in the immutable operation plan and its hash. The profile separately declares:

- structural features that can be indexed, including ZIP64, data descriptors,
  self-extracting prefixes, and known compression method identifiers;
- bounded member-read codecs and bounded creation codecs;
- supported entry and metadata features, including timestamps, extra fields,
  comments, links, special files, encryption, and multi-disk archives;
- codec-specific memory, CPU, size, ratio, and cancellation limits; and
- the implementation and feature-set version used for conformance.

Profiles report security and product exclusions explicitly. Encryption,
multi-disk archives, links, special files, permissions, ownership, ACLs, and
unsafe metadata remain unsupported in this release even when a platform library
can process them. Those exclusions must not be reported as a missing codec.

The backend enables every installed, audited bounded decoder available through
the Python standard library or an approved adapter, subject to its runtime
probe. The Companion enables every audited decoder feature of its selected Rust
crate except encryption and other explicitly excluded features. A codec is not
advertised until its adapter accepts a parser-validated compressed member range,
obeys resource/cancellation limits, and passes the shared corpus.

## ZIP Reader And Metadata

Implement matching Python and Rust archive-reader abstractions.

- Locate EOCD and ZIP64 records with tail range reads.
- Incrementally parse the central directory; never load archive contents into
  memory.
- Index ZIP64, explicit directories, implicit directories, and every known ZIP
  compression method identifier independently of local decoder availability.
- Record only derived metadata: raw and decoded names, normalized logical path,
  sizes, compression method, CRC, timestamps, and local-header offset.
- Verify each local header against indexed central-directory metadata before
  streaming or extracting a member.
- Mark each member as readable, blocked by policy, or unavailable on the chosen
  executor. Return a specific error only when the requested member operation
  lacks a permitted decoder; browsing must still show its safe metadata.

The archive source owner performs member decoding with its own reader profile,
then streams bounded uncompressed chunks to a different destination executor.
Do not intersect source-read and destination-write codec support for extraction,
viewing, or downloading. Archive creation uses the target owner's writer
profile. The browser offers only the portable Stored/Deflate profile in this
release. Persist that profile, the per-member codec choice, and all limits in
the immutable plan. The portable profile selects Deflate at zlib level 6 unless
the bounded per-member probe selects Stored.

## Portable ZIP Writer Compatibility

The portable profile produces conventional ZIP output for broad external-tool
compatibility. It writes UTF-8 names with the UTF-8 flag and `/` separators,
preserves source name spelling after validation rather than Unicode-normalizing
it, and emits explicit directory entries so empty directories survive. It emits
only regular-file and directory entries, no archive/member comments, and only
the ZIP64 (`0x0001`) and Extended Timestamp (`0x5455`) extra fields when needed.
It uses version-needed-to-extract 2.0 for Stored/Deflate entries and 4.5 only
when ZIP64 is required, writes standard signed data descriptors, and must not
emit ZIP64 merely because a library default permits it.

At preparation, capture the initiating browser's IANA timezone in the immutable
plan. For a source modification instant, encode the DOS timestamp as that
timezone's wall time rounded down to ZIP's two-second precision and add the
Extended Timestamp extra field with the UTC instant. If no source modification
time exists, omit both fields. UI formatting labels archive timestamps with
their archive-local timezone and precision; it does not reinterpret them as UTC.

Native creation profiles are deferred. A later release may add them only after a
separate external-reader qualification; they must not inherit the portable
profile's compatibility claim.

Index keys use provider, connection, physical path, size, and modified time.
Stable file IDs are not required for this best-effort release. Indexes are
authorized per user and connection, contain no member bytes, expire by TTL/LRU,
and are removed when access is revoked. Listing is cursor-paged; cursors bind
the archive identity, directory, sort order, and page position. Return a stale
archive response on obvious source changes.

Use a distinct `ArchiveDirectoryListing` response rather than extending the
unpaged physical `DirectoryListing`. It contains the archive identity, virtual
directory path, page items, and optional opaque `next_cursor`. Requests accept
an optional cursor and bounded page size. The archive service uses a fixed,
canonical sort order for all pages of one identity so a cursor cannot produce
duplicates or omissions; the frontend may apply its display-only ordering within
the loaded page.

## Filename, Metadata, And Source Rules

Decode ZIP entry names in this order: UTF-8 flag, a validated Info-ZIP Unicode
Path field, then the automatic legacy policy. Accept the Unicode Path field only
when its version is supported and its CRC-32 matches the raw filename bytes;
otherwise ignore it, record a non-sensitive diagnostic, and continue with the
fallback policy. The automatic legacy policy tries unflagged UTF-8, the
browser-locale candidate (Windows-1252 for Western locales, Shift_JIS for
Japanese, GBK or Big5 for Simplified or Traditional Chinese, and EUC-KR for
Korean), then CP437. Discard a candidate that produces replacement or control
characters, unsafe paths, or normalized-name collisions. For inspection, choose
the best remaining candidate without interrupting the user and show a quiet
encoding control. The browser locale ranks candidates but never overrides ZIP
metadata. Preserve the raw bytes and chosen decoding.

Before extraction, do not write output until the decoding is authoritative, all
remaining candidates produce the same normalized paths, or one candidate clearly
wins because every alternative is invalid. If several safe candidates produce
different paths and the browser locale breaks the tie, show a compact
confirmation dialog with the recommended encoding, a filename preview, CP437,
and a More encodings choice. The user must confirm before extraction begins.
Keep an inspection override only in the current browser state and URL; copy it
into the immutable operation plan only when an operation is prepared. Do not
persist an encoding preference or archive-scoped encoding metadata.

The application language and regional locale may rank automatic legacy-decoding
candidates before a decoding is selected. They never change selected
archive-name decoding, normalized-path collision keys, or server cursor ordering.
Preserve decoded archive names as archive metadata, never translate or
case-transform them. Use localized numbers, sizes, durations, and dates only for
presentation; operation decisions such as newer-only extraction use typed
timestamps and sizes, not their displayed strings. Map structured archive error
codes and capability states to translated UI templates with safe interpolated
paths and optional redacted technical details.

When creating archives, dereference filesystem symlinks. Reject targets that
are inaccessible or outside the connection/drive boundary. Hard links are read
as ordinary independent file content. Build a full manifest before output:
resolved sources, entry names, duplicate conflicts, and inaccessible files.

Archive only file modification timestamps. Do not preserve or restore
permissions, ownership, ACLs, executable bits, extended attributes, or Windows
alternate data streams. Restore a member modification time only after its output
file is completely written.

## Security And Collisions

Normalize every member name before creating output. Treat both forward slash and
backslash as separators, then store one canonical `/`-separated path. A trailing
separator marks a directory; reject leading separators, volume-qualified paths,
empty internal segments, `.` or `..` segments, NUL bytes, malformed names,
duplicate normalized targets, links inside archives, and special files. Use the
canonical path for all traversal and collision checks. In the first release,
compare every destination with a portable key made from Unicode NFC
normalization and Unicode case folding, regardless of the local platform or SMB
server. This conservative rule avoids filesystem-specific guessing; the final
secure output open still catches native filesystem races.

Creation uses one simple safe collision policy: fail preflight if the final
archive target exists, if source entries collide after normalization, or if
entries collide after the portable comparison key. Show a conflict summary; do
not offer replace, merge, or skip for archive creation in the first release. The
preflight must also reject a final target that is itself a selected source or
lies inside any selected source directory, preventing the archive from including
its own output.

Extraction resolves collisions one member at a time as described below. It
must not reject an otherwise readable archive merely because archive members
map to the same canonical target under the portable comparison key. Before
writing a colliding member,
ask the user for a new relative output name. For a directory collision, rename
that output directory and remap all of its descendants; for a file collision,
rename only that member. Revalidate the proposed name using the normal path,
case-folding, and Unicode-normalization rules, then repeat the prompt until it
is unique or the user cancels extraction. Identical explicit directory entries
may share the same existing output directory and do not require a rename.

Require source-read and destination-write access at operation start and before
each direct member write or archive-creation final-target write. Audit operation
lifecycle events without logging entry names by default.

## Output, Extraction, And Failure Handling

Create archives directly at their requested final target with exclusive
creation. Stream output to that handle, close it, and validate the generated
ZIP before reporting success. The target is visible while creation is running
and may be an incomplete archive until validation succeeds. If the target
already exists, do not overwrite or truncate it; report the conflict and let
the user choose another name or resolve it outside the operation.

Do not block a user from opening, viewing, or downloading a target that is
being created or remains partial. Use the normal archive reader and let it serve
any structure already usable in the file. If its central directory is not yet
available or the file is malformed, show an actionable in-progress or incomplete
archive state with the physical target path, retry/open-location actions, and
optional technical details. Keep the active operation visible in the UI, but do
not treat it as an access lock.

Extraction is deliberately non-atomic. Extract members one by one directly to
their final target paths, without a temporary archive copy, temporary member
file, or temporary extraction directory. Create each required target directory
when absent; when it already exists, leave it in place. Never remove, replace,
or merge an existing directory as part of extraction.

When a target file exists, pause that member and ask the user to choose one of:

- skip this file;
- skip all existing files for the rest of this operation;
- replace this file;
- replace all existing files for the rest of this operation; or
- replace only existing files older than the archive member for the rest of
  this operation.

Before direct writes begin, preflight the manifest against the chosen
destination and present known regular-file collisions as one grouped review.
The review shows affected-item count and representative source/destination
paths, sizes, and timestamps, and permits an operation-wide choice with a safe
non-destructive initial focus. Final secure output opening revalidates every
path and returns a later collision to the same decision workflow when the
destination changed after preflight. For all choices, provide efficient
keyboard and pointer interaction.

Persist the chosen all-files policy with the operation, apply it only to regular
file/file collisions, and record every skipped or replaced member. For
replace-only-older, replace only when the archive member has a valid modification
time that is strictly newer than the destination file's modification time. If
the times cannot be compared, keep the existing file and record it as skipped.
A file/directory type conflict is an extraction error, not a replacement.

Write a replacement directly to its final path. Therefore a write failure may
leave a partial new file or a partially replaced old file; that is an accepted
consequence of direct extraction. After each file write, verify the member CRC
and byte count before recording that member as completed, then restore its
allowed modification time.

On an extraction error, show the actual error and ask the user to retry the
current member, ignore the error, or cancel the entire operation. Retrying writes that member again according to the
current collision policy. Ignoring leaves that member as-is and continues. Cancelling leaves all files and directories already
created, replaced, skipped, or partially written in the target directory; do
not attempt cleanup. Record per-member progress so recovery can report the
completed, skipped, failed, and partial member counts without deleting direct
output.

On archive-creation failure or cancellation, show the actual error and the
target path. Attempt cleanup only while the active writer handle remains usable
and `abort_and_delete_if_owned()` permits safe deletion. Otherwise leave the
incomplete target in place and report that it may be partial. Do not perform automatic
recovery, delayed cleanup, or deletion after a crash, restart, or lost writer
session; the user resolves any remaining target file manually.

Before an extraction or creation can start, present a confirmation summary with
the source and destination connection/location, selected item count and known
total size, output name or directory, selected compression profile where
applicable, known conflicts, and warnings about direct non-atomic output. Keep
technical executor details out of the primary summary. After a terminal state,
show completed, skipped, failed, and partial counts with actions to open the
target location and inspect details.

## Browser And Commands

Represent an archive location as structured state: physical provider/location,
physical archive path, and normalized entry path. Serialize it explicitly in
the URL; never use fake filesystem paths.

- `Enter` opens a ZIP root or descends into an archive directory.
- `Up` at an archive root returns to the physical parent.
- Breadcrumbs combine the physical and virtual paths, for example
  `Documents / Releases / backup.zip / configs / production`.
  Physical segments before the archive navigate the filesystem; the archive
  segment, shown with the archive icon/type treatment, opens the virtual root;
  and segments after it navigate virtual archive directories.
- Archive locations are read-only: rename, delete, copy, move, and create
  actions are disabled.
- Archive members use archive-specific viewer/download routes and stream only
  the requested member.
- Archive toolbars and context menus expose Extract, Download, and archive
  information, and distinguish physically unavailable, policy-blocked, and
  readable members without relying on color alone.

Serialize archive navigation in the URL with separate physical directory,
archive filename, and virtual entry-path fields. Reload and browser history must
restore the same virtual location without treating it as a filesystem path.
If the archive identity changes, retain the visible archive context and present
an explicit refresh/reopen choice; do not silently move the user to its physical
parent.

Register `Alt+F9` for extraction and `Alt+F5` for creation in the central
browser command and shortcut registries.

- Single-pane extraction uses a sibling subdirectory with a basename-derived
  default. An existing target directory is used as-is.
- Dual-pane extraction requires confirmation and uses the other pane's writable
  physical directory.
- Creation uses selected physical files/directories; its destination is the
  current directory in single-pane mode and the other pane in dual-pane mode.
- ZIP is the only offered output format initially.

Dialogs provide validation, conflict summaries, progress, cancellation, and
responsive behavior using the existing settings-form dialog pattern. Keep the
active Create dialog and Archive Extract dialog open while their work is active;
disable closing or starting a second extraction until work reaches a terminal
result. Cancelling remains available in that dialog. Reload and navigation do
not provide status re-entry or resumption: show a concise interruption notice
after the best-effort cancellation attempt. Dialogs define initial focus, focus
restoration, keyboard operation, screen-reader status announcements, error
association, and non-color-only states.

## Archive Operations And Credentials

Add a persisted `ArchiveOperation` separate from edit locks for backend-backed
foreground work. It records user,
source/destination locations, immutable manifest hash, executor, phase,
heartbeat, archive-creation final target, extraction conflict policy, per-member
outcome/checkpoint data, pending user decision, cancellation state, last
reported error, and audit ID. A pending decision records the member identity,
structured conflict or error details, allowed actions, and any proposed output
path. This state is not a durable worker contract: the executor is
request-scoped and does not continue after the originating request, page, or
process disappears. A terminal result may be inspected by the API for error
handling, but the browser does not present a history or re-entry workflow.

Use idempotent phase transitions:

1. `prepared`
2. `accepted`
3. `streaming`
4. `awaiting_user_decision`
5. `verifying`
6. `completed`
7. `cancelled`
8. `failed`

Use dedicated short-lived operation credentials bound to the user, origin,
operation ID, source/destination scope, permitted route/action, manifest hash,
phase, expiry, and nonce. The credential is reusable for authorized requests
until expiry; do not reject that normal reuse as token replay. Instead, reject
replayed phase transitions and deduplicate source-range and chunk-write requests
with operation-scoped idempotency keys. Reject scope mismatch, phase mismatch,
expired credentials, and reuse of a credential after a terminal state.

### Scoped Transport Contract

Expose archive-operation routes only through the operation scope; no transport
route accepts an arbitrary connection/path pair. The contract includes:

- prepare, accept, heartbeat, status, decide, cancel, verify, complete, and
  terminal acknowledgement routes, all idempotent by operation ID and expected
  phase;
- a decision route that accepts only the pending member and one allowed action:
  existing-file policy, collision rename, retry, ignore, or cancel; it validates
  a proposed rename before returning the operation to `streaming`;
- a source-range route accepting an offset and bounded range length, returning
  exactly that byte interval with its offset, length, and source-identity
  metadata; a bounded request range controls memory and retries, not supported
  archive size;
- destination write-session routes that can create and finalize only manifest-
  approved final archive targets or direct extraction member paths; and
- chunk-write requests carrying the operation ID, write-session ID, offset,
  byte count, SHA-256 digest, and idempotency key.

The destination accepts a chunk only at its expected offset. A retry is accepted
only when it exactly matches an already acknowledged offset, length, and digest;
otherwise it fails without modifying output. Archive-creation sessions write
only their manifest-approved final archive target and verify the generated-output
digest before reporting completion. If a direct archive write fails, the session
reports the actual error and attempts `abort_and_delete_if_owned()` only while
its active writer handle remains usable. Extraction sessions write only the
manifest-approved final member path, carry the current collision-policy decision,
verify the member CRC and byte count when closed, and transition to
`awaiting_user_decision` for an existing-file conflict or write error without
deleting direct output. The backend and Companion expose equivalent scoped
contracts for the directions each can serve.

## Mixed SMB/Local Operations

The Companion orchestrates mixed operations because its local API is loopback
only. The backend creates the durable operation and credential; the browser
passes the scoped job to the authenticated Companion API; the Companion initiates
all backend calls.

| Source | Destination | Execution |
| --- | --- | --- |
| SMB archive | Local directory | Companion fetches scoped SMB ranges and extracts members directly to local target paths. |
| Local archive | SMB directory | Companion extracts locally and streams members directly to manifest-approved SMB target paths. |
| SMB sources | Local archive | Companion streams scoped source bytes directly into an exclusively created local archive target. |
| Local sources | SMB archive | Companion generates ZIP bytes and streams them directly to an exclusively created SMB archive target. |

Archive creation and extraction both write directly to final destinations, and a
mixed operation is never globally atomic. Durable state and heartbeats protect
the request while both sides are available. A failed or interrupted operation
may leave partial output; it does not continue after either side restarts and
does not attempt automatic recovery, delayed cleanup, rollback, or resume.

## Resource Behavior

Use bounded chunks, bounded parser buffers, cursor paging, cancellation checks,
and deterministic handle closure. Use a 256 KiB archive I/O chunk for SMB ranges,
HTTP frames, compression buffers, hashing, and writes, clamped by negotiated SMB
limits. Coalesce simultaneous index builds for the same archive identity. There
is no archive worker queue in this release; request and provider limits must
reject or wait within the active request rather than implying deferred work. Use
a 64 MiB in-memory index budget and a 256 MiB temporary derived-metadata budget;
fail with a resource-exhausted error before exceeding either. A single SMB
inspection uses one connection and one archive handle.

## Tests And Delivery Order

Test SMB random access, exclusive final archive creation, active-handle
`abort_and_delete_if_owned()` cleanup, existing-target and output-inside-source
conflicts, direct-write ZIP validation, failure/cancellation/crash behavior that
reports and leaves partial targets, and opening a partially usable or malformed
in-progress target. Test ZIP64, every known compression method identifier,
per-profile readable/blocked/unavailable states, implicit directories,
self-extracting prefixes, data descriptors, malformed/encrypted/multi-disk
archives, Unicode Path CRC validation, encoding choices, slash/backslash
traversal, link rejection, creation collisions, timestamps, and best-effort
source changes.

Test direct extraction into new and existing directories; each existing-file
decision; persistent all-files policies; older-file timestamp comparisons;
file/directory conflicts; archive-member collision rename prompts, including
case-folded, Unicode-normalized, and directory-subtree collisions; CRC and write
failures; retrying a failed member; and cancellation/crash behavior that
preserves completed, replaced, and partial target output.

Test operation credentials, phase idempotency, permission changes, token replay,
credential reuse, range response integrity, idempotent chunk retries,
write-session path scoping, pending collision/error decisions, all four mixed
SMB/local paths, and backend/Companion restarts that leave and report partial
final targets without resuming work. Test source-owner decoding across every mixed path,
the portable creation profile, capability changes between prepare and execution,
and capability-plan hash rejection. Test archive-list
cursors for stable ordering, no duplicates, omissions, or use after the archive
identity changes.
Test frontend navigation, read-only archive behavior, commands, dialogs,
progress, cancellation, archive-aware breadcrumbs, physical and virtual
breadcrumb navigation, and URL history. Cover `pagehide`, `beforeunload`, and
reload behavior: backend markers retry cancellation without clearing after a
failed cancellation request; direct-local requests abort; neither flow resumes.

Implement in this order:

1. Storage capability contracts and local/SMB parity.
2. ZIP reader, metadata index, virtual navigation, and member streaming.
3. Same-executor direct per-member extraction and direct exclusive archive
  creation.
4. Foreground backend-operation lifecycle, credentials, heartbeats,
   cancellation, interruption expiry, auditing, and error status.
5. Mixed SMB/local workflows.
6. Encoding override and recovery UI.
7. Separate format adapters for TAR variants, then evaluate 7z/RAR for parity,
   streaming, dependency, licensing, and encryption support.
