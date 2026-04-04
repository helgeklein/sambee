const BACKEND_RECOVERY_RECONNECT_EVENT = "sambee:backend-recovery-reconnect";

export interface BackendRecoveryReconnectDetail {
  reason: string;
}

export function emitBackendRecoveryReconnect(reason: string): void {
  window.dispatchEvent(
    new CustomEvent<BackendRecoveryReconnectDetail>(BACKEND_RECOVERY_RECONNECT_EVENT, {
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
