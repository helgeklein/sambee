import { useEffect, useState } from "react";

export const QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY = "quick-nav-include-dot-directories";

const QUICK_NAV_PREFERENCE_EVENT = "sambee:quick-nav-dot-directories-changed";
const ENABLED_STORAGE_VALUE = "true";
const DISABLED_STORAGE_VALUE = "false";

function isStorageEventForQuickNavPreference(event: StorageEvent): boolean {
  return event.key === null || event.key === QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY;
}

export function readQuickNavIncludeDotDirectoriesPreference(): boolean {
  return localStorage.getItem(QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY) === ENABLED_STORAGE_VALUE;
}

export function writeQuickNavIncludeDotDirectoriesPreference(enabled: boolean): void {
  localStorage.setItem(QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY, enabled ? ENABLED_STORAGE_VALUE : DISABLED_STORAGE_VALUE);
  window.dispatchEvent(new CustomEvent(QUICK_NAV_PREFERENCE_EVENT, { detail: enabled }));
}

export function useQuickNavIncludeDotDirectoriesPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => readQuickNavIncludeDotDirectoriesPreference());

  useEffect(() => {
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

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(QUICK_NAV_PREFERENCE_EVENT, updatePreference);
    };
  }, []);

  return [enabled, writeQuickNavIncludeDotDirectoriesPreference];
}
