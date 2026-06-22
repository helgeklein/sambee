# File Opening and Picker Flexibility Plan

## Purpose

This document defines the implementation plan for making file opening behavior more flexible and explicit across both the browser UI and native workflows.

This is a pre-implementation planning document. It is intended to be reviewed before any code changes are made.

## Requested Behavior

### Browser actions

- `Enter`
  - Open the selected file in the associated Sambee viewer.
  - If no viewer is associated yet, show an in-browser viewer picker.
  - If no Sambee viewer exists for the file type, provide a choice of:
    - all Sambee viewers
    - native editing

- `Shift+Enter`
  - Always show the in-browser viewer picker for the selected file.

### Native actions

- `Ctrl+Enter`
  - Open the selected file in the associated native app.
  - If no app has been selected by the user yet, show the native app picker.

- `Ctrl+Alt+Enter`
  - Native editing.
  - Always show the native app picker.

## Current State

### Browser open flow

Current browser file opening is controlled in:

- [frontend/src/pages/FileBrowser/useFileBrowserPane.ts](../frontend/src/pages/FileBrowser/useFileBrowserPane.ts)
- [frontend/src/pages/FileBrowser.tsx](../frontend/src/pages/FileBrowser.tsx)
- [frontend/src/config/browserCommands.ts](../frontend/src/config/browserCommands.ts)
- [frontend/src/config/keyboardShortcuts.ts](../frontend/src/config/keyboardShortcuts.ts)

Current behavior:

- `Enter` opens a directory or attempts to open a built-in Sambee viewer for a file.
- If the file type has no viewer support, the current flow logs that no viewer exists and does not open anything.
- There is no browser-side viewer association model.
- There is no browser-side viewer picker.

### Viewer support model

Viewer support is currently capability-based and mostly single-viewer-per-type:

- [frontend/src/utils/FileTypeRegistry.ts](../frontend/src/utils/FileTypeRegistry.ts)
- [frontend/src/components/FileBrowser/DynamicViewer.tsx](../frontend/src/components/FileBrowser/DynamicViewer.tsx)

Current behavior:

- A MIME type either resolves to one built-in viewer or it does not.
- Unsupported behavior is handled as a fallback dialog or silent non-open path.
- The model is not designed for user-driven viewer selection.

### Native app flow

Current native opening is controlled in:

- [frontend/src/pages/FileBrowser/useFileBrowserPane.ts](../frontend/src/pages/FileBrowser/useFileBrowserPane.ts)
- [frontend/src/services/api.ts](../frontend/src/services/api.ts)
- [companion/src-tauri/src/commands/open_file.rs](../companion/src-tauri/src/commands/open_file.rs)
- [companion/src-tauri/src/lib.rs](../companion/src-tauri/src/lib.rs)
- [companion/src-tauri/src/server/handlers.rs](../companion/src-tauri/src/server/handlers.rs)
- [companion/src/stores/appPreferences.ts](../companion/src/stores/appPreferences.ts)
- [companion/src/components/AppPicker.tsx](../companion/src/components/AppPicker.tsx)

Current behavior:

- Native opening already has a persisted app preference model in the companion.
- The companion picker UI can preselect a preferred app.
- The native flow currently still shows the picker every time.
- There is no distinction yet between auto-open-with-associated-app and always-show-picker modes.

## Design Goals

- Make all four open actions explicit and discoverable.
- Make all four open actions available from both keyboard shortcuts and the expanded right-click/tap menu.
- Introduce browser-side viewer associations without forcing global settings work first.
- Keep native opening behavior consistent across SMB and local-drive workflows.
- Avoid duplicating open-policy logic in multiple places.
- Keep unsupported viewer behavior as a post-selection runtime state, not the primary `Enter` experience.
- Preserve clean boundaries between:
  - browser viewer choice
  - native app choice
  - file-type capability lookup
  - actual open/edit execution

## Design Decisions

### 1. Introduce explicit open modes

Use explicit open modes instead of inferring behavior from keyboard modifiers deep inside handlers.

Recommended browser-side open modes:

- `associated-viewer`
- `force-viewer-picker`
- `associated-native-app`
- `force-native-picker`

This should become the common abstraction for:

- keyboard shortcuts
- command palette actions
- expanded right-click/tap menu actions
- row-level actions
- future toolbar actions

### 2. Browser viewer associations are stored per user in the backend

Sambee browser viewer associations should be stored in the backend as per-user settings.

Companion native app associations should continue to be stored by the Companion itself.

Reasoning:

- Browser viewer choices are part of the Sambee user experience and should follow the user across browsers and devices.
- Native app preferences are machine-specific and should remain local to the Companion installation on that machine.
- This storage split matches the real scope of the preferences:
  - Sambee viewer choice is user-level product behavior
  - native app choice is device-level operating system integration behavior

### 3. Browser viewer associations should be MIME-first with extension fallback

When resolving a stored associated Sambee viewer:

- prefer MIME type if available and specific
- fall back to extension when MIME is generic or missing

Reasoning:

- MIME better reflects actual content handling.
- Some file listings may still surface incomplete MIME metadata.

### 4. “All Sambee viewers” are explicit override choices

If no compatible Sambee viewer exists for a file type, the viewer picker shown from `Enter` must offer:

- all Sambee viewers
- native editing

These “all Sambee viewers” entries should be treated as explicit override actions.

Recommended initial rule:

- compatible viewers may be associated for the file type
- incompatible override viewers should not be auto-associated by default unless the user explicitly chooses to persist them

This avoids accidentally binding obviously wrong viewers as the default for unrelated file types.

### 5. Native picker policy belongs to the companion-side open logic

The decision to:

- open directly with a preferred app
- or force the picker

must live in shared companion-side logic, not in the frontend and not in the picker UI itself.

Reasoning:

- SMB and local-drive native flows already converge in the companion.
- This is the correct place to enforce consistent behavior.
- The current app preference store already exists there.

### 6. The in-browser picker should mirror the native app picker

The in-browser viewer picker should follow the same interaction model as the native app picker instead of introducing a more elaborate custom decision tree.

Recommended behavior:

- show a single chooser dialog
- preselect the associated viewer when one exists
- allow the user to pick another viewer
- support an "always use" style persistence option for compatible viewer associations
- include a clear fallback action for native editing when no suitable Sambee viewer is chosen

Reasoning:

- The native picker already defines the right level of complexity for a chooser workflow.
- Reusing the same UX pattern reduces implementation risk and review complexity.
- Users benefit from one recognizable picker model for both browser and native opening flows.

## Proposed Architecture Changes

## Workstream 1: Browser open-mode abstraction

### Objective

Introduce a single browser-side abstraction for file open behavior.

### Changes

Add a new open mode concept to the file browser pane hook and command wiring.

Likely files:

- [frontend/src/pages/FileBrowser/useFileBrowserPane.ts](../frontend/src/pages/FileBrowser/useFileBrowserPane.ts)
- [frontend/src/pages/FileBrowser/types.ts](../frontend/src/pages/FileBrowser/types.ts)
- [frontend/src/pages/FileBrowser.tsx](../frontend/src/pages/FileBrowser.tsx)
- [frontend/src/config/browserCommands.ts](../frontend/src/config/browserCommands.ts)
- [frontend/src/config/keyboardShortcuts.ts](../frontend/src/config/keyboardShortcuts.ts)

### Deliverables

- New mode-aware browser open handlers.
- Distinct command actions for:
  - `Enter`
  - `Shift+Enter`
  - `Ctrl+Enter`
  - `Ctrl+Alt+Enter`
- Matching expanded right-click/tap menu actions for all four open modes.
- No modifier-specific policy hidden inside generic handlers.

### Review points

- Command naming is clear.
- Command palette and help text can surface all four actions.
- Existing row/context actions can reuse the same abstraction.
- The expanded right-click/tap menu can expose all four actions without ambiguous labeling.

## Workstream 2: Browser viewer preference store

### Objective

Create a backend-backed per-user persistence model for Sambee viewer associations.

### Changes

Add a dedicated backend-backed viewer preference model plus a frontend client wrapper.

Recommended placement:

- frontend client wrapper in `frontend/src/pages/FileBrowser/viewerPreferences.ts`
- backend API and persistence in the existing user settings domain

Recommended API:

- `getPreferredViewer(fileDescriptor)`
- `setPreferredViewer(fileDescriptor, viewerId)`
- `clearPreferredViewer(fileDescriptor)`
- `listPreferredViewers()` if future preferences UI needs it

The persisted key model should support:

- MIME-based associations
- extension fallback
- future migration if richer viewer metadata is introduced later

### Deliverables

- Stable backend-backed per-user viewer preference schema.
- Tests for preference resolution and fallback behavior.

### Review points

- Backend schema and API shape are future-safe.
- MIME/extension precedence is well-defined.
- Invalid or stale viewer IDs fail safely.

## Workstream 3: Evolve file-type registry to viewer options

### Objective

Turn the viewer registry from a mostly singular capability lookup into a plural viewer-option model.

### Changes

Refactor:

- [frontend/src/utils/FileTypeRegistry.ts](../frontend/src/utils/FileTypeRegistry.ts)

Add concepts such as:

- compatible viewer options for a file
- all globally available Sambee viewers
- recommended viewer option
- whether native editing should be offered as a fallback action

Possible descriptor shape:

- `viewerId`
- `label`
- `description`
- `isCompatible`
- `isRecommended`
- `componentLoader`

### Deliverables

New registry helpers, for example:

- `getCompatibleViewerOptions(file)`
- `getAllViewerOptions()`
- `hasCompatibleViewerSupport(file)`
- `resolveViewerOption(viewerId)`

### Review points

- The registry remains easy to maintain.
- Existing image/PDF/Markdown support is preserved.
- DynamicViewer remains usable after the refactor.

## Workstream 4: Browser viewer picker UI

### Objective

Introduce an in-browser viewer picker that supports both compatible selection and fallback selection.

### Changes

Add a new picker component, likely near the existing viewer UI layer.

Suggested new files:

- `frontend/src/components/FileBrowser/ViewerPickerDialog.tsx`
- `frontend/src/components/FileBrowser/__tests__/ViewerPickerDialog.test.tsx`

The picker should be modeled closely after the native app picker.

The picker should support these states:

### State A: compatible viewers exist

Show:

- compatible Sambee viewers
- recommended/default indication
- optional “always use this viewer for this file type” control
- optional native editing action

### State B: no compatible viewer exists

Show:

- all Sambee viewers as explicit overrides
- native editing

This state replaces the current unsupported-first `Enter` path.

The layout should still remain a single simple chooser, analogous to the native app picker, rather than a separate complex multi-mode decision UI.

### State C: chosen viewer fails at load/runtime

If a selected viewer cannot load, fall back to the existing unsupported/failed dialog pattern from:

- [frontend/src/components/FileBrowser/DynamicViewer.tsx](../frontend/src/components/FileBrowser/DynamicViewer.tsx)

### Deliverables

- Picker dialog modeled after the native app picker, with compatibility-aware and fallback-aware options.
- Explicit return value based on selected viewer or native-edit fallback.
- Keyboard-friendly interaction model.

### Review points

- The browser picker feels structurally similar to the native app picker.
- The “all Sambee viewers” fallback is clearly presented as an override.
- Native editing is clearly distinguishable from viewer selection.
- The dialog copy is understandable when no compatible viewer exists.

## Workstream 5: Refactor `Enter` and `Shift+Enter`

### Objective

Move browser file opening to the new associated-viewer and force-picker behavior.

### Changes

Refactor the file branch of:

- [frontend/src/pages/FileBrowser/useFileBrowserPane.ts](../frontend/src/pages/FileBrowser/useFileBrowserPane.ts)

Target behavior:

- `Enter`
  - if directory: keep current directory navigation behavior
  - if file:
    - resolve associated viewer
    - if associated viewer exists and is valid, open it
    - otherwise show viewer picker
    - if no compatible viewer exists, show the fallback picker with:
      - all Sambee viewers
      - native editing

- `Shift+Enter`
  - if file: always show viewer picker

### Deliverables

- `handleOpenFile` becomes mode-aware.
- A second browser-side entry point exists for force-picker behavior.
- The current “file will not open” branch is removed from the normal `Enter` path.

### Review points

- No regression for directory navigation.
- Image gallery behavior still works when image viewer is selected.
- Existing viewer session ID and `viewInfo` behavior remain stable.

## Workstream 6: Native-open mode plumbing in the frontend

### Objective

Let the frontend express both native-open policies:

- use associated app when possible
- always show picker

### Changes

Refactor native opening in:

- [frontend/src/pages/FileBrowser/useFileBrowserPane.ts](../frontend/src/pages/FileBrowser/useFileBrowserPane.ts)
- [frontend/src/pages/FileBrowser/types.ts](../frontend/src/pages/FileBrowser/types.ts)
- [frontend/src/services/api.ts](../frontend/src/services/api.ts)

Introduce a mode-aware native open request, for example:

- `pickerMode: "auto" | "always"`

For local drives, this request must reach the companion HTTP route.

For SMB native editing, this mode must be carried into the Sambee deep link or companion bootstrap lifecycle.

### Deliverables

- `Ctrl+Enter` and `Ctrl+Alt+Enter` map to different native policies.
- Row/context actions can reuse the same native open abstraction.
- The expanded right-click/tap menu can trigger the same native open modes as the keyboard shortcuts.

### Review points

- No duplicated branching between SMB and local-drive paths.
- The mode is encoded in a stable, explicit way.
- Keyboard and menu-triggered native actions use the same open-mode plumbing.

## Workstream 7: Companion-side native app resolution policy

### Objective

Teach the companion to either:

- open directly with the preferred native app
- or show the app picker

based on explicit picker policy.

### Changes

Refactor companion shared picker logic in:

- [companion/src-tauri/src/commands/open_file.rs](../companion/src-tauri/src/commands/open_file.rs)
- [companion/src-tauri/src/lib.rs](../companion/src-tauri/src/lib.rs)
- [companion/src-tauri/src/server/handlers.rs](../companion/src-tauri/src/server/handlers.rs)
- [companion/src/stores/appPreferences.ts](../companion/src/stores/appPreferences.ts)
- possibly [companion/src/components/AppPicker.tsx](../companion/src/components/AppPicker.tsx)

Introduce a shared native app resolution flow such as:

- `resolve_native_open(mode, extension)`

Behavior:

- `mode = auto`
  - if preferred app exists for extension, open directly
  - otherwise show picker

- `mode = always`
  - always show picker

This must apply consistently to:

- SMB native editing
- local-drive native opening

### Deliverables

- One shared companion-side resolution policy.
- No behavioral drift between SMB and local-drive flows.

### Review points

- Existing app preference persistence remains intact.
- “Always use this app” remains functional.
- Picker bypass occurs only in `auto` mode.

## Workstream 8: UX copy and shortcut discoverability

### Objective

Make the new four-action behavior discoverable and understandable.

### Changes

Update user-facing copy in:

- [frontend/src/i18n/resources.ts](../frontend/src/i18n/resources.ts)
- keyboard shortcut help surfaces
- command descriptions
- picker dialog labels
- native/browse fallback wording

Need new labels for:

- open with associated viewer
- choose browser viewer
- open with associated native app
- choose native app
- native editing
- no compatible Sambee viewer available
- open with another Sambee viewer
- right-click/tap menu labels for all four opening modes

### Deliverables

- Updated keyboard shortcut help.
- Updated command labels and descriptions.
- Clear picker copy for compatible and fallback states.
- Clear expanded right-click/tap menu labels for all four opening modes.

### Review points

- “Native editing” wording is used consistently.
- Browser viewer versus native app wording is unambiguous.
- Menu wording is concise enough to fit desktop context menus and touch action sheets.

## Workstream 9: Validation and test coverage

### Frontend tests

Update or add tests in areas such as:

- [frontend/src/pages/__tests__/useFileBrowserPane.test.tsx](../frontend/src/pages/__tests__/useFileBrowserPane.test.tsx)
- [frontend/src/pages/__tests__/FileBrowser-interactions.test.tsx](../frontend/src/pages/__tests__/FileBrowser-interactions.test.tsx)
- [frontend/src/components/FileBrowser/__tests__/DynamicViewer.test.tsx](../frontend/src/components/FileBrowser/__tests__/DynamicViewer.test.tsx)
- new picker tests
- registry tests
- viewer preference store tests

Required coverage:

- `Enter` opens associated viewer when present
- `Enter` opens viewer picker when no viewer association exists
- `Enter` shows fallback choices when no compatible Sambee viewer exists
- `Shift+Enter` always shows viewer picker
- selecting a viewer opens the right viewer
- selecting native editing from the browser picker reaches native open flow
- invalid stored viewer preference fails safely

### Companion tests

Update or add tests in:

- [companion/src/components/__tests__/AppPicker.test.tsx](../companion/src/components/__tests__/AppPicker.test.tsx)
- [companion/src-tauri/src/commands/open_file.rs](../companion/src-tauri/src/commands/open_file.rs)
- local-drive and SMB native open path tests

Required coverage:

- `Ctrl+Enter` skips picker when a preferred native app exists
- `Ctrl+Enter` shows picker when no preferred app exists
- `Ctrl+Alt+Enter` always shows picker
- both local-drive and SMB paths honor the same policy

### Validation commands

Expected validation after implementation:

- frontend targeted Vitest suites for file browser interactions and picker behavior
- frontend type check and lint
- companion Rust tests
- companion clippy and format check

## Suggested Implementation Order

### Phase 1

- add browser open-mode abstraction
- add keyboard/command wiring for all four actions
- add expanded right-click/tap menu wiring for all four actions
- add browser viewer preference store

### Phase 2

- refactor file type registry into viewer-option model
- add browser viewer picker dialog

### Phase 3

- implement `Enter` and `Shift+Enter`
- remove unsupported-first `Enter` behavior

### Phase 4

- add native mode plumbing from frontend to companion
- make local-drive and SMB requests carry picker policy

### Phase 5

- implement companion-side native app resolution
- make `Ctrl+Enter` and `Ctrl+Alt+Enter` diverge correctly

### Phase 6

- update copy/help text
- complete targeted tests and validation

## Risks and Edge Cases

### Viewer override misuse

Allowing “all Sambee viewers” when no compatible viewer exists may cause the user to open a file in a viewer that cannot meaningfully render it.

Mitigation:

- Proper error handling and messaging to the user in each viewer

### Stale viewer associations

A stored viewer ID may become invalid after refactors.

Mitigation:

- ignore missing viewer IDs
- reopen the picker instead of hard failing

### MIME inconsistency

Some files may have generic MIME types.

Mitigation:

- use MIME-first with extension fallback
- centralize file descriptor normalization

### Native-mode divergence between SMB and local drives

This is the biggest regression risk.

Mitigation:

- keep policy in one companion-side resolution flow
- use explicit mode values instead of implicit behavior

### In-browser picker scope

The browser picker should not become a complex custom flow.

Mitigation:

- model it directly after the native app picker
- keep it as a single chooser dialog
- reuse the same interaction ideas: preselection, explicit selection, and optional persistence
- keep labels and empty states direct

## Review Checklist

Before implementation starts, confirm the following:

- The four requested shortcuts and behaviors are correct as written.
- All four opening modes should also be exposed from the expanded right-click/tap menu.
- Browser viewer preferences should be stored in backend per-user settings for the first iteration.
- “All Sambee viewers” should be available as fallback choices when no compatible viewer exists.
- Native editing should be offered from the browser picker fallback state.
- Incompatible fallback viewers should not automatically become associated defaults unless explicitly persisted.
- `Ctrl+Enter` should skip the native picker when a preferred app exists.
- `Ctrl+Alt+Enter` should always show the native picker.
- The in-browser picker should be implemented as the browser analogue of the native app picker, not as a more complex custom workflow.
- No extra settings UI is required in this implementation phase beyond the pickers themselves.

## Non-Goals for This Plan

These are intentionally out of scope unless review changes the plan:

- changing companion native associations from companion-local storage to backend-managed storage
- creating a full settings page for browser viewer associations
- redesigning the underlying built-in viewers
- adding new viewer implementations beyond those already present
- changing the existing native edit upload/lock lifecycle semantics

## Expected Output of the Review Step

After review, implementation can proceed workstream-by-workstream using this document as the source of truth.
