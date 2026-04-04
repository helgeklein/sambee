import { useCallback, useEffect, useRef } from "react";
import {
  type BackendAvailabilityStatus,
  getBackendAvailabilitySnapshot,
  markBackendAvailable,
  markBackendReconnecting,
  markBackendUnavailable,
} from "../services/backendAvailability";
import { getServerBaseUrl } from "../services/backendRouter";
import { logger } from "../services/logger";

const HEALTH_CHECK_PATH = "/health";
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const PROBE_FAILURES_BEFORE_UNAVAILABLE = 3;
const RECOVERY_RETRY_DELAYS_MS = [750, 1_250, 2_000, 3_000] as const;

interface BackendRecoveryMonitorOptions {
  enabled?: boolean;
  status: BackendAvailabilityStatus;
  onRecovered?: () => void;
  onReconnectNow?: (reason: string) => void;
}

function getRecoveryDelay(failures: number): number {
  const index = Math.min(failures, RECOVERY_RETRY_DELAYS_MS.length - 1);
  return RECOVERY_RETRY_DELAYS_MS[index];
}

function buildHealthCheckUrl(): string {
  return `${getServerBaseUrl()}${HEALTH_CHECK_PATH}`;
}

export function useBackendRecoveryMonitor({ enabled = true, status, onRecovered, onReconnectNow }: BackendRecoveryMonitorOptions): void {
  const timerRef = useRef<number | null>(null);
  const probeInFlightRef = useRef(false);
  const queuedProbeReasonRef = useRef<string | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const onRecoveredRef = useRef(onRecovered);
  const onReconnectNowRef = useRef(onReconnectNow);
  const runHealthProbeRef = useRef<(reason: string) => void>(() => undefined);

  onRecoveredRef.current = onRecovered;
  onReconnectNowRef.current = onReconnectNow;

  const clearProbeTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleProbe = useCallback(
    (delayMs: number, reason: string) => {
      clearProbeTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void runHealthProbeRef.current(reason);
      }, delayMs);
    },
    [clearProbeTimer]
  );

  const runHealthProbe = useCallback(
    async (reason: string) => {
      if (!enabled) {
        return;
      }

      if (probeInFlightRef.current) {
        queuedProbeReasonRef.current = reason;
        return;
      }

      probeInFlightRef.current = true;
      clearProbeTimer();

      const abortController = new AbortController();
      const timeoutId = window.setTimeout(() => {
        abortController.abort();
      }, HEALTH_CHECK_TIMEOUT_MS);

      try {
        const response = await fetch(buildHealthCheckUrl(), {
          method: "GET",
          cache: "no-store",
          signal: abortController.signal,
          headers: {
            "Cache-Control": "no-cache",
          },
        });

        if (!response.ok) {
          throw new Error(`Backend health check failed with status ${response.status}`);
        }

        const wasRecovering = getBackendAvailabilitySnapshot().status !== "available" || consecutiveFailuresRef.current > 0;
        consecutiveFailuresRef.current = 0;
        markBackendAvailable();

        if (wasRecovering) {
          logger.info("Backend recovery probe succeeded", { reason }, "backend-recovery");
          onReconnectNowRef.current?.("health-probe-success");
          onRecoveredRef.current?.();
        }
      } catch (error) {
        consecutiveFailuresRef.current += 1;

        if (consecutiveFailuresRef.current >= PROBE_FAILURES_BEFORE_UNAVAILABLE) {
          markBackendUnavailable("Backend health checks are still failing.");
        } else {
          markBackendReconnecting("Backend recovery check in progress.");
        }

        logger.warn(
          "Backend recovery probe failed",
          {
            reason,
            failures: consecutiveFailuresRef.current,
            error,
          },
          "backend-recovery"
        );

        scheduleProbe(getRecoveryDelay(consecutiveFailuresRef.current - 1), "retry-after-failure");
      } finally {
        window.clearTimeout(timeoutId);
        probeInFlightRef.current = false;

        if (queuedProbeReasonRef.current) {
          const queuedReason = queuedProbeReasonRef.current;
          queuedProbeReasonRef.current = null;
          void runHealthProbe(queuedReason);
        }
      }
    },
    [clearProbeTimer, enabled, scheduleProbe]
  );

  runHealthProbeRef.current = (reason: string) => {
    void runHealthProbe(reason);
  };

  useEffect(() => {
    if (!enabled) {
      clearProbeTimer();
      consecutiveFailuresRef.current = 0;
      queuedProbeReasonRef.current = null;
      return;
    }

    if (status === "available") {
      clearProbeTimer();
      consecutiveFailuresRef.current = 0;
      queuedProbeReasonRef.current = null;
      return;
    }

    onReconnectNowRef.current?.("backend-status-change");
    void runHealthProbe("backend-status-change");
  }, [clearProbeTimer, enabled, runHealthProbe, status]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const triggerImmediateRecovery = (reason: string) => {
      if (getBackendAvailabilitySnapshot().status === "available") {
        return;
      }

      onReconnectNowRef.current?.(reason);
      void runHealthProbe(reason);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerImmediateRecovery("visibility-visible");
      }
    };

    const handleFocus = () => {
      triggerImmediateRecovery("window-focus");
    };

    const handleOnline = () => {
      triggerImmediateRecovery("window-online");
    };

    const handlePageShow = () => {
      triggerImmediateRecovery("window-pageshow");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [enabled, runHealthProbe]);

  useEffect(() => {
    return () => {
      clearProbeTimer();
      queuedProbeReasonRef.current = null;
      consecutiveFailuresRef.current = 0;
    };
  }, [clearProbeTimer]);
}

export default useBackendRecoveryMonitor;
