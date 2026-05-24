const AUTH_RETRY_PREFIX = "retry-auth:";

export type AuthRetryReason = "upload" | "conflict";

export function getTauriErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function parseAuthRetryReason(error: unknown): AuthRetryReason | null {
  const message = getTauriErrorMessage(error);
  const markerIndex = message.indexOf(AUTH_RETRY_PREFIX);
  if (markerIndex === -1) {
    return null;
  }

  const reason = message.slice(markerIndex + AUTH_RETRY_PREFIX.length).trim();
  if (reason === "upload" || reason === "conflict") {
    return reason;
  }

  return null;
}
