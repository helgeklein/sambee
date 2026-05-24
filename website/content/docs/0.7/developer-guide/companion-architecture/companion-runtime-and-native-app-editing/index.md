+++
title = "Companion Runtime and Native-App Editing"
+++

This page covers the companion runtime that sits between the browser's deep-link request and the desktop user's native editing session.

Use it when a change affects:

- deep-link handling and single-instance behavior
- app selection and native-app launching
- operation persistence, recovery, and temp-file lifecycle
- tray, app-picker, large-file, and "Done Editing" window behavior

For localhost pairing and local-drive behavior, continue to [Browser-to-Companion Trust Model](../browser-to-companion-trust-model/) and [Local-Drive and Save-Back Pipeline](../local-drive-and-save-back-pipeline/).

## Runtime Modes and UI Surfaces

The companion is not a traditional always-visible desktop app.

In normal use it shifts between a few runtime modes:

- tray-oriented background state when no editing dialog is open
- a reused main window for app picker, preferences, large-file confirmation, and recovery dialogs
- a dedicated pairing window for browser-to-companion approval
- one "Done Editing" window per active native-app edit session

That split is deliberate. The companion should stay lightweight when idle, but it still needs focused UI surfaces for edit coordination and pairing approval.

## Main Code Areas

| Path | Responsibility |
|---|---|
| `companion/src/App.tsx` | frontend view routing for idle, app picker, preferences, recovery, and large-file flows |
| `companion/src/components/` | desktop-facing UI surfaces such as `AppPicker`, `DoneEditingWindow`, `RecoveryDialog`, and `Preferences` |
| `companion/src/stores/` | persisted frontend preferences for app selection and companion settings |
| `companion/src-tauri/src/lib.rs` | Tauri setup, plugin wiring, deep-link handling, window management, tray behavior, and lifecycle orchestration |
| `companion/src-tauri/src/commands/` | commands for file info, download, upload, app selection, pairing, localization, and updates |
| `companion/src-tauri/src/app_registry/` | platform-specific native-app discovery and launch integration |
| `companion/src-tauri/src/sync/` | operation persistence, temp-file handling, recycle retention, and recovery helpers |
| `companion/src-tauri/src/token/` and `uri/` | URI parsing and token exchange for deep-link editing |

## Deep-Link Ingress

Native-app editing starts from a `sambee://open?...` URI.

The runtime pieces involved are:

- `tauri-plugin-deep-link` for receiving the URI
- `tauri-plugin-single-instance` so later URIs are forwarded to the running instance instead of launching competing copies
- `uri/mod.rs` for parsing required parameters such as `server`, `token`, `connId`, and `path`
- `token/mod.rs` for exchanging the short-lived URI token for a companion session JWT

The deep link can also carry theme data so the companion UI matches the browser-side theme during the editing flow.

## Reverse-Proxy Authentication Path

Native editing supports reverse proxies and SSO layers that require interactive browser authentication before backend API requests are allowed through.

The implemented flow is:

1. Companion tries the normal URI-token exchange.
2. If token exchange is intercepted by a login redirect or HTML sign-in page, the companion opens a dedicated `Sambee Authentication` webview.
3. The user signs in through that embedded webview.
4. Companion reads backend-origin cookies from that same webview and seeds its shared Rust `reqwest` cookie jar.
5. Token exchange and the rest of the native-edit lifecycle reuse that authenticated client state.

This matters for the trust model:

- Browser-to-companion localhost pairing remains separate from reverse-proxy authentication.
- The Sambee bearer token remains separate from reverse-proxy cookies.
- External browser cookies are not read or imported.
- Reverse-proxy cookies stay inside the companion-owned webview and Rust HTTP client state.
- Cookie values must not be logged.

Companion automatically retries idempotent backend calls such as file-info lookup, lock acquisition, download, lock release, and heartbeats after reauthentication. Non-idempotent uploads are not replayed automatically; the runtime instead asks the user to retry the action after authentication has been refreshed.

## Native-App Edit Lifecycle

The implemented lifecycle in `lib.rs` is intentionally explicit.

At a high level it is:

1. parse the deep link
2. exchange the URI token for a companion session token
3. fetch file metadata for file-size checks and conflict baseline
4. optionally pause for a large-file confirmation dialog
5. acquire the backend edit lock
6. download the file into the companion temp area
7. create a `FileOperation`, persist its sidecar, and add it to the in-memory store
8. show the app picker and wait for user selection
9. open the local file in the selected native application
10. spawn a dedicated "Done Editing" window
11. start background heartbeat and file-status polling

Two rules matter here:

- the backend lock is acquired before the edit session is allowed to proceed
- the companion records local operation state before handing control to the native app

Those decisions are what make recovery and conflict handling possible after crashes or interrupted sessions.

## App Selection and Native Launching

The companion keeps platform-specific native-app discovery behind `app_registry/`.

That layer is responsible for:

- listing handlers for a file extension
- surfacing the default app first when possible
- returning enough information for the UI to distinguish executable paths and handler identifiers
- launching the chosen app or falling back to system-default open behavior when appropriate

The app picker flow is coordinated through Tauri events.

- the Rust runtime emits `show-app-picker`
- the frontend displays `AppPicker`
- the user response is sent back through `respond_app_selection`

Stored per-extension app preferences live in `appPreferences.ts`, which is how repeated opens can bypass unnecessary picker friction.

On Windows, the launch path is more subtle than a simple `CreateProcess` call because packaged handlers and opaque shell associations may need Windows shell invocation rather than direct executable launching.

## Operation Model, Temp Files, and Recovery

Deep-link editing is tracked through `FileOperation` in `sync/operations.rs`.

Each operation records:

- server URL, connection, and remote path
- local temp-file path
- companion session token
- current status
- original modification time
- chosen app name
- lock information and server-side last-modified baseline

The companion keeps this state in two places:

- an in-memory `OperationStore` for active runtime coordination
- a sidecar on disk so the session can be recovered after a restart or crash

That persistence model supports the recovery flow shown through `RecoveryDialog` when leftover operations are discovered at startup.

The temp-file lifecycle is also intentionally not just "download and delete":

- active sessions live in a managed temp area
- completed or discarded files move through recycle and retention logic
- retention duration is user-configurable through preferences

## "Done Editing" and Explicit Save-Back

The companion does not try to infer when a user is "probably done" in their native editor.

Instead it keeps a dedicated "Done Editing" window open while:

- file status polling checks whether the local temp file changed
- heartbeat requests keep the backend edit lock alive

When the user explicitly finishes or discards the session, the companion can:

- upload the modified file
- release the backend lock
- recycle the temp copy
- update the tray and operation state

That explicit-confirmation model is one of the core product decisions behind native-app editing, not a UI accident.

## Conflict and Recovery Handling

The companion keeps enough state to detect overwrite-sensitive conflicts.

Before completing an upload-sensitive flow, it compares the current server-side state with the baseline captured earlier in the edit session. If those diverge, the conflict dialog path is used instead of silently overwriting the server copy.

This is also why recovery state is more than a cosmetic convenience feature. It protects the editing workflow from leaving users with stranded temp files and unclear lock state after interruption.

## Preferences, Pairing UI, and Update Checks

The reused main window also hosts companion preferences.

Current public settings include:

- upload conflict behavior
- auto-start at sign-in
- desktop notifications
- update channel selection
- temp-file retention period
- paired-origin management

The update path itself is channel-aware and lives in `commands/update.rs`, but detailed release-feed and packaging workflow belongs with companion distribution and update documentation rather than this runtime page.

The pairing window is a separate UI surface because browser-to-companion approval is part of the trust boundary, not just another generic settings dialog.

## What Usually Breaks When This Layer Changes

- deep links reach the app, but the running instance does not receive forwarded URIs correctly
- lock acquisition or release gets out of sync with the visible edit lifecycle
- picker cancellation or launch failure leaves behind stale temp files or sidecars
- operation recovery loses enough metadata that interrupted edits become hard to resolve safely
- tray and window state drift apart from the actual set of active operations

## Where to Continue

- Use [Browser-to-Companion Trust Model](../browser-to-companion-trust-model/) for pairing, localhost auth, deep-link trust boundaries, and origin scoping.
- Use [Local-Drive and Save-Back Pipeline](../local-drive-and-save-back-pipeline/) for the difference between local-drive access and SMB-backed save-back.
- Use [Companion Release Overview](../../release-and-versioning/companion-release-overview/) when the change affects packaged releases or updater rollout rather than runtime behavior.

## Validation Expectations

When this runtime changes, usually run:

```bash
cd companion && npx tsc --noEmit
cd companion && npm run lint
cd companion/src-tauri && cargo test
cd frontend && npx tsc --noEmit
cd backend && pytest -v
```

The frontend and backend checks matter whenever the companion change alters a shared workflow contract.
