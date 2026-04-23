//! Linux app registry — enumerates native applications via `.desktop` files
//! and `mimeapps.list` configuration.
//!
//! Resolves file extensions to MIME types via `mime_guess`, then looks up
//! registered handlers from the XDG mimeapps.list hierarchy and .desktop
//! files in standard locations.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use log::debug;

use super::{AppRegistry, NativeApp};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Standard directories to search for `.desktop` files.
const DESKTOP_FILE_DIRS: &[&str] = &["/usr/share/applications", "/usr/local/share/applications"];

/// Standard locations for `mimeapps.list` (checked in priority order).
const MIMEAPPS_LIST_PATHS: &[&str] = &[
    // User-level overrides (highest priority)
    "~/.config/mimeapps.list",
    // System-level defaults
    "/usr/share/applications/mimeapps.list",
    "/usr/local/share/applications/mimeapps.list",
    "/etc/xdg/mimeapps.list",
];

// ─────────────────────────────────────────────────────────────────────────────
// DesktopEntry
// ─────────────────────────────────────────────────────────────────────────────

/// Parsed fields from a `.desktop` file's `[Desktop Entry]` section.
#[derive(Debug, Clone)]
struct DesktopEntry {
    /// Display name (e.g. "LibreOffice Writer").
    name: String,

    /// Exec line (e.g. "libreoffice --writer %U").
    exec: String,

    /// Icon name or path (e.g. "libreoffice-writer").
    icon: Option<String>,

    /// MIME types declared in the `MimeType=` field.
    mime_types: Vec<String>,

    /// Whether this is a terminal application.
    #[allow(dead_code)]
    terminal: bool,

    /// The desktop entry ID (filename without .desktop).
    desktop_id: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// LinuxAppRegistry
// ─────────────────────────────────────────────────────────────────────────────

/// Linux-specific app registry. Reads `.desktop` files and `mimeapps.list`
/// to enumerate applications that can handle a given file type.
pub struct LinuxAppRegistry {
    /// Parsed desktop entries keyed by desktop ID (e.g. "org.libreoffice.writer").
    entries: HashMap<String, DesktopEntry>,

    /// Default application per MIME type from mimeapps.list `[Default Applications]`.
    defaults: HashMap<String, String>,

    /// Additional associations per MIME type from mimeapps.list `[Added Associations]`.
    added: HashMap<String, Vec<String>>,
}

impl LinuxAppRegistry {
    //
    // new
    //
    /// Create a new registry by scanning standard .desktop file locations
    /// and parsing mimeapps.list files.
    pub fn new() -> Self {
        let entries = Self::load_desktop_entries();
        let (defaults, added) = Self::load_mimeapps_lists();

        Self { entries, defaults, added }
    }

    //
    // load_desktop_entries
    //
    /// Scan all standard directories for `.desktop` files and parse them.
    fn load_desktop_entries() -> HashMap<String, DesktopEntry> {
        let mut entries = HashMap::new();
        let home = std::env::var("HOME").unwrap_or_default();

        // Also check user-local desktop files
        let user_dir = format!("{home}/.local/share/applications");
        let dirs: Vec<&str> = DESKTOP_FILE_DIRS
            .iter()
            .copied()
            .chain(std::iter::once(user_dir.as_str()))
            .collect();

        for dir in dirs {
            let dir_path = Path::new(dir);
            if !dir_path.is_dir() {
                continue;
            }

            let read_result = fs::read_dir(dir_path);
            let dir_entries = match read_result {
                Ok(entries) => entries,
                Err(_) => continue,
            };

            for entry in dir_entries.flatten() {
                let path = entry.path();
                if path.extension().is_none_or(|ext| ext != "desktop") {
                    continue;
                }

                if let Some(parsed) = Self::parse_desktop_file(&path) {
                    entries.insert(parsed.desktop_id.clone(), parsed);
                }
            }
        }

        entries
    }

    //
    // parse_desktop_file
    //
    /// Parse a single `.desktop` file into a `DesktopEntry`.
    ///
    /// Returns `None` if the file cannot be read or lacks required fields.
    fn parse_desktop_file(path: &Path) -> Option<DesktopEntry> {
        let content = fs::read_to_string(path).ok()?;
        let desktop_id = path.file_stem()?.to_str()?.to_string();

        let mut name = None;
        let mut exec = None;
        let mut icon = None;
        let mut mime_types = Vec::new();
        let mut terminal = false;
        let mut in_desktop_entry = false;
        let mut entry_type = None;
        let mut no_display = false;
        let mut hidden = false;

        for line in content.lines() {
            let line = line.trim();

            // Section headers
            if line.starts_with('[') {
                in_desktop_entry = line == "[Desktop Entry]";
                continue;
            }

            if !in_desktop_entry {
                continue;
            }

            // Skip comments
            if line.starts_with('#') || line.is_empty() {
                continue;
            }

            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim();

                match key {
                    // Only read the unlocalized Name (not Name[en], etc.)
                    "Name" => name = Some(value.to_string()),
                    "Exec" => exec = Some(value.to_string()),
                    "Icon" => icon = Some(value.to_string()),
                    "Terminal" => terminal = value.eq_ignore_ascii_case("true"),
                    "Type" => entry_type = Some(value.to_string()),
                    "NoDisplay" => no_display = value.eq_ignore_ascii_case("true"),
                    "Hidden" => hidden = value.eq_ignore_ascii_case("true"),
                    "MimeType" => {
                        mime_types = value.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                    }
                    _ => {}
                }
            }
        }

        // Only include Application type entries that are visible
        if entry_type.as_deref() != Some("Application") {
            return None;
        }
        if no_display || hidden {
            return None;
        }

        let name = name?;
        let exec = exec?;

        Some(DesktopEntry {
            name,
            exec,
            icon,
            mime_types,
            terminal,
            desktop_id,
        })
    }

    //
    // load_mimeapps_lists
    //
    /// Parse all `mimeapps.list` files in priority order.
    ///
    /// Returns (defaults, added_associations). Later files have lower
    /// priority — the first match wins.
    fn load_mimeapps_lists() -> (HashMap<String, String>, HashMap<String, Vec<String>>) {
        let mut defaults: HashMap<String, String> = HashMap::new();
        let mut added: HashMap<String, Vec<String>> = HashMap::new();
        let home = std::env::var("HOME").unwrap_or_default();

        // Process in reverse order so higher-priority files overwrite
        for path_template in MIMEAPPS_LIST_PATHS.iter().rev() {
            let path_str = path_template.replace('~', &home);
            let path = Path::new(&path_str);

            if !path.is_file() {
                continue;
            }

            let content = match fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let mut section = Section::None;

            for line in content.lines() {
                let line = line.trim();

                if line.starts_with('[') {
                    section = match line {
                        "[Default Applications]" => Section::Defaults,
                        "[Added Associations]" => Section::Added,
                        _ => Section::None,
                    };
                    continue;
                }

                if line.starts_with('#') || line.is_empty() {
                    continue;
                }

                if let Some((mime, desktop_ids_str)) = line.split_once('=') {
                    let mime = mime.trim().to_string();
                    let desktop_ids: Vec<String> = desktop_ids_str
                        .split(';')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        // Strip .desktop extension if present for consistent lookup
                        .map(|s| s.strip_suffix(".desktop").unwrap_or(&s).to_string())
                        .collect();

                    match section {
                        Section::Defaults => {
                            if let Some(first) = desktop_ids.first() {
                                defaults.insert(mime, first.clone());
                            }
                        }
                        Section::Added => {
                            added.entry(mime).or_default().extend(desktop_ids);
                        }
                        Section::None => {}
                    }
                }
            }
        }

        (defaults, added)
    }

    //
    // apps_for_mime_type
    //
    /// Core lookup: find all apps that can handle a MIME type, marking the default.
    fn apps_for_mime_type(&self, mime: &str) -> Vec<NativeApp> {
        let mut result = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();
        let default_id = self.defaults.get(mime);

        // 1. Add the default app first (if it exists and is known)
        if let Some(default) = default_id {
            if let Some(entry) = self.entries.get(default) {
                result.push(self.entry_to_native_app(entry, true));
                seen_ids.insert(default.clone());
            }
        }

        // 2. Add apps from mimeapps.list [Added Associations]
        if let Some(added_ids) = self.added.get(mime) {
            for id in added_ids {
                if seen_ids.insert(id.clone()) {
                    if let Some(entry) = self.entries.get(id) {
                        result.push(self.entry_to_native_app(entry, false));
                    }
                }
            }
        }

        // 3. Add any desktop entries that declare this MIME type in their MimeType= field
        for (id, entry) in &self.entries {
            if entry.mime_types.iter().any(|m| m == mime) && seen_ids.insert(id.clone()) {
                result.push(self.entry_to_native_app(entry, false));
            }
        }

        debug!(
            "Found {} app(s) for MIME type {}: {:?}",
            result.len(),
            mime,
            result.iter().map(|a| &a.name).collect::<Vec<_>>()
        );

        result
    }

    //
    // entry_to_native_app
    //
    /// Convert a `DesktopEntry` into a `NativeApp`.
    fn entry_to_native_app(&self, entry: &DesktopEntry, is_default: bool) -> NativeApp {
        let executable = Self::extract_executable(&entry.exec);

        NativeApp {
            name: entry.name.clone(),
            executable,
            icon: entry.icon.clone(),
            is_default,
            is_recommended: false,
        }
    }

    //
    // extract_executable
    //
    /// Extract the executable path from a `.desktop` Exec= line.
    ///
    /// The Exec line may contain placeholders (`%f`, `%F`, `%u`, `%U`, etc.)
    /// and arguments. We take only the first token as the executable path.
    fn extract_executable(exec_line: &str) -> PathBuf {
        let first_token = exec_line.split_whitespace().next().unwrap_or(exec_line);

        PathBuf::from(first_token)
    }
}

/// Section type while parsing mimeapps.list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Section {
    None,
    Defaults,
    Added,
}

impl AppRegistry for LinuxAppRegistry {
    //
    // apps_for_extension
    //
    fn apps_for_extension(&self, extension: &str) -> Vec<NativeApp> {
        // Map extension to MIME type(s) using mime_guess
        let fake_filename = format!("file.{extension}");
        let guesses = mime_guess::from_path(&fake_filename);

        let mut result = Vec::new();
        let mut seen_names = std::collections::HashSet::new();

        for guess in guesses {
            let mime_str = guess.to_string();
            for app in self.apps_for_mime_type(&mime_str) {
                if seen_names.insert(app.name.clone()) {
                    result.push(app);
                }
            }
        }

        // If mime_guess found nothing, try a broad text/* fallback for known text extensions
        if result.is_empty() {
            let text_extensions = [
                "txt", "md", "csv", "json", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "log", "sh", "bash", "py", "rs", "js",
                "ts", "html", "css", "sql",
            ];
            if text_extensions.contains(&extension.to_lowercase().as_str()) {
                result = self.apps_for_mime_type("text/plain");
            }
        }

        result
    }

    //
    // apps_for_mime
    //
    fn apps_for_mime(&self, mime: &str) -> Vec<NativeApp> {
        self.apps_for_mime_type(mime)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Grouped result from `create_test_env`: desktop entries, default associations, MIME-type lists.
    type TestEnvResult = (HashMap<String, DesktopEntry>, HashMap<String, String>, HashMap<String, Vec<String>>);

    //
    // create_test_desktop_files
    //
    /// Create a temporary directory with test .desktop files and mimeapps.list.
    fn create_test_env(dir: &Path) -> TestEnvResult {
        // Create .desktop files
        let apps_dir = dir.join("applications");
        fs::create_dir_all(&apps_dir).unwrap();

        // LibreOffice Writer
        let mut f = fs::File::create(apps_dir.join("libreoffice-writer.desktop")).unwrap();
        writeln!(
            f,
            "[Desktop Entry]\n\
             Name=LibreOffice Writer\n\
             Exec=/usr/bin/libreoffice --writer %U\n\
             Icon=libreoffice-writer\n\
             Type=Application\n\
             MimeType=application/vnd.oasis.opendocument.text;application/msword;application/vnd.openxmlformats-officedocument.wordprocessingml.document;\n\
             Terminal=false"
        )
        .unwrap();

        // GIMP
        let mut f = fs::File::create(apps_dir.join("gimp.desktop")).unwrap();
        writeln!(
            f,
            "[Desktop Entry]\n\
             Name=GIMP\n\
             Exec=/usr/bin/gimp %U\n\
             Icon=gimp\n\
             Type=Application\n\
             MimeType=image/png;image/jpeg;image/gif;image/bmp;image/tiff;\n\
             Terminal=false"
        )
        .unwrap();

        // A hidden app (should be excluded)
        let mut f = fs::File::create(apps_dir.join("hidden-app.desktop")).unwrap();
        writeln!(
            f,
            "[Desktop Entry]\n\
             Name=Hidden App\n\
             Exec=/usr/bin/hidden\n\
             Type=Application\n\
             Hidden=true\n\
             MimeType=text/plain;"
        )
        .unwrap();

        // A NoDisplay app (should be excluded)
        let mut f = fs::File::create(apps_dir.join("no-display-app.desktop")).unwrap();
        writeln!(
            f,
            "[Desktop Entry]\n\
             Name=No Display App\n\
             Exec=/usr/bin/nodisplay\n\
             Type=Application\n\
             NoDisplay=true\n\
             MimeType=text/plain;"
        )
        .unwrap();

        // Text editor
        let mut f = fs::File::create(apps_dir.join("text-editor.desktop")).unwrap();
        writeln!(
            f,
            "[Desktop Entry]\n\
             Name=Text Editor\n\
             Exec=/usr/bin/gedit %U\n\
             Icon=text-editor\n\
             Type=Application\n\
             MimeType=text/plain;text/x-python;\n\
             Terminal=false"
        )
        .unwrap();

        // A Link type (should be excluded — not Application)
        let mut f = fs::File::create(apps_dir.join("web-link.desktop")).unwrap();
        writeln!(
            f,
            "[Desktop Entry]\n\
             Name=Web Link\n\
             Type=Link\n\
             URL=https://example.com"
        )
        .unwrap();

        // Create mimeapps.list
        let mut f = fs::File::create(apps_dir.join("mimeapps.list")).unwrap();
        writeln!(
            f,
            "[Default Applications]\n\
             application/vnd.openxmlformats-officedocument.wordprocessingml.document=libreoffice-writer.desktop\n\
             image/png=gimp.desktop\n\
             text/plain=text-editor.desktop\n\
             \n\
             [Added Associations]\n\
             image/png=gimp.desktop;libreoffice-writer.desktop;\n\
             text/plain=text-editor.desktop;"
        )
        .unwrap();

        // Parse them
        let entries = parse_desktop_entries_from_dir(&apps_dir);
        let (defaults, added) = parse_mimeapps_list(&apps_dir.join("mimeapps.list"));

        (entries, defaults, added)
    }

    /// Parse desktop entries from a specific directory (for testing).
    fn parse_desktop_entries_from_dir(dir: &Path) -> HashMap<String, DesktopEntry> {
        let mut entries = HashMap::new();
        if let Ok(dir_entries) = fs::read_dir(dir) {
            for entry in dir_entries.flatten() {
                let path = entry.path();
                if path.extension().is_none_or(|ext| ext != "desktop") {
                    continue;
                }
                if let Some(parsed) = LinuxAppRegistry::parse_desktop_file(&path) {
                    entries.insert(parsed.desktop_id.clone(), parsed);
                }
            }
        }
        entries
    }

    /// Parse a single mimeapps.list file (for testing).
    fn parse_mimeapps_list(path: &Path) -> (HashMap<String, String>, HashMap<String, Vec<String>>) {
        let mut defaults: HashMap<String, String> = HashMap::new();
        let mut added: HashMap<String, Vec<String>> = HashMap::new();

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return (defaults, added),
        };

        let mut section = Section::None;

        for line in content.lines() {
            let line = line.trim();

            if line.starts_with('[') {
                section = match line {
                    "[Default Applications]" => Section::Defaults,
                    "[Added Associations]" => Section::Added,
                    _ => Section::None,
                };
                continue;
            }

            if line.starts_with('#') || line.is_empty() {
                continue;
            }

            if let Some((mime, desktop_ids_str)) = line.split_once('=') {
                let mime = mime.trim().to_string();
                let desktop_ids: Vec<String> = desktop_ids_str
                    .split(';')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.strip_suffix(".desktop").unwrap_or(&s).to_string())
                    .collect();

                match section {
                    Section::Defaults => {
                        if let Some(first) = desktop_ids.first() {
                            defaults.insert(mime, first.clone());
                        }
                    }
                    Section::Added => {
                        added.entry(mime).or_default().extend(desktop_ids);
                    }
                    Section::None => {}
                }
            }
        }

        (defaults, added)
    }

    //
    // test_parse_desktop_file_basic
    //
    #[test]
    fn test_parse_desktop_file_basic() {
        let dir = tempfile::tempdir().unwrap();
        let (entries, _, _) = create_test_env(dir.path());

        // Should have exactly 3 visible Application entries
        assert_eq!(entries.len(), 3, "Expected 3 entries, got: {entries:?}");
        assert!(entries.contains_key("libreoffice-writer"));
        assert!(entries.contains_key("gimp"));
        assert!(entries.contains_key("text-editor"));

        // Hidden and NoDisplay apps should be excluded
        assert!(!entries.contains_key("hidden-app"));
        assert!(!entries.contains_key("no-display-app"));

        // Link type should be excluded
        assert!(!entries.contains_key("web-link"));
    }

    //
    // test_parse_desktop_file_fields
    //
    #[test]
    fn test_parse_desktop_file_fields() {
        let dir = tempfile::tempdir().unwrap();
        let (entries, _, _) = create_test_env(dir.path());

        let writer = entries.get("libreoffice-writer").unwrap();
        assert_eq!(writer.name, "LibreOffice Writer");
        assert_eq!(writer.exec, "/usr/bin/libreoffice --writer %U");
        assert_eq!(writer.icon.as_deref(), Some("libreoffice-writer"));
        assert!(!writer.terminal);
        assert!(writer.mime_types.contains(&"application/msword".to_string()));
        assert!(writer
            .mime_types
            .contains(&"application/vnd.openxmlformats-officedocument.wordprocessingml.document".to_string()));
    }

    //
    // test_parse_mimeapps_list
    //
    #[test]
    fn test_parse_mimeapps_list() {
        let dir = tempfile::tempdir().unwrap();
        let (_, defaults, added) = create_test_env(dir.path());

        // Check defaults
        assert_eq!(
            defaults.get("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            Some(&"libreoffice-writer".to_string())
        );
        assert_eq!(defaults.get("image/png"), Some(&"gimp".to_string()));
        assert_eq!(defaults.get("text/plain"), Some(&"text-editor".to_string()));

        // Check added associations
        let png_added = added.get("image/png").unwrap();
        assert!(png_added.contains(&"gimp".to_string()));
    }

    //
    // test_apps_for_mime_with_default
    //
    #[test]
    fn test_apps_for_mime_with_default() {
        let dir = tempfile::tempdir().unwrap();
        let (entries, defaults, added) = create_test_env(dir.path());

        let registry = LinuxAppRegistry { entries, defaults, added };

        let apps = registry.apps_for_mime("image/png");
        assert!(!apps.is_empty(), "Should find at least one app for image/png");

        // GIMP should be default and first
        let gimp = &apps[0];
        assert_eq!(gimp.name, "GIMP");
        assert!(gimp.is_default);
        assert_eq!(gimp.executable, PathBuf::from("/usr/bin/gimp"));
    }

    //
    // test_apps_for_mime_no_duplicates
    //
    #[test]
    fn test_apps_for_mime_no_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let (entries, defaults, added) = create_test_env(dir.path());

        let registry = LinuxAppRegistry { entries, defaults, added };

        let apps = registry.apps_for_mime("image/png");
        let names: Vec<&str> = apps.iter().map(|a| a.name.as_str()).collect();
        let unique: std::collections::HashSet<&str> = names.iter().copied().collect();
        assert_eq!(names.len(), unique.len(), "Duplicate apps found: {names:?}");
    }

    //
    // test_apps_for_unknown_mime
    //
    #[test]
    fn test_apps_for_unknown_mime() {
        let dir = tempfile::tempdir().unwrap();
        let (entries, defaults, added) = create_test_env(dir.path());

        let registry = LinuxAppRegistry { entries, defaults, added };

        let apps = registry.apps_for_mime("application/x-totally-unknown-type");
        assert!(apps.is_empty(), "Unknown MIME type should return no apps");
    }

    //
    // test_extract_executable
    //
    #[test]
    fn test_extract_executable() {
        assert_eq!(
            LinuxAppRegistry::extract_executable("/usr/bin/libreoffice --writer %U"),
            PathBuf::from("/usr/bin/libreoffice")
        );
        assert_eq!(
            LinuxAppRegistry::extract_executable("/usr/bin/gimp %U"),
            PathBuf::from("/usr/bin/gimp")
        );
        assert_eq!(LinuxAppRegistry::extract_executable("vim"), PathBuf::from("vim"));
    }

    //
    // test_hidden_and_nodisplay_excluded
    //
    #[test]
    fn test_hidden_and_nodisplay_excluded() {
        let dir = tempfile::tempdir().unwrap();
        let (entries, _, _) = create_test_env(dir.path());

        assert!(!entries.contains_key("hidden-app"));
        assert!(!entries.contains_key("no-display-app"));
    }

    //
    // test_non_application_type_excluded
    //
    #[test]
    fn test_non_application_type_excluded() {
        let dir = tempfile::tempdir().unwrap();
        let (entries, _, _) = create_test_env(dir.path());

        assert!(!entries.contains_key("web-link"));
    }

    //
    // test_only_default_is_marked
    //
    #[test]
    fn test_only_default_is_marked() {
        let dir = tempfile::tempdir().unwrap();
        let (entries, defaults, added) = create_test_env(dir.path());

        let registry = LinuxAppRegistry { entries, defaults, added };

        let apps = registry.apps_for_mime("text/plain");
        let default_count = apps.iter().filter(|a| a.is_default).count();
        assert!(default_count <= 1, "At most one app should be marked default, got {default_count}");

        if let Some(first) = apps.first() {
            if first.name == "Text Editor" {
                assert!(first.is_default);
            }
        }
    }
}
