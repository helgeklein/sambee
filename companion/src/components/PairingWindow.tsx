import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "preact/hooks";
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
            <p class="pairing-request__eyebrow">Pair with Browser</p>
            <h1 class="pairing-request__title">Approval sent</h1>
          </div>
        </div>

        <p class="pairing-request__body">The codes matched for {view.origin}.</p>
        <p class="pairing-request__hint">Waiting for Sambee to finish storing the pairing.</p>

        <div class="pairing-request__panel">
          <span class="pairing-request__label">Verification code</span>
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
            <p class="pairing-request__eyebrow">Pair with Browser</p>
            <h1 class="pairing-request__title">Pairing successful</h1>
          </div>
        </div>

        <p class="pairing-request__body">This browser is now paired with Sambee Companion and can access local drives.</p>
        <p class="pairing-request__hint">This window will close automatically.</p>

        <div class="pairing-request__actions">
          <button type="button" class="pairing-request__primary-btn" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (view.kind !== "pairing") {
    return (
      <div class="app">
        <h1>Sambee Companion</h1>
        <p>Waiting for a pairing request.</p>
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
