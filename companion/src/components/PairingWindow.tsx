import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "preact/hooks";
import { useI18n } from "../i18n/useI18n";
import { log } from "../lib/logger";
import { PairingRequest } from "./PairingRequest";

const SUCCESS_AUTO_CLOSE_DELAY_MS = 2500;

interface PairingEventPayload {
  pairing_id: string;
  origin: string;
  pairing_code: string;
}

type PairingViewState =
  | { kind: "idle" }
  | { kind: "pairing"; pairingId: string; origin: string; pairingCode: string }
  | { kind: "approved"; origin: string; pairingCode: string }
  | { kind: "success" };

/** Dedicated root component for the pairing approval window. */
export function PairingWindow() {
  const { t } = useI18n();
  const [view, setView] = useState<PairingViewState>({ kind: "idle" });

  const closeWindow = useCallback(async () => {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      log.warn("Failed to close pairing window:", err);
    }
  }, []);

  useEffect(() => {
    const unlistenPairing = listen<PairingEventPayload>("show-pairing", (event) => {
      setView({
        kind: "pairing",
        pairingId: event.payload.pairing_id,
        origin: event.payload.origin,
        pairingCode: event.payload.pairing_code,
      });
    });

    const unlistenCompleted = listen("pairing-completed", () => {
      setView({ kind: "success" });
    });

    return () => {
      unlistenPairing.then((fn) => fn());
      unlistenCompleted.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (view.kind !== "success") {
      return;
    }

    const timer = setTimeout(() => {
      void closeWindow();
    }, SUCCESS_AUTO_CLOSE_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [closeWindow, view.kind]);

  const handleConfirm = useCallback(async (pairingId: string) => {
    try {
      await invoke("confirm_pending_pairing", { pairingId });
    } catch (err) {
      log.error("Failed to confirm pairing:", err);
      return;
    }

    setView((current) => {
      if (current.kind !== "pairing") {
        return current;
      }

      return {
        kind: "approved",
        origin: current.origin,
        pairingCode: current.pairingCode,
      };
    });
  }, []);

  const handleReject = useCallback(
    async (pairingId: string) => {
      try {
        await invoke("reject_pending_pairing", { pairingId });
      } catch (err) {
        log.error("Failed to reject pairing:", err);
        return;
      }

      await closeWindow();
    },
    [closeWindow]
  );

  const handleClose = useCallback(async () => {
    await closeWindow();
  }, [closeWindow]);

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
      origin={view.origin}
      pairingCode={view.pairingCode}
      onConfirm={() => handleConfirm(view.pairingId)}
      onReject={() => handleReject(view.pairingId)}
      onClose={handleClose}
    />
  );
}
