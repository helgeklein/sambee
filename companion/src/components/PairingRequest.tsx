import "../styles/pairing-request.css";

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
          <p class="pairing-request__eyebrow">Pair with Browser</p>
          <h1 class="pairing-request__title">Confirm this pairing request</h1>
        </div>
        <button type="button" class="pairing-request__close-btn" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <p class="pairing-request__body">Sambee in the browser wants to pair with this companion instance.</p>

      <div class="pairing-request__panel">
        <span class="pairing-request__label">Requesting origin</span>
        <div class="pairing-request__origin">{origin}</div>

        <span class="pairing-request__label">Verification code</span>
        <div class="pairing-request__code">{pairingCode}</div>
      </div>

      <p class="pairing-request__hint">Approve only if the same code is visible in the Sambee pairing dialog.</p>

      <div class="pairing-request__actions">
        <button type="button" class="pairing-request__secondary-btn" onClick={onReject}>
          Reject
        </button>
        <button type="button" class="pairing-request__primary-btn" onClick={onConfirm}>
          Codes Match
        </button>
      </div>
    </div>
  );
}
