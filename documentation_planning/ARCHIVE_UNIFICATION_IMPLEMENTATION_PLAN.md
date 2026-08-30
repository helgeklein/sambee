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
5. The active V2 contract has one normalized route family per operation. An
   explicit cutover removes V1 routes and `written_members` only after a
   legacy-state preflight confirms that no archive operation requires recovery.

## Current Baseline

Already centralized:

- topology resolution and scoped Companion relay authorization;
- durable operation lifecycle and state-store bindings;
- normalized extraction and creation member outcomes and progress ledgers;
- typed extraction and creation manifests;
- manifest hierarchy validation and V2 relay control-payload fixtures;
- relay callback validation, failure reporting, and no-result control POSTs;
- strict V2 checkpoint validation with derived aggregate progress;
- normalized V2 route bindings and V2-only conformance fixtures.

Still separate:

- Python and Rust directory traversal/manifest construction;
- Python and Rust ZIP parser/writer implementations;
- SMB and local I/O adapters, including bounded reads, direct writes, and
   platform error mapping.

## Ordered Delivery Plan

### 0. Establish The Contract Baseline

1. Keep V1 behavior frozen except for correctness fixes.
2. Record a topology-by-operation compatibility matrix in
   `archive-contract/v1` covering SMB -> SMB, local -> local, SMB -> local,
   and local -> SMB.
3. Add a test gate that runs the existing outcome, manifest, relay-binding, and
   relay-control-payload corpora in both backend and Companion suites.
4. Document all V1 compatibility readers and routes with their retirement
   condition: successful V2 replacement plus the explicit legacy-state reset
   preflight required for the V2-only cutover.
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

#### Proportionate Topology-Harness Delivery

The harness is a Phase 4 completion gate, but it must remain test-only and
bounded to operation seams. It does not start production servers, require a
live SMB share, introduce cross-language RPC, or share a filesystem API between
the runtimes.

1. Define a small test-only invocation boundary for each existing operation
   coordinator or executor. It accepts an immutable plan plus deterministic
   operation-specific source, destination, or relay-transport doubles and
   returns a normalized trace. Do not add a production trait solely for the
   harness; expose an existing narrow adapter boundary only where tests cannot
   otherwise invoke the actual executor.
2. Add one versioned, language-neutral expected-trace fixture beside the
   existing trajectory corpora. Each case names the operation, source and
   destination topology, requested fault, and expected manifest snapshot,
   phase transitions, pending decision, terminal member outcomes, aggregate
   summary, and normalized error category. The fixture is an oracle, not a
   new state-machine implementation.
3. Dispatch each fixture through the topology resolver and the actual runtime
   owner:
   - SMB -> SMB: backend creation or extraction coordinator with deterministic
     SMB source and destination adapters;
   - local -> local: Companion direct-local coordinator with a temporary local
     source/destination fixture and its in-memory session state store;
   - SMB -> local: Companion relay coordinator with a deterministic backend
     relay source and local destination;
   - local -> SMB: Companion relay coordinator with a local source and
     deterministic backend relay destination.
   The Python test suite must not label a Python coordinator invocation as a
   Companion topology. Existing Python coordinator tests remain unit coverage,
   not this cross-topology gate.
4. Make the relay double model only the existing archive relay messages and
   bytes at the transport boundary. For mixed topologies, it may passively
   replay a fixture-defined sequence of existing V1 responses, including
   checkpoint and pending-decision payloads, while validating the Companion's
   request ordering and payload shape and recording observed traffic. It must
   not derive lifecycle state, decide collisions, update a ledger, calculate
   progress, inspect the local filesystem, or emulate filesystem behavior. SMB
   and local test doubles likewise report observations only; their
   coordinators apply every decision and state transition.
5. Start with the current creation and extraction trajectory corpus, then add
   one fault case per boundary: malformed manifest or member input, collision,
   partial write, cancellation, source identity change, and transport failure.
   Assert the same normalized trace in the owning runtime for every supported
   topology. Inspection remains covered by resolved request-scoped plan tests;
   it does not enter the durable trajectory harness.
6. Provide one repository test command that runs the backend coordinator
   harness and the Companion actual-executor harness. It is green only when
   every fixture dispatches to the resolved owner and both suites compare the
   resulting trace to the shared expected-trace fixture. Existing focused
   route-binding and corpus tests remain separate regression coverage. The
   mixed-topology portion must also verify its observed V1 relay request and
   response sequence against the fixture-defined playback; a real backend
   process is optional integration coverage, not a Phase 4 gate.

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

#### Phase 4 Completion Implementation Plan

1. Make the versioned topology trace fixture set, indexed by
   `topology-execution-traces-v1.json`, the complete oracle for every
   trajectory. The index declares every trajectory and references the complete
   normalized expected trace; a mixed extraction trajectory also contains
   ordered invocation segments, with fixture-defined V1 relay playback and the
   persisted checkpoint presented to the next coordinator invocation after a
   backend-side decision.
2. Keep relay playback passive. It validates ordered request method, path,
   query, and payload class, records the emitted response sequence, and returns
   only fixture-defined V1 messages. It does not select decisions, mutate
   checkpoints, calculate progress, or inspect local files.
3. Add a data-driven mixed extraction dispatcher for both relay topologies. It
   materializes deterministic local source/destination state, invokes the
   actual Companion coordinator once per fixture segment, retains that local
   state across resumes, and compares the aggregate normalized trace with the
   shared oracle.
4. Compare complete traces in every owner dispatcher: manifest snapshot, phase
   transitions, pending decision, terminal member outcomes, aggregate summary,
   and normalized error category. Do not derive expected state in test code.
5. Complete the adapter-boundary fault matrix for both operations and every
   topology. For direct-local execution, an unavailable filesystem source or
   output is the transport-failure analogue. A fixture coverage test rejects an
   undeclared or undispatched applicable matrix cell.
6. Keep at-least-once acknowledgement delivery as production coverage: retry
   tests verify a stable idempotency key after a dropped response, while backend
   route tests verify exact replay and conflicting reuse. The passive relay
   fixture never invents duplicate lifecycle transitions.
7. Make the repository gate data-driven. It must fail if a declared corpus or
   fault fixture was not dispatched by its resolved owner, then run focused
   backend and Companion validation, static checks, and whitespace checks.

#### Companion Coordinator Consolidation Addendum

The Phase 4 conformance harness proves the current behavior, but Companion
still has a direct-local session coordinator and separate relay coordinators.
Complete the operation-model requirement with the following bounded refactor.

1. Define one immutable Companion creation plan and one immutable Companion
   extraction plan. Each selects a local or relay source/destination binding
   after adapter-specific preflight. The plans retain the normalized manifest;
   extraction plans also retain the checkpoint and resume decisions.
2. Introduce one Companion creation coordinator and one Companion extraction
   coordinator. They own validation, member-outcome recording, progress,
   decisions, terminal validation, and error normalization for every Companion
   topology. They select the local or relay binding from the immutable plan.
3. Keep `ArchiveSessionManager` as the non-durable direct-local state store.
   Store direct-local immutable plans after preflight, then let the shared
   coordinators read and update its state through focused methods. Do not make
   these sessions durable.
4. Move the existing relay creation and extraction orchestration behind the
   shared coordinators. Preserve the V1 relay transport, idempotency behavior,
   request/response payloads, and local streaming helpers as adapter-level
   details.
5. Add a production Companion topology resolver that maps operation kind and
   topology to a local or relay binding. V1 route handlers remain thin
   compatibility adapters: authenticate, resolve paths, construct the plan,
   invoke the resolver, and translate the normalized result.
6. Migrate creation first, then extraction. After each operation migration,
   remove the replaced direction-specific coordinator rather than preserving a
   second lifecycle owner.
7. Update the actual-executor harness so each Companion fixture runs through
   the production topology resolver and the relevant shared coordinator. Keep
   relay playback passive and retain exact trace, fixture-coverage, and V1
   route-binding assertions.
8. Validate each slice with focused Companion tests, then the full Companion
   suite, the repository topology-conformance gate, backend archive tests,
   mypy, strict Clippy, Rustfmt, and `git diff --check`.

#### Phase 4 Inspection Plan Resolution Addendum

The creation and extraction operation plans now resolve through their runtime
topology resolvers, but inspection needs the same explicit request-scoped
routing. Complete the remaining Phase 4 inspection requirement without adding
durable inspection records, changing V1 request/response schemas, or creating
a generic filesystem abstraction.

1. Define a single immutable inspection topology plan in each runtime. It must
   represent the operation kind, selected executor, source placement, and the
   applicable local or SMB inspection binding. Extend the Companion operation
   topology vocabulary to represent inspection, and provide a source-only
   resolver that uses the same local-versus-SMB selection rules as archive
   execution. A Companion inspection resolver must reject any binding it does
   not own instead of allowing a route to bypass topology selection.
2. Define an immutable request-scoped inspection operation plan in each
   runtime. Bind the validated source adapter and the selected presentation
   adapter before invoking the inspection coordinator. The source adapter owns
   opening or random-access reading of the archive; the presentation adapter
   owns conversion of a normalized manifest/member result to the existing V1
   directory-listing, member-read, or preview response shape. Do not put HTTP
   response construction, path authorization, or transport concerns in the
   coordinator.
3. Refactor the Companion local archive directory and member routes to:
   authenticate and resolve the drive/path; construct the immutable inspection
   plan; invoke the production inspection topology resolver and coordinator;
   then stream or serialize through the bound presentation adapter. Retain the
   existing local ZIP parser and bounded streaming helper as adapter details.
   Do not add a Companion relay inspection workflow in V1; SMB inspection
   remains backend-owned and its resolver must select the backend path.
4. Refactor the backend inspection callers to construct their source and
   presentation bindings through the same request-scoped inspection-plan
   boundary. Preserve the current backend `ZipReader`, bounded preview checks,
   and V1 API projections. The resolver remains responsible only for executor
   selection and binding compatibility; it must not parse ZIP data or derive
   member results.
5. Add focused Python and Rust tests that prove: local and SMB source
   placement resolve to the expected runtime owner; each owner rejects an
   incompatible binding; Companion local directory/member routes invoke the
   production resolver; backend SMB directory/member routes invoke its
   resolver; and invalid member, cursor, unavailable, encrypted, and
   oversized-preview behavior is unchanged. Keep inspection outside the
   durable creation/extraction trajectory harness, but add resolved-plan
   assertions beside the existing inspection corpus and V1 route-binding
   tests.
6. Run the inspection corpus and focused route tests first, then the complete
   backend and Companion suites, the repository topology-conformance gate,
   mypy, strict Clippy, Rustfmt, and `git diff --check`. Record the Phase 4
   completion gate only after the inspection resolver tests prove that no
   production inspection route constructs a coordinator directly from a raw
   archive path.

Acceptance criteria:

- Every production inspection request constructs an immutable plan and reaches
  its owning coordinator through a topology resolver.
- Inspection plans bind both a source adapter and a presentation adapter while
  remaining request-scoped and non-durable.
- Local inspection remains Companion-owned, SMB inspection remains
  backend-owned, and neither runtime gains a generic local/SMB filesystem API
  or a V1 relay inspection workflow.
- Existing V1 inspection schemas, authorization, parser behavior, bounded
  previews, and member-read errors remain unchanged and are route-binding
  tested.

### 5. Design, Deliver, And Cut Over To V2

The product has no users or retained production archive work that require V1
compatibility. Deliver V2 as a deliberate breaking cutover, not as a dual-stack
rollout. Do not backfill, reinterpret, or silently transform a V1 operation,
checkpoint, capability, or direct-local session as V2.

1. Record the completed Phase 4 gate before beginning the cutover: the
   actual-executor conformance harness passes for every supported creation and
   extraction topology, V1 route-binding tests remain green, and both runtimes
   enforce coordinator-owned lifecycle and decision state.
2. Run a deployment preflight against the target database before its schema
   migration. It must list every existing archive operation and reject the
   cutover when any legacy operation is present. The operator must explicitly
   reset/discard that archive-operation state before proceeding; the migration
   must never mark a V1 row or checkpoint as V2. Restarting or upgrading
   Companion invalidates any in-memory direct-local V1 session rather than
   attempting recovery.
3. Create `archive-contract/v2` before implementing handlers. Publish typed,
   language-neutral schemas and a normative semantics document for creation,
   extraction, inspection, member reads, operation reads, capabilities, and
   control events. Define exact canonical path and timestamp encodings, member
   outcome and decision enums, size/count bounds, stable error codes,
   idempotency-key scope, unknown-field rejection, and the complete pending
   decision shape. Move the current behaviorally equivalent corpus cases to V2
   fixtures and add negative V2 fixtures for malformed and legacy payloads.
4. Define an immutable `ArchiveContractVersion` vocabulary with V2 as the only
   accepted value. Persist `contract_version` on every durable creation and
   extraction operation with a database constraint, return it in operation
   reads, and retain it in Companion direct-local session/recovery state and
   frontend foreground recovery handles. Inspection remains request-scoped and
   non-durable: its V2 request schema carries the version without creating an
   operation record.
5. Introduce strict V2 checkpoint envelopes. An extraction envelope contains
   the immutable manifest and source snapshot, normalized member-outcome
   ledger, persisted collision/rename/retry/ignore decisions, and pending
   decision. Terminal aggregates are derived solely from member outcomes. V2
   parsers in both runtimes must reject unversioned checkpoints, V1 checkpoint
   fields including `written_members`, unknown fields, independently maintained
   aggregate counters, and invalid canonical encodings before any output is
   written.
6. Implement one normalized V2 route family per operation. Creation and
   extraction use durable operation resources and operation-based controls;
   inspection and member reads use explicitly non-durable request-scoped V2
   resources. Route payloads must be operation-based rather than direction-
   based, although runtime topology resolution may still select a local, SMB,
   or scoped relay adapter internally. Publish a complete V2 route-binding
   fixture covering every route, request, response, capability, and control
   event before adding the handlers.
7. Bind the V2 version to every Companion capability as a signed claim and
   validate it against the durable operation before checkpoint parsing or relay
   I/O. Continue to bind capabilities to operation ID, operation kind, resolved
   topology, relay binding, and source/destination scope. A frontend or
   Companion that cannot perform V2 must fail deterministically; no request may
   negotiate or fall back to a V1 route.
8. Implement V2 backend endpoints, Companion bindings, and frontend callers,
   then delete the corresponding V1 implementation surface in the same
   cutover. V2 must preserve the intended archive semantics across all four
   topologies, but V1 request/response compatibility is not a requirement.

Acceptance criteria:

- The target database passes the legacy-state preflight or has been explicitly
  reset; no V1 archive operation or direct-local session is recovered as V2.
- V2 route, manifest, result, capability, and checkpoint schemas cover all four
  topologies and all three archive operations.
- Durable operations, direct-local sessions, frontend recovery handles, and
  Companion capabilities are V2-pinned; mismatched, missing, or tampered
  versions are rejected before lifecycle processing or checkpoint parsing.
- V2 resume tests prove durable decisions survive pause/retry/ignore while
  aggregate counters are derived solely from terminal member outcomes.
- The V2 fixtures and actual-executor harness cover malformed input,
  cancellation, collisions, partial writes, source changes, transport failure,
  decisions, resume, and terminal transitions for every applicable topology.

### 6. Remove V1 Implementation Surfaces And Prove The Cutover

1. Remove all V1 archive routes, direction-specific member/control payloads,
   Companion bindings, frontend calls, relay payload types, legacy checkpoint
   parsers, compatibility readers, and `written_members` fields. Move only
   enduring semantic examples into V2 fixtures; do not retain V1 fixtures in
   executable archive tests.
2. Remove the V1 route-binding inventory, retention language, migration
   branches, and version fallback logic from production code. A request to a
   former V1 route must be absent from the router, and a V1-shaped payload or
   checkpoint presented to a V2 endpoint must fail with the documented stable
   V2 validation error.
3. Keep the topology resolver and scoped relay authorization, but express them
   solely in V2 terms. Removing directional V1 business workflows must not
   weaken capability checks for operation ID, contract version, operation kind,
   resolved topology, relay binding, or source/destination scope.
4. Add cutover tests for an empty/reset legacy database; V2-only operation
   creation, inspection, relay, direct-local execution, and recovery; rejected
   V1 routes, payloads, capabilities, and checkpoints; version-confusion and
   signature-tampering attempts; and failed V2 capability readiness. Run the
   full V2 corpus and actual-executor conformance harness across all four
   topologies.
5. Make the repository gate reject any production reference to V1 archive
   routes, V1 checkpoint parsing, `written_members`, or a V1 fallback path. It
   must run the V2 backend and Companion route-binding, corpus, topology,
   static-analysis, formatting, and whitespace checks.

Acceptance criteria:

- No production archive path, request, checkpoint, capability, direct-local
  session, or frontend recovery handle accepts V1.
- No code references `written_members`, a V1 archive route, or a V1 checkpoint
  migration/fallback path.
- V2 retains one normalized route family per operation while topology adapters
  and scoped relay authorization remain bounded implementation details.
- All archive tests run through the V2 contract and coordinator family, and the
  repository gate rejects accidental reintroduction of legacy behavior.

### 7. Consolidate V2 Contract Boundaries And Cross-Runtime Execution

Complete the following hardening and refactoring work after the V2 cutover.
It preserves the bounded SMB/local adapters and does not introduce a generic
filesystem abstraction.

1. Make durable checkpoint validity contract-driven. `prepared` and the
   relay-preflight `accepted` phase are the only durable phases allowed to have
   no checkpoint. Represent that state explicitly as a null checkpoint rather
   than `{}`. For every later V2 creation or extraction phase, select the
   strict checkpoint validator solely from the operation kind, before
   coordinator processing or persistence. Reject an absent, malformed, partial,
   wrong-kind, or V1-shaped checkpoint before I/O.
2. Replace inferred relay-purpose selection with one explicit, exhaustive
    topology-binding registry in Python and one matching exhaustive resolver in
    Rust. The versioned relay-bindings fixture remains the language-neutral test
    oracle. Both runtimes must assert exact fixture parity, uniqueness, complete
    coverage of mixed topologies, and controlled rejection of unsupported keys.
3. Resolve relay authorization once per backend request. A typed scoped relay
    context must validate the capability, owned V2 operation, topology binding,
    contract version, kind, manifest hash, and source/destination scope once,
    then be reused by the route-specific action. Route dispatch may select
    bounded creation or extraction bindings, but must not repeat operation lookup
    or independently recompute authorization.
4. Replace frontend direction-specific archive creation methods with one
    preparation/execution/cancellation lifecycle. Resolve the frontend executor
    through one immutable execution plan; backend and Companion adapters retain
    their bounded direct-local or relay details internally. The foreground
    recovery handle remains durable only when the selected plan owns a durable
    backend operation.
5. Keep the fixture-driven actual-executor harness as the fast exhaustive gate,
    and add compact cross-runtime relay interoperability coverage. The integration
    suite must run Companion's real relay transport against an ephemeral seeded
    FastAPI backend using real V2 capabilities and operation state. It covers
    creation and extraction in both mixed directions, successful traffic, stable
    V2 errors, and idempotency replay without Docker or a live SMB share.
6. Consolidate duplicated archive-member path normalization behind one V2
    canonical-path helper while retaining operation-specific error messages. Do
    not collapse creation and extraction manifest types: their metadata differs
    intentionally. Defer further checkpoint-plan object consolidation unless the
    strict boundary tests expose redundant state traversal.

Acceptance criteria:

- A V2 operation has either an explicit uninitialized preflight checkpoint or a
   complete validated checkpoint matching its kind; no shape probe selects a
   validation path.
- Python and Rust topology selection agree exactly with the V2 binding fixture.
- Every relay route performs one authoritative scoped-resolution step before
   action dispatch.
- The frontend coordinator contains no direction-specific execution method
   selection.
- A CI-capable loopback integration suite proves real backend/Companion relay
   serialization, capability, idempotency, and error-envelope interoperability.

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
- Do not remove V1 routes until their V2 replacement, legacy-state preflight,
   and V2-only validation gate have completed.
- Do not migrate or reinterpret interrupted V1 operations as V2; explicitly
   reset legacy archive state before the cutover.
- Do not make direct local sessions durable backend operations without a
  separate ownership and recovery design.
