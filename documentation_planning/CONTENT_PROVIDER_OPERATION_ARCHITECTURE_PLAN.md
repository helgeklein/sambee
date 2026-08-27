# Provider-Owned Content Operations Plan

## Purpose

Complete the content-provider abstraction so browser UI code works only with
opaque content locations, item handles, operation capabilities, and operation
results. It must not inspect provider IDs, archive state, connection kinds, or
provider-specific path representations.

The immediate defect is a dual-pane destination inside a ZIP archive: copy,
move, and archive creation currently retain only the physical parent path for
the destination. A request from the other pane can therefore appear to target
the archive while instead writing beside it. The new boundary must make that
state impossible to express.

This is a frontend architecture migration. It preserves existing backend and
Companion transfer implementations behind the physical provider initially.

## Architectural Outcome

### UI contract

Browser components, dialogs, keyboard shortcuts, and `FileBrowser.tsx` use:

- `ContentLocation` to identify a directory-like destination;
- `ContentItemHandle` to identify selected source entries;
- provider-supplied operation descriptors/capabilities to determine whether an
  action is available; and
- provider operation results/progress to render status and refresh affected
  panes.

They do not use `connectionId`, physical paths, `archiveLocation`, local-drive
checks, provider IDs, or path concatenation for content operations.

### Provider contract

Only content providers interpret an item's location and path. The physical
provider adapts opaque handles into the existing browser, backend, and
Companion APIs. The ZIP provider adapts opaque handles into archive member APIs.

An operation involving two locations is owned by a provider-coordination
service. That service selects a provider implementation from the source and
destination operation capabilities; it is not part of the UI.

For the first migration, ZIP advertises read/browse/download/extract support
and no mutation or child-acceptance support. Thus no generic write operation
can target it. Later ZIP mutation support is enabled by implementing provider
operations and changing its descriptors, without adding ZIP branches to UI
code.

## Non-Negotiable Invariants

- A destination is always represented by its full `ContentLocation`; a virtual
  destination is never reduced to its source archive's physical parent.
- Every operation is checked twice: before rendering/enabling UI and again at
  invocation. Capability changes, stale pane state, and programmatic calls must
  not bypass the second check.
- No generic UI function reads `location.kind`, `providerId`, archive source,
  physical path, connection ID, or local-drive state to decide an operation.
- No generic UI function concatenates item or directory paths.
- Provider APIs reject incompatible item/location combinations defensively,
  even when capability checks said an operation was available.
- The physical provider is the only initial adapter allowed to call physical
  browser APIs such as `copyItem`, `moveItem`, `renameItem`, `deleteItem`, and
  `createItem`.
- The physical provider is the only initial adapter allowed to choose the
  existing SMB/local/Companion archive-creation transport.
- The ZIP provider remains read-only until it explicitly implements and
  advertises a write operation.
- Existing server-side authorization and path validation remain mandatory;
  frontend capabilities are not a security boundary.

## Scope

### In scope

- pane location and item-handle exposure;
- generic UI capability checks and operation invocation;
- copy, move, delete, rename, create file/directory, archive creation, and
  extraction operation contracts;
- existing physical SMB/local/Companion routing moved behind providers;
- operation-dialog data models and destination rendering;
- targeted unit, integration, and browser tests;
- removal of operation-specific archive/path checks from browser UI.

### Out of scope

- enabling mutation of ZIP files in this change;
- changing backend authorization rules or archive formats;
- redesigning archive operation persistence or cancellation;
- changing canonical route parsing or archive navigation behavior;
- replacing the physical backend or Companion transport implementations.

## Current-State Gaps

| Area | Current behavior | Required state |
| --- | --- | --- |
| Copy/move destination | `FileBrowser.tsx` stores a destination connection ID and physical path; it ignores the other pane's virtual location. | Store one opaque destination location and ask the coordinator whether transfer is supported. |
| Archive creation destination | `FileBrowser.tsx` selects SMB/local transport and builds a target path from primitive state. | UI supplies sources, destination location, and name; physical provider/coordinator owns transport and target construction. |
| Dialog props | Copy/move receives source/destination connection IDs and path strings. Archive creation receives a formatted physical target. | Dialogs receive display-safe operation presentation data and invoke an opaque request callback. |
| Shortcut conditions | F5/F6/Alt+F5 contain source-pane/archive and connection-specific conditions. | Shortcuts depend only on `operationAvailability` supplied for the current selection and destination. |
| Physical mutations | Some pane mutations use physical item checks, while parent operations use raw paths. | All mutations route through the coordinator; physical conversion is private to the physical provider. |
| Future provider writes | `mutate: true` alone cannot describe what is possible. | Operation-specific availability and implementations determine UI behavior. |

## Target Types

Keep `ContentLocation` and `ContentItemHandle` as opaque discriminated types to
providers. Add generic operation types in `contentProviders.ts` or a new
`contentOperations.ts` module.

```ts
type ContentOperation =
  | "copy"
  | "move"
  | "delete"
  | "rename"
  | "create-file"
  | "create-directory"
  | "create-container"
  | "extract";

interface OperationAvailability {
  available: boolean;
  reason?: "read-only" | "unsupported" | "invalid-source" | "invalid-destination" | "connection-unavailable";
}

interface ContentOperationPresentation {
  sourceLabel?: string;
  destinationLabel?: string;
  allowRename?: boolean;
  supportsOverwriteStrategy?: boolean;
}

interface TransferRequest {
  kind: "copy" | "move";
  sources: readonly ContentItemHandle[];
  destination: ContentLocation;
  rename?: string;
  overwrite: "ask" | "replace-all" | "skip-all";
  signal?: AbortSignal;
  onProgress?: (progress: ContentOperationProgress) => void;
}

interface CreateContainerRequest {
  sources: readonly ContentItemHandle[];
  destination: ContentLocation;
  name: string;
  signal?: AbortSignal;
  onProgress?: (progress: ContentOperationProgress) => void;
}
```

Use names that describe user intent, not the current ZIP implementation. For
the initial implementation, `create-container` creates a ZIP because that is
the only physical provider container format. If product requirements demand a
format picker later, add it to this request as a provider-neutral output format
capability.

Avoid a single boolean such as `mutate`. It remains useful for basic pane
affordances but is insufficient for cross-location operations. Availability
must consider the operation, every source handle, and the full destination.

## Provider And Coordinator Interfaces

### Content provider responsibilities

Extend the provider contract with only single-provider primitives. A provider
owns the interpretation and validation of its location/item handles.

```ts
interface ContentProvider {
  readonly id: ContentProviderId;
  list(location: ContentLocation, options?: ListOptions): Promise<ProviderListResult>;
  read(item: ContentItemHandle, request: ContentReadRequest, options?: ContentReadOptions): Promise<Blob>;
  getCapabilities(location: ContentLocation): ContentCapabilities;
  getDisplayLocation(location: ContentLocation): ContentLocationDisplay;
  getOperationAvailability(request: ContentOperationRequest): OperationAvailability;
  executeOperation(request: ProviderOperationRequest): Promise<ContentOperationResult>;
}
```

Do not make each provider understand every possible other provider. It should
only claim operations it can execute directly against its own handles or a
provider-neutral transfer stream.

### Operation coordinator responsibilities

Introduce `contentOperations.ts` as the sole public operation API consumed by
the browser UI. It resolves the appropriate provider/coordinator strategy,
performs availability checks, normalizes operation results, and exposes
progress/cancellation.

```ts
getTransferAvailability(request: TransferRequest): OperationAvailability
executeTransfer(request: TransferRequest): Promise<ContentOperationResult>
getCreateContainerAvailability(request: Omit<CreateContainerRequest, "name">): OperationAvailability
createContainer(request: CreateContainerRequest): Promise<ContentOperationResult>
deleteItems(items: readonly ContentItemHandle[]): Promise<ContentOperationResult>
renameItem(item: ContentItemHandle, name: string): Promise<ContentOperationResult>
createItem(location: ContentLocation, kind: "file" | "directory", name: string): Promise<ContentOperationResult>
```

The coordinator may have a physical-provider implementation for mixed
SMB/local transfers because the existing backend/Companion flow needs to select
an executor. That selection is internal. No UI caller may receive a connection
kind or transport decision.

### Capability model

Replace coarse operation checks with explicit capabilities, for example:

```ts
interface ContentCapabilities {
  browse: boolean;
  read: boolean;
  download: boolean;
  acceptChildren: boolean;
  delete: boolean;
  rename: boolean;
  createFile: boolean;
  createDirectory: boolean;
  createContainer: boolean;
  extract: boolean;
  openInNativeApp: boolean;
}
```

Transfer and move remain request-level decisions because they depend on both
ends and every selected item. A writable directory does not imply that any
arbitrary source can be transferred into it.

Initially:

- physical locations advertise physical mutation and child-acceptance
  capabilities, subject to connection access;
- ZIP locations advertise browse/read/download/extract and no child acceptance
  or mutation; and
- unsupported combinations return a structured `unsupported` availability
  result rather than throwing during ordinary UI rendering.

## Implementation Phases

### Phase 0: Characterize current behavior

1. Add failing integration tests for a physical source and virtual destination
   in both left/right orientations.
2. Cover F5 copy, F6 move, Alt+F5 create container, command-palette actions,
   and any toolbar/context-menu entry points.
3. Assert no dialog opens, no physical API/Companion/archive operation API is
   called, and the destination pane is not refreshed for unsupported requests.
4. Add corresponding allowed-operation controls for two physical panes,
   same-connection and cross-connection paths, and SMB/local mixed cases.
5. Record current physical operation behavior with focused tests before moving
   transport code.

### Phase 1: Make pane state location-first

1. Add `currentLocation: ContentLocation` to `UseFileBrowserPaneReturn`.
2. Keep `connectionId`, `currentPath`, and `archiveLocation` private to the
   pane/navigation implementation during migration.
3. Ensure browser item selection exposes only `BrowserItem` and its opaque
   handle to parent operations.
4. Add a provider-owned display formatter for locations. The formatter returns
   display text/segments without exposing a physical path to dialogs.
5. Convert archive navigation and route hydration to update `currentLocation`.
   Route serialization may remain provider-aware at the routing boundary only.

Acceptance: UI consumers can obtain selected handles and the active/other pane
location without reading `currentPath` or `archiveLocation`.

### Phase 2: Add operation descriptors and coordinator

1. Define operation request, availability, result, progress, and structured
   unsupported/error types.
2. Create `contentOperations.ts` with pure availability functions and async
   execution functions.
3. Implement a physical-provider adapter that wraps existing `api` and
   `companionService` calls. Keep raw connection IDs, path joining, backend
   operation preparation, cancellation, and executor selection private there.
4. Implement a ZIP provider adapter that returns unavailable for every write
   request and supports read/extract only where currently supported.
5. Reject mismatched handles and locations in every provider implementation.
6. Unit-test availability matrices independently of React.

Acceptance: a request whose destination is ZIP returns unavailable before any
transport API is invoked; a physical-to-physical request resolves to the same
existing backend/Companion behavior.

### Phase 3: Migrate copy and move end to end

1. Replace parent copy/move state fields with one `TransferRequest` draft that
   stores source handles and a destination `ContentLocation`.
2. Replace `canCopyToConnection` and `canMoveBetweenConnections` in browser
   UI with coordinator availability queries.
3. Pass provider-generated display data to `CopyMoveDialog`; remove source and
   destination connection/path props.
4. On confirmation, call `executeTransfer` with the opaque request. The dialog
   does not construct a destination file path.
5. Use operation results to invalidate/refresh the affected locations. Do not
   directly call a pane's physical `loadFiles` based on raw paths.
6. Keep conflict-resolution UI provider-neutral. Let the operation result
   request a collision decision and resume through the coordinator.

Acceptance: F5/F6 are disabled for a virtual destination, blocked again if
called programmatically, and unchanged for physical destinations.

### Phase 4: Migrate create-container/archive creation

1. Replace `archiveCreateContext` with a generic `createContainer` operation
   draft containing physical/virtual source handles and a destination
   `ContentLocation`.
2. Ask the coordinator for availability before registering Alt+F5, showing a
   command, or opening the name dialog.
3. Use provider-generated destination display data in the prompt. It must
   render the full virtual location if a provider supports container creation
   there in the future.
4. On confirmation, submit only opaque sources, destination, and name to the
   coordinator.
5. Move the existing SMB/local/Companion create-archive branching, foreground
   operation state, cancellation, partial-output handling, and refresh target
   selection behind the physical provider/coordinator implementation.
6. Retain archive-specific user copy and translation keys at the product
   feature boundary, but remove archive state/path/transport logic from
   `FileBrowser.tsx`.

Acceptance: Alt+F5 is unavailable with a ZIP destination today. After a ZIP
provider later advertises and implements child acceptance/container creation,
the same UI flow can target it without a `FileBrowser.tsx` change.

### Phase 5: Migrate pane-local mutation actions

1. Route delete, rename, create file, and create directory through the
   coordinator using item/location handles.
2. Replace direct `isPhysicalItem` and `currentContentLocation.kind` UI guards
   with operation availability checks.
3. Keep defensive physical-handle validation in the physical provider.
4. Convert operation errors to structured, translated outcomes at one UI
   boundary.
5. Remove raw physical mutation API imports from pane/UI code.

Acceptance: pane-local buttons and shortcuts adapt from provider capabilities,
and no generic UI code can direct a virtual handle to a physical mutation API.

### Phase 6: Extraction, viewers, and remaining operation surfaces

1. Route extraction through the coordinator with a virtual source handle and
   opaque physical destination location.
2. Preserve content-provider read routing for viewers/downloads; consolidate
   compatibility wrappers such as `readViewerContent` only after callers use
   handles directly.
3. Audit command palette, mobile toolbar, context menus, drag-and-drop,
   paste/upload, recent-file actions, and any future bulk-action surface.
4. Remove UI-level provider checks from each audited surface.

Acceptance: every content-affecting UI action enters through exactly one
coordinator function and carries opaque handles/locations.

### Phase 7: Remove legacy bypasses and enforce boundaries

1. Mark raw physical file-operation methods in `services/api.ts` as provider
   implementation details by moving them to a dedicated physical transport
   module or making them non-exported from the public browser-operation API.
2. Remove direct imports of physical mutation/transfer methods from
   `FileBrowser.tsx`, pane components, dialogs, and hooks.
3. Add ESLint/Biome import restrictions or a lightweight architecture test that
   fails when UI directories import physical operation methods or
   `companionService` archive transports directly.
4. Add a repository search check to CI for banned UI patterns: direct
   `api.copyItem`, `api.moveItem`, `api.createItem`, `api.deleteItem`,
   `api.renameItem`, archive execution APIs, `currentPath` destination
   construction, and `archiveLocation` operation branches outside providers and
   navigation/routing modules.
5. Document the provider extension contract for future formats and writable ZIP
   support.

Acceptance: a new provider integration requires provider/coordinator changes
only; architecture tests prevent reintroduction of UI physical-path bypasses.

## Dialog And UI Rules

- Dialogs are presentation-only: show labels supplied by an operation
  presentation object and return user choices such as name, overwrite policy,
  or cancellation.
- Dialogs must not receive `connectionId`, raw paths, provider IDs, or pane
  references.
- Keyboard shortcut registration receives booleans from operation availability;
  it does not inspect pane archive state or connection topology.
- Toolbars, command palette entries, context menus, and mobile actions use the
  same availability source. There must be no action-specific duplicated guard.
- Unsupported actions should not open dialogs. If invoked through stale focus,
  automation, or a race, the coordinator returns a structured unavailable
  result and the UI performs no mutation.

## Testing Plan

### Provider/coordinator unit tests

- physical/physical copy and move availability for same and different
  connections;
- read-only physical source/destination behavior;
- physical-to-ZIP, ZIP-to-physical, and ZIP-to-ZIP availability;
- physical and ZIP create-container availability;
- provider mismatch and malformed-handle rejection;
- physical adapter argument construction for all existing SMB/local/Companion
  transfer paths;
- structured conflict, cancellation, partial-output, and refresh results.

### Browser integration tests

- two panes, physical source and ZIP destination: F5, F6, and Alt+F5 do not
  open a dialog or call any physical mutation/transport API;
- reverse pane orientation has identical behavior;
- dialogs display a provider-produced full location label, never only a
  physical archive parent;
- two writable physical destinations preserve copy/move/archive creation;
- command palette and keyboard paths have the same availability;
- availability revalidation blocks a request if either pane changes after a
  command becomes enabled;
- delete/rename/new-file/new-directory remain unavailable in ZIP locations;
- archive extraction remains available only for provider-supported sources and
  physical destinations.

### End-to-end/browser checks

- reproduce the reported Alt+F5 sequence with left ZIP and right physical file;
- verify F5/F6 equivalent sequences;
- verify physical dual-pane same-SMB, cross-SMB, local-to-SMB, and SMB-to-local
  operations;
- verify canonical archive route display remains unchanged while operations are
  blocked.

### Regression guard

Run `./scripts/lint`, `./scripts/test`, frontend type checking, Companion Rust
tests/Clippy where its transport adapter changes, and relevant backend tests
where operation request shapes change. Add architecture tests before removing
the legacy APIs from UI imports.

## Rollout Order And Compatibility

1. Land types/coordinator and characterization tests without changing UI
   behavior.
2. Migrate one operation family at a time: copy/move, then create-container,
   then pane-local mutations, then extraction.
3. Keep legacy direct routes only inside the physical provider adapter until
   every consumer is migrated.
4. After each family, remove its UI direct imports and enable its architecture
   rule.
5. Do not change ZIP mutation capabilities until all relevant provider methods,
   backend/Companion support, security checks, and conformance tests exist.

## Completion Criteria

The migration is complete when:

- no generic browser UI file branches on `archiveLocation`, provider ID,
  location kind, raw path, connection ID, or local-drive state for an operation;
- dialogs contain no raw path or connection props;
- all content operations enter through the coordinator;
- physical transport APIs are imported only by the physical provider adapter;
- ZIP write operations are unavailable because the ZIP provider says so, not
  because UI code recognizes archives;
- the reported Alt+F5 and analogous F5/F6 scenarios are covered by regression
  tests; and
- enabling a future writable ZIP operation is limited to ZIP
  provider/coordinator/backend/Companion implementation plus tests, with no
  changes to generic browser components or shortcut handlers.
