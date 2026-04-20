//! Filesystem watcher for real-time directory change notifications.
//!
//! Uses the `notify` crate to watch directories that WebSocket clients have
//! subscribed to. Events are debounced per directory and broadcast to all
//! connected clients via a `tokio::sync::broadcast` channel.
//!
//! Subscriber counting ensures that watchers are started only when the first
//! client subscribes and stopped when the last client unsubscribes.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use log::{info, warn};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::{broadcast, mpsc, Mutex};

/// Debounce window — coalesce rapid filesystem events into a single notification.
const DEBOUNCE_DURATION: Duration = Duration::from_millis(300);

/// Maximum number of pending events in the broadcast channel.
const BROADCAST_CAPACITY: usize = 256;

/// A directory change notification sent to WebSocket clients.
#[derive(Clone, Debug)]
pub struct DirectoryChangeEvent {
    /// The drive identifier (e.g. `"c"`, `"root"`).
    pub drive: String,
    /// The relative directory path that changed.
    pub path: String,
}

/// Tracks a single watched directory.
struct WatchEntry {
    /// The filesystem watcher — dropped to stop watching.
    _watcher: RecommendedWatcher,
    /// Number of WebSocket clients subscribed to this directory.
    subscriber_count: usize,
    /// Abort handle for the debounce task (cancelled on drop).
    _debounce_handle: tokio::task::JoinHandle<()>,
}

/// Manages filesystem watchers with subscriber counting and debouncing.
///
/// Each unique `{drive}:{path}` gets one OS-level watcher, shared across
/// all WebSocket clients viewing that directory. When directory contents
/// change, the watcher sends a [`DirectoryChangeEvent`] through the
/// broadcast channel after a short debounce window.
pub struct DirectoryWatcher {
    /// Active watchers keyed by `"drive:path"`.
    entries: Mutex<HashMap<String, WatchEntry>>,
    /// Broadcast sender — each WS handler subscribes its own receiver.
    event_tx: broadcast::Sender<DirectoryChangeEvent>,
}

impl DirectoryWatcher {
    /// Create a new watcher manager.
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        Self {
            entries: Mutex::new(HashMap::new()),
            event_tx: tx,
        }
    }

    /// Get a new broadcast receiver for change events.
    ///
    /// Each WebSocket connection should call this once to receive
    /// notifications for all watched directories.
    pub fn subscribe_events(&self) -> broadcast::Receiver<DirectoryChangeEvent> {
        self.event_tx.subscribe()
    }

    /// Start watching a directory (or increment the subscriber count).
    ///
    /// - `drive` — drive identifier (e.g. `"c"`, `"root"`).
    /// - `path`  — relative directory path within the drive.
    /// - `root`  — absolute filesystem root of the drive.
    pub async fn subscribe(&self, drive: &str, path: &str, root: &Path) -> Result<(), String> {
        let key = format!("{drive}:{path}");
        let mut entries = self.entries.lock().await;

        // Increment count if already watching
        if let Some(entry) = entries.get_mut(&key) {
            entry.subscriber_count += 1;
            info!("Watcher: added subscriber for {key} (count: {})", entry.subscriber_count);
            return Ok(());
        }

        let canonical_root = root.canonicalize().map_err(|e| format!("Drive root inaccessible: {e}"))?;

        // Resolve the filesystem path to watch
        let watch_path = if path.is_empty() {
            canonical_root.clone()
        } else {
            let joined = canonical_root.join(path);
            let canonical = joined.canonicalize().map_err(|e| format!("Cannot resolve path: {e}"))?;
            if !canonical.starts_with(&canonical_root) {
                return Err("Path is outside drive root".into());
            }
            canonical
        };

        if !watch_path.is_dir() {
            return Err(format!("Not a directory: {}", watch_path.display()));
        }

        // ── Debounce channel ──────────────────────────────────────────────
        // The notify callback fires on an OS thread. It pushes into an mpsc
        // channel; a tokio task drains it after the debounce window and then
        // broadcasts the aggregated event.
        let (debounce_tx, mut debounce_rx) = mpsc::channel::<()>(32);
        let broadcast_tx = self.event_tx.clone();
        let drive_owned = drive.to_string();
        let path_owned = path.to_string();

        let debounce_handle = tokio::spawn(async move {
            while let Some(()) = debounce_rx.recv().await {
                // Wait for the debounce window, draining intermediate events
                tokio::time::sleep(DEBOUNCE_DURATION).await;
                while debounce_rx.try_recv().is_ok() {}

                let _ = broadcast_tx.send(DirectoryChangeEvent {
                    drive: drive_owned.clone(),
                    path: path_owned.clone(),
                });
            }
        });

        // ── OS watcher ────────────────────────────────────────────────────
        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| match res {
            Ok(event) => match event.kind {
                EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_) => {
                    let _ = debounce_tx.try_send(());
                }
                _ => {}
            },
            Err(e) => warn!("Watcher error: {e}"),
        })
        .map_err(|e| format!("Failed to create watcher: {e}"))?;

        watcher
            .watch(&watch_path, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch {}: {e}", watch_path.display()))?;

        info!("Watcher: started watching {key} at {}", watch_path.display());

        entries.insert(
            key,
            WatchEntry {
                _watcher: watcher,
                subscriber_count: 1,
                _debounce_handle: debounce_handle,
            },
        );

        Ok(())
    }

    /// Decrement the subscriber count and stop watching when it reaches zero.
    pub async fn unsubscribe(&self, drive: &str, path: &str) {
        let key = format!("{drive}:{path}");
        let mut entries = self.entries.lock().await;

        if let Some(entry) = entries.get_mut(&key) {
            entry.subscriber_count -= 1;
            if entry.subscriber_count == 0 {
                // Dropping the entry stops the watcher (and its debounce task)
                entries.remove(&key);
                info!("Watcher: stopped watching {key} (last subscriber left)");
            } else {
                info!("Watcher: removed subscriber for {key} (count: {})", entry.subscriber_count);
            }
        }
    }
}
