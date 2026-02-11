import { listen } from "@tauri-apps/api/event";
import { render } from "preact";
import { App } from "./App";
import { DoneEditingWindow } from "./components/DoneEditingWindow";
import { applyFallbackTheme, applyThemeFromBase64 } from "./lib/theme";
import { scheduleUpdateCheck } from "./lib/updateCheck";
import "./styles/global.css";

/**
 * Entry point — routes to the appropriate component based on the window's
 * URL path. The main window loads "/", while "Done Editing" secondary
 * windows load "/done-editing" (set by the Rust `WebviewUrl::App` call).
 *
 * Applies a fallback theme immediately (based on OS light/dark preference),
 * then listens for "apply-theme" events from the Rust backend to switch to
 * the user's actual Sambee theme (delivered as base64-encoded JSON).
 */

// Apply a sensible default theme before the first paint.
applyFallbackTheme();

// Listen for theme updates from the Rust backend (deep-link URI payload).
listen<string>("apply-theme", (event) => {
  applyThemeFromBase64(event.payload);
});

const root = document.getElementById("app");
if (root) {
  const path = window.location.pathname;

  if (path === "/done-editing") {
    render(<DoneEditingWindow />, root);
  } else {
    render(<App />, root);
    // Check for updates shortly after main UI renders
    scheduleUpdateCheck();
  }
}
