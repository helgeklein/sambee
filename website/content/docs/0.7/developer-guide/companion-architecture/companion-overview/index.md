+++
title = "Companion Overview"
description = "Understand the Sambee Companion desktop app, its two main responsibilities, and the trust boundaries it introduces."
+++

Sambee Companion is a lightweight desktop application built with Tauri v2, a Preact UI, and a Rust backend.

It exists for two major reasons:

- to enable native-app editing of files that originate in Sambee workflows
- to provide a paired localhost API for local-drive access and browser-to-desktop integrations

## The Two Main Capability Paths

### Deep-Link Native-App Editing

For SMB-backed edit workflows:

1. The browser starts the action.
2. The OS launches or activates the companion through a `sambee://` deep link.
3. The companion exchanges tokens, downloads the file, acquires an edit lock, and opens the file in a native app.
4. The companion later uploads the result and releases the lock.

### Paired Localhost API

For local-drive access and related desktop-side capabilities:

1. The browser detects the companion on `127.0.0.1:21549`.
2. Browser and companion perform an explicit pairing flow.
3. The browser uses the authenticated localhost API to enumerate drives and perform local file operations.
4. WebSocket notifications keep the browser updated when local directories change.

For the full desktop-side data path, continue to [Local-Drive And Save-Back Pipeline](../local-drive-and-save-back-pipeline/).

## Why This Is A Separate App

The companion handles behavior the browser cannot safely or reliably do by itself.

- launching installed native apps
- accessing local drives on the user's computer
- holding desktop-side state and recovery information
- participating in OS-level integration such as deep-link registration and tray behavior

## Main Code Areas

| Path | Responsibility |
|---|---|
| `companion/src/` | Preact UI, preferences, pairing windows, and desktop-facing interaction surfaces |
| `companion/src-tauri/src/` | Rust backend for deep links, local API, file operations, logging, and integration with the OS |
| `companion/src-tauri/src/server/` | localhost pairing, auth, drive enumeration, handlers, and watcher behavior |
| `companion/src-tauri/src/commands/` | command handlers for file opening, upload, pairing, update, and related actions |

## Trust And Safety Boundaries

The companion adds power, so it also adds security-sensitive behavior.

- deep-link flows depend on short-lived tokens and server-side lock behavior
- localhost API access is intentionally paired and authenticated
- the app is single-instance so later deep links are routed to the running process
- desktop-local behavior should not silently bypass the browser or backend contracts it depends on

## What Usually Breaks When This Layer Changes

- native-app editing lifecycle behavior
- lock release or upload expectations after editing
- browser pairing and local-drive discovery
- localization sync or other browser-to-desktop coordination
- platform-specific startup, packaging, or tray behavior

## Go Deeper

- [Browser-To-Companion Trust Model](../browser-to-companion-trust-model/): deep links, pairing, localhost auth, and trust boundaries
- [Local-Drive And Save-Back Pipeline](../local-drive-and-save-back-pipeline/): how local-drive operations and SMB-backed native-app editing differ in practice

## Validation Expectations

When companion behavior changes, start with:

```bash
cd companion && npx tsc --noEmit
cd companion && npm run lint
cd companion/src-tauri && cargo test
```

Then add frontend or backend checks if the companion change alters a shared workflow contract.
