# File Operations Toolbar Implementation Plan

## Goal

Make the available file-management operations easy to discover and usable without a keyboard on both desktop and mobile.

The implementation will add one responsive file-operations toolbar at the bottom of the file browser. It will appear above the global application status area, below the full pane region, and operate exclusively on the currently active pane. In dual-pane desktop mode, it must not be duplicated: changing active pane changes the toolbar's command targets, availability, and disabled states.

## Interaction Design

### Toolbar placement

- Render exactly one toolbar in `FileBrowser`, after the pane-content container and before any global lower application surface.
- Keep the toolbar outside `FileBrowserPane`; neither left nor right pane owns a duplicate toolbar.
- In desktop dual-pane mode, indicate which pane is active using the existing pane-focus treatment. The toolbar always acts on that active pane.
- In compact/mobile mode, the browser remains single-pane, so the same toolbar operates on the visible left pane.
- Keep the per-pane `StatusBar` as informational content only. It remains beneath each list in desktop mode and does not become a command surface.

### Commands

Show common actions directly as icon buttons, with accessible labels and desktop tooltips:

1. Refresh
2. New folder
3. New file
4. Rename
5. Delete

Place contextual or less-frequent actions in an icon-only More menu:

1. Copy to other pane, only in desktop dual-pane mode
2. Move to other pane, only in desktop dual-pane mode
3. Create archive
4. Extract archive

Do not add open, viewer-picker, or native-app commands to the toolbar. Opening remains a direct row action; duplicating those commands would add noise without improving file-management discoverability.

### Availability and feedback

- Commands remain visible when they are relevant to the product but are disabled when unavailable. This makes the operation set discoverable without allowing invalid operations.
- Availability must use the same policy as keyboard shortcuts. The toolbar must not independently infer read-only access, archive immutability, selected-item requirements, transfer destinations, or provider capabilities.
- Disabled commands should expose their reason through an accessible description or tooltip using existing unavailable-operation translations.
- Invoking a command uses the existing handlers and preserves existing dialogs, progress reporting, cancellation, errors, selection semantics, and focus-return behavior.
- Pressing a toolbar command must never allow writes to a read-only connection or archive content.

## Technical Design

### 1. Centralize toolbar action descriptors

Add `frontend/src/pages/FileBrowser/fileOperationActions.ts` as a small, UI-agnostic model for the toolbar.

Define stable action IDs and a descriptor that includes:

- translated label and disabled-reason text
- MUI icon identifier or icon element
- placement tier: `primary` or `more`
- whether it is shown in the current layout mode
- enabled state
- command handler

The descriptor builder receives one action context for the active pane. That context contains the existing pane handlers, page-level copy/move/archive handlers, layout mode, and the availability results calculated by `FileBrowser`.

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

Represent Refresh as available when an active connection exists and no higher-priority operation state blocks it, consistent with its current keyboard behavior.

Create the single action-descriptor array from `effectiveActivePaneId` / `activePane`. When dual-pane focus changes, React recomputes the same toolbar descriptors with the other pane's state and handlers. Do not route button clicks through a stale pane closure.

Continue reusing the existing page-level handlers for copy, move, archive creation, and archive extraction. Continue reusing `useFileBrowserPane` handlers for refresh, creation, rename, and delete.

### 3. Build the presentational toolbar

Add `frontend/src/components/FileBrowser/FileOperationsToolbar.tsx`.

The component accepts precomputed action descriptors and renders:

- an anchored, fixed-height `Box` with a top border
- grouped primary icon buttons
- MUI tooltips on desktop and `aria-label` values everywhere
- clear disabled states without layout shifts
- a More `IconButton` and `Menu` containing only visible overflow actions
- a disabled More control when all overflow actions are unavailable, or hide it when no overflow action is relevant in the current mode

Use existing MUI icon packages already used by the file browser. Reuse `secondaryActionStripSx` colors where appropriate, but add a concise footer-toolbar style in `frontend/src/theme/commonStyles.ts` so the toolbar is visually distinct from the upper connection/view/sort strip and the informational status bar.

The component remains presentational: it receives action labels, availability, handlers, and disabled reasons as props. It does not know about panes, archives, connections, or storage providers.

### 4. Place and wire the single toolbar

In `frontend/src/pages/FileBrowser.tsx`:

1. Create the active-pane operation context after `activePane`, `inactivePane`, and the existing availability helpers are known.
2. Build action descriptors once for that context.
3. Render `FileOperationsToolbar` exactly once after the shared pane-content `Box` and before desktop settings/dialog layers.
4. Keep the toolbar visible in desktop and `useCompactLayout` modes, including empty directories, so Refresh and permitted creation commands remain available.
5. Add responsive safe-area bottom padding for compact layouts so touch targets remain fully reachable.

Do not pass toolbar props into `FileBrowserPane`, and do not move CRUD dialog ownership from the pane hook. The global toolbar calls handlers associated with the active pane; its dialogs may continue to render within their respective `FileBrowserPane` instances.

### 5. Mobile support

The same global component must render on compact layouts:

- use touch-friendly 44px-or-larger icon targets
- preserve icon labels for screen readers and long-press/hover-capable devices
- allow horizontal scrolling only as a last-resort fallback; primary controls should fit in common phone widths through compact spacing and the More menu
- omit Copy and Move because compact mode intentionally has no second pane
- retain creation, Refresh, Rename, Delete, archive creation, and extraction when policy permits

This closes the current keyboard-only gap without changing the intentional single-pane mobile design.

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
- hiding dual-pane-only actions in compact mode
- stable layout behavior when actions are disabled

### Page and interaction tests

Extend `frontend/src/pages/__tests__/FileBrowser-interactions.test.tsx` and the appropriate `FileBrowser` rendering suite to test:

- only one toolbar renders in dual-pane mode
- selecting/focusing the other pane switches handler targets and action availability
- toolbar commands invoke the same handlers as their keyboard shortcuts
- read-only connections and archive locations keep mutations disabled
- no selected item disables Rename/Delete and explains why
- dual-pane-only Copy/Move are absent in compact mode
- empty directories retain Refresh and valid creation commands

The existing `frontend/src/pages/__tests__/FileBrowserPane.test.tsx` should be updated only to confirm that panes do not render an operations toolbar. Its existing status-bar assertions should remain unchanged.

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
   - desktop dual-pane mode, switching active pane before each command
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
- A mobile dual-pane mode.
- Duplicating toolbars inside panes.
- Reworking the existing command palette, context menus, or keyboard shortcut system beyond sharing policy/handlers where needed.
