//! Tauri commands — invocable from the frontend via `invoke()`.
//!
//! Placeholder module for Phase 3+ commands (download, upload, open_file,
//! app_picker). Currently empty; the commands will be registered in lib.rs
//! via `.invoke_handler(tauri::generate_handler![...])` as they are added.

pub mod app_picker;
pub mod download;
pub mod file_info;
pub mod open_file;
pub mod upload;
