import { isApiError, type OidcMappingValidationError } from "../types";

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
  if (isOidcMappingValidationDetail(detail)) {
    return detail.errors.map((mappingError) => mappingError.message).join(" ");
  }

  if (options.includeOriginalMessage && typeof error.message === "string" && error.message.trim()) {
    return `${fallback}: ${error.message}`;
  }

  return fallback;
}

export function getOidcMappingValidationErrors(error: unknown): OidcMappingValidationError[] {
  if (!isApiError(error)) return [];
  const detail = error.response?.data?.detail;
  return isOidcMappingValidationDetail(detail) ? detail.errors : [];
}

function isOidcMappingValidationDetail(value: unknown): value is { errors: OidcMappingValidationError[] } {
  if (typeof value !== "object" || value === null || !("errors" in value) || !Array.isArray(value.errors)) return false;
  return value.errors.every(
    (item) => typeof item === "object" && item !== null && typeof item.error_code === "string" && typeof item.message === "string"
  );
}
