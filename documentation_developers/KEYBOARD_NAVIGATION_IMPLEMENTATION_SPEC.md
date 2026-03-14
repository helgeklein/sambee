# Keyboard Navigation Implementation Spec

## Purpose

This document defines the next keyboard-navigation change for the file browser:

- `Ctrl+Alt+F` becomes a pane-local current-directory filter mode.
- The filter affects the main file list, not a dropdown result list.
- The filter term persists while the user stays in the same directory.
- The active filter state is visible in the bottom status bar.

This spec supersedes the earlier plan that treated current-directory filtering as a dropdown mode inside the smart bar.

## Scope

This spec covers only current-directory filtering behavior.

It does not redefine:

- smart navigation opened with `Ctrl+K`,
- browser command mode opened with `Ctrl+P` or `F1`,
- backend-powered directory search,
- the broader command registry architecture.

## Product Decision

Current-directory filtering and directory search should no longer share the same dropdown surface.

Reason:

- Directory search is a remote navigation action that benefits from a result dropdown.
- Current-directory filtering is a local view transformation and should be reflected directly in the pane's main file list.
- Users need persistent visibility of the applied filter term and a natural handoff from filter input to list navigation.

## Goals

- `Ctrl+Alt+F` focuses a filter input for the active pane.
- Typing updates the visible file list in that pane immediately.
- `ArrowDown` from the filter input moves focus into the filtered file list.
- Standard list shortcuts continue to operate on the filtered result set.
- Pressing `Ctrl+Alt+F` again returns focus to the filter input.
- The current filter term stays visible while the pane remains in the same directory.
- Switching to smart navigation or command mode and back to filter mode restores the same filter term.
- The bottom status bar shows that a filter is active.
- Navigating to a different directory clears the filter.

## Non-Goals

- Backend changes.
- Cross-directory or cross-connection filtering.
- Full-text search inside file contents.
- A second persistent toolbar surface dedicated only to filtering.
- Removing the file list's existing incremental type-to-focus behavior in this phase.

## Target Experience

### Primary flow

1. User presses `Ctrl+Alt+F`.
2. The active pane's filter input receives focus.
3. The filter input shows the existing filter term for that pane and directory, if any.
4. Typing immediately filters the pane's main file list.
5. Pressing `ArrowDown` from the input moves focus into the filtered result list.
6. Arrow keys, Page Up, Page Down, Home, End, Enter, selection shortcuts, and file actions operate on the filtered list exactly as they do on the normal list.
7. Pressing `Ctrl+Alt+F` from the list returns focus to the filter input without clearing the term.

### Persistence rules

- The filter term is stored per pane.
- The filter term remains active while the pane stays on the same `connectionId + currentPath`.
- Switching to `Ctrl+K` smart navigation or `Ctrl+P` command mode does not clear the filter.
- Returning to filter mode restores the previous term.
- Navigating to another directory clears the filter term for that pane.
- Changing the pane's connection also clears the filter term.

### Visibility rules

- While filter mode is focused, the filter input shows the active term.
- When another box mode is focused, the active filter is still visible through the bottom status bar.
- The status bar must show an explicit filter indicator when the pane has a non-empty active filter.

## UX Rules

## 1. Filter input behavior

- `Ctrl+Alt+F` opens or refocuses filter mode for the active pane.
- If the input is already focused, `Ctrl+Alt+F` selects the existing filter text.
- `Escape` inside filter mode follows this order:
  - if the input has text, clear the filter text and keep focus in the input;
  - otherwise return focus to the pane's file list.
- `ArrowDown` from the input moves focus to the pane's file list.
- `ArrowUp` in the input does not move to the list.
- The filter input does not show a dropdown for current-directory results.

## 2. File list behavior while filtered

- The visible list is the pane's normal sorted list with an additional filter term applied.
- Sorting continues to apply before filtering.
- Directories remain mixed into the same filtered result set according to the existing sort rules.
- If the focused item disappears because of a filter change, focus moves to the first visible filtered item.
- If the filter produces zero results, focus remains in the filter input when possible.
- Existing keyboard shortcuts continue to operate against the filtered visible list only.

## 3. Status bar behavior

- The status bar must render a filter indicator whenever a non-empty filter is active for that pane.
- The indicator must include the filter term.
- The indicator must remain visible even when the user switches away from filter mode to smart navigation or commands.
- The indicator disappears when the filter is cleared or when directory navigation resets the filter.

### Recommended status text

- `Filtered by: report`

If the current status bar layout makes a literal sentence too cramped, a compact equivalent is acceptable, but the term itself must be visible.

## Architectural Decision

Current-directory filtering must move from quick-bar provider state into pane state.

### Why

The current `UnifiedSearchBar` owns its own query state and resets when the provider changes. That model is correct for transient dropdown queries, but it does not satisfy the new requirements:

- persistent per-directory filter state,
- visible filter term after mode switches,
- list-backed filtering without dropdown results.

The pane already owns the rendered list, focus behavior, virtualization, and navigation semantics. The filter therefore belongs in the pane hook.

## Required State Model

Add pane-local filter state in `useFileBrowserPane`.

### New pane state

- `currentDirectoryFilter: string`
- `setCurrentDirectoryFilter(...)`
- `clearCurrentDirectoryFilter()`
- `isFilterActive: boolean`

### New computed data

- `visibleFiles`: the pane's sorted file list after current-directory filtering is applied

`visibleFiles` becomes the main list consumed by:

- the virtualizer,
- focus restoration,
- file opening,
- status bar,
- selection helpers,
- all keyboard navigation handlers.

The existing `sortedAndFilteredFiles` name should be reviewed. If it currently means only sorted, either:

- rename it for clarity, or
- keep it only if the new semantics are documented precisely.

The preferred direction is clearer naming to distinguish:

- sorted unfiltered files,
- visible filtered files.

## Interaction Model

## 1. Quick-bar mode model

The browser should explicitly distinguish these surfaces:

- `smart`: `Ctrl+K`, dropdown-backed directory navigation, `>` command escape hatch
- `commands`: `Ctrl+P` or `F1`, dropdown-backed command palette
- `filter`: `Ctrl+Alt+F`, input-only current-directory filtering

Filter mode is still rendered by the shared top input control, but it is not a dropdown search provider in the same sense as smart navigation and commands.

## 2. Shared input component behavior

`UnifiedSearchBar` should support an input-only mode for pane filtering.

Required capabilities:

- controlled query value supplied by parent state,
- `onQueryChange` callback,
- optional suppression of dropdown rendering,
- custom `ArrowDown` handoff callback to focus the list,
- no automatic query reset when switching away from filter mode and back.

This can be implemented either by:

- extending `UnifiedSearchBar` to support both dropdown and input-only modes, or
- extracting a smaller shared input shell used by both quick-bar search and pane filter mode.

Either approach is acceptable. Reusing the visual shell is preferred.

## 3. Focus routing

### Entering filter mode

- `Ctrl+Alt+F` captures the active pane.
- The pane's filter input receives focus.
- Existing filter text is selected.

### Moving into the list

- `ArrowDown` from the filter input focuses the pane's file list.
- Once the list has focus, all existing list-navigation shortcuts continue to work.

### Returning to the filter input

- `Ctrl+Alt+F` from the file list focuses the filter input for that pane.
- The filter term remains unchanged.

### Leaving filter mode

- Opening smart navigation or command mode changes the visible top-box mode but does not clear the pane filter.
- The status bar remains the persistent reminder that filtering is still active.

## File-Level Plan

## Frontend files to change

### `frontend/src/pages/FileBrowser/useFileBrowserPane.ts`

- Add pane-owned filter state.
- Clear the filter on directory or connection changes.
- Derive the visible file list from sorted files plus `currentDirectoryFilter`.
- Update focus restoration logic to operate on the visible filtered list.
- Ensure `filesRef` mirrors the visible list used by keyboard handlers.

### `frontend/src/pages/FileBrowser/types.ts`

- Add the new filter state and helpers to `UseFileBrowserPaneReturn`.
- Expose the pane's visible filtered files and filter flags required by the parent and status bar.

### `frontend/src/pages/FileBrowser.tsx`

- Reintroduce an explicit `filter` mode in the top-box state.
- Route `Ctrl+Alt+F` to that mode instead of treating it as a smart-navigation alias.
- Keep smart navigation and commands separate from pane-local filtering.
- Preserve per-pane filter state across quick-bar mode switches.

### `frontend/src/components/FileBrowser/UnifiedSearchBar.tsx`

- Support a controlled input mode for current-directory filtering.
- Support hiding the dropdown entirely in filter mode.
- Support `ArrowDown` handoff into the file list.
- Avoid clearing the controlled value on provider-mode changes.

### `frontend/src/components/FileBrowser/StatusBar.tsx`

- Add rendering support for an active filter indicator.
- Ensure the filter term is visible in both compact and non-compact status bar layouts if the status bar is shown.

### `frontend/src/pages/FileBrowser/FileBrowserPane.tsx`

- Render the status bar based on the visible filtered file list.
- Pass any required filter-state props into the status bar.

### `frontend/src/config/keyboardShortcuts.ts`

- Keep `Ctrl+Alt+F` as the current-directory filter shortcut.
- Update labels and descriptions to match the new list-backed behavior.

### `frontend/src/config/browserCommands.ts`

- Update the browser command metadata so `Open filter mode` refers to current-directory list filtering rather than smart navigation.

## Files likely no longer needed for filter mode

The current dropdown-oriented provider for local filtering should be removed or retired from active use if it no longer serves any runtime path:

- `frontend/src/components/FileBrowser/search/useCurrentDirectoryFilterProvider.tsx`

If any part of that file remains useful as a shared matcher utility, extract the matcher logic and remove the dropdown provider wrapper.

## Testing Requirements

## Interaction tests

- `Ctrl+Alt+F` focuses the filter input for the active pane.
- Typing filters the main file list rather than opening a dropdown.
- `ArrowDown` from the filter input moves focus to the filtered file list.
- Existing arrow-key navigation works within the filtered list.
- `Ctrl+Alt+F` from the list returns focus to the filter input.
- Switching to smart navigation and back restores the previous filter term.
- Navigating to another directory clears the filter term.
- Dual-pane mode keeps filter state isolated per pane.

## Rendering tests

- The status bar shows the active filter term when filtering is active.
- The status bar hides the filter indicator when the filter is cleared.
- Zero-result filters render correctly without broken focus behavior.

## Regression tests

- Smart navigation still opens with `Ctrl+K` and uses the dropdown.
- Command mode still opens with `Ctrl+P` and `F1`.
- Existing file-list navigation and CRUD shortcuts still work.
- Captured-pane behavior for smart navigation and commands remains intact.

## Documentation Deliverables

After implementation, update:

- `documentation_developers/KEYBOARD_SHORTCUTS.md`
- `documentation_developers/DUAL_PANE_FILE_BROWSER.md`

Required documentation changes:

- `Ctrl+Alt+F` must be documented as current-directory list filtering.
- Smart navigation documentation must no longer claim that it merges local filtering into its dropdown.
- Status-bar filter visibility must be documented.
- Per-pane persistence and reset-on-navigation rules must be documented.

## Acceptance Criteria

The implementation is complete when all of the following are true:

- `Ctrl+Alt+F` opens a pane-local filter input.
- Typing updates the pane's main file list immediately.
- The filter mode does not show current-directory results in a dropdown.
- `ArrowDown` from the filter input moves focus into the filtered list.
- `Ctrl+Alt+F` returns focus from the list to the filter input.
- The filter term persists across box-mode switches within the same directory.
- The filter term clears on directory navigation or connection change.
- The bottom status bar shows the active filter term whenever filtering is active.
- Smart navigation and command mode continue to work independently of the pane-local filter.
