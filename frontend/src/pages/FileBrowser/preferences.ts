import { useEffect, useState } from "react";
import { loadCurrentUserSettings, patchCurrentUserSettings } from "../../services/userSettingsSync";
import type { PaneMode, ViewMode } from "./types";

export const QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY = "quick-nav-include-dot-directories";
export const FILE_BROWSER_VIEW_MODE_STORAGE_KEY = "file-browser-view-mode";
export const FILE_BROWSER_PANE_MODE_STORAGE_KEY = "dual-pane-mode";
export const SELECTED_CONNECTION_ID_STORAGE_KEY = "selectedConnectionId";

const QUICK_NAV_PREFERENCE_EVENT = "sambee:quick-nav-dot-directories-changed";
const VIEW_MODE_PREFERENCE_EVENT = "sambee:file-browser-view-mode-changed";
const PANE_MODE_PREFERENCE_EVENT = "sambee:file-browser-pane-mode-changed";
const SELECTED_CONNECTION_PREFERENCE_EVENT = "sambee:selected-connection-changed";
const ENABLED_STORAGE_VALUE = "true";
const DISABLED_STORAGE_VALUE = "false";

function normalizeSelectedConnectionId(connectionId: string | null | undefined): string | null {
  const normalized = connectionId?.trim();
  return normalized ? normalized : null;
}

function isStorageEventForKey(event: StorageEvent, key: string): boolean {
  return event.key === null || event.key === key;
}

function isStorageEventForQuickNavPreference(event: StorageEvent): boolean {
  return isStorageEventForKey(event, QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY);
}

export function readQuickNavIncludeDotDirectoriesPreference(): boolean {
  return localStorage.getItem(QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY) === ENABLED_STORAGE_VALUE;
}

function setQuickNavIncludeDotDirectoriesPreference(enabled: boolean, dispatchEvent: boolean): void {
  localStorage.setItem(QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY, enabled ? ENABLED_STORAGE_VALUE : DISABLED_STORAGE_VALUE);
  if (dispatchEvent) {
    window.dispatchEvent(new CustomEvent(QUICK_NAV_PREFERENCE_EVENT, { detail: enabled }));
  }
}

export function writeQuickNavIncludeDotDirectoriesPreference(enabled: boolean): void {
  setQuickNavIncludeDotDirectoriesPreference(enabled, true);
  void patchCurrentUserSettings({
    browser: {
      quick_nav_include_dot_directories: enabled,
    },
  });
}

export function readFileBrowserViewModePreference(): ViewMode {
  return localStorage.getItem(FILE_BROWSER_VIEW_MODE_STORAGE_KEY) === "details" ? "details" : "list";
}

function setFileBrowserViewModePreference(viewMode: ViewMode, dispatchEvent: boolean): void {
  localStorage.setItem(FILE_BROWSER_VIEW_MODE_STORAGE_KEY, viewMode);
  if (dispatchEvent) {
    window.dispatchEvent(new CustomEvent(VIEW_MODE_PREFERENCE_EVENT, { detail: viewMode }));
  }
}

export function writeFileBrowserViewModePreference(viewMode: ViewMode): void {
  setFileBrowserViewModePreference(viewMode, true);
  void patchCurrentUserSettings({
    browser: {
      file_browser_view_mode: viewMode,
    },
  });
}

export function readFileBrowserPaneModePreference(): PaneMode {
  return localStorage.getItem(FILE_BROWSER_PANE_MODE_STORAGE_KEY) === "dual" ? "dual" : "single";
}

export function setFileBrowserPaneModePreference(paneMode: PaneMode, dispatchEvent: boolean): void {
  localStorage.setItem(FILE_BROWSER_PANE_MODE_STORAGE_KEY, paneMode);
  if (dispatchEvent) {
    window.dispatchEvent(new CustomEvent(PANE_MODE_PREFERENCE_EVENT, { detail: paneMode }));
  }
}

export function writeFileBrowserPaneModePreference(paneMode: PaneMode): void {
  setFileBrowserPaneModePreference(paneMode, true);
  void patchCurrentUserSettings({
    browser: {
      pane_mode: paneMode,
    },
  });
}

export function readSelectedConnectionIdPreference(): string | null {
  return normalizeSelectedConnectionId(localStorage.getItem(SELECTED_CONNECTION_ID_STORAGE_KEY));
}

export function setSelectedConnectionIdPreference(connectionId: string | null, dispatchEvent: boolean): void {
  const normalizedConnectionId = normalizeSelectedConnectionId(connectionId);

  if (normalizedConnectionId) {
    localStorage.setItem(SELECTED_CONNECTION_ID_STORAGE_KEY, normalizedConnectionId);
  } else {
    localStorage.removeItem(SELECTED_CONNECTION_ID_STORAGE_KEY);
  }

  if (dispatchEvent) {
    window.dispatchEvent(new CustomEvent(SELECTED_CONNECTION_PREFERENCE_EVENT, { detail: normalizedConnectionId }));
  }
}

export function writeSelectedConnectionIdPreference(connectionId: string | null): void {
  const normalizedConnectionId = normalizeSelectedConnectionId(connectionId);
  const currentConnectionId = readSelectedConnectionIdPreference();

  setSelectedConnectionIdPreference(normalizedConnectionId, true);

  if (currentConnectionId === normalizedConnectionId) {
    return;
  }

  void patchCurrentUserSettings({
    browser: {
      selected_connection_id: normalizedConnectionId,
    },
  });
}

export function useQuickNavIncludeDotDirectoriesPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => readQuickNavIncludeDotDirectoriesPreference());

  useEffect(() => {
    let cancelled = false;

    const updatePreference = () => {
      setEnabled(readQuickNavIncludeDotDirectoriesPreference());
    };

    const handleStorage = (event: StorageEvent) => {
      if (isStorageEventForQuickNavPreference(event)) {
        updatePreference();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(QUICK_NAV_PREFERENCE_EVENT, updatePreference);

    void loadCurrentUserSettings().then((settings) => {
      if (cancelled || !settings) {
        return;
      }

      const backendValue = settings.browser.quick_nav_include_dot_directories;
      setQuickNavIncludeDotDirectoriesPreference(backendValue, true);
      setEnabled(backendValue);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(QUICK_NAV_PREFERENCE_EVENT, updatePreference);
    };
  }, []);

  return [enabled, writeQuickNavIncludeDotDirectoriesPreference];
}

export function useFileBrowserViewModePreference(): [ViewMode, (viewMode: ViewMode) => void] {
  const [viewMode, setViewMode] = useState<ViewMode>(() => readFileBrowserViewModePreference());

  useEffect(() => {
    let cancelled = false;

    const updatePreference = () => {
      setViewMode(readFileBrowserViewModePreference());
    };

    const handleStorage = (event: StorageEvent) => {
      if (isStorageEventForKey(event, FILE_BROWSER_VIEW_MODE_STORAGE_KEY)) {
        updatePreference();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(VIEW_MODE_PREFERENCE_EVENT, updatePreference);

    void loadCurrentUserSettings().then((settings) => {
      if (cancelled || !settings) {
        return;
      }

      const backendValue = settings.browser.file_browser_view_mode;
      setFileBrowserViewModePreference(backendValue, true);
      setViewMode(backendValue);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(VIEW_MODE_PREFERENCE_EVENT, updatePreference);
    };
  }, []);

  return [viewMode, writeFileBrowserViewModePreference];
}
