# Effective ZIP Entry Projection Implementation Specification

## Purpose

Implement the `Shared Effective-Entry Projection` amendment in
`ARCHIVE_PERFORMANCE_REMEDIATION_PLAN.md`.

The implementation must make inspection, preview/download delivery, direct
extraction, and mixed backend/Companion extraction use the same selected ZIP
records. It must eliminate unnecessary extraction of exact and
backslash-normalized duplicates while preserving case-distinct archive members.

This is a best-effort compatibility implementation. Case-distinct selected
members must be attempted as separate outputs, but a destination that aliases
them uses the existing generic target-collision flow. It does not identify the
earlier archive member, add a special collision type, or change the frontend.

This specification is deliberately limited to ZIP member selection and its
extraction consequences. It does not add cross-request caching, source-member
staging, archive-complexity limits, or unbounded SMB concurrency.

## Required Result

For these central-directory records:

```text
0  report.txt          old payload
1  report.txt          new payload
2  folder\\notes.txt   old normalized payload
3  folder/notes.txt    new normalized payload
4  Report.txt          upper-case payload
5  report.txt          final payload
```

the effective regular-file projection is:

```text
3  folder/notes.txt    new normalized payload
4  Report.txt          upper-case payload
5  report.txt          final payload
```

Consequences:

- Inspection shows `folder/notes.txt`, `Report.txt`, and `report.txt`.
- Preview and download use the payloads at records 3, 4, and 5.
- Extraction never reads, transfers, preflights, or writes records 0, 1, or 2.
- A case-sensitive destination creates both `Report.txt` and `report.txt`.
- A case-insensitive destination pauses through the existing generic
   target-collision flow when the second case-distinct output cannot be created.

## Definitions

### Raw Entries

A raw entry is one central-directory record parsed from the archive. Raw entry
order is central-directory order. The existing values are `ZipEntry` in Python
and `LocalArchiveReadEntry` in Rust.

Raw entries remain available for archive format validation, diagnostics, and
creation of the effective projection. They are not automatically extraction
work items.

### Exact Virtual Path Key

The exact virtual path key is the existing safe archive path normalization:

1. Decode the member name according to the ZIP flags and supported extras.
2. Replace `\\` with `/`.
3. Remove a terminal separator for path identity while retaining the directory
   flag separately.
4. Apply the existing safe-path validation.
5. Do not NFC-normalize or case-fold the key.

Therefore these keys are equal:

```text
folder\\notes.txt
folder/notes.txt
```

These keys are different:

```text
Report.txt
report.txt
```

### Portable Destination Key

The portable destination key is the current NFC-plus-Unicode-case-folded output
path key. It is only for detecting that two different selected outputs might
alias on a case-insensitive destination. It is not a ZIP member identity and
must never select, collapse, or resolve a ZIP member.

Manifest identity and output topology are separate validations:

- Reject duplicate manifest members only when their exact virtual path keys are
   equal.
- Keep the existing portable-key file-versus-directory validation. A regular
   file and a directory that alias under the destination's portable key are not
   a case-distinct regular-file pair and remain an invalid output topology.
- Do not add or broaden file-versus-descendant validation in this work. Retain
   the behavior already enforced by each runtime; it is outside this amendment's
   compatibility scope.

### Effective Regular Entry

An effective regular entry is the last raw entry for an exact virtual path that
is safe, has a supported file type, and is not a directory. Encryption and
compression-method availability do not change which record wins; they determine
whether that winning record can be delivered or extracted.

An unavailable winning record must never cause fallback to an older readable
record with the same exact virtual path.

### Effective Directory

An effective directory represents an explicit empty directory or an inferred
parent needed by an effective regular entry. Directory materialization is not a
payload delivery mechanism.

Use one `EffectiveDirectory` work item per exact virtual directory path. It
contains:

```text
EffectiveDirectory:
   path: exact virtual directory path
   explicit_entry: last safe supported raw directory entry, or none
   source_member_path: explicit entry path, or the nearest effective regular
                                 entry that implies this parent
```

Create inferred parents from effective regular entries, then merge safe
explicit directory records by exact path. For repeated explicit directory
records, retain only the last safe supported raw directory entry. Sort directory
work by path depth and exact path before materialization.

`source_member_path` is deterministic internal attribution for effective-
directory construction and diagnostics; it is not a payload source or a durable
logical identity. Conflict reports, rename expansion, progress, and checkpoints
use the logical effective directory `path`. A regular effective entry suppresses
an explicit directory work item with the same exact path, so a terminal
directory record cannot replace or hide a direct file.

## Non-Negotiable Invariants

- The entry shown for a path, delivered for that path, and extracted for that
  path is the same selected raw record.
- Exact duplicates and slash-normalized duplicates have one effective regular
  entry, the last eligible raw record.
- Case-distinct names have separate effective regular entries.
- Unsafe members and unsupported special file types retain the current archive
  rejection behavior, even if an older duplicate would otherwise be usable.
- Encrypted or unavailable selected entries retain the current
  unavailable-member policy and never fall back to an older duplicate.
- Existing file-versus-directory validation remains unchanged. File-versus-
   descendant policy remains deferred as stated by the remediation plan.
- Direct and mixed extraction retain their final just-before-write observation
  and exclusive-create behavior.
- No request-local projection survives the reader, operation, or request that
  created it.

## Shared Selection Algorithm

Implement one selection helper per runtime. Do not duplicate the selection
predicate in inspection, streaming, extraction, or relay code.

The helper takes parsed raw entries in central-directory order and returns an
immutable projection containing effective regular entries and effective
directories.

```text
seen_regular_paths = empty exact-path set
selected_regular_reverse = empty list

for entry in raw_entries scanned from last to first:
    if entry is unsafe or has an unsupported special file type:
        continue
    if entry is a directory:
        record it only for effective-directory construction
        continue
    if entry.path is in seen_regular_paths:
        continue
    add entry.path to seen_regular_paths
    append the original entry object to selected_regular_reverse

effective_regular_entries = reverse(selected_regular_reverse)
effective_directories = unique explicit and inferred directories for
                        effective_regular_entries
return both collections
```

While computing effective directories, retain the last safe supported explicit
directory record per exact path and attach the deterministic
`EffectiveDirectory.source_member_path` defined above. Do not retain discarded
duplicate directory records as extraction, relay, checkpoint, or progress work.

The caller performs the existing archive-wide unsafe and unsupported-special
validation before executing any entry. That preserves the current fail-closed
behavior while allowing the projection helper to remain a selector rather than
an error-policy engine.

The helper must preserve an encrypted or unsupported-codec regular entry as the
winner. Later validation then yields the existing unavailable-member outcome.

### Required API Shape

Use a small internal projection value rather than independent lists or maps.
The exact naming may follow local conventions, but it must contain the original
entry values and communicate its intended lifetime:

```text
EffectiveArchiveEntries:
  regular_entries: immutable sequence of raw regular entries
   directories: immutable sequence of EffectiveDirectory work items
   member_by_exact_path: exact virtual path -> selected raw regular entry
```

The projection must contain `member_by_exact_path`, an exact virtual-path
lookup index that references the selected original entry. It must be private to
the projection and request.

Inspection metadata is a presentation derived from the projection, not a second
selection layer. `ArchiveInspectionManifest.member()` and the Rust equivalent
must use an exact lookup of already projected metadata, then apply only request
path validation and availability checks. They must not reverse-scan, filter, or
choose a member. The raw-entry lookup used for streaming must independently
return the same selected raw entry from `member_by_exact_path`.

## Backend Implementation

### ZIP Reader

Affected module: `backend/app/services/archive/zip_reader.py`.

1. Add a private request-local projection field to `ZipReader`, alongside
   `_entries` and `_inspection_manifest`.
2. Add an async internal method that obtains `entries()` once and builds the
   effective projection once.
3. Refactor `resolve_member()` to find its selected member through that
   projection, not by its own reversed scan of raw entries.
4. Refactor `inspection_manifest()` and `ArchiveInspectionManifest` construction
   to use the same projection for direct files while preserving current inferred
   directory behavior and directory-first NFC/case-folded sorting.
5. Add a private exact-path index to the inspection manifest from the projected
   regular metadata. Its `member()` method must use that index and must not
   reapply selection predicates or reverse scans.
6. Keep `ZipEntry.reader_identity` and `ValidatedZipEntry.reader_identity`
   unchanged. The projection must return the original reader-bound `ZipEntry`,
   so current constant-time validation and descriptor safety continue to work.
7. Add an internal exact selected-entry lookup for mixed SMB-to-local delivery.
   It must return the selected `ZipEntry` object, then use `_validate_entry()`
   and `stream_validated_entry()`; it must not call `validate_member(path)` a
   second time.

### Direct Backend Extraction

Affected module: `backend/app/services/archive/extraction.py`.

1. After raw archive-wide safety/type validation, obtain the reader's effective
   projection.
2. Use only `regular_entries` plus `EffectiveDirectory` work items for rename
   validation, collision preflight, progress, and final writes.
3. Preserve the selected original `ZipEntry` in each stream factory. Do not
   reconstruct an entry from manifest metadata or resolve it by path.
4. Update `_archive_directory_paths()` and rename validation to operate on the
   projected regular and `EffectiveDirectory` work items. Use each directory
   work item's logical `path` for conflict/result identity; retain
   `source_member_path` only as internal attribution. Do not reject two
   different exact selected file paths merely because their portable destination
   keys match.
5. Continue to use portable destination keys to reject an explicit rename
   target that aliases another selected output. The unrenamed case-distinct
   pair must be attempted normally as described below.

### Backend Relay Manifest And Checkpoint Validation

Affected module: `backend/app/services/archive/coordinator.py`.

1. Change `_validate_archive_member_hierarchy()` to use exact virtual-path keys
   for the `member_path_keys` duplicate check. This is the validator used by
   both `ArchiveExtractionManifest.from_members()` and `.from_checkpoint()`.
2. Keep a separate portable-key set only for existing file-versus-directory
   topology validation. Do not use it to reject two regular files whose paths
   differ only by case or Unicode normalization.
3. Keep the manifest index, completion ledger, retry ledger, collision actions,
   and rename mappings keyed by normalized exact member path. They are safe once
   every manifest is created from the effective projection.
4. Add a checkpoint round-trip test for `Report.txt` and `report.txt`: manifest
   creation and loading must accept both members and retain their distinct exact
   paths.

## Companion Implementation

### Archive Parsing And Inspection

Affected module: `companion/src-tauri/src/server/archive.rs`.

1. Add an internal `EffectiveLocalArchiveEntries` value built from
   `Vec<LocalArchiveReadEntry>`.
2. Use it in `ArchiveInspectionManifest::member()`,
   `ArchiveInspectionManifest::list_directory()`, and
   `resolve_local_archive_read_entry()`.
3. Build an exact-path inspection metadata index from the projection. The
   manifest `member()` method must use that index rather than its current
   reverse scan; availability remains a post-lookup check.
4. Store the projection in `ArchiveInspectionPlan` beside the raw parsed entries
   and manifest. It is request-scoped and must retain references or clones of
   the selected raw entries only.
5. Preserve the `ValidatedLocalArchiveEntry` descriptor path. The selected
   `LocalArchiveReadEntry` must be passed to `validate_local_archive_entry()`
   and then to `stream_validated_local_archive_entry()` without a path-based
   re-resolution.

### Direct Local Extraction

Affected module: `companion/src-tauri/src/server/archive.rs`.

1. Run archive-wide safety and supported-file-type validation over raw entries.
2. Build the effective projection once.
3. Use projected regular entries and `EffectiveDirectory` work items for validation,
   checkpoint construction, collision decisions, and streaming.
4. Make `validate_extraction_output_paths()` and related projected-output
   validation use exact virtual-path keys for manifest identity. Retain the
   current file-versus-directory validation; do not implement a new
   file-versus-descendant policy in this change.
5. Preserve case-only selected file paths as distinct work items. Do not use
   `collision_key()` to collapse them at planning time.
6. Use each `EffectiveDirectory` logical `path` for local directory collision
   reports and checkpoint outcomes. Retain `source_member_path` only as stable
   internal attribution; do not derive it from whichever discarded raw directory
   record happens to be encountered first.

### Companion Relay Manifest And Checkpoint Validation

Affected module: `companion/src-tauri/src/server/archive.rs`.

1. Change `ArchiveExtractionManifest::from_entries()` to use exact normalized
   paths for duplicate manifest identity. This must accept `Report.txt` and
   `report.txt` as two entries.
2. Keep separate portable-key file-versus-directory topology validation. Do not
   let this check collapse or reject case-distinct regular files.
3. Apply the same split to local checkpoint validation and renamed-output
   validation: exact keys identify members; portable keys only validate output
   topology and explicit rename effects.
4. Add manifest serialization/deserialization tests that prove a case-distinct
   pair survives the local-to-SMB and SMB-to-local contract unchanged.

### Local-To-SMB Relay

Affected module: `companion/src-tauri/src/server/handlers.rs`.

1. `validate_local_archive_extraction()` must return projected extraction work,
   not all raw file records.
2. Build `ArchiveExtractionManifest` from the projected work only.
3. Pass the same selected `LocalArchiveReadEntry` to
   `ArchiveExtractionRelay::write_file()`.
4. Preserve current path-keyed completion and retry behavior because the
   effective projection has no exact duplicate paths.

### SMB-To-Local Relay

Affected modules: `backend/app/api/archive_operations.py` and
`backend/app/services/archive/coordinator.py`.

1. Build the Companion extraction manifest from the backend effective
   projection, not the raw `ZipReader.entries()` tuple.
2. Each member-stream request creates its own reader and recomputes that
   request-local projection. Look up the selected original `ZipEntry` by exact
   virtual path, validate it, and stream its descriptor.
3. Verify the recomputed selected entry against the persisted manifest path,
   type, uncompressed size, and source revision before streaming. This requires
   no cross-request cache or new manifest occurrence identifier.
4. Do not use `ZipReader.validate_member(member_path)` for relay delivery after
   receiving a manifest path; that method is safe for named viewer access, but
   relay code must consume the recomputed projected record explicitly.
5. Keep the current source identity/revision checks before reader creation and
   descriptor streaming.

The same-selected-raw-entry invariant applies within one reader/request. Across
the relay's independent HTTP requests, the best-effort invariant is instead:
the source revision matches the preflight snapshot and the independently
recomputed effective entry matches the persisted manifest's exact path, type,
and size. Do not claim byte-for-byte record identity across requests without a
new persisted record fingerprint.

## Case-Distinct Extraction

### Planning Rule

`Report.txt` and `report.txt` are separate selected archive outputs. The
projection must never collapse them, and extraction preflight must not fail
solely because their portable destination keys are equal.

Do not add a planned-output collision map, filesystem case-sensitivity probe,
or archive-specific case-collision classification. Portable destination keys
remain limited to validation of explicit rename targets.

### Rename Validation

Compute two output views over the effective projected work items:

1. The baseline view has no rename mappings.
2. The candidate view applies all persisted rename mappings, including the
   proposed mapping.

For each portable output key, collect the exact member paths that produce it.
An unrenamed case-distinct regular-file collision is permitted only when the
candidate group is identical to its baseline group and none of its members is
in a renamed subtree. Reject the candidate mapping when it introduces a new
portable-key collision or leaves an existing collision involving a renamed
subtree. Continue to reject file-versus-directory topology conflicts.

This rule permits unrelated renames while `Report.txt` and `report.txt` remain
unrenamed, permits a rename that moves one of those files to a distinct output,
and rejects a rename that creates or fails to resolve a relevant alias.

### Final Write Rule

Process selected regular files sequentially in central-directory order using the
existing final target observation and exclusive-create/write flow.

- If the destination distinguishes both names, both writes succeed.
- If the second final observation or exclusive-create finds an existing output
   through a differently cased name, use the existing generic target-collision
   behavior.
- Unrelated existing files and late write races use that same existing
   target-collision behavior.

Do not infer destination case sensitivity from platform type, SMB host, or a
probe file. The normal final write path is authoritative and race-safe.

### Existing Collision Flow

Reuse the existing target-collision contract, checkpoint decisions, and
frontend dialog unchanged. When a generic collision pauses a case-distinct
second member, existing actions have their normal meaning:

- Rename is the user-visible way to preserve both outputs.
- Skip leaves the earlier output in place and omits the later member.
- Replace may replace the earlier output where the existing collision policy
   allows it; this best-effort scope does not add archive-specific durable-state
   accounting for that replacement.

The implementation must not add `collision_kind`, `conflicting_member_path`, a
new API contract version, i18n strings, special UI controls, or exceptional
parent-directory lookups. An explicit rename retry remains subject to existing
portable destination-key validation and the standard final write operation.

## Durable State And Relay Compatibility

No occurrence identifier is needed: the effective projection contains exactly
one selected record per exact virtual path.

Keep existing path-keyed manifests, checkpoints, completion records, retry
records, collision decisions, and rename mappings. The input to all of them
must be the effective projection, never the raw archive entries.

Existing checkpoints with paths unique under the exact virtual path key remain
valid. A resumed operation must regenerate and compare the same effective
manifest under its existing source revision checks. A changed archive that
changes the selected record, selected size, selected path, or effective path
set must retain the existing source-changed failure behavior.

No new durable outcome is needed for a generic overwrite collision. Existing
outcomes continue to identify completed archive members, not a guarantee that a
later overwrite left every completed member at a distinct destination path.

This is an explicit best-effort limitation. A completed case-distinct pair may
ultimately occupy one destination path when the user selects the existing
replace action; no claim of two surviving outputs is made in that outcome.

## Error Behavior

| Condition | Required outcome |
| --- | --- |
| Exact raw duplicate | Only the last selected regular record is inspected, delivered, and extracted. |
| Slash-normalized duplicate | Same as exact raw duplicate. |
| Last selected record unavailable | Do not fall back; use existing unavailable-member error or skip policy. |
| Case-distinct entries on case-sensitive target | Extract both. |
| Case-distinct entries alias on target | Pause current member with the existing generic target-collision behavior. |
| Case-distinct rename aliases another target | Reject the rename as invalid before retrying. |
| File versus directory conflict | Preserve current archive validation rejection. |
| File versus descendant conflict | Retain each runtime's current behavior; do not broaden it in this amendment. |
| Unsafe entry or unsupported special file type | Preserve current archive validation rejection. |
| Archive source changes after preflight | Preserve current source-changed failure behavior. |

## Test Plan

### Backend ZIP Reader And Inspection

Add focused tests in `backend/tests/test_archive_zip_reader.py` for:

1. Exact raw duplicates with different content, size, and supported codecs:
   one selected entry, matching inspection metadata, and matching stream bytes.
2. Backslash-normalized duplicates with the same assertions.
3. Case-distinct files: two direct listing entries and exact-case member reads
   with distinct payloads.
4. Trailing directory record after a selected file: the file remains listed and
   selected.
5. Unavailable final duplicate: ensure an older readable duplicate is not
   delivered.
6. Projection reuse: repeated inspection, member lookup, and extraction lookup
   return the same request-local projection/entry references.

### Direct Backend Extraction

Add focused tests in `backend/tests/test_archive_extraction.py` for:

1. Exact and normalized duplicates: exactly one final destination write and the
   last selected payload.
2. Case-distinct names on a case-sensitive memory destination: two writes and
   two files.
3. Case-distinct names on a case-insensitive memory destination: first output
   succeeds; second produces the existing generic target collision.
4. Rename after that collision: both payloads exist under distinct
   portable keys after retry.
5. Overwrite after that collision: final output is the second payload, using
   existing generic collision semantics.
6. Existing unrelated case-insensitive target: retain ordinary existing-target
   collision classification.
7. An unrelated rename succeeds while an unrenamed case-distinct pair remains;
   a rename that creates or leaves a collision in its renamed subtree fails.
8. Preserve existing data-descriptor, ZIP64, BZIP2, malformed local-header,
   final-race, and incomplete-listing tests using projected entries.

### Mixed Backend/Companion Relays

Add tests in `backend/tests/test_archive_operations.py`,
`backend/tests/test_smb_backend.py`, and Companion handler tests for:

1. Local-to-SMB exact/normalized duplicates: Companion sends one member transfer
   for each effective path and never streams an earlier duplicate.
2. SMB-to-local exact/normalized duplicates: backend manifest contains only the
   selected path, and the streamed bytes are from that selected raw entry.
3. Case-distinct paths on a case-sensitive local destination: both complete.
4. Case-distinct paths on a case-insensitive local or SMB destination: the
   second pauses with the existing generic collision and rename completes both.
5. Resume after first case-distinct output succeeds: the first is not repeated;
   the second remains the pending member.
6. Source changes that alter a winning duplicate: resume fails as source
   changed before any additional output.
7. A case-distinct relay manifest and its checkpoint round-trip successfully in
   both runtimes, while an exact duplicate manifest path remains rejected.
8. SMB-to-local member delivery recomputes the effective projection, verifies
   the existing source snapshot and manifest metadata, and streams the
   recomputed selected entry.
9. Repeated explicit directories and inferred parents materialize once in depth
   order, retain stable source-member identities, and never mask a direct
   effective regular file.

### Performance Regression Checks

Keep the existing operation-count assertions. Add assertions that duplicate
archives perform no reads of discarded member local headers or payloads, no
discarded-member destination writes, and no discarded-member relay transfers.

## Implementation Order

1. Add backend and Rust projection helpers with unit tests for exact,
   normalized, unavailable, and case-distinct selection.
2. Refactor inspection and member delivery to consume the helper; verify object
   identity/descriptor handoff tests.
3. Refactor direct backend and Companion extraction to use the projection;
   retain topology safety checks.
4. Refactor both relay manifest builders and SMB-to-local delivery to use
   selected original entries.
5. Retain generic target-collision behavior for case-distinct selected paths;
   add direct, relay, and resume tests for that behavior.
6. Run the remediation plan's focused suite, then full backend, Companion Rust,
   and Companion TypeScript validation. Run live SMB coverage when credentials
   are configured.

## Completion Criteria

The amendment is complete only when all paths use the shared effective-entry
projection; no discarded duplicate reaches a local-header read, payload stream,
destination write, collision decision, checkpoint, or relay transfer; and
case-distinct entries either both extract, pause through the existing generic
target-collision flow, or complete through the existing skip/replace decision
with its established generic semantics.
