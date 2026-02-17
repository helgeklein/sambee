# Sambee Companion App — Developer Documentation

> **Scope:** Architecture, data flows, APIs, and technical decisions for the Sambee Companion desktop application.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Project Structure](#3-project-structure)
4. [Deep Link & URI Scheme](#4-deep-link--uri-scheme)
5. [Backend API Extensions](#5-backend-api-extensions)
6. [App Enumeration](#6-app-enumeration)
7. [Edit Lifecycle](#7-edit-lifecycle)
8. ["Done Editing" Window](#8-done-editing-window)
9. [Temp File Management](#9-temp-file-management)
10. [File Size Limits](#10-file-size-limits)
11. [Frontend Integration](#11-frontend-integration)
12. [User Preferences](#12-user-preferences)
13. [Auto-Updater](#13-auto-updater)
14. [Build & Distribution](#14-build--distribution)
15. [Security Model](#15-security-model)
16. [SMB File Locking](#16-smb-file-locking)
17. [UX Considerations](#17-ux-considerations)
18. [Technical Decisions & Rationale](#18-technical-decisions--rationale)
19. [Testing Strategy](#19-testing-strategy)
20. [Resolved Design Questions](#20-resolved-design-questions)

---

## 1. Overview

The Sambee Companion is a lightweight desktop application (Tauri v2 + Preact) that enables users to open files stored on SMB shares in native desktop applications (Word, Excel, Photoshop, etc.) directly from the Sambee web interface.

**Core workflow:**

1. User clicks "Open in app…" in the Sambee web UI.
2. The browser opens a `sambee://` deep link containing a short-lived token.
3. The OS launches the companion (or activates it if already running in the system tray).
4. The companion exchanges the URI token for a session JWT, downloads the file to a local temp directory, acquires an edit lock, and opens it in the chosen native app.
5. A "Done Editing" window stays visible. When the user holds the button, the companion uploads changes and releases the lock.

**Key characteristics:**

- ~3–6 MB binary (Tauri v2 uses the system WebView instead of bundling Chromium).
- On-demand only — no autostart, no background service. The OS launches it via the URI scheme handler.
- Single-instance — subsequent `sambee://` URIs are routed to the running instance.
- System tray presence while active editing sessions are open.

---

## 2. Architecture

### 2.1 High-level component diagram

```
┌──────────────┐     sambee://open?...     ┌───────────────────────────────┐
│   Browser    │ ─────────────────────────> │   OS URI Handler              │
│ (Sambee UI)  │                            │ (registered at install time)  │
└──────────────┘                            └──────────┬────────────────────┘
                                                       │
                                                       ▼
                                            ┌───────────────────────────────┐
                                            │  Sambee Companion (Tauri v2)  │
                                            │  ┌─────────┐  ┌───────────┐  │
                                            │  │ Rust    │  │ Preact UI │  │
                                            │  │ backend │  │ (WebView) │  │
                                            │  └────┬────┘  └───────────┘  │
                                            │       │                      │
                                            └───────┼──────────────────────┘
                                                    │
                                         ┌──────────┴──────────┐
                                         ▼                     ▼
                                  ┌─────────────┐   ┌──────────────────┐
                                  │ Sambee API  │   │ Native App       │
                                  │ (FastAPI)   │   │ (Word, GIMP, …)  │
                                  └──────┬──────┘   └──────────────────┘
                                         │
                                         ▼
                                  ┌─────────────┐
                                  │ SMB Share   │
                                  └─────────────┘
```

### 2.2 Communication overview

| From → To              | Protocol / Mechanism                     |
|-------------------------|------------------------------------------|
| Browser → Companion     | `sambee://` URI scheme (OS-mediated)     |
| Companion → Sambee API  | HTTPS (reqwest)                          |
| Companion → Native App  | OS shell open / `open` / `xdg-open`     |
| Sambee API → SMB Share  | SMB (smbprotocol)                        |
| Companion ↔ User        | Tauri WebView (Preact UI) + system tray  |

### 2.3 Backend API endpoints used by the companion

| Endpoint                                         | Method   | Purpose                           |
|--------------------------------------------------|----------|-----------------------------------|
| `POST /api/companion/token`                      | POST     | Exchange URI token for session JWT |
| `GET  /api/companion/{connId}/file-info`         | GET      | File metadata (size, modified)     |
| `GET  /api/viewer/{connId}/download`             | GET      | Download file content              |
| `POST /api/viewer/{connId}/upload`               | POST     | Upload modified file               |
| `POST /api/companion/{connId}/lock`              | POST     | Acquire edit lock                  |
| `POST /api/companion/{connId}/lock/heartbeat`    | POST     | Refresh lock heartbeat             |
| `DELETE /api/companion/{connId}/lock`             | DELETE   | Release edit lock                  |
| `DELETE /api/companion/{connId}/lock/force`       | DELETE   | Force-unlock (admin only)          |
| `GET  /api/viewer/{connId}/lock-status`          | GET      | Check lock status                  |
| `POST /api/companion/uri-token`                  | POST     | Generate short-lived URI token     |

---

## 3. Project Structure

```
companion/
├── package.json               # Preact/Vite frontend dependencies
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/                       # Preact frontend
│   ├── main.tsx               # Entry point, update check scheduling
│   ├── App.tsx                # View router (idle, app-picker, preferences, recovery, large-file)
│   ├── components/
│   │   ├── AppPicker.tsx      # Native app selection UI
│   │   ├── DoneEditingWindow.tsx
│   │   ├── ConflictDialog.tsx
│   │   ├── LargeFileWarning.tsx
│   │   ├── RecoveryDialog.tsx
│   │   └── Preferences.tsx    # User preferences panel
│   ├── stores/
│   │   └── userPreferences.ts # Tauri store wrapper
│   ├── styles/
│   │   ├── app.css
│   │   └── preferences.css
│   └── lib/
│       └── updateCheck.ts     # Auto-update check logic
└── src-tauri/                 # Rust backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json       # Tauri permissions
    ├── icons/
    │   ├── icon.ico
    │   ├── icon.png
    │   ├── 32x32.png
    │   └── 128x128@2x.png
    └── src/
        ├── lib.rs             # Tauri setup, plugin wiring, tray menu
        ├── commands/
        │   ├── open_file.rs   # Download + open + track lifecycle
        │   └── upload.rs      # Upload modified file to server
        ├── app_registry/
        │   ├── mod.rs         # AppInfo trait + platform dispatch
        │   ├── windows.rs     # Windows COM / Registry enumeration
        │   ├── macos.rs       # macOS Core Services (LSCopyApplicationURLsForURL)
        │   └── linux.rs       # Linux XDG mimeapps.list / .desktop files
        ├── uri_parser.rs      # Parse + validate sambee:// URIs
        └── models.rs          # FileOperation, OperationStatus
```

---

## 4. Deep Link & URI Scheme

### 4.1 URI format

```
sambee://open?server=https%3A%2F%2Fsambee.example.com&token=<uri_token>&connId=<uuid>&path=%2Fdocs%2Freport.docx
```

| Parameter | Description                                    |
|-----------|------------------------------------------------|
| `server`  | URL-encoded Sambee server origin               |
| `token`   | Short-lived, single-use JWT (60-second expiry) |
| `connId`  | SMB connection UUID                            |
| `path`    | URL-encoded remote file path                   |

### 4.2 Platform registration

**Windows:** A registry key is created at install time:

```
HKCU\Software\Classes\sambee
  (Default) = "URL:Sambee Companion"
  URL Protocol = ""
  shell\open\command\(Default) = "<install_path>\Sambee Companion.exe" "%1"
```

**macOS:** Declared in `Info.plist` (bundled by Tauri):

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>sambee</string></array>
    <key>CFBundleURLName</key>
    <string>com.sambee.companion</string>
  </dict>
</array>
```

**Linux:** A `.desktop` file in `~/.local/share/applications/`:

```ini
[Desktop Entry]
Name=Sambee Companion
Exec=/opt/sambee-companion/sambee-companion %u
Type=Application
MimeType=x-scheme-handler/sambee;
```

Plus the mime handler registration:

```ini
# ~/.local/share/applications/mimeapps.list
[Default Applications]
x-scheme-handler/sambee=sambee-companion.desktop
```

### 4.3 Tauri plugin wiring

The companion uses two Tauri plugins for URI handling:

- **`tauri-plugin-deep-link`** — registers the `sambee://` scheme and emits deep-link events.
- **`tauri-plugin-single-instance`** — ensures only one companion instance runs; forwards URIs to the existing instance.

```rust
// src-tauri/src/lib.rs (simplified)

tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        // `args` contains the deep-link URI when a second instance is launched
        if let Some(uri) = args.get(1) {
            app.emit("deep-link", uri).ok();
        }
    }))
    .plugin(tauri_plugin_deep_link::init())
    // ... other plugins
    .setup(|app| {
        #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
        {
            use tauri_plugin_deep_link::DeepLinkExt;
            app.deep_link().register("sambee")?;
        }
        Ok(())
    })
```

---

## 5. Backend API Extensions

### 5.1 File upload

```
POST /api/viewer/{connId}/upload?path=/docs/report.docx
Content-Type: multipart/form-data
Authorization: Bearer <companion_jwt>

→ 200 { "status": "ok", "written_bytes": 45231 }
→ 409 { "error": "conflict", "server_modified": "2026-02-09T14:30:00Z" }
```

The endpoint writes the uploaded file to the SMB share at the specified path. It checks `last_modified` to detect conflicts — if the server copy has been modified since the companion's download, a `409 Conflict` is returned.

### 5.2 File info

```
GET /api/companion/{connId}/file-info?path=/docs/report.docx
Authorization: Bearer <companion_jwt>

→ 200 {
    "filename": "report.docx",
    "size_bytes": 45231,
    "last_modified": "2026-02-09T10:00:00Z",
    "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
```

Used by the companion to check file size before download (for the large-file warning) and to store the original `last_modified` timestamp for conflict detection.

### 5.3 Companion token exchange

```
POST /api/companion/token
Content-Type: application/json

{ "uri_token": "<short-lived-jwt>" }

→ 200 { "session_token": "<long-lived-jwt>", "expires_in": 3600 }
→ 401 { "error": "Token expired or already used" }
```

Exchanges the single-use URI token (embedded in the `sambee://` URI) for a session JWT. The URI token is invalidated immediately after use.

### 5.4 URI token generation

```
POST /api/companion/uri-token
Content-Type: application/json
Authorization: Bearer <user_session_token>

{ "connection_id": "abc-123", "path": "/docs/report.docx" }

→ 200 { "uri_token": "<jwt>", "expires_in": 60 }
```

Called by the Sambee web frontend when the user clicks "Open in app…". Returns a 60-second, single-use token scoped to the specific connection and file path.

---

## 6. App Enumeration

### 6.1 Platform-native app discovery

The companion discovers installed applications that can open a given file type using per-OS Rust implementations:

```rust
// app_registry/mod.rs

pub struct AppInfo {
    pub id: String,            // Unique identifier (e.g., "com.microsoft.word")
    pub display_name: String,  // "Microsoft Word"
    pub icon_path: PathBuf,    // Path to app icon for display in picker
    pub exec_path: PathBuf,    // Executable path
}

pub trait AppRegistry {
    fn apps_for_extension(&self, ext: &str) -> Vec<AppInfo>;
    fn default_app(&self, ext: &str) -> Option<AppInfo>;
    fn open_file_with(&self, app: &AppInfo, file_path: &Path) -> Result<()>;
}
```

**Windows:** Queries the Windows Registry (`HKCR\.docx`, `OpenWithProgids`) and COM-based `IApplicationAssociationRegistration` API to enumerate registered handlers.

**macOS:** Uses Core Services `LSCopyApplicationURLsForURL` to get all registered apps for a file type, plus `NSWorkspace.urlForApplication(toOpen:)` for the default.

**Linux:** Parses `~/.local/share/applications/mimeapps.list` and scans `.desktop` files in `$XDG_DATA_DIRS/applications/` for `MimeType=` entries matching the file's MIME type.

### 6.2 Browse fallback

All platforms provide a "Browse…" button (native file dialog via `tauri-plugin-dialog`) as a fallback when the desired app is not found in the registry.

### 6.3 App picker UI

```
┌───────────────────────────────────────────┐
│  Open report.docx with:                   │
│                                           │
│  ● Microsoft Word         (default)       │
│  ○ LibreOffice Writer                     │
│  ○ Google Docs (desktop)                  │
│                                           │
│  ☐ Always use this app for .docx          │
│                                           │
│  [Open]            [Browse…]   [Cancel]   │
└───────────────────────────────────────────┘
```

- The default application is pre-selected.
- "Always use this app for .docx" saves the preference via `tauri-plugin-store`.
- Remembered preferences bypass the picker on subsequent opens.

---

## 7. Edit Lifecycle

### 7.1 Data model

```rust
// models.rs

struct FileOperation {
    id: Uuid,
    server_url: String,
    connection_id: String,
    remote_path: String,
    local_temp_path: PathBuf,
    original_mtime: DateTime<Utc>,    // Server file mtime at download time
    status: OperationStatus,
    opened_with: Option<AppInfo>,
    token: String,                    // Session JWT
    downloaded_at: DateTime<Utc>,
}

enum OperationStatus {
    Downloading,
    Editing,          // File open in native app
    Uploading,
    Completed,
    Discarded,        // User chose "Discard Changes"
    Error(String),
}
```

Each `FileOperation` is persisted as a JSON sidecar (`operation.json`) alongside the temp file to support recovery after crashes.

### 7.2 Full data flow

```
User clicks               Browser generates           OS dispatches to
"Open in app…"  ──>  sambee://open?... URI  ──>  Companion (Tauri)
    │
    ▼
Parse URI, validate server against allowlist
    │
    ▼
Exchange URI token for session JWT
POST /api/companion/token
    │
    ▼
Fetch file metadata
GET /api/companion/{connId}/file-info
    │
    ▼ (if file > threshold)
Show large-file warning dialog
    │
    ▼
Download file to temp dir
GET /api/viewer/{connId}/download
    │
    ▼
Acquire edit lock (Tier 1 + Tier 2)
POST /api/companion/{connId}/lock
    │
    ▼
Show app picker (or use remembered preference)
    │
    ▼
Open file in selected native app
    │
    ▼
Show "Done Editing" window
    │                            ┌─── Background: heartbeat every 30s
    │                            │    POST /lock/heartbeat
    │                            │
    │                            ├─── Background: poll file status every 2s
    │                            │    (unchanged / modified)
    ▼                            │
User holds "Done Editing" ──────┘
    │
    ├── File modified?
    │   ├── Yes → Upload file → Release lock → Recycle temp → Notify
    │   └── No  → Release lock → Recycle temp → Notify
    │
    └── User holds "Discard"?
        └── Release lock → Recycle temp → Notify
```

### 7.3 Sync-back strategy

The sync-back model uses **explicit user action** (the "Done Editing" hold gesture) rather than automatic file-system watching. This avoids complexity around debouncing, atomic saves, and intermediate uploads.

| File status at "Done Editing" | Action                                          |
|-------------------------------|--------------------------------------------------|
| Modified                      | Upload → release lock → recycle temp → notify    |
| Unchanged                     | Release lock → recycle temp → notify             |
| Discarded                     | Release lock → recycle temp → notify             |

### 7.4 Conflict detection

Before uploading a modified file, the companion compares the server's current `last_modified` timestamp against the `original_mtime` stored at download time. If they differ, a conflict dialog is shown:

```
┌──────────────────────────────────────────────────────┐
│  ⚠ File changed on server                            │
│                                                      │
│  "report.docx" was modified on the server            │
│  while you were editing it.                          │
│                                                      │
│  Your version:   Modified locally at 14:30           │
│  Server version: Modified at 14:25 by bob            │
│                                                      │
│  [Overwrite Server]   [Save as Copy]   [Cancel]      │
└──────────────────────────────────────────────────────┘
```

- **Overwrite Server** — force-upload, replacing the server version.
- **Save as Copy** — upload as `report (conflict 2026-02-09).docx`.
- **Cancel** — return to editing; the lock remains held.

---

## 8. "Done Editing" Window

### 8.1 Specification

The "Done Editing" window is a Tauri `WebviewWindow` that stays visible while a file is being edited. It uses a **hold-to-confirm** interaction (1.5 seconds) to prevent accidental clicks from triggering uploads.

**Window properties:**

| Property       | Value                    |
|----------------|--------------------------|
| Size           | 340 × 260 px (fixed)     |
| Resizable      | No                       |
| Always on top  | Yes                      |
| Closable       | No (prevent accidental close) |
| Minimizable    | No                       |

Multiple "Done Editing" windows can be open simultaneously (one per file).

### 8.2 Layout

```
┌──────────────────────────────────────────┐
│  ✎ report.docx                           │
│  Opened in: Microsoft Word               │
│                                          │
│  Status: Modified at 14:30               │
│                                          │
│  [ ✓ Done Editing — Hold to Upload ]     │
│  ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░  │ ← hold progress (1.5s)
│                                          │
│  ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░  │ ← upload progress (bytes)
│                                          │
│         [ Discard Changes — Hold ]       │ ← only when modified
│          ██████░░░░░░░░░░░░░░░░░░░░░░░░  │
└──────────────────────────────────────────┘
```

### 8.3 Button states

**Primary button (always visible):**

| File status | Label                             | Hold action                        |
|-------------|-----------------------------------|------------------------------------|
| Unchanged   | "✓ Done Editing — Hold to Close"  | Release lock → recycle → close     |
| Modified    | "✓ Done Editing — Hold to Upload" | Upload → release lock → recycle → close |

**Secondary button (visible only when file is modified):**

| Label                    | Hold action                         |
|--------------------------|-------------------------------------|
| "Discard Changes — Hold" | Release lock → recycle → close      |

### 8.4 Hold interaction

Both buttons use the same hold-to-confirm logic:

- **Mouse:** `mousedown` starts hold, `mouseup`/`mouseleave` cancels.
- **Keyboard:** `Enter`/`Space` `keydown` starts hold (filtered for `event.repeat`), `keyup`/`Escape` cancels.
- Duration: 1500 ms with animated progress bar.

**Accessibility:** `aria-label="Hold for 1.5 seconds to confirm upload"`. Progress bar uses `role="progressbar"` with `aria-valuenow`/`aria-valuemax`.

### 8.5 Post-hold actions

**File modified — "Done Editing" completed:**

1. Upload file (`POST /api/viewer/{connId}/upload?path=...`) with retry + progress bar.
2. Release edit lock (`DELETE /api/companion/{connId}/lock`).
3. Release SMB-level lock (close held file handle).
4. Close the "Done Editing" window.
5. Transition `OperationStatus` → `Completed`.
6. Desktop notification: _"✓ report.docx — saved to server."_
7. Move temp file to recycle bin.

**File unchanged — "Done Editing" completed:**

1. Release edit lock and SMB-level lock.
2. Close the "Done Editing" window.
3. Transition `OperationStatus` → `Completed`.
4. Desktop notification: _"✓ report.docx — no changes, lock released."_
5. Move temp file to recycle bin.

**"Discard Changes" completed:**

1. Release edit lock and SMB-level lock.
2. Close the "Done Editing" window.
3. Transition `OperationStatus` → `Discarded`.
4. Move temp file to recycle bin.
5. Desktop notification: _"report.docx — changes discarded (recoverable for 7 days)."_

### 8.6 Safety net — heartbeat timeout

If the companion crashes or the user's machine shuts down, the server-side heartbeat timeout (2 minutes, see [§16.4](#164-heartbeat-lifecycle--automatic-lock-release)) automatically releases the lock.

### 8.7 Live file status polling

A Rust background task polls the temp file every 2 seconds and emits `file-status` events to the webview:

```rust
// Emitted to the "Done Editing" webview

type FileStatus =
    | { kind: "unchanged" }
    | { kind: "modified"; modifiedAt: "HH:MM:SS" }
```

The UI updates the status text and conditionally shows/hides the "Discard Changes" button based on these events.

---

## 9. Temp File Management

### 9.1 Directory layout

```
{temp}/sambee-companion/
├── {operation-id}/
│   ├── report-copy.docx         # Working copy
│   └── operation.json           # Persisted FileOperation metadata
└── recycle/
    ├── report-copy-20260209-143022.docx
    └── data-copy-20260208-091500.xlsx
```

### 9.2 Naming conventions

| Original filename  | Temp copy name         |
|--------------------|------------------------|
| `report.docx`     | `report-copy.docx`    |
| `archive.tar.gz`  | `archive-copy.tar.gz` |
| `Makefile`         | `Makefile-copy`        |

The `-copy` suffix makes it clear to the user this is a working copy, not the original.

### 9.3 Security

- Temp directory created with `0700` permissions (user-only read/write) via `tempfile::TempDir`.
- Files are not placed in globally readable locations.

### 9.4 Recycle bin

When an edit session ends (upload or discard), the temp file is **moved** (not deleted) to the recycle bin directory. Files are never silently deleted.

- Filename format: `{stem}-copy-{YYYYMMDD-HHmmss}.{ext}` (timestamp of recycling).
- Files older than **7 days** are automatically deleted (checked on startup and once per hour).
- The recycle bin is the **only** place where automatic deletion occurs.

### 9.5 Startup recovery

On startup, the companion scans `{temp}/sambee-companion/` for leftover temp files from previous sessions (crashed, power loss, force-killed). For each leftover file, a recovery dialog is shown:

```
┌─────────────────────────────────────────────────────────┐
│  ⚠ Unsaved file from a previous session                 │
│                                                         │
│  report-copy.docx                                       │
│  Last modified: 2026-02-09 14:30                        │
│  Server path: /docs/report.docx                         │
│  Server: https://sambee.example.com                     │
│                                                         │
│  [Upload to Server]   [Discard]   [Keep for Later]      │
└─────────────────────────────────────────────────────────┘
```

- **Upload to Server** — re-establishes session (token exchange), uploads, then moves to recycle bin.
- **Discard** — moves to recycle bin immediately.
- **Keep for Later** — leaves in place; dialog reappears on next startup.

The recovery dialog is non-blocking: new `sambee://` URIs are processed normally while recovery dialogs are open.

**Persisted metadata:** Each `FileOperation` is written as `operation.json` alongside the temp file, storing `server_url`, `connection_id`, `remote_path`, `token` (encrypted), `downloaded_at`, and `opened_with_app`.

---

## 10. File Size Limits

Editing files through the companion involves downloading a full copy and uploading modifications back. For very large files, this is slow and error-prone.

**Soft limit: 50 MB (configurable)**

When a file exceeds the threshold, the companion shows a warning **before** downloading:

```
┌────────────────────────────────────────────────────────┐
│  ⚠ Large file                                          │
│                                                        │
│  "database-dump.sql" is 128 MB.                        │
│  Downloading and syncing large files may be slow.      │
│                                                        │
│  [Continue Anyway]                          [Cancel]   │
└────────────────────────────────────────────────────────┘
```

- The user can always proceed (soft limit, not a hard block).
- The threshold is configurable in the Preferences panel (stored via `tauri-plugin-store`, default: 50 MB).
- The `/api/companion/{connId}/file-info` endpoint provides `size_bytes` for this check.

---

## 11. Frontend Integration

### 11.1 URI generation

The Sambee web frontend generates `sambee://` URIs when the user clicks "Open in app…":

```typescript
// frontend/src/services/api.ts

async function getCompanionUri(connectionId: string, path: string): Promise<string> {
    // 1. Request a short-lived URI token from the backend
    const response = await fetch('/api/companion/uri-token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ connection_id: connectionId, path }),
    });
    const { uri_token } = await response.json();

    // 2. Build the sambee:// URI
    const serverUrl = encodeURIComponent(window.location.origin);
    const encodedPath = encodeURIComponent(path);
    return `sambee://open?server=${serverUrl}&token=${uri_token}&connId=${connectionId}&path=${encodedPath}`;
}
```

### 11.2 UI integration points

| Location                        | Action                                              |
|---------------------------------|-----------------------------------------------------|
| `DesktopToolbarActions.tsx`     | "Open in app…" toolbar button (visible when a file is selected) |
| `FileRow.tsx`                   | "Open in app" in right-click context menu           |
| `FileBrowser.tsx`               | `Ctrl+Enter` / `Cmd+Enter` keyboard shortcut        |

### 11.3 Companion detection

The companion exposes a localhost HTTP endpoint for browser-side detection:

```
GET http://localhost:21549/status
→ 200 { "version": "0.1.0", "activeFiles": [...] }
```

**Detection flow:**

1. On page load, the web UI attempts `fetch("http://localhost:21549/status")`.
2. Success → show "Companion connected" indicator, enable per-file editing status.
3. Failure → companion not running. Show "Open in app" buttons anyway (fall through to URI scheme; the OS handles it).

**CORS:** The companion's localhost server includes `Access-Control-Allow-Origin` for the Sambee web origin.

**Note:** Companion detection is a post-MVP enhancement. The MVP always shows the "Open in app" button regardless.

---

## 12. User Preferences

Stored via `tauri-plugin-store` in a persistent JSON file:

```json
{
    "allowedServers": ["https://sambee.example.com"],
    "appPreferences": {
        ".docx": "/usr/bin/libreoffice",
        ".xlsx": "/usr/bin/libreoffice",
        ".psd": "/opt/gimp/bin/gimp"
    },
    "tempFileRetentionDays": 7,
    "uploadConflictAction": "ask",
    "showNotifications": true
}
```

| Setting                  | Type       | Default                | Description                              |
|--------------------------|------------|------------------------|------------------------------------------|
| `allowedServers`         | `string[]` | `[]`                   | Trusted Sambee server URLs               |
| `appPreferences`         | `object`   | `{}`                   | Per-extension app overrides              |
| `tempFileRetentionDays`  | `number`   | `7`                    | Days before recycled files are deleted   |
| `uploadConflictAction`   | `string`   | `"ask"`                | `"ask"` / `"overwrite"` / `"save-copy"` |
| `showNotifications`      | `boolean`  | `true`                 | Desktop notifications enabled            |

The Preferences panel is accessible from the system tray menu.

---

## 13. Auto-Updater

The companion uses `tauri-plugin-updater` with a static JSON endpoint:

```json
// https://sambee.example.com/companion/update.json
{
    "version": "0.2.0",
    "platforms": {
        "windows-x86_64":  { "url": "https://.../companion-0.2.0-x64-setup.nsis.zip", "signature": "..." },
        "windows-aarch64": { "url": "https://.../companion-0.2.0-arm64-setup.nsis.zip", "signature": "..." },
        "linux-x86_64":    { "url": "https://.../companion-0.2.0-amd64.AppImage.tar.gz", "signature": "..." },
        "darwin-aarch64":   { "url": "https://.../companion-0.2.0-aarch64.dmg", "signature": "..." }
    }
}
```

On startup, the companion checks for updates in the background and prompts the user if a newer version is available.

---

## 14. Build & Distribution

### 14.1 Build command

```bash
cd companion && npm run tauri build
```

**Produced artifacts:**

| Platform | Artifact |
|----------|----------|
| Windows x64  | `target/release/bundle/nsis/Sambee Companion_0.1.0_x64-setup.exe` |
| Windows ARM64 | `target/release/bundle/nsis/Sambee Companion_0.1.0_arm64-setup.exe` |
| macOS    | `target/release/bundle/dmg/Sambee Companion_0.1.0_aarch64.dmg` |
| Linux    | `target/release/bundle/deb/sambee-companion_0.1.0_amd64.deb` |
| Linux    | `target/release/bundle/appimage/sambee-companion_0.1.0_amd64.AppImage` |

### 14.2 Release profile optimizations

```toml
# companion/src-tauri/Cargo.toml
[profile.release]
strip = true          # Strip debug symbols
lto = true            # Link-time optimization
codegen-units = 1     # Single codegen unit for better optimization
opt-level = "s"       # Optimize for binary size
panic = "abort"       # No unwind tables
```

Expected binary size: **3–6 MB** (depending on platform and features).

### 14.3 CI/CD pipeline

A GitHub Actions workflow (`build-companion.yml`) builds the companion for all supported targets:

| Target            | Runner           |
|-------------------|------------------|
| Linux x86_64      | `ubuntu-latest`  |
| macOS ARM64       | `macos-latest`   |
| Windows x86_64    | `windows-latest` |
| Windows ARM64     | `windows-latest` |

The workflow runs on pushes to `main` and on tags matching `companion-v*`.

---

## 15. Security Model

### 15.1 URI token flow

The `sambee://` URI is visible in browser history and potentially in logs. Mitigations:

1. **Short-lived token:** The `uri_token` expires in **60 seconds** and is **single-use**.
2. **Immediate exchange:** The companion exchanges the URI token for a session JWT via `POST /api/companion/token`. The URI token is invalidated after first use.
3. **Scoped claims:** The URI token's JWT claims contain the specific `connection_id` and `path`, preventing reuse for other files.
4. **Session JWT:** The exchanged session JWT is stored only in memory (or Tauri secure store). It has a 1-hour TTL scoped to companion operations only.

### 15.2 Server allowlist

On first use of a new server, the companion shows a trust dialog:

```
┌───────────────────────────────────────────────────────────┐
│  Trust this Sambee server?                                │
│                                                           │
│  https://sambee.example.com                               │
│                                                           │
│  This server wants to open files using Sambee Companion.  │
│  Only trust servers you recognize.                        │
│                                                           │
│  ☐ Always trust this server                               │
│                                                           │
│  [Trust Once]    [Always Trust]    [Deny]                 │
└───────────────────────────────────────────────────────────┘
```

Trusted servers are persisted in the user preferences store.

### 15.3 Temp file security

- Temp directory created with `0700` permissions (user-only).
- Files are never placed in globally readable locations.
- Cleanup runs on app shutdown and periodically for stale files.

### 15.4 Input validation

- URI parser validates all parameters against expected patterns.
- `server` must use `https://` (or `http://localhost` for dev).
- `path` is validated to prevent path traversal (`..`).
- Token format is validated before any network request.

---

## 16. SMB File Locking

### 16.1 Purpose

When a user opens a file via the companion, the file is locked on the SMB share so other users cannot make conflicting edits. Other users can still **read** (view) the file.

### 16.2 SMB protocol mechanisms

The `smbprotocol` library supports three locking mechanisms:

**Mechanism A: Share access control (used)**

`smbclient.open_file()` accepts a `share_access` parameter:

| `share_access` | Others can read | Others can write | Others can delete |
|-----------------|-----------------|------------------|-------------------|
| `None`          | No              | No               | No                |
| `"r"`           | Yes             | No               | No                |
| `"rw"`          | Yes             | Yes              | No                |
| `"rwd"`         | Yes             | Yes              | Yes               |

For edit locking, the file is opened with `share_access="r"` and the handle is kept open for the duration of the edit.

**Mechanism B: Byte-range locks (available but not primary)**

The `Open.lock()` method sends SMB2 LOCK requests for fine-grained byte-range locking. Available as an additional enforcement mechanism.

**Mechanism C: Opportunistic locks (not used)**

Oplocks are server-managed caching directives automatically broken by the server when another client needs access. Not suitable for persistent application-level locking.

### 16.3 Two-tier locking architecture

Both tiers are acquired simultaneously and released together.

#### Tier 1: Application-level lock (user-visible)

A lock table in the Sambee database:

```python
class EditLock:
    file_path: str           # "/docs/report.docx"
    connection_id: str       # UUID of the SMB connection
    locked_by: str           # Username
    locked_at: datetime      # When the lock was acquired
    companion_session: str   # Companion session ID (for cleanup)
    last_heartbeat: datetime # Updated every heartbeat cycle
```

> **No fixed expiry.** Files may be open for hours or days. Locks survive as long as the companion heartbeats.

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/companion/{connId}/lock?path=...` | POST | Acquire lock |
| `/api/companion/{connId}/lock/heartbeat?path=...` | POST | Refresh heartbeat |
| `/api/companion/{connId}/lock?path=...` | DELETE | Release lock |
| `/api/companion/{connId}/lock/force?path=...` | DELETE | Force-unlock (admin + lock holder only) |
| `/api/viewer/{connId}/lock-status?path=...` | GET | Check lock status |

**Advantages:** User-visible lock status in the web UI, heartbeat-based auto-cleanup, force-unlock escape hatch.

**Limitation:** Direct SMB clients (e.g., Windows Explorer) bypass this tier — which is why Tier 2 exists.

#### Tier 2: SMB-level lock (protocol enforcement)

1. When acquiring an edit lock, the backend opens the file with `share_access="r"` and holds the handle.
2. Any other SMB client attempting to write gets `STATUS_SHARING_VIOLATION` (0xc0000043).
3. The lock is released by closing the file handle.

**Operational considerations:**

| Challenge | Mitigation |
|-----------|------------|
| Long-lived SMB handles | Heartbeat mechanism; periodic `SMB2 ECHO` keeps connection alive |
| Backend restart loses handles | On startup, re-acquire SMB handles from the lock table |
| SMB connection timeout | `SMB2 ECHO` every 60 seconds |
| Connection pool interaction | Edit-locked handles excluded from pool cleanup |
| Memory/resource usage | One handle per locked file (manageable for typical usage) |

### 16.4 Heartbeat lifecycle & automatic lock release

```
Companion                                  Sambee Backend
   │                                            │
   │ POST /lock (acquire)                       │
   │───────────────────────────────────────────>│  → Tier 1: create EditLock row
   │                                            │  → Tier 2: open SMB handle (share_access="r")
   │ ← 200 OK                                  │
   │<───────────────────────────────────────────│
   │                                            │
   │ ... every 30 seconds ...                   │
   │ POST /lock/heartbeat                       │
   │───────────────────────────────────────────>│  → update last_heartbeat
   │ ← 200 OK                                  │
   │<───────────────────────────────────────────│
   │                                            │
   │ ... user clicks "Done Editing" ...         │
   │ Final upload if file changed               │
   │ DELETE /lock (release)                     │
   │───────────────────────────────────────────>│  → Tier 1: delete EditLock row
   │                                            │  → Tier 2: close SMB handle
   │ ← 200 OK                                  │
   │<───────────────────────────────────────────│
```

**Heartbeat timeout:** A backend background task runs every 30 seconds. If `now - last_heartbeat > 2 minutes`, the lock is orphaned:

1. Delete the `EditLock` row (Tier 1).
2. Close the SMB file handle (Tier 2).
3. Log: _"Lock on /docs/report.docx released — companion session abc123 stopped heartbeating."_

This handles all failure modes: companion crash, network disconnect, machine sleep/shutdown.

### 16.5 Force-unlock from the web UI

When a file is locked, the file browser shows:

```
📄 report.docx    📝 Being edited by alice (since 10:30 AM)    [Force Unlock]
```

**Force-unlock flow:**

1. User clicks **"Force Unlock"** → confirmation dialog.
2. Backend releases both Tier 1 and Tier 2 locks.
3. If the companion is still alive, the next heartbeat returns `404`. The companion notifies: _"⚠ Your edit lock on report.docx was released by another user. Save your work locally."_
4. The companion keeps the local temp file and offers to re-upload.

**Permissions:** Only **admin users** and the **lock holder** can force-unlock.

### 16.6 Impact on existing code

| File | Change required |
|------|-----------------|
| `backend/app/storage/smb.py` | New `lock_file_for_edit()` / `unlock_file_for_edit()` methods (open with `share_access="r"`, hold handle) |
| `backend/app/storage/smb.py` | Improve `STATUS_SHARING_VIOLATION` error message to include lock holder info |
| `backend/app/storage/smb_pool.py` | Exclude edit-locked handles from pool cleanup |

---

## 17. UX Considerations

### 17.1 First-run experience

When the companion is not installed and "Open in app" is clicked:

1. The OS shows a "no handler" message for the `sambee://` URI.
2. The Sambee web app shows a banner: _"Install Sambee Companion to open files in native apps. [Download for Windows/macOS/Linux]"_

### 17.2 Happy path

1. User right-clicks file → "Open in LibreOffice" (or "Open in app…").
2. If companion not running: OS launches it (~1 sec), file downloads and opens.
3. If companion in tray: near-instant file download + open.
4. User edits and saves locally. When done, holds "Done Editing" in the companion window.
5. Companion uploads and shows notification: _"✓ report.docx saved to server."_

### 17.3 System tray menu

```
┌─────────────────────────────────────────┐
│  Sambee Companion                       │
│  ─────────────────────────────────────  │
│  Active files:                          │
│    📄 report.docx (editing in Word)     │
│    📊 data.xlsx (uploading… 45%)        │
│  ─────────────────────────────────────  │
│  Preferences…                           │
│  Check for updates                      │
│  ─────────────────────────────────────  │
│  Quit                                   │
└─────────────────────────────────────────┘
```

### 17.4 Error states

| Error                        | User sees                                                  |
|------------------------------|------------------------------------------------------------|
| Server unreachable           | Notification: "Cannot reach server. Will retry."           |
| Token expired                | Notification: "Session expired. Please open the file again from the browser." |
| Upload failed (network)      | Notification: "Upload failed. Retrying… (attempt 2/3)"     |
| Upload conflict              | Conflict dialog (see [§7.4](#74-conflict-detection))       |
| Native app not found         | App picker dialog with "Browse" option                     |
| Companion not installed      | Web app shows download banner                              |
| Lock force-released          | Notification: "⚠ Your lock on report.docx was released by another user." |
| File locked by another user  | Web app shows lock holder info + "Force Unlock" button     |

---

## 18. Technical Decisions & Rationale

| Decision                      | Choice            | Rationale                                                                    |
|-------------------------------|-------------------|------------------------------------------------------------------------------|
| Framework                     | Tauri v2          | ~3–6 MB binary, uses system WebView, Rust backend, rich plugin ecosystem     |
| ~~Electron~~                  | Rejected          | ~150–200 MB (bundles Chromium), overkill for a background helper app         |
| ~~Go CLI~~                    | Rejected          | No native UI without extra libraries; manual protocol registration           |
| UI framework                  | Preact            | 3 KB gzip, React-compatible API (team already uses React), familiar JSX/hooks |
| ~~File system watcher~~       | Removed           | Adds complexity (debouncing, atomic saves); single upload on "Done Editing" is simpler and sufficient |
| HTTP client                   | `reqwest`         | Async, multipart upload, TLS built-in                                        |
| App enumeration               | Per-OS Rust       | Must call platform-native APIs; no cross-platform abstraction exists         |
| Token in URI                  | Short-lived JWT   | Avoids storing secrets in URI; exchanged immediately for session token        |
| Launch mode                   | On-demand only    | OS launches via URI scheme handler; no autostart, no background service      |
| Editor close detection        | "Done Editing" window | No production software reliably detects arbitrary editor closes. Explicit user action is the only universal approach. |
| ~~Process monitoring~~        | Rejected          | `sysinfo` process scan + OS file-lock detection are fragile heuristics       |
| Temp file naming              | `-copy` suffix    | Makes clear the file is a working copy; avoids confusion with the original   |
| File size limit               | Soft 50 MB        | Warns user but doesn't block; threshold configurable                         |
| Accidental-click prevention   | Hold-to-confirm   | 1.5s press-and-hold with progress bar; works for mouse and keyboard          |
| Temp file lifecycle           | Recycle bin (7 days) | Files never deleted — moved to recycle bin with timestamp; protects against data loss |
| Startup recovery              | Leftover scan + dialog | Scan orphaned temp files on launch; prompt to upload, discard, or keep       |

---

## 19. Testing Strategy

### 19.1 Backend tests

- Unit tests for endpoints: `upload`, `file-info`, `companion/token`, `companion/uri-token`.
- Integration tests with mock SMB backend.
- Token lifecycle tests: generation, single-use enforcement, expiration.

### 19.2 Companion Rust tests

- Unit tests for URI parser (valid/invalid URIs, edge cases).
- Unit tests for app registry (mock registry data for each platform).
- Upload/download tests with mock HTTP server.
- Change detection tests (modified vs. unmodified file).

### 19.3 Companion UI tests

- Component tests for AppPicker, ConflictDialog, Preferences.
- E2E test: simulate deep-link → download → open → modify → upload cycle.

### 19.4 Frontend tests

- Unit tests for `getCompanionUri()` (correct encoding, token embedding).
- Component tests for "Open in app" button visibility and behavior.

### 19.5 Cross-platform testing

- CI builds for Windows (x86_64, aarch64), macOS (aarch64), Linux (x86_64).
- Manual testing checklist for deep-link registration on each OS.
- Test both cold-start and warm (tray) scenarios.

---

## 20. Resolved Design Questions

### 20.1 UI framework → Preact

| Framework  | Size (gzip) | Benchmark¹ | API Style            | Key trait                          |
|------------|-------------|------------|----------------------|------------------------------------|
| Solid.js   | ~7 KB       | 1.08×      | JSX + reactive       | Fastest; no virtual DOM            |
| **Preact** | **~3 KB**   | 1.43×      | **React-compatible** | **Smallest; `preact/compat` for React ecosystem** |
| Lit        | ~5 KB       | —          | Template literals    | Web Components standard            |

_¹ js-framework-benchmark weighted geometric mean vs vanilla JS (1.00×)._

Preact is the smallest bundle (3 KB gzip), has a React-compatible API matching the team's existing skills, and the performance gap vs Solid.js is irrelevant for dialogs that render once and wait for user input.

### 20.2 Localhost status endpoint → Post-MVP

The companion exposes `http://localhost:21549/status` for browser-side detection. This is a post-MVP enhancement — core functionality does not depend on it.

### 20.3 Multiple simultaneous servers → Supported passively

The architecture supports multiple servers (each `FileOperation` carries its own `server_url`). No special work is needed — the preferences UI has a "Trusted Servers" list for managing allowlisted servers.

### 20.4 Mobile companion → Not planned

The edit-and-sync-back workflow does not apply to mobile. Tauri v2 supports iOS/Android technically, but the use case is weak.

### 20.5 WebDAV alternative → Not pursued

The companion provides a better UX (seamless download → edit → upload) without requiring network mount configuration. WebDAV introduces auth and caching complexities the companion avoids.

### 20.6 Version coupling → Independent versioning

The companion is versioned independently from the Sambee backend/frontend. A compatibility check endpoint exists:

```
GET /api/companion/version-check?companion_version=0.1.0
→ 200 { "compatible": true, "min_companion_version": "0.1.0", "latest_version": "0.2.0" }
```

The companion checks this on startup and prompts for updates if incompatible.
