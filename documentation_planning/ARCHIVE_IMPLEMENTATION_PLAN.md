# Archive Implementation Plan

## Current Implementation Status

The current implementation delivers foreground ZIP browsing, creation, and
extraction for same-provider and SMB/local transfers. It includes:

- portable Stored/Deflate creation with the 64 KiB adaptive probe in the
  backend and Companion writers, including Companion parser validation before
  reporting a direct-local creation as complete;
- conditional ZIP64 records in the backend streaming writer;
- validated Info-ZIP Unicode Path decoding in both readers and CP437 fallback
  in Companion;
- `Alt+F5` archive creation and contextual `Alt+F9` extraction shortcuts; and
- correlation-scoped, path-free archive lifecycle and decision audit events.
- a shared, hash-verified v1 reader conformance corpus consumed by both the
  backend and Companion for Stored/Deflate, ZIP64, data-descriptor, unsafe path,
  Unicode Path, and malformed ZIPs.
- destination-aware extraction confirmation that uses an existing sibling or
  opposite-pane directory without merging or replacing directories;
- a single foreground Extract dialog for confirmation, collision and member
  failure decisions, cancellation, and terminal output counts with an
  open-destination action;
- same-SMB grouped collision reviews with portable metadata, directory rename
  enforcement, decision-time NFC/casefold and subtree validation, and persisted
  file-policy decisions; and
- same-SMB per-member direct-output checkpoints, including retry/ignore/cancel
  handling for partial member writes; and
- local-ZIP-to-SMB extraction relay pause/resume for final file collisions,
  using the scoped operation state and Companion checkpointed-member replay,
  including timestamp-aware `replace_older` decisions at the SMB destination;
  and
- SMB-ZIP-to-local extraction relay pause/resume for member completion,
  collisions, and partial-write retry/ignore decisions, including a
  checkpoint-authorized retry that can replace only the known partial local
  member output.
- an `archive-contract/v1` lifecycle schema plus canonical purpose-scoped relay
  data-plane compatibility wire schemas, and a durable compare-and-swap
  `ArchiveOperation` state-store binding; and
- revisioned lifecycle and checkpoint writes for all backend-backed archive
  compatibility adapters, with optional stale-revision rejection for lifecycle
  transitions, decisions, and cancellation; and
- a shared backend topology resolver for same-provider and mixed archive
  creation and extraction plans; and
- Companion-owned, short-lived direct-local creation and extraction executions
  with paired-origin-scoped, revisioned, type-specific member-progress status
  and cooperative server-side cancellation between archive members, strict
  discriminated start/cancellation payloads, and canonical aggregate progress
  counters alongside compatibility fields; and
- direct-local checkpointed collision and member-error decision re-entry for
  per-file and all-existing-file skip/replace, timestamp-aware replace-older,
  file and directory-subtree rename, and retry/ignore actions, including safe
  regular-file partial-output retries, normalized target collision validation,
  origin/revision guards, paused-session cancellation, and failed/partial
  member progress counters.

The locale-ranked encoding override UI, broader malformed-corpus coverage, and
paired browser mutation qualification remain planned work.
The common archive execution foundation described below is in early migration:
the backend now centralizes same-SMB creation/extraction lifecycle handling,
relay lifecycle transitions, checkpoint validation, per-member outcome ledgers,
formal state-store bindings for same-SMB coordinators and relay lifecycle
helpers, and creation/extraction source/destination adapter roles. Same-SMB and
mixed relay bindings share the durable extraction-outcome persistence path;
the common backend extraction coordinator derives progress and terminal
summaries from normalized destination results while SMB bounded reads and direct
writes remain storage-adapter operations;
the Companion checkpointed local extraction coordinator likewise records its
directory, extracted, skipped, and ignored terminal results through one
idempotent destination-result accumulator;
the obsolete synchronous direct-local extraction route and frontend facade have
been removed, so production local extraction enters only through the
checkpointed foreground-session coordinator;
topology selection and Companion relay authorization share one explicit relay
purpose binding; the Companion and backend use only purpose-scoped canonical
relay paths, while the directional V1 relay routes remain active until a
replacement is deployed and has no production callers; its
operation-specific creation and extraction relays share a scoped transport base
for authenticated route construction and JSON control-plane relay mechanics.
Both mixed Companion extraction relays
consume that common ledger for resumption with a legacy `written_members`
fallback. Backend and Companion consume a shared v1 extraction-outcome
conformance corpus for ledger precedence, legacy fallback, terminal outcome
statuses, progress snapshots, partial-output replay, and invalid-outcome
rejection. The SMB-ZIP-to-local relay reports a typed terminal destination
result to the backend instead of manually assembled counter tuples, and both
mixed extraction relays derive their paused and completed API responses from
the same authoritative relay checkpoint. Their duplicate-member gates now use
the authoritative outcome ledger; legacy `written_members` is read only from
unversioned historical checkpoints until first outcome persistence migrates
them to the versioned ledger. Both mixed extraction relays select a
source/destination binding for a
common Companion coordinator. Its scoped transport adapter owns lifecycle and
remote member operations, while their direction-specific member traversal and
local/SMB filesystem adapter bindings remain compatibility implementations. A
shared member-relay transition converts each completion acknowledgement into
either the next authoritative checkpoint or a paused operation response; the
coordinator does not abstract the asymmetric local/SMB byte-flow or direct
filesystem ownership. The
SMB-source extraction and creation member readers share one backend guard for
capability scope, active streaming phase, and cancellation transition before
opening bounded reads; the SMB-ZIP-to-local extraction completion and
collision/error control messages use that same guard.
Direct-local and mixed Companion creation relays select a source/destination
binding for a common Companion coordinator. Its scoped transport adapter owns
the remote source manifest/member reads or the local-source manifest/member
uploads, while the backend owns direct SMB ZIP output when SMB is the
destination. The coordinator owns failure reporting, ledger-derived terminal
validation, and completion; ZIP traversal and local/SMB data-plane bindings
remain separate compatibility implementations. Both mixed creation relays now
use the same scoped backend creation begin/replay, completion, and failure
lifecycle, with local-to-SMB supplying only its live ZIP-writer liveness,
finalizer, and abort callbacks.
The shared extraction-outcome corpus now also drives an idempotent sequence of
terminal destination reports through both the backend recorder and Companion's
direct-local accumulator, rather than checking only prebuilt checkpoint replay.
It additionally drives collision-skip and cancellation workflows through the
same-SMB extractor, the direct-local Companion checkpoint coordinator, and the
SMB-ZIP-to-local relay. The versioned archive contract defines normalized v1
terminal member results, aggregate progress, and partial/member-error state;
the compact relay requests remain transport-specific acknowledgements of that
shared model. New extraction checkpoints declare outcome-ledger version 1 and
write only `member_outcomes`. Unversioned historical checkpoints retain a
read-only `written_members` fallback and are migrated to the versioned ledger
before any new member result is persisted. SMB-ZIP-to-local terminal counters
are derived from that ledger; its completion request carries only the separate
local destination-root-created lifecycle fact.
The immutable SMB-ZIP-to-local extraction manifest is now a typed domain model
in both runtimes. Its V1 corpus verifies normalized member paths, valid empty
archives, and unsafe, case-folded duplicate, and file-descendant collision
rejection. The backend extraction state loads that persisted manifest together
with its decisions, resolves the approved target member, and checks exact
terminal ledger coverage; relay endpoints no longer inspect raw manifest
dictionaries directly. Companion likewise validates its remote transport
manifest through the archive-domain type before opening local output.
Companion now keeps its remote extraction checkpoint parsing, terminal replay,
decision resolution, and progress projection in archive-domain relay state;
handlers only convert that state to transport responses and perform direct
filesystem work. Creation relay writers likewise record acknowledged outcomes
through one `record_expected` state operation. The backend uses one scoped
Companion relay context for capability resolution, begin/streaming guards,
completion, failure, and optional creation target hooks, leaving endpoint
adapters to invoke the context directly; the obsolete lifecycle helper wrappers
have been removed. Backend extraction-decision state now owns per-member
collision selection, target lookup, execution projections, and retry removal,
while the direct-local Companion checkpoint encapsulates its distinct subtree
rename, collision, completion, and partial-output queries. Companion manifest
responses are serialized through dedicated backend transport-boundary helpers
rather than repeated endpoint conversions. All four mixed relay families now
use the scoped backend context for begin, streaming, adapter failure, and
completion lifecycle transitions; manifest-backed extraction completion supplies
only its typed terminal-coverage checkpoint preparation. The coordinator owns
V1 extraction-outcome checkpoint construction, including its optional immutable
manifest and source identity. Same-SMB extraction now supplies its direct
adapter with one typed checkpoint execution projection for decisions and
terminal member outcomes. The shared Companion extraction coordinator now reports
adapter errors through the matching scoped failure route for either direction;
its completion, collision, member-error, and terminal control payloads are typed
transport DTOs. A V1 relay-binding fixture verifies purpose, kind, and
local/SMB direction alignment across the backend, contract, and Companion. An inventory confirms that every canonical V1
directional relay path is still used by the contract, backend, Companion, or
tests, so none is eligible for retirement. The V1 corpus rejects future
extraction checkpoint versions explicitly; `written_members` remains read-only
compatibility for unversioned historical checkpoints until the V2 boundary.
Direct same-SMB creation and extraction now open through one backend execution
context that owns operation-kind/topology validation, connection authorization,
and backend lifetime. Their shared direct start policy owns the
prepared-to-accepted-to-streaming transition, optional checkpoint initialization,
pre-start cancellation, and explicit resume behavior: extraction may resume a
streaming operation, while creation remains non-resumable because its ZIP writer
cannot safely be reconstructed.
The direct extraction coordinator now persists member and partial-output outcomes
itself, matching creation and leaving the API adapter free of persistence
callbacks. Checked terminal completion now shares phase/cancellation guards,
abort cleanup, and durable failure recording around asynchronous preparation;
creation supplies only its ledger validation and ZIP finalizer. Companion relay
transport similarly owns one typed JSON POST-without-result path for creation
begin, completion, and failure acknowledgements, while directional byte streams
remain adapter-specific.
The SMB-ZIP-to-local relay now projects untrusted Companion completion,
collision, and partial-output callbacks through one backend extraction-relay
state object. That domain object validates immutable manifest membership,
decision-derived targets, reported counters, and rename state before it mutates
the outcome ledger or enters a decision; the API callbacks now perform only
scoped relay lifecycle and request/response adaptation.
Companion now uses one no-result JSON acknowledgement path for every typed
creation control POST, including per-member commits. Its extraction and
creation coordinators also share the best-effort relay failure-report envelope,
without coupling their distinct success and completion behavior. Focused
loopback transport tests cover successful empty acknowledgements, invalid
begin payload decoding, and mapped acknowledgement failures. The unversioned
V1 `written_members` reader is now isolated behind named backend and Companion
compatibility methods; both are explicitly scheduled for removal with the V1
reader after the V2 operation-retention window, rather than serving as general
checkpoint access APIs.
The `written_members` fallback supports only checkpoints serialized before
outcome-ledger v1 and will be removed at the v2.0 schema boundary; new code
must neither write nor depend on it.

V2 will define a new extraction checkpoint schema in `archive-contract/v2`
with a required `extraction_outcome_checkpoint_version: 2` and required
`member_outcomes`; it will neither accept nor serialize `written_members`.
V2 readers must reject unversioned and V1 checkpoints rather than silently
infer terminal outcomes. A release that introduces V2 must retain the V1
reader only for active V1 operations and historical reporting until its stated
operation-retention window expires; it must not migrate an interrupted V1
operation into V2. The V2 corpus must cover rejection of legacy checkpoints
and preservation of every terminal V1 outcome semantics after an explicit
fresh V2 start. Canonical relay paths remain until the V2 contract, Companion
client, backend, and integration tests prove a replacement path is live and
the old route has no production callers; structural similarity is not evidence
for route deletion.
Retryable partial member outputs also persist through the same versioned ledger
path, where they may refresh nonterminal error details but can never overwrite
a terminal member outcome.
The SMB-ZIP-to-local relay records that partial state before entering its shared
retry-or-ignore decision transition, so mixed and same-SMB execution have the
same durable nonterminal outcome semantics.
The matching creation ledger declares version 1 before its first relay member
report. A coordinator-owned typed manifest normalizes and validates source
members and serializes the same immutable checkpoint shape for both mixed
creation directions, including same-SMB direct creation. Its creation state resolves submitted member paths,
derives their only permitted outcomes, and identifies exact committed replays
before direct destination writes. The coordinator validates complete
immutable-manifest coverage and derives progress after every committed member and terminal counters from that
ledger, leaving a relay completion payload as a checked acknowledgement rather
than a competing counter authority. Direct same-SMB creation and both mixed
creation relays use one manifest-validated member-commit helper after each
physical ZIP member write. All creation manifest validators reject normalized,
case-folded file-versus-descendant path collisions before opening an output.
The versioned archive contract likewise defines normalized V1 creation member
results and creation progress. Backend ledger persistence and Companion direct
and relayed ZIP writers consume a shared corpus for idempotent terminal reports
and invalid directory source-byte rejection. The corpus also requires both
runtimes to reject a changed replay for an already committed member, preserving
the write-once member-outcome invariant. Its manifest and terminal-state
scenarios additionally require path normalization, unsafe/empty manifest
rejection, nonzero directory-size rejection, case-folded and structural path
collision rejection, exact replay acceptance, and complete coverage before a
terminal summary. Companion owns this behavior through the same typed immutable
creation manifest and in-memory outcome state used by both relay directions;
the backend streaming adapter now resolves members directly through its typed
creation state without a redundant manifest-entry wrapper.
For SMB-to-local ZIP creation, each directory or file is durably acknowledged
after its local ZIP entry commits through a distinct creation-outcome ledger;
the backend validates that each report matches the immutable source manifest,
ignores exact replay, and requires complete ledger coverage before accepting a
new relay's terminal summary. This records incremental durable visibility and
audit progress only; it does not claim resumable ZIP writing after interruption.
Local-to-SMB ZIP creation uses the same manifest-first, member-framed protocol:
the backend owns the live exclusive SMB ZIP writer through an operation-scoped
direct-output binding, records a terminal outcome after each committed member,
validates complete manifest coverage at finalization, and aborts its owned
partial target on cancellation, failure, or backend shutdown. Its live-writer
liveness is enforced by the same scoped streaming guard that owns phase and
cancellation checks for all Companion relay member actions. After every upload
is acknowledged, Companion derives its checked terminal summary from the same
immutable source manifest rather than maintaining a duplicate counter ledger;
the SMB-to-local direction uses its remote source manifest in the same way
after local ZIP finalization. Its local relay ZIP writer owns only member writes
and central-directory finalization; it no longer maintains a second aggregate
creation-progress ledger.

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
- On `pagehide`, request best-effort cancellation for a backend-backed or
  direct-local execution. `beforeunload` warns when work is active. A reload
  never resumes work: it retries cancellation for a stored backend operation ID
  and reports that the previous work was
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

Direct local creation and extraction use Companion-owned, in-memory execution
IDs with paired-origin-scoped, revisioned progress polling and cancellation.
Their sessions end after a short terminal-state retention period and are not
resumable; the browser’s foreground abort requests cancellation when an
execution ID is available. Creation cancellation is cooperative during manifest
enumeration and between archive members; extraction cancellation is cooperative
between archive members. Creation and extraction remain non-atomic, so
previously written output is neither rolled back nor cleaned up.

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

### Common Archive Execution Foundation

Archive extraction has distinct source and destination responsibilities. The
source owns ZIP indexing, member validation, decompression, and bounded member
reads. The destination owns output-path containment, collision inspection and
policy application, direct output opening, member completion, timestamps, and
partial-output handling. Archive creation reverses the data flow: the source
owns file enumeration and reads, while the destination owns ZIP compression and
final archive output.

Implement one versioned, language-neutral archive-operation state-machine
specification. It is the single behavioral authority for foreground phases,
per-member lifecycle, collision decisions, counters, cancellation, progress,
and terminal summaries. Python and Rust have bindings for that specification;
they do not each invent equivalent extraction or creation behavior. This is one
shared behavioral implementation, not a shared executable binary: the backend
must not call Companion loopback endpoints, and Companion must retain local
filesystem ownership.

Each execution has exactly one coordinator driver. It alone performs member
traversal, applies collision and retry policy, creates decision requests, and
advances the state machine. It does not interpret SMB or local paths, parse ZIP
bytes, or open output files; those are adapter responsibilities. For a mixed
operation, Companion is the driver. The backend is a remote source,
destination, or state-store adapter: it validates authorization and filesystem
safety and returns observations or outcomes, but does not make archive workflow
decisions. An `ArchiveStateStore` binding persists backend-backed state in
`ArchiveOperation`; direct-local execution uses an in-memory,
foreground-session-scoped lifecycle store with a short TTL and explicit status
and cancellation routes. Direct-local extraction supports checkpointed per-file
and all-existing-file skip/replace, timestamp-aware replace-older, file and
directory-subtree rename, and member-error retry/ignore decisions. Browser
disconnect or reload requests best-effort cancellation
and prevents re-entry; the session expires after its TTL or a Companion restart.
It is never durable or resumable.
Every execution receives an execution ID. It is an `ArchiveOperation` ID for
durable routes and an opaque ephemeral ID for direct-local routes; only durable
IDs may appear in backend operation endpoints or reload markers.

The coordinator uses three narrow adapter roles:

- `ArchiveSource` enumerates validated source entries and supplies bounded,
  decoded member chunks with source identity and metadata.
- `ArchiveDestination` validates final output paths, inspects existing targets,
  executes a coordinator-selected collision action, creates direct outputs, and
  reports committed, skipped, replaced, or partial member outcomes.
- `ArchiveStateStore` atomically reads and writes coordinator state, including
  phases, member outcomes, pending decisions, and progress snapshots.

Every state-store mutation uses compare-and-swap on `(execution_id, revision)`
and increments `revision`. A member outcome also carries an idempotency key.
The state store returns the current state for a duplicate outcome and rejects a
stale revision without modifying state. This applies to progress, cancellation,
and decisions as well as terminal transitions.

Define one versioned archive-operation protocol that contains a control plane
and a data plane. The control plane contains manifests, member metadata,
collision reports, member outcomes, decision requests, progress, cancellation,
and terminal summaries. The data plane carries bounded source bytes or decoded
member chunks. Remote control messages carry a durable operation ID; messages
that mutate or retry member output also carry a member identity, expected phase,
and idempotency key. Data messages carry their byte offset, length, digest, and
source identity. Direct-local bindings use the same types without serializing
them over HTTP.

The coordinator-to-adapter API is internal. It exposes source enumeration and
bounded reads, destination inspection and output lifecycle, and state-store
compare-and-swap operations. A remote adapter implements those internal calls
with the scoped protocol; an in-process adapter invokes storage directly.

The backend and Companion expose one contract-compatible external execution
lifecycle API. Their authentication, storage adapters, and durable-state
authority differ, but each implementation supports the same semantic operations:

- start an execution from an immutable `ArchiveExecutionPlan`;
- resume an existing foreground execution after a valid decision;
- retrieve current state, progress, and terminal result;
- apply one validated user decision; and
- request cancellation.

The lifecycle API is capability-oriented rather than route-identical. For
example, the backend may expose an operation-scoped HTTP route while the
Companion exposes the same operation through its loopback API. Neither exposes
arbitrary paths, connection IDs, member I/O primitives, or destination-output
handles through this public execution surface.

Store the normative contract at `archive-contract/v1/openapi.yaml`. This single
machine-readable source defines the external lifecycle messages, remote adapter
messages, error codes, binary stream media types, and schema version. Keep the
state-transition table, checkpoint schema, and conformance fixtures beside it,
but derive their named message fields from the OpenAPI schemas. Generate shared
boundary types where the toolchain supports it; otherwise validate hand-written
framework bindings against the same document in CI. Additive optional fields
require a minor contract version; a changed transition, meaning, or required
field requires a new major version.

The protocol version, state-machine transition table, checkpoint schema, and
language-neutral conformance corpus are normative. Python and Rust adapters are
tested against the same scenario corpus covering collisions, `replace_older`,
rename, partial-write retry and ignore, cancellation, progress, and terminal
summaries. A test must demonstrate equivalent member outcomes for a same-process
adapter invocation and a cross-process relay with the same inputs and decisions.

Each content provider returns an `ArchiveSourceDescriptor` or
`ArchiveDestinationDescriptor` from its own handles and capabilities. The
internal archive-operation facade composes those descriptors into an immutable
`ArchiveExecutionPlan`, then selects coordinator bindings and remote adapters.
`contentOperations.ts` remains the sole browser-facing operation API.
`FileBrowser` consumes normalized progress, decision, and terminal outcomes
only; it must not select a local/SMB route, inspect connection-ID prefixes, or
call a transport API directly.

Directional code may bind source, destination, and state-store adapters, but
must not reimplement the state machine, member traversal, collision-policy
rules, checkpoint layout, or decision semantics.

### Execution Topology

| Operation | Source | Destination | Coordinator driver | State store | Adapter binding |
| --- | --- | --- | --- | --- | --- |
| Extract | Local ZIP | Local directory | Companion | Ephemeral local session | In-process source and destination |
| Extract | SMB ZIP | SMB directory | Backend | `ArchiveOperation` | In-process source and destination |
| Extract | Local ZIP | SMB directory | Companion | Scoped `ArchiveOperation` adapter | Local source, remote SMB destination |
| Extract | SMB ZIP | Local directory | Companion | Scoped `ArchiveOperation` adapter | Remote SMB source, local destination |
| Create | Local files | Local ZIP | Companion | Ephemeral local session | In-process source and destination |
| Create | SMB files | SMB ZIP | Backend | `ArchiveOperation` | In-process source and destination |
| Create | Local files | SMB ZIP | Companion | Scoped `ArchiveOperation` adapter | Local source, remote SMB destination |
| Create | SMB files | Local ZIP | Companion | Scoped `ArchiveOperation` adapter | Remote SMB source, local destination |

For mixed routes, the Companion drives the foreground coordinator because it
can reach its local adapter and can initiate authenticated backend requests.
The backend remains authoritative for durable state, credentials, and SMB
adapter safety checks. The coordinator pauses after a destination collision or
member error, returns the normalized decision request to the browser, and
continues only after the state-store binding records a valid decision.

### Scoped Transport Contract

The scoped transport contract is the remote form of the versioned
archive-operation protocol above; it does not define a separate state machine.
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

The canonical purpose-scoped archive relay routes are the current compatibility
wire surface described by `archive-contract/v1`. They translate their current
request and response shapes to the common execution operations and may not add
new collision, retry, checkpoint, or decision behavior independently. Replace
them only after both bindings pass equivalent normalized contract scenarios.

## Mixed SMB/Local Operations

Mixed operations select the same common coordinator with an SMB or local source
adapter and an SMB or local destination adapter. The Companion initiates the
cross-process transport because its local API is loopback only. The backend
creates the durable operation and credential; the browser passes the scoped job
to the authenticated Companion API; the Companion initiates backend calls.
Neither mixed direction may introduce a second extraction or creation state
machine: direction-specific code is limited to binding adapters and forwarding
the shared versioned protocol. The archive-operation facade, not the browser UI
or an individual content provider, selects this topology.

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

1. `archive-contract/v1`, contract-compatible backend and Companion archive
  execution APIs, common coordinator bindings, and a language-neutral
  conformance corpus for member lifecycle, collision, retry, cancellation, and
  progress behavior.
2. Storage capability contracts and local/SMB source and destination adapters.
3. ZIP reader, metadata index, virtual navigation, and member streaming.
4. Same-executor direct per-member extraction and direct exclusive archive
  creation.
5. Foreground backend-operation lifecycle, credentials, heartbeats,
   cancellation, interruption expiry, auditing, and error status.
6. Mixed SMB/local workflows through the shared coordinator and transport
  adapters, including direct-local parity.
7. Encoding override and recovery UI.
8. Separate format adapters for TAR variants, then evaluate 7z/RAR for parity,
   streaming, dependency, licensing, and encryption support.
