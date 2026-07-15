const BACKEND_RECOVERY_RECONNECT_EVENT = "sambee:backend-recovery-reconnect";
const BACKEND_RECOVERY_CONFIRMED_EVENT = "sambee:backend-recovery-confirmed";

export interface BackendRecoveryReconnectDetail {
  reason: string;
}

export interface BackendRecoveryConfirmedDetail {
  reason: string;
}

export function emitBackendRecoveryReconnect(reason: string): void {
  window.dispatchEvent(
    new CustomEvent<BackendRecoveryReconnectDetail>(BACKEND_RECOVERY_RECONNECT_EVENT, {
      detail: { reason },
    })
  );
}

export function emitBackendRecoveryConfirmed(reason: string): void {
  window.dispatchEvent(
    new CustomEvent<BackendRecoveryConfirmedDetail>(BACKEND_RECOVERY_CONFIRMED_EVENT, {
      detail: { reason },
    })
  );
}

export function subscribeBackendRecoveryReconnect(listener: (detail: BackendRecoveryReconnectDetail) => void): () => void {
  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<BackendRecoveryReconnectDetail>;
    listener(customEvent.detail);
  };

  window.addEventListener(BACKEND_RECOVERY_RECONNECT_EVENT, handleEvent as EventListener);
  return () => {
    window.removeEventListener(BACKEND_RECOVERY_RECONNECT_EVENT, handleEvent as EventListener);
  };
}

export function subscribeBackendRecoveryConfirmed(listener: (detail: BackendRecoveryConfirmedDetail) => void): () => void {
  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<BackendRecoveryConfirmedDetail>;
    listener(customEvent.detail);
  };

  window.addEventListener(BACKEND_RECOVERY_CONFIRMED_EVENT, handleEvent as EventListener);
  return () => {
    window.removeEventListener(BACKEND_RECOVERY_CONFIRMED_EVENT, handleEvent as EventListener);
  };
}
