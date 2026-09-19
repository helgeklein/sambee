# Content Provider Registry Refactor Plan

## Goal

Remove the legacy API-backed content-provider registry and its implicit fallback from the frontend. The storage-backed registry created by `BrowserContentServices` becomes the sole production implementation.

The refactor must preserve existing browser behavior, keep virtual-provider resolution bound to the active registry, and ensure every text-edit session uses the lock-recovery implementation owned by `ApiStorageBackend`.

## Current State

`frontend/src/pages/FileBrowser/contentProviders.ts` currently contains two implementations:

- A legacy physical/ZIP provider that calls `api` directly and is used by `defaultProviderRegistry`.
- `createStorageBackedContentProviderRegistry()`, which delegates to `StorageBackendRegistry` and is supplied to production FileBrowser views by `BrowserContentServices`.

The legacy registry remains reachable through:

- `useContentProviderRegistry()` when no context provider exists.
- Default registry arguments on content read/edit helper functions.
- `useFileBrowserPane()` when no `contentProviders` configuration is supplied.
- Global provider lookup helpers.

The legacy physical provider has a separate edit session implementation and does not reacquire a lost edit lease before retrying a save. The storage-backed implementation does. Keeping both implementations therefore creates a correctness risk, not merely duplicate code.

## Decisions

### One production registry

`BrowserContentServices` remains the sole production creator of a content-provider registry. It already creates both the storage registry and the storage-backed content-provider registry, so FileBrowser can supply a consistent provider instance to panes and viewers.

### Local-drive catalog-refresh compatibility

Restrict the storage-backed physical provider's `api.listDirectory()` compatibility path to direct local-drive routes for which `StorageBackendRegistry.resolveDirectory()` cannot resolve the drive before the Companion catalog refreshes. When directory resolution fails for a non-local location, rethrow the original error rather than falling back to `api`.

This is not a second registry and must not become a general read, edit, or provider-selection fallback. Guard the compatibility branch with `isLocalDrive(location.connectionId)`, keep the API import needed for this branch, document its catalog-refresh purpose in the implementation, and add focused positive and negative tests. Moving this transition behavior into `StorageBackendRegistry` is out of scope for this dependency-boundary refactor.

### Explicit dependencies, no silent fallback

Every production operation that reads, lists, edits, or resolves virtual content must receive either:

- an explicit `ContentProviderRegistry`, or
- a registry from `ContentProviderRegistryContext`.

The context hook must fail clearly when it is used outside its provider. Do not retain deprecated wrappers that silently create or choose a default registry; they would preserve the ambiguity this refactor removes.

### Active registry owns virtual-provider lookup

Virtual provider IDs must be resolved through the active registry:

```ts
providerRegistry.getVirtualProviderIdForFilename(filename)
```

Do not replace this with a hard-coded extension check. Provider IDs are extensible and different registries may expose different virtual providers.

### Test fixtures do not reimplement production providers

Tests that need real storage routing must use `createBrowserContentServices()` or `createStorageBackedContentProviderRegistry()` with a controlled storage registry. Tests that only need controlled provider behavior must use a minimal fake `ContentProviderRegistry`.

Do not move the deleted API-backed providers into test utilities. That would perpetuate the duplicate behavior and conceal integration gaps.

## Implementation Steps

### 1. Add explicit test fixtures

Create shared frontend test helpers for two use cases:

- A storage-backed registry fixture for routing, capabilities, and edit-session behavior.
- A minimal fake registry fixture for isolated viewer and hook tests.

The fixtures must be explicit at each test setup boundary. They should expose only the provider behavior the test requires. The fake fixture must construct `ContentProviderRegistry` directly; it must not recreate the deleted API-backed providers.

Update the many direct `useFileBrowserPane()` tests to use a shared render helper that supplies `contentProviders`. This avoids one-off configuration changes throughout the test suite. Provide an equivalent viewer render helper that wraps direct viewer tests in `ContentProviderRegistryContext.Provider`.

### 2. Require a registry in production components and hooks

Make `contentProviders` mandatory in:

- `DynamicViewer` props.
- `UseFileBrowserPaneConfig`.

Update `UseFileBrowserPaneConfig` in `frontend/src/pages/FileBrowser/types.ts` as well as the hook implementation. Remove `useFileBrowserPane()`'s `createContentProviderRegistry()` fallback. `FileBrowser` already supplies `browserContentServices.providers` to both panes and both viewer overlays.

Update every test and direct component invocation to pass an explicit registry.

### 3. Make the context invariant explicit

Keep `ContentProviderRegistryContext` as `ContentProviderRegistry | null` with `null` as its missing-provider sentinel. Change `useContentProviderRegistry()` so it throws a precise developer-facing error when it reads that sentinel. A missing registry is an integration error, not a user-facing recovery condition.

Keep `DynamicViewer` as the production context boundary and require its registry prop. Direct viewer tests must wrap the viewer with `ContentProviderRegistryContext.Provider` or use `DynamicViewer` with an explicit registry.

### 4. Remove implicit helper defaults

Require a `ContentProviderRegistry` argument for all helper functions that currently default to `defaultProviderRegistry`, including:

- Content reads and virtual-content reads.
- Viewer content reads.
- Beginning text edits.
- PDF derivative invalidation.
- Content capability and provider lookup helpers, where they remain useful.

Remove `getVirtualContentProviderIdForFilename()` and replace every call in `useFileBrowserPane()` with the active registry method. Retain other provider lookup helpers only when they accept an explicit registry argument; otherwise remove them in favor of calling the registry directly. Update every affected `useCallback`, `useMemo`, and effect dependency array to include `providerRegistry` where the callback closes over it.

This is especially important for archive opening, archive-member navigation, and route detection. A pane must not use a provider catalog different from the one it uses to list and read content.

### 5. Delete the legacy implementation

After all callers compile with an explicit registry, remove from `contentProviders.ts`:

- `physicalContentProvider` and `zipContentProvider`.
- The legacy provider map and the exported `createContentProviderRegistry()` API.
- `defaultProviderRegistry`.
- Imports and capability constants used only by the legacy implementation. Retain the `api` import used by the explicit local-drive catalog-refresh listing fallback.
- API-backed edit session code duplicated by the storage backend.

Retain a private registry builder that accepts explicit provider entries and has no default entries or default registry. `createStorageBackedContentProviderRegistry()` uses this builder to assemble its physical and virtual providers. Test fixtures construct minimal fake registries directly rather than depending on this production implementation detail.

In the storage-backed physical provider, handle `resolveDirectory()` failures by calling `api.listDirectory()` only when `isLocalDrive(location.connectionId)` is true; rethrow the failure for SMB and every other non-local target.

Retain:

- Content location and item-handle types/helpers.
- Registry interfaces and context.
- `createStorageBackedContentProviderRegistry()`.
- The adapters between storage contracts and content-provider contracts.

### 6. Add regression coverage

Add or update focused tests for:

- Missing context: `useContentProviderRegistry()` fails clearly without a provider.
- Context propagation: `DynamicViewer` passes its explicit registry to a rendered viewer.
- Pane routing: virtual-provider ID lookup uses the injected registry, including a registry whose virtual provider catalog differs from the prior default.
- Local-drive catalog-refresh compatibility: storage-backed physical listing falls back only when local directory resolution is unavailable and maps the resulting entries to physical items.
- Non-local resolution failures: storage-backed physical listing rejects the original resolution error and never calls `api.listDirectory()`.

Keep the existing SMB and local lock-recovery tests in `storageBackends.test.ts`; they already prove one reacquisition, retry with renewed credentials, and renewed-lock heartbeat and release behavior. Keep existing provider and archive tests, but make their chosen registry explicit. Add an adapter-level test only if the current `beginViewerTextEdit()` delegation test does not cover the changed provider boundary. The goal is stronger boundary coverage, not merely adapting assertions to compile.

Update every direct viewer render to use the explicit registry helper, including the Image, Markdown, Text, and PDF viewer suites and the integration Markdown render. `DynamicViewer` tests must pass the required prop and include the separate context-propagation assertion.

## Files Expected To Change

- `frontend/src/pages/FileBrowser/contentProviders.ts`
- `frontend/src/pages/FileBrowser/useFileBrowserPane.ts`
- `frontend/src/pages/FileBrowser/types.ts`
- `frontend/src/components/FileBrowser/DynamicViewer.tsx`
- `frontend/src/pages/FileBrowser.tsx` only if required by tightened prop types
- `frontend/src/pages/FileBrowser/contentProviders.test.ts`
- `frontend/src/pages/__tests__/useFileBrowserPane.test.tsx`
- `frontend/src/components/FileBrowser/__tests__/DynamicViewer.test.tsx`
- `frontend/src/components/Viewer/__tests__/ImageViewer.test.tsx`
- `frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx`
- `frontend/src/components/Viewer/__tests__/TextViewer.test.tsx`
- `frontend/src/components/Viewer/__tests__/PDFViewer.test.tsx`
- `frontend/src/__tests__/integration/browse-view-flow.test.tsx`
- A focused frontend test-helper module under `frontend/src/test/helpers/`, if one does not already provide this fixture pattern

## Validation

Run validation in this order:

1. Focused content-provider, pane, DynamicViewer, Image, Markdown, Text, PDF, integration browse-view-flow, and storage-backend tests.
2. Frontend typecheck and Biome lint.
3. Full frontend test suite.
4. Frontend production build.
5. Within `frontend/src`, search for removed symbols and confirm no references remain:
   - `defaultProviderRegistry`
   - `createContentProviderRegistry`
   - `physicalContentProvider`
   - `zipContentProvider`
   - `getVirtualContentProviderIdForFilename`
6. Inspect any retained `getContentProvider` or `getContentCapabilities` helper to confirm it requires an explicit registry argument and does not select a global registry.

## Acceptance Criteria

- There is no implicit default content-provider registry in production code.
- All production FileBrowser panes and viewers receive the same storage-backed registry instance.
- Virtual-provider lookup is performed through the active registry.
- No duplicate API-backed text-edit session remains.
- The documented local-drive catalog-refresh listing fallback is guarded to local targets, rethrows non-local resolution failures, and has focused positive and negative coverage.
- Local and SMB Markdown saves retain the existing one-time lock reacquisition behavior.
- Tests use explicit real or fake registries according to the behavior under test.
- Typecheck, lint, focused tests, full frontend tests, and production build pass.

## Documentation Impact

No user-facing documentation update is required. This is an internal frontend dependency-boundary refactor with no intended user-visible workflow change.
