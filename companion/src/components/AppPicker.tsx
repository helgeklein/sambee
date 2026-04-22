/**
 * App Picker dialog component.
 *
 * Presents a list of native desktop applications that can open a given file
 * type. The user can select an app, optionally check "Always use this app",
 * browse for an unlisted app, or cancel.
 *
 * Usage:
 * ```tsx
 * <AppPicker
 *   extension="docx"
 *   onSelect={(app, alwaysUse) => { ... }}
 *   onCancel={() => { ... }}
 * />
 * ```
 */

import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { translate } from "../i18n";
import { log } from "../lib/logger";
import { getPreferredApp, setPreferredApp } from "../stores/appPreferences";
import type { NativeApp } from "../types";
import { ModalDialog } from "./ModalDialog";
import "../styles/app-picker.css";

/** Props for the AppPicker component. */
interface AppPickerProps {
  /** File extension without leading dot (e.g. "docx", "png"). */
  extension: string;

  /**
   * Called when the user confirms their selection.
   *
   * @param app - The selected native application.
   * @param alwaysUse - Whether the "Always use" checkbox was checked.
   */
  onSelect: (app: NativeApp, alwaysUse: boolean) => void;

  /** Called when the user cancels the picker. */
  onCancel: () => void;
}

/** Loading states for the picker. */
type PickerState = { kind: "loading" } | { kind: "loaded"; apps: NativeApp[] } | { kind: "error"; message: string };

const APP_PICKER_FALLBACK_WIDTH = 420;
const APP_PICKER_MIN_HEIGHT = 220;
const APP_PICKER_SCREEN_MARGIN = 48;
const APP_PICKER_HEIGHT_EPSILON = 1;
const APP_PICKER_ROUNDING_BUFFER = 1;

//
// AppPicker
//
/**
 * Dialog for choosing a native application to open a file type.
 *
 * Fetches available apps from the Rust backend via the `get_apps_for_file`
 * Tauri command. Shows the default handler first (labelled "(default)").
 * Supports "Always use" persistence and a "Browse" fallback.
 */
export function AppPicker({ extension, onSelect, onCancel }: AppPickerProps) {
  const [state, setState] = useState<PickerState>({ kind: "loading" });
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [alwaysUse, setAlwaysUse] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const lastWindowHeightRef = useRef<number | null>(null);
  const titleId = `app-picker-title-${extension}`;

  const resizeWindowToContent = useCallback(async () => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const measuredHeight = measureAppPickerHeight(panel);
    if (measuredHeight <= 0) {
      return;
    }

    const maxHeight = getAppPickerMaxHeight();
    const targetHeight = Math.min(Math.max(measuredHeight, APP_PICKER_MIN_HEIGHT), maxHeight);

    if (lastWindowHeightRef.current !== null && Math.abs(lastWindowHeightRef.current - targetHeight) < APP_PICKER_HEIGHT_EPSILON) {
      return;
    }

    lastWindowHeightRef.current = targetHeight;

    try {
      const targetWidth = window.innerWidth > 0 ? Math.ceil(window.innerWidth) : APP_PICKER_FALLBACK_WIDTH;
      await getCurrentWindow().setSize(new LogicalSize(targetWidth, targetHeight));
    } catch (err: unknown) {
      log.warn("Failed to resize app picker window:", err);
    }
  }, []);

  const scheduleWindowResize = useCallback(() => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      void resizeWindowToContent();
    });
  }, [resizeWindowToContent]);

  // Keep the listbox focused and scroll the selected item into view
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
    // Focus the listbox container (not individual items) so Tab
    // navigates between the list and the other dialog controls.
    listRef.current.focus({ preventScroll: true });
  }, [selectedIndex]);

  useEffect(() => {
    scheduleWindowResize();

    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, [scheduleWindowResize, state.kind, state.kind === "loaded" ? state.apps.length : 0]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !panelRef.current) {
      return;
    }

    const observer = new ResizeObserver(() => {
      scheduleWindowResize();
    });

    observer.observe(panelRef.current);

    return () => {
      observer.disconnect();
    };
  }, [scheduleWindowResize]);

  // Fetch available apps and check for a saved preference
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [apps, preferredExe] = await Promise.all([
          invoke<NativeApp[]>("get_apps_for_file", { extension }),
          getPreferredApp(extension).catch(() => null),
        ]);

        if (cancelled) return;

        setState({ kind: "loaded", apps });

        // Auto-select the preferred app, or the default, or the first app
        if (apps.length > 0) {
          let autoIndex = -1;

          if (preferredExe) {
            autoIndex = apps.findIndex((a) => a.executable === preferredExe);
          }
          if (autoIndex < 0) {
            autoIndex = apps.findIndex((a) => a.is_default);
          }
          if (autoIndex < 0) {
            autoIndex = 0;
          }

          setSelectedIndex(autoIndex);
          setAlwaysUse(preferredExe !== null);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [extension]);

  //
  // handleOpen
  //
  /** Confirm the selection, saving preference if "Always use" is checked. */
  const handleOpen = useCallback(async () => {
    if (state.kind !== "loaded" || selectedIndex < 0) return;

    const app = state.apps[selectedIndex];
    if (!app) return;

    if (alwaysUse) {
      try {
        await setPreferredApp(extension, app.executable);
      } catch {
        // Non-critical: preference save failure shouldn't block opening
        log.warn(`Failed to save app preference for .${extension}`);
      }
    }

    onSelect(app, alwaysUse);
  }, [state, selectedIndex, alwaysUse, extension, onSelect]);

  //
  // handleBrowse
  //
  /**
   * Opens a file dialog for the user to browse for an unlisted application.
   *
   * The selected executable is added to the app list and auto-selected.
   */
  const handleBrowse = useCallback(async () => {
    if (state.kind !== "loaded") return;

    try {
      const selected = await openDialog({
        title: translate("appPicker.browseDialogTitle"),
        multiple: false,
        directory: false,
      });

      if (!selected) return;

      // Normalize: open() returns string | string[] | null
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath) return;

      // Extract a display name from the executable path
      const name = extractDisplayName(filePath);

      const browsedApp: NativeApp = {
        name,
        executable: filePath,
        icon: null,
        is_default: false,
      };

      // Add to the apps list (if not already present) and select it
      const existingIndex = state.apps.findIndex((a) => a.executable === filePath);

      if (existingIndex >= 0) {
        setSelectedIndex(existingIndex);
      } else {
        const updatedApps = [...state.apps, browsedApp];
        setState({ kind: "loaded", apps: updatedApps });
        setSelectedIndex(updatedApps.length - 1);
      }
    } catch (err: unknown) {
      log.warn("Browse dialog failed:", err);
    }
  }, [state]);

  //
  // handleListKeyDown
  //
  /** Keyboard navigation within the app listbox. */
  const handleListKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (state.kind !== "loaded") return;
      const count = state.apps.length;
      if (count === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, count - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          setSelectedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setSelectedIndex(count - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          handleOpen();
          break;
      }
    },
    [state, handleOpen]
  );

  return (
    <ModalDialog
      onRequestClose={onCancel}
      initialFocusRef={listRef}
      panelRef={panelRef}
      titleId={titleId}
      panelClassName="app-picker"
      overlayClassName="app-picker-shell"
      includeDefaultOverlayClass={false}
      includeDefaultPanelClass={false}
    >
      <h2 id={titleId} class="app-picker__header">
        {translate("appPicker.title", { extension })}
      </h2>

      {state.kind === "loading" && <div class="app-picker__loading">{translate("appPicker.loading")}</div>}

      {state.kind === "error" && <div class="app-picker__error">{state.message}</div>}

      {state.kind === "loaded" && state.apps.length === 0 && (
        <div class="app-picker__empty">{translate("appPicker.empty", { extension })}</div>
      )}

      {state.kind === "loaded" && state.apps.length > 0 && (
        <>
          <div
            class="app-picker__list"
            role="listbox"
            ref={listRef}
            tabIndex={0}
            aria-activedescendant={selectedIndex >= 0 ? `app-picker-item-${selectedIndex}` : undefined}
            onKeyDown={handleListKeyDown}
          >
            {state.apps.map((app, index) => (
              <div
                key={app.executable}
                id={`app-picker-item-${index}`}
                class={`app-picker__item${index === selectedIndex ? " app-picker__item--selected" : ""}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === selectedIndex}
                onClick={() => {
                  setSelectedIndex(index);
                  listRef.current?.focus();
                }}
                // Keyboard events bubble up to the listbox container's onKeyDown.
                onKeyDown={() => {}}
                onDblClick={() => {
                  setSelectedIndex(index);
                  handleOpen();
                }}
              >
                {app.icon ? (
                  <img
                    class="app-picker__icon"
                    src={`data:image/png;base64,${app.icon}`}
                    alt={translate("appPicker.iconAlt", { appName: app.name })}
                  />
                ) : (
                  <div class="app-picker__icon-placeholder">📄</div>
                )}
                <div class="app-picker__info">
                  <span class="app-picker__name">
                    {app.name}
                    {app.is_default && ` ${translate("appPicker.defaultBadge")}`}
                  </span>
                  <span class="app-picker__path">{app.executable}</span>
                </div>
              </div>
            ))}
          </div>

          <label class="app-picker__always-use">
            <input type="checkbox" checked={alwaysUse} onChange={(e) => setAlwaysUse((e.target as HTMLInputElement).checked)} />
            {translate("appPicker.alwaysUse", { extension })}
          </label>
        </>
      )}

      <div class="app-picker__actions">
        <button type="button" class="app-picker__browse-btn" onClick={handleBrowse} disabled={state.kind === "loading"}>
          {translate("appPicker.browseButton")}
        </button>
        <div class="app-picker__btn-group">
          <button type="button" class="app-picker__btn" onClick={onCancel}>
            {translate("common.actions.cancel")}
          </button>
          <button
            type="button"
            class="app-picker__btn app-picker__btn--primary"
            onClick={handleOpen}
            disabled={state.kind !== "loaded" || selectedIndex < 0}
          >
            {translate("common.actions.open")}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}

function measureAppPickerHeight(panel: HTMLDivElement): number {
  const panelRectHeight = Math.ceil(panel.getBoundingClientRect().height);
  const panelScrollHeight = Math.ceil(panel.scrollHeight + getVerticalBorderWidth(panel));

  return Math.max(panelRectHeight, panelScrollHeight) + APP_PICKER_ROUNDING_BUFFER;
}

function getVerticalBorderWidth(panel: HTMLDivElement): number {
  const styles = window.getComputedStyle(panel);
  const borderTopWidth = Number.parseFloat(styles.borderTopWidth || "0");
  const borderBottomWidth = Number.parseFloat(styles.borderBottomWidth || "0");

  return borderTopWidth + borderBottomWidth;
}

function getAppPickerMaxHeight(): number {
  const availableScreenHeight = window.screen.availHeight;
  if (availableScreenHeight > 0) {
    return Math.max(APP_PICKER_MIN_HEIGHT, availableScreenHeight - APP_PICKER_SCREEN_MARGIN);
  }

  return Number.POSITIVE_INFINITY;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

//
// extractDisplayName
//
/**
 * Extracts a human-readable display name from an executable path.
 *
 * Examples:
 * - "/usr/bin/libreoffice" → "libreoffice"
 * - "C:\\Program Files\\App\\editor.exe" → "editor"
 * - "/Applications/Preview.app" → "Preview"
 */
function extractDisplayName(executablePath: string): string {
  // Get the last path segment
  const segments = executablePath.split(/[/\\]/);
  const filename = segments.pop() || executablePath;

  // Strip common executable extensions
  return filename.replace(/\.(exe|app|appimage|flatpak)$/i, "").trim();
}
