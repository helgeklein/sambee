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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
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
export type AppPickerViewState = { kind: "loading" } | { kind: "loaded"; apps: NativeApp[] } | { kind: "error"; message: string };

interface AppPickerViewProps {
  extension: string;
  state: AppPickerViewState;
  selectedIndex: number;
  alwaysUse: boolean;
  onSelectIndex: (index: number) => void;
  onAlwaysUseChange: (value: boolean) => void;
  onOpen: () => void;
  onCancel: () => void;
  onBrowse: () => void;
  panelRef?: { current: HTMLDivElement | null };
}

const BROWSE_ITEM_ID_SUFFIX = "browse";

interface AppPickerSection {
  heading: string;
  apps: Array<{ app: NativeApp; index: number }>;
}

const APP_PICKER_SECTION_SCROLL_MARGIN = 4;

function syncScrollbarBalanceSize(listElement: HTMLDivElement): void {
  const computedStyle = window.getComputedStyle(listElement);
  const borderLeftWidth = Number.parseFloat(computedStyle.borderLeftWidth || "0");
  const borderRightWidth = Number.parseFloat(computedStyle.borderRightWidth || "0");
  const measuredScrollbarWidth = Math.max(0, listElement.offsetWidth - listElement.clientWidth - borderLeftWidth - borderRightWidth);

  listElement.style.setProperty("--app-picker-scrollbar-balance-size", `${measuredScrollbarWidth}px`);
}

function ensureOptionAndSectionVisible(listElement: HTMLDivElement, itemElement: HTMLElement): void {
  const listRect = listElement.getBoundingClientRect();
  const itemRect = itemElement.getBoundingClientRect();

  if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
    itemElement.scrollIntoView({ block: "nearest" });
  }

  const sectionElement = itemElement.closest<HTMLElement>(".app-picker__section");
  const headingElement = sectionElement?.querySelector<HTMLElement>(".app-picker__section-heading");
  if (!headingElement) {
    return;
  }

  const refreshedListRect = listElement.getBoundingClientRect();
  const refreshedItemRect = itemElement.getBoundingClientRect();
  const headingRect = headingElement.getBoundingClientRect();
  const firstItemInSection = sectionElement?.querySelector<HTMLElement>(".app-picker__item");
  const itemTopWithinViewport = refreshedItemRect.top - refreshedListRect.top;
  const headingTopWithinViewport = headingRect.top - refreshedListRect.top;
  const headingClearance = headingElement.offsetHeight + APP_PICKER_SECTION_SCROLL_MARGIN;
  const isItemEnteringHiddenHeadingZone = itemTopWithinViewport < headingClearance;
  const isFirstItemInSection = firstItemInSection === itemElement;
  const canRevealHeadingWithoutHidingItem = headingClearance + itemElement.offsetHeight <= listElement.clientHeight;

  if (headingTopWithinViewport < 0 && isFirstItemInSection && isItemEnteringHiddenHeadingZone && canRevealHeadingWithoutHidingItem) {
    const topOffset = headingElement.offsetTop - listElement.offsetTop;
    listElement.scrollTop = Math.max(0, topOffset - APP_PICKER_SECTION_SCROLL_MARGIN);
  }
}

function buildAppPickerSections(apps: NativeApp[]): AppPickerSection[] {
  const defaultApps = apps.flatMap((app, index) => (app.is_default ? [{ app, index }] : []));
  const suggestedApps = apps.flatMap((app, index) => (app.is_default || !app.is_recommended ? [] : [{ app, index }]));
  const moreOptionsApps = apps.flatMap((app, index) => (!app.is_default && !app.is_recommended ? [{ app, index }] : []));

  return [
    { heading: translate("appPicker.sectionDefault"), apps: defaultApps },
    { heading: translate("appPicker.sectionSuggested"), apps: suggestedApps },
    { heading: translate("appPicker.sectionMoreOptions"), apps: moreOptionsApps },
  ].filter((section) => section.apps.length > 0);
}

export const APP_PICKER_FALLBACK_WIDTH = 420;
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
  const [state, setState] = useState<AppPickerViewState>({ kind: "loading" });
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [alwaysUse, setAlwaysUse] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const lastWindowHeightRef = useRef<number | null>(null);
  const lastWindowScaleFactorRef = useRef<number | null>(null);

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
    const appWindow = getCurrentWindow();
    const currentScaleFactor = await appWindow.scaleFactor();

    if (
      lastWindowHeightRef.current !== null &&
      Math.abs(lastWindowHeightRef.current - targetHeight) < APP_PICKER_HEIGHT_EPSILON &&
      lastWindowScaleFactorRef.current !== null &&
      Math.abs(lastWindowScaleFactorRef.current - currentScaleFactor) < Number.EPSILON
    ) {
      return;
    }

    lastWindowHeightRef.current = targetHeight;
    lastWindowScaleFactorRef.current = currentScaleFactor;

    try {
      await appWindow.setSize(new LogicalSize(APP_PICKER_FALLBACK_WIDTH, targetHeight));
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

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void getCurrentWindow()
      .onScaleChanged(() => {
        scheduleWindowResize();
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((err: unknown) => {
        log.warn("Failed to subscribe to app picker scale changes:", err);
      });

    return () => {
      unlisten?.();
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
        is_recommended: false,
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

  return (
    <AppPickerView
      extension={extension}
      state={state}
      selectedIndex={selectedIndex}
      alwaysUse={alwaysUse}
      onSelectIndex={setSelectedIndex}
      onAlwaysUseChange={setAlwaysUse}
      onOpen={() => {
        void handleOpen();
      }}
      onCancel={onCancel}
      onBrowse={() => {
        void handleBrowse();
      }}
      panelRef={panelRef}
    />
  );
}

/**
 * Browser-safe app picker view that renders the real dialog UI from plain props.
 *
 * This lets the production component keep its Tauri integration while preview
 * routes can reuse the same markup and styles with mock data.
 */
export function AppPickerView({
  extension,
  state,
  selectedIndex,
  alwaysUse,
  onSelectIndex,
  onAlwaysUseChange,
  onOpen,
  onCancel,
  onBrowse,
  panelRef,
}: AppPickerViewProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const previousSelectedIndexRef = useRef(-1);
  const hasFocusedLoadedListRef = useRef(false);
  const titleId = `app-picker-title-${extension}`;
  const browseItemIndex = state.kind === "loaded" ? state.apps.length : -1;
  const isBrowseItemSelected = state.kind === "loaded" && selectedIndex === browseItemIndex;
  const appSections = state.kind === "loaded" ? buildAppPickerSections(state.apps) : [];

  useEffect(() => {
    if (state.kind !== "loaded" || state.apps.length === 0 || !listRef.current || hasFocusedLoadedListRef.current) {
      return;
    }

    hasFocusedLoadedListRef.current = true;
    const listElement = listRef.current;
    const timer = window.setTimeout(() => {
      listElement.focus({ preventScroll: true });
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [state]);

  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement) {
      return;
    }

    const updateScrollbarMetrics = () => {
      syncScrollbarBalanceSize(listElement);
    };

    updateScrollbarMetrics();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateScrollbarMetrics();
    });

    observer.observe(listElement);
    return () => {
      observer.disconnect();
    };
  }, [appSections.length, state.kind]);

  useLayoutEffect(() => {
    if (state.kind !== "loaded" || selectedIndex < 0 || !listRef.current) {
      previousSelectedIndexRef.current = selectedIndex;
      return;
    }

    const shouldAutoScroll = shouldAutoScrollRef.current || previousSelectedIndexRef.current < 0;
    previousSelectedIndexRef.current = selectedIndex;
    shouldAutoScrollRef.current = false;

    if (!shouldAutoScroll) {
      return;
    }

    const targetId = selectedIndex === browseItemIndex ? `app-picker-item-${BROWSE_ITEM_ID_SUFFIX}` : `app-picker-item-${selectedIndex}`;
    const item = listRef.current.querySelector<HTMLElement>(`#${targetId}`) ?? undefined;
    if (item) {
      ensureOptionAndSectionVisible(listRef.current, item);
    }
  }, [browseItemIndex, selectedIndex, state]);

  const handleListKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (state.kind !== "loaded") {
        return;
      }

      const count = state.apps.length + 1;
      if (count === 0) {
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          shouldAutoScrollRef.current = true;
          onSelectIndex(Math.min(selectedIndex + 1, count - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          shouldAutoScrollRef.current = true;
          onSelectIndex(Math.max(selectedIndex - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          shouldAutoScrollRef.current = true;
          onSelectIndex(0);
          break;
        case "End":
          e.preventDefault();
          shouldAutoScrollRef.current = true;
          onSelectIndex(count - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (selectedIndex === state.apps.length) {
            onBrowse();
            return;
          }

          onOpen();
          break;
      }
    },
    [onBrowse, onOpen, onSelectIndex, selectedIndex, state]
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

      {state.kind === "loading" && <div class="app-picker__status app-picker__loading">{translate("appPicker.loading")}</div>}

      {state.kind === "error" && <div class="app-picker__status app-picker__error">{state.message}</div>}

      {state.kind === "loaded" && state.apps.length === 0 && (
        <div class="app-picker__status app-picker__empty">{translate("appPicker.empty", { extension })}</div>
      )}

      {state.kind === "loaded" && state.apps.length > 0 && (
        <div class="app-picker__content">
          <div
            class="app-picker__list"
            role="listbox"
            ref={listRef}
            tabIndex={0}
            aria-activedescendant={
              selectedIndex >= 0
                ? selectedIndex === browseItemIndex
                  ? `app-picker-item-${BROWSE_ITEM_ID_SUFFIX}`
                  : `app-picker-item-${selectedIndex}`
                : undefined
            }
            onKeyDown={handleListKeyDown}
          >
            {appSections.map((section) => (
              <div key={section.heading} class="app-picker__section" role="presentation">
                <div class="app-picker__section-heading" role="presentation">
                  {section.heading}
                </div>
                {section.apps.map(({ app, index }) => (
                  <div
                    key={app.executable}
                    id={`app-picker-item-${index}`}
                    class={`app-picker__item${index === selectedIndex ? " app-picker__item--selected" : ""}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === selectedIndex}
                    onClick={() => {
                      onSelectIndex(index);
                      listRef.current?.focus();
                    }}
                    onKeyDown={() => {}}
                    onDblClick={() => {
                      onSelectIndex(index);
                      onOpen();
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
                      <span class="app-picker__name">{app.name}</span>
                      <span class="app-picker__path">{app.executable}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}

            <div
              id={`app-picker-item-${BROWSE_ITEM_ID_SUFFIX}`}
              class={`app-picker__item app-picker__item--browse${isBrowseItemSelected ? " app-picker__item--selected" : ""}`}
              role="option"
              tabIndex={-1}
              aria-selected={isBrowseItemSelected}
              onClick={() => {
                onSelectIndex(browseItemIndex);
                listRef.current?.focus();
                onBrowse();
              }}
              onKeyDown={() => {}}
            >
              <div class="app-picker__info app-picker__info--browse">
                <span class="app-picker__name">{translate("appPicker.chooseAnotherApp")}</span>
              </div>
            </div>
          </div>

          <label class="app-picker__always-use">
            <input type="checkbox" checked={alwaysUse} onChange={(e) => onAlwaysUseChange((e.target as HTMLInputElement).checked)} />
            {translate("appPicker.alwaysUse", { extension })}
          </label>
        </div>
      )}

      <div class="app-picker__actions">
        <div class="app-picker__btn-group">
          <button type="button" class="app-picker__btn" onClick={onCancel}>
            {translate("common.actions.cancel")}
          </button>
          <button
            type="button"
            class="app-picker__btn app-picker__btn--primary"
            onClick={onOpen}
            disabled={state.kind !== "loaded" || selectedIndex < 0 || isBrowseItemSelected}
          >
            {translate("common.actions.open")}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}

export function measureAppPickerHeight(panel: HTMLDivElement): number {
  const shell = panel.parentElement instanceof HTMLDivElement ? panel.parentElement : null;
  if (!shell) {
    return Math.ceil(panel.scrollHeight + getVerticalBorderWidth(panel)) + APP_PICKER_ROUNDING_BUFFER;
  }

  const previousShellHeight = shell.style.height;
  const previousShellMinHeight = shell.style.minHeight;
  const previousPanelHeight = panel.style.height;
  const previousPanelFlex = panel.style.flex;

  shell.style.height = "auto";
  shell.style.minHeight = "0";
  panel.style.height = "auto";
  panel.style.flex = "none";

  const intrinsicPanelHeight = Math.ceil(panel.scrollHeight + getVerticalBorderWidth(panel));
  const intrinsicShellHeight = intrinsicPanelHeight + getVerticalBorderWidth(shell);

  shell.style.height = previousShellHeight;
  shell.style.minHeight = previousShellMinHeight;
  panel.style.height = previousPanelHeight;
  panel.style.flex = previousPanelFlex;

  return intrinsicShellHeight + APP_PICKER_ROUNDING_BUFFER;
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
