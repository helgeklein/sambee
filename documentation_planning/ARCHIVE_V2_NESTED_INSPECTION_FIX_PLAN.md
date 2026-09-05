# V2 ZIP Nested Inspection Fix Plan

## Objective

Restore reliable browsing of directories inside ZIP archives for both SMB and
local-drive sources. A route such as `archive.zip/Test dir` must list its
immediate children instead of returning an inspection error.

The implementation must preserve a single, equivalent user-facing contract
across the Python backend and the Rust Companion. It must keep usable content
available when an archive also contains an unusable member, and reject an
operation only when the ZIP structure or source cannot be handled safely.

## Problem

The File Browser already parses archive-internal route segments and requests
them as `virtual_path`. The V2 inspection endpoints currently reject every
non-empty `virtual_path` because their readers return raw, record-order
central-directory pages only.

This affects both source types:

- SMB: `backend/app/api/browser.py` rejects the path before invoking
  `ZipReader`.
- Local drives: `companion/src-tauri/src/server/handlers.rs` has the matching
  rejection before invoking `LocalArchiveReader`.

The result is a frontend warning, "Archive contents could not be loaded," for
any archive subdirectory even when the ZIP is valid.

## Scope

### In scope

- ZIP archive root and nested directory inspection.
- Explicit and inferred directories. For example, `reports/2026/q1.pdf` must
  make both `reports` and `reports/2026` browseable even if the ZIP has no
  directory records.
- Stateless, paginated directory results for SMB and local sources.
- One shared source-entry projection for inspection, preview/download, and
  direct and relayed extraction.
- Central definitions for member failures, duplicate selection, directory
  inference, and file/directory hierarchy conflicts.
- Shared aggregate accounting for skipped and failed extraction work.
- Focused backend, Companion, API, and File Browser regression coverage.

### Out of scope

- Archive creation behavior changes.
- Cross-request archive indexes or durable inspection sessions.
- Nested archives stored as members of an archive.
- Global sorting, exact archive-wide totals, or loading archive payloads during
  inspection.
- Destination-specific collision resolution. Existing target-collision handling
  remains responsible for paths that alias on the destination filesystem.

## Target Contract

`GET .../archive/v2/.../list` accepts `virtual_path` as a safe, canonical ZIP
directory path. `""` selects archive root.

Each response represents exactly one virtual directory:

- `path` is the canonical requested virtual directory.
- `items` contains each immediate child once, never recursive descendants.
- A directory can be explicit in the ZIP or inferred from a safe descendant.
- A file is shown with its full canonical member path, and a directory is shown
  with its canonical virtual path.
- Response ordering follows selected entries' final central-directory record
  positions. This is deterministic without imposing a global name sort.
- A missing directory returns a not-found inspection error. A path that resolves
  to a file returns a directory-path error.

### Shared source-entry projection

Each ZIP reader creates one request- or operation-scoped
`EffectiveArchiveProjection` from decoded central-directory records. This is
the authority for archive input interpretation; API handlers, presenters, and
destination-collision code do not choose source records independently.

The projection contains:

- selected regular entries by exact canonical virtual path, retaining their
  original reader-bound parsed entry objects and source-record positions;
- explicit and inferred directories by exact canonical virtual path;
- an exact member lookup for preview, download, and extraction; and
- the disposition and diagnostic reason for each non-selected or unusable raw
  record.

The Python and Rust implementations may use native types, but must implement
the same behavior and fixtures. The existing path normalization, entry safety
classification, local-header validation, and extraction destination-collision
handling are reused rather than reimplemented. Member reads and extraction pass
the selected original entry into the existing local-header validation and
streaming APIs; they do not reparse or independently resolve a member by path.

Preserve current filename decoding: UTF-8-flagged names with malformed byte
sequences use replacement decoding, unflagged legacy names use the existing
CP437 fallback, and validated Info-ZIP Unicode path metadata continues to take
precedence. Apply ordinary path normalization and safety classification after
decoding, identically in Python and Rust.

### Duplicate policy

To avoid showing metadata for one record while reading or extracting another
record with the same path, all input consumers use these selection rules:

- Normalize separators using the existing ZIP path rules, but do not NFC-fold
  or case-fold source paths. Case-distinct archive members remain distinct.
- For duplicate exact or slash-normalized regular-file paths, the final
  path-safe, supported-type regular record wins.
- A later unsafe or unsupported-type record is ineligible and does not replace
  an earlier eligible record with the same canonical path.
- Evaluate encryption and compression availability after selection. A final
  unavailable record remains unavailable; never fall back to an older readable
  duplicate.
- For duplicate explicit directory records, retain the final eligible record.
- Case-distinct paths remain distinct.

An eligible record is decoded, path-safe, and a supported ZIP file type.
Encryption and compression availability do not affect selection of a regular
file.

### File and directory hierarchy policy

A ZIP may contain both a regular file and a descendant path, such as `report`
and `report/jan.txt`. This is a valid ZIP layout, although a normal destination
filesystem cannot represent both. It does not invalidate the archive or remove
either selected source entry.

The same policy applies to an exact file/directory pair, such as `report` and
`report/`.

- **Browser presentation:** the regular file is shown at `report`; `report` is
  not presented as a directory, and `report/jan.txt` is not reachable through
  the virtual browser tree.
- **Extraction:** retain both selected entries. Process them in deterministic
  selected central-directory order and pass each write through the existing
  destination target-resolution and collision flow.
- **Result:** whichever member cannot be created because of the destination's
  current file/directory state receives a member-level destination-conflict
  outcome. Continue with unrelated members.

Infer browser directories only from selected regular entries with no selected
regular-file ancestor. This presentation rule does not remove descendants from
the extraction source projection.

Only selected explicit directory records are extraction work items, in their
selected central-directory order. Inferred directories exist only for browser
presentation; regular-file target preparation creates needed destination parent
directories through the existing flow.

### Failure and accounting policy

Use member-level outcomes wherever safe; do not turn one unusable member into
an archive-wide inspection or extraction failure.

Reuse existing aggregate counters, collision-decision flow, member-error
handling, and partial-output signal. Do not add a per-member extraction outcome
ledger, new completion status, or new partial-failure object for this work.

An unsafe raw member has no safe member path to persist. It is therefore an
aggregate-only skipped source record: increment the existing skipped counter,
retain an internal diagnostic, and do not create a member completion. A safe
canonical path with an unsupported special type can likewise be counted as
skipped without adding a new persisted reason field.

| Condition | Inspection and member reads | Extraction |
| --- | --- | --- |
| Central-directory structure, record boundaries, or source open failure | Fail the request or operation. | Fail before delivery begins. |
| Local-header validation, payload bounds, or source read failure during a member | Fail the request. | Fail on discovery; retain previously committed validated outputs and report a partial failure. |
| Unsafe path | Do not expose the member or infer directories from it; retain an internal diagnostic disposition. | Count it as aggregate-only skipped work and do not persist its unsafe raw path. |
| Safe path with unsupported special type | Do not expose the member or infer directories from it; retain an internal diagnostic disposition. | Count it as skipped work. |
| Encrypted or unsupported-compression regular member | List it as unavailable; direct reads fail with its specific reason. | Count it as skipped work. |
| Missing virtual directory | Return not found. | Not applicable. |
| Requested virtual path is a file | Return not-a-directory. | Not applicable. |
| File and directory hierarchy conflict | Show the selected file and hide its virtual subtree. | Process both members in selected central-directory order and use the existing collision/skip behavior. |

An operation-level result must clearly distinguish completed entries from
skipped entries and a structural/source failure discovered after output began.
The existing failed operation phase and partial-output signal represent a source
or integrity failure after output began; retained successful and skipped ledger
entries describe the partial result. It must not silently report a complete
successful extraction when selected members could not be written.

## Design

### Directory projection

Add a directory projection operation to each reader:

```text
list_directory(virtual_path, cursor, page_size) -> DirectoryPage
```

The operation builds or reuses the shared projection. It scans the complete
central directory forward, classifies every record, and determines whether each
selected record is:

1. a direct file in the requested directory;
2. an explicit direct child directory; or
3. evidence for one inferred direct child directory.

Return selected immediate children keyed by exact canonical child path. After
projection, order candidates by selected source-record position and return the
requested page.

The projection retains central-directory metadata for its request or operation;
it never stages member payload bytes. This replaces the current page-only
record-order model so duplicate selection and inferred-directory construction
have one consistent source of truth.

Inspection, member lookup, direct extraction, and relay source delivery must
all consume the same projection. Do not duplicate selection or availability
logic in API handlers, presentation code, or extraction planners.

For inspection, build a fresh projection for each request. For extraction,
build one immutable projection before member delivery and retain it only for
that operation. No projection crosses a request or operation boundary.

### Cursor and archive revision handling

Directory projection cannot use the current central-directory-position cursor:
the full scan is necessary before a page of distinct immediate children is
known. Introduce a versioned directory-list cursor containing only:

- a cursor kind and schema version;
- the canonical virtual path;
- the projected-result offset; and
- the archive's best-available revision identity (size and modified timestamp).

For each continuation request, reopen and rebuild the projection, verify the
cursor context and source revision, then apply the offset. This keeps the
protocol stateless. Return typed `archive_changed` only when comparable source
identity values demonstrably differ. If a source does not provide a comparable
timestamp or revision value, retain best-effort continuation rather than reject
the cursor. Only for `archive_changed`, the frontend discards the stale cursor
and reloads the first page of the same virtual directory.

V2 is not deployed, so replace its current raw record-order cursor with this
directory-list cursor rather than retaining a legacy cursor path.

## Implementation Phases

### Phase 1: Contract and backend SMB implementation

1. Update source-session accounting so unsafe paths, safe unsupported types,
   encrypted entries, and unavailable codecs use existing skipped accounting
   rather than failed member completions. Reuse existing collision decisions,
   member-error handling, and partial-output behavior without adding a
   per-member extraction ledger.
2. Add shared behavior fixtures and failing reader/API tests for a nested
   `virtual_path`, inferred directories, member-level failures, and duplicates.
3. Extract the existing source-entry normalization, safety classification, and
  parent-directory enumeration helpers where necessary.
4. Add request- and operation-scoped `EffectiveArchiveProjection` instances to
  `ZipReader`; retain original reader-bound selected entries and source-record
  positions. Use them for directory listing, selected member lookup, direct
  extraction, and SMB relay source delivery.
5. Replace `ZipReader.inspection_page()` usage with a directory-list method
  over the projection. Retain the existing forward central-directory and
  local-header validation mechanics.
6. Implement the versioned directory cursor, typed `archive_changed` error,
   and frontend source-revision recovery.
7. Remove the non-empty `virtual_path` rejection in
   `backend/app/api/browser.py`; return the resolved `path` in the listing.
8. Keep `archive_operations.py` as a thin V2 contract wrapper.
9. Refactor extraction planning to consume the shared source projection and
  map source classification into existing skipped or failed counters without
  altering destination collision policy.

### Phase 2: Companion parity for local drives

1. Implement the equivalent projection and cursor model in
  `companion/src-tauri/src/server/archive.rs` by reusing its existing entry
  normalization and parent-path enumeration helpers. Retain original selected
  entries for local-header validation and streaming.
2. Update local and relay source-session accounting to use the same existing
  skipped and failed counters as the backend; do not add a member ledger.
3. Make local member reads and extraction consume the projection.
4. Pass `virtual_path` through `ArchiveDirectoryListingPresentation`.
5. Remove the local rejection in `handlers.rs`.
6. Use the same fixture matrix and expected behavior as the Python reader.

### Phase 3: Frontend regression coverage and operational checks

1. Retain the existing archive route model; it already sends `virtual_path`.
2. Replace error-oriented tests with route tests that verify nested archive
   content is rendered and the warning is absent.
3. Verify archive breadcrumb navigation, back navigation, and pagination from a
   nested directory.
4. Run the targeted checks below, then manually reproduce the reported SMB
   route against the demo archive.

## Test Matrix

Use shared fixture scenarios where practical, and implement identical focused
assertions in Python and Rust:

| Scenario | Expected result |
| --- | --- |
| Root files and directories | Immediate root children are listed. |
| Nested explicit directory | Direct children are listed. |
| Nested inferred directory | Directory and its contents are browseable. |
| Scattered source records | A projected page is complete despite non-contiguous central-directory records. |
| Pagination | No missing or repeated projected children across pages. |
| Exact and normalized duplicates | One final selected item; preview/download and extraction use it. |
| Case-distinct names | Separate visible items and exact-case reads. |
| Safe older duplicate followed by unsafe/special record | The later ineligible record does not replace the older eligible entry. |
| Unavailable final duplicate | One unavailable item; no fallback; extraction increments existing skipped accounting. |
| Unsafe member with safe siblings | Safe siblings remain browseable; unsafe member is not exposed and increments existing skipped accounting without persisting its unsafe raw path. |
| Safe unsupported-type member with safe siblings | Safe siblings remain browseable; unsupported member is not exposed and increments existing skipped accounting. |
| Exact file/directory pair | Browser shows the file; extraction processes both selected records in source order and records any terminal destination conflict. |
| File before descendant | Browser shows the file; extraction skips the descendant with `destination_conflict` and continues. |
| Descendant before file | Browser shows the file; extraction preserves the descendant and skips the file with `destination_conflict`. |
| Structural error before delivery | No extraction member is written. |
| Structural/source error during delivery | Prior validated outputs remain; existing failed phase and partial-output signal describe the partial result. |
| Confirmed cursor source revision mismatch | Backend returns `archive_changed`; frontend reloads only this error from the first page. |
| Incomplete source revision metadata | Continuation remains best effort and is not rejected solely for missing comparison data. |
| ZIP64, CP437/UTF-8, Unicode-path extra, and empty directories | Existing supported archive forms remain browseable. |
| Malformed UTF-8 filename metadata with safe siblings | Preserve existing replacement decoding, then apply ordinary path-safety checks identically in Python and Rust. |
| Large central directory | Projection is equivalent in Python and Rust and reads no member payload bytes during inspection. |

Targeted validation commands after implementation:

```bash
cd /workspace/backend && .venv/bin/python -m pytest tests/test_archive_zip_reader.py tests/test_browser.py -q
cd /workspace/companion/src-tauri && cargo test archive
cd /workspace/frontend && npm run test -- FileBrowser-url-routing
cd /workspace/frontend && npm run lint
```

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Shared projection changes extraction selection | Add input-side compatibility fixtures before refactoring each extraction path. |
| Source classification adds a result protocol | Use existing aggregate counters, collision decisions, member errors, and partial-output signaling; add no member ledger or statuses. |
| ZIP omits directory entries | Materialize directories from safe descendant paths. |
| Duplicate entries produce inconsistent behavior | Reuse the projection for inspection, reads, extraction, and relay delivery. |
| File/directory layouts have no universal filesystem representation | Keep all selected source entries, process in deterministic order, and record member-level destination conflicts. |
| SMB and local behavior drift | Share fixtures and mirror the test matrix in both implementations. |
| Archive changes between pages | Return typed `archive_changed` only for a confirmed identity mismatch; reload only that error. |
| A source fails after some members were written | Preserve committed outcomes and use the existing failed phase plus partial-output signal. |

## Acceptance Criteria

- The reported SMB route `demo/archive.zip/Test dir` renders its contents with
  no archive-load warning.
- The equivalent local-drive archive route behaves identically.
- Direct and inferred ZIP directories are browseable at arbitrary depth.
- Pagination is deterministic and free of missing or duplicate visible items.
- A displayed duplicate-path member is previewed, downloaded, and extracted
  from the same selected archive record.
- A usable archive remains browseable and extractable when it contains an
  unrelated unsafe, encrypted, or unsupported member.
- Unsafe raw member names are never persisted as extraction member paths; they
  contribute only to aggregate skipped accounting.
- Safe unsupported-type, encrypted, and unavailable-codec members use existing
  skipped accounting without introducing a per-member extraction ledger.
- A file/descendant collision does not reject the archive: the browser has a
  coherent tree and extraction uses the existing skip outcome with a typed
  destination-conflict reason where needed.
- Exact file/directory pairs follow the same presentation and extraction policy
  as file/descendant conflicts.
- A structural error before delivery prevents output; a source or member
  integrity failure during delivery preserves committed outcomes and uses the
  existing failed phase plus partial-output signal.
- A stale archive cursor receives `archive_changed` and refreshes only that
  directory from its first page.
- Focused backend, Companion, and frontend tests pass with existing
  destination-collision behavior unchanged.
