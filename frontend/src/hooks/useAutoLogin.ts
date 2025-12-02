import { useEffect, useState } from "react";
import { apiService, login } from "../services/api";
import { logger } from "../services/logger";

/**
 * Development-only auto-login hook.
 * Automatically logs in with hardcoded admin credentials if no token exists.
 *
 * TODO: Remove this hook when implementing proper production authentication.
 */
export function useAutoLogin() {
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const autoLogin = async () => {
      // Check if we already have a token
      const existingToken = localStorage.getItem("access_token");
      if (existingToken) {
        // Verify the token is still valid
        const isValid = await apiService.validateToken();
        if (isValid) {
          logger.debug("Auto-login: Valid token exists, skipping");
          setIsAuthReady(true);
          return;
        }
        // Token is invalid - was cleared by validateToken
        logger.debug("Auto-login: Existing token is invalid, will re-authenticate");
        // Clear attempt flag to allow retry with fresh credentials
        sessionStorage.removeItem("auto_login_attempted");
        // Fall through to attempt auto-login
      } else {
        // No token at all - clear the attempt flag to allow auto-login
        // This handles the case where localStorage was cleared but sessionStorage wasn't
        sessionStorage.removeItem("auto_login_attempted");
      }

      // Check if auto-login has already been attempted this session
      const autoLoginAttempted = sessionStorage.getItem("auto_login_attempted");
      if (autoLoginAttempted === "true") {
        logger.debug("Auto-login: Already attempted this session, skipping");
        setIsAuthReady(true);
        return;
      }

      // Mark that we've attempted auto-login for this session
      sessionStorage.setItem("auto_login_attempted", "true");

      // Auto-login with hardcoded admin credentials for development
      try {
        logger.info("Auto-login: Authenticating with default admin credentials");
        const response = await login("admin", "admin");
        localStorage.setItem("access_token", response.access_token);
        logger.info("Auto-login: Successfully authenticated", {
          username: response.username,
          isAdmin: response.is_admin,
        });
        setIsAuthReady(true);
      } catch (error) {
        logger.error("Auto-login: Failed to authenticate with default credentials", { error });
        // If auto-login fails, mark as ready but token will be missing
        // The API interceptor will redirect to /login on 401 errors
        setIsAuthReady(true);
      }
    };

    autoLogin();
  }, []);

  return isAuthReady;
}
