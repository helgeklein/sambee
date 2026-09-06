const FOREGROUND_TRANSFER_OPERATION_STORAGE_KEY = "sambee:foreground-transfer-operation";
const FOREGROUND_TRANSFER_OPERATION_TTL_MS = 24 * 60 * 60_000;

export interface ForegroundTransferOperation {
  operationId: string;
  destinationConnectionId: string;
  startedAt: number;
}

function isForegroundTransferOperation(value: unknown): value is ForegroundTransferOperation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const marker = value as Partial<ForegroundTransferOperation>;
  return (
    typeof marker.operationId === "string" &&
    marker.operationId.length > 0 &&
    typeof marker.destinationConnectionId === "string" &&
    marker.destinationConnectionId.length > 0 &&
    typeof marker.startedAt === "number"
  );
}

export function storeForegroundTransferOperation(operationId: string, destinationConnectionId: string): void {
  try {
    sessionStorage.setItem(
      FOREGROUND_TRANSFER_OPERATION_STORAGE_KEY,
      JSON.stringify({ operationId, destinationConnectionId, startedAt: Date.now() } satisfies ForegroundTransferOperation)
    );
  } catch {
    // Storage is best effort; the backend receipt remains authoritative.
  }
}

export function loadForegroundTransferOperation(): ForegroundTransferOperation | null {
  try {
    const raw = sessionStorage.getItem(FOREGROUND_TRANSFER_OPERATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const marker: unknown = JSON.parse(raw);
    if (!isForegroundTransferOperation(marker) || Date.now() - marker.startedAt > FOREGROUND_TRANSFER_OPERATION_TTL_MS) {
      clearForegroundTransferOperation();
      return null;
    }
    return marker;
  } catch {
    clearForegroundTransferOperation();
    return null;
  }
}

export function clearForegroundTransferOperation(operationId?: string): void {
  try {
    const raw = sessionStorage.getItem(FOREGROUND_TRANSFER_OPERATION_STORAGE_KEY);
    const marker: unknown = raw ? JSON.parse(raw) : null;
    if (!operationId || (isForegroundTransferOperation(marker) && marker.operationId === operationId)) {
      sessionStorage.removeItem(FOREGROUND_TRANSFER_OPERATION_STORAGE_KEY);
    }
  } catch {
    sessionStorage.removeItem(FOREGROUND_TRANSFER_OPERATION_STORAGE_KEY);
  }
}
