import type { FileBrowserPaneRecoverySnapshot, PaneId, PaneMode } from "../pages/FileBrowser/types";
import type { Connection } from "../types";

const BROWSER_RECOVERY_SNAPSHOT_KEY = "sambee:browser-recovery-snapshot";
const BROWSER_RECOVERY_SNAPSHOT_TTL_MS = 30 * 60_000;

export interface BrowserRecoverySnapshot {
  savedAt: number;
  routeUrl: string;
  activePaneId: PaneId;
  paneMode: PaneMode;
  connections: Connection[];
  left: FileBrowserPaneRecoverySnapshot | null;
  right: FileBrowserPaneRecoverySnapshot | null;
}

function isRecoveryPaneSnapshot(value: unknown): value is FileBrowserPaneRecoverySnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const snapshot = value as Partial<FileBrowserPaneRecoverySnapshot>;
  return (
    typeof snapshot.connectionId === "string" &&
    typeof snapshot.path === "string" &&
    Array.isArray(snapshot.items) &&
    (snapshot.sortBy === "name" || snapshot.sortBy === "size" || snapshot.sortBy === "modified" || snapshot.sortBy === "type") &&
    (snapshot.sortDirection === "asc" || snapshot.sortDirection === "desc") &&
    (snapshot.viewMode === "list" || snapshot.viewMode === "details") &&
    typeof snapshot.currentDirectoryFilter === "string" &&
    typeof snapshot.focusedIndex === "number" &&
    (typeof snapshot.focusedFileName === "string" || snapshot.focusedFileName === null) &&
    Array.isArray(snapshot.selectedFileNames) &&
    typeof snapshot.scrollOffset === "number"
  );
}

function isBrowserRecoverySnapshot(value: unknown): value is BrowserRecoverySnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const snapshot = value as Partial<BrowserRecoverySnapshot>;
  return (
    typeof snapshot.savedAt === "number" &&
    typeof snapshot.routeUrl === "string" &&
    (snapshot.activePaneId === "left" || snapshot.activePaneId === "right") &&
    (snapshot.paneMode === "single" || snapshot.paneMode === "dual") &&
    Array.isArray(snapshot.connections) &&
    (snapshot.left === null || isRecoveryPaneSnapshot(snapshot.left)) &&
    (snapshot.right === null || isRecoveryPaneSnapshot(snapshot.right))
  );
}

export function saveBrowserRecoverySnapshot(snapshot: BrowserRecoverySnapshot): void {
  try {
    sessionStorage.setItem(BROWSER_RECOVERY_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures; recovery snapshots are best-effort only.
  }
}

export function loadBrowserRecoverySnapshot(): BrowserRecoverySnapshot | null {
  try {
    const raw = sessionStorage.getItem(BROWSER_RECOVERY_SNAPSHOT_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isBrowserRecoverySnapshot(parsed)) {
      clearBrowserRecoverySnapshot();
      return null;
    }

    if (Date.now() - parsed.savedAt > BROWSER_RECOVERY_SNAPSHOT_TTL_MS) {
      clearBrowserRecoverySnapshot();
      return null;
    }

    return parsed;
  } catch {
    clearBrowserRecoverySnapshot();
    return null;
  }
}

export function clearBrowserRecoverySnapshot(): void {
  try {
    sessionStorage.removeItem(BROWSER_RECOVERY_SNAPSHOT_KEY);
  } catch {
    // Ignore storage failures; recovery snapshots are best-effort only.
  }
}
