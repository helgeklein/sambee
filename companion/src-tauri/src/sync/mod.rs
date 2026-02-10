//! File sync (download/upload) engine.
//!
//! Manages the edit lifecycle: download from SMB share via the Sambee backend,
//! track local edits, and upload changes back when the user clicks "Done Editing".
//!
//! Key responsibilities:
//! - `FileOperation` state management (in-memory + JSON sidecar on disk)
//! - Temp directory layout with `-copy` naming convention
//! - Recycle bin with timestamped filenames and 7-day TTL
//! - File status polling (mtime checks every 2 seconds)
//! - Heartbeat background task (every 30 seconds)

pub mod operations;
pub mod recycle;
pub mod temp;
