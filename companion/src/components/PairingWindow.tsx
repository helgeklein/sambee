import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useI18n } from "../i18n/useI18n";
import { log } from "../lib/logger";
import { getTauriErrorMessage } from "../utils/tauriErrorMarkers";
import { PairingRequest } from "./PairingRequest";

interface PairingEventPayload {
  pairing_id: string;
  origin: string;
  pairing_code: string;
}

type PairingViewState =
  | { kind: "idle" }
  | { kind: "pairing"; pairingId: string; origin: string; pairingCode: string }
  | { kind: "approved"; pairingId: string; origin: string; pairingCode: string }
  | { kind: "success" };

/** Dedicated root component for the pairing approval window. */
export function PairingWindow() {
  const { t } = useI18n();
  const [view, setView] = useState<PairingViewState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const windowRef = useRef(getCurrentWindow()).current;
  const viewRef = useRef<PairingViewState>({ kind: "idle" });
  const bypassNextCloseRequestRef = useRef(false);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const closeWindow = useCallback(async () => {
    try {
      bypassNextCloseRequestRef.current = true;
      await windowRef.close();
    } catch (err) {
      bypassNextCloseRequestRef.current = false;
      log.warn("Failed to close pairing window:", err);
    }
  }, [windowRef]);

  const rejectPendingPairing = useCallback(async (pairingId: string) => {
    try {
      await invoke("reject_pending_pairing", { pairingId });
    } catch (err) {
      log.error("Failed to reject pairing:", err);
      setError(getTauriErrorMessage(err));
      return false;
    }

    setError(null);
    return true;
  }, []);

  useEffect(() => {
    const unlistenPairing = listen<PairingEventPayload>("show-pairing", (event) => {
      setError(null);
      setView({
        kind: "pairing",
        pairingId: event.payload.pairing_id,
        origin: event.payload.origin,
        pairingCode: event.payload.pairing_code,
      });
    });

    const unlistenCompleted = listen("pairing-completed", () => {
      setError(null);
      setView({ kind: "success" });
    });

    const unlistenCloseRequested = windowRef.onCloseRequested(async (event) => {
      if (bypassNextCloseRequestRef.current) {
        bypassNextCloseRequestRef.current = false;
        return;
      }

      const currentView = viewRef.current;

      if (currentView.kind !== "pairing" && currentView.kind !== "approved") {
        return;
      }

      event.preventDefault();

      const rejected = await rejectPendingPairing(currentView.pairingId);
      if (!rejected) {
        return;
      }

      await closeWindow();
    });

    return () => {
      unlistenPairing.then((fn) => fn());
      unlistenCompleted.then((fn) => fn());
      unlistenCloseRequested.then((fn) => fn());
    };
  }, [closeWindow, rejectPendingPairing, windowRef]);

  const handleConfirm = useCallback(async (pairingId: string) => {
    try {
      await invoke("confirm_pending_pairing", { pairingId });
    } catch (err) {
      log.error("Failed to confirm pairing:", err);
      setError(getTauriErrorMessage(err));
      return;
    }

    setError(null);

    setView((current) => {
      if (current.kind !== "pairing") {
        return current;
      }

      return {
        kind: "approved",
        pairingId: current.pairingId,
        origin: current.origin,
        pairingCode: current.pairingCode,
      };
    });
  }, []);

  const handleReject = useCallback(
    async (pairingId: string) => {
      const rejected = await rejectPendingPairing(pairingId);
      if (!rejected) {
        return;
      }

      await closeWindow();
    },
    [closeWindow, rejectPendingPairing]
  );

  const handleClose = useCallback(async () => {
    if (view.kind === "pairing" || view.kind === "approved") {
      await handleReject(view.pairingId);
      return;
    }

    await closeWindow();
  }, [closeWindow, handleReject, view]);

  if (view.kind === "approved") {
    return (
      <div class="pairing-request">
        <div class="pairing-request__header">
          <div>
            <p class="pairing-request__eyebrow">{t("pairing.eyebrow")}</p>
            <h1 class="pairing-request__title">{t("pairing.approved.title")}</h1>
          </div>
        </div>

        <p class="pairing-request__body">{t("pairing.approved.body", { origin: view.origin })}</p>
        <p class="pairing-request__hint">{t("pairing.approved.hint")}</p>

        <div class="pairing-request__panel">
          <span class="pairing-request__label">{t("pairing.labels.verificationCode")}</span>
          <div class="pairing-request__code">{view.pairingCode}</div>
        </div>

        <div class="pairing-request__actions">
          <button type="button" class="pairing-request__secondary-btn" onClick={handleClose}>
            {t("pairing.actions.close")}
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === "success") {
    return (
      <div class="pairing-request">
        <div class="pairing-request__header">
          <div>
            <p class="pairing-request__eyebrow">{t("pairing.eyebrow")}</p>
            <h1 class="pairing-request__title">{t("pairing.success.title")}</h1>
          </div>
        </div>

        <p class="pairing-request__body">{t("pairing.success.body")}</p>
        <p class="pairing-request__hint">{t("pairing.success.hint")}</p>

        <div class="pairing-request__actions">
          <button type="button" class="pairing-request__primary-btn" onClick={handleClose}>
            {t("pairing.actions.close")}
          </button>
        </div>
      </div>
    );
  }

  if (view.kind !== "pairing") {
    return (
      <div class="app">
        <h1>{t("app.title")}</h1>
        <p>{t("pairing.idleMessage")}</p>
      </div>
    );
  }

  return (
    <PairingRequest
      error={error}
      origin={view.origin}
      pairingCode={view.pairingCode}
      onConfirm={() => handleConfirm(view.pairingId)}
      onReject={() => handleReject(view.pairingId)}
      onClose={handleClose}
    />
  );
}
