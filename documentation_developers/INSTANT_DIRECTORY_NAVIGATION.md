# Instant Directory Navigation (Quick Navigate)

## Overview

A Ctrl+P-style quick-open that searches **all directory paths** across the current SMB connection and displays results in a dropdown, enabling instant navigation. The search bar does not filter the current file list but instead searches across all directories (not files) of the current connection.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     FRONTEND                              │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  QuickNavigate (Ctrl+K or similar hotkey)           │ │
│  │  ┌───────────────────────────────────────────────┐  │ │
│  │  │ 🔍  deliverables                          ▼   │  │ │
│  │  ├───────────────────────────────────────────────┤  │ │
│  │  │ projects/2024/client-a/deliverables            │  │ │
│  │  │ projects/2024/client-b/deliverables            │  │ │
│  │  │ archive/deliverables                           │  │ │
│  │  └───────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────┘ │
│           │  GET /browse/{id}/directories?q=deliverables  │
└───────────┼──────────────────────────────────────────────┘
            ▼
┌──────────────────────────────────────────────────────────┐
│                     BACKEND                               │
│                                                           │
│  ┌──────────────────────┐  ┌───────────────────────────┐ │
│  │  DirectoryCache      │  │  DirectoryCacheUpdater     │ │
│  │  (per connection)    │  │  (CHANGE_NOTIFY watcher)   │ │
│  │                      │  │                             │ │
│  │  • set[str] of all   │◄─┤  • Root handle + WATCH_TREE│ │
│  │    directory paths    │  │  • DIR_NAME filter only    │ │
│  │  • fuzzy search API  │  │  • On ADD: scan + add      │ │
│  │  • built via BFS     │  │  • On REMOVE: prune tree   │ │
│  │                      │  │  • On RENAME: update path   │ │
│  │  State:              │  │  • On overflow: full rescan │ │
│  │  • BUILDING (scan)   │  │                             │ │
│  │  • READY (complete)  │  └───────────────────────────┘ │
│  │  • UPDATING (rescan) │                                 │
│  └──────────────────────┘                                 │
│           │                                               │
└───────────┼───────────────────────────────────────────────┘
            ▼
┌──────────────────────────────────────────────────────────┐
│  SMB Share (via smbprotocol low-level API)                │
│  • Compound requests: Create+QueryDir+Close per dir      │
│  • FileDirectoryInformation (0x01) — minimal payload     │
│  • 10-16 parallel workers within SMB credit limits       │
└──────────────────────────────────────────────────────────┘
```

---

## Research Findings

### 1. Real-Time Monitoring of an Entire SMB Share

**Feasible.** `SMB2_CHANGE_NOTIFY` with `SMB2_WATCH_TREE` on the share root gives near-real-time directory change notifications with a single pending request. The existing `DirectoryMonitor` already uses `SMB2_WATCH_TREE` and `FileSystemWatcher`.

| Capability | Status |
|---|---|
| Watch entire share tree from root | Supported (`SMB2_WATCH_TREE` on root path) |
| Filter to directory-only changes | Supported (`FILE_NOTIFY_CHANGE_DIR_NAME = 0x02`) |
| Get changed path in notification | Yes — `FILE_NOTIFY_INFORMATION` includes the relative path |
| Single connection / single thread | Yes — one handle on the share root is sufficient |

**Buffer overflow risk:** When changes happen faster than the client processes them, the server returns `STATUS_NOTIFY_ENUM_DIR` and all change details are lost. Mitigations:
- Use maximum buffer: `output_buffer_length=65536` (64 KB hard protocol limit) — current code uses only 4096.
- Filter only `FILE_NOTIFY_CHANGE_DIR_NAME` (directories change far less frequently than files).
- On overflow: do not (!) trigger a full re-scan.

**Samba vs Windows Server:** Windows handles recursive watchers efficiently (kernel-level NTFS filter driver). Samba on Linux translates this to `inotify` — one watch per directory, default kernel limit of 8192 (`fs.inotify.max_user_watches`). This can be exhausted on large shares but is configurable.

### 2. SMB3 Features That Increase Efficiency

#### a) Compound Requests (biggest win)

SMB3 supports **related compound requests** — bundling `Create + QueryDirectory + Close` into a single network round trip per directory. The `smbprotocol` library has full support via `Connection.send_compound()`.

**Impact: Reduces round trips by 3x** (from 3 per directory to 1).

#### b) Optimal Information Class

The current code uses `smbclient.scandir()` which fetches `FileIdBothDirectoryInformation` (~100+ bytes/entry). For a directory-only scan, use `FileDirectoryInformation` (0x01) — includes `file_attributes` to identify directories but is ~40-60 bytes/entry. **~50% less data per entry.**

#### c) Parallelism

SMB credit-based flow control allows ~10-20 concurrent operations. Combined with compounds, this enables efficient BFS traversal.

#### d) Leases (lower priority)

SMB3 read leases on directories allow caching listing results until the server issues a lease break. However, `CHANGE_NOTIFY` is simpler and more reliable for cache invalidation — leases add complexity without significant benefit here.

---

## Performance Projections

### Initial Full Scan (with compounds + 10 parallel workers)

| Share Size | Directories | LAN (1ms RTT) | Cross-subnet (10ms) |
|---|---|---|---|
| Small | 1,000 | < 1s | ~1s |
| Medium | 10,000 | ~1s | ~10s |
| Large | 50,000 | ~5s | ~50s |
| Very large | 100,000 | ~10s | ~100s |

### Memory Footprint (directory paths only)

| Directories | Memory (Python objects) |
|---|---|
| 10,000 | ~3 MB |
| 50,000 | ~14 MB |
| 100,000 | ~28 MB |

A trie/prefix-compressed structure could reduce this by 50-70%.

### Search Response Time

In-memory fuzzy/substring matching over 100K directory paths: **< 10ms**. This is truly instant.

---

## Implementation Plan

### Phase 1 — Initial Scan (background, on first use or connection)

1. BFS traversal from share root using compound requests + parallel workers.
2. Extract only entries with `FILE_ATTRIBUTE_DIRECTORY` flag.
3. Store paths in a flat `set[str]` (simple) or trie (memory-optimized) per `connection_id`.
4. Expose cache state: `BUILDING` → `READY`.
5. Frontend can already search partial results during `BUILDING` state (progressive loading).

**Key:** Use the low-level `smbprotocol` API (`Open`, `TreeConnect`, `Connection.send_compound()`), not `smbclient` — for compounds, custom info classes, and direct `FileSystemWatcher` control. The existing `DirectoryMonitor` already demonstrates this pattern.

### Phase 2 — Live Updates (CHANGE_NOTIFY)

1. After initial scan, open **one** handle on share root.
2. Start `FileSystemWatcher` with:
   - `completion_filter = FILE_NOTIFY_CHANGE_DIR_NAME` (only directory structure changes)
   - `flags = SMB2_WATCH_TREE` (entire tree)
   - `output_buffer_length = 65536` (max 64 KB)
3. On notification, parse `FILE_NOTIFY_INFORMATION`:
   - `FILE_ACTION_ADDED` → scan new directory for subdirs, add to cache.
   - `FILE_ACTION_REMOVED` → remove path + all children from cache.
   - `FILE_ACTION_RENAMED_*` → update path in cache.
4. On `STATUS_NOTIFY_ENUM_DIR` (buffer overflow) → do nothing. The next scheduled full rescan or other mechanisms (see below) will update the cache in due time.
5. Re-issue `CHANGE_NOTIFY` immediately after each notification.

### Phase 3 — API Endpoint

```
GET /browse/{connection_id}/directories?q=<search_term>
```

- Substring/fuzzy match on the in-memory path cache.
- Return top N results (e.g., 50), ranked by match quality.
- Response time: < 10ms.
- Include cache state in response so frontend can show an "Indexing..." indicator.

### Phase 4 — Frontend Component

- Dropdown overlay triggered by keyboard shortcut (e.g., Ctrl+K).
- Debounced search input (150-200ms).
- Keyboard navigation: Up/Down to move selection, Enter to navigate, Escape to close.
- Show cache state ("Indexing..." during `BUILDING`).
- Progressive results during scan.

---

## Samba on Linux: CHANGE_NOTIFY Deep Dive

### How Samba Implements CHANGE_NOTIFY

Samba translates SMB2 `CHANGE_NOTIFY` to Linux kernel notifications via a multi-layered architecture:

```
SMB Client (CHANGE_NOTIFY request)
       ↓
smbd worker process (source3/smbd/notify.c)
       ↓ (MSG_SMB_NOTIFY_REC_CHANGE)
notifyd daemon (source3/smbd/notifyd/notifyd.c)
  → sys_notify_watch() → inotify_watch()
       ↓ (kernel inotify events)
notifyd_sys_callback()
       ↓ (MSG_PVFS_NOTIFY)
smbd: notify_fsp() → reply to SMB client
```

**Key components:**
- **`notifyd`** — central daemon maintaining an in-memory Red-Black Tree of watch entries, indexed by absolute path. Dispatches kernel events to interested `smbd` worker processes.
- **Backend selection** (in `source3/smbd/server.c`): inotify (default, preferred) → FAM (fallback) → no kernel backend (internal-only detection).
- **For recursive `WATCH_TREE`**: notifyd uses **path-prefix matching** — when a change at `/a/b/c/file` arrives, it walks up the path tree checking for recursive watchers at `/a/b/c`, `/a/b`, `/a`.

### smb.conf Parameters

| Parameter | Scope | Default | Description |
|---|---|---|---|
| `change notify` | Global | `yes` | Master switch for CHANGE_NOTIFY support |
| `kernel change notify` | Global | `yes` | Use inotify/FAM for kernel-level notifications. If `no`, only changes made through Samba itself are detected (via notifyd messaging). External changes are **not** detected. |
| `notify:inotify` | Hidden | `true` | Can disable inotify specifically |
| `notify:fam` | Hidden | `true` (if no inotify) | Can force FAM backend |

### inotify Limitations on Samba

| Limitation | Impact | Severity |
|---|---|---|
| **Not recursive** | Samba adds one `inotify_add_watch()` per directory for `WATCH_TREE`. The notifyd daemon handles prefix-matching to simulate recursion. | Medium |
| **`max_user_watches` limit** | Default 8192 (some distros: 65536). Exhausted on large shares → new watches silently fail. **Must be tuned.** | **High** |
| **`max_queued_events` overflow** | Default 16384. Samba does **NOT** explicitly handle `IN_Q_OVERFLOW` — overflowed events are silently lost. | **High** |
| **`FILE_NOTIFY_CHANGE_SIZE` unreliable** | Not in inotify mapping table. Size-only changes may not trigger notifications. Use `FILE_NOTIFY_CHANGE_LAST_WRITE` instead. | Medium |
| **Rename complexity** | Samba accumulates `IN_MOVED_FROM` events for 100ms waiting for matching `IN_MOVED_TO`. Unmatched moves after timeout are treated as deletes. | Low |
| **Network-backed shares (NFS)** | inotify does **NOT** work on NFS mounts. Changes by remote NFS clients are invisible. | **Critical** (if applicable) |

### Samba Version History: No CHANGE_NOTIFY Improvements

Reviewed all release notes from **Samba 4.15 through 4.24rc2** (current as of Feb 2026). **No changes to the CHANGE_NOTIFY, inotify, or notifyd subsystems in any release.** The implementation has been stable/unchanged since the notifyd daemon was introduced (~2014).

Notable related improvements:
- **4.17**: `openat2` with `RESOLVE_NO_SYMLINKS` (performance)
- **4.18**: Locking overhead reduced ~3x
- **4.21**: CephFS VFS module (but no notify improvements)

### fanotify: Not Supported by Samba

Samba has **zero fanotify support** — the string "fanotify" does not appear anywhere in the Samba source tree.

**Why fanotify would be attractive** for our use case:

| Feature | inotify | fanotify |
|---|---|---|
| Filesystem-wide monitoring | Per-directory only | `FAN_MARK_FILESYSTEM` (Linux 4.20+) |
| Recursive monitoring | Manual per-directory | `FAN_MARK_MOUNT` covers entire mount |
| Directory events | Always supported | Since Linux 5.1 |
| Rename with old+new name | Cookie-based (100ms timeout) | `FAN_RENAME` (Linux 5.17+) |
| Watch limits | `max_user_watches` (per-user) | Per-group limits, more scalable |
| Requires | No special privileges | `CAP_SYS_ADMIN` for filesystem mode |

**Why it hasn't been adopted:** Directory events only since 2019, rename support only since 2022, requires elevated privileges, and the existing inotify implementation has been stable since 2006.

**Bottom line:** fanotify adoption by Samba would eliminate the `max_user_watches` problem entirely, but there's no indication this is planned.

---

## Filesystem Dependency

Whether CHANGE_NOTIFY works correctly depends on the filesystem underlying the Samba share, because Samba relies on Linux's inotify, which in turn relies on the filesystem implementing VFS (fsnotify) hooks properly.

### Filesystem Comparison

| Filesystem | inotify Support | Known Limitations |
|---|---|---|
| **ext4** | Full | None. The gold standard. |
| **XFS** | Full | None. Widely tested with Samba. |
| **btrfs** | Full (normal I/O) | `btrfs send/receive` and snapshot operations bypass VFS — **no inotify events**. Each subvolume has its own `st_dev`, so watches don't cross subvolume boundaries. |
| **ZFS (OpenZFS)** | Full (normal I/O) | `zfs send/receive`, `zfs rollback`, `zfs clone`, and snapshot operations bypass VFS — **no inotify events**. ZFS Event Daemon (`zed`) monitors pool-level events only, not file-level changes. |
| **NFS (re-exported via Samba)** | **Broken** | inotify only sees local VFS operations. Changes by other NFS clients or on the NFS server are **invisible**. Re-exporting NFS via Samba with CHANGE_NOTIFY is fundamentally unreliable. |
| **CIFS/SMB (re-mounted)** | **Broken** | Same as NFS — remote changes not detected by local inotify. |
| **tmpfs** | Full | Rarely relevant for Samba shares. |

### Key Takeaways

- **ext4 and XFS**: No issues. Recommended for Samba shares requiring reliable change notifications.
- **ZFS and btrfs**: Work correctly for normal file operations (create, delete, rename, write). Blind to administrative/snapshot operations — but these rarely affect the directory structure users care about for navigation.
- **NFS-backed Samba**: **Do not rely on CHANGE_NOTIFY.** A polling-based fallback is essential.

### Recommended `sysctl` Tuning for Large Shares

```bash
# Increase inotify watch limit (default: 8192)
# Needed for recursive WATCH_TREE on large directory trees
echo 524288 > /proc/sys/fs/inotify/max_user_watches

# Increase event queue size (default: 16384)
echo 65536 > /proc/sys/fs/inotify/max_queued_events

# Make persistent across reboots
echo "fs.inotify.max_user_watches = 524288" >> /etc/sysctl.conf
echo "fs.inotify.max_queued_events = 65536" >> /etc/sysctl.conf
```

Each inotify watch consumes ~1 KB of kernel memory. 524288 watches ≈ 512 MB — acceptable on modern servers.

---

## How Other Tools Handle This

### Industry Comparison

| Tool | Primary Detection | Uses SMB CHANGE_NOTIFY | Polling Fallback | Polling Interval | Hybrid (Watch + Scan) |
|---|---|---|---|---|---|
| **Windows Explorer** | SMB2 CHANGE_NOTIFY | Yes (recursive) | Manual F5 | N/A | No |
| **macOS Finder** | CHANGE_NOTIFY + polling | Partial | Yes | ~10-30s | Yes |
| **Nextcloud (SMB ext.)** | Cron `files:scan` | Optional | Yes (primary) | 15 min (cron) | No |
| **Syncthing** | inotify + periodic full scan | No (local only) | Yes (full scan) | 60 min | **Yes** |
| **VS Code Remote** | inotify on remote host | No | WSL1 fallback | Configurable | No |
| **Rclone** | Dir cache TTL expiry | No | Yes (optional) | 1 min | Partial |
| **lsyncd** | inotify | No (local only) | No | N/A | No |
| **Seafile** | inotify + WebSocket push | No | No | N/A | **Yes** |
| **FileZilla / WinSCP** | On-demand listing | No | Manual refresh | N/A | No |

### Key Industry Patterns

1. **Nobody relies solely on CHANGE_NOTIFY.** Even Windows Explorer has F5 refresh. Every tool implements at least one fallback.

2. **"Scan + Watch" hybrid is the gold standard.** Syncthing is the clearest example: continuous kernel watchers for low-latency detection + periodic full scans as a safety net. Their rationale: *"it is possible that some changes aren't picked up by [the watcher]."*

3. **Event debouncing is universal:**
   - Syncthing: 10-second accumulation window
   - lsyncd: a few seconds aggregation
   - This prevents notification storms from overwhelming the system

4. **Common polling intervals:**
   - Aggressive: 1 minute (rclone)
   - Normal: 5–15 minutes (Nextcloud, rclone dir-cache)
   - Conservative: 60 minutes (Syncthing full rescan)

5. **"Eventual consistency" caching patterns:**
   - TTL-based (rclone: 5 min `--dir-cache-time`)
   - Always-stale-root (Nextcloud: share root always returns "changed")
   - Fingerprinting (rclone: size + mtime + hash comparison)

## Recommendation for Our Implementation

Based on our findings, our architecture should follow the **Syncthing model**:

1. **Primary:** `CHANGE_NOTIFY` with `WATCH_TREE` on share root (directory-only filter) for near-real-time updates.
2. **Safety net:** Periodic full re-scan (configurable, default: 60 minutes) to catch any missed events.
3. **Debounce:** Aggregate CHANGE_NOTIFY events for 1–2 seconds before updating the cache.
4. **Stale serving:** During re-scans, keep serving the existing cache (eventual consistency is acceptable for navigation).

### Additional implementation notes and requirements:

- Maintain the cache per connection, not per user.
- Use any update mechanism we already have (watching the currently displayed directory, user presses F5, ...) to also update the cache.

---

## Technical Notes

- **`CompletionFilter` flags available in smbprotocol:**
  - `FILE_NOTIFY_CHANGE_FILE_NAME` (0x001), `FILE_NOTIFY_CHANGE_DIR_NAME` (0x002), `FILE_NOTIFY_CHANGE_ATTRIBUTES` (0x004), `FILE_NOTIFY_CHANGE_SIZE` (0x008), `FILE_NOTIFY_CHANGE_LAST_WRITE` (0x010), `FILE_NOTIFY_CHANGE_LAST_ACCESS` (0x020), `FILE_NOTIFY_CHANGE_CREATION` (0x040), `FILE_NOTIFY_CHANGE_EA` (0x080), `FILE_NOTIFY_CHANGE_SECURITY` (0x100), `FILE_NOTIFY_CHANGE_STREAM_NAME` (0x200), `FILE_NOTIFY_CHANGE_STREAM_SIZE` (0x400), `FILE_NOTIFY_CHANGE_STREAM_WRITE` (0x800).
- **`FileSystemWatcher` is single-use** — after `wait()` returns, a new instance must be created for the next batch. The existing `DirectoryMonitor` already handles this correctly.
- **Compound request limit** is bounded by `max_transact_size` (typically 8 MB on Windows Server). Each compound must fit in one TCP send.
- **SMB credits** limit concurrency. Typical servers grant 64-512 credits. Each compound uses ~3 credits, so 10-20 parallel requests is realistic.
- **Samba's rename handling**: inotify `IN_MOVED_FROM` events are held for 100ms waiting for a matching `IN_MOVED_TO` (same cookie). If no match arrives, it's treated as a delete. This means renames that cross watched directory boundaries may appear as delete + create with a brief delay.
