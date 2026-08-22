import { CODEMIRROR_FIND_REPLACE_HISTORY_LIMIT } from "./codeMirrorFindReplaceConstants";

function isHistory(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function readCodeMirrorFindReplaceHistory(storageKey: string): string[] {
  try {
    const storedHistory = window.localStorage.getItem(storageKey);
    if (!storedHistory) {
      return [];
    }

    const parsedHistory: unknown = JSON.parse(storedHistory);
    return isHistory(parsedHistory) ? parsedHistory.slice(0, CODEMIRROR_FIND_REPLACE_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}
export function addCodeMirrorFindReplaceHistoryEntry(history: string[], value: string): string[] {
  if (value.trim().length === 0) {
    return history;
  }

  return [value, ...history.filter((entry) => entry !== value)].slice(0, CODEMIRROR_FIND_REPLACE_HISTORY_LIMIT);
}

export function writeCodeMirrorFindReplaceHistory(storageKey: string, history: string[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(history));
  } catch {
    // Find and replace remains functional when browser storage is unavailable.
  }
}
