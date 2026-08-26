import { authSession } from "./authSession";
import { getServerBaseUrl } from "./backendRouter";

const FOREGROUND_ARCHIVE_OPERATION_STORAGE_KEY = "sambee:foreground-archive-operation";
const FOREGROUND_ARCHIVE_OPERATION_TTL_MS = 24 * 60 * 60_000;

let localArchiveAbortController: AbortController | null = null;

export interface ForegroundArchiveOperation {
  operationId: string;
  startedAt: number;
}

function isForegroundArchiveOperation(value: unknown): value is ForegroundArchiveOperation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const marker = value as Partial<ForegroundArchiveOperation>;
  return typeof marker.operationId === "string" && marker.operationId.length > 0 && typeof marker.startedAt === "number";
}

function cancellationUrl(operationId: string): string {
  return new URL(`archive/operations/${encodeURIComponent(operationId)}/cancel`, `${getServerBaseUrl().replace(/\/$/, "")}/`).toString();
}

export function storeForegroundArchiveOperation(operationId: string): void {
  try {
    sessionStorage.setItem(
      FOREGROUND_ARCHIVE_OPERATION_STORAGE_KEY,
      JSON.stringify({ operationId, startedAt: Date.now() } satisfies ForegroundArchiveOperation)
    );
  } catch {
    // Storage is best effort. The foreground dialog remains the primary control surface.
  }
}

export function loadForegroundArchiveOperation(): ForegroundArchiveOperation | null {
  try {
    const raw = sessionStorage.getItem(FOREGROUND_ARCHIVE_OPERATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const marker: unknown = JSON.parse(raw);
    if (!isForegroundArchiveOperation(marker) || Date.now() - marker.startedAt > FOREGROUND_ARCHIVE_OPERATION_TTL_MS) {
      clearForegroundArchiveOperation();
      return null;
    }
    return marker;
  } catch {
    clearForegroundArchiveOperation();
    return null;
  }
}

export function clearForegroundArchiveOperation(operationId?: string): void {
  try {
    const raw = sessionStorage.getItem(FOREGROUND_ARCHIVE_OPERATION_STORAGE_KEY);
    const marker: unknown = raw ? JSON.parse(raw) : null;
    if (!operationId || (isForegroundArchiveOperation(marker) && marker.operationId === operationId)) {
      sessionStorage.removeItem(FOREGROUND_ARCHIVE_OPERATION_STORAGE_KEY);
    }
  } catch {
    sessionStorage.removeItem(FOREGROUND_ARCHIVE_OPERATION_STORAGE_KEY);
  }
}

export function requestForegroundArchiveCancellation(operationId: string): void {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const token = authSession.getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  void fetch(cancellationUrl(operationId), {
    method: "POST",
    headers,
    credentials: "include",
    keepalive: true,
  }).catch(() => {
    // The reload recovery path retries cancellation if this best-effort request is interrupted.
  });
}

export function beginForegroundLocalArchiveRequest(): AbortSignal {
  localArchiveAbortController?.abort();
  localArchiveAbortController = new AbortController();
  return localArchiveAbortController.signal;
}

export function abortForegroundLocalArchiveRequest(): void {
  localArchiveAbortController?.abort();
}

export function clearForegroundLocalArchiveRequest(signal: AbortSignal): void {
  if (localArchiveAbortController?.signal === signal) {
    localArchiveAbortController = null;
  }
}

export function hasForegroundArchiveWork(): boolean {
  return loadForegroundArchiveOperation() !== null || localArchiveAbortController !== null;
}
