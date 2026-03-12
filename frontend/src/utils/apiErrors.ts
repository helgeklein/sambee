import { isApiError } from "../types";

interface ApiErrorMessageOptions {
  includeOriginalMessage?: boolean;
}

/**
 * Extract a user-facing message from API errors while ignoring structured
 * payloads like ConflictInfo when a plain string is required by the UI.
 */
export function getApiErrorMessage(error: unknown, fallback: string, options: ApiErrorMessageOptions = {}): string {
  if (!isApiError(error)) {
    return fallback;
  }

  const detail = error.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (options.includeOriginalMessage && typeof error.message === "string" && error.message.trim()) {
    return `${fallback}: ${error.message}`;
  }

  return fallback;
}
