+++
title = "File Browser and Navigation Model"
+++

The file browser is the densest browser-side product surface in Sambee. It combines navigation, selection, editing entry points, viewer launch, keyboard behavior, and real-time directory refresh.

## Core Component Split

The implementation is deliberately split between shared page logic and per-pane logic.

| Area | Responsibility |
|---|---|
| `pages/FileBrowser.tsx` | owns shared browser-level concerns such as active pane routing, URL sync, WebSocket lifecycle, and global shortcut registration |
| `pages/FileBrowser/useFileBrowserPane.ts` | owns per-pane state such as connection and path, selection, sorting, filtering, dialogs, viewer state, incremental search, and directory refresh handling |
| `pages/FileBrowser/FileBrowserPane.tsx` | renders one pane's UI |
| `components/FileBrowser/CopyMoveDialog.tsx` | manages copy and move confirmation flow |
| `config/keyboardShortcuts.ts` | central shortcut definitions used across the browser |

This split matters because two visible panes still need one coherent browser workflow.

The parent-versus-hook split is intentional:

- `FileBrowser.tsx` owns shared state such as the connections list, active-pane routing, responsive layout, WebSocket connection lifecycle, and browser-level shortcut registration
- `useFileBrowserPane.ts` owns per-pane state such as file loading, sort and filter state, viewer and dialog state, focus handling, multi-select state, and pane-specific directory-change reactions

## Pane Model

Sambee supports one-pane and two-pane browsing, but the two-pane implementation is intentional rather than conditional duplication.

- the left pane is always active in routing terms
- the right pane is still instantiated even when not visible, which keeps the hook model stable
- the active pane decides which pane keyboard shortcuts and toolbar commands target
- dual-pane mode is desktop-first and collapses to single-pane on compact layouts
- dual-pane preference and active-pane preference are persisted so the browser can restore the user's working style
- the viewer opens as a fullscreen overlay from whichever pane launched it rather than being constrained to one pane region

Visual state also matters:

- the active pane gets the stronger emphasis treatment
- the inactive pane is visually de-emphasized rather than treated as a separate route or different screen

## URL-Synced Navigation

The file browser preserves layout state in the URL.

- the primary pane stays in the path
- the right pane is represented by the `p2` query parameter
- active pane state is represented by the `active` query parameter

That design means refresh and back-forward navigation preserve more than a single path string.

Representative shape:

```text
Single pane: /browse/my-server/documents/subfolder
Dual pane:   /browse/my-server/documents?p2=other-server/photos&active=2
```

Important behavior:

- the presence of `p2` on initial load activates dual-pane mode automatically
- back and forward navigation can add or remove the second pane without changing the route definition itself
- single-pane mode produces a clean URL without stale dual-pane query state
- invalid right-pane connection slugs are ignored rather than breaking the whole browser route
- the encoding model preserves slash-separated paths while still percent-encoding the path segments safely

## Keyboard and Command Model

Keyboard behavior is part of the product contract, not just convenience.

- pane switching, selection, copy, and move use centralized shortcut definitions
- the quick bar supports smart navigation, command mode, and pane-local current-directory filtering
- browser defaults that conflict with the product's navigation model are overridden intentionally
- shortcuts are disabled when dialogs or viewer states would make them unsafe

Changes here can easily affect power-user workflows, accessibility, and focus management all at once.

Use [Keyboard Shortcuts and Command Model](../keyboard-shortcuts-and-command-model/) for the central registry, command-palette rules, and quick-bar interaction details. This page focuses on how those rules shape the file-browser architecture.

## Pane-Local Current-Directory Filtering

Current-directory filtering is part of pane state, not just quick-bar UI state.

The important design choice is that the quick bar only supplies the input shell. The actual filter value and filtered list live in `useFileBrowserPane`.

- each pane owns its own `currentDirectoryFilter`
- the pane computes `sortedAndFilteredFiles` from the normal sorted list plus the active filter text
- the filtered list is the same list used by the virtualizer, keyboard navigation, viewer launch, selection helpers, and status bar
- the active filter is considered scoped to the pane's current `connectionId + path`

That arrangement is what makes the behavior consistent in both single-pane and dual-pane workflows.

### Why the Filter Lives in the Pane Hook

The filter is not modeled as a dropdown provider result set.

- smart navigation is a navigation surface that benefits from dropdown results
- command mode is a command surface that benefits from dropdown results
- current-directory filtering is a local transformation of the pane's main file list

Because the pane already owns the rendered list, focus state, virtualizer, and file actions, the filter belongs there as well.

### User-Facing Behavior the Architecture Must Preserve

The implemented flow is:

1. `Ctrl+Alt+F` opens filter mode for the active pane.
2. The shared input shows that pane's current filter value.
3. Typing immediately filters the pane's main file list.
4. `ArrowDown` from the input focuses the filtered file list.
5. Arrow keys, `Home`, `End`, `PageUp`, `PageDown`, `Enter`, and file actions operate on the filtered visible list.
6. Pressing `Ctrl+Alt+F` again returns focus to the same pane's filter input without clearing the term.

Reset and persistence rules are equally important:

- switching between smart navigation, command mode, and filter mode does not clear the active filter
- changing directories clears the filter for the new path scope
- changing the pane connection also clears the filter
- dual-pane mode keeps filter state isolated per pane
- browser recovery snapshots capture and restore the pane filter together with path, focused item, and selection state

### Focus and Zero-Result Behavior

Filtering changes focus semantics because it can remove rows from the visible list.

- if the previously focused file still exists in the filtered list, focus stays on that file
- if it disappears, focus clamps to the nearest valid visible item
- if the filter produces zero visible files, focus remains in the filter input when possible

That is why the pane hook owns both the filtered list and the focus-adjustment logic.

### Status Bar Visibility

The filter must remain visible even when the quick bar is no longer in filter mode.

- the desktop status bar renders the active filter term whenever the pane has a non-empty filter
- the status bar uses the filtered visible list for item counts and file metadata
- this keeps the active filter visible while the user switches to smart navigation or command mode

The status bar indicator is part of the product contract, not just decorative UI. It is the persistent signal that the pane is still filtered.

## Selection, Copy, and Move

The browser maintains explicit multi-select state per pane, but still supports a focused-item fallback when nothing is explicitly selected.

In practice, the pane computes an effective selection from either:

- the explicit selected-file set
- or the focused file when nothing has been explicitly selected

Selection is pane-local and clears naturally when directory navigation changes the active file list.

Copy and move behavior depends on:

- the active pane as the source
- the other pane as the destination in dual-pane workflows
- backend or companion routing depending on which connection types are involved
- conflict and validation behavior that still comes from the destination backend contract

The copy and move dialog is not just a confirmation prompt. It also:

- shows the selected source files
- pre-fills the destination from the other pane
- lets the user adjust the destination before confirming
- reports progress while multiple operations execute

Important contract details:

- `F5` means copy in dual-pane mode, but remains refresh in single-pane mode
- `F6` means move in dual-pane mode
- cross-connection operations are not treated the same as same-share SMB operations
- backend validation still decides whether same-path, self-copy, or conflicting operations are allowed

For same-connection SMB copy and move, the backend uses server-side operations rather than streaming all file bytes through the browser app.

## Refresh and Live State

Directory freshness is coordinated through WebSocket subscriptions.

- the browser subscribes to each visible pane's directory
- directory-change messages are routed back to the matching pane
- local-drive and SMB-backed directories can use different backends while still feeding one browser experience

In dual-pane mode, both panes are live participants in refresh behavior:

- each pane can subscribe to a different directory
- each pane re-subscribes when its own path changes
- directory-change events are dispatched back to the pane that owns the matching path and connection context

This is why navigation and data freshness are coupled more tightly than they first appear.

## Design Constraints and Deliberate Tradeoffs

Some file-browser behaviors are deliberate tradeoffs rather than incidental implementation detail.

- the UI caps visible panes at two even though the query-key pattern could theoretically scale further
- browser-default shortcuts such as tab switching are overridden when they conflict with the product's pane model
- dual-pane mode is disabled on compact layouts instead of forcing a cramped mobile approximation
- one pane can stay hidden while still existing in state so the hook model remains stable

## Why This Page Matters

Frontend changes in the file browser often look local, but they can break:

- URL-restoration behavior
- keyboard and focus contracts
- copy and move flows
- viewer launch behavior
- local-drive versus SMB routing assumptions
- refresh behavior across both panes

## Where to Continue

- Use [Keyboard Shortcuts and Command Model](../keyboard-shortcuts-and-command-model/) for centralized shortcut definitions, command-palette behavior, and focus rules.
- Use [Viewer Architecture and Preview Contracts](../viewer-architecture-and-preview-contracts/) for preview and file-type behavior.
- Use [Browser-to-Companion Trust Model](../../companion-architecture/browser-to-companion-trust-model/) when navigation or actions depend on paired local-drive access.
- Use [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/) when changes cross backend, frontend, and companion boundaries.
