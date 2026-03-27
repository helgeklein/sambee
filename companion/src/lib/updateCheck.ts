/**
 * Auto-update check for the Sambee Companion.
 *
 * Uses a Rust-side Tauri updater command to poll the promoted feed for the
 * currently selected update channel on startup.
 * If an update is available and no file-editing operation is in progress,
 * the update is silently downloaded and installed. If an editing session is
 * active, the install is deferred until the user finishes.
 */

import { invoke } from "@tauri-apps/api/core";
import { type CompanionUpdateChannel, getUserPreferences } from "../stores/userPreferences";
import { log } from "./logger";

export interface CompanionUpdateStatus {
  available: boolean;
  currentVersion: string;
  version: string | null;
  notes: string | null;
  publishedAt: string | null;
}

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
    const prefs = await getUserPreferences();
    const updateStatus = await fetchCompanionUpdateStatus(prefs.companionUpdateChannel);

    if (!updateStatus.available) {
      log.info("No companion update available.");
      return false;
    }

    log.info(
      `Companion update available on ${prefs.companionUpdateChannel} channel: ${updateStatus.currentVersion} -> ${updateStatus.version ?? "unknown"}.`
    );

    // Wait for any active editing sessions to finish before installing.
    if (await isEditing()) {
      log.info("Editing in progress — deferring update install until idle.");
      await waitForIdle();
      log.info("Editing finished — proceeding with update install.");
    }

    await installCompanionUpdate(prefs.companionUpdateChannel);
    return true;
  } catch (err) {
    log.warn("Update check error:", err);
    return false;
  }
}

export async function fetchCompanionUpdateStatus(channel: CompanionUpdateChannel): Promise<CompanionUpdateStatus> {
  return invoke<CompanionUpdateStatus>("check_for_companion_update", {
    channel,
  });
}

export async function installCompanionUpdate(channel: CompanionUpdateChannel): Promise<void> {
  await invoke("install_companion_update", {
    channel,
  });
}
