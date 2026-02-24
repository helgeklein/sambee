# Dual-Pane File Browser (Norton Commander Style)

## Overview

Add a Norton Commander–style dual-pane view to the file browser, with two directory panels side by side. This facilitates copy and move operations between directories or connections. Users can toggle between single- and dual-pane mode with a keyboard shortcut and switch focus between panes using VS Code–style shortcuts (Ctrl+1, Ctrl+2).

## Current State

The file browser page lives in `frontend/src/pages/FileBrowser.tsx` and delegates all per-pane state to the `useFileBrowserPane` hook (`frontend/src/pages/FileBrowser/useFileBrowserPane.ts`).

| Area | Status |
|------|--------|
| Pane layout | **Phase 1 complete.** Single + dual-pane with `<FileBrowserPane>` component. |
| Pane logic extraction | **Phase 0 complete.** `useFileBrowserPane` hook encapsulates all per-pane state. |
| Pane keyboard shortcuts | **Phase 2 complete.** Ctrl+B toggle, Ctrl+1/2 focus, Tab switch. |
| WebSocket multi-subscription | **Phase 6 complete.** Both panes receive directory_changed events. |
| Copy/move operations | **Phase 5 complete.** Multi-select, F5/F6 shortcuts, confirmation dialog, backend API integration. |
| Multi-select | **Phase 5 complete.** `selectedFiles: Set<string>` per pane, Insert/Space toggle, Ctrl+A select all. |
| Backend storage API | **Phase 4 complete.** `StorageBackend` ABC has `copy_item`/`move_item`; SMB backend implements both. |
| URL routing | **Phase 3 complete.** Both panes encoded in URL: `/browse/:slug/*?p2=slug/path&active=2`. |
| Keyboard shortcuts | Centralized in `config/keyboardShortcuts.ts`, consumed via `useKeyboardShortcuts` hook. Clean and extensible. |
| WebSocket | Subscribes to both panes' directories for real-time change notifications. |
| Responsive layout | Desktop/mobile via `useCompactLayout`. Dual-pane is desktop-only (forced single on mobile). |

## Architecture

### Phase 0: Extract Pane Logic ✅ COMPLETE

All per-pane state, effects, handlers, and logic extracted from the monolithic `Browser` component into a reusable `useFileBrowserPane` hook.

**Files created/modified:**

| File | Description |
|------|-------------|
| `pages/FileBrowser/types.ts` | Added `UseFileBrowserPaneConfig` and `UseFileBrowserPaneReturn` interfaces |
| `pages/FileBrowser/useFileBrowserPane.ts` | ~600-line hook with all per-pane state and logic |
| `pages/FileBrowser.tsx` | Refactored from ~2,300 to ~700 lines; uses the hook |

**The hook manages:** connection/path state, file loading with cache, sort/filter, focus management with RAF batching, virtualizer, viewer state, CRUD dialog state, companion app, incremental search, WebSocket integration (`handleDirectoryChanged`), and directory/navigation caches.

**The parent keeps:** connections list, admin status, URL synchronization, WebSocket connection lifecycle, keyboard shortcut registration, settings/drawer/help dialogs, responsive layout, and accessibility (keyboard vs pointer tracking).

The existing placeholder `useFileBrowserLogic.ts` was removed.

### Phase 1: Dual-Pane Layout Container ✅ COMPLETE

Dual-pane layout integrated directly into the `Browser` component with the `FileBrowserPane` component handling per-pane rendering.

**Files created/modified:**

| File | Description |
|------|-------------|
| `pages/FileBrowser/types.ts` | Added `PaneId`, `PaneMode`, `DUAL_PANE_STORAGE_KEY`, `ACTIVE_PANE_STORAGE_KEY`; added `isActive` to `UseFileBrowserPaneConfig` |
| `pages/FileBrowser/FileBrowserPane.tsx` | New component — renders one pane's UI (breadcrumbs, view/sort controls, file list, status bar, CRUD dialogs) |
| `pages/FileBrowser/useFileBrowserPane.ts` | Added `isActive` config support; auto-focus suppressed for inactive panes |
| `pages/FileBrowser.tsx` | Refactored for dual-pane: two pane hook instances, active pane routing, WebSocket multi-subscription |
| `config/keyboardShortcuts.ts` | Added `PANE_SHORTCUTS` (Ctrl+B, Ctrl+1, Ctrl+2, Tab) |

**Architecture:**

- **Two hook instances:** `leftPane` (URL-synced) and `rightPane` (always instantiated per hooks rule, but disabled when in single mode).
- **Active pane:** Keyboard shortcuts and toolbar controls route to `activePane` (left or right depending on focus).
- **Layout:** Shared AppBar + side-by-side `<FileBrowserPane>` components separated by a `<Divider>`. Active pane has a primary-color top border; inactive pane is slightly dimmed (opacity 0.7).
- **Persistence:** `localStorage` keys `dual-pane-mode` and `active-pane` remember preference across sessions.
- **WebSocket:** Dispatches `directory_changed` to both panes; subscribes to both panes' directories in dual mode.
- **Mobile:** Dual-pane forced to single-pane on compact layouts.
- **Viewer:** Full-screen overlay from whichever pane opened it (left takes priority if both have viewInfo).
- **Ctrl+2 opens dual mode** if currently in single mode, matching VS Code behavior.

### Phase 2: Pane Keyboard Shortcuts ✅ COMPLETE (implemented with Phase 1)

New entries in `config/keyboardShortcuts.ts`:

```typescript
export const PANE_SHORTCUTS = {
  FOCUS_LEFT_PANE: {
    id: "focus-left-pane",
    keys: "1",
    description: "Focus left pane",
    label: "Ctrl+1",
    ctrl: true,
  },
  FOCUS_RIGHT_PANE: {
    id: "focus-right-pane",
    keys: "2",
    description: "Focus right pane",
    label: "Ctrl+2",
    ctrl: true,
  },
  TOGGLE_DUAL_PANE: {
    id: "toggle-dual-pane",
    keys: "b",
    description: "Toggle dual-pane view",
    label: "Ctrl+B",
    ctrl: true,
  },
  SWITCH_PANE: {
    id: "switch-pane",
    keys: "Tab",
    description: "Switch active pane",
    label: "Tab",
  },
} as const;
```

**Behaviour:**

- **Ctrl+1 / Ctrl+2** — Focus left/right pane (VS Code convention). In single-pane mode, Ctrl+2 opens the second pane and focuses it.
- **Ctrl+B** — Toggle between single/dual mode.
- **Tab** — Classic Norton Commander pane switch (dual mode only; single-pane mode keeps normal Tab behaviour).

The existing `useKeyboardShortcuts` hook already supports `ctrl` modifiers — no hook changes needed.

### Phase 3: URL Routing — Refresh Must Restore Exact View ✅ COMPLETE

A browser refresh **must** restore the exact same multi-pane view. This rules out localStorage-only approaches (they diverge when the user shares a link, uses multiple tabs, or clears storage). The full pane layout must be encoded in the URL.

**Files created/modified:**

| File | Description |
|------|-------------|
| `pages/FileBrowser/types.ts` | Added `RIGHT_PANE_QUERY_KEY = "p2"` and `ACTIVE_PANE_QUERY_KEY = "active"` constants |
| `pages/FileBrowser.tsx` | Added `useSearchParams`, `encodePath` helper, rewrote `updateUrl()` to build URL from both panes, updated init/popstate/sync effects |
| `pages/__tests__/FileBrowser-url-routing.test.tsx` | New test file — 12 tests covering single-pane backward compat, dual-pane restoration, active pane, edge cases |

**Implementation details:**

- `updateUrl()` reads both panes' state via refs, builds `/browse/slug/path?p2=slug2/path2&active=2` in dual mode.
- Single-pane mode produces clean URLs with no query string (backward-compatible).
- On mount, `?p2=` triggers automatic dual-pane activation.
- Back/forward navigation handles `p2` appearing/disappearing (reverts to single mode when `p2` removed).
- `encodePath` helper percent-encodes path segments individually while keeping `/` literal.
- Invalid `p2` slugs (non-existent connections) are silently ignored.

#### Current URL scheme

```
/browse/:connectionSlug/*path
```

The path segment after the connection slug is a plain directory path with slashes. This works for a single pane but cannot encode multiple panes.

#### Approach: Query parameters (one per pane)

Pane 1 stays in the path (backward-compatible with existing single-pane URLs). Additional panes are encoded as `p2`, `p3`, … query parameters, each containing `connection-slug/path`. This integrates cleanly with React Router's `useSearchParams`.

```
/browse/my-server/documents?p2=other-server/photos/vacation&p3=backup/archive
```

**URL examples:**

| Scenario | URL |
|----------|-----|
| Single pane (no change) | `/browse/my-server/documents/subfolder` |
| Two panes | `/browse/my-server/documents?p2=other-server/photos` |
| Three panes | `/browse/my-server/documents?p2=other-server/photos&p3=backup/archive/2025` |
| Two panes, same connection | `/browse/my-server/documents?p2=my-server/backups` |
| Active pane is pane 2 | `/browse/my-server/documents?p2=other-server/photos&active=2` |

**Encoding rules:**

- Each `pN` value has the format `connection-slug/path/segments` (same encoding as pane 1 in the path).
- Path segments within each value are `/`-separated and individually percent-encoded (same as pane 1 today).
- An optional `active` parameter (`1`, `2`, `3`, …) records which pane has focus. Defaults to `1` if absent.
- When the user closes a pane, its `pN` param is removed and higher panes are renumbered to keep them contiguous (`p2`, `p3`, …, never `p2`, `p4`).

**Implementation approach:**

1. **Reading from URL** (on mount / refresh):
   - Pane 1: parsed from `useParams` as today.
   - Panes 2–N: parsed from `useSearchParams` → `searchParams.get("p2")`, etc.
   - Active pane: `searchParams.get("active")` or default `1`.
   - Each `pN` string is split at the first `/` to get `(connectionSlug, path)`.

2. **Writing to URL** (on navigation):
   - `updateUrl()` builds the path from pane 1 and constructs a `URLSearchParams` from panes 2–N.
   - Calls `navigate(pathname + "?" + searchParams.toString())`.
   - Single-pane mode produces a clean URL with no query string (identical to today).

3. **Backward compatibility:**
   - Existing bookmarks `/browse/my-server/documents/subfolder` load in single-pane mode — no migration needed.
   - If `p2` is present, dual-pane mode activates automatically.

4. **Route definition** in `App.tsx` remains unchanged:
   ```tsx
   <Route path="/browse/:connectionId/*" element={<FileBrowser />} />
   <Route path="/browse" element={<FileBrowser />} />
   ```
   Query parameters are invisible to React Router's route matching.

**Edge cases:**

- **Invalid pN values** (deleted connection, bad path): Show an error in that pane and let the user navigate elsewhere. Do not crash or redirect.
- **Duplicate panes** (same connection + path in two panes): Allowed — useful for comparing sort orders or selections.
- **Maximum panes:** Cap at a reasonable limit (e.g. 4) to prevent degenerate URLs and layouts. Enforce in the UI, not the URL parser.

### Phase 4: Copy & Move Backend ✅ COMPLETE

**Files created/modified:**

| File | Description |
|------|-------------|
| `storage/base.py` | Added `copy_item` and `move_item` abstract methods to `StorageBackend` ABC |
| `storage/smb.py` | Implemented `copy_item` (recursive via `smbclient.copyfile` + `smbclient.mkdir`) and `move_item` (via `smbclient.rename`) |
| `models/file.py` | Added `CopyMoveRequest` Pydantic model (`source_path`, `dest_path`, optional `dest_connection_id`) |
| `api/browser.py` | Added `POST /{connection_id}/copy` (204) and `POST /{connection_id}/move` (204) endpoints with shared helpers `_build_backend`, `_validate_copy_move_paths`, `_get_connection_or_404` |
| `frontend/src/services/api.ts` | Added `copyItem` and `moveItem` API methods |
| `tests/test_browser.py` | Added `TestCopyItem` (12 tests) and `TestMoveItem` (12 tests) |

**Implementation details:**

- **Copy** uses `smbclient.copyfile()` which leverages `FSCTL_SRV_COPYCHUNK` for server-side copy (no data streamed through Sambee). Directories are copied recursively via `smbclient.scandir()` + `smbclient.mkdir()`.
- **Move** uses `smbclient.rename()` for server-side cross-directory rename (instant, no data copy).
- Both endpoints validate: empty paths → 400, same path → 400, copy-into-self → 400, source not found → 404, destination exists → 409, cross-connection → 501 Not Implemented.
- Copy timeout: 300s. Move timeout: 30s.

#### 4a. Add to `StorageBackend` ABC (`backend/app/storage/base.py`)

```python
@abstractmethod
async def copy_item(self, source_path: str, dest_path: str) -> None:
    """Copy a file or directory to a new location within the same share."""

@abstractmethod
async def move_item(self, source_path: str, dest_path: str) -> None:
    """Move a file or directory to a new location within the same share."""
```

#### 4b. SMB implementation (`backend/app/storage/smb.py`)

| Operation | Same share | Cross share/connection |
|-----------|-----------|----------------------|
| **Copy** | Use `FSCTL_SRV_COPYCHUNK` (server-side copy, no data through Sambee) | Stream: `read_file` → `write_file` via backend relay |
| **Move** | SMB rename with different directory path (instant, no data copy) | Copy + delete source |

#### 4c. New API endpoints (`backend/app/api/browser.py`)

```
POST /{connection_id}/copy
  body: { source_path, dest_connection_id?, dest_path }

POST /{connection_id}/move
  body: { source_path, dest_connection_id?, dest_path }
```

If `dest_connection_id` is omitted, defaults to same connection.

#### 4d. Frontend API methods (`frontend/src/services/api.ts`)

```typescript
async copyItem(srcConnId: string, srcPath: string, destConnId: string, destPath: string): Promise<void>
async moveItem(srcConnId: string, srcPath: string, destConnId: string, destPath: string): Promise<void>
```

### Phase 5: Copy/Move UI ✅ COMPLETE

Multi-select, Norton Commander–style copy/move shortcuts, and a confirmation dialog.

**Sub-phases:**

#### 5a. Multi-select ✅

Added `selectedFiles: Set<string>` to each pane's state in `useFileBrowserPane`.

- **Insert** or **Space** — Toggle selection of focused file and move focus down.
- **Ctrl+A** — Select all.
- If nothing is selected, `getEffectiveSelection()` returns the single focused file.
- Selected files get a primary-colored highlight (using MUI `alpha(primary.main, 0.12)`) distinct from the focus indicator.
- Selection clears automatically on directory navigation.

#### 5b. Norton Commander shortcuts ✅

Registered in `keyboardShortcuts.ts` as `SELECTION_SHORTCUTS` and `COPY_MOVE_SHORTCUTS`.

- F5 = Copy to other pane (dual mode only; in single mode F5 remains Refresh).
- F6 = Move to other pane (dual mode only).
- Shortcuts are disabled when dialogs are open or viewer is active.

#### 5c. Confirmation dialog flow ✅

1. User presses F5 (copy) or F6 (move) in dual-pane mode.
2. `CopyMoveDialog` opens with the effective selection and an editable destination path pre-filled from the other pane.
3. Shows source file list (max 8 visible + "…and N more" truncation).
4. Cross-connection warning when connections differ (disabled for now).
5. Same-directory detection — disables confirm when source === dest.
6. On confirm, calls `api.copyItem`/`api.moveItem` sequentially per file with progress bar.
7. Both panes refresh via WebSocket `directory_changed` notifications.

**Files created/modified:**

| File | Description |
|------|-------------|
| `config/keyboardShortcuts.ts` | Added `SELECTION_SHORTCUTS` (Insert/Space, Ctrl+A) and `COPY_MOVE_SHORTCUTS` (F5, F6) |
| `pages/FileBrowser/types.ts` | Added `selectedFiles`, `handleToggleSelection`, `handleSelectAll`, `handleClearSelection`, `getEffectiveSelection` to `UseFileBrowserPaneReturn` |
| `pages/FileBrowser/useFileBrowserPane.ts` | Multi-select state, toggle/selectAll/clear handlers, effective selection getter, auto-clear on navigation |
| `components/FileBrowser/FileRow.tsx` | Added `isMultiSelected` prop, 4-way style computation (normal/focused/selected/both) |
| `components/FileBrowser/FileList.tsx` | Added `selectedFiles` prop, passes `isMultiSelected` to rows |
| `pages/FileBrowser/FileBrowserPane.tsx` | Added `buttonMultiSelected` and `buttonFocusedMultiSelected` style variants using `alpha()` |
| `components/FileBrowser/CopyMoveDialog.tsx` | New component — confirmation dialog with editable dest, progress, warnings |
| `components/FileBrowser/copyMoveDialogStrings.ts` | Centralized i18n-ready strings for the dialog |
| `pages/FileBrowser.tsx` | Copy/move state, F5/F6 handlers, selection shortcuts, dialog rendering, F5 dual/single mode split |

### Phase 6: WebSocket Enhancements ✅ COMPLETE (implemented with Phase 1)

The WebSocket backend already tracks a **set** of subscriptions per client (see `backend/app/api/websocket.py`). The frontend needs to:

- Send `subscribe` messages for **both** panes' directories.
- Handle `directory_changed` events that match either pane.
- Re-subscribe whenever either pane navigates.

## Implementation Order

| Step | Phase | Effort | Dependencies | Status |
|------|-------|--------|-------------|--------|
| 1 | **Phase 0** — Extract `useFileBrowserPane` + types | Large (3–5 days) | None | ✅ Complete |
| 2 | **Phase 1+2** — Dual-pane layout + keyboard shortcuts + WebSocket | Medium (2–3 days) | Phase 0 | ✅ Complete |
| 3 | **Phase 3** — URL routing with query params for N panes | Medium (2 days) | Phase 1 | ✅ Complete |
| 4 | **Phase 4** — Backend copy/move API | Medium (2–3 days) | None (parallel) | ✅ Complete |
| 5 | **Phase 5a** — Multi-select UI | Medium (2 days) | Phase 0 | ✅ Complete |
| 6 | **Phase 5b+5c** — Copy/move shortcuts + dialog | Medium (2–3 days) | Phases 4, 5a, 1 | ✅ Complete |

**Total estimated effort:** ~15–21 days

## Risks & Considerations

1. **Phase 0 is the critical path.** Splitting the 2,300-line monolith requires care. Regressions in navigation, keyboard handling, and viewer overlays are the main risks. The existing test suite (`pages/__tests__/FileBrowser-*.test.tsx`) provides a safety net.

2. **Mobile layout.** Dual-pane must be **desktop-only**. When `useCompactLayout` is true, force single-pane mode. Consider a swipe gesture to switch between "left" and "right" pane context on mobile.

3. **Cross-connection copy.** SMB server-side copy only works within the same share. Cross-share or cross-connection copies require streaming through the backend — use chunked streaming to control memory.

4. **Ctrl+1 / Ctrl+2 browser conflicts.** These are standard browser tab-switching shortcuts. Most web apps override them (VS Code Web does). The existing `useKeyboardShortcuts` hook already calls `preventDefault()` on matched shortcuts, so this will work.

5. **Viewer overlay in dual-pane.** The `DynamicViewer` currently renders as a full-screen overlay. In dual-pane mode it should remain full-screen (simpler) rather than constrained to one pane. Can revisit later.

6. **Norton Commander function keys.** F5 (copy) and F7 (mkdir) are already defined. F7 is taken by `NEW_DIRECTORY`. This is fine — F7 keeps its meaning, F5 becomes copy (Norton standard). F6 becomes move.
