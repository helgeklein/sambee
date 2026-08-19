import { useEffect, useState } from "react";
import { loadCurrentUserSettings, patchCurrentUserSettings, USER_SETTINGS_CHANGED_EVENT } from "../../services/userSettingsSync";
import type { CurrentUserSettings } from "../../types";
import type { PaneMode, ViewMode } from "./types";

export const QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY = "quick-nav-include-dot-directories";
export const FILE_BROWSER_VIEW_MODE_STORAGE_KEY = "file-browser-view-mode";
export const FILE_BROWSER_PANE_MODE_STORAGE_KEY = "dual-pane-mode";
export const SELECTED_CONNECTION_ID_STORAGE_KEY = "selectedConnectionId";
export const TEXT_EDITOR_MAX_FILE_SIZE_BYTES_STORAGE_KEY = "text-editor-max-file-size-bytes";
export const QUICK_BAR_SHORTCUT_HINT_VISIBILITY_STORAGE_KEY = "quick-bar-shortcut-hint-visibility";

const QUICK_NAV_PREFERENCE_EVENT = "sambee:quick-nav-dot-directories-changed";
const QUICK_BAR_SHORTCUT_HINT_VISIBILITY_PREFERENCE_EVENT = "sambee:quick-bar-shortcut-hint-visibility-changed";
const VIEW_MODE_PREFERENCE_EVENT = "sambee:file-browser-view-mode-changed";
const PANE_MODE_PREFERENCE_EVENT = "sambee:file-browser-pane-mode-changed";
const SELECTED_CONNECTION_PREFERENCE_EVENT = "sambee:selected-connection-changed";
const TEXT_EDITOR_MAX_FILE_SIZE_PREFERENCE_EVENT = "sambee:text-editor-max-file-size-bytes-changed";
const ENABLED_STORAGE_VALUE = "true";
const DISABLED_STORAGE_VALUE = "false";
const DEFAULT_TEXT_EDITOR_MAX_FILE_SIZE_BYTES = 52_428_800;
const QUICK_BAR_KEYBOARD_EVIDENCE_SESSION_STORAGE_KEY = "quick-bar-keyboard-evidence";
const KEYBOARD_MODIFIER_KEYS = new Set(["Alt", "AltGraph", "CapsLock", "Control", "Meta", "NumLock", "ScrollLock", "Shift"]);

export type QuickBarShortcutHintVisibility = "auto" | "always" | "never";

function isQuickBarShortcutHintVisibility(value: string | null): value is QuickBarShortcutHintVisibility {
  return value === "auto" || value === "always" || value === "never";
}

export function isQuickBarKeyboardEvidenceEvent(event: Pick<KeyboardEvent, "isComposing" | "isTrusted" | "key">): boolean {
  return event.isTrusted && !event.isComposing && !KEYBOARD_MODIFIER_KEYS.has(event.key);
}

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

export function readQuickBarShortcutHintVisibilityPreference(): QuickBarShortcutHintVisibility {
  const storedValue = localStorage.getItem(QUICK_BAR_SHORTCUT_HINT_VISIBILITY_STORAGE_KEY);
  return isQuickBarShortcutHintVisibility(storedValue) ? storedValue : "auto";
}

function setQuickBarShortcutHintVisibilityPreference(value: QuickBarShortcutHintVisibility, dispatchEvent: boolean): void {
  localStorage.setItem(QUICK_BAR_SHORTCUT_HINT_VISIBILITY_STORAGE_KEY, value);
  if (dispatchEvent) {
    window.dispatchEvent(new CustomEvent(QUICK_BAR_SHORTCUT_HINT_VISIBILITY_PREFERENCE_EVENT, { detail: value }));
  }
}

export function writeQuickBarShortcutHintVisibilityPreference(value: QuickBarShortcutHintVisibility): void {
  setQuickBarShortcutHintVisibilityPreference(value, true);
  void patchCurrentUserSettings({
    browser: {
      quick_bar_shortcut_hint_visibility: value,
    },
  });
}

export function useQuickBarShortcutHintVisibilityPreference(): [
  QuickBarShortcutHintVisibility,
  (value: QuickBarShortcutHintVisibility) => void,
] {
  const [visibility, setVisibility] = useState<QuickBarShortcutHintVisibility>(() => readQuickBarShortcutHintVisibilityPreference());

  useEffect(() => {
    let cancelled = false;

    const applyBackendPreference = (settings: CurrentUserSettings | null) => {
      if (!settings) {
        return;
      }

      const backendValue = settings.browser.quick_bar_shortcut_hint_visibility;
      if (!isQuickBarShortcutHintVisibility(backendValue)) {
        return;
      }
      setQuickBarShortcutHintVisibilityPreference(backendValue, true);
      setVisibility(backendValue);
    };

    const updatePreference = () => {
      setVisibility(readQuickBarShortcutHintVisibilityPreference());
    };

    const handleStorage = (event: StorageEvent) => {
      if (isStorageEventForKey(event, QUICK_BAR_SHORTCUT_HINT_VISIBILITY_STORAGE_KEY)) {
        updatePreference();
      }
    };

    const handleUserSettingsChanged = (event: Event) => {
      applyBackendPreference((event as CustomEvent<CurrentUserSettings>).detail);
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(QUICK_BAR_SHORTCUT_HINT_VISIBILITY_PREFERENCE_EVENT, updatePreference);
    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);

    void loadCurrentUserSettings().then((settings) => {
      if (!cancelled) {
        applyBackendPreference(settings);
      }
    });

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(QUICK_BAR_SHORTCUT_HINT_VISIBILITY_PREFERENCE_EVENT, updatePreference);
      window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);
    };
  }, []);

  return [visibility, writeQuickBarShortcutHintVisibilityPreference];
}

export function useQuickBarKeyboardHints(visibility: QuickBarShortcutHintVisibility, useCompactLayout: boolean): boolean {
  const [hasKeyboardEvidence, setHasKeyboardEvidence] = useState(() => {
    return sessionStorage.getItem(QUICK_BAR_KEYBOARD_EVIDENCE_SESSION_STORAGE_KEY) === ENABLED_STORAGE_VALUE;
  });

  useEffect(() => {
    if (visibility !== "auto" || !useCompactLayout || hasKeyboardEvidence) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isQuickBarKeyboardEvidenceEvent(event)) {
        return;
      }

      sessionStorage.setItem(QUICK_BAR_KEYBOARD_EVIDENCE_SESSION_STORAGE_KEY, ENABLED_STORAGE_VALUE);
      setHasKeyboardEvidence(true);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [hasKeyboardEvidence, useCompactLayout, visibility]);

  return visibility === "always" || (visibility === "auto" && (!useCompactLayout || hasKeyboardEvidence));
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

export function readTextEditorMaxFileSizeBytesPreference(): number {
  const rawValue = localStorage.getItem(TEXT_EDITOR_MAX_FILE_SIZE_BYTES_STORAGE_KEY);
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_TEXT_EDITOR_MAX_FILE_SIZE_BYTES;
}

function setTextEditorMaxFileSizeBytesPreference(maxFileSizeBytes: number, dispatchEvent: boolean): void {
  localStorage.setItem(TEXT_EDITOR_MAX_FILE_SIZE_BYTES_STORAGE_KEY, String(maxFileSizeBytes));
  if (dispatchEvent) {
    window.dispatchEvent(new CustomEvent(TEXT_EDITOR_MAX_FILE_SIZE_PREFERENCE_EVENT, { detail: maxFileSizeBytes }));
  }
}

export function writeTextEditorMaxFileSizeBytesPreference(maxFileSizeBytes: number): void {
  setTextEditorMaxFileSizeBytesPreference(maxFileSizeBytes, true);
  void patchCurrentUserSettings({
    text_editor: {
      max_file_size_bytes: maxFileSizeBytes,
    },
  });
}

export function useQuickNavIncludeDotDirectoriesPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => readQuickNavIncludeDotDirectoriesPreference());

  useEffect(() => {
    let cancelled = false;

    const applyBackendPreference = (settings: CurrentUserSettings | null) => {
      if (!settings) {
        return;
      }

      const backendValue = settings.browser.quick_nav_include_dot_directories;
      setQuickNavIncludeDotDirectoriesPreference(backendValue, true);
      setEnabled(backendValue);
    };

    const updatePreference = () => {
      setEnabled(readQuickNavIncludeDotDirectoriesPreference());
    };

    const handleStorage = (event: StorageEvent) => {
      if (isStorageEventForQuickNavPreference(event)) {
        updatePreference();
      }
    };

    const handleUserSettingsChanged = (event: Event) => {
      applyBackendPreference((event as CustomEvent<CurrentUserSettings>).detail);
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(QUICK_NAV_PREFERENCE_EVENT, updatePreference);
    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);

    void loadCurrentUserSettings().then((settings) => {
      if (cancelled) {
        return;
      }

      applyBackendPreference(settings);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(QUICK_NAV_PREFERENCE_EVENT, updatePreference);
      window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);
    };
  }, []);

  return [enabled, writeQuickNavIncludeDotDirectoriesPreference];
}

export function useFileBrowserViewModePreference(): [ViewMode, (viewMode: ViewMode) => void] {
  const [viewMode, setViewMode] = useState<ViewMode>(() => readFileBrowserViewModePreference());

  useEffect(() => {
    let cancelled = false;

    const applyBackendPreference = (settings: CurrentUserSettings | null) => {
      if (!settings) {
        return;
      }

      const backendValue = settings.browser.file_browser_view_mode;
      setFileBrowserViewModePreference(backendValue, true);
      setViewMode(backendValue);
    };

    const updatePreference = () => {
      setViewMode(readFileBrowserViewModePreference());
    };

    const handleStorage = (event: StorageEvent) => {
      if (isStorageEventForKey(event, FILE_BROWSER_VIEW_MODE_STORAGE_KEY)) {
        updatePreference();
      }
    };

    const handleUserSettingsChanged = (event: Event) => {
      applyBackendPreference((event as CustomEvent<CurrentUserSettings>).detail);
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(VIEW_MODE_PREFERENCE_EVENT, updatePreference);
    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);

    void loadCurrentUserSettings().then((settings) => {
      if (cancelled) {
        return;
      }

      applyBackendPreference(settings);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(VIEW_MODE_PREFERENCE_EVENT, updatePreference);
      window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);
    };
  }, []);

  return [viewMode, writeFileBrowserViewModePreference];
}

export function useTextEditorMaxFileSizeBytesPreference(): [number, (maxFileSizeBytes: number) => void] {
  const [maxFileSizeBytes, setMaxFileSizeBytes] = useState<number>(() => readTextEditorMaxFileSizeBytesPreference());

  useEffect(() => {
    let cancelled = false;

    const applyBackendPreference = (settings: CurrentUserSettings | null) => {
      if (!settings) {
        return;
      }

      const backendValue = settings.text_editor.max_file_size_bytes;
      setTextEditorMaxFileSizeBytesPreference(backendValue, true);
      setMaxFileSizeBytes(backendValue);
    };

    const updatePreference = () => {
      setMaxFileSizeBytes(readTextEditorMaxFileSizeBytesPreference());
    };

    const handleStorage = (event: StorageEvent) => {
      if (isStorageEventForKey(event, TEXT_EDITOR_MAX_FILE_SIZE_BYTES_STORAGE_KEY)) {
        updatePreference();
      }
    };

    const handleUserSettingsChanged = (event: Event) => {
      applyBackendPreference((event as CustomEvent<CurrentUserSettings>).detail);
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(TEXT_EDITOR_MAX_FILE_SIZE_PREFERENCE_EVENT, updatePreference);
    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);

    void loadCurrentUserSettings().then((settings) => {
      if (cancelled) {
        return;
      }

      applyBackendPreference(settings);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(TEXT_EDITOR_MAX_FILE_SIZE_PREFERENCE_EVENT, updatePreference);
      window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);
    };
  }, []);

  return [maxFileSizeBytes, writeTextEditorMaxFileSizeBytesPreference];
}
