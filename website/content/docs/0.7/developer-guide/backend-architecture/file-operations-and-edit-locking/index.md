+++
title = "File Operations And Edit Locking"
description = "Understand how ordinary file operations differ from companion-assisted SMB editing, and why lock and conflict handling belong to the backend."
+++

Not every file operation in Sambee follows the same lifecycle.

## Two Different Operation Families

### Ordinary File Operations

These are the browser-facing operations such as:

- browse and inspect
- create and rename
- copy and move
- upload and download
- delete

These requests usually enter through the browser-facing API and are executed through the backend storage layer.

### Companion-Assisted SMB Editing

This is the higher-risk path used when a user opens an SMB-backed file in a native desktop app.

That flow adds:

- token exchange
- file download to a temp location
- backend-managed edit locking
- lock heartbeat and lock-status checks
- upload or discard decision at the end of editing
- conflict handling before the server copy is replaced

## Ordinary File Operations

The browser file-management path depends on typed request models and clear storage semantics.

- copy and move requests use structured request data instead of ad hoc parameters
- same-path or invalid operations are rejected explicitly
- server-side copy and move semantics depend on the backend's storage capabilities
- conflict responses and validation errors are part of the user-visible contract

The backend should stay authoritative here, even when the frontend tries to make the operation feel immediate.

## Why Edit Locking Exists

Native-app editing of SMB-backed files is a coordination problem, not just a download-and-upload shortcut.

The backend owns the server-facing lock lifecycle so that:

- concurrent edits are visible and controllable
- the companion can refresh the lock while editing is still in progress
- stale or interrupted sessions can be detected
- conflict decisions happen against the real server state

## High-Level Companion Edit Lifecycle

For the SMB-backed desktop editing path:

1. the companion exchanges the deep-link token for an authenticated session
2. it fetches file metadata and downloads the file
3. it acquires the edit lock from the backend
4. it keeps the lock alive with heartbeat traffic while the file is open
5. it uploads the changed file or discards it
6. it releases the lock and closes out the operation

The backend is the source of truth for lock state even though the companion is the actor performing the desktop-side work.

## Conflict Handling

Before a modified file is written back, the system compares the expected server state with the current one.

If the server copy changed while the user was editing, the companion should not silently overwrite it. That is why conflict handling is part of the backend contract rather than just a local desktop decision.

## Important Distinction: Local Drives

Local-drive workflows do not use this backend edit-lock lifecycle.

- local files are handled through the paired localhost companion API
- direct local open can avoid download, lock, upload, and "Done Editing" entirely
- SMB-backed native-app editing still depends on backend lock and upload semantics

Do not blur those two paths when changing edit behavior.

## Adjacent Concern: Freshness After Operations

After file operations complete, the browser still needs fresh directory state. That is where change notification and WebSocket refresh behavior become relevant.

Ordinary CRUD operations and companion-assisted edit completion both depend on the rest of the system noticing that directory state has changed.

## Validation Expectations

When this area changes, usually run:

```bash
cd backend && pytest -v
cd backend && mypy app
cd frontend && npm test
cd companion/src-tauri && cargo test
```

Choose the exact subset based on whether the change affects ordinary browser file management, companion editing, or both.
