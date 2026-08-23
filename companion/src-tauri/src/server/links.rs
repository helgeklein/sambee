//! Resolution of local filesystem links for browser activation.

use std::fs;
use std::path::{Path, PathBuf};

use thiserror::Error;

/// A user-actionable failure while resolving a local link target.
#[derive(Debug, Error)]
pub enum LinkResolutionError {
    #[error("The link target no longer exists")]
    TargetMissing,

    #[error("The link target is not accessible")]
    TargetAccessDenied,

    #[error("Could not resolve link target: {0}")]
    Unresolvable(String),
}

/// Resolve a path to its final filesystem target.
///
/// On Unix-like systems and for Windows filesystem links, canonicalization
/// follows symbolic links and junctions. Windows `.lnk` files require the
/// Shell Link API because they are regular files rather than filesystem links.
pub fn resolve_activation_target(source: &Path) -> Result<PathBuf, LinkResolutionError> {
    #[cfg(target_os = "windows")]
    let target = if is_windows_shortcut(source) {
        resolve_windows_shortcut(source)?
    } else {
        source.to_path_buf()
    };

    #[cfg(not(target_os = "windows"))]
    let target = source.to_path_buf();

    canonicalize_target(&target)
}

fn canonicalize_target(path: &Path) -> Result<PathBuf, LinkResolutionError> {
    fs::canonicalize(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => LinkResolutionError::TargetMissing,
        std::io::ErrorKind::PermissionDenied => LinkResolutionError::TargetAccessDenied,
        _ => LinkResolutionError::Unresolvable(error.to_string()),
    })
}

#[cfg(target_os = "windows")]
fn is_windows_shortcut(path: &Path) -> bool {
    path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
}

#[cfg(target_os = "windows")]
fn resolve_windows_shortcut(source: &Path) -> Result<PathBuf, LinkResolutionError> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;

    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLGP_RAWPATH, SLR_NO_UI};

    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(iter::once(0)).collect();

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|error| LinkResolutionError::Unresolvable(format!("could not initialize COM: {error}")))?;

        let result = (|| {
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| LinkResolutionError::Unresolvable(format!("could not create Shell Link: {error}")))?;
            let persist_file: IPersistFile = shell_link
                .cast()
                .map_err(|error| LinkResolutionError::Unresolvable(format!("could not access Shell Link persistence: {error}")))?;

            persist_file
                .Load(PCWSTR(source_wide.as_ptr()), STGM_READ)
                .map_err(|error| LinkResolutionError::Unresolvable(format!("could not load shortcut: {error}")))?;
            shell_link
                .Resolve(HWND::default(), SLR_NO_UI.0 as u32)
                .map_err(|error| LinkResolutionError::Unresolvable(format!("could not resolve shortcut: {error}")))?;

            let mut target = [0u16; 32_768];
            shell_link
                .GetPath(&mut target, std::ptr::null_mut(), SLGP_RAWPATH.0 as u32)
                .map_err(|error| LinkResolutionError::Unresolvable(format!("could not read shortcut target: {error}")))?;
            let length = target.iter().position(|character| *character == 0).unwrap_or(target.len());
            if length == 0 {
                return Err(LinkResolutionError::Unresolvable(
                    "shortcut does not target a filesystem path".to_string(),
                ));
            }

            Ok(PathBuf::from(String::from_utf16_lossy(&target[..length])))
        })();

        CoUninitialize();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_activation_target, LinkResolutionError};
    use std::fs;

    #[cfg(windows)]
    fn create_windows_shortcut(shortcut: &std::path::Path, target: &std::path::Path) {
        use std::iter;
        use std::os::windows::ffi::OsStrExt;

        use windows::core::{Interface, PCWSTR};
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

        let shortcut_wide: Vec<u16> = shortcut.as_os_str().encode_wide().chain(iter::once(0)).collect();
        let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(iter::once(0)).collect();

        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .expect("COM should initialize for shortcut test");

            let result = (|| {
                let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                shell_link.SetPath(PCWSTR(target_wide.as_ptr()))?;
                let persist_file: IPersistFile = shell_link.cast()?;
                persist_file.Save(PCWSTR(shortcut_wide.as_ptr()), true)?;
                Ok::<_, windows::core::Error>(())
            })();

            CoUninitialize();
            result.expect("Windows shortcut should be created");
        }
    }

    #[test]
    fn resolves_a_regular_file_to_its_canonical_path() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let file = directory.path().join("report.txt");
        fs::write(&file, "report").expect("temporary file should be written");

        assert_eq!(
            resolve_activation_target(&file).expect("file should resolve"),
            fs::canonicalize(file).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn resolves_a_symbolic_link_to_its_target() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let target = directory.path().join("target.txt");
        let link = directory.path().join("target-link");
        fs::write(&target, "target").expect("temporary file should be written");
        symlink(&target, &link).expect("symbolic link should be created");

        assert_eq!(
            resolve_activation_target(&link).expect("link should resolve"),
            fs::canonicalize(target).unwrap()
        );
    }

    #[test]
    fn reports_a_missing_target() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");

        assert!(matches!(
            resolve_activation_target(&directory.path().join("missing")),
            Err(LinkResolutionError::TargetMissing)
        ));
    }

    #[cfg(windows)]
    #[test]
    fn resolves_a_windows_shortcut_to_a_file_target() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let target = directory.path().join("report.txt");
        let shortcut = directory.path().join("report.lnk");
        fs::write(&target, "report").expect("temporary file should be written");
        create_windows_shortcut(&shortcut, &target);

        assert_eq!(
            resolve_activation_target(&shortcut).expect("shortcut should resolve"),
            fs::canonicalize(target).unwrap()
        );
    }

    #[cfg(windows)]
    #[test]
    fn resolves_a_windows_shortcut_to_a_directory_target() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let target = directory.path().join("archive");
        let shortcut = directory.path().join("archive.lnk");
        fs::create_dir(&target).expect("temporary directory should be created");
        create_windows_shortcut(&shortcut, &target);

        assert_eq!(
            resolve_activation_target(&shortcut).expect("shortcut should resolve"),
            fs::canonicalize(target).unwrap()
        );
    }

    #[cfg(windows)]
    #[test]
    fn reports_a_missing_target_for_a_windows_shortcut() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let target = directory.path().join("report.txt");
        let shortcut = directory.path().join("report.lnk");
        fs::write(&target, "report").expect("temporary file should be written");
        create_windows_shortcut(&shortcut, &target);
        fs::remove_file(&target).expect("temporary file should be removed");

        assert!(matches!(
            resolve_activation_target(&shortcut),
            Err(LinkResolutionError::TargetMissing)
        ));
    }
}
