# Archive Unification Implementation Plan

## Goal

Provide one archive-operation model for every current and future topology:

- SMB -> SMB
- local -> local
- SMB -> local
- local -> SMB

The common model covers archive inspection, extraction, and creation/compression.
It must define the same input validation, normalized manifests, member outcomes,
progress, decisions, cancellation, resumability, and terminal behavior in every
path.

This does not mean one cross-language ZIP or filesystem implementation. The
end state is a language-neutral semantic contract implemented by a coordinator
in each executor, with bounded SMB and local source/destination adapters.

## Definition Of Done

The work is complete only when:

1. Every operation resolves topology through one plan that selects an executor
   and source/destination adapters, not a distinct business workflow.
2. Inspection, extraction, and creation have versioned, language-neutral
   manifest/result/checkpoint schemas and conformance corpora.
3. Python and Rust pass the same operation trajectories for each supported
   topology, including malformed input, cancellation, collision decisions,
   retry/ignore, resumability, and terminal coverage.
4. SMB/local differences are limited to adapters for listing, random access,
   bounded reads, direct writes, exclusive writer lifetime, and platform error
   mapping.
5. The active contract has one normalized route family per operation. Legacy
   V1 routes and `written_members` are removed only after callers migrate and
   the declared operation-retention period has ended.

## Current Baseline

Already centralized:

- topology resolution and scoped Companion relay authorization;
- durable operation lifecycle and state-store bindings;
- normalized extraction and creation member outcomes and progress ledgers;
- typed extraction and creation manifests;
- manifest hierarchy validation and V1 relay control-payload fixtures;
- relay callback validation, failure reporting, and no-result control POSTs;
- named, read-only V1 `written_members` compatibility boundaries.

Still separate:

- archive inspection APIs and parser projections;
- Python and Rust directory traversal/manifest construction;
- Python and Rust ZIP parser/writer implementations;
- direct SMB extraction's exception-driven decision loop and checkpoint-driven
  local/relay pause-resume execution;
- purpose-specific V1 member transport routes.

## Ordered Delivery Plan

### 0. Establish The Contract Baseline

1. Keep V1 behavior frozen except for correctness fixes.
2. Record a topology-by-operation compatibility matrix in
   `archive-contract/v1` covering SMB -> SMB, local -> local, SMB -> local,
   and local -> SMB.
3. Add a test gate that runs the existing outcome, manifest, relay-binding, and
   relay-control-payload corpora in both backend and Companion suites.
4. Document all V1 compatibility readers and routes with their retirement
   condition: V2 caller migration plus the historical operation-retention
   window.
5. Bind every retained V1 archive route, including inspection member-read and
   derivative routes, to its semantic operation and exact request/response
   schema. A route inventory alone is not a binding.

Acceptance criteria:

- Existing V1 behavior remains stable.
- No new code reads or writes `written_members` outside the named compatibility
  boundaries.
- Every active archive route, including inspection member-read and derivative
   routes, has a contract, backend registration, Companion binding where
   applicable, and test coverage.
- Retained V1 adapters declare their concrete request/response schemas and
   semantic operation; a normalized operation identifier must not stand in for
   an incompatible adapter payload.

### 1. Specify And Test Archive Inspection

1. Add `archive-contract/v1/inspection-scenarios-v1.json`.
2. Define typed inspection schemas for:
   - normalized archive member metadata;
   - member kind and supported/encrypted/compression state;
   - deterministic entry ordering;
   - safe preview eligibility and size limits;
   - member-read error categories.
3. Add a concise archive semantics specification explaining path normalization,
   member safety, supported ZIP features, and bounded preview reads.
4. Make Python `ZipReader` inspection projection and Rust local archive
   inspection projection consume the same corpus.
5. Introduce `ArchiveInspectionManifest` in both runtimes. It is a validated
   domain value, not an HTTP response model.
6. Refactor inspection endpoints to translate that domain value at the API
   boundary only.

Acceptance criteria:

- Identical archives produce the same normalized manifest and member-read
  eligibility in Python and Rust.
- SMB/local inspection differs only in random-access/local-file adapters.
- Preview behavior is bounded and contract-tested.

### 2. Make Creation Manifest Construction Conformant

1. Add `archive-contract/v1/creation-manifest-scenarios-v1.json` describing a
   virtual source tree and its canonical creation manifest.
2. Cover regular files, empty directories, stable ordering, unsupported node
   types, symbolic links, duplicate normalized archive paths, target-inside-
   source rejection, and metadata normalization.
3. Add test adapters for virtual trees in Python and Rust so both manifest
   builders consume exactly the same scenarios.
4. Refactor `build_archive_creation_manifest` and the Rust local manifest
   builder into:
   - topology-specific enumeration adapters; and
   - a shared-per-runtime canonical manifest projection/validation step.
5. Keep Python `PortableZipWriter` and Rust `ZipWriter` separate, but require
   both to consume the same immutable creation manifest and emit the same
   member outcome sequence.

Acceptance criteria:

- The same virtual tree produces the same manifest and canonical ordering in
  both runtimes.
- All four creation topologies execute the shared trajectory corpus through
   their selected coordinator or executor and persist equivalent outcome-ledger
   trajectories. Replaying a generic ledger once, or labelling a generic replay
   with a topology, does not satisfy this criterion.
- Retained synchronous V1 creation adapters either expose the lifecycle ledger
   for their execution or are documented and tested as compatibility shortcuts
   outside the common lifecycle model.

### 3. Unify Extraction State Transitions

1. Add `archive-contract/v1/extraction-trajectory-scenarios-v1.json`.
2. Cover initial checkpoint creation, completed members, collision pause,
   rename, skip, replace, replace-older, partial write, retry, ignore,
   cancellation, idempotent reports, resumed execution, and terminal summary.
3. Define a typed `ArchiveExtractionExecutionPlan` in Python and Rust from the
   immutable manifest, outcome ledger, and persisted decisions.
4. Refactor direct SMB extraction so collision/member-error events produce the
   same checkpoint-backed pause/resume transitions already used by relay and
   local execution. Preserve V1 external responses during this migration.
5. Make every extraction coordinator consume the execution plan and emit only
   normalized destination results; adapters retain bounded reads and direct
   output writes.
6. Consolidate terminal validation so every topology uses exact manifest
   coverage and the same aggregate summary derivation.

Acceptance criteria:

- The trajectory corpus passes for direct SMB, direct local, SMB -> local, and
   local -> SMB extraction by invoking each topology's coordinator or executor
   through its actual pause, decision, resume, cancellation, and terminal
   transitions. A topology-labelled state replay does not satisfy this
   criterion.
- No coordinator maintains independent counters or decision state.
- Direct SMB execution can resume a persisted paused operation without relying
  on in-process exception state.
- A resumed extraction verifies that the archive source still matches the
   manifest snapshot before any further output is written. Direct-local sessions
   remain non-durable, but retain this manifest snapshot for their in-memory
   decision/resume lifetime.

### 4. Introduce A Shared Operation Model Per Runtime

1. Define common operation-level interfaces in each runtime:
   - inspection source and presentation adapter;
   - creation source enumerator, bounded reader, and archive destination;
   - extraction archive source and output destination;
   - operation state store and cancellation source.
2. Implement topology adapters:
   - backend SMB source/destination;
   - Companion local source/destination;
   - scoped relay source/destination bridges.
3. Move all lifecycle, manifest validation, outcome persistence, and terminal
   validation into operation coordinators.
4. Keep adapters free of durable policy: they may inspect, list, open, stream,
   write, and report observed collisions/errors only.
5. Require every new archive feature to extend the operation contract and one
   coordinator before adding a topology adapter.

Acceptance criteria:

- Adding a future provider requires adapters and conformance cases, not a new
  archive workflow.
- Each runtime has one coordinator family per operation, rather than one per
  direction.
- No generic local/SMB filesystem abstraction is introduced.

### 5. Design And Deliver V2

1. Create `archive-contract/v2` only after Phases 1-4 are green.
2. Require versioned, ledger-only extraction checkpoints; V2 must reject
   unversioned/V1 checkpoints and never silently migrate interrupted V1 work.
3. Define normalized V2 operation routes for inspection, member reads,
   extraction control events, and creation acknowledgements. Route dispatch may
   use the operation topology internally, but the payload schemas must be
   operation-based rather than direction-based.
4. Implement V2 backend endpoints, Companion client bindings, and frontend
   callers behind an explicit feature/version selection.
5. Run V1 and V2 side by side, with corpus assertions that fresh V2 operations
   preserve all V1 outcome semantics where the behavior is intentionally the
   same.

Acceptance criteria:

- New callers use V2 only.
- V2 route and checkpoint schemas cover all four topologies and three archive
  operations.
- V1 operations remain recoverable only through the documented retention
  window.

### 6. Retire V1 Compatibility And Duplicate Routes

1. Inventory production callers, backend routes, Companion bindings, frontend
   clients, integration tests, and retained operations.
2. Prove that no active client creates a V1 operation and that the retention
   window for historical V1 operations has expired.
3. Remove V1 directional member/control routes one operation family at a time.
4. Remove the backend and Companion `written_members` compatibility readers.
5. Remove V1-only fixtures and migration branches after their final migration
   tests are deleted or moved to historical compatibility coverage.
6. Simplify the topology resolver so it selects V2 adapters without relay
   purpose-specific business semantics.

Acceptance criteria:

- No active archive path depends on a directional V1 route.
- No code references `written_members`.
- All archive tests run through the normalized V2 contract and coordinator
  family.

## Validation Order For Every Phase

1. Add or revise language-neutral corpus cases before changing coordinators.
2. Add focused Python and Rust unit tests for the changed semantic type.
3. Run affected direct and relay integration tests for all four topologies.
4. Run backend archive-operation, conformance, and contract tests plus mypy.
5. Run Companion server tests, `cargo clippy`, and touched-file `rustfmt`.
6. Run `git diff --check` and diagnostics for every touched file.

## Explicit Non-Goals

- Do not share Python and Rust ZIP parser/writer code through FFI or an
  artificial transport layer.
- Do not abstract SMB and local filesystem byte operations behind one generic
  storage API.
- Do not remove V1 routes because two handlers look similar.
- Do not migrate interrupted V1 operations to V2.
- Do not make direct local sessions durable backend operations without a
  separate ownership and recovery design.
