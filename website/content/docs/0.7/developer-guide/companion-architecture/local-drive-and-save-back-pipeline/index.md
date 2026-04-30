+++
title = "Local-Drive And Save-Back Pipeline"
description = "Understand how the companion handles local-drive access, how SMB-backed native-app editing flows back to the server, and why those two paths are related but not interchangeable."
+++

The companion supports two different desktop-side data paths.

- paired local-drive access through the localhost API
- SMB-backed native-app editing with temp files, locks, and explicit save-back

They are related because the same desktop app participates in both, but they do not share the same trust or data lifecycle.

## Local-Drive Access Pipeline

For local drives, the browser stays in control and the companion behaves like a desktop-local backend.

1. the browser detects the companion through the localhost health endpoint
2. browser and companion pair explicitly
3. the browser requests available drives
4. the browser routes local-drive browse, file, and file-management requests to the companion instead of the server backend
5. a companion-side watcher and WebSocket channel keep local directory state fresh

This is why local drives can appear inside the same UI as SMB shares while still using a different execution path.

## Local-Drive Operation Rules

- the companion mirrors the backend API contract closely so the frontend can stay mostly connection-type agnostic
- local-drive operations use desktop filesystem primitives, not SMB semantics
- local files opened directly through the companion can skip download, lock, upload, and the "Done Editing" flow entirely

That direct local-open path is intentionally different from SMB-backed native-app editing.

## SMB-Backed Native-App Save-Back Pipeline

For SMB-backed native-app editing, the companion is not the source of truth. It is the desktop-side coordinator for a backend-governed editing lifecycle.

1. the browser launches a `sambee://` deep link
2. the companion exchanges the URI token for an authenticated session
3. it fetches metadata and downloads the file to a temp directory
4. it acquires the backend edit lock
5. it opens the file in the chosen native application
6. a "Done Editing" window stays open while heartbeat and file-status checks continue in the background
7. on explicit user confirmation, the companion uploads the file or discards it
8. the backend lock is released and the temp file is recycled

## Why Save-Back Uses Explicit Confirmation

The save-back model uses explicit user action rather than automatic filesystem watching.

That avoids a harder class of problems around:

- partial writes and atomic-save behavior
- repeated intermediate uploads
- uncertainty about when editing is truly finished

The hold-to-confirm interaction is therefore a product decision, not just a UI quirk.

## Conflict And Recovery Behavior

The companion keeps operation state because desktop editing can outlive one clean process lifecycle.

- operation state is persisted alongside temp files for recovery
- server state is checked before overwrite-sensitive upload completes
- when server state changed during editing, the user must resolve the conflict rather than silently replacing the file

## Critical Distinction Contributors Must Preserve

- local-drive workflows do not use backend SMB edit locks
- SMB-backed native-app editing does use backend lock, heartbeat, and upload semantics
- cross-backend transfers between SMB and local storage are their own browser-mediated flow, not a shortcut through the deep-link edit lifecycle

If you blur these paths, you usually break either security assumptions or data-integrity guarantees.

## Where The Main Logic Lives

| Path | Responsibility |
|---|---|
| `companion/src-tauri/src/server/` | localhost API, drive enumeration, auth, pairing, and watcher behavior |
| `companion/src-tauri/src/commands/open_file.rs` | download and native-app open lifecycle |
| `companion/src-tauri/src/commands/upload.rs` | upload, lock, and heartbeat support |
| `companion/src-tauri/src/sync/operations.rs` | operation state and recovery tracking |
| `frontend/src/services/backendRouter.ts` | routes browser requests to backend or companion based on connection type |

## Validation Expectations

When this pipeline changes, usually run:

```bash
cd companion && npx tsc --noEmit
cd companion && npm run lint
cd companion/src-tauri && cargo test
cd frontend && npm test
cd frontend && npx tsc --noEmit
cd backend && pytest -v
```

The backend checks matter whenever the change touches SMB-backed save-back, lock, heartbeat, or upload behavior.
