# Dual-Pane File Browser (Norton Commander Style)

## Overview

The file browser supports a Norton Commander–style dual-pane view with two directory panels side by side. Users can copy/move files between directories (or connections), toggle single/dual-pane mode, and switch focus between panes. The full layout is encoded in the URL so a refresh restores the exact view.

## Architecture

### Component hierarchy

```
FileBrowser (Browser)
├── useFileBrowserPane (left)  — always active, URL-synced
├── useFileBrowserPane (right) — always instantiated (hooks rule), disabled in single mode
├── FileBrowserPane (left)     — renders one pane's UI
├── FileBrowserPane (right)    — conditionally visible
└── CopyMoveDialog             — confirmation overlay for F5/F6 operations
```

### Key files

| File | Role |
|------|------|
| `pages/FileBrowser.tsx` | Parent — two pane hook instances, active pane routing, WebSocket lifecycle, URL sync, shortcut registration |
| `pages/FileBrowser/useFileBrowserPane.ts` | ~600-line hook — all per-pane state: connection/path, file loading with cache, sort/filter, focus management (RAF batching), virtualizer, viewer, CRUD dialogs, incremental search, multi-select, WebSocket `handleDirectoryChanged` |
| `pages/FileBrowser/FileBrowserPane.tsx` | Renders one pane: breadcrumbs, view/sort controls, file list, status bar, CRUD dialogs |
| `pages/FileBrowser/types.ts` | Shared types (`PaneId`, `PaneMode`, `UseFileBrowserPaneConfig`, `UseFileBrowserPaneReturn`) and constants |
| `config/keyboardShortcuts.ts` | `PANE_SHORTCUTS`, `SELECTION_SHORTCUTS`, `COPY_MOVE_SHORTCUTS` |
| `components/FileBrowser/CopyMoveDialog.tsx` | Confirmation dialog with editable destination, progress bar, source file list |
| `components/FileBrowser/copyMoveDialogStrings.ts` | Centralized UI strings for the dialog |

### Responsibility split — parent vs hook

**`useFileBrowserPane` hook manages (per pane):** connection/path state, file loading with cache, sort/filter, focus management, virtualizer, viewer state, CRUD dialog state, companion app, incremental search, multi-select (`selectedFiles: Set<string>`), and WebSocket directory-change handling.

**`Browser` parent manages (shared):** connections list, admin status, URL synchronization, WebSocket connection lifecycle, keyboard shortcut registration, settings/drawer/help dialogs, responsive layout, and accessibility (keyboard vs pointer tracking).

## Dual-Pane Layout

- **Two hook instances:** `leftPane` (always URL-synced) and `rightPane` (always instantiated per hooks rule, disabled in single mode).
- **Active pane:** Keyboard shortcuts and toolbar controls route to whichever pane has focus.
- **Visual cues:** Active pane has a primary-color top border; inactive pane is dimmed (opacity 0.7).
- **Persistence:** `localStorage` keys `dual-pane-mode` and `active-pane` remember preference across sessions.
- **Mobile:** Dual-pane is desktop-only — forced to single-pane when `useCompactLayout` is true.
- **Viewer:** Full-screen overlay from whichever pane opened it (not constrained to one pane).

## URL Routing

Pane 1 stays in the path (backward-compatible). The right pane is encoded as the `p2` query parameter containing `connection-slug/path`.

```
Single pane:  /browse/my-server/documents/subfolder
Dual pane:    /browse/my-server/documents?p2=other-server/photos&active=2
```

| Constant | Value | Purpose |
|----------|-------|---------|
| `RIGHT_PANE_QUERY_KEY` | `"p2"` | Right pane's connection-slug/path |
| `ACTIVE_PANE_QUERY_KEY` | `"active"` | Which pane has focus (`1` or `2`, default `1`) |

**Behavior:**
- On mount, presence of `?p2=` triggers automatic dual-pane activation.
- Back/forward navigation handles `p2` appearing/disappearing.
- Single-pane mode produces clean URLs with no query string.
- Path segments are individually percent-encoded; `/` stays literal.
- Invalid `p2` slugs (non-existent connections) are silently ignored.
- Route definitions in `App.tsx` are unchanged — query params are invisible to React Router matching.

## Keyboard Shortcuts

All shortcuts are centralized in `config/keyboardShortcuts.ts` and consumed via the `useKeyboardShortcuts` hook. The hook calls `preventDefault()` on matched shortcuts, overriding any browser defaults (e.g. Ctrl+1/2 tab switching).

### Quick bar modes (`BROWSER_SHORTCUTS`)

The file browser now uses one main smart bar plus command mode. The pane that opens the quick bar is captured at open time, and quick-bar actions continue to target that pane even if focus later moves to the other pane before selection.

| Shortcut | Mode / Action |
|----------|---------------|
| **Ctrl+K** | Open smart navigation |
| **Ctrl+Alt+F** | Compatibility alias for smart navigation |
| **Ctrl+P** | Show browser commands |
| **F1** | Alternate binding for Show browser commands |
| **Ctrl+,** | Open settings |
| **?** | Show keyboard shortcuts help |

**Quick bar mode behavior:**
- **Navigate** merges current-pane filtering with directory-jump results for the captured pane and connection.
- Typing `>` as the first character in the smart bar switches the bar into command mode.
- **Commands** shows only enabled browser commands for the current UI state.
- Selecting a navigation or filter result returns focus to the relevant pane's file list.
- Selecting commands that switch quick-bar modes keeps focus in the quick bar.
- Commands that open settings or another surface do not force focus back to the file list.
- `Ctrl+1`, `Ctrl+2`, and `Tab` pane-switching shortcuts do not fire while the quick bar input is focused.

### Pane navigation (`PANE_SHORTCUTS`)

| Shortcut | Action |
|----------|--------|
| **Ctrl+B** | Toggle single/dual-pane mode |
| **Ctrl+1** | Focus left pane |
| **Ctrl+2** | Focus right pane (opens dual mode if currently single) |
| **Tab** | Switch active pane (dual mode only; single mode keeps normal Tab) |

### Selection (`SELECTION_SHORTCUTS`)

| Shortcut | Action |
|----------|--------|
| **Insert / Space** | Toggle selection of focused file, move focus down |
| **Shift+Down** | Select focused file and move focus down |
| **Shift+Up** | Select focused file and move focus up |
| **Ctrl+A** | Select all files |

### Copy & Move (`COPY_MOVE_SHORTCUTS`)

| Shortcut | Action |
|----------|--------|
| **F5** | Copy to other pane (dual mode only; single mode = Refresh) |
| **F6** | Move to other pane (dual mode only) |

Shortcuts are disabled when dialogs are open or the viewer is active.

### Browser command palette

Command mode is powered by `frontend/src/config/browserCommands.ts`, not by ad hoc button handlers. Commands are grouped into categories such as Navigation, Files, Panes, View, Settings, and Help, and each command can declare:

- a stable command id,
- a user-facing title,
- a category,
- optional shortcut references,
- context-aware enablement,
- post-selection focus behavior.

This allows the quick bar to act like a browser-scoped command palette while still reusing the centralized keyboard shortcut registry for the actual bindings.

## Multi-Select

Each pane maintains `selectedFiles: Set<string>` in the hook state. `getEffectiveSelection()` returns the explicit selection, or falls back to the single focused file when nothing is selected. Selection clears automatically on directory navigation. Selected files use three combined visual indicators: a **checkmark icon** replacing the file type icon, a **3px left border accent** in the primary color, and a **stronger background highlight** (`alpha(primary.main, 0.16)`) with a 4-way style computation in `FileRow`: normal / focused / selected / both.

## Copy & Move

### Backend API

| Endpoint | Method | Response |
|----------|--------|----------|
| `/{connection_id}/copy` | POST | 204 |
| `/{connection_id}/move` | POST | 204 |

**Request model** (`CopyMoveRequest` in `models/file.py`):

```python
source_path: str                    # Relative to source connection's share
dest_path: str                      # Relative to destination connection's share
dest_connection_id: str | None      # Omit for same-connection operations
```

**Validation:** empty paths → 400, same path → 400, copy-into-self → 400, source not found → 404, destination exists → 409, cross-connection → 501.

**SMB implementation** (`storage/smb.py`):
- **Copy** — `smbclient.copyfile()` using `FSCTL_SRV_COPYCHUNK` for server-side copy (no data streamed through Sambee). Directories copied recursively via `smbclient.scandir()` + `smbclient.mkdir()`. Timeout: 300s.
- **Move** — `smbclient.rename()` for instant server-side rename. Timeout: 30s.
- Cross-connection operations return 501 (would require streaming through the backend).

**Frontend API** (`services/api.ts`):

```typescript
copyItem(srcConnId, srcPath, destConnId, destPath): Promise<void>
moveItem(srcConnId, srcPath, destConnId, destPath): Promise<void>
```

### Copy/Move Dialog Flow

1. User presses F5 (copy) or F6 (move) in dual-pane mode.
2. `CopyMoveDialog` opens with the effective selection and an editable destination path pre-filled from the other pane.
3. Source file list shown (max 8 visible + "…and N more" truncation).
4. Same-directory detection disables the confirm button.
5. On confirm, API calls execute sequentially per file with a progress bar.
6. Both panes refresh via WebSocket `directory_changed` notifications.

## WebSocket Integration

The backend tracks a set of subscriptions per client (`api/websocket.py`). In dual-pane mode the frontend:
- Sends `subscribe` messages for **both** panes' directories.
- Dispatches `directory_changed` events to whichever pane matches.
- Re-subscribes whenever either pane navigates.

## Design Decisions

- **Ctrl+1/2 browser conflicts:** Overridden via `preventDefault()` in `useKeyboardShortcuts`, matching VS Code Web behavior.
- **Cross-connection copy:** Returns 501. Server-side copy only works within the same SMB share.
- **Maximum panes:** Capped at 2 in the UI. The URL scheme (`p2`, `p3`, …) supports more, but the UI enforces the limit.
- **F5 dual meaning:** F5 = Copy in dual-pane mode, Refresh in single-pane mode. F7 remains `NEW_DIRECTORY`.
