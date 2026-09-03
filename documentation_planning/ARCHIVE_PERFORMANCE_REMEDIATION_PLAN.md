# Archive Performance Remediation Plan

## Goal

Make ZIP inspection, browsing, member delivery, extraction, and creation scale
with archive data rather than with avoidable SMB round trips. The work addresses
all findings from the ZIP performance review while preserving the current ZIP
safety, integrity, collision, and streaming guarantees.

## Implementation Order

Implement the work in this order, validating each independently deployable step
before beginning the next:

1. Phase 0: establish operation-count baselines and compatibility
   characterization.
2. Phase 1.1: batch central-directory reads and establish the immutable parsed
   entry tuple.
3. Phase 2: remove redundant per-member validation and local-header reads using
   validated streaming descriptors.
4. Phase 1.2 and Phase 1.3: add request-local metadata reuse and the
   duplicate-member resolution policy, passing their selected `ZipEntry` through
   the established descriptor-based streaming contract.
5. Phase 3: coalesce backend ZIP writer metadata writes; optimize the
   Companion writer only if Phase 0 operation counts demonstrate fragmented
   metadata writes in a supported topology.
6. Phase 4: replace per-target extraction preflight stats with ordinary
   complete directory listings while retaining the final race-safe write
   observation.
7. Phase 5: complete cross-phase regression coverage, observability, and SMB
   integration checks before broad rollout.

## Scope And Invariants

The implementation must preserve these properties throughout every phase:

- Never stage an archive or a source member solely to improve throughput.
- Keep bounded I/O chunks and streaming CRC and size validation.
- Validate a member before committing HTTP response headers.
- Preserve local-header versus central-directory consistency checks.
- Preserve extraction collision semantics and the final just-before-write
  observation that protects against races.
- Bound request-scoped index construction. Archive inspection metadata and
   readers are released when their request completes; no inspection state
   survives the reader/request that created it.
- Apply the shared effective-entry projection defined in the amendment below to
   every path-based inspection, delivery, and extraction flow.
- Do not introduce unbounded SMB concurrency or weaken SMB credit protection.
- Preserve archive ordering, cursor behavior, API response schemas, and existing
  supported-codec behavior unless a versioned API change is explicitly approved.

## Deferred Hardening

This plan does not add archive metadata-complexity admission limits, an
`archive_too_complex` error, or file-versus-descendant archive rejection rules.
Those policy changes require a separate compatibility and resilience proposal.
The shared effective-entry policy intentionally retains compatible archives
without exposing an API for addressing individual duplicate occurrences.

## Amendment: Shared Effective-Entry Projection

This amendment is the single implementation and acceptance checklist for
duplicate ZIP member handling. It replaces the original extraction requirement
to traverse every duplicate record.

### Policy

- Keep every parsed central-directory record for format validation and
   diagnostics.
- For each normalized virtual file path, select only the last safe regular
   record with a supported file type. This matches Python `zipfile` named-member
   lookup and is the only record displayed, delivered, or extracted for that
   path.
- Normalization for this policy replaces backslashes with slashes and applies
   the existing safe-path rules; it does not case-fold names. `Report.txt` and
   `report.txt` remain distinct archive members, are both visible in inspection,
   and are both eligible for extraction.
- Preserve central-directory order among selected records. If selected records
   occur at positions $i_1 < i_2 < \dots < i_k$, process them in that order.
- A trailing directory record must not mask an earlier selected regular file.
- If the selected record is encrypted or uses an unavailable codec, never fall
   back to an earlier duplicate. Report or skip it according to the existing
   unavailable-member policy.
- Preserve existing rejection of unsafe paths, unsupported special file types,
   file-versus-directory conflicts, and file-versus-descendant conflicts.

### Implementation

1. Add one internal, request-local effective-entry projection in each runtime.
    It consumes the immutable parsed central-directory sequence, walks it in
    reverse, retains the first record for each normalized path that meets the
    policy above, then reverses the retained records before returning them.
2. Factor the existing last-record selection predicate into this one helper.
    Inspection member lookup, direct-file listing, preview/download delivery,
    direct extraction, and Companion extraction must call it rather than
    maintaining separate reverse scans or path maps.
3. Return original parsed entry objects from the projection, rather than copied
    metadata DTOs. The validated streaming descriptor must therefore carry the
    exact record selected for inspection through payload delivery or extraction.
4. Build directory listings from the same selected file records while retaining
    explicit and inferred directory discovery. Do not let an explicit terminal
    directory entry replace a selected direct file in the virtual tree.
5. Make backend extraction preflight and writes consume only the effective-entry
    projection. Keep the raw parsed tuple intact for validation and diagnostics.
6. Make Companion direct extraction and local-to-SMB relay construct their
    manifests and execution lists from the same projection. The projected paths
    are unique, so preserve the existing path-keyed checkpoint, retry, collision,
    rename, and relay contracts without occurrence IDs or public API changes.
7. For SMB-to-local relay delivery, select the matching projected `ZipEntry`
    from the current reader and validate/stream it directly. Do not perform a
    second path-based resolution, which could choose a different record.
8. Do not introduce cross-request caching, full-member staging, unbounded SMB
    concurrency, new public route parameters, or per-duplicate user controls.
9. Treat case-distinct selected paths as separate planned outputs. Do not
   reject them merely because their NFC/case-folded output keys match. Attempt
   each normal final write in central-directory order: a case-sensitive target
   creates both files, while a case-insensitive target reports the second write
   as a case-only archive-member collision.
10. Add a structured collision reason that records both archive member paths
   when two distinct selected members alias at the destination. The UI must
   explain that the destination cannot distinguish the two archive files and
   that the second member requires a new name. Existing overwrite actions may
   remain available, but their wording must state that overwriting replaces the
   first archive member's extracted output. Revalidate a rename with the same
   NFC/case-folded output-key rule before retrying the final write.

### Acceptance Criteria

- Identical raw duplicates and backslash-normalized duplicates produce exactly
   one selected extraction record. Its listing metadata, preview/download bytes,
   and extracted bytes are from the same last record.
- Extraction preflight, destination writes, and mixed-runtime relay requests
   exclude earlier duplicate records.
- A trailing directory record cannot suppress a selected regular file, and an
   unavailable selected last record cannot cause an older duplicate to be read.
- Direct backend extraction, Companion direct extraction, local-to-SMB relay,
   and SMB-to-local relay produce the same selected-path set without an
   occurrence ID, persistent cache, or additional SMB concurrency.
- Regression coverage uses distinct payloads, sizes, and supported codecs for
   raw and normalized duplicates, and verifies that only selected records reach
   destination writes and relay transfers.
- Case-distinct names remain visible as separate inspection entries and are both
  attempted during extraction. A case-sensitive destination creates both; a
  case-insensitive destination pauses on the second with a collision that names
  both archive members and requires a rename before both outputs can exist.

## Performance Targets

Use operation counts rather than elapsed time as the primary regression gate.
Timing varies with the SMB server and test host; logical I/O counts do not.

For an archive with $N$ central-directory entries and directory-byte size $D$:

- Initial central-directory parsing performs $O(\lceil D / C \rceil)$ random
  reads, where $C$ is the established bounded archive I/O chunk size, rather
  than $2N$ reads.
- Each listing request performs one bounded central-directory parse and one
   deterministic direct-child projection without per-entry random reads.
- Streaming an already validated member performs one local-header read before
  member payload reads, rather than validating and rereading that header.
- Non-ZIP64 creation emits local-entry metadata in one write per entry and
  batches central-directory bytes into bounded writes.
- Extraction preflight uses ordinary complete directory listings, one per
   relevant existing parent, rather than one metadata request per output file.
   The final per-file race check remains mandatory.

## Phase 0: Establish Measurement And Characterization

1. Add a `CountingRandomAccessReader` test double that records read offset,
   length, total bytes, and call count. Use it for ZIP reader, browse endpoint,
   viewer endpoint, and extraction tests.
2. Add a `CountingExclusiveWriter` test double that records write count and
   byte sizes without changing partial-write behavior.
3. Add a destination test double that records `get_file_info`, directory-list,
   create-directory, and write calls. It must simulate missing paths, existing
   files, existing directories, and create races.
4. Add duplicate-entry archives with distinct contents, sizes, and compression
   methods. Cover identical raw names and names that collapse under the current
   backslash-to-slash normalization.
5. Generate deterministic archives containing:
   - 10,000 flat files for large single-directory pagination;
   - 10,000 nested files for implicit-directory discovery;
   - many small incompressible and compressible files for creation; and
   - many small files with empty and populated destination trees for extraction.
6. Record the current counts in comments or fixture assertions as a baseline.
   Do not use wall-clock thresholds as required test assertions.

Acceptance criteria:

- Focused tests prove the existing behavior is characterized before refactoring.
- Test data is generated in-memory or in a temporary directory and does not add
  a large binary fixture to the repository.
- Tests cover Stored, Deflate, BZIP2, data descriptors, ZIP64 metadata, and
  malformed local headers where each affected path supports them.
- Tests exercise both large flat and deep archives without large checked-in
  binary fixtures.
- For identical raw duplicate names, Python `zipfile.read(name)`, the virtual
   listing metadata, and the member stream all identify the last central-
   directory record. Normalized-name collisions follow the same deterministic
   virtual-path rule.

## Phase 1: Batch Central-Directory Reads And Reuse Request Metadata

### 1.1 Parse Central-Directory Bytes In Bounded Sequential Chunks

1. Refactor `ZipReader.entries()` so it reads the central directory as contiguous
   bounded ranges using the existing archive I/O chunk-size constant.
2. Implement a small incremental record decoder that retains only the incomplete
   suffix across chunk boundaries. It must validate every record length before
   retaining or parsing variable fields.
3. Keep EOCD and ZIP64 discovery as bounded random reads. Once the directory
   offset and size are known, avoid per-record calls to `RandomAccessReader.read_at`.
4. Fail with the current archive-format error category when the directory is
   truncated, oversized relative to its declared directory bounds, or contains
   an invalid signature. Do not silently accept trailing or partial records.
5. Retain the parsed immutable entry tuple once per `ZipReader`. Stop returning
   copied lists from private hot paths; expose a read-only sequence or tuple to
   internal callers and copy only at a compatibility boundary that requires a
   mutable list.

### 1.2 Reuse Parsed Metadata Within One Request

1. Store the request-local inspection manifest beside the immutable parsed entry
   tuple. Make `inspection_manifest()` return that stored manifest rather than creating
   a new `ArchiveInspectionManifestMember` tuple on every call. Keep this
   reuse confined to the reader/request lifecycle; do not introduce
   cross-request inspection state.
2. Add a request-local member-resolution flow that carries the resolved
   `ZipEntry` to its immediate validation or streaming caller. It must preserve
   central-directory traversal and avoid a single-value path map, while applying
   the Phase 1.3 last-record-wins policy to path-based inspection.
3. Keep ordering exactly equivalent to the current directory-first,
   NFC-casefolded-name ordering and preserve existing malformed-archive errors.

### 1.3 Define Compatible Duplicate-Member Resolution

Implement the shared policy and checklist in
[Amendment: Shared Effective-Entry Projection](#amendment-shared-effective-entry-projection).

Acceptance criteria:

- A 10,000-entry archive needs bounded central-directory reads proportional to
  directory bytes, not entry count.
- `CountingRandomAccessReader` assertions added with this phase enforce the
   central-directory read-count target for reader and browse paths.
- Repeated `entries()`, `inspection_manifest()`, and member resolution calls on
  one reader do not allocate a complete replacement entry or manifest sequence.
- Existing malformed-directory, Unicode-path, ZIP64, and safety tests stay
  green.
- The amendment's acceptance criteria are met.

## Phase 2: Remove Redundant Member Validation And Header Reads

1. Split member validation into a routine that returns a validated streaming
   descriptor containing the `ZipEntry` and computed payload offset.
2. Read and verify the local header and name once while creating that descriptor.
   The streaming routine consumes the descriptor and must not read the header a
   second time.
3. Make `stream_entry()` accept this validated descriptor for extraction. It
   must not copy the full entries sequence or recheck membership by linear scan
   after the descriptor was produced by the same reader.
4. In the viewer route, validate once before selecting response headers, then
   pass the validated descriptor into the raw stream or compatibility-processing
   source reader. Normalize the path used for both stages.
5. Apply the same descriptor flow to the Companion relay member route and PDF
   derivative invalidation wherever they currently validate and then call a
   path-based stream method.
6. Preserve the final member CRC and uncompressed-size validation while streaming.
   A source archive change remains detectable through the existing revision
   checks; a descriptor is never reused across a different archive reader or
   archive fingerprint.

Acceptance criteria:

- A raw member request performs exactly one local-header validation sequence.
- Extraction performs one local-header read sequence per extracted member before
  payload I/O, not a validation read followed by a duplicate offset read.
- `CountingRandomAccessReader` assertions added with this phase enforce those
   local-header read targets for viewer and extraction paths.
- Invalid flags, methods, local names, truncated headers, CRCs, and declared
  sizes retain their current rejection behavior and HTTP mapping.

## Phase 3: Coalesce ZIP Writer Metadata Writes

1. Add a bounded metadata-buffer helper to `PortableZipWriter` that preserves
   `_offset` and partial-write handling through the existing `_write` loop.
2. Serialize each local file record as one buffer containing the fixed header,
   UTF-8 name, and ZIP64 local extra field. Continue to stream member payload
   chunks directly without buffering a source member.
3. Emit the data descriptor as one metadata write after payload streaming.
4. Buffer consecutive central-directory records up to the archive I/O chunk
   limit, flushing before adding a record that would exceed the limit and after
   the final record. Preserve ZIP64 central-directory and EOCD record ordering.
5. Use the Phase 0 counting writer to characterize Companion ZIP output where
   it owns the target. Only add a Companion buffering change and Rust
   counting-writer budget if that measurement demonstrates excessive fragmented
   metadata writes in a supported topology.
6. Keep `_write` resilient to short writes and reject zero-progress writes as it
   does today.

Acceptance criteria:

- A normal entry emits one local-header metadata write, one descriptor write,
  and amortized bounded central-directory writes, plus only payload writes.
- `CountingExclusiveWriter` assertions added with this phase enforce the
   backend metadata-write budget.
- ZIP32 and ZIP64 archives round-trip through Python's standard `zipfile` and
   the existing cross-runtime conformance tests. Add Companion metadata-write
   operation counts only when the Phase 0 characterization warrants a Companion
   buffering change.
- Memory remains bounded by the metadata buffer plus existing per-entry metadata,
  never by source-member size or complete archive output size.

## Phase 4: Coalesce Extraction Preflight Directory Checks

1. Extend the extraction destination inspection contract with ordinary
   directory enumeration. The returned entries are not required to be an
   immutable or atomic filesystem snapshot; they are only input to the initial
   conflict check.
2. Build and deduplicate the planned file and directory targets, including
   inferred and renamed ancestors. Process ancestor relationships
   shallowest-first. If an ancestor is missing, do not probe descendants during
   preflight; if it is a non-directory, report the earliest directory conflict
   and do not treat descendants as writable.
3. Group targets by a parent confirmed to be a directory. Fully enumerate that
   parent's ordinary directory listing once, exhausting every page when the
   adapter paginates. Retain only entries whose names match a planned direct
   child, then resolve all of those children from the collected results.
4. Use the existing per-target `get_file_info` preflight path only when an
   adapter declares complete directory enumeration unsupported before listing
   begins. Once enumeration starts, a page failure, invalid continuation, or
   otherwise unproven completion is a real listing failure: propagate it and
   never use partial results as an empty directory or fallback input.
5. Keep parent enumeration sequential in this phase. Coalescing eliminates the
   dominant per-target SMB round trips without adding SMB-credit, concurrency,
   or failure-ordering complexity.
6. Preserve the initial conflict set required by the collision UI, including
   file-versus-directory collisions, renamed targets, ignored members,
   completed members, and inferred directories. As today, it represents the
   filesystem state observed during preflight rather than a transactionally
   consistent point in time.
7. Retain `resolve_target_write_attempt()`'s final per-file observation and
   exclusive-create behavior. It remains the race-safe decision point: a target
   created, removed, or changed after the directory listing is reclassified
   under the established collision policy.
8. Release the short-lived target and matching-direct-child lookup structures
   after preflight; do not retain a full directory snapshot or introduce
   reusable caching.

Acceptance criteria:

- A flat extraction with $F$ files in one existing destination directory uses
   one complete ordinary directory enumeration for preflight instead of $F$
   individual file stats. Together with the mandatory final observations, this
   is approximately $F + 1$ metadata operations when that enumeration is a
   single page and no target races.
- The final write path still handles a file created, removed, or changed after
  preflight according to the existing collision policy.
- Directory entries may change during or after enumeration without weakening
   write safety; no immutable or atomic listing snapshot is required.
- Deep and renamed output trees preserve all existing collision decisions.
- A file at any target ancestor, including an ancestor that changes during
   preflight, is reported as a directory collision and never causes descendants
   to be treated as writable.
- A paginated listing is exhausted before it can establish target absence. A
   per-target fallback is used only when complete enumeration is declared
   unsupported before listing starts. A failure or unproven completion after
   listing starts is reported and never treated as an empty directory.
- Only matching planned children are retained from a directory enumeration, and
   all preflight lookup state is released after use.
- Destination-count assertions added with this phase enforce the preflight
   listing/stat budget and verify the final per-file observation remains present.

## Phase 5: Regression, Observability, And Rollout

1. Confirm the operation-count assertions delivered with Phases 1-4 remain
   effective in cross-phase scenarios. Do not defer phase-specific count gates
   to this phase.
2. Add contract tests for duplicate-member last-record resolution, exact Python
   `zipfile` compatibility for raw duplicate names, unchanged extraction
   traversal, and incomplete destination-listing fallback across backend and
   Companion boundaries.
3. Add SMB integration coverage that validates call coalescing against the test
   SMB server when available. Unit tests remain the required deterministic gate.
4. Record structured timing and count telemetry for archive inspection parse,
   member validation, extraction preflight, and archive creation. Backend
   creation telemetry distinguishes metadata writes from payload writes;
   Companion creation telemetry records physical buffered-output writes because
   its ZIP writer does not expose individual metadata-record boundaries. Do not
   log archive member names or credentials in high-cardinality metrics.
5. Roll out independently following the Implementation Order. Complete this
   phase's cross-phase release gates before broad rollout.

## Required Test Matrix

Every phase must run the narrow affected suite before broader validation:

```bash
cd backend && .venv/bin/python -m pytest -q \
  tests/test_archive_zip_reader.py \
  tests/test_archive_zip_writer.py \
  tests/test_archive_extraction.py \
  tests/test_archive_operations.py \
  tests/test_browser.py \
  tests/test_smb_backend.py

cd companion/src-tauri && cargo test

cd companion && npm run test
cd companion && npm run typecheck
cd companion && npm run lint
```

Run the full backend test suite after cross-cutting reader, protocol, or
storage-adapter changes. Run the Companion Rust and TypeScript commands above
whenever writer or relay behavior changes; Companion parity is not complete
until its metadata-write count assertions and conformance coverage pass.

## Definition Of Done

The remediation is complete when all phases meet their operation-count acceptance
criteria; request memory and SMB concurrency are demonstrably bounded; ZIP safety,
compatibility, and collision semantics remain unchanged; the backend writer and,
when Phase 0 warrants it, the Companion writer meet their metadata-write budgets;
and focused and full relevant suites pass.
