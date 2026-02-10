/**
 * App preference store for "Always use this app" persistence.
 *
 * Uses the Tauri store plugin to persist the user's preferred application
 * for each file extension. Preferences are stored as a map from extension
 * (without leading dot) to the executable path.
 */

import { load } from "@tauri-apps/plugin-store";

/** Name of the store file persisted on disk. */
const STORE_FILE = "app-preferences.json";

/** Key within the store for the app preferences map. */
const PREFERENCES_KEY = "appPreferences";

/**
 * Preference map type: extension (e.g. "docx") -> executable path.
 */
type PreferenceMap = Record<string, string>;

//
// getPreferredApp
//
/**
 * Returns the preferred executable path for the given extension, or null
 * if no preference has been saved.
 *
 * @param extension - File extension without leading dot (e.g. "docx").
 */
export async function getPreferredApp(extension: string): Promise<string | null> {
  const store = await load(STORE_FILE);
  const prefs = await store.get<PreferenceMap>(PREFERENCES_KEY);
  return prefs?.[extension] ?? null;
}

//
// setPreferredApp
//
/**
 * Saves the preferred app for a file extension.
 *
 * @param extension - File extension without leading dot (e.g. "docx").
 * @param executable - Full path to the application executable.
 */
export async function setPreferredApp(extension: string, executable: string): Promise<void> {
  const store = await load(STORE_FILE);
  const prefs = (await store.get<PreferenceMap>(PREFERENCES_KEY)) ?? {};
  prefs[extension] = executable;
  await store.set(PREFERENCES_KEY, prefs);
  await store.save();
}

//
// clearPreferredApp
//
/**
 * Removes the preferred app preference for a file extension.
 *
 * @param extension - File extension without leading dot (e.g. "docx").
 */
export async function clearPreferredApp(extension: string): Promise<void> {
  const store = await load(STORE_FILE);
  const prefs = (await store.get<PreferenceMap>(PREFERENCES_KEY)) ?? {};
  delete prefs[extension];
  await store.set(PREFERENCES_KEY, prefs);
  await store.save();
}
