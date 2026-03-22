import "../styles/pairing-request.css";
import { translate } from "../i18n";

interface PairingRequestProps {
  origin: string;
  pairingCode: string;
  onConfirm: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
}

/** Companion-side approval screen for browser pairing requests. */
export function PairingRequest({ origin, pairingCode, onConfirm, onReject, onClose }: PairingRequestProps) {
  return (
    <div class="pairing-request">
      <div class="pairing-request__header">
        <div>
          <p class="pairing-request__eyebrow">{translate("pairing.eyebrow")}</p>
          <h1 class="pairing-request__title">{translate("pairing.title")}</h1>
        </div>
        <button type="button" class="pairing-request__close-btn" onClick={onClose} title={translate("pairing.closeTitle")}>
          ✕
        </button>
      </div>

      <p class="pairing-request__body">{translate("pairing.body")}</p>

      <div class="pairing-request__panel">
        <span class="pairing-request__label">{translate("pairing.labels.requestingOrigin")}</span>
        <div class="pairing-request__origin">{origin}</div>

        <span class="pairing-request__label">{translate("pairing.labels.verificationCode")}</span>
        <div class="pairing-request__code">{pairingCode}</div>
      </div>

      <p class="pairing-request__hint">{translate("pairing.hint")}</p>

      <div class="pairing-request__actions">
        <button type="button" class="pairing-request__secondary-btn" onClick={onReject}>
          {translate("pairing.actions.reject")}
        </button>
        <button type="button" class="pairing-request__primary-btn" onClick={onConfirm}>
          {translate("pairing.actions.codesMatch")}
        </button>
      </div>
    </div>
  );
}
