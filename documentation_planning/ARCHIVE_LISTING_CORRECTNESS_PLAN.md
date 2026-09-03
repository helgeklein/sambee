# Archive Listing Correctness Plan

## Objective

Prevent physical-directory responses from rendering while a File Browser pane is showing a virtual archive location. Make provider selection pane-owned, guard every physical-list commit against virtual mode, and structurally prevent callers from reintroducing direct physical-loader calls.

## Navigation and Listing Model

1. Keep `connectionId`, `currentPath`, and `archiveLocation` as the sole navigation state in `frontend/src/pages/FileBrowser/useFileBrowserPane.ts`.

2. Keep the existing unified `latestLoadRequestIdRef` request ordering. Each physical or archive load increments it, so a later load already wins over an earlier load for the same location. Do not add parallel replace/append request channels or a second listing state model unless focused regressions expose an independent pagination bug.

3. Add one private helper that confirms a physical request still owns the visible location. It must require all of the following before a physical response can update rendered state or the physical cache:

   - its request ID equals `latestLoadRequestIdRef.current`;
   - its connection and path equal `connectionIdRef.current` and `currentPathRef.current`;
   - `archiveLocationRef.current === null`.

   Use the equivalent full archive-location check, including provider ID, for archive responses.

4. Add a compact private listing-transition helper. For a changed full location identity, each caller first compares and saves its old location, performs its existing history, selection, focus, route, and viewer cleanup, then invokes the helper. Before React state changes, the helper synchronously updates `connectionIdRef`, `currentPathRef`, and `archiveLocationRef`, aborts the active directory and link-target requests, and increments their request IDs. When the archive identity changes, it also resets the archive cursor, has-more state, and append-loading ref/state. Use it for physical navigation, connection changes, local-link resolution, archive open/navigation/close, route application, and recovery snapshot restoration.

   Do not invoke the helper for a no-op full identity: repeated route synchronization must not abort an in-flight load or advance the request ID. The helper owns only request invalidation and location refs; it is not a new navigation state machine.

5. Keep route probing separate from displayed listing state. Every accepted `applyLocation` call (after rejecting an older route-sync token) advances the independent route-resolution token before deciding whether probing is needed, so a pending archive resolution cannot apply after a newer physical route. `resolveRouteLocation` may inspect providers, but it cannot update list data, loading state, or the unified listing request ID. A successful resolution applies its target only when its token remains current and only through the shared transition logic.

## Loader Ownership

6. Rename `loadFiles` to private `loadPhysicalDirectory`. It retains the current request-ID behaviour but must use the physical-ownership helper before every commit: cached-item rendering, network success, error, `finally`, loading state, recent-directory recording, physical cache writes, and physical link-target enrichment. Do not write a cache entry from a superseded physical response; cache seeding remains the explicit exception below.

   Apply the same physical-mode condition to cached-item rendering in `prepareDirectoryTransition` and `seedDirectorySnapshot`. A seed may populate the physical cache while virtual mode is active, but it must not render physical items there. Recovery snapshot restoration remains an intentional synchronous restore: when restoring an archive, it must create virtual items and invalidate outstanding work before it commits.

7. Preserve the existing archive loader and pagination behaviour. Add provider ID to its stale-response guard and ensure its success, error, and `finally` commits still require the exact request ID, abort-controller ownership, and active full archive identity to match. For archive append cleanup, the settling request owns `archiveLoadingMore` only under those same conditions; the transition helper resets append state on every archive identity change, and a replacement archive load resets it before starting. Do not redesign pagination controllers or cursor ownership as part of this fix.

8. Evolve `forceReloadCurrentDirectory` into the sole public general reload operation:

   ```ts
   reloadCurrentLocation(options?: {
     forceRefresh?: boolean;
     preserveVisibleContent?: boolean;
   }): Promise<void>
   ```

   It records `lastForceReloadRef` before dispatching to the private physical or archive loader from the active pane location. It resolves after the loaders handle their own errors, preserving the current fire-and-forget callers without unhandled promise rejections. Explicit refreshes, recovery, settings changes, and confirmed mutations use `forceRefresh: true`; route effects use the default cache policy. Use the explicit reload timestamp to deduplicate an immediately following matching directory-change event before choosing a physical or archive provider; do not add a separate forced directory-change path unless a concrete caller requires one.

9. Make route-driven effects the sole loader owner after a location transition: transitions update state but do not start a listing request. A compact one-shot pending reload-options ref lets `closeArchive` preserve its existing forced-refresh behaviour. Store the intended physical `{ connectionId, path }` with those options; the physical route effect consumes them exactly once only when that identity matches, and every later transition clears unmatched pending options. Explicit refreshes, recovery, settings changes, and confirmed mutations call `reloadCurrentLocation({ forceRefresh: true })`. Preserve visible content only for an exact physical-directory reload; never preserve parent-directory entries while entering an archive.

## Physical Directory Change Handling

10. Parse and validate raw WebSocket payloads in `frontend/src/pages/FileBrowser.tsx` into a typed `DirectoryChange` before they reach the pane. Catch JSON parse failures; accept `directory_changed` only when `connectionId` is a non-empty string and `path` is a string, including `""` for the root directory; ignore and log malformed frames without throwing from either WebSocket `onmessage` callback. Use a shared discriminated parser that preserves current server handling of valid `transfer_progress` messages while the Companion ignores non-directory messages. The existing server and Companion protocols define `path` as the subscribed directory path, so pass that directory path through unchanged rather than deriving a parent path.

11. Evolve the existing pane method:

   ```ts
   handleDirectoryChanged(change: DirectoryChange): void
   ```

   It invalidates the notified physical-directory cache entry. It reloads only when the connection and directory exactly match `currentPathRef.current`:

   - physical pane: reload physical content;
   - archive pane: reload active archive content through its virtual provider;
   - a matching WebSocket event immediately following `reloadCurrentLocation` is deduplicated through that method's explicit-reload timestamp before selecting a provider;
   - otherwise, retain normal WebSocket reload behaviour.

   Keep mutation follow-up refreshes pane-aware through `reloadCurrentLocation`. Existing mutation helpers return `Promise<void>` and do not expose effect metadata; do not expand their public contract merely to generalize cache invalidation for this bug.

## Public Boundary and Enforcement

12. Remove `loadFiles`, `loadPhysicalDirectory`, and the replaced `forceReloadCurrentDirectory` from `UseFileBrowserPaneReturn` in `frontend/src/pages/FileBrowser/types.ts`. Export only `reloadCurrentLocation` and the typed directory-change handler for external refresh behavior. Update pane test fixtures and mocks in the same change.

13. Replace all parent-level physical reload calls in `frontend/src/pages/FileBrowser.tsx` with `reloadCurrentLocation`, including backend-recovery and settings/connection refreshes. Parent code must not select a listing provider. Replace mutation follow-up reloads, `handleDirectoryChanged`, and archive-close refresh logic in the pane with the same public operation; keep the existing source/destination pane refresh after copy or move.

14. Extend `frontend/src/pages/FileBrowser/contentOperationBoundary.test.ts` to enforce the load boundary:

   - `UseFileBrowserPaneReturn` must not expose a physical loader;
   - production code outside `useFileBrowserPane.ts` must not access, destructure, optionally access, or re-export `loadFiles`, `loadPhysicalDirectory`, or the replaced `forceReloadCurrentDirectory`;
   - the AST guard covers syntactically detectable bypasses; the removed typed public API prevents ordinary misuse.

## Regression Coverage

15. Add focused pane tests for:

   - a deferred physical response that cannot overwrite an archive entered before it resolves;
   - a deferred archive response that cannot overwrite a physical location entered before it resolves;
   - cached physical parent content that cannot render after archive activation;
   - cached-item commits in `prepareDirectoryTransition` and `seedDirectorySnapshot` that cannot render physical entries while an archive is active;
   - stale physical success, error, and `finally` paths that cannot alter items, errors, or loading once an archive is active;
   - archive responses that cannot overwrite physical content after leaving an archive;
   - archive responses that require matching provider ID as well as archive path and virtual path;
   - a delayed archive route probe that cannot overwrite a newer physical route;
   - preserving visible content only for an exact physical-directory reload;
   - local link-target enrichment rejected after a physical-to-virtual transition;
   - root-directory `DirectoryChange` events with `path: ""` reloading a matching root physical or archive view;
   - exact containing-directory matching for archive reloads;
   - explicit physical and archive reloads being deduplicated against following matching directory-change notifications;
   - archive close consuming one forced physical reload through the route effect;
   - rapid navigation after archive close cannot consume that archive parent's pending forced-reload options for another physical location;
   - archive pagination continuing to work after the stale-response guard change, including a settling append request after an archive identity change or replacement reload and a subsequent archive open.

16. Add page-level tests through `frontend/src/pages/FileBrowser.tsx` for:

   - backend recovery refreshing an active archive through the virtual provider;
   - settings/connection refresh preserving an active archive listing;
   - validated directory-change payloads being passed unchanged to pane invalidation;
   - malformed WebSocket frames being ignored without breaking subsequent valid directory-change handling;
   - typed archive routes retaining matching URL, breadcrumb, and archive-derived items after refresh.

## Validation

17. Run focused pane, boundary, and page-level regression tests first. Then run:

   ```sh
   cd frontend && npm run test
   cd frontend && npm run build
   cd frontend && npm run lint
   cd /workspace && git diff --check
   ```

No documentation update is required beyond this implementation plan because the change corrects internal listing ownership and asynchronous state handling without changing a documented user workflow.
