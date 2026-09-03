# Archive Implementation Guide

## Purpose

This guide turns [the archive plan](ARCHIVE_IMPLEMENTATION_PLAN.md) into a
file-by-file delivery map. It covers ZIP inspection, virtual browsing, entry
viewing and downloading, extraction, creation, and mixed SMB/local operations.

The plan remains the source of product decisions. This guide identifies the
existing code boundaries to extend, the new modules to add, and the order in
which to make the changes.

## Implemented Execution Boundary

Archive work is foreground and nonresumable. The active Create dialog and the
Archive Extract dialog are the only user-facing control surfaces; there is no
archive operations panel, history view, global activity affordance, or resume
workflow.

Backend-backed same-SMB and mixed SMB/local work persists an
`ArchiveOperation` for scoped authorization, cancellation, and terminal error
reporting. Streaming work refreshes its heartbeat. The backend expires a stale
nonterminal operation after 120 seconds, checking every 30 seconds, with the
`archive_interrupted` error. It never starts a worker, queues the work, or
resumes a stale operation.

The browser stores only the active backend operation ID and a timestamp in
`sessionStorage`. On `pagehide`, it issues best-effort cancellation with a
keepalive request; `beforeunload` warns while archive work is active. On reload,
the browser retries cancellation and shows an interruption notice rather than
restoring the prior action. A failed cancellation leaves the marker in place
for the next recovery attempt.

Direct local create and extract requests have no backend operation ID. They use
an in-memory `AbortController`, passed to the authenticated Companion request.
Aborting terminates the browser request but cannot promise that the Companion's
synchronous direct handler has stopped or removed output. The UI therefore
reports cancellation/interruption without claiming cleanup or rollback.

## Fixed Product Decisions

- ZIP is the first supported format. TAR variants, 7z, and RAR are later,
  format-specific adapters.
- Source archives are never staged or copied.
- Archive size is not capped. Memory and I/O are bounded by chunks, pages, and
  operation concurrency rather than archive size.
- Archive creation writes directly to an exclusively created final target. A
  failed or interrupted creation can leave a visible partial archive.
- Extraction writes members directly to their final paths. It is deliberately
  non-atomic and preserves work already completed if cancelled or interrupted.
- Source consistency is best effort, using size and modification-time checks.
- Existing target files are handled interactively during extraction; existing
  target directories remain in place.
- The first release creates only the portable Stored/Deflate ZIP profile. It
  uses Deflate level 6 by default, a 64 KiB per-member probe, and Stored only
  when that probe saves less than 1 KiB and less than 5 percent after method
  overhead. Native creation profiles are deferred.
- Inspection chooses a legacy filename encoding automatically. Extraction asks
  for confirmation before writing only when several safe encodings produce
  different output paths and browser locale preference breaks the tie.
- Current readers validate and apply Info-ZIP Unicode Path metadata for
  unflagged names; Companion falls back to CP437. Locale-ranked candidate
  selection and extraction confirmation remain follow-up work.
- A partial archive is still openable. Serve any readable structure; otherwise
  return the actual archive-read error.
- A provider without random reads, exclusive creation, and streaming writes
  does not support archives. Do not add a source-copy fallback.

## Existing Extension Points

| Area | Existing files | Required change |
| --- | --- | --- |
| Storage contract | [backend/app/storage/base.py](../backend/app/storage/base.py), [backend/app/storage/smb.py](../backend/app/storage/smb.py) | Add random reads and exclusive direct-output writers. |
| Backend browser and viewer APIs | [backend/app/api/archive_operations.py](../backend/app/api/archive_operations.py), [backend/app/api/browser.py](../backend/app/api/browser.py), [backend/app/api/viewer.py](../backend/app/api/viewer.py), [backend/app/main.py](../backend/app/main.py) | Archive listing, content, operation routes, heartbeat calls, and stale-operation monitoring. |
| Backend data and persistence | [backend/app/models/archive_operation.py](../backend/app/models/archive_operation.py), [backend/app/services/archive/operations.py](../backend/app/services/archive/operations.py), [backend/app/services/archive/operation_monitor.py](../backend/app/services/archive/operation_monitor.py) | Durable scoped state and heartbeat expiry for backend-backed foreground work; not a job queue. |
| Authorization and auditing | [backend/app/services/connection_access.py](../backend/app/services/connection_access.py), [backend/app/models/audit.py](../backend/app/models/audit.py), [backend/app/services/archive/operations.py](../backend/app/services/archive/operations.py) | Enforce source reads and destination writes for every phase. Lifecycle and decision audit events are correlation-scoped and omit member names. |
| Frontend browser | [frontend/src/pages/FileBrowser.tsx](../frontend/src/pages/FileBrowser.tsx), [frontend/src/components/FileBrowser/ArchiveBrowser.tsx](../frontend/src/components/FileBrowser/ArchiveBrowser.tsx), [frontend/src/components/FileBrowser/NameInputDialog.tsx](../frontend/src/components/FileBrowser/NameInputDialog.tsx) | Foreground Create/Extract dialogs, cancellation controls, reload interruption notice, and close gating while work is active. |
| Frontend commands and transport | [frontend/src/services/foregroundArchiveOperation.ts](../frontend/src/services/foregroundArchiveOperation.ts), [frontend/src/services/api.ts](../frontend/src/services/api.ts), [frontend/src/services/companion.ts](../frontend/src/services/companion.ts) | Backend operation markers and direct-local abort signals. The marker never stores sensitive data. |
| Companion local API | [companion/src-tauri/src/server/archive.rs](../companion/src-tauri/src/server/archive.rs), [companion/src-tauri/src/server/handlers.rs](../companion/src-tauri/src/server/handlers.rs), [companion/src-tauri/src/server/mod.rs](../companion/src-tauri/src/server/mod.rs) | Direct local archive handlers and scoped mixed-operation execution. Direct handlers remain request-scoped. |
| Companion backend bridge | [companion/src-tauri/src/http_client.rs](../companion/src-tauri/src/http_client.rs) | Add scoped backend requests for mixed operations. |

## Shared Models And Persistence

### Add backend archive models

Create `backend/app/models/archive.py`. Keep archive DTOs separate from the
physical `FileInfo` and `DirectoryListing` models in `file.py`.

Define at least:

- `PhysicalLocation`: provider kind, provider/connection ID, and normalized
  physical path.
- `ArchiveLocation`: a physical archive `PhysicalLocation` plus a normalized
  virtual entry path. It is never used as a writable physical target.
- `ArchiveIdentity`: provider/connection, physical path, size, and modified
  timestamp.
- `ArchiveEntryInfo`: `FileInfo`-compatible display metadata plus archive entry
  type, compressed size, CRC, and optional modification time.
- `ArchiveDirectoryListing`: archive identity, virtual path, page items, and
  optional opaque `next_cursor`.
- `ArchiveOperationRequest`, `ArchiveOperationRead`, `ArchiveDecisionRequest`,
  `ArchiveError`, and `ArchiveProgress`.
- Discriminated physical-source, archive-extraction, and archive-creation
  targets; each contains only fields valid for that operation direction.
- Location, immutable operation-plan, write-session, source-range, and
  chunk-write DTOs used by the Companion bridge.

Use normalized POSIX-style archive paths internally. Keep physical provider paths
and archive entry paths in separate fields throughout the API.

All browser operation requests use typed JSON bodies. Every phase-changing body
contains `expected_phase` and `idempotency_key`; executor-originated bodies also
contain `lease_epoch`. Return operation reads with `operation_id`, `phase`,
`progress`, optional `pending_decision`, and optional `error`. Return errors as
`{ "code", "message", "retryable" }`: use 409 for a phase or collision
conflict, 410 for an expired operation, 422 for invalid input, and 429 for a
configured request-throttling limit. Archive listings default to 100 items and reject page
sizes over 500.

### Persist operation state

Create `backend/app/models/archive_operation.py` with a SQLModel table. Include:

- operation ID, user ID, audit correlation ID, and creation/update times;
- source/destination locations, immutable operation-plan version, canonical
  serialized operation plan, and its manifest hash;
- executor type, executor instance ID, lease epoch, lease expiry, phase,
  heartbeat, cancellation state, and current capability generation;
- archive-creation target or extraction destination;
- extraction all-files collision policy and per-member checkpoints/outcomes;
- pending user decision: member identity, structured error/conflict, allowed
  actions, and optional proposed renamed output path; and
- last safe error code/message and terminal timestamp.

The immutable operation plan is the authorization source after preparation. It
contains the ordered members/sources, source identities, selected decoding,
approved final paths, output remaps, allowed metadata, creation target, and the
initiating browser's validated IANA timezone for ZIP timestamp encoding. A
selected legacy encoding is copied from the current browser state only when this
plan is prepared; it is not archive-scoped metadata or a reusable preference.
Hash the canonical serialized plan, but retain the plan for authorization,
cancellation, and terminal error reporting only. A restarted executor must not
use it to resume direct output; the user prepares a new foreground action.

Store the credential binding claims required to validate requests (user, origin,
operation ID, source/destination scope, permitted route/action, manifest hash,
phase, expiry, and nonce), but never persist a reusable credential value. Store
only the current capability generation and a one-way nonce identifier needed to
invalidate superseded credentials.

Use phases `prepared`, `accepted`, `streaming`, `awaiting_user_decision`,
`verifying`, `completed`, `cancelled`, and `failed`. Make every transition
conditional on the current phase and idempotency key.

Because credentials are phase-bound, every successful phase-changing response
returns a successor scoped credential with the new phase and capability
generation. The caller replaces its prior credential before the next
executor-originated request; reject credentials from an older generation even
before their expiry. Status and terminal acknowledgement remain user-authenticated
control routes and do not require an executor capability.

Implement `ArchiveOperationStore` as the sole owner of persistence, phase
transitions, executor leasing, and idempotency receipts. Claiming or renewing a
lease atomically compares the current lease epoch and expiry, then increments
the epoch. Every executor-originated transition, source-range request, and
write-session/chunk request carries that epoch and is rejected when stale. Store
the canonical request hash and response for each unique `(operation_id, action,
idempotency_key)` so a response-lost retry cannot repeat a transition or write;
reject reuse of a key with different request content. Implement the lease,
current phase, capability generation, and idempotency insert through database
compare-and-swap updates and unique constraints, not process-local locks.

Each executor receives a deadline-aware cancellation token. Check it before and
after every bounded read, decompression, and write; on lease expiry, renewal
failure, cancellation, or a stale epoch, signal it and best-effort close every
open reader/writer handle. An expired lease never resumes direct output: mark
the operation failed with partial paths reported, then require a newly prepared
operation. Run an operation-expiry reaper at startup and periodically; any
executor request also detects and finalizes its own expired lease before
returning a response.

Register the model before SQLModel metadata initialization and add an idempotent
migration following the existing individual-table migration pattern. Run the
application-owned monitor from `backend/app/main.py`; its 30-second sweep fails
nonterminal operations with a heartbeat older than 120 seconds as
`archive_interrupted`. Do not reuse `EditLock`: archive operations have
multiple paths and a different lifecycle. Do not build a background worker,
queue, or recovery executor.

### Register audit events

Add archive event names alongside existing audit usage:

- operation prepared, accepted, started, completed, cancelled, and failed;
- extraction collision decision and member outcome counts; and
- safe cleanup attempted/succeeded/failed.

Log operation IDs and paths only at the level already appropriate for file
operations. Do not log entry names by default.

## Storage Layer

### Extend `StorageBackend`

In `backend/app/storage/base.py`, add abstract archive-capability types and
methods:

```python
class RandomAccessReader(Protocol):
    async def read_at(self, offset: int, length: int) -> bytes: ...
    async def close(self) -> None: ...

class ExclusiveWriter(Protocol):
    async def write(self, chunk: bytes) -> None: ...
    async def close(self) -> None: ...
    async def abort_and_delete_if_owned(self) -> bool: ...

async def open_random_access_reader(self, path: str) -> RandomAccessReader: ...
async def open_exclusive_writer(self, path: str) -> ExclusiveWriter: ...
```

`read_at` must validate non-negative offsets/lengths, return a short result only
at EOF, and release the handle on cancellation. The writer must create with
exclusive semantics, never using an `exists()` check followed by truncating
`"wb"` output. Its abort method may delete only while the writer still owns a
usable handle and the provider says the deletion is safe.

Keep existing `read_file()` and `write_file_from_stream()` unchanged for normal
browser operations. Archive code must not call the existing stream writer for
exclusive archive creation.

Add an archive-only secure output-open primitive for extraction. It accepts a
validated `PhysicalLocation`, expected target type/state, and disposition
(`create_new` or `replace_regular_file`); it resolves containment and opens the
leaf as one provider-owned operation. It must revalidate every path component
at open time, reject links/reparse points and type changes, use exclusive create
for new files, and permit replacement only of the regular file confirmed by the
current decision. Do not compose a separate path check with a later generic
write/open call.

Implement equivalent local-drive reader and exclusive-writer capabilities in the
Companion. Expose archive actions only when the active provider supports all
three required capabilities; return a specific unsupported-provider error
otherwise. Do not fall back to copying the source archive or buffering it in a
temporary file.

### Implement SMB support

In `backend/app/storage/smb.py`:

1. Add an operation-scoped random reader around one `smbclient.open_file()`
  handle, opened with `buffering=0` and `share_access="rwd"`. Serialize the
  local offset update plus raw read through that handle and the existing SMB
  worker/timeout helpers. `seek()` only updates local client state; the raw
  read issues the SMB2 READ with its 64-bit offset, so no wire-level seek is
  needed. Loop until the requested range or EOF because one SMB2 READ may be
  short due to negotiated maximum read size or credits. Let `smbprotocol`
  clamp each request to its negotiated `max_read_size` and available credits;
  do not send a configured chunk size that exceeds either limit. Separate
  simultaneous inspections or reads use their own connection and handle.
2. Keep the pool's `get_connection()` lease open for the complete random-reader
  lifetime, not only for its `open_file()` call. Release the handle and pool
  lease together so idle cleanup cannot reset a cache that still owns an open
  archive handle. Capture size and timestamps from the SMB2 CREATE response and
  compare them with the expected archive identity, avoiding a second immediate
  `QUERY_INFO`/stat round trip.
3. Add an exclusive writer using SMB `FILE_CREATE` semantics with
  `share_access="r"`. This allows readers to inspect a target being created
  while preventing concurrent writers or deleters from changing it. Keep the
  source reader's permissive `rwd` sharing: source consistency is explicitly
  best effort, so archive inspection must not become a user-visible write lock.
4. Use the existing `get_smbclient_policy_kwargs()` for every archive open and
  session registration. Signing remains required and configured encryption is
  never disabled for throughput. Record negotiated dialect, encryption state,
  `max_read_size`, `max_write_size`, multi-credit support, credit waits, and
  range/handle counts as operation metrics for tuning.
5. Implement close, timeout, cancellation, and best-effort
  `abort_and_delete_if_owned()` semantics. Never delete after a lost handle,
  reconnect, or restart.
6. Map SMB collision, access denied, lock, and timeout errors to structured
  archive errors.
7. Re-stat the source before and after long archive work. Compare path, size,
  and modified time; report a stale archive on obvious changes.

Do not require SMB durable handles, leases/oplocks, multichannel, SMB
compression, or COPYCHUNK in the first release. The high-level `smbclient`
surface does not expose a supported end-to-end implementation of those features,
and lease-break/reconnect handling would conflict with the chosen fail-and-report
partial-output behavior. Treat them as benchmarked future optimizations behind
negotiated capability probes; do not use leases as a source-consistency promise,
and do not use COPYCHUNK where ZIP transformation or CRC verification still
requires member-byte processing.

Add focused tests in `backend/tests/test_smb_backend.py` for offset reads, EOF,
serialized use, negotiated read/credit clamping, pool-lease lifetime, CREATE
identity reuse, source/output share modes, exclusive creation races, readable
output during creation, security-policy propagation, and safe abort behavior.

## Archive Services

Create `backend/app/services/archive/` with small ownership-focused modules:

| New module | Responsibility |
| --- | --- |
| `paths.py` | Entry name decoding, slash normalization, traversal rejection, case/Unicode collision keys. |
| `zip_reader.py` | EOCD/ZIP64 lookup, incremental central-directory parsing, local-header validation, member byte streaming. |
| `index.py` | Derived-metadata cache, identity checks, cursor encoding, TTL/LRU eviction, and coalesced builds. |
| `source.py` | Physical and archive-member readable-content adapters for viewer/download code. |
| `manifest.py` | Creation source traversal, symlink dereference, output-inside-source rejection, and extraction output remapping. |
| `index_store.py` | Byte-accounted, derived-metadata-only index pages with TTL/LRU eviction and access-revocation purge. |
| `operations.py` | `ArchiveOperationStore`: atomic transitions, fenced leases, capability rotation, idempotency receipts, decisions, progress, and audit events. |
| `executor.py` | Direct creation/extraction orchestration; it requests state changes from the store and owns no persistence rules. |
| `transport.py` | Lease-bound source-read sessions and scoped write-session adapters that delegate authorization, lease checks, and idempotency to the store. |

Define a versioned `ZipCapabilityProfile` for each backend and Companion
executor. It separately records structurally indexable features, readable
codecs, writable codecs, entry/metadata features, security/product exclusions,
per-codec resource limits, and implementation feature-set version. Probe it at
startup and whenever an executor updates; include the selected source-reader and
target-writer profile versions, codecs, and limits in the immutable operation
plan hash. A capability is advertised only after its bounded adapter passes the
shared corpus against parser-validated compressed member ranges. In the first
release, creation advertises only Stored and Deflate in the portable profile.

The ZIP parser must:

- read EOCD/ZIP64 records through `read_at`, not by staging bytes;
- retain only central-directory metadata, never member contents;
- index ZIP64, explicit and implicit directories, self-extracting prefixes,
  data-descriptor entries, and every known ZIP compression-method identifier
  without assuming a decoder is available;
- mark entries as readable, blocked by policy, or unavailable on the selected
  executor; reject only a requested member operation that lacks a permitted
  bounded decoder;
- validate Info-ZIP Unicode Path extra-field version and CRC before using it;
- use UTF-8 flag, validated Unicode field, then the automatic legacy policy:
  unflagged UTF-8, a browser-locale candidate, and CP437; and
- verify local header metadata and CRC/byte count when streaming or extracting a
  member.

Do not use Python `zipfile.ZipFile` or Rust `zip::ZipArchive` as the canonical
reader, index, navigator, or extractor. Their normal reader APIs require a
seekable input and collect central-directory metadata, and Python's
instance-wide `metadata_encoding` cannot implement the required per-entry
decoding policy. Do not use `extract`, `extractall`, `testzip`, or Rust bulk
extraction/path helper APIs: archive policy, collision decisions, secure output
opening, and inline verification remain owned by these modules. Standard-library
or crate readers may be used only in isolated interoperability tests.

For every entry, retain raw and decoded names, normalized logical path, sizes,
compression method, CRC, timestamp, and local-header offset. The index identity
is provider, connection, physical path, size, and modified time; this release
does not require stable file IDs.

Define a language-neutral archive-reader conformance format: versioned ZIP
fixtures plus canonical JSON results for normalized entries, metadata, member
bytes/CRC outcomes, and structured errors. `archive_testdata/manifest-v2.json`
lists every fixture filename and SHA-256. Each expected result contains raw
filename hex, decoded name, normalized path, kind, method, sizes, CRC, state,
and either no error or one stable error code. Start with Stored, Deflate, ZIP64,
data-descriptor, self-extracting-prefix, unsafe-path, and malformed-central-
directory fixtures. Python and Rust readers must consume the same fixtures and
produce the same structural result or error classification for ZIP64, encoding,
traversal, malformed headers, collision, and partial archives. Codec fixtures
also assert each profile's declared readable, blocked, or unavailable state
rather than forcing Python and Rust to share one codec ceiling. Keep runtime
parsers separate, but make this corpus the single compatibility contract.

Extend this corpus with writer interoperability assertions. Archives created by
each implementation must be accepted by both custom readers and a neutral
external ZIP reader. Cover stored and Deflate members, standard signed data
descriptors, ZIP64 size and entry-count thresholds, UTF-8 names, empty
directories, timestamp boundaries, duplicate names, unsupported features,
explicit finalization failure, and direct-output partial-result behavior.

Maintain a versioned release-qualification matrix outside language-specific
unit tests. It records exact supported Windows Explorer, macOS Archive Utility,
Info-ZIP UnZip, and 7-Zip versions and verifies extraction of portable output
on each. The portable suite checks paths, empty directories, UTF-8 names,
Stored/Deflate members, descriptors, ZIP64 boundaries, and timestamps. A native
codec is not advertised until it passes a separately recorded external-reader
matrix; its creation dialog and completed-operation details name the method and
warn that compatibility varies.

Store the corpus once under a new repository-root `archive_testdata/` directory,
with ZIP inputs and versioned expected-result JSON. Backend and Companion tests
read this shared data directly; do not maintain language-specific copies.

Keep raw filename bytes and the automatic decoding in the index. The browser may
hold a user override in its current state and URL, but the index stores no
archive-scoped encoding preference. Before extraction, prompt only when several
safe candidates yield different normalized paths and browser locale preference
would choose one; show the recommended encoding, a filename preview, CP437, and
a More encodings choice. Copy a confirmed selection into the immutable operation
plan before any output directory or writer is opened.

The browser language and regional locale may rank automatic legacy-decoding
candidates before a decoding is selected. They must not alter selected
archive-name decoding, raw/decoded member names, normalized-path keys, collision
decisions, or canonical cursor ordering. Do not translate or case-transform
member names. Apply locale-aware display sorting only within an already loaded
page, never as a substitute for server cursor order.

The index exposes `ArchiveDirectoryListing` pages in fixed canonical order. A
cursor embeds the archive identity, virtual directory, sort revision, and page
position. Reject stale, malformed, or mismatched cursors rather than mixing
archive revisions.

Authorize index acquisition by user and connection. Indexes contain only
derived metadata, expire through TTL/LRU eviction, and are removed when the
user's access to the connection is revoked. `index.py` parses and sorts in
bounded batches, while `index_store.py` uses a configured byte-budgeted cache
and spills only derived metadata to managed temporary storage when needed. It
never stores member bytes. This prevents a high-entry-count archive from
retaining unbounded process memory without imposing an archive-size limit.

Persist the fixed canonical sort key with each index record and page results
through an indexed keyset cursor query. For an index larger than the in-memory
batch budget, use external merge sorting in `index_store.py`; never reassemble
all entry metadata in process memory or rescan the central directory for each
page.

`paths.py` must reject leading or volume-qualified paths, empty, `.` and `..`
segments, NUL bytes, malformed names, archive links, and special files. Treat
both slash types as separators and preserve a canonical `/`-separated path with
the trailing-separator directory signal. Use a portable collision key of Unicode
NFC normalization and Unicode case folding for every destination; do not probe
or guess local or SMB filesystem comparison behavior in the first release.

Do not reject a readable archive merely because members collide after
normalization. Before extracting a colliding member, transition the operation to
`awaiting_user_decision` and ask for a unique relative output name. A directory
rename updates all descendants; a file rename affects only that member. Validate
each proposed name using the same path and destination-sensitivity rules. If a
directory entry follows descendants, use their persisted remap rather than
moving output already written. Identical explicit directory entries may share
the same existing output directory.

## Resource And Scheduling Controls

Keep all reads, writes, decompression, parser buffers, and response pages
bounded. Use a 256 KiB archive I/O chunk for SMB ranges, HTTP frames,
compression buffers, hashing, and writes; clamp it to negotiated SMB limits.
Use a 64 MiB in-memory index budget and a 256 MiB temporary derived-metadata
budget. Coalesce simultaneous index builds for one archive identity. There is
no deferred archive queue: active-request or provider limits reject or wait
within the foreground request rather than creating work that can later be
re-entered. These controls do not restrict the supported archive size. Evict or
fail with a specific resource-exhausted error before an allocation can exhaust
the process. One SMB inspection uses one connection and one archive handle.

Run Python compression, decompression, encoding selection, and merge-sort work in
a dedicated bounded archive CPU worker pool, not the default executor used for
blocking SMB calls. Apply matching bounded `spawn_blocking` capacity in the
Companion. Choose one configured archive I/O chunk size per operation and use it
for SMB ranges, HTTP body frames, compression buffers, hashing, and writes so
the pipeline does not repeatedly rechunk or retain multiple large buffers.

For SMB operations, cap that chunk size further at the negotiated per-session
read/write maximum and let the protocol library's credit accounting throttle the
request window. Keep the default reader serialized; consider a small
credit-bounded offset-read window only after benchmarks show latency benefits on
servers that negotiate the required SMB2/3 capabilities.

## Backend HTTP APIs

### Browser and viewer routes

Extend `backend/app/api/browser.py` with remote archive browse routes beneath
the existing `/api/browse` prefix:

| Route | Purpose |
| --- | --- |
| `GET /{connection_id}/archive/list` | Return an `ArchiveDirectoryListing` for archive path, virtual entry path, cursor, and page size. |
| `GET /{connection_id}/archive/info` | Return metadata for an archive root or entry. |

Create `backend/app/api/archive_operations.py` for persisted operation routes
that can address local or SMB locations. Register it from `backend/app/main.py`
under `/api/archive-operations`.

| Route | Purpose |
| --- | --- |
| `POST /` | Prepare a typed operation request; validate every SMB location, reserve remote scope, and return a pending operation plus a one-time local-plan capability when a local location is involved. |
| `POST /{operation_id}/activate-local-plan` | Bind the Companion-validated, canonical local manifest and identities to the operation, then create the immutable plan and successor executor capability. |
| `GET /{operation_id}` | Current phase, progress, pending decision, and last error. |
| `POST /{operation_id}/accept` | Atomically claim an executor lease exactly once per lease epoch. |
| `POST /{operation_id}/heartbeat` | Renew the current executor lease epoch. |
| `POST /{operation_id}/decide` | Apply a validated existing-file policy, collision rename, retry, ignore, or cancel decision. |
| `POST /{operation_id}/cancel` | Request cancellation at the next chunk/member boundary. |
| `POST /{operation_id}/verify` | Record executor-side output validation before terminal success. |
| `POST /{operation_id}/complete` | Record verified terminal success. |
| `POST /{operation_id}/acknowledge-terminal` | Acknowledge a completed, cancelled, or failed operation without changing output. |

All operation transitions accept the expected current phase, lease epoch when
executor-originated, and idempotency key.
The decision route accepts only the currently pending member and its allowed
actions, and validates a requested collision rename before returning to
`streaming`.

Use ordinary user authentication for browser operation control routes. Companion
executor routes carry the operation credential in the `Authorization` header;
no operation credential appears in a URL or page body. The source-range body
contains `session_id`, `offset`, and bounded `length`; chunk writes additionally
contain `write_session_id`, `offset`, `byte_count`, `sha256`, and
`idempotency_key`. These fields, their response offsets, and the shared error
envelope are the transport contract for backend, Companion, and frontend work.

For SMB-only operations, preparation validates and persists the complete plan.
For any local source or destination, the backend treats browser-supplied local
paths as untrusted declarations: the authenticated Companion validates and
canonicalizes them inside its exposed drive boundary, resolves the local manifest
and identities, and submits it once through `activate-local-plan`. The backend
then verifies the declared operation scope and binds the returned canonical plan
hash before accepting an executor. No route lets a browser select arbitrary
local output paths after this activation.

Plan execution by physical ownership rather than by a cross-executor codec
intersection. The archive source owner parses and decodes each member with its
selected reader profile, then sends bounded uncompressed chunks through the
existing scoped transport to a different destination owner. The archive target
owner performs creation with its writer profile. Persist the source-reader and
target-writer profiles so a later capability change fails preparation or requires
a new plan; never silently downgrade the selected portable codec.

Extend `backend/app/api/viewer.py` with archive-entry file and download routes
under `/api/viewer/{connection_id}/archive/`. Refactor existing stream helpers
to accept the `source.py` readable-content adapter. The viewer must use the
normal parser for a creating or partial archive, serving usable entries and
returning an actual parse error otherwise.

### Companion-scoped backend routes

Extend `backend/app/api/companion.py` with operation-scoped endpoints used only
by the Companion after it accepts a mixed job:

- range read from an approved SMB source;
- open/close a lease-bound source-read session for an approved SMB archive or
  creation source;
- open/finalize an approved SMB archive target or direct extraction member;
- chunk write with offset, SHA-256 digest, and idempotency key; and
- executor heartbeat, progress, decision-state retrieval, and terminal report.

The operation credential is reusable until expiry. Do not treat ordinary reuse
as replay. Reject invalid scope/phase/expiry and deduplicate phase transitions,
range requests, and chunk writes with operation-scoped idempotency keys. Reject
all credential use after the operation reaches a terminal state.

Open one `ArchiveReadSession` per active remote archive/source operation. It
owns one operation-scoped `RandomAccessReader`, serializes its range requests,
and retains the matching SMB pool lease until it closes on finalization,
cancellation, lease loss, or idle timeout. A
source-range request names this session, accepts only a bounded offset and
length, and returns exactly that interval with its offset, length, and
source-identity metadata. The limit controls memory and retry cost, not archive
size; do not open an SMB handle per HTTP range request. A destination
write-session can create or finalize only the manifest-approved final archive
target or direct member path. Each chunk carries the operation and session IDs,
expected offset, byte count, SHA-256 digest, and idempotency key. Accept a retry
only when its acknowledged offset, length, and digest exactly match the prior
chunk; otherwise reject it without modifying output. Serialize chunk acceptance
per write session. If a provider reports an ambiguous write outcome, reconcile
by read-back of the exact target interval and digest before acknowledging it; if
the interval cannot be proven complete and identical, fail the session as
ambiguous and leave its direct output in place rather than retrying blindly.

For same-executor creation, one writer-side running SHA-256 records the output
digest while bytes are written. For mixed creation, sender and receiver each
maintain an independent running SHA-256 while the same output bytes flow; this
adds no second I/O pass, although per-chunk and whole-output hashing are
separate CPU work. Finalization compares the two whole-output digests, then
reopens the final target through `RandomAccessReader` for structural validation
of its EOCD/ZIP64 records, central directory, and local headers only; it must
not reread member payloads. Validate member CRC and byte count inline while
decompressed bytes are written, then mark the extraction session complete
without rereading its target file. Extraction sessions carry the current
collision policy and transition to `awaiting_user_decision` for an existing-file
conflict or write error without deleting direct output. Each executor request
also carries the current lease epoch; the transport delegates epoch and
idempotency validation to `ArchiveOperationStore` rather than keeping its own
transition state.

Every mutation must call the existing connection-access helpers for the relevant
source or destination. Check access at prepare time and again before each direct
write. Use explicit archive-specific action names in audit events.

## Companion Implementation

### Add archive modules and dependencies

Use `companion/src-tauri/src/server/archive.rs` for local ZIP parsing, local
range readers, direct extraction, direct ZIP creation, and local member content
streaming. Keep the direct and mixed endpoints in
`companion/src-tauri/src/server/handlers.rs` and register them in `server/mod.rs`.
They execute within the request that initiated the work; do not add a local job
acceptance, background worker, or recovery module.

After following the repository dependency-update workflow, add the Companion
writer dependency as:

```toml
zip = { version = "4.6.1", default-features = false, features = ["deflate-flate2-zlib-rs"] }
```

Use `zip::ZipWriter::new_stream()` only for direct archive creation. It does not
require `Seek`, and its lack of rollback APIs matches the direct-output policy.
Keep the central-directory parser incremental and custom; do not use
`zip::ZipArchive` as the reader, indexer, navigator, or extractor. Do not enable
AES, legacy encryption, or additional codecs in the first release. Do not use
pre-release `zip` versions or substitute `async_zip` without a new explicit
compatibility, security, and conformance decision.

Implement Python codec adapters for every available standard-library decoder
(currently Stored, Deflate, BZIP2, and LZMA when their modules are present) and
add another decoder only through the dependency workflow. Rust adapters receive
the same parser-validated bounded compressed range and must use the enabled
crate feature rather than a second archive parser. Every adapter checks
cancellation, declared compressed/uncompressed bounds, ratio and CPU limits,
and reports a normalized archive error. Encryption, multi-disk archives, links,
special files, unsafe extra fields, ownership, and permissions remain blocked by
policy even where a library exposes them.

Keep the Rust reader aligned through the language-neutral conformance corpus,
not duplicated policy constants or hand-maintained tests. The Companion executor
must include the backend-issued lease epoch in every bridge request, rotate to a
successor capability after each phase change, and stop direct output immediately
when its renewal or epoch check fails. Its executor loop uses the same
deadline-aware cancellation token contract as the backend: check between bounded
operations and best-effort close active local handles on cancellation.

### Mirror the local HTTP contract

Update `companion/src-tauri/src/server/models.rs` with Rust equivalents of the
shared archive listing, operation, decision, and error DTOs. Extend
`server/handlers.rs` and route registration in `server/mod.rs` with local-drive
equivalents of:

- archive list and info;
- archive member viewer/download;
- accept, heartbeat, status, decision, and cancel for jobs the browser assigns
  to the Companion; and
- direct local write sessions for local archive targets and extracted members.

Use the existing local-drive root-bound path validation before any source or
destination operation. A dereferenced symlink must remain inside the exposed
drive boundary. The write-session implementation must use the secure output-open
primitive at each final local target, rechecking component containment and target
type at open time rather than trusting preparation-time path validation.

### Implement mixed directions

Use `companion/src-tauri/src/http_client.rs` for authenticated, scoped backend
calls. The backend returns the prepared operation and short-lived local-plan
capability to the browser; the browser passes that scoped job to the
authenticated Companion local API. The Companion validates local paths and
activates the canonical plan with the backend before accepting execution. It
then initiates all backend calls because its local HTTP server is loopback-only.

| Source | Destination | Companion work |
| --- | --- | --- |
| SMB archive | Local directory | Fetch approved ranges, parse/decompress, and write direct local members. |
| Local archive | SMB directory | Parse/decompress locally and stream approved members to backend write sessions. |
| SMB files/directories | Local archive | Fetch approved source bytes and write an exclusive local target ZIP. |
| Local files/directories | SMB archive | Build ZIP bytes locally and stream them to an exclusive backend target. |

Backend-backed mixed directions use their persisted operation while the
foreground request remains live. They are not globally atomic. An interruption
may leave a partial final target; report it, do not attempt later cleanup,
rollback, or resume.

## Frontend Implementation

### Types, API client, and routing

Keep archive browse, extraction, creation, and backend operation calls in
`frontend/src/services/api.ts`. Keep direct local creation in
`frontend/src/services/companion.ts`; both direct-local create and extract take
an optional `AbortSignal`. Use
`frontend/src/services/foregroundArchiveOperation.ts` for the backend operation
ID marker and the in-memory direct-local abort controller. Do not add an
active-operations query, polling loop, durable status cache, or re-entry route.

Extend File Browser URL parsing in `frontend/src/pages/FileBrowser/routing.ts`
with separate physical directory, archive filename, and virtual entry-path
fields plus an optional current-view encoding override. Do not overload the
ordinary `path` field with a synthetic archive path, and do not persist that
override as archive metadata.

### Pane state and navigation

`ArchiveBrowser.tsx` owns archive virtual navigation and its foreground
extraction workflow. `FileBrowser.tsx` owns archive creation and the page-level
interruption handlers. The archive-specific behavior is:

- model either a physical location or an `ArchiveLocation`;
- keep any user-selected legacy encoding in current browser state and the
  archive URL fields only;
- fetch and append cursor pages for archive directories;
- preserve archive identity while paging and, on a stale archive error, retain
  the visible archive context with an explicit refresh/reopen action rather than
  silently moving to the physical parent;
- open a ZIP with `Enter`, descend virtual directories, and make `Up` from the
  virtual root return to the physical parent;
- disable in-archive rename, delete, copy, move, and new-item actions; and
- keep cancellation, progress, errors, and pending user decisions in the active
  dialog only; do not retain a global active-operation state after navigation
  or reload.

Update `BreadcrumbsNavigation.tsx` to render physical segments, an archive-icon
boundary segment, and virtual segments. Physical segments navigate the real
filesystem, the archive segment opens its virtual root, and virtual segments
navigate inside the archive.

Update `FileList.tsx`, `FileRow.tsx`, `DynamicViewer.tsx`, and viewer API call
sites so archive entries use archive metadata and archive content URLs. A partial
archive remains selectable: render an actionable in-progress or incomplete state
with retry, physical-location, and optional technical-detail actions instead of
raw parser text. Render readable, policy-blocked, and unavailable codec states
with text, icon, and accessible explanation; do not rely on color or make a
blocked member appear broken.

### Commands, dialogs, and decisions

Add `browser.extractArchive` and `browser.createArchive` to
`config/browserCommands.ts`; add `Alt+F9` and `Alt+F5` definitions to
`config/keyboardShortcuts.ts`. Include both in command search and keyboard help.

Use the existing focused File Browser components:

- the extraction dialog owned by `ArchiveBrowser.tsx`: choose target
  directory/name and confirm the
  single-pane or other-pane destination. In a single pane, default to a sibling
  basename-derived directory; in dual-pane mode, require confirmation before
  using the other pane's writable physical directory. Existing target
  directories remain in place. Before acceptance, show source and destination
  connection/location, selected count and known total size, existing-directory
  effect, known collision count, and the direct-output warning.
- `NameInputDialog.tsx` for creation: ZIP type, archive name, selected-source summary,
  conflict summary, and preflight errors. Creation has no replace, merge, or
  skip option: reject existing targets, duplicate normalized names, insensitive
  name collisions, and targets inside selected source directories. Offer ZIP
  only; default the destination to the current physical directory in a single
  pane or the other pane's writable physical directory in dual-pane mode. Show
  source and destination connection/location, selected count and known total
  size, portable Deflate-level-6 profile, conflict count, and the direct-output
  warning before acceptance.
- the conflict dialog path in `ArchiveBrowser.tsx`: existing-file choices,
  internal collision rename, retry, ignore, and cancel. It continues the
  current foreground backend operation through the decision route; reload or
  navigation does not resume it. For an
  ambiguous extraction encoding, use the compact `ResponsiveFormDialog`
  decision pattern before any output directory or writer is opened: recommend
  the browser-locale candidate, preview affected names, offer CP437 and More
  encodings, and focus the cancellation action initially. Inspection instead
  shows a non-blocking encoding control. Group
  preflight-discovered existing-file collisions with count and representative
  source/destination paths, sizes, and timestamps; use a non-destructive
  initial focus, while final-open races use the same single-member decision
  presentation. Show rename validation beside the proposed archive-relative
  path.
- do not add `ArchiveOperationStatus.tsx`, a pane-integrated global status UI,
  or an active-operations affordance. The active Create/Extract dialog shows
  cancellation and any available result. It remains open while work is active;
  closing the archive browser is gated during extraction. Reload shows only an
  interruption notice after best-effort cancellation.

Follow the existing responsive form/dialog pattern. Add all visible strings to
`frontend/src/i18n/resources.ts`, then extend localization typing tests. Use
i18next plural forms and typed interpolation for file/collision/outcome counts,
bytes, elapsed time, and current-member status. Format numbers, byte sizes,
durations, and archive-local timestamps through the existing locale-formatting
utilities; label timestamp timezone and ZIP precision without converting the
stored archive value as UTC. Map structured archive error and capability codes
to translation keys with safe display-path interpolation and optional redacted
technical details, never directly to backend error text.
Define initial focus, focus restoration to the invoking row/command, keyboard
access to every decision and cancellation, labelled error associations,
screen-reader live announcements for phase/progress/decision changes, and
non-color-only status indications.

For an existing regular file, offer skip this file, skip all existing files,
replace this file, replace all existing files, and replace all existing files
only when the archive member is strictly newer. Persist only the all-files
policy. When the timestamps are unavailable or incomparable, the newer-only
policy skips the file and records that outcome. A file/directory type conflict
is an error, not a replace choice. Make the common choice and cancellation
available with direct keyboard focus/shortcuts as well as pointer interaction.

## Extraction and Creation Algorithms

### Direct extraction

1. Prepare an operation and inspect the full central-directory manifest.
2. Resolve legacy decoding before any output directory or writer is opened. If
  ZIP metadata is not authoritative, candidates produce different normalized
  paths, and browser locale preference would choose one, wait for the compact
  encoding confirmation decision. Persist the confirmed decoding only in the
  operation plan. If no candidate produces safe, non-colliding paths, fail
  extraction without writing output.
3. Validate member names, source access, and destination access. Detect internal
  output collisions without rejecting the archive, then preflight manifest paths
  against the destination with bounded provider-aware checks and present known
  regular-file collisions as one grouped decision before streaming. Persist any
  user-approved directory-subtree remapping or all-files policy before its first
  affected write. Final output open still revalidates containment, type, and
  collision disposition to handle destination changes after preflight.
4. Create missing directories directly. Keep existing directories unchanged.
5. Resolve all collision remaps before streaming file payloads. Process regular
  members in ascending local-header/data offset order to minimize remote seeks,
  while keeping the persisted remap independent of I/O order. For each file,
  use the secure output-open primitive to revalidate containment, file/directory
  type, and the selected collision disposition, then stream/decompress to its
  final path in bounded chunks.
6. On an existing regular file, transition to `awaiting_user_decision`; apply
  the chosen single-file or persisted all-files policy when resumed. For the
  newer-only policy, replace only with a valid member timestamp strictly newer
  than the destination timestamp; otherwise skip and record it.
7. On write/decompression/CRC failure, transition to `awaiting_user_decision`
   with retry, ignore, and cancel. Do not clean direct output.
8. Compute byte count and CRC from decompressed chunks as they are accepted by
  the output writer; after close, record that in-stream verification and restore
  only the member modification time. Do not reread the extracted target. Treat
  a file/directory type conflict as an error rather than replacing either target.

### Direct archive creation

1. Resolve and dereference selected sources once, rejecting sources outside the
  provider boundary or inaccessible to the user, then build and persist the
  complete manifest and conflict report used by the dialog and executor. Read
  hard links as independent ordinary file content and record only allowed
  modification timestamps, not permissions, ownership, ACLs, extended
  attributes, executable bits, or alternate data streams. Before opening the
  final target, reserve the configured byte budget for writer-held
  central-directory metadata using the complete manifest; fail preparation with
  a specific resource-exhausted error when it cannot fit. Streaming output does
  not make standard ZIP writers' per-entry finalization metadata bounded.
2. Reject unavailable sources, duplicate archive names, an existing final target,
   and an output target inside any selected source directory.
3. Open the final target exclusively and stream ZIP output directly to it. Use
  ZIP data descriptors so the source is read exactly once: calculate each
  member's CRC and sizes while compressing it, then write those values after its
  payload rather than pre-scanning source content. The portable writer emits
  source spelling after validation with `/` separators and the UTF-8 flag,
  explicit entries for empty directories, and only regular-file/directory
  entries. Emit no archive/member comments, symlink, append, raw-copy, or
  library path-normalized entries. Permit only ZIP64 (`0x0001`) and Extended
  Timestamp (`0x5455`) extra fields; set version-needed-to-extract to 2.0 for
  Stored/Deflate and 4.5 only when ZIP64 is necessary. Do not emit ZIP64 for a
  known sub-threshold member because of a library default. Write standard signed
  data descriptors. Convert each source modification instant to the persisted
  IANA timezone, round its DOS value down to two-second precision, and emit its
  UTC Extended Timestamp; omit both timestamp fields when the source time is
  unavailable. Default to Deflate at zlib level 6 in the portable
  Stored/Deflate profile. For every regular-file member, read at most 64 KiB
  once before opening its ZIP entry, compress that bounded sample with the same
  Deflate settings, and select Stored only when it saves less than 1 KiB and
  less than 5 percent after method overhead. Write the already-read probe buffer
  into the selected entry,
  then continue streaming the source; do not classify by extension alone, trial
  compress an entire member, or reread source bytes. Persist the per-member
  method in the immutable manifest so retries reproduce the same output. Do not
  offer native codecs in the first release. The complete manifest records every
  source size before writing begins, so writers emit ZIP64 only when the known
  member, archive, or entry-count limits require it. Python uses a non-seekable
  writer adapter with `allowZip64=True` but does not force ZIP64 for an unknown
  member; Rust uses `ZipWriter::new_stream()` and never invokes rollback APIs
  unsupported by its destination.
4. Explicitly finish or close the writer and flush the exclusive destination;
  never rely on writer drop/destruction, which can hide finalization errors.
  If a member write, finalization, or flush fails, stop the operation and report
  the exclusive target as partial. Otherwise compare only the topology-required
  output digests, and structurally validate the generated ZIP through a random
  reader without rereading member payloads before completing the job.
5. On an active-handle failure, call `abort_and_delete_if_owned()` once. On a
   later failure, disconnect, crash, or restart, report the target as possibly
   partial and leave it for the user.

## Test Plan

| Layer | Files to add or extend | Coverage |
| --- | --- | --- |
| Backend storage | `backend/tests/test_smb_backend.py` | Random reads, EOF, deterministic closure, raw offset-read behavior, negotiated-size/credit clamping, one-handle serialization, read-session pool-lease/handle reuse, CREATE identity reuse, source/output share modes, security-policy propagation, separate concurrent handles, exclusive creation, readable active target, secure output-open race handling, abort ownership, and timeouts. |
| Backend archive service | New `backend/tests/test_archive_*.py` plus language-neutral fixtures | EOCD/ZIP64, self-extracting prefixes, data descriptors, all known method identifiers, per-profile readable/blocked/unavailable states, malformed/encrypted/multi-disk archives, encodings, cursor paging, stale identity, indexed external-sort pages, byte-budgeted derived-metadata cache/spill behavior, portable Deflate-level-6 selection, bounded no-reread Stored selection, creation writer-metadata budget, authorization revocation, heartbeat expiry without resumption, and reader/writer conformance corpus results. |
| Backend routes/operations | `backend/tests/test_browser.py`, `test_viewer.py`, new `test_archive_operations.py` | Authorization, typed locations, Companion local-plan activation, immutable plans, source-reader and target-writer capability selection, capability-plan hash mismatch, lease claim/expiry races, stale-epoch cancellation, request-hash idempotency receipts, ambiguous-write reconciliation, operation phases, decisions, partial target behavior, and audit events. |
| Companion | Unit tests adjacent to archive modules plus handler tests | Local parsing/writing, all enabled decoder adapters, shared profile-aware conformance corpus, bounded CPU worker capacity, secure output-open path races, local-plan activation, scoped bridge calls, stale-epoch handle closure, foreground cancellation limits, and all mixed directions. |
| Frontend services | `foregroundArchiveOperation.test.ts`, `companionService.test.ts`, plus browse and viewer service tests | Remote/local endpoint resolution, typed archive DTOs, backend marker storage, direct-local abort signals, reload cancellation recovery without re-entry, locale-ranked automatic decoding, selected-decoding/cursor stability, URL state, operation calls, and structured error mapping. |
| Frontend components | Dialog tests, `ArchiveBrowser.test.tsx`, and `FileBrowser-archive-interruption.test.tsx` | Commands, shortcuts, breadcrumbs, URL history, explicit stale-archive refresh, paging, archive-specific actions, preflight summaries, grouped conflicts, codec states, read-only actions, conflict choices, localized plural/count/size/time presentation, pseudo-locale and RTL layout, progress, partial archive messaging, reload cancellation recovery, pagehide/beforeunload behavior, terminal summaries, and keyboard/screen-reader dialog behavior. |
| End to end | Existing browser flow suites plus focused archive scenarios | Single pane, dual pane, SMB/local combinations, cancellation, retries, and visible partial output. |

The focused suites must also cover source-size/modified-time changes; opening a
partially usable archive and returning the real error for an unusable one;
traversal through both slash types; archive links and special files; Unicode Path
CRC validation and ambiguous-encoding selection; creation name collisions on
case-insensitive and Unicode-normalizing destinations; each persisted
existing-file policy; file/directory conflicts; directory-subtree collision
renames; CRC/write failure retry/ignore/cancel; source-range interval integrity;
credential reuse versus invalid transition replay; exact chunk retry matching;
write-session path scope; permission revocation; and backend/Companion restart
reporting without automatic cleanup. Include competing executor claims,
phase-capability rotation, response-lost idempotency retries and request-hash
mismatch rejection, stale lease-epoch cancellation/handle closure, ambiguous SMB
write reconciliation/failure, read-session handle reuse and idle closure, local
path-component swap/type races, index byte-budget exhaustion/external paging,
single-pass source creation with data descriptors, portable and native target
writer profiles, deterministic Deflate-level-6 and bounded Stored selection,
writer finalization and flush failures, inline extraction CRC verification,
source-owner decoding across mixed routes, SMB
policy/credit/handle telemetry, explicit Rust feature/policy rejection, and
cross-language profile-aware reader/writer fixture conformance in the required
failure coverage. Include direct-output warning acknowledgement, pagehide and
reload cancellation recovery without re-entry, grouped collision presentation with final-open races,
capability-state explanations, partial/in-progress archive actions, explicit
stale-archive refresh, terminal outcome summaries, and keyboard/screen-reader
status announcements in the frontend/end-to-end coverage. Verify locale changes
during an active operation, long translated labels, pluralized summaries,
archive-local timestamp labels, and unchanged member decoding/cursor order.

Run focused checks after each slice:

```bash
cd backend && .venv/bin/python -m pytest tests/test_smb_backend.py tests/test_archive_*.py tests/test_browser.py tests/test_viewer.py
cd frontend && npm run test -- --run src/services/__tests__/archiveApi.test.ts
cd companion && cargo test
```

Run the applicable type and lint checks before merging. Do not change lockfiles
or add Rust dependencies without following the repository dependency workflow.

## Delivery Slices

1. **Contracts and storage:** backend archive DTOs, database migration, random
   reader, exclusive writer, and SMB tests.
2. **Read-only ZIP browsing:** parser, index, paged archive routes, local
   Companion parity, URL state, breadcrumbs, and archive viewer/download.
3. **Same-provider operations:** manifest validation, direct extraction,
  direct creation, collision/error decisions, and foreground dialogs.
4. **Foreground operation lifecycle:** immutable operation plans, scoped
  credentials, heartbeat expiry, cancellation, interruption reporting, and
  auditing without a worker queue or resume path.
5. **Mixed execution:** Companion backend bridge and all four SMB/local paths.
6. **Hardening:** encoding override UI, scalability tests, failure behavior,
  capability-denial behavior, accessibility, and end-to-end coverage.
7. **Additional formats:** separate TAR adapter design, then dependency and
   licensing evaluation for 7z/RAR.

## Completion Criteria

The ZIP feature is complete when the following are true:

- Physical SMB and local archive paths open with `Enter`, page through virtual
  contents, and retain correct history/breadcrumb behavior.
- Archive entries view and download without staging the source archive.
- `Alt+F9` and `Alt+F5` work in single and dual panes, including every required
  SMB/local direction.
- Extraction provides all requested existing-file, collision, and error
  decisions while preserving direct output on cancellation.
- Creation never overwrites an existing target, rejects self-inclusion, and
  clearly reports partial targets when direct output fails.
- Backend and Companion enforce the same path, permission, credential, chunk,
  lease epoch, and idempotency rules.
- No executor can mutate an operation after its lease expires or another
  executor claims a newer epoch; interruption reports partial direct output
  rather than resuming it.
- Python and Rust archive readers pass the same versioned conformance corpus.
- Unsupported providers fail clearly without staging or copying source archives,
  and resource controls bound active work without implying a deferred queue or
  imposing an archive-size cap.
- SMB archive sessions preserve required signing and configured encryption while
  reusing negotiated, credit-aware handles without requiring unsupported SMB3
  durability or multichannel features.
- The focused tests above and the relevant backend, frontend, and Companion
  validation suites pass.
