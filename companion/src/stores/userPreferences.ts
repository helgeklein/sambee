/**
 * User preferences store for global companion settings.
 *
 * Persists user-configurable options via the Tauri store plugin.
 * Separate from appPreferences.ts which handles per-extension app
 * associations.
 *
 * Preference schema:
 * - allowedServers: list of trusted Sambee server URLs
 * - uploadConflictAction: "ask" | "overwrite" | "save-copy"
 * - showNotifications: whether to show desktop notifications
 * - tempFileRetentionDays: how long recycled temp files are kept
 */

import { load } from "@tauri-apps/plugin-store";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Name of the store file persisted on disk. */
const STORE_FILE = "user-preferences.json";

/** Key within the store for the full preferences object. */
const PREFERENCES_KEY = "userPreferences";

/** Default retention period for recycled temp files (days). */
const DEFAULT_TEMP_RETENTION_DAYS = 7;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** How to handle upload conflicts when the server copy has changed. */
export type UploadConflictAction = "ask" | "overwrite" | "save-copy";

/**
 * Full user preferences object.
 */
export interface UserPreferences {
  /** Trusted Sambee server URLs (e.g. ["https://sambee.example.com"]). */
  allowedServers: string[];

  /** Default action when an upload conflict is detected. */
  uploadConflictAction: UploadConflictAction;

  /** Whether to show desktop notifications for edit events. */
  showNotifications: boolean;

  /** How many days to retain recycled temp files before deletion. */
  tempFileRetentionDays: number;
}

/** Default preferences for a fresh install. */
const DEFAULT_PREFERENCES: UserPreferences = {
  allowedServers: [],
  uploadConflictAction: "ask",
  showNotifications: true,
  tempFileRetentionDays: DEFAULT_TEMP_RETENTION_DAYS,
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

//
// getUserPreferences
//
/**
 * Load the full user preferences, falling back to defaults for any
 * missing keys.
 */
export async function getUserPreferences(): Promise<UserPreferences> {
  const store = await load(STORE_FILE);
  const saved = await store.get<Partial<UserPreferences>>(PREFERENCES_KEY);
  return { ...DEFAULT_PREFERENCES, ...saved };
}

//
// saveUserPreferences
//
/**
 * Persist the entire user preferences object.
 *
 * @param prefs - Complete preferences to save.
 */
export async function saveUserPreferences(prefs: UserPreferences): Promise<void> {
  const store = await load(STORE_FILE);
  await store.set(PREFERENCES_KEY, prefs);
  await store.save();
}

//
// addAllowedServer
//
/**
 * Add a server URL to the trusted allowlist (no-op if already present).
 *
 * @param serverUrl - Full URL (e.g. "https://sambee.example.com").
 */
export async function addAllowedServer(serverUrl: string): Promise<void> {
  const prefs = await getUserPreferences();
  const normalized = serverUrl.replace(/\/+$/, "");
  if (!prefs.allowedServers.includes(normalized)) {
    prefs.allowedServers.push(normalized);
    await saveUserPreferences(prefs);
  }
}

//
// removeAllowedServer
//
/**
 * Remove a server URL from the trusted allowlist.
 *
 * @param serverUrl - Full URL to remove.
 */
export async function removeAllowedServer(serverUrl: string): Promise<void> {
  const prefs = await getUserPreferences();
  const normalized = serverUrl.replace(/\/+$/, "");
  prefs.allowedServers = prefs.allowedServers.filter((s) => s !== normalized);
  await saveUserPreferences(prefs);
}

//
// isServerAllowed
//
/**
 * Check whether a server URL is in the trusted allowlist.
 *
 * @param serverUrl - URL to check.
 * @returns true if the server is trusted.
 */
export async function isServerAllowed(serverUrl: string): Promise<boolean> {
  const prefs = await getUserPreferences();
  const normalized = serverUrl.replace(/\/+$/, "");
  return prefs.allowedServers.includes(normalized);
}
