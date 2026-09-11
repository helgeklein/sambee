# File Operations Toolbar Implementation Plan

## Goal

Make the available file-management operations easy to discover and usable without a keyboard on both desktop and mobile.

The implementation will add one responsive full-width file-operations toolbar at the bottom of the file browser. It will sit between the pane region and its aligned per-pane status bars, and operate exclusively on the currently active pane.

## Interaction Design

### Toolbar placement

- Render one toolbar in `FileBrowser`, outside `FileBrowserPane`.
- Span the full width of the shared pane-content region, in both single- and dual-pane modes.
- Compose three parent rows: visible panes, the full-width toolbar, then the aligned per-pane status bars.
- Move `StatusBar` rendering from `FileBrowserPane` to `FileBrowser`. Render one status bar below the toolbar for one visible pane, or one status bar per visible pane in a horizontally aligned row for two panes.
- Give the pane row and status-bar row matching tracks and divider treatment so each status bar remains directly beneath its pane.
- Do not use sticky, absolute, or overlay positioning for the toolbar.

### Commands

Show the complete file-operation command set as icon buttons, with accessible labels and desktop tooltips. Render as many icons as fit in the available toolbar width. Commands shown in order of priority:

1. New folder
1. New file
1. Rename
1. Delete
1. Copy to other pane (two-pane mode only)
1. Move to other pane (two-pane mode only)
1. Create archive
1. Extract archive
1. Refresh

When the icon row cannot fit every command shown in the current mode, move the lowest-priority commands into an icon-only More menu. Preserve the user-facing command order between the icon row and menu. The More menu appears only when one or more commands overflow.

Do not add open, viewer-picker, or native-app commands to the toolbar. Opening remains a direct row action; duplicating those commands would add noise without improving file-management discoverability.

### Availability and feedback

- Every command shown in the current mode remains visible, either as an icon or in More, and is disabled when unavailable. This makes the available operation set discoverable without allowing invalid operations.
- Availability must use the same policy and the same source of truth as keyboard shortcuts. The toolbar must not independently infer read-only access, archive immutability, selected-item requirements, transfer destinations, or provider capabilities.
- Disabled commands should expose their reason through an accessible description or tooltip using existing unavailable-operation translations.
- Invoking a command uses the existing handlers and preserves existing dialogs, progress reporting, cancellation, errors, selection semantics, and focus-return behavior.

## Technical Design

### 1. Centralize toolbar action descriptors

Add `frontend/src/pages/FileBrowser/fileOperationActions.ts` as a small, UI-agnostic model for the toolbar.

Define stable action IDs and a descriptor that includes:

- translated label and disabled-reason text
- MUI icon identifier or icon element
- display priority, used to decide which commands remain visible as icons when space is constrained
- layout visibility, used only to show Copy and Move when two panes are visible
- enabled state
- unavailable reason, when disabled
- command handler

The descriptor builder receives one action context for the active pane. That context contains the existing pane handlers, page-level copy/move/archive handlers, rendered pane mode, and the availability results calculated by `FileBrowser`.

Keep this module declarative. It must not own operation state, call storage APIs, or duplicate capability checks.

### 2. Retain one authoritative availability policy

In `frontend/src/pages/FileBrowser.tsx`, retain and name the existing `getFileListShortcutAvailability()` logic as the authoritative operation-policy boundary.

Refactor only as needed to expose an active-pane toolbar availability map derived from this function:

- `delete`
- `rename`
- `new-directory`
- `new-file`
- `copy`
- `move`
- `create-archive`
- `extract-archive`

Extend the shared availability map with an explicit Refresh rule that is exactly the current keyboard `browsing` condition. Both the keyboard shortcut and toolbar must consume this one result; do not add a toolbar-only dialog, loading, or selection rule.

Create the single action-descriptor array from `effectiveActivePaneId` / `activePane` and the rendered pane mode. When pane focus changes, React recomputes the same toolbar descriptors with the other pane's state and handlers. Capture an operation's source and destination context when its handler opens a dialog; later pane switches must not retarget that dialog or a running operation.

Continue reusing the existing page-level handlers for copy, move, archive creation, and archive extraction. The Copy descriptor must call the existing Copy handler unchanged: when its source is ZIP archive content, that handler starts the existing extraction workflow rather than a normal transfer. Continue reusing `useFileBrowserPane` handlers for refresh, creation, rename, and delete.

### 3. Build the presentational toolbar

Add `frontend/src/components/FileBrowser/FileOperationsToolbar.tsx`.

The component accepts precomputed action descriptors and renders:

- an anchored, fixed-height `Box` with a top border
- a single ordered responsive row of icon buttons
- MUI tooltips on desktop and `aria-label` values everywhere
- clear disabled states without layout shifts
- a More `IconButton` and `Menu` containing only commands that do not fit

Use a small reusable responsive-overflow hook or utility inside the component. It should observe the available toolbar width with `ResizeObserver`, reserve space for More when overflow is required, and recompute when the toolbar size or action set changes. Measure rendered command widths or use shared layout constants; do not use wrapping, horizontal scrolling, or CSS clipping as the overflow mechanism.

Keep the actions shown in the current mode in the ordered descriptor list. The calculation displays the highest-priority prefix that fits and sends the remaining suffix to More, so resizing preserves a predictable command order. Disabled commands retain their normal slot and may overflow, rather than changing the ordering based on availability.

Use existing MUI icon packages already used by the file browser. Reuse `secondaryActionStripSx` colors where appropriate, but add a concise footer-toolbar style in `frontend/src/theme/commonStyles.ts` so the toolbar is visually distinct from the upper connection/view/sort strip and the informational status bar.

The component remains presentational: it receives action labels, availability, handlers, and disabled reasons as props. It does not know about panes, archives, connections, or storage providers.

### 4. Place and wire the single toolbar

In `frontend/src/pages/FileBrowser.tsx`:

1. Create the active-pane operation context after `activePane`, `inactivePane`, and the existing availability helpers are known.
2. Build action descriptors once for that context.
3. Extract `StatusBar` from `FileBrowserPane`. Keep panes responsible for breadcrumbs, compact search, and virtualized lists only.
4. Render the shared pane-content `Box`, then `FileOperationsToolbar` exactly once across its full width, then the parent-owned status-bar row.
5. Derive toolbar state from the rendered pane mode and `effectiveActivePaneId`. Do not add any desktop or viewport-size condition to Copy/Move visibility; show them whenever the browser renders two panes.
6. Keep the toolbar visible in every pane layout, including empty directories, so Refresh and permitted creation commands remain available. Preserve the existing responsive status-bar visibility and mobile safe-area behavior.

Do not pass toolbar props into `FileBrowserPane`, and do not move CRUD dialog ownership from the pane hook. The global toolbar calls handlers associated with the active pane; its dialogs may continue to render within their respective `FileBrowserPane` instances.

### 5. Mobile support

The same global component must render on compact layouts:

- use touch-friendly 44px-or-larger icon targets
- preserve icon labels for screen readers and long-press/hover-capable devices
- render the maximum number of icons that fit at the current viewport width; put only the remaining lower-priority commands in More
- keep all compact-layout commands discoverable even when the active connection, selection, or archive state makes them unavailable

The toolbar must not introduce its own screen-size rule for Copy/Move. They appear whenever the existing browser layout renders two panes and are omitted when it renders one pane.

### 6. Localize user-facing text

Review existing `fileBrowser` action and unavailable-shortcut translations before adding new keys.

Add only missing strings for:

- toolbar accessible labels and tooltips
- More menu label
- disabled-command descriptions where existing shortcut-focused messages are unsuitable

Use translation keys from action descriptors; do not hard-code display text in the toolbar.

## Testing Plan

### Component tests

Add `frontend/src/components/FileBrowser/__tests__/FileOperationsToolbar.test.tsx` to test:

- primary buttons and their accessible labels
- desktop tooltip wiring
- enabled and disabled rendering
- click delegation only for enabled actions
- More menu visibility, contents, and click delegation
- responsive overflow at several container widths, including restoring icons when space becomes available
- Copy/Move visibility whenever the rendered layout has two panes
- stable layout behavior when actions are disabled

### Page and interaction tests

Extend `frontend/src/pages/__tests__/FileBrowser-interactions.test.tsx` and the appropriate `FileBrowser` rendering suite to test:

- only one toolbar renders in dual-pane mode
- selecting/focusing the other pane switches handler targets and action availability
- toolbar commands invoke the same handlers as their keyboard shortcuts
- Refresh has the same enabled state as the keyboard `browsing` condition
- read-only connections and archive locations keep mutations disabled
- Copy from ZIP archive content opens the existing extraction workflow with the source pane and destination pane captured at invocation
- no selected item disables Rename/Delete and explains why
- Copy/Move are present in the rendered two-pane layout and absent in the rendered single-pane layout
- empty directories retain Refresh and valid creation commands
- after opening Rename/Create, Copy/Move, or archive dialogs, switching panes leaves the open dialog and any running operation bound to its original source and destination context

Update `frontend/src/pages/__tests__/FileBrowserPane.test.tsx` to remove its `StatusBar` mock and pane-level status-bar assertions, then verify that panes no longer render status bars or an operations toolbar.

Add parent-level `FileBrowser` layout tests verifying that the parent renders one toolbar above one status bar in single-pane mode and above two aligned status bars in two-pane mode. Move the prior status-bar rendering coverage to those tests, including the existing empty-file and compact-layout visibility rules.

### Policy regression tests

Keep and extend the focused tests around `contentOperations.ts` and shortcut availability as necessary. Add parity assertions that each toolbar descriptor's enabled state matches the corresponding `getFileListShortcutAvailability()` result for the same active-pane context.

## Validation

1. From `frontend/`, run the new toolbar test and affected FileBrowser test files with `npm run test -- <test paths>`.
2. From `frontend/`, run `npx tsc --noEmit`.
3. From `frontend/`, run `npm run lint`.
4. Manually verify `http://localhost:3000/browse/smb/demo` at desktop and compact widths:
   - writable connection with and without a selected file
   - read-only connection
   - archive browsing view
   - dual-pane mode, switching active pane before each command
   - compact/mobile mode using only touch/click inputs
5. Confirm the toolbar cannot bypass provider capabilities, read-only restrictions, archive immutability, or dual-pane requirements.
6. Audit `website/content/docs/` after implementation. Update documentation only if it documents file-browser operation entry points or screenshots affected by the new toolbar.

## Scope Boundaries

Included:

- A single responsive toolbar for the current active pane.
- Existing supported file-management actions and their existing dialogs/workflows.
- Centralized descriptor construction and policy reuse.
- Keyboard-independent mobile access to supported operations.

Excluded:

- New backend file operations.
- Changing dual-pane availability or its responsive behavior.
- Duplicating toolbars inside panes.
- Reworking the existing command palette, context menus, or keyboard shortcut system beyond sharing policy/handlers where needed.
