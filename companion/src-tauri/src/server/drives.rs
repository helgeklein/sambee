//! Platform-specific drive/volume enumeration.
//!
//! Discovers all mounted drives accessible to the current user, including
//! physical drives, removable media, network mounts, and virtual drives
//! (Google Drive, OneDrive, Dropbox, etc.).

use std::path::{Path, PathBuf};

use log::warn;

use super::models::{DriveInfo, DriveType};

/// Filesystem types to exclude (pseudo/virtual system filesystems).
const EXCLUDED_FS_TYPES: &[&str] = &[
    "proc",
    "sysfs",
    "devfs",
    "devtmpfs",
    "tmpfs",
    "cgroup",
    "cgroup2",
    "securityfs",
    "debugfs",
    "configfs",
    "fusectl",
    "mqueue",
    "hugetlbfs",
    "pstore",
    "binfmt_misc",
    "autofs",
    "rpc_pipefs",
    "nfsd",
    "tracefs",
    "bpf",
    "efivarfs",
    "ramfs",
    "devpts",
    "overlay",
];

/// Mount points to exclude (always system paths).
const EXCLUDED_MOUNT_POINTS: &[&str] = &["/proc", "/sys", "/dev", "/run", "/snap", "/boot/efi"];

/// Enumerate all accessible drives/volumes on the current platform.
pub fn enumerate_drives() -> Vec<DriveInfo> {
    let drives = enumerate_platform_drives();
    if drives.is_empty() {
        warn!("No drives found during enumeration");
    }
    drives
}

/// Resolve a drive ID to its root filesystem path.
///
/// Returns `None` if the drive ID is unknown.
pub fn resolve_drive_path(drive_id: &str) -> Option<PathBuf> {
    let drives = enumerate_platform_drives();
    // The drive ID encodes the mount point — decode it back
    drives.iter().find(|_d| _d.id == drive_id).map(|_| drive_id_to_path(drive_id))
}

/// Convert a drive ID back to its filesystem path.
fn drive_id_to_path(drive_id: &str) -> PathBuf {
    // On Windows, drive IDs are lowercase letter: "c" -> "C:\\"
    #[cfg(target_os = "windows")]
    {
        if drive_id.len() == 1 && drive_id.chars().next().unwrap().is_ascii_alphabetic() {
            return PathBuf::from(format!("{}:\\", drive_id.to_uppercase()));
        }
    }

    // On Unix, drive IDs are URL-safe slugs of mount points:
    // "root" -> "/"
    // "home" -> "/home"
    // "volumes-my-drive" -> "/Volumes/My Drive" (macOS)
    // We store the mapping during enumeration and look it up.
    // For robustness, re-enumerate and match by ID.
    let drives = enumerate_platform_drives();
    for drive in &drives {
        if drive.id == drive_id {
            // Extract from name or re-derive
            return path_from_drive_id_internal(drive_id);
        }
    }
    // Fallback: treat as literal path
    PathBuf::from(format!("/{drive_id}"))
}

/// Derive a stable, URL-safe ID from a mount point path.
fn path_to_drive_id(path: &Path) -> String {
    let path_str = path.to_string_lossy();

    // Windows: use the drive letter
    #[cfg(target_os = "windows")]
    {
        if let Some(letter) = path_str.chars().next() {
            if letter.is_ascii_alphabetic() && path_str.starts_with(&format!("{letter}:")) {
                return letter.to_lowercase().to_string();
            }
        }
    }

    // Unix: create a slug from the path
    if path_str == "/" {
        return "root".to_string();
    }

    path_str.trim_start_matches('/').to_lowercase().replace([' ', '/'], "-")
}

/// Reverse a drive ID slug back to a filesystem path.
fn path_from_drive_id_internal(drive_id: &str) -> PathBuf {
    if drive_id == "root" {
        return PathBuf::from("/");
    }

    // Re-enumerate to find the actual path
    // This is a fallback — normally resolve_drive_path is used
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/proc/mounts") {
            for line in content.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let mount_point = parts[1];
                    let id = path_to_drive_id(Path::new(mount_point));
                    if id == drive_id {
                        return PathBuf::from(mount_point);
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(entries) = std::fs::read_dir("/Volumes") {
            for entry in entries.flatten() {
                let path = entry.path();
                let id = path_to_drive_id(&path);
                if id == drive_id {
                    return path;
                }
            }
        }
        // Check root
        if drive_id == "root" {
            return PathBuf::from("/");
        }
    }

    // Fallback
    PathBuf::from(format!("/{}", drive_id.replace('-', "/")))
}

// ─── Linux implementation ────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn enumerate_platform_drives() -> Vec<DriveInfo> {
    let content = match std::fs::read_to_string("/proc/mounts") {
        Ok(c) => c,
        Err(e) => {
            warn!("Failed to read /proc/mounts: {e}");
            return vec![default_root_drive()];
        }
    };

    let mut drives = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }

        let _device = parts[0];
        let mount_point = parts[1];
        let fs_type = parts[2];

        // Skip excluded filesystem types
        if EXCLUDED_FS_TYPES.contains(&fs_type) {
            continue;
        }

        // Skip excluded mount points
        if EXCLUDED_MOUNT_POINTS.iter().any(|&p| mount_point.starts_with(p)) {
            continue;
        }

        let id = path_to_drive_id(Path::new(mount_point));
        if !seen_ids.insert(id.clone()) {
            continue; // Skip duplicate mount points
        }

        let drive_type = classify_linux_drive(fs_type, mount_point);
        let name = derive_drive_name(mount_point, &drive_type);

        drives.push(DriveInfo { id, name, drive_type });
    }

    if drives.is_empty() {
        drives.push(default_root_drive());
    }

    drives.sort_by(|a, b| a.name.cmp(&b.name));
    drives
}

#[cfg(target_os = "linux")]
fn classify_linux_drive(fs_type: &str, mount_point: &str) -> DriveType {
    match fs_type {
        // FUSE-based cloud drives
        "fuse" | "fuse.rclone" | "fuse.google-drive-ocamlfuse" | "fuse.gdfuse" | "fuse.dropbox" => DriveType::Virtual,
        // Network filesystems
        "nfs" | "nfs4" | "cifs" | "smb" | "smbfs" | "9p" | "sshfs" => DriveType::Network,
        _ => {
            // Check if it's a removable device by looking at mount location
            if mount_point.starts_with("/media/") || mount_point.starts_with("/mnt/") {
                DriveType::Removable
            } else {
                DriveType::Fixed
            }
        }
    }
}

// ─── macOS implementation ────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn enumerate_platform_drives() -> Vec<DriveInfo> {
    let mut drives = vec![];

    // Add root volume
    drives.push(DriveInfo {
        id: "root".to_string(),
        name: "Macintosh HD".to_string(),
        drive_type: DriveType::Fixed,
    });

    // Enumerate /Volumes
    if let Ok(entries) = std::fs::read_dir("/Volumes") {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();

            // Skip the root volume symlink
            if name == "Macintosh HD" {
                continue;
            }

            let id = path_to_drive_id(&path);
            let drive_type = classify_macos_drive(&path, &name);

            drives.push(DriveInfo { id, name, drive_type });
        }
    }

    drives
}

#[cfg(target_os = "macos")]
fn classify_macos_drive(path: &Path, name: &str) -> DriveType {
    let name_lower = name.to_lowercase();

    // Known cloud drives
    if name_lower.contains("google drive")
        || name_lower.contains("onedrive")
        || name_lower.contains("dropbox")
        || name_lower.contains("icloud")
    {
        return DriveType::Virtual;
    }

    // Check if it's a symlink (often network volumes)
    if path.is_symlink() {
        return DriveType::Network;
    }

    // Default to removable for external volumes
    DriveType::Removable
}

// ─── Windows implementation ──────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn enumerate_platform_drives() -> Vec<DriveInfo> {
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW};

    // Stable Win32 drive type constants (from winbase.h)
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    const DRIVE_REMOTE: u32 = 4;
    const DRIVE_CDROM: u32 = 5;
    const DRIVE_RAMDISK: u32 = 6;

    let mut buffer = [0u16; 512];
    let len = unsafe { GetLogicalDriveStringsW(Some(&mut buffer)) } as usize;
    if len == 0 {
        warn!("GetLogicalDriveStringsW returned 0 drives");
        return vec![];
    }

    let mut drives = Vec::new();
    let mut start = 0;

    while start < len {
        let end = buffer[start..len].iter().position(|&c| c == 0).map(|p| start + p).unwrap_or(len);

        if end > start {
            let drive_str = String::from_utf16_lossy(&buffer[start..end]);
            let drive_wide: Vec<u16> = drive_str.encode_utf16().chain(std::iter::once(0)).collect();

            let raw_type = unsafe { GetDriveTypeW(windows::core::PCWSTR(drive_wide.as_ptr())) };
            let drive_type = match raw_type {
                DRIVE_REMOVABLE => DriveType::Removable,
                DRIVE_FIXED => DriveType::Fixed,
                DRIVE_REMOTE => DriveType::Network,
                DRIVE_CDROM => DriveType::Removable,
                DRIVE_RAMDISK => DriveType::Virtual,
                _ => DriveType::Unknown,
            };

            // Get volume label
            let mut vol_name = [0u16; 256];
            let has_label = unsafe {
                GetVolumeInformationW(
                    windows::core::PCWSTR(drive_wide.as_ptr()),
                    Some(&mut vol_name),
                    None,
                    None,
                    None,
                    None,
                )
            }
            .is_ok();

            let label = if has_label {
                let label_end = vol_name.iter().position(|&c| c == 0).unwrap_or(vol_name.len());
                let l = String::from_utf16_lossy(&vol_name[..label_end]);
                if l.is_empty() {
                    None
                } else {
                    Some(l)
                }
            } else {
                None
            };

            let letter = drive_str.trim_end_matches('\\').to_string();
            let name = match label {
                Some(l) => format!("{l} ({letter})"),
                None => format!("Drive ({letter})"),
            };

            let id = letter[..1].to_lowercase();

            drives.push(DriveInfo { id, name, drive_type });
        }

        start = end + 1;
    }

    drives
}

// ─── Helper functions ────────────────────────────────────────────────────────

/// Derive a human-readable name from a mount point.
fn derive_drive_name(mount_point: &str, drive_type: &DriveType) -> String {
    let type_label = match drive_type {
        DriveType::Fixed => "Disk",
        DriveType::Removable => "Removable",
        DriveType::Network => "Network",
        DriveType::Virtual => "Cloud Drive",
        DriveType::Unknown => "Drive",
    };

    if mount_point == "/" {
        return format!("Root ({type_label})");
    }

    let basename = Path::new(mount_point).file_name().unwrap_or_default().to_string_lossy().to_string();

    if basename.is_empty() {
        format!("{mount_point} ({type_label})")
    } else {
        format!("{basename} ({type_label})")
    }
}

/// Fallback root drive for Linux when /proc/mounts is unreadable.
fn default_root_drive() -> DriveInfo {
    DriveInfo {
        id: "root".to_string(),
        name: "Root (Disk)".to_string(),
        drive_type: DriveType::Fixed,
    }
}
