//! Windows app registry — enumerates native applications via the Windows
//! Registry to find handlers for specific file extensions.
//!
//! Uses the Shell `SHAssocEnumHandlers` COM API as primary enumeration method,
//! matching the OS "Open with" dialog for comprehensive and accurate results
//! with proper localized display names. Falls back to direct Registry queries
//! if the COM approach fails.
//!
//! Application icons are extracted using Win32 Shell/GDI APIs, converted to
//! PNG, and Base64-encoded for display in the picker UI.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use base64::Engine;
use log::debug;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, DIB_RGB_COLORS, HDC, HGDIOBJ,
};
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{ExtractIconExW, IAssocHandler, SHAssocEnumHandlers, ASSOC_FILTER};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};
use winreg::enums::*;
use winreg::RegKey;

use super::{AppRegistry, NativeApp};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Registry path prefix for user's per-extension file associations.
const USER_FILE_EXTS_PREFIX: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts";

/// Return all registered handlers, not just recommended ones.
const ASSOC_FILTER_ALL: ASSOC_FILTER = ASSOC_FILTER(0);

// ─────────────────────────────────────────────────────────────────────────────
// COM initialization RAII guard
// ─────────────────────────────────────────────────────────────────────────────

/// RAII guard for COM initialization on the current thread.
///
/// Calls `CoInitializeEx` on creation and `CoUninitialize` on drop.
/// Safe to use when COM may or may not already be initialized — the
/// COM library uses reference counting internally.
struct ComInit;

impl ComInit {
    //
    // new
    //
    fn new() -> Self {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        ComInit
    }
}

impl Drop for ComInit {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WindowsAppRegistry
// ─────────────────────────────────────────────────────────────────────────────

/// Windows-specific app registry using Shell association handlers and
/// Registry queries.
pub struct WindowsAppRegistry;

impl WindowsAppRegistry {
    //
    // new
    //
    /// Create a new Windows app registry.
    pub fn new() -> Self {
        Self
    }

    //
    // get_user_choice_progid
    //
    /// Read the user's chosen ProgId for a file extension from the registry.
    ///
    /// Checks `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\
    /// FileExts\.{ext}\UserChoice` → `ProgId` value.
    fn get_user_choice_progid(extension: &str) -> Option<String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path = format!(r"{}\{}\UserChoice", USER_FILE_EXTS_PREFIX, extension);
        let key = hkcu.open_subkey(&path).ok()?;
        key.get_value("ProgId").ok()
    }

    //
    // get_progids_for_extension
    //
    /// Collect all ProgIds registered for a file extension.
    ///
    /// Queries multiple registry locations for comprehensive coverage:
    /// - `HKCR\.{ext}` default value (system default handler)
    /// - `HKCR\.{ext}\OpenWithProgids` (system-level open-with)
    /// - `HKCR\.{ext}\OpenWithList` (system-level app list)
    /// - `HKCU\...\FileExts\.{ext}\OpenWithProgids` (user's open-with history)
    /// - `HKCU\...\FileExts\.{ext}\OpenWithList` (user's MRU list)
    fn get_progids_for_extension(extension: &str) -> Vec<String> {
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let mut progids: Vec<String> = Vec::new();

        // --- System-level sources (HKCR) ---

        if let Ok(ext_key) = hkcr.open_subkey(extension) {
            // Default ProgId
            if let Ok(default_progid) = ext_key.get_value::<String, _>("") {
                if !default_progid.is_empty() {
                    progids.push(default_progid);
                }
            }

            // OpenWithProgids subkey
            if let Ok(open_with) = ext_key.open_subkey("OpenWithProgids") {
                for (name, _value) in open_with.enum_values().filter_map(|r| r.ok()) {
                    if !name.is_empty() && !progids.contains(&name) {
                        progids.push(name);
                    }
                }
            }

            // OpenWithList subkey (lists application .exe names)
            if let Ok(open_with_list) = ext_key.open_subkey("OpenWithList") {
                for subkey_name in open_with_list.enum_keys().filter_map(|r| r.ok()) {
                    let app_progid = format!(r"Applications\{}", subkey_name);
                    if !progids.contains(&app_progid) {
                        progids.push(app_progid);
                    }
                }
            }
        }

        // --- User-level sources (HKCU) ---

        // User's OpenWithProgids history
        let user_owp_path = format!(r"{}\{}\OpenWithProgids", USER_FILE_EXTS_PREFIX, extension);
        if let Ok(user_owp) = hkcu.open_subkey(&user_owp_path) {
            for (name, _) in user_owp.enum_values().filter_map(|r| r.ok()) {
                if !name.is_empty() && !progids.contains(&name) {
                    progids.push(name);
                }
            }
        }

        // User's OpenWithList MRU (most-recently-used app list)
        let user_owl_path = format!(r"{}\{}\OpenWithList", USER_FILE_EXTS_PREFIX, extension);
        if let Ok(user_owl) = hkcu.open_subkey(&user_owl_path) {
            // MRU values are single-letter keys (a, b, c, …) containing exe names
            if let Ok(mru_list) = user_owl.get_value::<String, _>("MRUList") {
                for ch in mru_list.chars() {
                    if let Ok(app_name) = user_owl.get_value::<String, _>(&ch.to_string()) {
                        if !app_name.is_empty() {
                            let app_progid = format!(r"Applications\{}", app_name);
                            if !progids.contains(&app_progid) {
                                progids.push(app_progid);
                            }
                        }
                    }
                }
            }
        }

        progids
    }

    //
    // resolve_progid
    //
    /// Resolve a ProgId to an executable path and display name.
    ///
    /// Looks up `HKCR\{progid}\shell\open\command` for the executable,
    /// and various registry sources for the display name.
    fn resolve_progid(progid: &str) -> Option<(PathBuf, String)> {
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);

        // Read the open command
        let command_path = format!(r"{}\shell\open\command", progid);
        let command_key = hkcr.open_subkey(&command_path).ok()?;
        let command: String = command_key.get_value("").ok()?;

        let executable = extract_executable_from_command(&command)?;

        // Try to get a friendly display name
        let display_name = Self::get_display_name(progid, &executable);

        Some((executable, display_name))
    }

    //
    // get_display_name
    //
    /// Get a human-readable display name for a ProgId.
    ///
    /// Checks multiple registry sources for a friendly application name,
    /// falling back to the executable's filename stem. Values starting with
    /// `@` are indirect string resources and are skipped.
    fn get_display_name(progid: &str, executable: &PathBuf) -> String {
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);

        // 1. FriendlyAppName from the ProgId's shell\open key
        if let Ok(key) = hkcr.open_subkey(format!(r"{}\shell\open", progid)) {
            if let Ok(name) = key.get_value::<String, _>("FriendlyAppName") {
                if !name.is_empty() && !name.starts_with('@') {
                    return name;
                }
            }
        }

        // 2. FriendlyAppName from the Applications registry key
        if let Some(exe_name) = executable.file_name().and_then(|n| n.to_str()) {
            let app_key_path = format!(r"Applications\{}", exe_name);
            if let Ok(key) = hkcr.open_subkey(&app_key_path) {
                if let Ok(name) = key.get_value::<String, _>("FriendlyAppName") {
                    if !name.is_empty() && !name.starts_with('@') {
                        return name;
                    }
                }
            }
        }

        // 3. ProgId's default value (may be file type description or app name)
        if let Ok(key) = hkcr.open_subkey(progid) {
            if let Ok(name) = key.get_value::<String, _>("") {
                if !name.is_empty() {
                    return name;
                }
            }
        }

        // 4. Fall back to executable filename stem
        executable
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string()
    }

    //
    // enumerate_via_registry
    //
    /// Enumerate applications via direct registry queries (fallback path).
    ///
    /// Used when the primary COM-based enumeration fails or returns no results.
    fn enumerate_via_registry(&self, dotted_ext: &str) -> Vec<NativeApp> {
        let user_choice = Self::get_user_choice_progid(dotted_ext);
        let progids = Self::get_progids_for_extension(dotted_ext);

        debug!(
            "Registry fallback: {} ProgIds, user choice: {:?}",
            progids.len(),
            user_choice
        );

        let mut seen: HashMap<PathBuf, usize> = HashMap::new();
        let mut apps: Vec<NativeApp> = Vec::new();

        for progid in &progids {
            if let Some((executable, name)) = Self::resolve_progid(progid) {
                if seen.contains_key(&executable) {
                    continue;
                }

                let is_default = user_choice.as_ref().is_some_and(|choice| choice == progid);

                seen.insert(executable.clone(), apps.len());
                apps.push(NativeApp {
                    name,
                    icon: extract_icon_from_resource(&executable, 0),
                    executable,
                    is_default,
                });
            }
        }

        // If no app was marked as default but we have apps, mark the first one
        if !apps.is_empty() && !apps.iter().any(|a| a.is_default) {
            apps[0].is_default = true;
        }

        apps
    }
}

impl AppRegistry for WindowsAppRegistry {
    //
    // apps_for_extension
    //
    fn apps_for_extension(&self, extension: &str) -> Vec<NativeApp> {
        let dotted_ext = if extension.starts_with('.') {
            extension.to_string()
        } else {
            format!(".{}", extension)
        };

        debug!("Looking up Windows app handlers for {}", dotted_ext);

        // Primary: use Shell association handlers (matches OS "Open with" dialog)
        if let Some(apps) = enumerate_assoc_handlers(&dotted_ext) {
            if !apps.is_empty() {
                debug!(
                    "Resolved {} app(s) for {} via Shell handlers",
                    apps.len(),
                    dotted_ext
                );
                return apps;
            }
        }

        // Fallback: direct registry enumeration
        debug!(
            "Shell handler enumeration returned no results for {}, using registry fallback",
            dotted_ext
        );
        let apps = self.enumerate_via_registry(&dotted_ext);
        debug!(
            "Resolved {} app(s) for {} via registry",
            apps.len(),
            dotted_ext
        );
        apps
    }

    //
    // apps_for_mime
    //
    fn apps_for_mime(&self, mime: &str) -> Vec<NativeApp> {
        // Windows primarily uses file extensions, not MIME types.
        // Try to find an extension for this MIME type via the registry.
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
        let mime_path = format!(r"MIME\Database\Content Type\{}", mime);

        if let Ok(mime_key) = hkcr.open_subkey(&mime_path) {
            if let Ok(ext) = mime_key.get_value::<String, _>("Extension") {
                return self.apps_for_extension(&ext);
            }
        }

        Vec::new()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell association handler enumeration (COM-based)
// ─────────────────────────────────────────────────────────────────────────────

//
// enumerate_assoc_handlers
//
/// Enumerate all application handlers for a file extension using the Shell
/// `SHAssocEnumHandlers` COM API.
///
/// This matches the OS "Open with" dialog and returns comprehensive results
/// including UWP/Store apps with proper localized display names.
///
/// Returns `None` if the COM API is unavailable or fails.
fn enumerate_assoc_handlers(extension: &str) -> Option<Vec<NativeApp>> {
    let _com = ComInit::new();

    let wide: Vec<u16> = OsStr::new(extension)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let enumerator = unsafe { SHAssocEnumHandlers(PCWSTR(wide.as_ptr()), ASSOC_FILTER_ALL).ok()? };

    let mut apps: Vec<NativeApp> = Vec::new();
    let mut seen: HashMap<PathBuf, usize> = HashMap::new();
    let mut first_recommended: Option<usize> = None;

    loop {
        let mut handlers: [Option<IAssocHandler>; 1] = [None];
        let mut fetched = 0u32;

        unsafe {
            let _ = enumerator.Next(&mut handlers, Some(&mut fetched));
        }

        if fetched == 0 {
            break;
        }

        let handler = match handlers[0].take() {
            Some(h) => h,
            None => break,
        };

        unsafe {
            // Get the user-visible application name
            let name = match handler.GetUIName() {
                Ok(p) => {
                    let s = pwstr_to_string(p);
                    CoTaskMemFree(Some(p.0 as *const std::ffi::c_void));
                    s
                }
                Err(_) => continue,
            };

            if name.is_empty() {
                continue;
            }

            // Get the executable path
            let exe_path = match handler.GetName() {
                Ok(p) => {
                    let s = pwstr_to_string(p);
                    CoTaskMemFree(Some(p.0 as *const std::ffi::c_void));
                    PathBuf::from(s)
                }
                Err(_) => continue,
            };

            // Skip if already seen (deduplicate by executable path)
            if seen.contains_key(&exe_path) {
                continue;
            }

            // Extract icon (try handler's icon location, fall back to exe)
            let icon = extract_handler_icon(&handler, &exe_path);

            // IsRecommended() returns S_OK for recommended handlers
            let is_recommended = handler.IsRecommended().is_ok();
            let idx = apps.len();

            if is_recommended && first_recommended.is_none() {
                first_recommended = Some(idx);
            }

            seen.insert(exe_path.clone(), idx);
            apps.push(NativeApp {
                name,
                icon,
                executable: exe_path,
                is_default: false,
            });
        }
    }

    // Mark the first recommended handler (or first overall) as default
    if !apps.is_empty() {
        let default_idx = first_recommended.unwrap_or(0);
        apps[default_idx].is_default = true;
    }

    debug!(
        "SHAssocEnumHandlers returned {} handler(s) for {}",
        apps.len(),
        extension
    );

    Some(apps)
}

//
// extract_handler_icon
//
/// Extract an icon for a handler, using its reported icon location if
/// available, and falling back to the executable's embedded icon.
unsafe fn extract_handler_icon(handler: &IAssocHandler, exe_path: &Path) -> Option<String> {
    // Try the handler's icon location first
    let mut icon_path_ptr = PWSTR::null();
    let mut icon_index = 0i32;

    if handler
        .GetIconLocation(&mut icon_path_ptr, &mut icon_index)
        .is_ok()
        && !icon_path_ptr.is_null()
    {
        let icon_path_str = pwstr_to_string(icon_path_ptr);
        CoTaskMemFree(Some(icon_path_ptr.0 as *const std::ffi::c_void));

        // Skip resource references (UWP/Store apps use @{...} notation)
        if !icon_path_str.is_empty() && !icon_path_str.starts_with('@') {
            let icon_source = PathBuf::from(&icon_path_str);
            if let result @ Some(_) = extract_icon_from_resource(&icon_source, icon_index) {
                return result;
            }
        }
    }

    // Fall back to extracting from the executable itself
    extract_icon_from_resource(exe_path, 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon extraction
// ─────────────────────────────────────────────────────────────────────────────

//
// extract_icon_from_resource
//
/// Extract an icon from a file (exe, dll, or ico) at the given icon index
/// and return it as a Base64-encoded PNG string.
///
/// Uses Win32 `ExtractIconExW` to load the icon, then GDI to read the raw
/// pixel data, and the `png` crate to encode the result.
///
/// Returns `None` if the icon could not be extracted for any reason.
fn extract_icon_from_resource(icon_path: &Path, icon_index: i32) -> Option<String> {
    let wide: Vec<u16> = OsStr::new(icon_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut large_icon = HICON::default();
        let count = ExtractIconExW(
            PCWSTR(wide.as_ptr()),
            icon_index,
            Some(&mut large_icon),
            None,
            1,
        );

        if count == 0 || large_icon.is_invalid() {
            return None;
        }

        let result = hicon_to_base64_png(large_icon);

        let _ = DestroyIcon(large_icon);

        result
    }
}

//
// hicon_to_base64_png
//
/// Convert an `HICON` to a Base64-encoded PNG string.
///
/// Reads the icon's color bitmap via GDI, converts BGRA → RGBA pixel order,
/// encodes as PNG, and returns the Base64 representation.
unsafe fn hicon_to_base64_png(icon: HICON) -> Option<String> {
    // Get the icon's constituent bitmaps (color + mask)
    let mut icon_info: ICONINFO = std::mem::zeroed();
    GetIconInfo(icon, &mut icon_info).ok()?;

    // Read the color bitmap dimensions
    let mut bmp: BITMAP = std::mem::zeroed();
    let obj_size = GetObjectW(
        HGDIOBJ(icon_info.hbmColor.0),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bmp as *mut BITMAP as *mut std::ffi::c_void),
    );

    if obj_size == 0 || bmp.bmWidth == 0 || bmp.bmHeight == 0 {
        cleanup_gdi_bitmaps(&icon_info);
        return None;
    }

    let width = bmp.bmWidth as u32;
    let height = bmp.bmHeight as u32;

    // Prepare a BITMAPINFO header requesting 32-bit BGRA top-down output
    let mut bmi: BITMAPINFO = std::mem::zeroed();
    bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = width as i32;
    bmi.bmiHeader.biHeight = -(height as i32); // negative = top-down
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = 0; // BI_RGB

    // Create a memory DC and extract the pixel data
    let hdc = CreateCompatibleDC(None);
    let mut pixels = vec![0u8; (width * height * 4) as usize];

    let lines = GetDIBits(
        HDC(hdc.0),
        icon_info.hbmColor,
        0,
        height,
        Some(pixels.as_mut_ptr() as *mut std::ffi::c_void),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    let _ = DeleteDC(hdc);
    cleanup_gdi_bitmaps(&icon_info);

    if lines == 0 {
        return None;
    }

    // Convert BGRA (Windows native) → RGBA (PNG standard)
    for chunk in pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    // Encode as PNG
    let mut png_buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_buf, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&pixels).ok()?;
    }

    Some(base64::engine::general_purpose::STANDARD.encode(&png_buf))
}

//
// cleanup_gdi_bitmaps
//
/// Release GDI bitmap handles from an `ICONINFO` struct.
unsafe fn cleanup_gdi_bitmaps(info: &ICONINFO) {
    if !info.hbmColor.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
    }
    if !info.hbmMask.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

//
// pwstr_to_string
//
/// Convert a Win32 `PWSTR` (wide null-terminated string) to a Rust `String`.
///
/// Returns an empty string if the pointer is null.
unsafe fn pwstr_to_string(p: PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }

    let len = (0..).take_while(|&i| *p.0.offset(i) != 0).count();
    String::from_utf16_lossy(std::slice::from_raw_parts(p.0, len))
}

//
// extract_executable_from_command
//
/// Extract the executable path from a Windows registry command string.
///
/// Handles common formats:
/// - `"C:\Program Files\App\app.exe" "%1"` → `C:\Program Files\App\app.exe`
/// - `C:\Windows\system32\paint.exe "%1"` → `C:\Windows\system32\paint.exe`
/// - `"C:\path\app.exe"` → `C:\path\app.exe`
fn extract_executable_from_command(command: &str) -> Option<PathBuf> {
    let command = command.trim();
    if command.is_empty() {
        return None;
    }

    let exe_str = if command.starts_with('"') {
        // Quoted executable path — extract content between first pair of quotes
        let end = command[1..].find('"')?;
        &command[1..=end]
    } else {
        // Unquoted — take everything up to the first space
        command.split_whitespace().next()?
    };

    if exe_str.is_empty() {
        return None;
    }

    Some(PathBuf::from(exe_str))
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    //
    // test_extract_executable_quoted
    //
    #[test]
    fn test_extract_executable_quoted() {
        let cmd = r#""C:\Program Files\App\editor.exe" "%1""#;
        let result = extract_executable_from_command(cmd).unwrap();
        assert_eq!(result, PathBuf::from(r"C:\Program Files\App\editor.exe"));
    }

    //
    // test_extract_executable_unquoted
    //
    #[test]
    fn test_extract_executable_unquoted() {
        let cmd = r"C:\Windows\system32\notepad.exe %1";
        let result = extract_executable_from_command(cmd).unwrap();
        assert_eq!(result, PathBuf::from(r"C:\Windows\system32\notepad.exe"));
    }

    //
    // test_extract_executable_quoted_no_args
    //
    #[test]
    fn test_extract_executable_quoted_no_args() {
        let cmd = r#""C:\path\app.exe""#;
        let result = extract_executable_from_command(cmd).unwrap();
        assert_eq!(result, PathBuf::from(r"C:\path\app.exe"));
    }

    //
    // test_extract_executable_empty
    //
    #[test]
    fn test_extract_executable_empty() {
        assert!(extract_executable_from_command("").is_none());
        assert!(extract_executable_from_command("   ").is_none());
    }
}
