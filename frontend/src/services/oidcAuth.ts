import type { AuthToken } from "../types";
import { logger } from "./logger";

export const OIDC_ATTEMPT_MARKER = "sambee_oidc_attempted";
export const OIDC_LOGOUT_MARKER = "sambee_oidc_logout";

export function startOidcAuthorization(path: string, returnPath = "/browse"): void {
  const separator = path.includes("?") ? "&" : "?";
  window.location.assign(`${path}${separator}return_path=${encodeURIComponent(returnPath)}`);
}

export async function completeAuthentication(response: AuthToken): Promise<string> {
  localStorage.setItem("access_token", response.access_token);
  sessionStorage.removeItem(OIDC_ATTEMPT_MARKER);
  sessionStorage.removeItem(OIDC_LOGOUT_MARKER);
  await logger.initializeBackendTracing();
  const returnPath = response.return_path;
  return returnPath?.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/browse";
}
