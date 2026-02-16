//! Installer shutdown coordination via a named Win32 event.
//!
//! At startup, the companion creates a named event
//! (`Global\SambeeCompanionShutdown-6AE8B758-5977-464C-A774-9E57EE3080A9`).
//! A background thread blocks on the
//! event.  When the MSI installer signals the event (via a custom action
//! before `InstallInitialize`), the thread wakes, checks for active
//! editing sessions, and — if idle — calls `app.exit(0)`.
//!
//! If an edit *is* in progress the thread logs a warning and does **not**
//! exit.  The installer will then encounter the locked executable and
//! show a "Files In Use" dialog, giving the user a chance to finish
//! editing first.

#[cfg(windows)]
use log::{error, info, warn};
#[cfg(windows)]
use tauri::Manager;

#[cfg(windows)]
use crate::sync::operations::OperationStore;

/// Name of the global Win32 event.  The "Global\" prefix makes it
/// visible across all sessions (important when the installer runs
/// elevated in session 0 while the companion runs in the user session).
#[cfg(windows)]
const SHUTDOWN_EVENT_NAME: &str = "Global\\SambeeCompanionShutdown-6AE8B758-5977-464C-A774-9E57EE3080A9";

//
// spawn_shutdown_listener
//
/// Create the named event and spawn a thread that waits for it.
///
/// Safe to call on non-Windows platforms — the function is a no-op there.
#[cfg(windows)]
pub fn spawn_shutdown_listener(app: &tauri::App) {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{CreateEventW, ResetEvent, WaitForSingleObject, INFINITE};

    let event_name = HSTRING::from(SHUTDOWN_EVENT_NAME);

    // Create a manual-reset event, initially non-signaled.
    let event = match unsafe { CreateEventW(None, true, false, &event_name) } {
        Ok(handle) => handle,
        Err(e) => {
            error!("Failed to create shutdown event: {e}");
            return;
        }
    };

    info!("Shutdown event created: {SHUTDOWN_EVENT_NAME}");

    // Store the handle as a raw pointer value so the closure is Send.
    // Win32 event handles are process-global and safe to use from any
    // thread — the kernel object is reference-counted and stays valid
    // until explicitly closed.
    let event_ptr = event.0 as usize;
    let app_handle = app.handle().clone();

    std::thread::Builder::new()
        .name("shutdown-event-listener".into())
        .spawn(move || {
            let event = HANDLE(event_ptr as *mut std::ffi::c_void);

            loop {
                let result = unsafe { WaitForSingleObject(event, INFINITE) };

                if result != WAIT_OBJECT_0 {
                    error!("WaitForSingleObject returned unexpected result: {result:?}");
                    break;
                }

                info!("Shutdown event signaled by installer");

                let editing = app_handle
                    .try_state::<OperationStore>()
                    .map(|s| !s.active_operations().is_empty())
                    .unwrap_or(false);

                if editing {
                    warn!(
                        "Installer requested shutdown but editing is in progress \u{2014} \
                         refusing. The installer will show a 'Files In Use' dialog."
                    );
                    // Reset the event so the installer can retry if needed.
                    let _ = unsafe { ResetEvent(event) };
                    continue;
                }

                info!("No active edits \u{2014} exiting companion for installer");
                app_handle.exit(0);
                break;
            }
        })
        .expect("Failed to spawn shutdown event listener thread");
}

/// No-op on non-Windows platforms.
#[cfg(not(windows))]
pub fn spawn_shutdown_listener(_app: &tauri::App) {}
