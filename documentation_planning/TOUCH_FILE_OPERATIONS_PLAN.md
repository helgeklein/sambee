# Touch-First File Operations Implementation Plan

## Goal

Make file-management operations fully usable in the compact file-browser layout without a hardware keyboard.

On compact layouts, replace the persistent operations toolbar with contextual touch controls:

- an explicit per-item actions menu invoked by a more actions button
- a temporary selection-actions menu for one or more selected items
- a lower-right create button that exposes New folder and New file

Desktop retains the existing full-width operations toolbar. This plan does not change the existing desktop keyboard, toolbar, dual-pane, or operation workflows.

## Decision Record

### Use compact layout, not keyboard detection

Do not try to determine whether a device has a keyboard. The web platform cannot reliably distinguish a touch-only device from a tablet, laptop, or desktop with an attached or detached keyboard.

Existing code already provides two related but distinct signals:

- `useCompactLayout` uses the `sm` breakpoint to choose the mobile layout.
- `useQuickBarKeyboardHints()` records trusted keyboard-event evidence only to decide whether shortcut hints should be shown.

Neither signal is a reliable hardware-keyboard capability API. Treating `useCompactLayout` as the mobile interaction boundary is predictable, testable, and consistent with the current responsive browser design.

Result:

- Render the desktop operations toolbar only when `useCompactLayout` is false.
- Render compact contextual controls only when `useCompactLayout` is true.
- Keep keyboard support working on compact layouts when a keyboard is attached. Do not remove shortcut handlers or keyboard focus behavior.

### Keep desktop context menus; use item actions menus on compact layouts

The existing desktop `FileRow` context menu remains unchanged. Do not add, remove, reorder, or refactor its commands as part of this work.

On compact layouts, do not show the application's context menu and do not attach its `contextmenu` handler to rows. Instead, render a visible, labelled per-item more actions button with the vertical-ellipsis `MoreVert` icon. It opens the compact item actions menu. Long presses have no effect in the file browser: they do not open an application menu, enter selection mode, select an item, activate an item, or invoke an operation.

### Terminology

Use these terms consistently in code, tests, documentation, accessible labels, and UI copy:

- **Desktop context menu**: the existing right-click or keyboard-invoked menu on desktop. It is unchanged and remains the only surface called a context menu.
- **More actions button**: the compact row or selection control using the vertical-ellipsis `MoreVert` icon. A row button has an accessible label such as `More actions for report.pdf`.
- **Item actions menu**: the compact, item-specific menu opened by a row's more actions button. It is not an overflow menu or a context menu.
- **Selection actions menu**: the compact menu for bulk actions, opened by the selection surface's more actions button.
- **Create menu**: the compact menu opened by the lower-right `+` create button.

### Preserve the existing policy and workflow boundaries

`FileBrowser.tsx` remains the authoritative place for operation availability. It already computes active-pane operation availability from `getFileListShortcutAvailability()` and opens page-owned copy/move/archive workflows that capture source and destination at invocation.

Do not replicate permission, selection, archive, or destination checks in `FileRow`, `FileList`, or a compact menu component.

## Target Interaction Model

### Compact layout without selection mode

Each readable row displays a right-aligned more actions button with the `MoreVert` icon and an accessible label such as `More actions for report.pdf`.

Tapping it opens an anchored item actions menu. The menu operates on the item that opened it, not whatever row is focused later. It is a compact-only menu, separate from and not a replacement for the unchanged desktop context menu.

Show commands in this order when applicable:

1. Select.
1. Open / viewer choices, retaining the current applicable viewer and native-app entries.
1. Rename.
1. Delete.
1. Extract archive, for an eligible archive file.

Use the same availability policy used by keyboard and desktop toolbar commands. Show unavailable file-management commands disabled with an accessible reason when the action is conceptually applicable; omit actions that make no sense for the item, such as Extract archive for a regular text file.

The action menu must explicitly focus the item before invoking any existing active-pane handler. It then invokes the existing handler with an invocation context captured from that row.

### Compact selection mode

The user needs a deliberate multi-selection state before touch can drive bulk operations. Add explicit selection mode; do not change ordinary row tap behavior.

Enter selection mode through `Select` in the row item actions menu. This action:

1. Makes the pane active.
1. Sets the row as focused.
1. Adds the row to `selectedFiles`.
1. Shows selection controls for the pane.

While selection mode is active:

- tapping any row toggles its selection instead of opening it
- rows retain their existing multi-selected visual treatment
- the compact header or a compact list-local action surface shows the selected count, Clear selection, and a more actions button
- the more actions button opens the selection actions menu containing enabled and disabled bulk actions in this order: Copy, Move, Create archive, Delete
- Copy and Move appear only when the browser currently renders two panes, preserving the existing `isDualMode` rule
- Rename and Extract archive remain item-scoped and therefore stay in a row menu, not the bulk menu
- clearing the final selected item exits selection mode and restores normal row tap behavior
- selection state is per pane. Activating another pane does not mutate the first pane's selection.

The following transitions are part of the compact selection-state contract:

| Event | Selection result |
| --- | --- |
| Enter a directory, navigate back/up, or change connection/location | Clear the pane's selection and exit selection mode. |
| Refresh finishes | Reconcile selected canonical paths with the refreshed list; retain existing items and exit selection mode only if none remain. |
| Open or close a viewer, or cancel a dialog | Preserve selection. |
| Rename succeeds | Replace the selected item's old canonical path with its new canonical path; preserve other selected items. |
| Delete succeeds | Remove deleted paths; preserve remaining selected items and exit selection mode if none remain. |
| Move succeeds | Remove moved source paths; preserve remaining selected items and exit selection mode if none remain. |
| Copy, archive creation, or extraction succeeds | Preserve selection. |
| An operation fails | Preserve selection. |
| Clear selection or deselect the final item | Clear the pane's selection and exit selection mode. |

Do not add a long-press gesture in this implementation or as a later shortcut within this interaction model. Long pressing is intentionally ignored by compact file-browser interaction.

### Compact create control

When the current compact pane can create content, render a 56px circular `+` icon button at the lower right of the visible file-list container.

- Use MUI `Fab` or `IconButton` with `Add` icon, an `aria-label` such as `Create new item`, and a tooltip for pointer users.
- Position it `absolute` within `FileList`'s already positioned list container, above scrolling content and not fixed to the viewport. Give the scrollable list sufficient bottom padding so the last row can never be obscured.
- Respect the mobile safe-area inset when positioning it.
- Tap opens an anchored menu containing New folder, then New file.
- The menu entries reuse the existing creation handlers and the centrally computed availability. When neither creation action is available, do not render the button.
- Show the control for empty directories as well as non-empty directories.
- Hide it while a modal, viewer, or file-picker state owns interaction.

The create control intentionally contains only creation actions. It must not become an alternate all-operations menu.

## Central Command Definition

### Extend file-operation descriptors by surface

Extend `frontend/src/pages/FileBrowser/fileOperationActions.ts`, rather than creating independent menu-specific lists.

Define presentation placement explicitly. A single action can have multiple placements with different scopes; Delete is item-scoped in an item actions menu and selection-scoped in a selection actions menu.

```ts
type FileOperationSurface =
  | "desktop-toolbar"
  | "compact-item-menu"
  | "compact-selection-menu"
  | "compact-create-menu";

type FileOperationScope = "item" | "selection" | "pane";

interface FileOperationPlacement {
  surface: FileOperationSurface;
  scope: FileOperationScope;
  priority: number;
}

interface FileOperationDefinition {
  id: FileOperationActionId;
  placements: readonly FileOperationPlacement[];
  requiresTwoPanes?: boolean;
}
```

`placements` is a static allow-list and ordering rule. Runtime filtering then removes placements whose feature prerequisites are unavailable, such as Copy or Move when `isDualMode` is false, and applies the page-supplied enabled state and unavailable reason for the captured invocation context.

Keep the existing stable action IDs. Map them to surfaces as follows:

| Action | Placement scope | Surfaces |
| --- | --- | --- |
| New folder | pane | desktop toolbar, compact create menu |
| New file | pane | desktop toolbar, compact create menu |
| Rename | item | desktop toolbar, compact item menu |
| Delete | item/selection | desktop toolbar, compact item menu, compact selection menu |
| Copy | selection | desktop toolbar, compact selection menu |
| Move | selection | desktop toolbar, compact selection menu |
| Create archive | selection | desktop toolbar, compact selection menu |
| Extract archive | item | desktop toolbar, compact item menu |
| Refresh | pane | desktop toolbar only |

Define immutable operation context types:

```ts
interface FileOperationPolicyContext {
  paneId: PaneId;
  items: readonly BrowserItem[];
  focusedItem?: BrowserItem;
}

interface FileOperationInvocationContext extends FileOperationPolicyContext {
  destination?: CapturedDestination;
}
```

`FileBrowser.tsx` owns `buildActions(context, surface)`. It obtains policy results for that context, filters the static placements for the requested surface, and returns descriptors whose `onClick` closures retain the immutable invocation context. `FileBrowserPane` requests actions through callbacks such as `getCompactItemActions(item)` and `getCompactSelectionActions(items)`; it does not recompute availability itself. Descriptor construction must not call storage APIs or infer permissions in presentational components.

### Item-specific availability without accidental retargeting

The existing toolbar evaluates the effective selection of the active pane. A row menu needs a dedicated context so its action remains bound to the menu row even if focus changes.

Refactor the page availability helper to accept a `FileOperationPolicyContext`. The keyboard and desktop-toolbar wrapper passes the active pane's current effective selection. A compact item actions menu supplies exactly one row item as `items` and `focusedItem`. A compact selection actions menu snapshots its selected items when it opens.

Reuse existing page-level copy/move/archive handlers, extending their public callback shape only enough to accept a captured policy context. The handlers must snapshot source pane, source handles, destination location, and destination pane before opening a dialog or starting an operation.

The desktop context-menu renderer and its local viewer-action logic do not consume these descriptors and remain unchanged. The descriptor change applies to the desktop toolbar and new compact action surfaces only.

## Component and State Changes

### 1. `useFileBrowserPane.ts`

Add explicit touch-selection helpers; keep existing keyboard methods unchanged:

- `selectItem(file, index)`
- `toggleItemSelection(file, index)`
- `isSelectionMode` derived from `selectedFiles.size > 0`
- `getItemsByPaths(paths)` to turn a captured compact-menu snapshot into `BrowserItem` handles

Do not expose raw state setters. Change selection state from display names to canonical `FileEntry.path` values. A path is stable across a list refresh and avoids coupling selection identity to backend filename uniqueness, case handling, or archive-entry display names.

Modify `handleFileClick` only through an explicit `selectionMode` branch: toggle selection and return before archive navigation or file opening. Preserve the current normal-tap behavior when no item is selected.

`Select` is shown only for an unselected row. A selected row's item actions menu shows `Deselect` instead. Deselecting the final item exits selection mode through the derived state.

### 2. `FileRow.tsx`

Leave the desktop context-menu component, state, renderer, and viewer-action callbacks unchanged. Add compact-only props for the separate item actions menu.

New props should be callbacks/data only:

- `showCompactActions`
- `onOpenItemActions(file, index, anchorElement)`
- existing open/viewer callbacks can be migrated into the central item-action descriptors instead of remaining independently rendered menu entries

In compact layout, render a trailing `MoreVert` more actions `IconButton` with a fixed 44px by 44px touch target, centred in the existing 56px mobile row, and a row-specific accessible label. Stop propagation so the button does not activate the row. It must be visible for every actionable readable row.

Avoid opening the MUI menu inside a virtualized row. Keep the compact menu state at `FileList` or `FileBrowserPane` level as a captured item and static anchor position:

```ts
interface CompactItemMenuState {
  item: BrowserItem;
  anchorPosition: { top: number; left: number };
  triggerElement: HTMLElement | null;
}
```

Capture the trigger's bounding rectangle when the more actions button is pressed and render MUI `Menu` with `anchorReference="anchorPosition"`. This keeps the open menu positioned and correctly targeted if its row is virtualized out of view. On close, restore focus to `triggerElement` only when it is still connected; otherwise focus the file-list container.

Do not change desktop `onContextMenu` handling or its current menu contents. In compact layout, do not attach or use a `contextmenu` interaction path. Open the compact item actions menu only from the visible more actions button. A compact long press must otherwise leave application menu, selection, focus, and file activation state unchanged.

### 3. `FileList.tsx`

Continue owning the positioned list region. Add slots/props for compact overlays and an item-action controller:

- `compactOverlay?: ReactNode`
- `onOpenItemActions`
- optional `selectionMode` to guide row tap semantics and ARIA labels

Render the create FAB and compact selection surface above the virtual scroller. Use a single overlay layer that is a positioned sibling of the scroll element, with `pointerEvents: none`; enable pointer events only on its actual controls. This avoids blocking row scrolling and taps.

When the FAB is visible, position it with `right: 16px` and `bottom: max(16px, env(safe-area-inset-bottom))`. Add `padding-block-end: calc(56px + 16px + env(safe-area-inset-bottom))` to the scroll element, rather than the positioned outer container, so the final row is never obscured.

### 4. New compact components

Add focused presentational components under `frontend/src/components/FileBrowser/`:

- `CompactCreateMenu.tsx`: one anchored `Add` button and New folder/New file menu. Accepts descriptors only.
- `CompactItemActionsMenu.tsx`: a page/pane-owned, position-anchored item actions menu for one captured row context. Renders compact descriptors and any explicitly shared viewer-specific entries without changing desktop menu rendering.
- `CompactSelectionActions.tsx`: selected-count surface with Clear selection and a more actions button that opens the selection actions menu for central selection action descriptors.

Use MUI `Fab`, `IconButton`, `Menu`, and `MenuItem`. Use existing icon library symbols for all controls. Tooltips are supplemental; buttons require accessible labels.

### 5. `FileBrowserPane.tsx`

Make the pane the compact action composition boundary because it owns `FileList`, per-pane dialogs, and pane state. It receives page-built descriptors and invocation callbacks from `FileBrowser`.

Add only minimal props to pass:

- compact pane-level creation descriptors
- an item-action descriptor builder/callback accepting the selected row identity
- compact selection-menu descriptors
- callbacks to clear/select/toggle pane selection

Do not make `FileRow` aware of connections, archive providers, dual-pane state, or page-level transfer destinations.

### 6. `FileBrowser.tsx`

- Render `FileOperationsToolbar` only for non-compact layouts.
- Preserve the existing desktop status-bar behavior.
- Derive compact actions from the same descriptor definitions and policy results as the desktop toolbar.
- Refactor `getFileListShortcutAvailability()` into a context-aware policy function while retaining its current keyboard-facing wrapper. Add parity tests so keyboard and desktop descriptor results cannot diverge.
- Capture operations at invocation time. An item/selection menu must not read `activePane` or selection again after the user has opened it. Keyboard shortcuts use the active pane's effective selection at the time the shortcut is pressed, matching the current desktop-toolbar contract.
- Treat item actions in an inactive dual pane as a focus change plus captured invocation. The later dialog/operation remains tied to the item and destination captured before the focus change.
- In compact layout, Copy/Move are absent because current layout renders one pane. Keep the descriptor rule based on rendered `isDualMode`, not a touch or viewport-specific check.

## Accessibility and Interaction Requirements

- Every compact more actions button and the create button has an accessible name and a 44px minimum target. The create FAB uses 56px.
- Menus use native MUI menu semantics and support Escape and keyboard navigation for attached keyboards. On close, restore focus to the connected trigger or fall back to the file-list container when virtualization removed it.
- Long presses have no compact file-operation behavior: they do not open application menus, alter selection, focus rows, activate items, or invoke commands.
- Use a dedicated `aria-live="polite"` selection-status element. Announce `1 item selected`, `2 items selected` (substituting the current count), and `Selection cleared` when selection mode is entered, the count changes, or it exits.
- In selection mode, rows expose checked/selected state consistently through `aria-pressed`, `aria-selected`, or the appropriate list pattern chosen by the existing file-list semantics.
- Ensure overlay controls do not obscure the final scrollable row or prevent scrolling.
- Disabled menu actions include the existing unavailable-operation explanation. Omit only actions that are structurally irrelevant to the row.

## Testing Plan

### Unit tests

Extend `fileOperationActions.test.ts`:

- descriptor surface filtering and per-surface ordering
- Delete's distinct item and selection placements
- Copy/Move only when `isDualMode` is true
- pane, item, and selection scopes
- policy parity for each shared desktop/compact action

Add `CompactCreateMenu.test.tsx`:

- button visible only when New folder or New file is enabled
- creates anchored menu with ordered entries
- delegates each enabled action and does not delegate disabled actions
- has an accessible label and 56px touch target

Add `CompactItemActionsMenu.test.tsx`:

- item menu preserves the captured row context
- menu remains correctly positioned and targeted when the triggering virtualized row unmounts
- focus returns to the connected trigger, or to the file-list fallback when it unmounts
- relevant commands appear in priority order
- disabled reason is exposed
- ordinary files omit Extract archive
- archive files include Extract archive when supported

Add `CompactSelectionActions.test.tsx`:

- selected count and Clear selection
- bulk action menu ordering and disabled states
- two-pane Copy/Move visibility is descriptor-driven

Extend `FileRow.test.tsx` and `FileList.test.tsx`:

- compact visible more actions button, accessible label, and propagation behavior
- clicking the more actions button never calls the row activation handler
- desktop context menu behavior and contents remain unchanged
- compact rows do not attach the application's context-menu handler
- dispatching a compact `contextmenu` event does not open an application menu, alter selection/focus, activate a row, or invoke an action
- row tap opens content normally outside selection mode
- row tap toggles selection in selection mode
- row selection uses canonical paths, including refresh reconciliation and renamed-item path replacement
- overlay controls do not appear in desktop mode and leave virtual list interaction intact

### Page and interaction tests

Extend `FileBrowser-interactions.test.tsx`:

- compact mode has no persistent operations toolbar
- compact create FAB opens New folder/New file and starts the existing creation dialog
- read-only and archive locations hide or disable create control correctly
- item menu Rename/Delete invokes existing dialogs for the captured item
- Select enters selection mode; taps add/remove items; clearing exits it
- selection lifecycle follows the transition table for navigation, refresh, viewer/dialog close, success, and failure cases
- selection menu Delete/Create archive invokes existing workflows for the captured set
- Extract archive remains item-scoped in selection mode and preserves the current selection when its dialog closes or completes
- changing active pane after opening Copy/Move or archive dialogs cannot retarget source/destination
- a compact keyboard shortcut uses the active pane's effective selection at the time it is pressed
- viewer and dialog states prevent compact overlays from initiating competing actions
- the selection status live region announces entering, changing, and leaving selection mode

Keep existing desktop toolbar tests unchanged except where a shared descriptor factory is intentionally refactored.

### Manual validation

Use `http://localhost:3000/browse/smb/demo` only.

Validate at compact width with pointer/touch input:

1. Normal row tap still opens a file or navigates to a directory.
1. Row item actions menu opens from the more actions button without activating the row.
1. Long pressing a compact row produces no file-browser menu, selection, focus, or file-activation change.
1. Select, multi-select, deselect, and clear-selection behavior are predictable.
1. Rename, Delete, Create archive, and Extract archive use the expected existing dialogs.
1. Create FAB stays above content, respects the safe area, and does not hide the final list row.
1. Read-only and archive locations cannot bypass capability restrictions.

Validate desktop afterward:

1. Existing toolbar still renders once, with unchanged overflow behavior.
1. Desktop contextmenu remains available.
1. Dual-pane Copy/Move continue to bind operations to their source and destination at invocation.

## Delivery Phases

### Phase 1: Central descriptors and context capture

Refactor descriptor data and availability-policy input to support presentation surfaces and explicit invocation contexts. Add unit parity tests before rendering new controls.

### Phase 2: Compact creation

Hide the persistent toolbar on compact layout and add the compact create FAB/menu. This is an independent, low-risk deliverable for empty and writable folders.

### Phase 3: Item actions

Add a visible compact row more actions button and a list/pane-owned item actions menu. Migrate Rename/Delete/Extract archive incrementally while preserving viewer actions.

### Phase 4: Selection mode and bulk operations

Implement explicit selection mode, count/clear controls, and compact bulk actions. This is the highest-risk phase; validate every operation’s captured context and archive behavior.

### Phase 5: Accessibility, regression, and visual review

Run focused component/page tests, the full affected frontend test slice, `npx tsc --noEmit`, `npm run lint`, and `git diff --check`. Complete manual compact and desktop validation.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Misidentifying keyboardless devices | Use compact layout only; do not infer hardware capabilities. |
| Mobile long press invokes file-browser actions | Do not attach the application context-menu handler in compact layout; expose the visible more actions button instead. |
| Virtualized row unmount affects an open menu | Capture the item and a static anchor position above `FileRow`; fall back to file-list focus after close. |
| Operation retargeting after focus change | Snapshot pane, item handles, selection, and destination at invocation. |
| Divergent desktop/mobile policy | Keep one page-level availability function and descriptor factory; add parity tests. |
| Accidental row activation from action button | Stop propagation and add interaction tests. |
| FAB obscures content | Use an overlay sibling and bottom padding on the actual scroll element, including safe-area inset. |
| Conflating action-menu scopes | Keep item actions, selection actions, and creation actions in separately named menus. |

## Effort Estimate

- Phase 1: medium
- Phase 2: small
- Phase 3: medium
- Phase 4: high
- Phase 5: medium

The selection-mode phase is the primary complexity driver. It should not be merged with the initial create-FAB work until central context capture and compact item actions have coverage.

## Scope Boundaries

Included:

- Compact-layout contextual file actions and explicit touch multi-selection.
- Shared action descriptors across desktop and compact presentation surfaces.
- Existing operation workflows, dialogs, validation, and translations.

Excluded:

- Reliable physical keyboard detection, which the browser cannot provide.
- Any long-press gesture or long-press fallback for file operations.
- New backend file operations.
- Changing dual-pane availability or compact dual-pane behavior.
- Replacing desktop toolbar or keyboard-first workflows.
