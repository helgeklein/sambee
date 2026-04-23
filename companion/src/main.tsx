import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { render } from "preact";
import { App } from "./App";
import { AppPickerPreview } from "./components/AppPickerPreview";
import { DoneEditingWindow } from "./components/DoneEditingWindow";
import { PairingWindow } from "./components/PairingWindow";
import { applyCompanionLocalization, type CompanionLocalizationState } from "./i18n";
import { applyFallbackTheme, applyThemeFromBase64 } from "./lib/theme";
import { scheduleUpdateCheck } from "./lib/updateCheck";
import "./styles/global.css";

const APP_PICKER_PREVIEW_PATH = "/preview/app-picker";

/**
 * Entry point — routes to the appropriate component based on the window's
 * URL path. The main window loads "/", the dedicated pairing window loads
 * "/pairing", and "Done Editing" secondary windows load "/done-editing"
 * (set by the Rust `WebviewUrl::App` call).
 *
 * Applies a fallback theme immediately (based on OS light/dark preference),
 * then listens for "apply-theme" events from the Rust backend to switch to
 * the user's actual Sambee theme (delivered as base64-encoded JSON).
 */

// Apply a sensible default theme before the first paint.
applyFallbackTheme();

const path = window.location.pathname;
const isAppPickerPreview = path === APP_PICKER_PREVIEW_PATH;

// Block browser-style reload shortcuts so the companion behaves like a native app.
const preventReloadShortcut = (event: KeyboardEvent) => {
  const isReloadShortcut = event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r");
  if (!isReloadShortcut) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
};

if (!isAppPickerPreview) {
  window.addEventListener("keydown", preventReloadShortcut, true);
}

if (!isAppPickerPreview) {
  listen<string>("apply-theme", (event) => {
    applyThemeFromBase64(event.payload);
  });

  listen<CompanionLocalizationState>("localization-updated", (event) => {
    void applyCompanionLocalization(event.payload);
  });

  void invoke<CompanionLocalizationState | null>("get_synced_localization")
    .then((state) => {
      if (!state) {
        return;
      }

      return applyCompanionLocalization(state);
    })
    .catch(() => {
      // Ignore hydration failures; the companion falls back to local defaults.
    });
}

const root = document.getElementById("app");
if (root) {
  if (isAppPickerPreview) {
    render(<AppPickerPreview />, root);
  } else if (path === "/done-editing") {
    render(<DoneEditingWindow />, root);
  } else if (path === "/pairing") {
    render(<PairingWindow />, root);
  } else {
    render(<App />, root);
    // Check for updates shortly after main UI renders
    scheduleUpdateCheck();
  }
}
