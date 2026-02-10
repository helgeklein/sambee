/**
 * Root application component for Sambee Companion.
 *
 * The companion app runs primarily as a system tray application. This webview
 * component serves as a minimal UI surface for the "Done Editing" window and
 * the app picker dialog. In tray-only mode (no active edit operations), the
 * webview may not be visible at all.
 *
 * The app listens for Tauri events to determine which view to show:
 * - "show-app-picker" → displays the AppPicker for a given file extension
 * - "leftover-operations" → displays recovery dialogs for previous sessions
 * - "confirm-large-file" → displays a large-file warning dialog
 */

import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "preact/hooks";

import { AppPicker } from "./components/AppPicker";
import type { LargeFileInfo } from "./components/LargeFileWarning";
import { LargeFileWarning } from "./components/LargeFileWarning";
import type { LeftoverInfo } from "./components/RecoveryDialog";
import { RecoveryDialog } from "./components/RecoveryDialog";
import type { NativeApp } from "./types";

/** Payload sent with the "show-app-picker" Tauri event. */
interface AppPickerEventPayload {
  /** File extension without leading dot (e.g. "docx"). */
  extension: string;
  /** Opaque request ID that must be echoed back with the result. */
  request_id: string;
}

/** Possible view states for the companion webview. */
type ViewState = { kind: "idle" } | { kind: "app-picker"; extension: string; requestId: string };

//
// App
//
/**
 * Root component. Switches between idle and dialog views based on Tauri events.
 */
export function App() {
  const [view, setView] = useState<ViewState>({ kind: "idle" });
  const [leftovers, setLeftovers] = useState<LeftoverInfo[] | null>(null);
  const [largeFile, setLargeFile] = useState<LargeFileInfo | null>(null);

  // Listen for Tauri events from the Rust backend
  useEffect(() => {
    const unlistenPicker = listen<AppPickerEventPayload>("show-app-picker", (event) => {
      setView({
        kind: "app-picker",
        extension: event.payload.extension,
        requestId: event.payload.request_id,
      });
    });

    const unlistenRecovery = listen<LeftoverInfo[]>("leftover-operations", (event) => {
      if (event.payload.length > 0) {
        setLeftovers(event.payload);
      }
    });

    const unlistenLargeFile = listen<LargeFileInfo>("confirm-large-file", (event) => {
      setLargeFile(event.payload);
    });

    return () => {
      unlistenPicker.then((fn) => fn());
      unlistenRecovery.then((fn) => fn());
      unlistenLargeFile.then((fn) => fn());
    };
  }, []);

  //
  // handleAppSelected
  //
  /** Called when the user picks an app in the AppPicker. */
  const handleAppSelected = useCallback((app: NativeApp, _alwaysUse: boolean) => {
    // TODO (Phase 4): emit result event back to Rust with app.executable
    //   and view.requestId so the backend can proceed with opening the file.
    console.info(`App selected: ${app.name} (${app.executable}), always-use: ${_alwaysUse}`);
    setView({ kind: "idle" });
  }, []);

  //
  // handleCancel
  //
  /** Called when the user cancels the AppPicker. */
  const handleCancel = useCallback(() => {
    setView({ kind: "idle" });
  }, []);

  //
  // handleRecoveryDone
  //
  /** Called when all leftover recovery items have been handled. */
  const handleRecoveryDone = useCallback(() => {
    setLeftovers(null);
  }, []);

  //
  // handleLargeFileResolved
  //
  /** Called after the user responds to the large-file warning. */
  const handleLargeFileResolved = useCallback(() => {
    setLargeFile(null);
  }, []);

  // ── Render overlays (recovery + large file) ───────────────────────────

  // Large-file warning takes priority (it blocks a lifecycle)
  if (largeFile) {
    return <LargeFileWarning info={largeFile} onResolved={handleLargeFileResolved} />;
  }

  // Recovery dialog (shown at startup over the idle/main view)
  if (leftovers && leftovers.length > 0) {
    return <RecoveryDialog leftovers={leftovers} onDone={handleRecoveryDone} />;
  }

  // Render the current view
  switch (view.kind) {
    case "app-picker":
      return <AppPicker extension={view.extension} onSelect={handleAppSelected} onCancel={handleCancel} />;
    default:
      return (
        <div class="app">
          <h1>Sambee Companion</h1>
          <p>Running in system tray. No active edit operations.</p>
        </div>
      );
  }
}
