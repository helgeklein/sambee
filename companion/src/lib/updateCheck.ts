/**
 * Auto-update check for the Sambee Companion.
 *
 * Uses the Tauri updater plugin to poll the configured endpoint on startup.
 * If an update is available and no file-editing operation is in progress,
 * the update is silently downloaded and installed. If an editing session is
 * active, the install is deferred until the user finishes.
 *
 * The updater endpoint and public key are configured in `tauri.conf.json`
 * under the `plugins.updater` section.
 */

import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { log } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** How long to wait after app launch before checking (ms). */
const INITIAL_CHECK_DELAY_MS = 10_000;

/** How often to re-check whether editing has finished (ms). */
const IDLE_POLL_INTERVAL_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

//
// isEditing
//
/** Returns true if any file-editing operation is currently active. */
async function isEditing(): Promise<boolean> {
  try {
    return await invoke<boolean>("has_active_operations");
  } catch {
    // If the command is unavailable, assume idle to avoid blocking updates.
    return false;
  }
}

//
// waitForIdle
//
/**
 * Polls until no editing operations are active.
 *
 * Returns a promise that resolves once the companion is idle.
 */
function waitForIdle(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      if (!(await isEditing())) {
        clearInterval(timer);
        resolve();
      }
    }, IDLE_POLL_INTERVAL_MS);
  });
}

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
      log.warn("Auto-update check failed:", err);
    });
  }, INITIAL_CHECK_DELAY_MS);
}

//
// checkForUpdate
//
/**
 * Check for an available update and install it silently.
 *
 * If an update is found but the user is currently editing a file, the
 * install is deferred until all editing operations have finished.
 *
 * @returns true if an update was found and initiated, false otherwise.
 */
export async function checkForUpdate(): Promise<boolean> {
  try {
    const update = await check();
    if (!update) {
      log.info("No companion update available.");
      return false;
    }

    log.info(`Companion update available: ${update.version}`);

    // Wait for any active editing sessions to finish before installing.
    if (await isEditing()) {
      log.info("Editing in progress — deferring update install until idle.");
      await waitForIdle();
      log.info("Editing finished — proceeding with update install.");
    }

    await update.downloadAndInstall();
    return true;
  } catch (err) {
    log.warn("Update check error:", err);
    return false;
  }
}
