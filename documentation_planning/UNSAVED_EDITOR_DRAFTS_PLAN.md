# Unsaved Editor Drafts Plan

## Status

Proposed for review.

## Purpose

Make local unsaved Markdown and text-editor drafts visible and understandable
without changing the backend, database, API, or existing `sessionStorage`
draft-recovery model.

This plan addresses the current surprising behavior:

1. A file with a recovered draft opens directly in the editor.
2. The editor initially gives no indication that its content differs from the
   saved SMB file.
3. After a new edit is undone, the dirty indicator can appear inconsistent
   with the recovered content.
4. The file browser gives no indication that a local draft exists.

The scope is intentionally limited to client-side recovery and editor UX. It
does not introduce automatic writes to SMB or durable file history.

## Current Behavior

Draft recovery is implemented in `frontend/src/services/draftRecovery.ts`.
Drafts are scoped to the browser tab, authenticated user, connection, editor
type, and normalized file path. A draft is valid for 24 hours and is stored in
`sessionStorage`.

When a Markdown draft's baseline matches the loaded file content,
`MarkdownViewer` currently enters editing mode automatically. The loaded draft
is already different from the saved file, but the editor session initially
marks itself pristine. The unsaved indicator only appears after another edit.

## Goals

- Open the saved file in viewer mode by default when a local draft exists.
- Make local-draft availability visible in the file browser and viewer.
- Let a user explicitly resume, discard, or inspect their recovered content.
- Make changed content visible inside both source Markdown and plain-text
  editors.
- Ensure that the dirty indicator and changed-line markers reflect the actual
  difference from the saved-file baseline after edits, undo, and redo.
- Make all change indicators accessible without relying on color.
- Remove expired local drafts without requiring users to open each related
  file.

## Non-Goals

- Server-side draft persistence, synchronization, or cross-device recovery.
- Automatic writes to the original SMB file.
- A database-backed revision history or general source-control interface.
- Change markers in Markdown rich-text mode. Source-line markers would be
  unreliable after rich-text transformations, wrapping, and Markdown table
  normalization.
- Displaying one browser tab's local drafts in another tab.

## Proposed Behavior

### Recovery Entry Point

When a valid recovered draft differs from the currently loaded saved file:

- Open the normal viewer and render the saved SMB file.
- Display a persistent recovery notice that identifies the content as a local,
  unsaved draft and includes its saved time.
- Offer three actions:
  - `Resume editing`: acquire the normal edit lock, then open the editor using
    the recovered draft.
  - `Inspect changes`: open the editor in source mode with draft markers
    enabled and without changing the SMB file.
  - `Discard draft`: remove the local draft and dismiss the notice.

The notice must not imply that the recovered draft has been saved to SMB.

If the stored draft has a different baseline from the loaded file, retain the
existing recovery decision rather than auto-resuming it. The message and
controls should identify it as a local draft whose source file changed.

### File Browser Marker

Show a small local-draft marker beside a matching file name in the current tab.
The marker must have a tooltip and an accessible name: `Unsaved local draft
available`.

The marker is per-user and tab-local. It must not expose the presence, content,
or identity of any other user's draft.

The marker appears only when the current draft is valid and differs from its
baseline. It disappears after a successful save, explicit discard, expiry, or
browser-session end.

### Editor Dirty State

On resuming a recovered draft, the editor must immediately show its normal
unsaved indicator because the active content differs from the saved-file
baseline.

Use content equality as the source of truth. The session's "user edited"
tracking may continue to protect editor initialization, but it must not hide
an already recovered difference.

Expected behavior:

1. Resume a recovered draft: the dirty indicator is visible immediately.
2. Type a character: dirty state remains visible and markers update.
3. Undo that character: its marker disappears, but the recovered-draft markers
   and dirty indicator remain while the draft still differs from the saved
   file.
4. Undo or otherwise return exactly to the saved-file baseline: all markers
   and the dirty indicator disappear.
5. Save or discard: clear the draft and all recovery state only after the
   corresponding operation succeeds.

### Accessible Changed-Line Gutter

Add changed-line markers to the source Markdown editor and plain-text editor.
Use one shared, editor-agnostic change model and one rendering adapter per
editor implementation.

The gutter has a stable fixed width and identifies each kind of change with a
symbol as well as color:

| Change | Gutter symbol | Accessible label |
| --- | --- | --- |
| Added line | `+` | Added since saved version |
| Modified line | `~` | Modified since saved version |
| Deleted content | `-` | Content deleted before this line |

A deletion attaches to the nearest following surviving line. For a deletion at
the end of a document, attach it to the final line. Color may reinforce the
marker, but it must never be the only difference.

Expose a concise editor status string, for example `3 additions, 2
modifications, 1 deletion`, so the changed state is available without visually
inspecting the gutter. Use the editor's decoration accessibility support so a
marked line announces its label during keyboard navigation.

### Draft Expiry Cleanup

Keep the existing 24-hour draft lifetime. Add a draft-service cleanup routine
that removes malformed and expired entries for the current user. Run it:

- once after authenticated application initialization;
- when the browser tab becomes visible or regains focus;
- periodically while the tab remains open, at a modest interval such as 15
  minutes; and
- when the user logs out.

Continue removing the individual draft immediately after an explicit discard
or a successful file save. Because the storage is `sessionStorage`, closing
the tab already removes all drafts for that tab.

## Implementation Plan

### 1. Extend the Draft-Recovery Service

In `frontend/src/services/draftRecovery.ts`:

- Add a query that reports whether a valid, non-baseline draft exists for a
  connection, normalized path, and editor type.
- Add a query or subscription-friendly enumeration for matching drafts in the
  current connection.
- Add `purgeExpiredDraftsForCurrentUser()` to scan the current user's draft
  keys and remove expired or invalid entries.
- Emit a narrowly named browser event whenever a draft is created, cleared, or
  purged. Consumers use it only to refresh local indicators; draft content
  never appears in event detail.

Preserve existing key derivation, age validation, maximum-size protection, and
malformed-data cleanup as the single source of truth.

### 2. Run Low-Cost Cleanup

At the authenticated application shell or another existing top-level client
lifecycle boundary:

- call the purge routine after the current user becomes available;
- register `visibilitychange` and `focus` handlers;
- register one interval and clean it up on unmount; and
- clear current-user drafts during logout.

Do not add a server cleanup job: the state is tab-local by design.

### 3. Make Recovery Viewer-First

In both `MarkdownViewer` and `TextViewer`:

- replace automatic `setIsEditing(true)` recovery with recovered-draft state;
- load and show only the saved content in viewer mode;
- add the recovery notice and explicit actions;
- acquire the existing edit lock only when entering editing through Resume or
  Inspect; and
- retain the existing changed-baseline recovery dialog, adapted to make the
  local nature of the content clear.

Keep recovery controls small and inline with the viewer toolbar/content rather
than introducing a new settings surface or persistence mode.

### 4. Add Browser Indicators

Expose local-draft state at the owning file-browser pane and pass a boolean to
`FileRow`. `FileRow` should render the marker alongside the file name without
changing row height or disrupting virtualized layout.

Refresh the affected directory's markers when draft-service events occur. Do
not scan all session storage on every rendered row.

### 5. Share Line-Diff Semantics Between Editors

Add a small frontend utility that accepts baseline and current text and returns
line-level additions, modifications, deletions, and summary counts. Keep it
pure and independently tested.

Use a standard line-diff implementation if the project already has one; if it
does not, add a small, well-maintained dependency rather than hand-rolling a
complex diff algorithm. The dependency decision should be made only when the
implementation is ready, following the repository's dependency-update
workflow if lockfiles or pins would change.

Calculate markers:

- immediately on opening a recovered draft in an editor;
- after source editor changes, undo, and redo with a short debounce (around
  250 ms); and
- on explicit source-mode changes.

Avoid recomputing on unrelated viewer renders. For unusually large files,
reuse the editor's existing file-size safeguards and skip marker calculation
with an accessible status message rather than degrading editing performance.

### 6. Render Per-Editor Gutter Decorations

Implement source-editor adapters that convert the shared change model into
fixed-width CodeMirror gutter/decorations:

- Markdown source mode adapter;
- plain-text adapter.

The adapters own only document-position mapping and accessible decoration
labels. They do not own draft state, equality checks, or diffing behavior.

## Test Plan

### Draft Service

- Valid non-baseline drafts are reported; baseline-equal, malformed, and
  expired drafts are not.
- Purging removes expired/malformed current-user drafts and retains valid
  drafts.
- Save, clear, and purge emit indicator-refresh events without draft content.

### Viewer and Editor Recovery

- A matching recovered Markdown draft opens the saved viewer content and shows
  the local-draft notice.
- Resume opens the recovered content in the editor and immediately shows the
  unsaved indicator.
- Discard removes the draft, notice, browser marker, and recovery state.
- The equivalent text-viewer flow works.
- A draft whose baseline changed follows the conflict/review flow and does not
  overwrite the saved content.

### Dirty-State Regression

- Resuming a recovered draft starts dirty.
- Typing then undoing restores the recovered draft: the newly added line marker
  disappears while the original recovered markers and dirty state remain.
- Returning exactly to the saved baseline removes the indicator and all
  markers.
- Save clears the indicator and markers only after a successful write; save
  failure retains both.

### Accessibility and Browser UI

- Each marker has its `+`, `~`, or `-` semantic symbol and matching accessible
  label.
- Summary status reports change counts.
- Markers remain distinguishable without color styling.
- The file-row marker has the required accessible name and is absent when the
  draft is expired, saved, or discarded.
- File-row layout and virtualization remain stable.

## Rollout and Risk

This is a client-only change with no migration or deployment ordering concern.
The principal risk is marker accuracy around Markdown canonicalization. Limit
markers to source mode, compare canonical source content, and cover table-line
normalization with focused tests before enabling Markdown source markers.

The existing 24-hour, per-tab recovery behavior is retained. The primary
product change is that recovered content becomes explicit and opt-in instead
of silently replacing the saved-file view.
