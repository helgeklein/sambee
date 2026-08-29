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
3. Add Python and Rust corpus runners that materialize the same virtual
   source-tree scenarios through each runtime's native enumeration adapter.
4. Refactor `build_archive_creation_manifest` and the Rust local manifest
   builder into:
   - topology-specific enumeration adapters; and
   - a shared-per-runtime canonical manifest projection/validation step.
5. Keep Python `PortableZipWriter` and Rust `ZipWriter` separate, but require
   both to consume the same immutable creation manifest and emit the same
   member outcome sequence.

Acceptance criteria:

- The same virtual-source scenario produces the same manifest and canonical
   ordering in both runtimes.
- Python and Rust pass the shared creation manifest and outcome-ledger corpora,
   while focused direct-path and relay-path behavioral tests cover the
   lifecycle-capable active V1 adapters. Retained compatibility shortcuts are
   covered by their versioned route-binding contract test.
- Retained synchronous V1 creation adapters either expose the lifecycle ledger
   for their execution or are documented and asserted as compatibility shortcuts
   in the versioned route-binding contract outside the common lifecycle model.

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

- Python and Rust pass the shared extraction trajectory corpus, while focused
   direct-path and relay-path behavioral tests cover the active V1 adapters.
- No coordinator maintains independent counters or decision state.
- Direct SMB execution can resume a persisted paused operation without relying
  on in-process exception state.
- A resumed extraction verifies that the archive source still matches the
   manifest snapshot before any further output is written. Direct-local sessions
   remain non-durable, but retain this manifest snapshot for their in-memory
   decision/resume lifetime.

### 4. Introduce A Shared Operation Model Per Runtime

1. Define common operation-level interfaces in each runtime:
   - an immutable, request-scoped inspection plan with source and presentation
     adapters; V1 inspection routes remain compatibility adapters and do not
     gain durable operation records;
   - creation source enumerator, bounded reader, archive destination, immutable
     creation manifest, and execution plan;
   - extraction archive source, output destination, immutable manifest, and
     execution plan containing the durable outcome ledger and resume decisions;
   - operation state store and cancellation source, with an explicit durable
     backend implementation and an explicit in-memory direct-local
     implementation. Do not make direct-local sessions durable as part of this
     phase.
2. Implement topology adapters:
   - backend SMB source/destination;
   - Companion local source/destination;
   - scoped relay source/destination bridges.
3. Migrate in behavior-preserving stages: introduce the common interfaces and
   plans, migrate direct execution, migrate relay callback handling, then remove
   duplicated lifecycle and decision handling only after V1 route-binding and
   topology tests remain green.
4. Move lifecycle, manifest validation, outcome persistence, decision
   application, and terminal validation into operation coordinators. Every
   coordinator receives an immutable execution plan and emits normalized
   destination results only.
5. Keep adapters free of durable policy: they may inspect, list, open, stream,
   write, and report observed collisions/errors only. They must not mutate
   checkpoints, select collision/retry outcomes, or derive progress counters.
6. Require every new archive feature to extend the operation contract and one
   coordinator before adding a topology adapter.
7. Build one cross-topology conformance harness that drives every shared
   creation and extraction trajectory through the resolved topology's actual
   coordinator or executor, including pause, decision, resume, cancellation,
   and terminal transitions. Use deterministic test-only source/destination
   adapters and fault injection for SMB and local I/O; this harness must not
   introduce a production generic filesystem abstraction. Assert equivalent
   canonical manifests, outcome-ledger transitions, decisions, and terminal
   summaries. A topology-labelled state replay does not qualify.

Acceptance criteria:

- Adding a future provider requires adapters and conformance cases, not a new
  archive workflow.
- Each runtime has one coordinator family per operation, rather than one per
  direction.
- Inspection resolves an immutable inspection plan through the same topology
   selection rules while retaining its request-scoped lifecycle.
- Every supported creation and extraction topology executes the shared
   trajectory corpora through its actual coordinator or executor and persists
   equivalent outcome-ledger trajectories.
- The harness injects malformed input, collision, partial-write, cancellation,
   source-change, and transport-failure cases at adapter boundaries for each
   supported topology.
- No generic local/SMB filesystem abstraction is introduced.

### 5. Design And Deliver V2

1. Create `archive-contract/v2` only after a recorded Phase 4 completion gate:
   the actual-executor conformance harness passes for every supported creation
   and extraction topology, the V1 route-binding tests remain green, and both
   runtimes enforce coordinator-owned lifecycle and decision state.
2. Add an immutable operation `contract_version` at creation, persist it with
   each durable operation, return it in operation reads, and bind it into every
   Companion capability. Version-specific routes must reject an operation or
   capability for another version before parsing its checkpoint. Include the
   database migration, default/version assignment for retained V1 rows, and
   version-isolation tests in this step.
3. Require strict, versioned V2 extraction checkpoint envelopes. “Ledger-only”
   means no `written_members`, legacy migration fields, or independently
   maintained aggregate counters. The envelope contains the immutable manifest
   and source snapshot, normalized member-outcome ledger, and the persisted
   collision/rename/retry/ignore decisions needed for safe resume; terminal
   aggregates are derived only from member outcomes. Define canonical path and
   timestamp encodings, unknown-field rejection, idempotency behavior, and the
   location/shape of any pending decision. V2 must reject unversioned/V1
   checkpoints and never silently migrate interrupted V1 work.
4. Before implementing handlers, publish a V1-to-V2 route-binding fixture and
   typed V2 schemas for every operation, response, capability, and control
   event. Define normalized V2 operation routes for inspection, member reads,
   extraction control events, and creation acknowledgements. Route dispatch may
   use the operation topology internally, but the payload schemas must be
   operation-based rather than direction-based.
5. Implement V2 backend endpoints, Companion client bindings, and frontend
   callers behind explicit version selection and capability negotiation. A
   caller that selects V2 must fail deterministically when its paired Companion
   cannot support V2; it must not silently downgrade to V1.
6. Run V1 and V2 side by side, with corpus assertions that fresh V2 operations
   preserve all V1 outcome semantics where the behavior is intentionally the
   same. Verify that V1 operations remain on V1-only routes and capabilities,
   V2 operations never read V1 checkpoint shapes, and a rollout rollback does
   not reinterpret persisted V2 work as V1.

Acceptance criteria:

- New callers use V2 only.
- V2 route and checkpoint schemas cover all four topologies and three archive
  operations.
- Each durable operation, route, and Companion capability is version-isolated;
   cross-version operation IDs, control events, and checkpoints are rejected.
- V2 resume tests prove durable decisions survive pause/retry/ignore while
   aggregate counters are derived solely from terminal member outcomes.
- V1 operations remain recoverable only through the documented retention
  window.

### 6. Retire V1 Compatibility And Duplicate Routes

1. Define and document the V1 historical-operation retention policy separately
   from the foreground heartbeat timeout. Add a configured retention duration,
   an immutable version-aware operation inventory, and a deployment audit that
   can identify every in-retention V1 operation and active V1 caller.
2. Inventory production callers, backend routes, Companion bindings, frontend
   clients, integration tests, retained operations, and supported Companion
   versions. Record the V1-to-V2 route mapping and the version-specific
   capability each caller uses.
3. Before disabling V1 creation, prove through the inventory and a defined
   observation window that no supported deployed client can create a V1
   operation. Keep V1 routes and compatibility readers available, version-gated,
   for in-retention V1 operations; publish deterministic recovery/expiry errors
   after the retention cutoff.
4. After the last in-retention V1 operation has expired and the deployment
   audit is signed off, remove V1 directional member/control routes one
   operation family at a time. Retain rollback support for already-created V2
   work without allowing it to fall through to V1 handlers.
5. Remove the backend and Companion `written_members` compatibility readers
   only after an inventory confirms no in-retention V1 checkpoint requires
   them.
6. Remove V1-only fixtures and migration branches after their final migration
   tests are deleted or moved to historical compatibility coverage.
7. Simplify the topology resolver so it selects V2 adapters without relay
   purpose-specific business semantics.

Acceptance criteria:

- No active archive path depends on a directional V1 route.
- No code references `written_members`.
- The configured V1 retention period, operation inventory, deployment audit,
   and final cutoff evidence are retained with the release record.
- V1 creation is disabled only after its caller gate passes; in-retention V1
   recovery remains version-gated until the configured cutoff.
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
