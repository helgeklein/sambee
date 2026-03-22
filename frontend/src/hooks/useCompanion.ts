/**
 * useCompanion — React hook for companion detection and drive management.
 *
 * Probes the companion on mount, manages pairing state, and provides
 * the list of local drives to merge into the connection selector.
 *
 * Usage in FileBrowser:
 * ```tsx
 * const companion = useCompanion();
 * const allConnections = mergeConnections(serverConnections, companion.drives);
 * ```
 */

import { useCallback, useEffect, useRef, useState } from "react";
import companionService, { type DriveInfo, hasStoredSecret } from "../services/companion";
import { syncCurrentLocalizationToCompanion } from "../services/companionLocalizationSync";
import { logger } from "../services/logger";

/** Companion availability and pairing status. */
export type CompanionStatus =
  /** Not running or unreachable. */
  | "unavailable"
  /** Reachable but not yet paired. */
  | "unpaired"
  /** Paired and ready for authenticated requests. */
  | "paired"
  /** Currently performing initial detection. */
  | "detecting";

export interface UseCompanionResult {
  /** Current companion availability/pairing status. */
  status: CompanionStatus;
  /** Drives from the companion (empty unless status is "paired"). */
  drives: DriveInfo[];
  /** Start the pairing flow; returns the 6-char code for user confirmation. */
  initiatePairing: () => Promise<{ pairingId: string; pairingCode: string }>;
  /** Confirm pairing after user verifies the code matches on both sides. */
  confirmPairing: (pairingId: string) => Promise<void>;
  /** Re-probe the companion (e.g., after pairing completes). */
  refresh: () => Promise<void>;
  /** Whether a detection/refresh is in progress. */
  loading: boolean;
}

/**
 * Hook that manages the companion lifecycle:
 * 1. On mount, probes `GET /api/health` with a short timeout.
 * 2. If paired, fetches drives immediately.
 * 3. Provides pairing initiators for the UI dialog.
 */
export function useCompanion(): UseCompanionResult {
  const [status, setStatus] = useState<CompanionStatus>("detecting");
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  /**
   * Probe the companion and, if paired, load drives.
   */
  const detect = useCallback(async () => {
    setLoading(true);
    try {
      const health = await companionService.checkHealth();

      if (!mountedRef.current) return;

      if (!health) {
        setStatus("unavailable");
        setDrives([]);
        return;
      }

      const storedSecret = hasStoredSecret();

      // Companion is reachable and the browser already has a shared secret.
      // Even if the companion's health flag is stale, a successful authenticated
      // drive fetch proves the pairing is still valid.
      if (storedSecret) {
        try {
          const driveList = await companionService.getDrives();
          if (mountedRef.current) {
            setStatus("paired");
            setDrives(driveList);
          }
          return;
        } catch (err) {
          if (health.paired) {
            logger.warn("Companion paired but failed to load drives", { error: err }, "companion");
            if (mountedRef.current) {
              setStatus("paired");
              setDrives([]);
            }
            return;
          }

          logger.warn("Stored companion secret was not accepted during startup", { error: err }, "companion");
        }
      }

      if (health.paired) {
        setStatus("paired");
        setDrives([]);
      } else {
        setStatus("unpaired");
        setDrives([]);
      }
    } catch {
      if (mountedRef.current) {
        setStatus("unavailable");
        setDrives([]);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Detect on mount
  useEffect(() => {
    mountedRef.current = true;
    detect();
    return () => {
      mountedRef.current = false;
    };
  }, [detect]);

  /**
   * Start pairing — returns the code for the UI to display.
   */
  const initiatePairing = useCallback(async () => {
    const result = await companionService.initiatePairing();
    return { pairingId: result.pairingId, pairingCode: result.pairingCode };
  }, []);

  /**
   * Complete pairing — stores the shared secret and refreshes drives.
   */
  const confirmPairing = useCallback(
    async (pairingId: string) => {
      await companionService.confirmPairing(pairingId);
      await syncCurrentLocalizationToCompanion();
      // After pairing, re-detect to load drives
      await detect();
    },
    [detect]
  );

  return {
    status,
    drives,
    initiatePairing,
    confirmPairing,
    refresh: detect,
    loading,
  };
}
