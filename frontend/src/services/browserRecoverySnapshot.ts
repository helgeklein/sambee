import type { PaneId, PaneMode } from "../pages/FileBrowser/types";
import type { Connection, FileEntry } from "../types";

const BROWSER_RECOVERY_SNAPSHOT_KEY = "sambee:browser-recovery-snapshot";
const BROWSER_RECOVERY_SNAPSHOT_TTL_MS = 30 * 60_000;

export interface BrowserRecoveryPaneSnapshot {
  connectionId: string;
  path: string;
  items: FileEntry[];
}

export interface BrowserRecoverySnapshot {
  savedAt: number;
  routeUrl: string;
  activePaneId: PaneId;
  paneMode: PaneMode;
  connections: Connection[];
  left: BrowserRecoveryPaneSnapshot | null;
  right: BrowserRecoveryPaneSnapshot | null;
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
    Array.isArray(snapshot.connections)
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
