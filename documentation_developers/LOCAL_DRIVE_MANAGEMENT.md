# Local Drive Management via Companion

## Goal

Enable browsing and managing local drives through the same UI used for SMB shares, by embedding an HTTP API server in the companion app that implements the same contract as the backend.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Browser)                                     │
│                                                         │
│  ConnectionSelector: SMB shares + local drives          │
│                                                         │
│  BackendRouter                                          │
│    ├─ SMB connections  ──►  /api  (Sambee server)       │
│    └─ Local drives     ──►  http://localhost:21549/api   │
│                               (Companion)               │
└─────────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
┌─────────────────┐       ┌──────────────────────┐
│  Sambee Backend  │       │  Companion (Tauri)    │
│  (FastAPI)       │       │                      │
│  StorageBackend  │       │  axum HTTP server    │
│    └─ SMBBackend │       │    └─ std::fs ops    │
└─────────────────┘       └──────────────────────┘
```

## Existing Foundations

| Asset | Relevance |
|---|---|
| `StorageBackend` ABC (15 methods) | Proves the API contract; companion reimplements it in Rust via `std::fs` |
| Companion has `tokio` full runtime | Ready for async HTTP server |
| Companion has full filesystem access | No sandboxing barriers |
| Port `21549` reserved in companion architecture doc | Designated for localhost endpoint |
| `Connection.type` field exists (`"smb"`) | Extensible to `"local"` |
| `tauri-plugin-store` | Preferences stored without needing SQLite |
| Cross-connection service uses abstract `read_file`/`write_file_from_stream` | Backend-agnostic streaming already works |

## Companion: axum API Server

Add `axum` (tokio-native, minimal footprint) bound to `127.0.0.1:21549`, started in the Tauri `setup()` hook.

### Endpoints

Mirrors the backend API contract. `{drive}` = an identifier for a mounted volume (e.g., `C:`, `D:` on Windows; volume UUID or mount-point slug on macOS/Linux). The companion auto-discovers all accessible drives and volumes, including virtual drives (Google Drive, OneDrive, iCloud, Dropbox, etc.) that appear as mounted filesystems.

| Method | Path | Backend equivalent | Implementation |
|---|---|---|---|
| `GET` | `/api/health` | `/api/health` | Returns `{"status":"healthy","paired":bool}` |
| `POST` | `/api/pair/initiate` | *(new)* | Start pairing: receive browser nonce, return companion nonce + pairing ID |
| `POST` | `/api/pair/confirm` | *(new)* | Confirm pairing after dual code verification, return shared secret |
| `GET` | `/api/drives` | *(new)* | Auto-enumerate all mounted drives/volumes |
| `GET` | `/api/browse/{drive}/list` | `/api/browse/{conn}/list` | `std::fs::read_dir` |
| `GET` | `/api/browse/{drive}/info` | `/api/browse/{conn}/info` | `std::fs::metadata` |
| `GET` | `/api/browse/{drive}/directories` | `/api/browse/{conn}/directories` | Recursive dir scan |
| `GET` | `/api/viewer/{drive}/file` | `/api/viewer/{conn}/file` | `tokio::fs` streaming |
| `GET` | `/api/viewer/{drive}/download` | `/api/viewer/{conn}/download` | Streaming + `Content-Disposition` |
| `POST` | `/api/browse/{drive}/upload` | `/api/browse/{conn}/upload` | Multipart → `tokio::fs::File` |
| `DELETE` | `/api/browse/{drive}/item` | `/api/browse/{conn}/item` | `remove_file` / `remove_dir_all` |
| `POST` | `/api/browse/{drive}/rename` | `/api/browse/{conn}/rename` | `std::fs::rename` |
| `POST` | `/api/browse/{drive}/create` | `/api/browse/{conn}/create` | `create_dir` / `File::create` |
| `POST` | `/api/browse/{drive}/copy` | `/api/browse/{conn}/copy` | `fs::copy` / recursive |
| `POST` | `/api/browse/{drive}/move` | `/api/browse/{conn}/move` | `std::fs::rename` |
| `WS` | `/api/ws` | `/api/ws` | `notify` crate → same JSON protocol |

### Response Format

All responses use the same JSON shapes as the backend (`DirectoryListing`, `FileInfo`, etc.) so the frontend needs zero model changes.

### Security

- Bind to `127.0.0.1` only — no remote access.
- CORS: `Access-Control-Allow-Origin` set to the paired server's origin.
- All API requests (except `GET /api/health` and pairing endpoints) require a valid `X-Companion-Secret` header carrying `HMAC-SHA256(shared_secret, timestamp)`. This protects against both browser-based attacks and local native processes.

#### Pairing Protocol

Before any API usage, a one-time pairing between the Sambee frontend and the companion is required. This is modeled after Bluetooth Secure Simple Pairing (Numeric Comparison):

```
  Browser (Sambee frontend)                  Companion (tray app)
     │                                            │
     │  1. POST /api/pair/initiate                 │
     │     { nonce_browser: "<random 32 bytes>" }  │
     │────────────────────────────────────────────►│
     │                                             │  2. Generate nonce_companion
     │  3. { pairing_id, nonce_companion }          │
     │◄────────────────────────────────────────────│
     │                                             │
     │  4. Both sides independently compute:       │
     │     code = SHA-256(nonce_browser ‖ nonce_companion)
     │     Display first 6 chars as pairing code   │
     │                                             │
     │  ┌─────────────────────┐  ┌───────────────────────────┐
     │  │ Browser dialog:     │  │ Companion native dialog:  │
     │  │ Pairing code: A7X3F2│  │ Pairing code: A7X3F2      │
     │  │ Does this match the │  │ Does this match the code  │
     │  │ companion?  [Yes/No]│  │ in your browser? [Yes/No] │
     │  └─────────────────────┘  └───────────────────────────┘
     │                                             │
     │  5. User confirms on BOTH sides             │
     │                                             │
     │  6. POST /api/pair/confirm                  │
     │     { pairing_id }                          │
     │────────────────────────────────────────────►│
     │                                             │  7. Companion verifies its own
     │                                             │     dialog was also confirmed
     │  8. { secret: "<shared_secret>" }            │
     │◄────────────────────────────────────────────│
     │                                             │
     │  Both sides persist the secret:             │
     │    Browser: localStorage (keyed by origin)  │
     │    Companion: tauri-plugin-store             │
     │                                             │
     │  ═══ All future requests ═══                │
     │  X-Companion-Secret: HMAC-SHA256(secret, ts)│
     │────────────────────────────────────────────►│
```

**Why dual confirmation matters:** A rogue local process could call `POST /api/pair/initiate`, but it cannot click "Confirm" on the companion's native dialog. And the user won't confirm an unexpected pairing prompt they didn't initiate from their browser. The native dialog acts as an unforgeable user-intent gate.

**Replay protection:** Requests include `HMAC-SHA256(shared_secret, timestamp)` rather than the raw secret. The companion rejects requests where the timestamp deviates by more than 30 seconds.

**Per-server pairing:** The companion stores `Map<origin, shared_secret>` so different Sambee instances have independent pairings. Revoking one (via companion preferences) doesn't affect others.

**Secret storage:** The shared secret is stored in the OS keychain via the `keyring` Rust crate — not in the plaintext `tauri-plugin-store` JSON files:

| OS | Backend | Protection |
|---|---|---|
| macOS | Keychain | Encrypted at rest, per-app ACLs, survives reinstalls |
| Windows | Credential Manager | DPAPI-encrypted, per-user isolation |
| Linux | `libsecret` (gnome-keyring / kwallet) | Encrypted, session-locked |

This prevents other users and sandboxed processes from reading the secret, even if they can access the companion's AppData directory. The `keyring` crate provides a uniform API across all three platforms. On the browser side, the secret is stored in `localStorage` keyed by companion origin — acceptable since same-origin browser storage is already protected by the browser's security model.

**Unpaired health check:** `GET /api/health` remains unauthenticated and returns `{ status: "healthy", paired: bool }`. This lets the frontend detect the companion and show a "Pair with Companion" action when not yet paired.

#### Threat Model Summary

| Threat | Mitigation |
|---|---|
| Remote network access | Blocked — bound to `127.0.0.1` |
| Other website in browser | Blocked — CORS + no shared secret |
| Local native process (unsandboxed) | **Blocked** — no shared secret; can't confirm native dialog. (Note: such a process already has equivalent `std::fs` access, so no privilege escalation even if bypassed.) |
| Local sandboxed app (restricted fs, has network) | **Blocked** — no shared secret; can't confirm native dialog; can't read companion store |
| XSS on the Sambee app | Attacker's script could read the secret from localStorage. Mitigated by standard XSS defenses (CSP, input sanitization). Access is scoped to what the companion's user account can reach. |

### Drive Enumeration

The companion automatically discovers all mounted drives and volumes accessible to the user account it runs under. No manual configuration is required.

**Platform-specific enumeration:**

| OS | Method | What it finds |
|---|---|---|
| Windows | `GetLogicalDriveStrings` + `GetVolumeInformation` + `GetDriveType` | `C:`, `D:`, mapped network drives, virtual drives (Google Drive `G:`, OneDrive, etc.) |
| macOS | `/Volumes/` listing + `statvfs` | Macintosh HD, external drives, Google Drive / OneDrive / Dropbox (mounted via FUSE or CloudKit) |
| Linux | Parse `/proc/mounts` or `/etc/mtab`, filter by filesystem type | `/`, `/home`, external mounts, FUSE-based cloud drives (rclone, google-drive-ocamlfuse), Flatpak-exposed paths |

**Virtual drive support:** Cloud sync clients (Google Drive, OneDrive, Dropbox, iCloud) typically expose files through the native filesystem — as mounted volumes (macOS/Linux) or mapped drive letters / special shell folders (Windows). Since the companion uses standard `std::fs` operations, these work transparently. Files with cloud-only / offline status are handled by the sync client's filesystem driver, not by the companion.

**Drive response format:**

```json
[
  { "id": "c", "name": "Windows (C:)", "drive_type": "fixed" },
  { "id": "d", "name": "Data (D:)", "drive_type": "fixed" },
  { "id": "g", "name": "Google Drive (G:)", "drive_type": "virtual" },
  { "id": "volumes-external", "name": "External SSD", "drive_type": "removable" }
]
```

**Access scope:** The companion exposes everything the user account can access — identical to opening a file manager. A path-restriction feature can be added later to limit which drives or directories are exposed.

**Filtering:** System/pseudo filesystems (`/proc`, `/sys`, `/dev`, `tmpfs`, `devfs`) are excluded from enumeration to avoid clutter and prevent access to non-file content.

## Frontend Changes

### 1. Backend Router

New module that maps connection IDs to base URLs:

- SMB connections → existing `/api` (relative, proxied to Sambee server)
- Local drives → `http://localhost:21549/api`

The `ApiService` gains a per-request base URL override, or we introduce a thin wrapper that selects the appropriate Axios instance.

### 2. Companion Detection & Pairing

On `FileBrowser` mount, `fetch("http://localhost:21549/api/health")` with a 1-second timeout.

- **Not reachable** → local drives don't appear; no error state.
- **Reachable, `paired: false`** → show a "Pair with Companion" action in the connection selector. Clicking it initiates the pairing flow (browser shows its code, waits for companion-side confirmation, exchanges secret).
- **Reachable, `paired: true`** → `GET /api/drives` (with HMAC auth) retrieves all accessible drives. These are merged into the connection list with `type: "local"`.

The shared secret is stored in `localStorage` keyed by companion origin (`companion_secret_localhost:21549`).

### 3. Connection Selector

Local drives appear alongside SMB shares, visually distinguished (e.g., drive icon vs. network icon). Selecting a drive routes all API calls through the companion.

### 4. Auth Handling

The Axios request interceptor detects companion-bound requests (by base URL) and replaces the Bearer token with an `X-Companion-Secret: HMAC-SHA256(secret, timestamp)` header plus an `X-Companion-Timestamp` header. No server-issued JWTs are used for companion requests.

### 5. File/Download URLs

`getViewUrl()` and `getDownloadUrl()` must use the correct base URL per connection. These already receive `connectionId` — the backend router resolves the right base.

### 6. WebSocket

Maintain a second WebSocket connection to `ws://localhost:21549/api/ws` when the companion is active. Subscription management already supports per-pane connection tracking.

## Scoping Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Image conversion in companion | No — serve raw files | Most local files are browser-compatible; avoids bundling pyvips/Ghostscript |
| Edit locking for local files | No | No concurrent access concern for local drives |
| Cross-backend transfers (SMB ↔ local) | Phase 3 | Requires browser-mediated relay; not needed for initial value |
| Directory cache in companion | Simple in-memory | No need for disk persistence like the SMB cache |
| Companion-side auth | Pairing protocol + HMAC secret | One-time Bluetooth-style pairing with dual confirmation; HMAC on every request; blocks browser-based and native-process attacks |
| Drive scope | Full access — all mounted drives | Matches file manager behavior; path restrictions can be added later |
| Cloud/virtual drive files with offline status | Rely on sync client's filesystem driver | No special handling needed; access triggers download transparently |

## Phases

### Phase 1 — Read-Only Browsing

**1a — Companion HTTP server** ✅ COMPLETE
- axum server bound to `127.0.0.1:21549`, started in Tauri `setup()` hook
- Drive enumeration: `GET /api/health`, `GET /api/drives`
- Browse endpoints: `GET /api/browse/{drive}/list`, `GET /api/browse/{drive}/info`
- Pairing protocol: `POST /api/pair/initiate`, `POST /api/pair/confirm`
- HMAC-SHA256 auth middleware
- Shared secret stored in OS keychain via `keyring` crate
- Implementation: `companion/src-tauri/src/server/` (mod.rs, handlers.rs, auth.rs, pairing.rs, drives.rs, models.rs, errors.rs)

**1b — Frontend routing** ✅ COMPLETE
- Backend router module: maps connection IDs to base URLs
- Companion detection on `FileBrowser` mount (`/api/health` probe)
- Pairing UI: code display dialog, confirmation flow
- Drive display in connection selector (drive icon, `type: "local"`)
- Auth handling: HMAC headers for companion requests, Bearer for server requests
- Implementation: `frontend/src/services/companion.ts`, `frontend/src/services/backendRouter.ts`, `frontend/src/hooks/useCompanion.ts`, `frontend/src/components/FileBrowser/CompanionPairingDialog.tsx`

**1c — File viewing & download** ✅ COMPLETE
- Companion: `GET /api/viewer/{drive}/file` (streaming with `Content-Disposition: inline`)
- Companion: `GET /api/viewer/{drive}/download` (streaming with `Content-Disposition: attachment`)
- Query-param auth middleware (`require_auth_or_query`) for `<img src>` / `<iframe>` URLs
- Frontend: `getViewUrl()` / `getDownloadUrl()` async with HMAC query-param auth
- Frontend: `getImageBlob()`, `getPdfBlob()`, `getFileContent()`, `downloadFile()` use HMAC headers
- Fixed HMAC key encoding: both sides now use UTF-8 bytes of the hex secret string
- **Milestone: first shippable version — browse and view local files**

### Phase 2 — Full File Management

**2a — Write operations** ✅ COMPLETE
- Companion: `delete`, `rename`, `create`, `copy`, `move` endpoints with path-traversal protection
- Frontend: write operation routing via `getClientConfig()`/`getBrowseSegment()` pattern
- Confirmation dialogs are connection-type agnostic — no UI changes needed
- Error responses use `{"detail": ...}` format matching FastAPI's HTTPException
- Copy/move return 409 with structured `ConflictInfo` for overwrite prompts

**2b — Live updates** ✅ COMPLETE
- Companion: `notify` crate filesystem watcher with debouncing (300ms window)
- Companion: WebSocket endpoint at `/api/ws` with query-param HMAC auth
- Companion: subscriber counting — one OS watcher per directory, shared across clients
- Frontend: dual WebSocket management (server + companion, independent reconnection)
- Frontend: subscription routing based on `isLocalDrive()` connection type
- Directory listings update in real-time on file changes
- **Milestone: full local file management with live updates**

### Phase 3 — Advanced Integration

**3a — Direct local open** ✅ COMPLETE
- Companion: `POST /api/browse/{drive}/open` opens files with the system default app
- Platform-specific: `xdg-open` (Linux), `open` (macOS), `ShellExecuteW` (Windows)
- Frontend: `handleOpenInApp` detects `isLocalDrive()` → calls `openLocalFile()` instead of deep-link flow
- No download, no edit lock, no upload, no "Done Editing" window — zero latency
- Edits save directly to the original file on disk

**3b — Cross-backend transfers** ✅ COMPLETE
- **Cross-drive copy/move (local → local)**: Companion now handles `dest_connection_id` for different local drives. Extracts drive ID from `"local-drive:X"` prefix, resolves destination on the other drive. Cross-drive moves use copy + delete (since `rename()` fails across mount points).
- **Companion upload endpoint**: `POST /api/browse/{drive}/upload?path=...` accepts multipart form data (`file` field), writes to drive. Returns `UploadResponse` matching backend contract.
- **Browser-mediated cross-backend transfers (SMB ↔ local)**: Frontend detects `isCrossBackendTransfer()` when source and destination are on different backend types. Downloads file blob from source via viewer endpoint, uploads to destination via multipart POST. Supports recursive directory transfers (`crossBackendCopyDirectory`). Cross-backend move = cross-backend copy + delete source.
- **Conflict detection**: For cross-backend file copies, checks if destination exists before uploading; throws 409-like error if `overwrite` is false.
- **Same-backend transfers unchanged**: SMB↔SMB still handled natively by Python backend; local↔local same-drive still handled by companion's `tokio::fs`.

**3c — Unified search** ✅ COMPLETE
- Companion: `GET /api/browse/{drive}/directories?q=...` walks filesystem recursively, returns matching directory paths
- Uses `walk_directories()` with `MAX_DIRECTORY_SCAN` (100k) limit and hidden-directory skipping
- Returns `DirectorySearchResult`-compatible JSON (`results`, `total_matches`, `cache_state`, `directory_count`)
- Frontend: removed early-return guard in `searchDirectories()` — routes through `getClientConfig()`/`getBrowseSegment()` like all other operations
- No persistent cache (unlike backend's `DirectoryCache`) — walks on each request; fast enough for local drives
- **Milestone: seamless integration between local and remote storage**

## Key Risks

| Risk | Mitigation |
|---|---|
| CORS restrictions | Companion sets explicit `Access-Control-Allow-Origin`; all modern browsers support localhost CORS |
| Companion not running | Graceful degradation — local drives simply don't appear; no error state |
| Port conflict on 21549 | Detect and show a clear message in companion; consider fallback port |
| Large file transfers through browser (phase 3) | Stream with progress; cap at reasonable size with a warning |
| Platform-specific filesystem behavior | Rust's `std::fs` abstracts most differences; test on Windows/macOS/Linux |
