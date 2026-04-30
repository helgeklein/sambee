+++
title = "File Browser And Navigation Model"
description = "Understand how the file browser manages pane state, URL synchronization, keyboard workflows, copy and move behavior, and directory refresh."
+++

The file browser is the densest browser-side product surface in Sambee. It combines navigation, selection, editing entry points, viewer launch, keyboard behavior, and real-time directory refresh.

## Core Component Split

The implementation is deliberately split between shared page logic and per-pane logic.

| Area | Responsibility |
|---|---|
| `pages/FileBrowser.tsx` | owns shared browser-level concerns such as active pane routing, URL sync, WebSocket lifecycle, and global shortcut registration |
| `pages/FileBrowser/useFileBrowserPane.ts` | owns per-pane state such as path, selection, sorting, dialogs, viewer state, and incremental search |
| `pages/FileBrowser/FileBrowserPane.tsx` | renders one pane's UI |
| `components/FileBrowser/CopyMoveDialog.tsx` | manages copy and move confirmation flow |
| `config/keyboardShortcuts.ts` | central shortcut definitions used across the browser |

This split matters because two visible panes still need one coherent browser workflow.

## Pane Model

Sambee supports one-pane and two-pane browsing, but the two-pane implementation is intentional rather than conditional duplication.

- the left pane is always active in routing terms
- the right pane is still instantiated even when not visible, which keeps the hook model stable
- the active pane decides which pane keyboard shortcuts and toolbar commands target
- dual-pane mode is desktop-first and collapses to single-pane on compact layouts

## URL-Synced Navigation

The file browser preserves layout state in the URL.

- the primary pane stays in the path
- the right pane is represented by the `p2` query parameter
- active pane state is represented by the `active` query parameter

That design means refresh and back-forward navigation preserve more than a single path string.

## Keyboard And Command Model

Keyboard behavior is part of the product contract, not just convenience.

- pane switching, selection, copy, and move use centralized shortcut definitions
- the quick bar supports both navigation and command mode
- browser defaults that conflict with the product's navigation model are overridden intentionally
- shortcuts are disabled when dialogs or viewer states would make them unsafe

Changes here can easily affect power-user workflows, accessibility, and focus management all at once.

## Selection, Copy, And Move

The browser maintains explicit multi-select state per pane, but still supports a focused-item fallback when nothing is explicitly selected.

Copy and move behavior depends on:

- the active pane as the source
- the other pane as the destination in dual-pane workflows
- backend or companion routing depending on which connection types are involved
- conflict and validation behavior that still comes from the destination backend contract

## Refresh And Live State

Directory freshness is coordinated through WebSocket subscriptions.

- the browser subscribes to each visible pane's directory
- directory-change messages are routed back to the matching pane
- local-drive and SMB-backed directories can use different backends while still feeding one browser experience

This is why navigation and data freshness are coupled more tightly than they first appear.

## Why This Page Matters

Frontend changes in the file browser often look local, but they can break:

- URL-restoration behavior
- keyboard and focus contracts
- copy and move flows
- viewer launch behavior
- local-drive versus SMB routing assumptions
- refresh behavior across both panes

## Where To Continue

- Use [Viewer Architecture And Preview Contracts](../viewer-architecture-and-preview-contracts/) for preview and file-type behavior.
- Use [Browser-To-Companion Trust Model](../../companion-architecture/browser-to-companion-trust-model/) when navigation or actions depend on paired local-drive access.
- Use [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/) when changes cross backend, frontend, and companion boundaries.
