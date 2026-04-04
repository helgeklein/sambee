import { useSyncExternalStore } from "react";

export type BackendAvailabilityStatus = "available" | "reconnecting" | "unavailable";

interface BackendAvailabilityState {
  status: BackendAvailabilityStatus;
  lastChangeAt: number;
  lastErrorMessage: string | null;
  recoveryLock: boolean;
}

type Listener = () => void;

const DEFAULT_STATE: BackendAvailabilityState = {
  status: "available",
  lastChangeAt: Date.now(),
  lastErrorMessage: null,
  recoveryLock: false,
};

const listeners = new Set<Listener>();
let state: BackendAvailabilityState = DEFAULT_STATE;

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setState(nextState: BackendAvailabilityState): void {
  if (
    state.status === nextState.status &&
    state.lastErrorMessage === nextState.lastErrorMessage &&
    state.recoveryLock === nextState.recoveryLock
  ) {
    return;
  }

  state = nextState;
  emitChange();
}

export function subscribeBackendAvailability(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBackendAvailabilitySnapshot(): BackendAvailabilityState {
  return state;
}

export function useBackendAvailability(): BackendAvailabilityState {
  return useSyncExternalStore(subscribeBackendAvailability, getBackendAvailabilitySnapshot, getBackendAvailabilitySnapshot);
}

export function markBackendAvailable(): void {
  setState({
    status: "available",
    lastChangeAt: Date.now(),
    lastErrorMessage: null,
    recoveryLock: false,
  });
}

export function markBackendReconnecting(message: string | null = null): void {
  setState({
    status: "reconnecting",
    lastChangeAt: Date.now(),
    lastErrorMessage: message,
    recoveryLock: true,
  });
}

export function markBackendUnavailable(message: string | null = null): void {
  setState({
    status: "unavailable",
    lastChangeAt: Date.now(),
    lastErrorMessage: message,
    recoveryLock: true,
  });
}

export function resetBackendAvailabilityForTests(): void {
  state = DEFAULT_STATE;
  emitChange();
}

function hasHttpResponse(error: unknown): boolean {
  return typeof error === "object" && error !== null && "response" in error && Boolean((error as { response?: unknown }).response);
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function getErrorName(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.name;
  }

  if (typeof error !== "object" || error === null || !("name" in error)) {
    return undefined;
  }

  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }

  return "";
}

export function isLocalAbortError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === "ERR_CANCELED") {
    return true;
  }

  const name = getErrorName(error);
  if (name === "AbortError") {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes("aborted");
}

export function isClientTimeoutError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === "ECONNABORTED") {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes("timeout of") || message.includes("timed out");
}

export function isLocalAbortOrClientTimeout(error: unknown): boolean {
  return isLocalAbortError(error) || isClientTimeoutError(error);
}

export function isBackendConnectivityError(error: unknown): boolean {
  if (hasHttpResponse(error)) {
    return false;
  }

  if (isLocalAbortOrClientTimeout(error)) {
    return false;
  }

  const code = getErrorCode(error);
  if (code && ["ERR_NETWORK", "ECONNREFUSED", "ETIMEDOUT"].includes(code)) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return ["network error", "failed to fetch", "econnrefused", "timeout", "timed out", "load failed"].some((token) =>
    message.includes(token)
  );
}
