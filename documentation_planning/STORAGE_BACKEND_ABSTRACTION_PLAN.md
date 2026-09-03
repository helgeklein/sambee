# Storage Backend Abstraction Plan

## Purpose

Separate two concepts that are currently conflated in the browser frontend:

- a **storage backend**, which determines where bytes and directory operations
  run (the Sambee server for SMB connections or the local Companion for local
  drives); and
- a **content provider**, which determines how a location is interpreted
  (physical files, ZIP members, and future virtual formats).

The current content-provider work correctly prevents generic UI from treating
ZIP members as physical files. It does not yet abstract the SMB/Companion
transport boundary. Backend identity is encoded as a `local-drive:` prefix in a
string connection ID, and that representation is interpreted by the API
service, Companion service, operation coordinator, and browser UI.

This plan makes backend selection, authentication, capabilities, and file
operation transport provider-owned without changing the existing HTTP API,
Companion protocol, archive formats, or authorization rules.

## Relationship To The Existing Content-Provider Plan

`CONTENT_PROVIDER_OPERATION_ARCHITECTURE_PLAN.md` remains the plan for opaque
content locations, virtual providers, and browser operation routing. This
document extends it below the physical-content layer:

```text
Browser UI
  -> content operation coordinator
    -> content provider (physical, ZIP, future virtual formats)
      -> storage backend registry (Sambee SMB, Companion local drive)
        -> authenticated HTTP/WebSocket transport
```

The two layers answer different questions:

| Layer | Question | Examples |
| --- | --- | --- |
| Content provider | How is this content interpreted? | physical directory, ZIP archive member |
| Storage backend | Where and how is this content accessed? | Sambee server SMB connection, Companion drive |

ZIP remains a virtual content provider. It is not a third backend.

## Current State

### Existing components

| Component | Current responsibility | Problem |
| --- | --- | --- |
| `services/backendRouter.ts` | Maps synthetic `local-drive:` IDs to Companion URLs and drive IDs. | Backend identity is a string convention available throughout the UI. |
| `services/api.ts` | Holds both the JWT-authenticated Sambee Axios client and HMAC-authenticated Companion Axios client. | A server API facade also acts as a backend multiplexer. |
| `services/companion.ts` | Pairing, HMAC headers, drive discovery, local browsing, archive creation, Companion WebSockets. | HMAC/secret ownership is duplicated with `ApiService`. |
| `FileBrowser/contentProviders.ts` | Physical and ZIP list/read/capabilities. | The physical provider delegates to an API facade that still performs hidden backend selection. |
| `FileBrowser/contentOperations.ts` | Copy/move/mutation/archive/native-open coordination. | It selects local versus remote transports directly. |
| Browser UI and access helpers | Presentation and action eligibility. | Some code still branches on `isLocalDrive` or a synthetic connection ID. |

### Constraints

- Keep server authorization and Companion path validation authoritative.
- Preserve canonical browse routes, including their current `local-drive:`
  compatibility representation during migration.
- Preserve JWT authentication for Sambee requests and HMAC pairing for
  Companion requests.
- Preserve the current persistent Companion pairing behavior: the pairing
   secret remains in browser `localStorage` for this migration, but only one
   session module may read it.
- Do not turn the UI into a generic RPC dispatcher or expose raw transport
  details through browser-facing types.
- Keep ZIP read-only. This migration must not enable archive mutation.
- Do not mix this work with a backend API or Companion wire-protocol redesign.

## Target Architecture

### Opaque storage target

Introduce an internal, discriminated storage target instead of deriving the
backend from a connection-ID prefix at arbitrary call sites.

```ts
type StorageTarget =
  | { kind: "smb"; connectionId: string }
  | { kind: "local"; driveId: string };

interface StorageDirectoryLocation {
  target: StorageTarget;
  path: string;
}

interface StorageItemLocation {
   target: StorageTarget;
   path: string;
}

interface StorageCapabilitySnapshot {
   capabilityRevision: number;
   connections: readonly Connection[];
   companion: CompanionSessionSnapshot;
}
}

interface ResolvedStorageTarget {
   target: StorageTarget;
   /** Immutable metadata needed for browser-file capability decisions. */
    /** The atomic catalog/session snapshot that produced this target. */
    capabilitySnapshot: StorageCapabilitySnapshot;
   capabilityRevision: number;
}

interface ResolvedStorageDirectoryLocation extends StorageDirectoryLocation {
   resolvedTarget: ResolvedStorageTarget;
}

interface ResolvedStorageItemLocation extends StorageItemLocation {
   resolvedTarget: ResolvedStorageTarget;
}
```

`StorageTarget` is owned by the backend registry. Browser UI continues to use
opaque `ContentLocation` and `ContentItemHandle`; it does not receive or
inspect `StorageTarget`.
their Companion-derived capabilities are available through the attached
capability snapshot. The registry refreshes this snapshot atomically whenever
the connection list or Companion session changes; it does not make
read-only/writable decisions from a connection-ID prefix.
of backend decisions elsewhere.

Directory and item locations are deliberately separate, even though both carry
a target and a backend-relative path. `list`, `create`, and destination
operations accept only directory locations. `read`, `getInfo`, `rename`,
`remove`, and native opening accept only item locations. A `WriteFileRequest`
contains a file name while its destination is a directory location; no caller
or backend may infer which interpretation applies or concatenate a filename
twice.

### Neutral contract module

Place storage-layer types in a dependency-free `storageContracts.ts` module.
It may import shared domain data models such as `Connection`, `FileInfo`, and
`DirectoryListing`, but it must not import `contentProviders.ts`,
`contentOperations.ts`, React, or browser UI modules.

The storage layer defines its own data-only request/result types:

```ts
interface StorageDirectoryReference {
   connectionId: string;
   path: string;
}

interface StorageItemReference {
   connectionId: string;
   path: string;
}

type StorageReadRequest =
   | { kind: "raw" }
   | { kind: "text" }
   | { kind: "image"; viewportWidth?: number; viewportHeight?: number; noResizing?: boolean }
   | { kind: "pdf"; variant?: "normalized"; screenProfile?: StoragePdfScreenProfile };

interface StoragePdfScreenProfile {
   viewportWidth: number;
   viewportHeight: number;
   devicePixelRatio?: number;
}

interface StorageListOptions {
   signal?: AbortSignal;
}

interface StorageRequestOptions {
   signal?: AbortSignal;
}

interface StorageReadOptions {
   signal?: AbortSignal;
}

type StorageArchiveDirectoryListing = DirectoryListing;

interface WriteFileRequest {
   name: string;
   content: Blob;
   overwrite: boolean;
   signal?: AbortSignal;
   onProgress?: (progress: StorageTransferProgress) => void;
}

interface StorageCreateRequest {
   name: string;
   kind: "file" | "directory";
   signal?: AbortSignal;
}

interface SameBackendTransferRequest {
   source: ResolvedStorageItemLocation;
   destination: ResolvedStorageDirectoryLocation;
   targetName?: string;
   overwrite: boolean;
   signal?: AbortSignal;
   onProgress?: (progress: StorageTransferProgress) => void;
}

interface StorageTransferProgress {
   completedItems: number;
   totalItems: number | null;
   transferredBytes: number;
   totalBytes: number | null;
   currentItemName: string | null;
}

type StorageOperationResult =
   | { status: "completed"; effects: StorageMutationEffects }
   | { status: "failed"; effects: StorageMutationEffects; error: StorageOperationError }
   | { status: "partial-output"; effects: StorageMutationEffects; error: StorageOperationError }
   | { status: "cancelled"; effects: StorageMutationEffects; error: StorageCancelledError };

interface StorageMutationEffects {
   source: "unchanged" | "mutated" | "unknown";
   destination: "unchanged" | "mutated" | "unknown";
}

type StorageOperationError =
   | { code: "unavailable"; reason: "read-only" | "unpaired" | "unsupported" | "missing-target" }
   | { code: "validation"; reason: "heterogeneous-source-target" | "invalid-name" }
   | { code: "stale-capability"; expectedRevision: number; actualRevision: number }
   | { code: "conflict"; conflict: StorageConflict }
   | { code: "transport"; detail: string };

interface StorageCancelledError {
   code: "cancelled";
   detail: string | null;
}

interface StorageConflict {
   target: ResolvedStorageItemLocation;
   existingKind: "file" | "directory";
}

interface StorageResolvedActivation {
   kind: "item" | "directory";
   location: ResolvedStorageItemLocation | ResolvedStorageDirectoryLocation;
}

interface StorageNativeOpenOptions {
   forcePicker: boolean;
   themeJson: string;
}

type StorageNativeOpenResult =
   | { kind: "opened-locally" }
   | { kind: "browser-launch"; uri: string }
   | { kind: "unavailable"; error: Extract<StorageOperationError, { code: "unavailable" | "stale-capability" }> }
   | { kind: "failed"; error: Extract<StorageOperationError, { code: "transport" }> | StorageMissingTargetError };

interface StorageMissingTargetError {
   code: "missing-target";
   /** Allows the coordinator to remove a permanently invalid recent item. */
   permanent: true;
}

interface StorageArchiveExtractionRequest {
   source: ResolvedStorageItemLocation;
   destination: ResolvedStorageDirectoryLocation;
   destinationName: string;
   signal?: AbortSignal;
   onProgress?: (progress: StorageTransferProgress) => void;
}

interface StorageArchiveCreationRequest {
   /**
    * Physical files and directories from exactly one source target. Virtual
    * items and sources whose target differs from `source.target` are rejected.
    */
   source: {
      target: ResolvedStorageTarget;
      items: readonly [ResolvedStorageItemLocation, ...ResolvedStorageItemLocation[]];
   };
   destination: ResolvedStorageDirectoryLocation;
   destinationName: string;
   overwrite: boolean;
   signal?: AbortSignal;
   onProgress?: (progress: StorageTransferProgress) => void;
}

interface StorageRecoveryHandle {
   schemaVersion: 1;
   backendKind: StorageTarget["kind"];
   opaqueOperationId: string;
   expiresAt: number;
}

interface StorageOperationExecution {
   result: Promise<StorageOperationResult>;
   /**
    * Settles as soon as a remote operation becomes recoverable, never only when
    * `result` settles. Resolves to null for deliberately non-recoverable work.
    */
   recoveryReady: Promise<StorageRecoveryHandle | null>;
   cancel(): Promise<StorageOperationResult>;
   isCancellationRequested(): boolean;
}

interface StorageOperationRecovery {
   cancelRecoveredOperation(handle: StorageRecoveryHandle): Promise<StorageOperationResult>;
   getRecoveredOperationStatus?(handle: StorageRecoveryHandle): Promise<StorageOperationResult | null>;
}

interface CompanionDriveDescriptor {
   driveId: string;
   name: string;
   path: string;
}

interface CompanionSessionSnapshot {
   status: "unpaired" | "pairing" | "paired" | "unavailable";
   revision: number;
   drives: readonly CompanionDriveDescriptor[];
   error: { code: "unavailable" | "authentication-failed" | "transport"; detail: string } | null;
}
```

`contentProviders.ts` maps `ContentReadRequest` and `PdfScreenProfile` to
their neutral storage equivalents. `contentOperations.ts` maps
`StorageOperationExecution` and storage errors into browser-facing operation
results. This direction is one-way: storage contracts and backend adapters
cannot depend on content-provider or coordinator types.

Every named type in the `StorageBackend` interface must be defined in this
neutral module before any adapter is introduced. In particular, the contracts
must define conflict data, cancellation/partial-output results, target naming,
and mutation effects. Expected mutation failures, including conflict,
unavailable, and stale capability, return `StorageOperationResult` rather than
throwing an untyped transport exception. Unexpected programming failures may
still reject and must be normalized by the coordinator. `unknown` effects are
conservative: the coordinator refreshes both relevant opaque locations.
Storage adapters never return pane references, content locations, or UI
callbacks.

`ResolvedStorageTarget` deliberately contains identity, authoritative catalog
metadata, and the revision that produced it, but not capabilities. The registry
first resolves that metadata, selects its backend, then asks the backend to
evaluate capabilities from the resolved target and current Companion session.
This makes the backend evaluation one-directional and avoids a target whose
construction depends on its own capabilities. A revision mismatch makes a
resolved target stale; the coordinator must resolve a new target rather than
reuse it.

### Backend interfaces

Create a browser-file-specific interface. Do not force all administrative,
authentication, or settings endpoints into this abstraction.

```ts
interface StorageBackend {
  readonly kind: StorageTarget["kind"];

   getCapabilities(target: ResolvedStorageTarget): StorageBackendCapabilities;
   list(location: ResolvedStorageDirectoryLocation, options?: StorageListOptions): Promise<DirectoryListing>;
   getInfo(location: ResolvedStorageItemLocation, options?: StorageRequestOptions): Promise<FileInfo>;
   read(location: ResolvedStorageItemLocation, request: StorageReadRequest): Promise<Blob>;
   writeFile(destination: ResolvedStorageDirectoryLocation, request: WriteFileRequest): Promise<StorageOperationResult>;
   create(destination: ResolvedStorageDirectoryLocation, request: StorageCreateRequest): Promise<StorageOperationResult>;
   rename(item: ResolvedStorageItemLocation, name: string): Promise<StorageOperationResult>;
   remove(item: ResolvedStorageItemLocation): Promise<StorageOperationResult>;
   copyWithinBackend(request: SameBackendTransferRequest): Promise<StorageOperationResult>;
   moveWithinBackend(request: SameBackendTransferRequest): Promise<StorageOperationResult>;
   resolveActivation?(item: ResolvedStorageItemLocation): Promise<StorageResolvedActivation>;
   openInNativeApp?(item: ResolvedStorageItemLocation, options: StorageNativeOpenOptions): Promise<StorageNativeOpenResult>;
   archive?: ArchiveSourceOperations;
   archiveCreation?: StorageArchiveCreationOperations;
   recovery?: StorageOperationRecovery;
}

interface StorageBackendRegistry {
   resolveDirectory(reference: StorageDirectoryReference): ResolvedStorageDirectoryLocation;
   resolveItem(reference: StorageItemReference): ResolvedStorageItemLocation;
  getBackend(target: StorageTarget): StorageBackend;
}
```

The interface should contain only capabilities that have a stable browser-file
meaning. For example, edit locks remain a separate server-only capability until
there is a real local equivalent.

`ResolvedStorageTarget.connection` supplies the SMB connection's authoritative
access-mode snapshot to capability evaluation. Local drives use `null` because
their Companion-derived capabilities are authoritative. The registry refreshes
this snapshot whenever the connection list changes; it does not make
read-only/writable decisions from a connection-ID prefix.

`copyWithinBackend` and `moveWithinBackend` accept only locations whose
resolved targets are owned by the same adapter instance, not merely targets
with equal IDs or kinds. Thus SMB-to-SMB across distinct SMB connection IDs is
handled by the one `SambeeSmbBackend`, and local-to-local across distinct drives
is handled by the one `CompanionLocalBackend`. Each adapter validates ownership
of both references before sending a request and rejects every cross-adapter
request defensively. They retain native SMB/local server-side transfer behavior.

`writeFile` is required because current SMB/local transfers are browser
mediated for a cross-backend file copy: the coordinator reads a source blob,
writes it to the destination, and recursively creates/list directories. Its
request includes the destination filename, overwrite policy, `AbortSignal`,
and progress callback. The first implementation may preserve the existing
`Blob` transport; a later streaming optimization must keep the same request,
conflict, cancellation, and partial-failure semantics.

```ts
interface StorageBackendCapabilities {
   readable: boolean;
   writable: boolean;
   canList: boolean;
   canReadArchive: boolean;
   canWriteFile: boolean;
   canResolveActivation: boolean;
   canOpenInNativeApp: boolean;
}

interface ArchiveSourceOperations {
   listDirectory(source: ResolvedStorageItemLocation, virtualPath: string, options?: StorageListOptions): Promise<StorageArchiveDirectoryListing>;
   readMember(source: ResolvedStorageItemLocation, memberPath: string, request: StorageReadRequest, options?: StorageReadOptions): Promise<Blob>;
   invalidateMemberPdfDerivative(source: ResolvedStorageItemLocation, memberPath: string, profile?: StoragePdfScreenProfile): Promise<void>;
   extract?(request: StorageArchiveExtractionRequest): Promise<StorageOperationExecution>;
}

interface StorageArchiveCreationOperations {
   /** Supports physical sources and a destination all owned by this adapter. */
   start(request: StorageArchiveCreationRequest): StorageOperationExecution;
}

interface StorageArchiveCreationStrategy {
   start(request: StorageArchiveCreationRequest): StorageOperationExecution;
}

interface StorageArchiveCreationStrategyRegistry {
   getStrategy(request: StorageArchiveCreationRequest): StorageArchiveCreationStrategy | null;
}
```

Archive extraction and archive creation are distinct operations. Extraction is
an optional capability of the backend that owns the archive source.
`StorageArchiveCreationRequest` instead models creation from one or more
physical source items from one source target. For SMB-to-SMB and local-to-local,
the coordinator calls the owning backend's `archiveCreation.start`; that adapter
verifies the non-empty source collection and ownership of every source and
destination. For local-to-SMB and SMB-to-local, the composition root supplies a
named `StorageArchiveCreationStrategy` through the strategy registry. Each
strategy may compose source and destination adapters but returns one
`StorageOperationExecution`. A missing strategy or heterogeneous source target
is a structured unavailable/validation result before transport. Every strategy
rejects virtual sources and virtual destinations before transport, preserves the
existing overwrite policy, and uses the same structured outcome model as all
other mutations.

Only the backend that starts remotely recoverable work creates a
`StorageRecoveryHandle`; it validates the schema version, backend kind, expiry,
and opaque ID before cancellation or status lookup. The lifecycle service
subscribes to `recoveryReady` as soon as execution starts and persists a handle
atomically when the promise resolves, before waiting for `result`. The promise
must settle after remote-operation preparation and before either normal
completion or a reload can rely on recovery; it resolves to `null` for work
that can never be recovered. The lifecycle service then asks the matching
adapter's `recovery` capability to recover or cancel the handle. Client-only
Companion work uses an in-memory abort signal, resolves `recoveryReady` to
`null`, and is deliberately cancelled rather than reload-recovered. No
lifecycle or UI code calls a raw backend cancellation URL.

Only neutral storage references may be resolved by the registry. The physical
content provider/coordinator is the sole boundary that maps a
`PhysicalLocation` or `PhysicalItemHandle` to `StorageDirectoryReference` or
`StorageItemReference`. A virtual provider must map and resolve its physical
`location.source` first, then ask that source backend for the optional archive
capability. Passing a virtual location directly to a storage backend is a type
and runtime error.

The registry must distinguish a directory reference from an item reference. It
resolves a virtual ZIP source as an item reference, because the ZIP file itself
is the archive operation source.

### Composition root and capability freshness

Create one browser-file composition root, for example
`createBrowserContentServices`, which receives the current connection catalog,
the `CompanionSession`, and the server/Companion transports. It constructs and
returns a registry, physical and virtual providers, and the operation
coordinator as one coherent dependency graph. Its factory dependencies include
the private `StorageArchiveCreationStrategyRegistry`, which it injects into the
coordinator; it is not a public `BrowserContentServices` property or React
context value.

```ts
interface BrowserContentServices {
   providers: ContentProviderRegistry;
   operations: ContentOperationCoordinator;
   getSnapshot(): BrowserContentServicesSnapshot;
   subscribe(listener: () => void): () => void;
   updateConnections(connections: readonly Connection[]): void;
   dispose(): void;
}

interface BrowserContentServiceFactoryDependencies {
   /** Private coordinator dependency; browser UI does not receive this registry. */
   archiveCreationStrategies: StorageArchiveCreationStrategyRegistry;
}

interface BrowserContentServicesSnapshot extends StorageCapabilitySnapshot {
}

interface CompanionSession {
   getSnapshot(): CompanionSessionSnapshot;
   subscribe(listener: () => void): () => void;
   getSigningHeaders(): Promise<Record<string, string>>;
   getSignedQuery(): Promise<string>;
   getSignedWebSocketUrl(): Promise<string | null>;
   clearPairing(): void;
}
```

Production code obtains these services from one React context/hook. Tests use
the same factory with fake transports and a controlled connection catalog;
they must not monkey-patch global provider or coordinator singletons.

The factory subscribes to `CompanionSession`, incorporates its immutable status
snapshot into `BrowserContentServicesSnapshot`, and increments
`capabilityRevision` whenever pairing state, local drives, or server connection
metadata changes. The React provider consumes this snapshot with
`useSyncExternalStore`, so toolbar, command-palette, pane, and dialog
availability rerender when either the connection catalog or Companion session
changes. The composition root unsubscribes through `dispose()` when its
provider unmounts.

UI state and dialog drafts retain only opaque `ContentLocation` and
`ContentItemHandle`, never `ResolvedStorageTarget`, backend capability objects,
backend instances, or a capability revision. The provider/coordinator resolves
fresh locations and checks availability both when rendering/enabling an action
and immediately before execution. An operation captures the current
`capabilityRevision`; if it changes before the next destructive backend call,
it re-resolves and revalidates. If the action is no longer valid, it returns a
structured `stale-capability` result without continuing. For a multi-step
operation that already produced output, it returns `partial-output` together
with the stale-capability cause and preserves any foreground archive marker for
recovery. This applies equally to connection-catalog and Companion-session
changes.

There is no mutable module-level default provider/coordinator. New code obtains
services from the context hook. During migration, a non-React helper receives
an explicit `BrowserContentServices` or narrow provider/coordinator dependency
as its first argument. Transitional wrappers must delegate to that explicit
argument and are forbidden from creating or caching their own registry; remove
the current no-argument global helpers once callers migrate.

### Concrete backends

#### Sambee SMB backend

- Owns requests against the primary Sambee server for SMB connection IDs.
- Uses the existing JWT Axios client and server error/re-authentication logic.
- Implements SMB list/read/info/mutation/archive preparation and companion URI
  creation using existing server endpoints.
- Owns server-side archive member endpoints when a virtual provider requires
  them.

#### Companion local backend

- Owns all direct localhost Companion requests and the HMAC authentication
  implementation.
- Receives a drive ID, never a `local-drive:`-prefixed pseudo connection ID.
- Implements local list/read/info/mutation, shortcut activation, local native
  opening, local archive creation, and Companion WebSocket URL creation.
- Exposes pairing/session state through a dedicated Companion session service;
  it does not own server authentication or application settings.

### Authentication ownership

Create one `CompanionAuth`/`CompanionSession` module that owns:

- the `localStorage` key, persistence, retrieval, and removal of the pairing
   secret;
- current-origin HMAC header construction;
- URL-query and WebSocket authentication construction; and
- the paired/unpaired/pending status used by backend capabilities.

Both `CompanionBackend` and pairing UI use this module. Remove the duplicate
HMAC implementations from `ApiService` and `CompanionService` after their
callers have moved.

This centralizes current persistence behavior; it is not a claim that
`localStorage` is protected from same-origin script. An XSS on the Sambee
origin can currently exfiltrate the pairing secret and must remain in the
application threat model. `sessionStorage` would break persistence across tabs
and reloads; IndexedDB alone would not improve this boundary. A separately
approved hardening project may persist a non-extractable Web Crypto HMAC key in
IndexedDB after pairing, which limits raw-secret export but does not prevent
same-origin injected code from requesting signatures. A stronger boundary
would require a Companion wire-protocol/session redesign and is out of scope.

### Content-provider composition

The physical content provider delegates physical list/read/invalidation to the
registry-selected backend. The ZIP provider delegates its archive source to the
backend that owns that source. It never needs to know whether that backend is
SMB or local.

```text
ContentLocation(kind: physical)
  -> PhysicalContentProvider
  -> StorageBackendRegistry
  -> SambeeSmbBackend or CompanionLocalBackend

ContentLocation(kind: virtual, providerId: zip)
  -> ZipContentProvider
  -> source StorageLocation
  -> backend archive-member capability
```

### Cross-backend operation coordination

Retain a separate operation coordinator. It decides which backend-provided
strategy can perform a request that spans locations; it does not parse
connection IDs or import raw HTTP clients.

| Operation | Owner |
| --- | --- |
| Physical copy/move within a backend | Owning `StorageBackend` |
| Cross-backend copy/move | `ContentOperationCoordinator`, using a declared backend transfer strategy |
| SMB-to-SMB archive creation | Sambee SMB backend |
| Local-to-local archive creation | Companion local backend |
| SMB/local mixed archive creation | Coordinator, using a named relay/archive strategy supplied by the involved backends |
| ZIP browse/read | ZIP provider plus source backend archive capability |
| ZIP mutation | Unavailable until ZIP explicitly implements it |

The coordinator receives opaque handles and returns structured availability,
progress, refresh targets, cancellation, and errors. It must not expose a
backend kind or transport decision to browser UI.

## Invariants

- Only the storage backend registry converts a compatibility connection ID into
  a backend target.
- The registry resolves physical locations only and supplies the current
   connection capability snapshot; virtual providers resolve their physical
   source location instead.
- Only the local backend and Companion session own HMAC credentials and direct
  Companion HTTP/WebSocket calls.
- Only the SMB backend owns direct server file/archive HTTP calls.
- Content providers own content-format interpretation, not backend selection.
- Browser UI, dialogs, hooks, and keyboard handlers use opaque locations,
  handles, operation availability, and presentation data only.
- Cross-backend behavior is selected by capability/strategy, not
  `if (isLocalDrive(...))` branches.
- Same-backend copy/move and browser-mediated cross-backend transfers have
   separate, explicit contracts. Both preserve overwrite, recursive-directory,
   cancellation, progress, conflict, and partial-failure behavior.
- Every operation checks availability before displaying an action and again
  immediately before transport execution.
- Existing server and Companion validations remain required. Frontend
  capabilities are not security boundaries.

## Implementation Phases

### Phase 0: Characterize and protect current behavior

1. Inventory every file-browser operation by backend combination: SMB-to-SMB,
   local-to-local, local-to-SMB, SMB-to-local, physical-to-ZIP, ZIP-to-physical,
   and ZIP-to-ZIP.
2. Add operation-coordinator tests for each supported archive route, including
   argument construction, cancellation before/after backend operation ID
   creation, partial output, and recovery marker behavior.
3. Add direct tests for same-backend and browser-mediated cross-backend copy and
   move, including files, recursive directories, overwrite conflicts, aborts,
   upload/download failures, and the copy-then-delete move sequence.
4. Add direct tests for both native-open routes: local shortcut resolution and
   remote companion-URI launch.
5. Add contract tests that reject an item where a directory is required, a
   directory where an item is required, virtual locations passed to storage
   resolution, cross-backend requests passed to same-backend transfer, and
   storage modules that import content-layer modules. Verify every expected
   mutation failure returns a typed outcome with conservative effects instead
   of an untyped rejected promise.
6. Add composition-root tests with fake SMB/Companion transports that verify
   service instances do not share mutable global registry state.
7. Add architecture tests that prevent browser UI from importing raw file
   transports or testing `local-drive:` / `isLocalDrive` to decide operations.
8. Characterize archive creation separately from ZIP extraction: multiple
   physical sources, every backend combination, conflicts, cancellation before
   and after remote operation creation, partial output, recovery handle
   publication/persistence timing, expiry, and malformed/foreign-handle
   rejection. Verify every source selection is non-empty and belongs to exactly
   one source target; heterogeneous selections fail before transport. Cover
   cancellation with and without partial output and assert its structured cause.
9. Preserve baseline behavior with `./scripts/test` before each phase.

Acceptance: existing behavior is documented by tests, and any later routing
change has a backend-combination regression test.

### Phase 1: Establish backend-neutral types and a compatibility resolver

1. Add a dependency-free `storageContracts.ts` module containing storage
   targets, separate directory/item locations, neutral read/archive/operation
   types, session snapshots, recovery handles, and backend capabilities. It
   must not import content-provider, coordinator, React, or UI modules.
2. Add `ResolvedStorageTarget`, separate resolved directory/item locations,
   archive-source operations, and a `StorageBackendRegistry` that consumes only
   the neutral contracts. Keep capability evaluation outside the resolved target
   construction: resolve identity/metadata first, then evaluate adapter
   capabilities from that snapshot and the current Companion session.
3. Implement one compatibility resolver that accepts a `PhysicalLocation` for
   directories or `PhysicalItemHandle` for items, maps it to an SMB target or
   local-drive target, and attaches the current connection access-mode metadata.
4. Make the registry reject virtual locations, directory/item mismatches, and
   malformed compatibility IDs at runtime as well as through TypeScript types.
5. Keep `ContentLocation` externally unchanged. Its physical provider may use
   the resolver internally.
6. Make virtual providers explicitly resolve `location.source` as a physical
   item through the physical-only resolver. Reject virtual locations passed to
   the registry.
7. Mark `getBaseUrl`, `getBrowseSegment`, `extractDriveId`, and direct
   local-prefix parsing as compatibility-only APIs. Do not remove them yet.
8. Add unit tests for target resolution, malformed local IDs, case handling,
   read-only connection snapshots, connection-list refreshes, virtual-location
   rejection, directory/item mismatch rejection, and compatibility route round
   trips. Verify every type named by the adapter interface is defined in the
   neutral contract module. Verify a resolved target is constructed without
   capabilities and becomes stale when its atomic catalog/session capability
   snapshot revision changes.

Acceptance: one module is the sole new place that translates a physical
location/item to backend identity; storage contracts have no upward
dependencies; no behavior changes for browser users.

### Phase 2: Unify Companion session and authentication

1. Extract the existing `localStorage` secret persistence, HMAC signing, header creation, query authentication,
   and WebSocket authentication from `companion.ts` into `companionSession.ts`.
2. Make pairing and drive discovery call the session-aware Companion client.
3. Replace `ApiService`'s duplicate Companion-header and query-auth code with
   the same session module.
4. Preserve timeouts, error shape, origin binding, and pairing state exactly.
5. Add focused tests for no-secret, paired-secret persistence across reload,
   removal on unpair, stale timestamp/error, HTTP headers, viewer query
   parameters, WebSocket query generation, immutable session snapshots, and
   subscriber notifications for pairing, failure, and drive-catalog changes.

Acceptance: there is one implementation for Companion credential access and
HMAC generation, the pairing secret is read only by that module, and no
server/Companion request semantics change.

### Phase 3: Introduce concrete backend adapters without changing UI callers

1. Add `createBrowserContentServices` and a React provider/hook as the only
   browser-file composition root. Construct a registry, providers, and
   coordinator from explicit server transport, Companion transport,
   `CompanionSession`, connection-catalog dependencies, and a private
   `StorageArchiveCreationStrategyRegistry` injected into the coordinator.
2. Make connection-catalog updates replace the registry capability snapshot
   atomically. Subscribe to Companion-session changes, publish one immutable
   snapshot through `useSyncExternalStore`, and increment its
   `capabilityRevision` for either catalog or Companion changes. Do not expose
   resolved locations or backend objects in React state, pane state, dialog
   props, or operation drafts. Resolve targets and evaluate capabilities against
   this same immutable catalog-plus-Companion snapshot; adapters must not read
   mutable session state independently.
3. Implement `SambeeSmbBackend` as a narrow adapter over the existing server
   portion of `ApiService`.
4. Implement `CompanionLocalBackend` as the sole adapter over Companion file
   endpoints. It accepts `driveId` only.
5. Move physical list, file info, reads, create, rename, delete, copy/move,
   activation resolution, and native opening behind these adapters one method
   family at a time. Make each mutating adapter method return the declared
   `StorageOperationResult` for expected conflicts, availability failures, and
   stale capability rather than relying on caller-specific exception parsing.
   Map expected native-open failures to `StorageNativeOpenResult`, including a
   permanent missing target that preserves stale recent-item cleanup.
6. Add `writeFile` and explicit same-backend transfer implementations before
   migrating cross-backend transfer. Keep the current blob download/upload and
   recursive directory semantics behind a named coordinator strategy. Define
   and test adapter ownership so same-backend means one adapter instance, not
   equal connection IDs or target kinds.
7. Make backend capabilities derive from resolved connection metadata and
   Companion pairing state; do not reconstruct write eligibility from IDs in
   callers.
8. Keep the public `api.*` methods as temporary compatibility delegates until
   all browser callers have migrated; do not attempt an application-wide API
   facade rewrite.
9. Add backend contract tests that run the same operation test vectors against
   mock SMB and local transports. The contract vectors must cover every neutral
   request/result type, conflict policy, cancellation timing, and source/destination
   mutation outcome, including `unknown` effects after interrupted transport.
10. Implement recovery capabilities only for backends with a real remote
   operation handle. Validate persisted handles at the backend boundary; local
   abort-signal work must resolve `recoveryReady` to `null`. Verify that a
   remote handle is published and persisted immediately after remote operation
   preparation, rather than after operation completion.

Acceptance: browser-file backend decisions are made by factory-composed
registry and adapters, catalog and pairing refreshes rerender availability
without mutating stored operation drafts, and unrelated settings/admin/auth
consumers remain untouched.

### Phase 4: Compose physical and ZIP content providers with backends

1. Update the physical content provider to call the backend registry rather
   than `api` directly.
2. Update ZIP provider source access to resolve only its physical source and
   request the explicit archive-source capability from that backend. Reject a
   backend without archive support with a structured unavailable result.
3. Move provider capability derivation from static constants into the
   provider/backend capability composition, while preserving read-only ZIP.
4. Map content read/PDF and operation execution types to neutral storage
   contracts at the provider/coordinator boundary. Do not import
   `contentProviders.ts` or `contentOperations.ts` from a storage module.
5. Replace global `getContentProvider`, `getContentCapabilities`, and
   `readContent` singleton functions with services from the composition root.
   Retain transitional wrappers only when they receive an explicit service or
   narrow provider dependency; they cannot create, cache, or discover a second
   registry.
6. Replace legacy viewer convenience wrappers only after callers pass item
   handles; retain adapters for non-browser consumers temporarily.
7. Test physical and ZIP reads/lists on both backend targets where supported,
   including a capability/catalog update between UI availability evaluation and
   execution.

Acceptance: content providers determine format behavior and use backend
capabilities without inspecting a connection-ID prefix.

### Phase 5: Rework the operation coordinator around strategies

1. Replace direct `api`/`companionService` imports in `contentOperations.ts`
   with injected backend registry and named transfer/archive strategies.
2. Express availability in terms of source/destination capabilities and the
   paired Companion session, not connection-string predicates.
3. Use `copyWithinBackend`/`moveWithinBackend` only for one backend; use the
   explicit read/write recursive transfer strategy for two backends. Normalize
   conflict, cancellation, progress, and partial-output results at the
   coordinator boundary.
4. Move local shortcut resolution and native-open routing fully into the local
   backend; preserve the coordinator's opaque result callbacks.
5. Represent cross-backend archive creation with explicit strategy contracts
   for SMB-to-SMB, local-to-local, local-to-SMB, and SMB-to-local. Use the
   neutral multi-source creation request, keep ZIP extraction distinct, and
   select same-adapter `archiveCreation.start` or a composition-root supplied
   mixed strategy injected through the private strategy registry. Reject empty
   or heterogeneous source-target collections before selecting a strategy.
   Return one execution whose `recoveryReady` promise publishes an optional
   adapter-owned recovery handle.
6. Preserve foreground operation persistence/cancellation behind an operation
   lifecycle service. Subscribe to `recoveryReady`, persist only opaque,
   versioned recovery handles atomically when they become available, delegate
   reload cancellation/status to the owning backend recovery capability, and do
   not expose backend transport details to UI.
7. Require every public availability and execution method to re-resolve opaque
   handles/locations from the current catalog. Never accept a resolved location
   from a dialog, UI state, or earlier availability call.
8. Define a structured `stale-capability`/unavailable outcome and check the
   unified capability revision before every destructive step in multi-step
   copy, move, and archive strategies. On stale state, re-resolve/revalidate;
   return a no-output stale result if nothing changed, or a partial-output
   result with the stale cause and retained recovery marker if output exists.
   Cancellation similarly returns `cancelled` before output or `partial-output`
   with the structured cancellation cause after output.
9. Add a complete strategy matrix test suite including cancellation timing,
   capability changes between dialog-open and confirm, capability changes during
   recursive transfer, pairing loss during recursive transfer, and failure
   recovery.

Acceptance: `contentOperations.ts` no longer imports `isLocalDrive`, `api`, or
`companionService`; it coordinates capability-bearing backends only.

### Phase 6: Remove browser UI backend knowledge

1. Replace `canOpenFileInApp`, `isConnectionWritable`, and local-drive
   operation branches in browser UI with provider/coordinator availability.
2. Keep local-drive presentation icons and connection labels in presentation
   components, but provide them as connection metadata rather than recomputing
   transport identity from a string.
3. Route local-link activation through a provider/backend result so pane UI
   receives only “open viewer”, “open native app”, or “navigate to location”.
4. Remove local-drive path normalization from generic operation handlers;
   retain it only in the compatibility route boundary until routes migrate.
5. Strengthen the architecture test to ban backend-router imports from generic
   browser operation/UI modules, with narrow allow-lists for route and
   connection-presentation modules.

Acceptance: no generic browser operation/UI module branches on backend kind,
connection ID encoding, or backend-specific path representation.

### Phase 7: Retire compatibility routing and document extension points

1. Decide whether canonical routes retain `local-drive:` as a wire-compatible
   serialized form or adopt explicit backend route segments. Keep a parser for
   legacy bookmarked URLs for at least one compatibility release.
2. Remove `ApiService.companionApi`, duplicated HMAC functions, and legacy
   browser-file transport methods after all callers migrate.
3. Make direct raw backend clients private to backend modules through import
   restrictions and architecture tests.
4. Document how to add a new backend and how a virtual provider composes with
   backend capabilities.
5. Reassess edit-lock, upload, search, and WebSocket abstractions separately;
   extend the interface only when a second backend truly needs the capability.

Acceptance: a new backend requires one backend adapter and registry
registration, not UI-wide connection-ID conditionals.

## Testing Matrix

| Scenario | Required verification |
| --- | --- |
| SMB list/read/create/rename/delete | Uses Sambee backend, JWT behavior unchanged |
| Local list/read/create/rename/delete | Uses Companion backend, HMAC behavior unchanged |
| Local shortcut to file/directory | Backend resolves target; UI receives opaque action/result |
| SMB native open | Server returns Companion URI; UI does not select transport |
| Local native open | Local backend launches resolved local target |
| SMB-to-SMB transfer/archive | Existing server execution path and conflicts preserved |
| Local-to-local transfer/archive | Companion execution path, abort signal, and errors preserved |
| SMB/local copy/move | Explicit read/write strategy preserves recursion, conflicts, cancellation, progress, and copy-before-delete semantics |
| SMB/local mixed archive | Explicit relay strategy, session token, cancellation, recovery preserved |
| Archive creation versus extraction | Multi-source physical archive creation and ZIP extraction use distinct contracts and never accept virtual creation sources |
| Archive creation strategy selection | Same-adapter routes call `archiveCreation.start`; mixed routes use a composition-root strategy; unsupported routes fail before transport |
| Archive source ownership | A non-empty selection from one target preserves the current protocol; heterogeneous target selections return typed validation before transport |
| Recoverable remote archive operation | `recoveryReady` publishes an opaque versioned handle at remote-operation preparation; lifecycle persists it before completion, then owning backend validates, cancels, or reads status after reload without raw UI transport |
| Client-only local archive operation | Uses an in-memory abort signal, resolves `recoveryReady` to `null`, and is cancelled rather than reload-recovered |
| ZIP on supported source backend | Source physical location resolves first; archive list/read/download/invalidate work; writes unavailable |
| ZIP on unsupported source backend | Structured unavailable result; no server or Companion archive request |
| Virtual destination | Copy/move/create/archive creation rejected before transport |
| Directory/item contract | Storage rejects item-as-directory and directory-as-item calls before transport; content-to-storage mapping is the only use of content handle types |
| Same-backend transfer ownership | SMB connection-to-connection and local drive-to-drive use their owning adapter; cross-adapter input is rejected before transport |
| Connection catalog refresh | Dialog retains opaque handles; coordinator re-resolves and rejects changed read-only state before mutation |
| Atomic capability snapshot | Adapter capability evaluation receives one immutable connection catalog and Companion snapshot; no mixed-revision pairing/permission decision is possible |
| Companion session refresh | `useSyncExternalStore` rerenders availability after pairing/drive changes; unpaired execution is rejected before mutation |
| Capability change during operation | Each destructive step revalidates; no-output work returns stale-capability, while prior output returns a recoverable partial-output result |
| Cancellation during operation | No-output cancellation returns `cancelled`; cancellation after output returns `partial-output` with a structured cancellation cause and conservative effects |
| Composition root | Independently constructed test service graphs do not share provider registry, capabilities, Companion session state, or subscriptions |
| Transitional helpers | No-argument global helpers cannot read, cache, or construct service graphs; non-React callers receive explicit dependencies |
| Structured mutation outcome | Conflict, unavailable, and stale state return typed outcomes; interrupted transport reports conservative `unknown` effects and refreshes both opaque targets |
| Native-open result | Local pairing, shortcut resolution, and launch failures return typed results; permanent missing targets remove stale recents without raw error parsing |
| Reload/pagehide | Foreground operation cancellation/recovery retains or clears marker correctly |
| Unpaired Companion | Local/mixed operations report unavailable without issuing a raw request |

Run focused Vitest tests after each phase, then `npm run lint`, frontend type
checking, backend/Companion tests affected by request shapes, and finally
`./scripts/test` before a phase is considered complete.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| A large rewrite changes auth or request semantics. | Use compatibility delegates and migrate one operation family at a time. |
| Backend interface becomes an oversized mirror of every API endpoint. | Scope it to browser-file operations; retain application/server APIs outside it. |
| Cross-backend archives become hidden special cases again. | Give each route an explicit strategy and a matrix test. |
| Archive creation is conflated with ZIP extraction. | Use separate neutral requests, capabilities, and strategy tests; archive creation admits only physical sources and destinations. |
| Archive creation has no adapter invocation path. | Require same-adapter `archiveCreation.start` plus a composition-root mixed-strategy registry, and reject a missing strategy before transport. |
| Archive creation silently combines source targets. | Require a non-empty collection from one validated source target; reject heterogeneous inputs until a separate multi-source relay protocol exists. |
| A generic location type causes duplicate filenames or invalid target paths. | Use distinct directory/item locations, type each backend method accordingly, and reject category mismatches at runtime. |
| Storage adapters import content contracts and create dependency cycles. | Keep all storage request/result types in a neutral dependency-free module and map at the content boundary. |
| A neutral registry API quietly reintroduces content-layer types. | Accept only storage directory/item references; map physical content values at one provider/coordinator boundary and enforce this with import/type architecture tests. |
| Singleton providers retain stale connection permissions or make tests order-dependent. | Construct services through one composition root, atomically replace catalog snapshots, and inject fakes per test. |
| Rendered availability remains stale after pairing changes. | Publish a revisioned immutable service snapshot and subscribe through `useSyncExternalStore`; retain execution-time revalidation as the authoritative check. |
| A dialog executes with permissions that changed after it opened. | Retain opaque locations only, re-resolve immediately before execution, and return structured stale-capability results. |
| A same-kind transfer crosses adapters accidentally. | Define same-backend as adapter ownership, validate both targets in the adapter, and reject cross-adapter requests before transport. |
| Reload recovery reaches raw backend transport or the wrong backend. | Persist only versioned opaque recovery handles and let the matching backend capability validate and recover them; client-only work remains non-recoverable. |
| Recovery metadata is unavailable until an operation has already finished. | Publish `recoveryReady` as soon as remote preparation yields a handle, atomically persist it then, and test reload/cancellation from that interval. |
| Capability evaluation depends on an incompletely constructed target. | Resolve immutable target metadata first, evaluate adapter capabilities second, and invalidate resolved locations by revision. |
| A capability decision combines mismatched catalog and pairing state. | Attach one immutable catalog-plus-Companion capability snapshot to each resolved target and prohibit adapters from reading mutable session state during evaluation. |
| Typed failures lose evidence after a partially completed operation. | Require each outcome to report a structured cause and conservative source/destination mutation effects. |
| Native-open failures bypass recent-item lifecycle rules. | Return typed native-open failure results and preserve coordinator-owned permanent-stale-record cleanup. |
| Route/persistence changes break bookmarks or recent items. | Keep prefix parsing at the compatibility boundary and test round trips before changing serialization. |
| New abstractions obscure server-side security assumptions. | Preserve server and Companion validation; capability checks remain UX only. |
| Centralizing credentials is mistaken for a storage-security improvement. | Keep `localStorage` behavior explicit, restrict secret access to `CompanionSession`, and evaluate non-extractable keys or protocol changes separately. |
| UI import bans block legitimate presentation needs. | Allow metadata-only connection presentation modules; ban backend decisions only in generic operation code. |

## Completion Criteria

The migration is complete when:

- each physical content operation reaches exactly one resolved backend adapter;
- Companion signing and secret access have a single implementation;
- the pairing secret remains persistent through the existing `localStorage`
   contract and is not read outside `CompanionSession`;
- `ApiService` no longer multiplexes browser-file SMB and Companion requests;
- content providers do not inspect connection-ID prefixes to select a backend;
- storage registry resolution accepts neutral storage directory/item references
  only, supplies current connection capability metadata, and virtual providers
  resolve their physical source explicitly;
- storage contracts use separate directory and item locations, have no content
   or UI dependencies, define every adapter-interface type, and are mapped only
   at provider/coordinator boundaries;
- capability evaluation is acyclic: resolved target identity/metadata is built
   from one immutable catalog-plus-Companion snapshot before adapter capabilities
   are evaluated, and a changed revision invalidates the resolved location;
- a single composition root owns provider, registry, coordinator, catalog, and
   Companion-session wiring without mutable global service state, publishes a
   reactive revisioned snapshot, and is disposed with its React provider;
- the operation coordinator selects declared strategies rather than raw
  transports or `isLocalDrive` branches;
- cross-backend copy/move has explicit read/write, recursion, conflict,
   cancellation, progress, and partial-failure contracts;
- every expected mutation failure reaches the coordinator as a structured
   outcome with a cause and conservative source/destination effects;
- ZIP extraction and multi-source archive creation have separate contracts,
   only physical sources/destinations may enter archive-creation strategies, and
   each non-empty creation selection has one validated source target while
   same-adapter versus mixed routes have declared invocation paths;
- remotely recoverable work persists only an opaque, versioned,
   adapter-validated recovery handle published through `recoveryReady` at remote
   preparation; client-only work remains non-recoverable;
- cancellation after output preserves a structured cancellation cause and
   conservative mutation effects rather than being indistinguishable from a
   successful cancellation;
- native opening returns typed expected failures so stale local recent records
   are removed only for permanent missing-target results; and
- UI drafts retain only opaque content handles/locations, and every operation
   re-resolves/revalidates against current capabilities before destructive work,
   including catalog and Companion-session changes;
- generic browser UI does not inspect backend kind or path encoding to decide
  an operation;
- all supported backend/operation combinations have direct unit and integration
  coverage; and
- canonical route compatibility is explicitly tested and documented.
