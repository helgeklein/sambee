import type { AuthToken } from "../types";
import { logger } from "./logger";

export const OIDC_ATTEMPT_MARKER = "sambee_oidc_attempted";
export const OIDC_LOGOUT_MARKER = "sambee_oidc_logout";
export const OIDC_RETURN_PATH_MARKER = "sambee_oidc_return_path";

export function sanitizeReturnPath(returnPath: string | null | undefined): string {
  return returnPath?.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/browse";
}

export function loginReturnPath(search: string): string {
  const requestedPath = new URLSearchParams(search).get("return_path");
  return sanitizeReturnPath(requestedPath ?? sessionStorage.getItem(OIDC_RETURN_PATH_MARKER));
}

export function loginPath(returnPath: string): string {
  return `/login?return_path=${encodeURIComponent(sanitizeReturnPath(returnPath))}`;
}

export function startOidcAuthorization(path: string, returnPath = "/browse"): void {
  const sanitizedReturnPath = sanitizeReturnPath(returnPath);
  sessionStorage.setItem(OIDC_RETURN_PATH_MARKER, sanitizedReturnPath);
  const separator = path.includes("?") ? "&" : "?";
  window.location.assign(`${path}${separator}return_path=${encodeURIComponent(sanitizedReturnPath)}`);
}

export async function completeAuthentication(response: AuthToken, fallbackReturnPath?: string): Promise<string> {
  localStorage.setItem("access_token", response.access_token);
  sessionStorage.removeItem(OIDC_ATTEMPT_MARKER);
  sessionStorage.removeItem(OIDC_LOGOUT_MARKER);
  await logger.initializeBackendTracing();
  const returnPath = sanitizeReturnPath(response.return_path ?? fallbackReturnPath ?? sessionStorage.getItem(OIDC_RETURN_PATH_MARKER));
  sessionStorage.removeItem(OIDC_RETURN_PATH_MARKER);
  return returnPath;
}
