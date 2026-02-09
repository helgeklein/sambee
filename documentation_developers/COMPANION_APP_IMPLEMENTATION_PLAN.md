# Sambee Companion App — Implementation Plan

> **Status:** Planning
> **Created:** 2026-02-09
> **Framework:** Tauri v2 (Rust + TypeScript)
> **Target platforms:** Windows, macOS, Linux

---

## Table of Contents

1. [Answer: Does the Companion App Need to Be Running?](#1-answer-does-the-companion-app-need-to-be-running)
2. [Architecture Overview](#2-architecture-overview)
3. [Data Flow](#3-data-flow)
4. [Project Structure](#4-project-structure)
5. [Phase 1 — Backend API Extensions](#5-phase-1--backend-api-extensions)
6. [Phase 2 — Tauri App Skeleton](#6-phase-2--tauri-app-skeleton)
7. [Phase 3 — App Enumeration (Native App Picker)](#7-phase-3--app-enumeration-native-app-picker)
8. [Phase 4 — Edit Lifecycle & Sync-Back](#8-phase-4--edit-lifecycle--sync-back)
9. [Phase 5 — Frontend Integration](#9-phase-5--frontend-integration)
10. [Phase 6 — Polish & Distribution](#10-phase-6--polish--distribution)
11. [Security Model](#11-security-model)
12. [UX Considerations](#12-ux-considerations)
13. [Technical Decisions & Rationale](#13-technical-decisions--rationale)
14. [Testing Strategy](#14-testing-strategy)
15. [Resolved Questions](#15-resolved-questions)
16. [SMB File Locking During Edit](#16-smb-file-locking-during-edit)

---

## 1. Answer: Does the Companion App Need to Be Running?

**No.** The companion app does **not** need to already be running. The OS launches it on demand when the user clicks a `sambee://` URI in the browser — exactly like clicking a `mailto:` link opens the mail client.

### How the OS launches the companion on demand

Each operating system has a built-in mechanism to map URI schemes (like `sambee://`) to an installed application. The Tauri deep-link plugin registers the `sambee://` scheme during installation. After that, every click on a `sambee://` URI triggers the OS to launch the companion automatically.

**Windows:**

1. The Tauri installer writes a registry key: `HKEY_CLASSES_ROOT\sambee\shell\open\command` → path to the `.exe`.
2. When the browser navigates to `sambee://open?...`, Windows reads this registry key and launches the executable with the full URI as a command-line argument.
3. If the companion is already running, the **single-instance plugin** detects the second launch, forwards the URI to the existing process, and the new process exits immediately.

**macOS:**

1. The app bundle's `Info.plist` declares `CFBundleURLTypes` with scheme `sambee`.
2. macOS indexes this at install time (and on app updates). When the user clicks a `sambee://` link, macOS launches the app (or brings it to the foreground if running) and delivers the URL via an Apple Event.
3. Tauri's deep-link plugin receives the Apple Event and routes it to the app's URI handler.

**Linux:**

1. The installer creates a `.desktop` file with `MimeType=x-scheme-handler/sambee` in `/usr/share/applications/` and runs `update-desktop-database`.
2. When the user clicks a `sambee://` link, the browser calls `xdg-open sambee://...`. `xdg-open` resolves the scheme handler and executes the `Exec` line from the `.desktop` file.
3. If the companion is already running, the single-instance plugin forwards the URI.

### Tauri-specific behavior

- **Deep-link plugin** registers the `sambee://` scheme during installation (macOS) or at runtime (Linux, Windows dev mode).
- **Single-instance plugin** (with `deep-link` feature): if the app is already running, the URI is forwarded to the running instance instead of spawning a new process. This means only one companion process ever exists.
- If the app is **not running**, the OS cold-starts it. Tauri cold start takes roughly **0.5–2 seconds** depending on hardware.

### UX implications

| Scenario               | Latency   | Notes                                       |
|------------------------|-----------|---------------------------------------------|
| App not running (cold) | ~1–2 sec  | OS launches app, then processes URI          |
| App already running    | ~instant  | Single-instance forwards URI to running app  |

After the first URI click launches the companion, it stays running in the system tray for the remainder of the session (showing active edit operations, see §12.3). Subsequent "Open in app" clicks are near-instant because the URI is forwarded to the already-running instance.

**Conclusion:** The companion is purely on-demand. No autostart, no background service, no login item. The OS handles launching — just like any other registered URI scheme handler.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         User's Browser                           │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Sambee Web App (React/TypeScript)                          │ │
│  │                                                             │ │
│  │  File Browser → "Open in App…" →  sambee://open?...         │ │
│  └───────────────────────────┬─────────────────────────────────┘ │
└──────────────────────────────┼───────────────────────────────────┘
                               │  (1) URI scheme click
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Operating System                              │
│  Resolves sambee:// → launches or forwards to companion app      │
└──────────────────────────────┬───────────────────────────────────┘
                               │  (2) Launch / forward URI
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│               Sambee Companion App (Tauri v2)                    │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  URI Parser  │→│ App Picker   │→│  File Lifecycle Mgr     │  │
│  │             │  │  (native)    │  │  - Download from server │  │
│  │             │  │              │  │  - Open in native app   │  │
│  │             │  │              │  │  - "Done Editing" sync  │  │
│  │             │  │              │  │  - Upload back to server│  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ System Tray │  │ Preferences  │  │  Token Store            │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
└──────────────────┬───────────────────────────────────────────────┘
                   │  (3) HTTP requests (download / upload)
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│              Sambee Backend (Python / FastAPI)                    │
│                                                                  │
│  Existing:  GET  /api/viewer/{connId}/download?path=...          │
│  New:       POST /api/viewer/{connId}/upload?path=...            │
│  New:       GET  /api/viewer/{connId}/file-info?path=...         │
│  New:       POST /api/companion/token                            │
│  New:       POST /api/companion/{connId}/lock?path=...           │
│  New:       POST /api/companion/{connId}/lock/heartbeat?path=... │
│  New:       DELETE /api/companion/{connId}/lock?path=...         │
│  New:       DELETE /api/companion/{connId}/lock/force?path=...   │
│  New:       GET  /api/viewer/{connId}/lock-status?path=...       │
│  New:       GET  /api/companion/version-check?companion_version= │
│                                                                  │
│  ┌───────────────────┐                                           │
│  │  SMB Share (file   │                                          │
│  │  storage backend)  │                                          │
│  └───────────────────┘                                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Flow

### 3.1 Opening a file in a native app

```
Browser                Companion App              Sambee Backend         SMB Share
  │                        │                           │                    │
  │ (1) Click "Open in…"  │                           │                    │
  │  sambee://open?        │                           │                    │
  │   server=https://...  │                           │                    │
  │   &token=<short-jwt>  │                           │                    │
  │   &connId=<uuid>      │                           │                    │
  │   &path=/docs/f.docx  │                           │                    │
  │───────────────────────>│                           │                    │
  │                        │                           │                    │
  │                 (2) Exchange short-lived token      │                    │
  │                        │  POST /companion/token    │                    │
  │                        │──────────────────────────>│                    │
  │                        │  ← session JWT            │                    │
  │                        │<──────────────────────────│                    │
  │                        │                           │                    │
  │                 (3) Download file                   │                    │
  │                        │  GET /viewer/{id}/download│                    │
  │                        │──────────────────────────>│──── read ─────────>│
  │                        │  ← file bytes             │<── bytes ─────────│
  │                        │<──────────────────────────│                    │
  │                        │                           │                    │
  │                 (3b) Acquire edit lock              │                    │
  │                        │  POST /companion/{id}/lock│                    │
  │                        │──────────────────────────>│                    │
  │                        │  ← 200 OK (locked)        │                    │
  │                        │<──────────────────────────│                    │
  │                        │                           │                    │
  │                 (4) Save to temp dir                │                    │
  │                 (5) Determine native app            │                    │
  │                     (cached pref or show picker)    │                    │
  │                 (6) Launch native app               │                    │
  │                 (7) Show "Done Editing" window      │                    │
  │                        │                           │                    │
  │                 ... user edits file in native app ...                    │
  │                        │                           │                    │
  │                 (8) User clicks "Done Editing"      │                    │
  │                        │  POST /viewer/{id}/upload │                    │
  │                        │──────────────────────────>│──── write ────────>│
  │                        │  ← 200 OK                 │                    │
  │                        │<──────────────────────────│                    │
  │                        │                           │                    │
  │                        │  DELETE /companion/{id}/   │                    │
  │                        │    lock?path=...          │                    │
  │                        │──────────────────────────>│                    │
  │                        │  ← 200 OK (unlocked)      │                    │
  │                        │<──────────────────────────│                    │
  │                        │                           │                    │
  │                 (10) Optional: notify browser via WS│                    │
  │<───────────────────────│                           │                    │
```

### 3.2 Conflict detection

Before uploading, the companion can `GET /viewer/{id}/file-info?path=...` to check if `last_modified` has changed since the download. If it has, the companion shows a conflict dialog offering: **Overwrite**, **Save as copy**, or **Cancel**.

---

## 4. Project Structure

The companion app lives in a new top-level directory alongside `backend/` and `frontend/`:

```
companion/
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json           # Tauri config (deep-link schemes, bundle IDs, etc.)
│   ├── capabilities/
│   │   └── default.json          # Permission grants for plugins
│   ├── icons/                    # App icons (all platforms)
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Plugin setup, app builder
│   │   ├── commands/             # Tauri commands (invocable from JS)
│   │   │   ├── mod.rs
│   │   │   ├── download.rs       # Download file from Sambee server
│   │   │   ├── upload.rs         # Upload file back to Sambee server
│   │   │   ├── open_file.rs      # Open file with native app
│   │   │   └── app_picker.rs     # Enumerate native apps for file type
│   │   ├── sync/                 # Upload / sync-back logic
│   │   │   ├── mod.rs
│   │   │   ├── upload.rs         # Upload file to backend on "Done Editing"
│   │   │   ├── recycle.rs        # Recycle bin: move temp files, 7-day cleanup
│   │   │   └── recovery.rs       # Startup recovery: detect leftover temp files

│   │   ├── app_registry/         # Native app enumeration
│   │   │   ├── mod.rs            # Trait definition
│   │   │   ├── windows.rs        # Windows: SHAssocEnumHandlers / Registry
│   │   │   ├── macos.rs          # macOS: LSCopyApplicationURLsForURL
│   │   │   └── linux.rs          # Linux: mimeapps.list + .desktop parsing
│   │   ├── token/                # Token exchange & storage
│   │   │   └── mod.rs
│   │   └── uri/                  # URI parsing & validation
│   │       └── mod.rs
│   └── build.rs
├── src/                          # TypeScript frontend (Tauri webview UI)
│   ├── main.tsx                  # Entry point
│   ├── App.tsx                   # Root component (Preact)
│   ├── components/
│   │   ├── AppPicker.tsx         # Native app picker dialog
│   │   ├── ConflictDialog.tsx    # Save conflict resolution
│   │   ├── DoneEditingWindow.tsx  # "Done Editing" per-file top-level window
│   │   ├── RecoveryDialog.tsx    # Startup recovery dialog for leftover temp files
│   │   ├── Preferences.tsx       # Settings panel
│   │   └── TrayStatus.tsx        # Active file operations view
│   ├── stores/                   # State management
│   │   ├── operations.ts         # Active file operations
│   │   └── preferences.ts        # User preferences
│   └── styles/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 5. Phase 1 — Backend API Extensions

**Goal:** Add the three new endpoints the companion needs.

### 5.1 File upload endpoint

**File:** `backend/app/api/viewer.py`

```
POST /api/viewer/{connection_id}/upload?path=/docs/file.docx
Content-Type: multipart/form-data
Authorization: Bearer <jwt>

Body: file (binary)

Response 200: { "status": "ok", "path": "/docs/file.docx", "size": 12345, "last_modified": "2026-02-09T12:00:00Z" }
Response 409: { "error": "conflict", "server_modified": "...", "your_download": "..." }
```

**Implementation tasks:**
- [ ] Add `upload_file()` route to `viewer.py`
- [ ] Accept multipart file upload
- [ ] Write file to SMB share via existing `SMBBackend`
- [ ] Return updated metadata
- [ ] Optionally accept `If-Unmodified-Since` header for conflict detection

### 5.2 File info endpoint

**File:** `backend/app/api/viewer.py`

```
GET /api/viewer/{connection_id}/file-info?path=/docs/file.docx
Authorization: Bearer <jwt>

Response 200: { "path": "/docs/file.docx", "size": 12345, "last_modified": "2026-02-09T12:00:00Z" }
```

**Implementation tasks:**
- [ ] Add `file_info()` route to `viewer.py`
- [ ] Query SMB share for file metadata without downloading content
- [ ] Return size, last_modified, MIME type

### 5.3 Companion token endpoint

**File:** `backend/app/api/auth.py` (new route)

```
POST /api/companion/token
Authorization: Bearer <jwt>  (short-lived, single-use URI token)

Response 200: { "token": "<session-jwt>", "expires_in": 3600 }
```

**Implementation tasks:**
- [ ] Add `exchange_companion_token()` route
- [ ] Accept the short-lived URI token (generated when "Open in…" is clicked)
- [ ] Validate it is single-use (track in DB or in-memory cache with TTL)
- [ ] Return a longer-lived session JWT scoped to the companion's needs
- [ ] Rate-limit to prevent brute-force

### 5.4 URI token generation (for the web frontend)

**File:** `backend/app/api/viewer.py` or `backend/app/api/auth.py`

```
POST /api/companion/uri-token
Authorization: Bearer <jwt>  (normal session JWT)

Response 200: { "uri_token": "<short-jwt>", "expires_in": 60 }
```

**Implementation tasks:**
- [ ] Generate a short-lived (60s), single-use JWT
- [ ] Embed `connection_id` and `path` claims to scope it
- [ ] Store token hash in cache for single-use enforcement
- [ ] Return to frontend for embedding in the `sambee://` URI

---

## 6. Phase 2 — Tauri App Skeleton

**Goal:** Bootstrapped Tauri v2 app with deep-link handling, single-instance, and system tray.

### 6.1 Project initialization

```bash
cd /workspace
npm create tauri-app@latest companion -- --template vanilla-ts
cd companion
npm install preact @preact/preset-vite       # Preact + Vite plugin
cargo add tauri-plugin-deep-link tauri-plugin-single-instance \
         tauri-plugin-store tauri-plugin-shell tauri-plugin-http \
         tauri-plugin-notification tauri-plugin-updater
cargo add reqwest --features=multipart,json   # HTTP client for backend API
cargo add serde serde_json --features=derive
cargo add tokio --features=full
cargo add tempfile                            # Secure temp file creation

```

### 6.2 Tauri config (`tauri.conf.json`)

Key configuration:

```jsonc
{
  "productName": "Sambee Companion",
  "identifier": "app.sambee.companion",
  "version": "0.1.0",
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": ["sambee"]
      }
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "dmg", "deb", "appimage"],
    "icon": ["icons/icon.png"]
  },
  "app": {
    "withGlobalTauri": true,
    "trayIcon": {
      "iconPath": "icons/tray-icon.png",
      "tooltip": "Sambee Companion"
    }
  }
}
```

### 6.3 Plugin wiring (`src-tauri/src/lib.rs`)

```rust
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance must be first (with deep-link feature)
    #[cfg(desktop)]
    {
        builder = builder.plugin(
            tauri_plugin_single_instance::init(|_app, argv, _cwd| {
                // Forward deep-link URI to main instance
                println!("Re-opened with: {argv:?}");
            })
        );
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Register deep-link schemes at runtime (Linux + Windows dev mode)
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                app.deep_link().register_all()?;
            }

            // Process deep-link if app was cold-started via URI
            if let Some(urls) = app.deep_link().get_current()? {
                handle_deep_link(app, urls);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Sambee Companion");
}
```

### 6.4 Implementation tasks

- [ ] Initialize Tauri v2 project in `companion/`
- [ ] Configure `tauri.conf.json` with deep-link scheme `sambee`
- [ ] Wire all plugins in `lib.rs`
- [ ] Implement URI parser (`uri/mod.rs`) that extracts `server`, `token`, `connId`, `path`
- [ ] Implement `handle_deep_link()` function
- [ ] Set up system tray with icon, menu (Preferences, Active Operations, Quit)
- [ ] Build and test: clicking `sambee://test` in browser should launch the app

---

## 7. Phase 3 — App Enumeration (Native App Picker)

**Goal:** Show user which native apps can open a given file type, with a "browse" option.

### 7.1 Rust trait definition

```rust
// app_registry/mod.rs

pub struct NativeApp {
    pub name: String,           // "LibreOffice Writer"
    pub executable: PathBuf,    // /usr/bin/libreoffice
    pub icon: Option<Vec<u8>>,  // PNG bytes for display
    pub is_default: bool,       // OS default for this type?
}

pub trait AppRegistry {
    /// Returns apps registered to handle the given file extension.
    fn apps_for_extension(&self, extension: &str) -> Vec<NativeApp>;

    /// Returns apps registered to handle the given MIME type.
    fn apps_for_mime(&self, mime: &str) -> Vec<NativeApp>;
}
```

### 7.2 Windows implementation (`app_registry/windows.rs`)

- Use `windows` crate to call `SHAssocEnumHandlers()` COM API
- Enumerate `HKEY_CLASSES_ROOT\.docx\OpenWithProgids` for registered apps
- Read display names from `HKEY_CLASSES_ROOT\{ProgId}\shell\open\command`
- Extract icons via `ExtractIconExW` or `SHGetFileInfo`
- Determine default via `IQueryAssociations::GetString(ASSOCSTR_EXECUTABLE)`

### 7.3 macOS implementation (`app_registry/macos.rs`)

- Use `objc2` + `core-foundation` crates to call Core Services
- `LSCopyApplicationURLsForURL()` → list of app bundle URLs
- `NSWorkspace.urlForApplication(toOpen:)` → default app
- Read `Info.plist` (`CFBundleName`, `CFBundleIconFile`) for display info
- Convert `.icns` icon to PNG bytes using `image` crate

### 7.4 Linux implementation (`app_registry/linux.rs`)

- Parse `~/.config/mimeapps.list` and `/usr/share/applications/mimeapps.list`
- Map file extension → MIME type using the `mime_guess` crate
- Read `[Default Applications]` section for default app
- Read `[Added Associations]` for additional registered apps
- Parse `.desktop` files in `/usr/share/applications/` and `~/.local/share/applications/`
- Extract `Name=`, `Exec=`, `Icon=` fields

### 7.5 "Browse for application" fallback

All platforms: Tauri's `dialog` plugin opens a native file picker filtered to executables:
- Windows: `*.exe`
- macOS: `*.app` (show as folders) or `/Applications/`
- Linux: all files (executables are not extension-based)

Selected app is saved to preferences (Tauri `store` plugin) keyed by file extension.

### 7.6 App picker UI (TypeScript)

A webview dialog showing:

```
┌─────────────────────────────────────────────────┐
│  Choose an application for .docx files          │
│                                                 │
│  ★ LibreOffice Writer         (default)  [Open] │
│    Microsoft Word                        [Open] │
│    WPS Writer                            [Open] │
│                                                 │
│  ☐ Always use this app for .docx files          │
│                                                 │
│  [Browse for another app...]          [Cancel]  │
└─────────────────────────────────────────────────┘
```

### 7.7 Implementation tasks

- [ ] Define `NativeApp` struct and `AppRegistry` trait
- [ ] Implement `WindowsAppRegistry` with COM/Registry calls
- [ ] Implement `MacosAppRegistry` with Core Services calls
- [ ] Implement `LinuxAppRegistry` with mimeapps.list parsing
- [ ] Add Tauri command `get_apps_for_file` callable from JS
- [ ] Build app picker UI component
- [ ] Implement "Always use" preference with Tauri store plugin
- [ ] Implement "Browse" fallback using Tauri dialog plugin
- [ ] Write unit tests for each platform's registry parsing

---

## 8. Phase 4 — Edit Lifecycle & Sync-Back

**Goal:** Manage the full edit lifecycle: download → open in native app → user edits → upload back to the SMB share when done.

The companion does **not** watch the file system for changes. Instead, it uploads the file once when the user explicitly signals they are done editing by clicking the "Done Editing" button. This is simpler, avoids the complexity of debouncing/atomic-save detection, and prevents unnecessary intermediate uploads while the user is still working.

### 8.1 Edit operation data model

```rust
// sync/mod.rs

pub struct FileOperation {
    pub id: Uuid,
    pub server_url: String,
    pub connection_id: String,
    pub remote_path: String,
    pub local_path: PathBuf,
    pub token: String,
    pub downloaded_at: SystemTime,
    pub original_mtime: SystemTime,  // mtime at download time, for change detection
    pub status: OperationStatus,
    pub opened_with_app: Option<String>, // Display name of the native app (e.g. "LibreOffice Writer")
}

pub enum OperationStatus {
    Downloading,
    Editing,           // File open in native app, "Done Editing" window visible
    Uploading(f32),    // Upload in progress; f32 = 0.0..1.0 progress fraction
    UploadFailed(String),
    Completed,         // Upload done, lock released, temp file moved to recycle bin
    Discarded,         // User discarded changes, lock released, temp file moved to recycle bin
}
```

All active `FileOperation`s are tracked in an in-memory list, displayed in the system tray menu.

### 8.2 Sync-back strategy

The "Done Editing" window continuously shows the file's change status (see §8.2.1). The behavior when the user holds the primary button depends on this status:

**If file is modified:**

1. Upload the file via `POST /api/viewer/{connId}/upload?path=...`, showing an upload progress bar in the window.
2. On upload success → release lock, close window, show notification, move temp file to recycle bin.
3. On upload failure → retry (3 attempts, exponential backoff). If all retries fail, show error notification and **keep the temp file in place** so the user doesn't lose work.

**If file is unchanged:**

1. Release lock, close window, move temp file to recycle bin.
2. Show notification: _"✓ report.docx — no changes, lock released."_

**Discard Changes** (only available when file is modified, hold-to-confirm) skips the upload:

1. Release the edit lock.
2. Release the SMB-level lock.
3. Close the "Done Editing" window.
4. Move the temp file to the recycle bin (the user's edits are preserved there for 7 days).
5. Show notification: _"report.docx — changes discarded (recoverable for 7 days)."_

### 8.2.1 "Done Editing" window

Automatic detection of when a native editing application has closed is an unsolved problem. Research of production tools (git `--wait`, VS Code marker files, Nextcloud filesystem watchers, kubectl/crontab `$EDITOR` invocation, Cryptomator vault locks) shows that **no existing software reliably detects editor close for arbitrary applications**. The core issue is the "launcher problem": many apps (LibreOffice, Electron-based editors, most macOS apps) use a stub process that exits immediately after spawning the real editor, making PID tracking useless. Process-table scanning (`sysinfo`) and OS file-lock detection are fragile heuristics not used by any production software for this purpose.

**Chosen approach — explicit user action via a "Done Editing" window:**

When the companion opens a file in a native app, it shows a small, always-on-top, movable window that remains visible while the user edits. The user clicks a button when finished.

This approach:
- Works with **any** application — no known-editors list, no process heuristics.
- Is transparent and predictable — the user is always in control.
- Doubles as a visual reminder that an edit session is active and a lock is held.

**Window specification:**

The window dynamically shows the file's change status by polling the temp file's modification time (every 2 seconds). This gives the user full transparency about whether their edits have been saved locally.

**When file is unchanged:**

```
┌──────────────────────────────────────────────────┐
│  ✎ Sambee — Editing                              │
│                                                  │
│  report.docx                                     │
│  Opened in: LibreOffice Writer                   │
│                                                  │
│  Status: Unchanged                               │
│                                                  │
│  [  ✓  Done Editing — Hold to Close  ]           │
│  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  │  ← hold progress
│                                                  │
└──────────────────────────────────────────────────┘
```

- Only the primary button is shown (no "Discard Changes" — there's nothing to discard).
- Button text: "Done Editing — Hold to Close" (no "Upload" since file is unchanged).
- Action: release lock, move temp file to recycle bin, close window. No upload.

**When file is modified:**

```
┌──────────────────────────────────────────────────┐
│  ✎ Sambee — Editing                              │
│                                                  │
│  report.docx                                     │
│  Opened in: LibreOffice Writer                   │
│                                                  │
│  Status: Modified at 14:32:07                    │
│                                                  │
│  [  ✓  Done Editing — Hold to Upload  ]          │
│  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  │  ← hold progress
│                                                  │
│  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  │  ← upload progress
│                                                  │
│           [ Discard Changes — Hold ]             │
│           ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔             │
│                                                  │
└──────────────────────────────────────────────────┘
```

- Status line shows the time of the last local save (updated from the file's mtime).
- Both buttons are shown: "Done Editing — Hold to Upload" and "Discard Changes — Hold".

**File change detection:** The companion polls the temp file's `mtime` every **2 seconds** using a Rust-side background task that emits `file-status` events to the webview. The status transitions from "Unchanged" to "Modified at HH:MM:SS" as soon as the mtime differs from `original_mtime`. Subsequent local saves update the displayed time.

**Window behavior:**

| Property           | Value                                                                 |
|--------------------|-----------------------------------------------------------------------|
| Always on top      | Yes (system-level, via Tauri window option `always_on_top: true`)     |
| Movable            | Yes — user can drag it anywhere, position is remembered               |
| Resizable          | No — fixed compact size (~340 × 260 px)                              |
| Closable via ✕     | No — window has no close button; only the "Done Editing" button dismisses it |
| Minimizable        | No — must stay visible as a reminder that a lock is held              |
| Shows              | Filename, app name, and live file change status ("Unchanged" or "Modified at HH:MM:SS") |
| Multiple files     | One window per active edit session (stacked or tabbed)                |

**"Done Editing" button — hold-to-confirm interaction:**

To prevent accidental uploads, the button uses a **hold-to-confirm** interaction. The user must press and hold the button for **1.5 seconds**; a progress bar fills during the hold, and the action fires only when the bar completes. Releasing early cancels. This works identically for mouse and keyboard:

| Input    | Start                                      | Progress             | Confirm                        | Cancel                              |
|----------|--------------------------------------------|----------------------|--------------------------------|-------------------------------------|
| Mouse    | `mousedown` on button                      | Progress bar fills over 1.5s | Hold until bar completes | Release early (`mouseup`) or move pointer off button |
| Keyboard | `keydown` on focused button (Space or Enter, ignore `event.repeat`) | Same progress bar | Hold until bar completes (`keyup` after threshold) | Release early (`keyup` before threshold) or press Escape |

The browser fires repeated `keydown` events when a key is held; these are filtered via `event.repeat === true` — only the initial `keydown` starts the timer. The `keyup` event signals release. If the elapsed time ≥ 1.5s at `keyup`, the action fires. This maps exactly to `mousedown`/`mouseup`.

**Visual states — "Done Editing" button (file modified):**

```
Idle:
[  ✓  Done Editing — Hold to Upload  ]
 ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔   ← thin gray track (hold progress)

Holding (0.9s in):
[  ✓  Done Editing — Hold to Upload  ]
 ████████████████████░░░░░░░░░░░░░░░░   ← filling (accent color)

Hold completed — uploading:
[  ✓  Uploading…                      ]
 ████████████████████████████████████   ← full (green)
 █████████████░░░░░░░░░░░░░░░░░░░░░░   ← upload progress (bytes sent / total)

Upload done — window closes automatically.
```

**Visual states — "Done Editing" button (file unchanged):**

```
Idle:
[  ✓  Done Editing — Hold to Close  ]
 ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔   ← thin gray track (hold progress)

Hold completed — no upload needed:
  Window closes, lock released, notification shown.
```

**Visual states — "Discard Changes" button (only visible when file is modified):**

```
Idle:
         [ Discard Changes — Hold ]
          ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔   ← smaller, muted style

Holding:
         [ Discard Changes — Hold ]
          ██████████████░░░░░░░░░░░░   ← filling (danger/red color)

Completed:
          Window closes, notification shown.
```

**Accessibility:** The button includes `aria-label="Hold for 1.5 seconds to confirm upload"`. The progress bar is exposed via `role="progressbar"` with `aria-valuenow`/`aria-valuemax` so screen readers announce progress.

**After the "Done Editing" hold completes, the action depends on file status:**

_If file is modified:_

1. Show the upload progress bar and upload file (`POST /api/viewer/{connId}/upload?path=...`) with retry. The progress bar tracks bytes sent / total bytes.
2. Release the edit lock (`DELETE /api/companion/{connId}/lock`).
3. Release the SMB-level lock (close the held file handle).
4. Close the "Done Editing" window.
5. Transition `OperationStatus` to `Completed`.
6. Show desktop notification: _"✓ report.docx — saved to server."_
7. Move the temp file to the recycle bin: `{temp}/sambee-companion/recycle/{stem}-copy-{YYYYMMDD-HHmmss}.{ext}`.

_If file is unchanged:_

1. Release the edit lock and SMB-level lock.
2. Close the "Done Editing" window.
3. Transition `OperationStatus` to `Completed`.
4. Show desktop notification: _"✓ report.docx — no changes, lock released."_
5. Move the temp file to the recycle bin.

**After the "Discard Changes" hold completes:**

1. Release the edit lock and SMB-level lock.
2. Close the "Done Editing" window.
3. Transition `OperationStatus` to `Discarded`.
4. Move the temp file to the recycle bin.
5. Show desktop notification: _"report.docx — changes discarded (recoverable for 7 days)."_

**Safety net — heartbeat timeout:**

If the companion crashes or the user's machine shuts down unexpectedly, the "Done Editing" window never fires its cleanup. The server-side heartbeat timeout (2 minutes, see §16) acts as a safety net: the backend releases the lock automatically when the heartbeat stops arriving. This replaces all process-monitoring fallback logic.

**Implementation notes (Rust/Tauri):**

```rust
// commands/open_file.rs — after launching the native app

// Create a "Done Editing" window for this operation
let done_window = tauri::WebviewWindowBuilder::new(
    &app_handle,
    format!("done-editing-{}", operation.id),
    tauri::WebviewUrl::App("/done-editing".into()),
)
.title("Sambee — Editing")
.inner_size(340.0, 260.0)
.resizable(false)
.always_on_top(true)
.closable(false)
.minimizable(false)
.center()
.build()?;

// Pass file info to the window via event or URL query params
done_window.emit("edit-context", &EditContext {
    operation_id: operation.id,
    filename: operation.filename.clone(),
    app_name: selected_app.display_name.clone(),
})?;
```

**Implementation notes (TypeScript/Preact — DoneEditingWindow component):**

```tsx
// components/DoneEditingWindow.tsx

const HOLD_DURATION_MS = 1500;
const FILE_POLL_INTERVAL_MS = 2000;

type FileStatus =
    | { kind: "unchanged" }
    | { kind: "modified"; modifiedAt: string }; // "HH:MM:SS"

function DoneEditingWindow() {
    const [context, setContext] = useState<EditContext | null>(null);
    const [fileStatus, setFileStatus] = useState<FileStatus>({ kind: "unchanged" });
    const [holdProgress, setHoldProgress] = useState(0); // 0..1
    const [discardHoldProgress, setDiscardHoldProgress] = useState(0); // 0..1
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0); // 0..1 (bytes sent / total)
    const holdStart = useRef<number | null>(null);
    const discardHoldStart = useRef<number | null>(null);
    const animFrame = useRef<number>(0);

    const isModified = fileStatus.kind === "modified";

    useEffect(() => {
        listen<EditContext>("edit-context", (event) => {
            setContext(event.payload);
        });
        // Listen for file status updates from Rust-side polling (every 2s)
        listen<FileStatus>("file-status", (event) => {
            setFileStatus(event.payload);
        });
        // Listen for upload progress events from the Rust side
        listen<{ progress: number }>("upload-progress", (event) => {
            setUploadProgress(event.payload.progress);
        });
    }, []);

    // --- Hold-to-confirm logic (shared by both buttons) ---

    const startHold = (setter: (v: number) => void, ref: typeof holdStart, onComplete: () => void) => {
        if (uploading) return;
        ref.current = performance.now();
        const tick = () => {
            if (!ref.current) return;
            const elapsed = performance.now() - ref.current;
            const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
            setter(progress);
            if (progress >= 1) {
                ref.current = null;
                onComplete();
            } else {
                animFrame.current = requestAnimationFrame(tick);
            }
        };
        tick();
    };

    const cancelHold = (setter: (v: number) => void, ref: typeof holdStart) => {
        ref.current = null;
        cancelAnimationFrame(animFrame.current);
        setter(0);
    };

    // --- "Done Editing" button ---

    const confirmDone = async () => {
        setUploading(true);
        await invoke("finish_editing", { operationId: context!.operationId });
        // Window closed by Rust side after cleanup
    };

    const makeHandlers = (setter: (v: number) => void, ref: typeof holdStart, onComplete: () => void) => ({
        onMouseDown: () => startHold(setter, ref, onComplete),
        onMouseUp: () => cancelHold(setter, ref),
        onMouseLeave: () => cancelHold(setter, ref),
        onKeyDown: (e: KeyboardEvent) => {
            if (e.repeat) return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                startHold(setter, ref, onComplete);
            }
        },
        onKeyUp: (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
                cancelHold(setter, ref);
            }
        },
    });

    // --- "Discard Changes" button ---

    const confirmDiscard = async () => {
        setUploading(true); // Reuse to disable both buttons
        await invoke("discard_editing", { operationId: context!.operationId });
        // Window closed by Rust side after cleanup
    };

    const doneHandlers = makeHandlers(setHoldProgress, holdStart, confirmDone);
    const discardHandlers = makeHandlers(setDiscardHoldProgress, discardHoldStart, confirmDiscard);

    // Button label adapts to file status
    const doneButtonLabel = uploading
        ? "✓ Uploading…"
        : isModified
            ? "✓ Done Editing — Hold to Upload"
            : "✓ Done Editing — Hold to Close";

    return (
        <div class="done-editing-window">
            <h2>✎ {context?.filename}</h2>
            <p>Opened in: {context?.appName}</p>

            {/* Live file change status */}
            <p class={`file-status ${isModified ? "file-status--modified" : "file-status--unchanged"}`}>
                Status: {isModified
                    ? `Modified at ${fileStatus.modifiedAt}`
                    : "Unchanged"}
            </p>

            {/* Primary: Done Editing (always visible) */}
            <button
                class="btn-primary"
                {...doneHandlers}
                disabled={uploading}
                aria-label={isModified
                    ? "Hold for 1.5 seconds to confirm upload"
                    : "Hold for 1.5 seconds to close and release lock"}
            >
                {doneButtonLabel}
            </button>
            <div class="hold-progress-track" role="progressbar"
                aria-valuenow={Math.round(holdProgress * 100)} aria-valuemax={100}>
                <div class="hold-progress-fill" style={{ width: `${holdProgress * 100}%` }} />
            </div>

            {/* Upload progress (visible only while uploading a modified file) */}
            {uploading && isModified && (
                <div class="upload-progress-track" role="progressbar"
                    aria-valuenow={Math.round(uploadProgress * 100)} aria-valuemax={100}
                    aria-label="Upload progress">
                    <div class="upload-progress-fill" style={{ width: `${uploadProgress * 100}%` }} />
                </div>
            )}

            {/* Secondary: Discard Changes (only visible when file is modified) */}
            {isModified && !uploading && (
                <>
                    <button
                        class="btn-secondary btn-small"
                        {...discardHandlers}
                        disabled={uploading}
                        aria-label="Hold for 1.5 seconds to discard changes"
                    >
                        Discard Changes — Hold
                    </button>
                    <div class="hold-progress-track hold-progress-track--small" role="progressbar"
                        aria-valuenow={Math.round(discardHoldProgress * 100)} aria-valuemax={100}>
                        <div class="hold-progress-fill hold-progress-fill--danger"
                            style={{ width: `${discardHoldProgress * 100}%` }} />
                    </div>
                </>
            )}
        </div>
    );
}
```

### 8.3 Temp directory management

> **Principle: Never lose user edits.** Temp files are the user's safety net. They are never silently deleted — they are moved to a recycle bin and kept for 7 days.

- Use `tempfile::TempDir` to create a secure, user-only-readable temp directory.
- Directory structure: `{temp}/sambee-companion/{operation-id}/{stem}-copy.{ext}`
  - Example: `report.docx` → `report-copy.docx`, `archive.tar.gz` → `archive-copy.tar.gz`
  - The `-copy` suffix makes it clear to the user this is a working copy, not the original.
  - Files without an extension: `{name}-copy` (e.g., `Makefile` → `Makefile-copy`).
- **No periodic cleanup.** Active temp files are never deleted automatically.

#### Recycle bin

When an edit session ends (upload or discard), the temp file is **moved** (not deleted) to a recycle bin directory:

```
{temp}/sambee-companion/recycle/
  report-copy-20260209-143022.docx
  data-copy-20260208-091500.xlsx
```

- Filename format: `{stem}-copy-{YYYYMMDD-HHmmss}.{ext}` (timestamp of when the file was recycled).
- Files in the recycle bin are deleted after **7 days** (checked on companion startup and once per hour while running).
- The recycle bin is the **only** place where automatic deletion occurs.

#### Startup recovery (leftover temp files)

When the companion starts, it scans `{temp}/sambee-companion/` for leftover temp files from previous sessions (i.e., files in `{operation-id}/` directories, **not** the recycle bin). These exist when the companion crashed, the machine shut down unexpectedly, or the user force-killed the app.

For each leftover file, the companion shows a recovery dialog:

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

- **Upload to Server** — re-establishes the session (token exchange), uploads the file, then moves to recycle bin.
- **Discard** — moves the file to the recycle bin immediately.
- **Keep for Later** — leaves the file in place; the dialog will appear again on next startup.

The recovery dialog is non-blocking: the companion is fully functional while recovery dialogs are open, and new `sambee://` URIs are processed normally.

**Persisted operation metadata:** To support recovery, each `FileOperation` is persisted to disk alongside the temp file as a JSON sidecar: `{operation-id}/operation.json`. This stores the `server_url`, `connection_id`, `remote_path`, `token` (encrypted), `downloaded_at`, and `opened_with_app`. On startup, the companion reads these sidecars to present meaningful recovery dialogs.

### 8.4 Implementation tasks

- [ ] Implement `FileOperation` state management (in-memory + persisted JSON sidecar, includes `original_mtime`)
- [ ] Implement upload logic with retry (3 attempts, exponential backoff) and progress reporting
- [ ] Implement live file status polling (Rust background task, 2-second interval, emits `file-status` events to webview)
- [ ] Add conflict detection (compare `last_modified` before upload)
- [ ] Build conflict resolution dialog UI (Overwrite / Save as Copy / Cancel)
- [ ] Display active operations in system tray menu
- [ ] Implement `-copy` temp file naming (handle edge cases: no extension, multi-dot extensions)
- [ ] Add desktop notification on successful upload, discard (unchanged close), and error
- [ ] Build "Done Editing" window (Tauri `WebviewWindow`, always-on-top, fixed size, 340×260)
- [ ] Implement `DoneEditingWindow.tsx` with live file status display ("Unchanged" / "Modified at HH:MM:SS")
- [ ] Implement conditional button visibility: hide "Discard Changes" when file is unchanged
- [ ] Implement conditional button labels: "Hold to Upload" (modified) vs "Hold to Close" (unchanged)
- [ ] Implement upload progress bar (bytes sent / total, visible only during modified-file upload)
- [ ] Implement unified mouse (`mousedown`/`mouseup`/`mouseleave`) and keyboard (`keydown`/`keyup`, filter `event.repeat`) hold interaction for both buttons
- [ ] Wire "Done Editing" hold (modified) → upload with progress → lock release → recycle → window close → notification
- [ ] Wire "Done Editing" hold (unchanged) → lock release → recycle → window close → notification
- [ ] Wire "Discard" hold → lock release → recycle → window close → notification
- [ ] Implement recycle bin (`{temp}/sambee-companion/recycle/`) with timestamped filenames
- [ ] Implement recycle bin cleanup (delete files older than 7 days, checked on startup + hourly)
- [ ] Implement startup recovery: scan for leftover temp files, show recovery dialog per file
- [ ] Implement recovery dialog UI (Upload to Server / Discard / Keep for Later)
- [ ] Persist `FileOperation` metadata as JSON sidecar (`operation.json`) alongside temp file
- [ ] Remember window position across sessions (Tauri store plugin)
- [ ] Support multiple concurrent "Done Editing" windows (one per file)
- [ ] Write tests for upload + retry + conflict detection + progress reporting
- [ ] Write tests for file status polling (unchanged → modified transition)
- [ ] Write tests for "Done Editing" → recycle bin lifecycle (both modified and unchanged paths)
- [ ] Write tests for "Discard Changes" → recycle bin lifecycle
- [ ] Write tests for startup recovery (leftover detection, dialog actions)

### 8.5 File size limit

Editing files through the companion involves downloading a full copy to the local machine and uploading the modified file back when done. For very large files this is slow and error-prone.

**Soft limit: 50 MB (configurable)**

- When the user requests to open a file larger than the configured threshold, the companion shows a warning dialog _before_ downloading:

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

- This is a **soft** limit — the user can always proceed.
- The threshold is configurable in the companion's settings (Preferences panel, stored via Tauri `store` plugin). Default: 50 MB.
- The backend `/api/companion/{connId}/file-info` endpoint already returns `size_bytes`; the companion checks this before starting the download.

**Implementation tasks:**

- [ ] Add `max_edit_file_size_mb` setting to companion preferences (default: 50)
- [ ] Check file size from `/file-info` response before download
- [ ] Build large-file warning dialog component
- [ ] Allow user to proceed or cancel
- [ ] Write test for size check + dialog display

---

## 9. Phase 5 — Frontend Integration

**Goal:** Add "Open in app…" action to the Sambee web frontend.

### 9.1 URI generation

**File:** `frontend/src/services/api.ts`

Add a new method:

```typescript
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

### 9.2 UI integration points

**File:** `frontend/src/components/FileBrowser/DesktopToolbarActions.tsx`

- Add "Open in app…" button (with external-app icon) to the toolbar.
- Only visible when a file is selected (not a directory).
- Grayed out for file types where it doesn't make sense (e.g., already-viewable images may still be openable externally for editing).

**File:** `frontend/src/components/FileBrowser/FileRow.tsx`

- Add "Open in app" to the right-click context menu.
- Add double-click behavior option: view in browser vs. open in native app (user preference).

**File:** `frontend/src/pages/FileBrowser.tsx`

- Add keyboard shortcut: `Ctrl+Enter` / `Cmd+Enter` → "Open in app".

### 9.3 Companion detection

The companion, when running, exposes a localhost HTTP endpoint for browser-side detection:

```
GET http://localhost:21549/status
→ 200 { "version": "0.1.0", "activeFiles": [...] }
```

**Detection strategy in the web UI:**

1. **On page load:** Attempt `fetch("http://localhost:21549/status")`.
   - Success → show "Companion connected" indicator, enable "Open in app" buttons, show per-file editing status.
   - Failure (network error) → companion not running or not installed. Show "Open in app" buttons anyway (fall through to URI scheme).
2. **When "Open in app" is clicked without companion detected:** The OS handles the `sambee://` URI. If the companion is not installed, the OS shows a "no handler" message and the Sambee web app shows a tooltip linking to the companion download page.

**CORS:** The companion's localhost server includes `Access-Control-Allow-Origin` for the Sambee web origin.

**Implementation timeline:** Not required for MVP. Add after core functionality (Phases 1–4) is stable. For MVP, always show the "Open in app" button (Option A — simple approach).

### 9.4 Implementation tasks

- [ ] Add `getCompanionUri()` to `api.ts`
- [ ] Add "Open in app" button to `DesktopToolbarActions.tsx`
- [ ] Add "Open in app" to file context menu in `FileRow.tsx`
- [ ] Add `Ctrl+Enter` keyboard shortcut in `FileBrowser.tsx`
- [ ] Add "companion not installed" guidance tooltip / first-run dialog
- [ ] Add user preference: default file open action (view in browser vs. open in app)
- [ ] Write frontend unit tests for URI generation

---

## 10. Phase 6 — Polish & Distribution

### 10.1 User preferences (Tauri store)

Stored in the companion using `tauri-plugin-store`:

```json
{
  "allowedServers": ["https://sambee.example.com"],
  "appPreferences": {
    ".docx": "/usr/bin/libreoffice",
    ".xlsx": "/usr/bin/libreoffice",
    ".psd": "/opt/gimp/bin/gimp"
  },
  "tempFileCleanupHours": 24,
  "uploadConflictAction": "ask",
  "showNotifications": true
}
```

### 10.2 Auto-updater

Use `tauri-plugin-updater` with a static JSON endpoint:

```json
// https://sambee.example.com/companion/update.json
{
  "version": "0.2.0",
  "platforms": {
    "windows-x86_64": { "url": "https://.../companion-0.2.0-x64.msi.zip", "signature": "..." },
    "linux-x86_64":   { "url": "https://.../companion-0.2.0-amd64.AppImage.tar.gz", "signature": "..." },
    "darwin-aarch64":  { "url": "https://.../companion-0.2.0-aarch64.dmg", "signature": "..." }
  }
}
```

### 10.3 Distribution build

```bash
# Build for current platform
cd companion && npm run tauri build

# Produces:
# Windows: target/release/bundle/msi/Sambee Companion_0.1.0_x64.msi
# macOS:   target/release/bundle/dmg/Sambee Companion_0.1.0_aarch64.dmg
# Linux:   target/release/bundle/deb/sambee-companion_0.1.0_amd64.deb
#          target/release/bundle/appimage/sambee-companion_0.1.0_amd64.AppImage
```

### 10.4 Cargo optimizations for binary size

```toml
# companion/src-tauri/Cargo.toml
[profile.release]
strip = true
lto = true
codegen-units = 1
opt-level = "s"
panic = "abort"
```

Expected binary size: **3–6 MB** (depending on platform and features).

### 10.5 Implementation tasks

- [ ] Implement preferences UI panel
- [ ] Set up Tauri store for persistent preferences
- [ ] Configure auto-updater plugin with update endpoint
- [ ] Add code signing for all three platforms
- [ ] Optimize release build profile in `Cargo.toml`
- [ ] Create installer icons and splash screen
- [ ] Write end-user documentation in `documentation/COMPANION_APP.md`
- [ ] Set up CI/CD pipeline to build for all three platforms
- [ ] Test installation and uninstallation on all three platforms
- [ ] Test deep-link registration survives app updates

---

## 11. Security Model

### 11.1 URI token flow (prevent token leakage)

The `sambee://` URI is visible in browser history and potentially in logs. Mitigations:

1. **Short-lived token:** The `uri_token` embedded in the URI expires in **60 seconds** and is **single-use**.
2. **Token exchange:** The companion immediately exchanges the URI token for a longer-lived session JWT via `POST /api/companion/token`. The URI token is invalidated after first use.
3. **Scoped claims:** The URI token's JWT claims contain the specific `connection_id` and `path`, preventing reuse for other files.
4. **Session JWT:** The exchanged session JWT is stored only in memory (or Tauri secure store). It has a longer TTL (e.g., 1 hour) but is scoped to companion operations only.

### 11.2 Server allowlist

The companion maintains an allowlist of trusted Sambee server URLs. On first use of a new server:

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

### 11.3 Temp file security

- Temp directory created with `0700` permissions (user-only read/write).
- Files are not placed in globally readable locations.
- Cleanup runs on app shutdown and periodically for stale files.

### 11.4 Input validation

- The URI parser validates all parameters against expected patterns.
- Server URL must use `https://` (or `http://localhost` for dev).
- Path is validated to prevent path traversal (`..`).
- Token format is validated before any network request.

---

## 12. UX Considerations

### 12.1 First-run experience

When the user clicks "Open in app" and the companion is not installed:

1. Browser shows "No application can handle this link" or similar.
2. The Sambee web app shows a tooltip/banner: _"Install Sambee Companion to open files in native apps. [Download for Windows/macOS/Linux]"_
3. Download page provides one-click installer for each platform.

### 12.2 Happy path (companion installed)

1. User right-clicks file → "Open in LibreOffice" (or "Open in app…").
2. If companion not running: OS launches it (~1 sec), file downloads and opens.
3. If companion in tray: near-instant file download + open.
4. User edits file, saves locally. When done, clicks "Done Editing" in the companion window.
5. Companion uploads the file and shows notification: "✓ report.docx saved to server."

### 12.3 System tray menu

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

### 12.4 Error states

| Error                        | User sees                                                  |
|------------------------------|------------------------------------------------------------|
| Server unreachable           | Desktop notification: "Cannot reach server. Will retry."   |
| Token expired                | Notification: "Session expired. Please open the file again from the browser." |
| Upload failed (network)      | Notification: "Upload failed. Retrying… (attempt 2/3)"     |
| Upload conflict              | Conflict dialog (see §8.4)                                 |
| Native app not found         | App picker dialog with "Browse" option                     |
| Companion not installed      | Web app shows download banner                              |
| Lock force-released          | Companion notification: "⚠ Your lock on report.docx was released by another user. Save your work locally." |
| File locked by another user  | Web app shows lock holder info + "Force Unlock" button      |

---

## 13. Technical Decisions & Rationale

| Decision                      | Choice          | Rationale                                                                    |
|-------------------------------|-----------------|------------------------------------------------------------------------------|
| Framework                     | Tauri v2        | ~3-6 MB binary, uses system WebView, Rust backend, rich plugin ecosystem     |
| ~~Electron~~                  | Rejected        | ~150-200 MB (bundles Chromium), overkill for a background helper app         |
| ~~Go CLI~~                    | Rejected        | No native UI without extra libraries; manual protocol registration           |
| ~~File system watcher~~       | Removed         | Adds complexity (debouncing, atomic saves, intermediate uploads) with little benefit; single upload on "Done Editing" is simpler and sufficient |
| HTTP client                   | `reqwest`       | Async, multipart upload support, TLS built-in, widely used                   |
| App enumeration               | Per-OS Rust     | Must call platform-native APIs; no cross-platform abstraction exists         |
| Companion UI framework        | Preact        | 3 KB gzip, React-compatible API (team already uses React), familiar JSX/hooks |
| Token in URI                  | Short-lived JWT | Avoids storing secrets in URI; exchanged immediately for session token        |
| Launch mode                   | On-demand only  | OS launches companion via URI scheme handler; no autostart, no background service |
| Editor close detection        | "Done Editing" window | Research showed no production software reliably detects editor close for arbitrary apps (launcher problem). Explicit user action is the only universal, reliable approach. |
| ~~Process monitoring~~        | Rejected        | `sysinfo` process scan + OS file-lock detection are fragile heuristics; no production tool uses them |
| Temp file naming              | `-copy` suffix  | Makes clear the file is a working copy (e.g. `report-copy.docx`); avoids confusion with the original |
| File size limit               | Soft 50 MB      | Warns user about slow download/sync but doesn't block; threshold configurable |
| Accidental-click prevention   | Hold-to-confirm (1.5s) | Press-and-hold with progress bar; works for both mouse and keyboard (Space/Enter); impossible to trigger accidentally |
| Temp file lifecycle           | Recycle bin (7 days)   | Temp files are never deleted — moved to recycle bin with timestamp; protects against data loss; 7-day retention |
| ~~Periodic temp cleanup~~     | Rejected               | Risk of deleting files the user still needs; recycle bin with explicit retention period is safer |
| Startup recovery              | Leftover scan + dialog | On launch, scan for orphaned temp files and prompt user to upload, discard, or keep; prevents silent data loss |

---

## 14. Testing Strategy

### 14.1 Backend tests

- Unit tests for new endpoints (`upload`, `file-info`, `companion/token`, `companion/uri-token`).
- Integration tests with mock SMB backend.
- Token lifecycle tests: generation, single-use enforcement, expiration.

### 14.2 Companion Rust tests

- Unit tests for URI parser (valid/invalid URIs, edge cases).
- Unit tests for app registry (mock registry data for each platform).
- Upload/download tests with mock HTTP server.
- Change detection tests (modified vs. unmodified file).

### 14.3 Companion UI tests

- Component tests for AppPicker, ConflictDialog, Preferences.
- E2E test: simulate deep-link → download → open → modify → upload cycle.

### 14.4 Frontend tests

- Unit tests for `getCompanionUri()` (correct encoding, token embedding).
- Component tests for "Open in app" button visibility and behavior.

### 14.5 Cross-platform testing

- CI builds for Windows (x86_64), macOS (aarch64, x86_64), Linux (x86_64).
- Manual testing checklist for deep-link registration on each OS.
- Test both cold-start and warm (tray) scenarios.

---

## 15. Resolved Questions

These questions were raised during the planning phase and have now been resolved.

### 15.1 Companion UI framework → **Preact**

**Decision:** Use **Preact** instead of Vanilla TS for the companion webview UI.

**Research summary — three frameworks evaluated:**

| Framework  | Size (gzip) | Benchmark¹ | API Style            | Key trait                          |
|------------|-------------|------------|----------------------|------------------------------------|
| Solid.js   | ~7 KB       | 1.08×      | JSX + reactive       | Fastest; no virtual DOM            |
| **Preact** | **~3 KB**   | 1.43×      | **React-compatible** | **Smallest; `preact/compat` for React ecosystem** |
| Lit        | ~5 KB       | —          | Template literals    | Web Components standard            |

_¹ js-framework-benchmark weighted geometric mean vs vanilla JS (1.00×)._

**Why Preact:**

- **Smallest bundle** (3 KB gzip) — ideal for an app that shows ~4 dialogs.
- **React-compatible API** — the Sambee team already writes React/TypeScript; moving to Preact requires near-zero learning (same JSX, same hooks).
- `preact/compat` gives access to the React ecosystem if any component library is ever needed.
- The performance gap vs Solid.js (1.43× vs 1.08×) is irrelevant for dialogs that render once and wait for user input.

**Build tooling:** Vite + Preact plugin (`@preact/preset-vite`) — consistent with the Sambee frontend's Vite setup.

> **Note:** If the companion UI stays truly minimal (tray menu only, no visible windows), Vanilla TS is acceptable. Switch to Preact when building the App Picker or Preferences dialogs.

### 15.2 Localhost status endpoint → **Yes (Phase 2+)**

**Decision:** The companion will expose a local HTTP endpoint for browser-side companion detection.

When the companion is running, it listens on a fixed localhost port (e.g., `http://localhost:21549`):

```
GET http://localhost:21549/status
→ 200 { "version": "0.1.0", "activeFiles": [...] }
```

**Benefits:**

- The Sambee web UI can detect whether the companion is running and show a "connected" indicator.
- The web UI can query **editing status** of specific files — enabling real-time indicators like "📝 Being edited by you on this machine" next to files in the file browser.
- Other users could see locking status (via the backend, which is notified by the companion).

**Security:** The endpoint is localhost-only (`127.0.0.1`). CORS headers allow the Sambee web origin. No secrets are exchanged — only status information.

**Timeline:** Not required for MVP (Phase 1–2). Add in Phase 3 or later, after core functionality is solid.

### 15.3 Multiple simultaneous Sambee servers → **Supported passively**

**Decision:** The architecture already supports multiple servers (each `FileOperation` carries its own `server_url`). No special work needed for Phase 1.

The preferences UI will eventually need a "Trusted Servers" list (already in the security model, §11.2). Multi-server is not urgent but nothing in the design prevents it.

### 15.4 Mobile companion → **No**

**Decision:** No mobile companion planned. The deep-link architecture would work technically (Tauri v2 supports iOS/Android), but the edit-and-sync-back workflow makes no sense on mobile, and the use case is weak.

### 15.5 WebDAV alternative → **No**

**Decision:** WebDAV will not be pursued. The companion app provides a better UX (seamless download → edit → upload on done) and doesn't require network mount configuration. WebDAV also introduces auth and caching complexities the companion avoids.

### 15.6 Version coupling → **Independent versioning**

**Decision:** The companion is versioned independently from the Sambee backend/frontend.

A version-check endpoint on the backend ensures compatibility:

```
GET /api/companion/version-check?companion_version=0.1.0
→ 200 { "compatible": true, "min_companion_version": "0.1.0", "latest_version": "0.2.0" }
```

The companion checks this on startup and shows an update prompt if incompatible.

---

## 16. SMB File Locking During Edit

### 16.1 Goal

When a user opens a file via the companion for native editing, **lock the file on the SMB share** so other users cannot make conflicting edits. Other users should still be able to **view** (read) the file.

### 16.2 What the SMB protocol supports

The `smbprotocol` library (used by Sambee) provides two locking mechanisms:

#### Mechanism A: Share access control (high-level)

`smbclient.open_file()` accepts a `share_access` parameter:

| `share_access` | Others can read | Others can write | Others can delete |
|-----------------|-----------------|------------------|-------------------|
| `None` (default) | ❌              | ❌               | ❌                |
| `"r"`           | ✅              | ❌               | ❌                |
| `"rw"`          | ✅              | ✅               | ❌                |
| `"rwd"`         | ✅              | ✅               | ✅                |

**Sambee currently** uses `share_access="rwd"` (fully permissive) for all file reads.

**For edit locking:** Open the file with `share_access="r"` and **keep the handle open** for the duration of the edit. This allows other users to read/view the file but prevents writes and deletes at the SMB level.

#### Mechanism B: Byte-range locks (low-level)

The `Open.lock()` method sends SMB2 LOCK requests:

```python
from smbprotocol.open import Open, SMB2LockElement, LockFlags

lock_element = SMB2LockElement()
lock_element["offset"] = 0
lock_element["length"] = 0xFFFFFFFFFFFFFFFF  # entire file
lock_element["flags"] = LockFlags.SMB2_LOCKFLAG_SHARED_LOCK
# SMB2_LOCKFLAG_SHARED_LOCK  → others can read, not write
# SMB2_LOCKFLAG_EXCLUSIVE_LOCK → blocks all access

file_handle.lock([lock_element])
# ... later ...
unlock_element = SMB2LockElement()
unlock_element["offset"] = 0
unlock_element["length"] = 0xFFFFFFFFFFFFFFFF
unlock_element["flags"] = LockFlags.SMB2_LOCKFLAG_UNLOCK
file_handle.lock([unlock_element])
```

This is more granular (can lock byte ranges) but requires using the low-level API.

#### Mechanism C: Opportunistic locks (oplocks)

The SMB protocol supports oplocks — server-managed caching directives. The `smbprotocol` library supports requesting oplocks at file open time via `oplock_level` in `Open.create()`. Types: None, Level II (read-only caching), Exclusive, Batch.

Oplocks are designed for client-side caching coordination, not application-level locking. They are automatically broken by the server when another client needs access. **Not suitable** for our use case where we want a persistent lock.

### 16.3 Two-tier locking (both required)

Both tiers are implemented together. Tier 1 provides user-visible lock status in the web UI. Tier 2 enforces the lock at the SMB protocol level so that even direct SMB clients (e.g., Windows Explorer) cannot write to a locked file.

#### Tier 1: Application-level lock (user-visible)

A lock table in the Sambee database:

```python
# Data model
class EditLock:
    file_path: str           # "/docs/report.docx"
    connection_id: str       # UUID of the SMB connection
    locked_by: str           # Username
    locked_at: datetime      # When the lock was acquired
    companion_session: str   # Companion session ID (for cleanup)
    last_heartbeat: datetime # Updated every heartbeat cycle
```

> **No fixed expiry.** Files may legitimately be open for hours or days (e.g., a document being edited over a full workday). Instead, locks survive as long as the companion is alive and heartbeating. See §16.4 for the heartbeat lifecycle.

**New endpoints:**

```
POST   /api/companion/{connId}/lock?path=...        → Acquire lock
POST   /api/companion/{connId}/lock/heartbeat?path=… → Refresh heartbeat
DELETE /api/companion/{connId}/lock?path=...         → Release lock
DELETE /api/companion/{connId}/lock/force?path=...   → Force-unlock (any user)
GET    /api/viewer/{connId}/lock-status?path=...      → Check lock status
```

**How it works:**

1. When the companion downloads a file for editing, it also calls `POST /lock` to acquire the lock.
2. The Sambee web UI checks lock status and shows: _"📝 Locked for editing by alice (since 10:30 AM)"_ with a **"Force Unlock"** button.
3. Other users can view the file but the "Open in app" button shows: _"This file is being edited by alice. Force unlock?"_
4. The companion sends a heartbeat every **30 seconds** (see §16.4).
5. If the backend receives no heartbeat for **2 minutes**, it considers the companion dead and **automatically releases the lock**.
6. The companion releases the lock when the user clicks "Done Editing" (see §8.2.1).

**Advantages:** User-visible lock status in the web UI; heartbeat-based auto-cleanup of orphaned locks; force-unlock escape hatch.

**Limitation:** Direct SMB clients (e.g., Windows Explorer mapping the share) bypass this lock — which is why Tier 2 is also required.

#### Tier 2: SMB-level lock (protocol enforcement)

The backend enforces the lock at the SMB protocol level simultaneously with Tier 1:

1. When acquiring an edit lock, the backend **opens the file with `share_access="r"`** (others can read, not write).
2. The backend **holds the SMB file handle open** for the duration of the edit session.
3. Any other SMB client (including other Sambee instances and direct SMB users) attempting to write will get `STATUS_SHARING_VIOLATION` (0xc0000043).
4. The lock is released by closing the file handle — triggered by the same events that release Tier 1 ("Done Editing" click, heartbeat timeout, force-unlock).

**Implementation challenges:**

| Challenge | Mitigation |
|-----------|------------|
| Long-lived SMB handles (minutes to hours) | Heartbeat mechanism; periodic `SMB2 ECHO` to keep connection alive |
| Backend restart loses all handles | On startup, scan the lock table and re-acquire SMB handles for all active locks. Accept brief window of unlocked state during restart. |
| SMB connection timeout | Periodic dummy read or `SMB2 ECHO` every 60 seconds |
| Connection pool interaction | Edit-locked handles must be excluded from pool cleanup (`smb_pool.py` changes) |
| Memory/resource usage | One open handle per locked file — manageable for typical usage (tens of files) |

### 16.4 Heartbeat lifecycle & automatic lock release

The heartbeat is the **sole mechanism** for determining whether a lock is still valid. There is no fixed expiry timer.

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
   │ ... user clicks "Done Editing" (see §8.2.1) ...  │
   │ Final upload if file changed               │
   │ DELETE /lock (release)                     │
   │───────────────────────────────────────────>│  → Tier 1: delete EditLock row
   │                                            │  → Tier 2: close SMB handle
   │ ← 200 OK                                  │
   │<───────────────────────────────────────────│
```

**Heartbeat timeout (server-side):**

A background task on the backend runs every **30 seconds** and checks all active locks. If `now - last_heartbeat > 2 minutes`, the lock is considered **orphaned**:

1. Delete the `EditLock` row (Tier 1).
2. Close the SMB file handle (Tier 2).
3. Log a warning: _"Lock on /docs/report.docx released — companion session abc123 stopped heartbeating."_

This handles all failure modes: companion crash, network disconnect, machine sleep/shutdown, killed process.

### 16.5 Force-unlock from the web UI

Nothing is more frustrating than finding a file erroneously locked with no way to fix it. Every lock **must** be manually breakable from the Sambee web interface.

**UI in the file browser:**

When a file is locked, the file row shows:

```
┌────────────────────────────────────────────────────────────────────┐
│  📄 report.docx    📝 Being edited by alice (since 10:30 AM)      │
│                    [Force Unlock]                                  │
└────────────────────────────────────────────────────────────────────┘
```

**Force-unlock flow:**

1. User clicks **"Force Unlock"** → confirmation dialog: _"Are you sure? Alice may lose unsaved changes."_
2. On confirm → `DELETE /api/companion/{connId}/lock/force?path=...`
3. Backend releases both Tier 1 (database row) and Tier 2 (SMB handle).
4. If the companion is still alive and heartbeating, the next heartbeat returns `404` (lock gone). The companion shows a notification: _"⚠ Your edit lock on report.docx was released by another user. Save your work locally."_
5. The companion does **not** crash or lose the local file — it keeps the temp file and offers to re-upload.

**Who can force-unlock:** Only **admin users** and the **lock holder** (the user who acquired the lock). Other users see the lock status but the "Force Unlock" button is hidden. This prevents accidental data loss from casual unlocking while still ensuring someone can always break an erroneous lock.

### 16.6 Impact on existing code

The following existing code is relevant:

- [backend/app/storage/smb.py](backend/app/storage/smb.py) — `read_file()` currently opens with `share_access="rwd"`. Will need a new `lock_file()` / `unlock_file()` method for Tier 2 SMB locking.
- [backend/app/storage/smb.py](backend/app/storage/smb.py) — Already handles `STATUS_SHARING_VIOLATION` (0xc0000043) with retry logic. This same error would be returned to other clients when a file is locked. The error message should be improved to show "file is being edited by X" instead of a generic retry.
- [backend/app/storage/smb_pool.py](backend/app/storage/smb_pool.py) — Connection pool cleanup must not close connections that hold edit-lock file handles.

### 16.7 Implementation tasks

**Tier 1 (application-level lock — web UI visible):**
- [ ] Add `EditLock` model to database schema (no `expires_at`; use `last_heartbeat`)
- [ ] Add `POST /api/companion/{connId}/lock` endpoint (acquire)
- [ ] Add `POST /api/companion/{connId}/lock/heartbeat` endpoint (refresh)
- [ ] Add `DELETE /api/companion/{connId}/lock` endpoint (release)
- [ ] Add `DELETE /api/companion/{connId}/lock/force` endpoint (force-unlock)
- [ ] Add `GET /api/viewer/{connId}/lock-status` endpoint (query)
- [ ] Add lock status display in Sambee web UI file browser
- [ ] Add "Force Unlock" button with confirmation dialog in web UI
- [ ] Implement heartbeat timeout background task (release locks with no heartbeat > 2 min)
- [ ] Companion: send heartbeat every 30 seconds for each active edit
- [ ] Companion: handle `404` on heartbeat (lock was force-released) — notify user, keep local file

**Tier 2 (SMB-level lock — protocol enforcement):**
- [ ] Add `lock_file_for_edit()` to `SMBBackend` — opens with `share_access="r"`, holds the handle
- [ ] Add `unlock_file_for_edit()` to `SMBBackend` — closes the held handle
- [ ] Wire Tier 2 lock/unlock into the lock/release/force-unlock endpoints
- [ ] Keep-alive mechanism for long-lived SMB handles (`SMB2 ECHO` every 60s)
- [ ] Exclude edit-lock handles from pool cleanup in `smb_pool.py`
- [ ] Improve `STATUS_SHARING_VIOLATION` error message to include lock holder info from Tier 1
- [ ] Re-acquire SMB handles on backend restart from lock table
- [ ] Integration tests with concurrent SMB access

**"Done Editing" window (companion-side, enables explicit lock release):**
- [ ] Build "Done Editing" Tauri `WebviewWindow` (always-on-top, fixed ~340×180, movable, non-resizable, non-closable, non-minimizable)
- [ ] Implement `DoneEditingWindow.tsx` Preact component (shows filename + app name)
- [ ] Wire "Done Editing" click → final upload → lock release → window close → notification
- [ ] Remember window position across sessions (Tauri store)
- [ ] Support multiple concurrent "Done Editing" windows (one per active edit)
- [ ] Write tests for "Done Editing" → cleanup lifecycle
