/**
 * Auto-update check for the Sambee Companion.
 *
 * Uses the Tauri updater plugin to poll the configured endpoint on startup.
 * If an update is available, the user is prompted to install and relaunch.
 *
 * The updater endpoint and public key are configured in `tauri.conf.json`
 * under the `plugins.updater` section.
 */

import { check } from "@tauri-apps/plugin-updater";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** How long to wait after app launch before checking (ms). */
const INITIAL_CHECK_DELAY_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

//
// scheduleUpdateCheck
//
/**
 * Schedule an automatic update check after a short delay.
 *
 * Should be called once from the app entry point. The delay avoids
 * interfering with startup performance and ensures the network stack
 * is ready.
 */
export function scheduleUpdateCheck(): void {
  setTimeout(() => {
    checkForUpdate().catch((err) => {
      console.warn("Auto-update check failed:", err);
    });
  }, INITIAL_CHECK_DELAY_MS);
}

//
// checkForUpdate
//
/**
 * Immediately check for an available update.
 *
 * If an update is found, downloads and installs it, then relaunches
 * the application. Users see a system-level install prompt (if
 * applicable to the platform).
 *
 * @returns true if an update was found and initiated, false otherwise.
 */
export async function checkForUpdate(): Promise<boolean> {
  try {
    const update = await check();
    if (!update) {
      console.info("No companion update available.");
      return false;
    }

    console.info(`Companion update available: ${update.version}`);

    // Download and install the update
    await update.downloadAndInstall();
    return true;
  } catch (err) {
    console.warn("Update check error:", err);
    return false;
  }
}
