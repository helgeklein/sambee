import { useEffect, useState } from "react";
import { login } from "../services/api";
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
        logger.debug("Auto-login: Token already exists, skipping");
        setIsAuthReady(true);
        return;
      }

      // Check if auto-login has already been attempted (prevents endless retry loop)
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
        const response = await login("admin", "changeme");
        localStorage.setItem("access_token", response.access_token);
        logger.info("Auto-login: Successfully authenticated", {
          username: response.username,
          isAdmin: response.is_admin,
        });
      } catch (error) {
        logger.error("Auto-login: Failed to authenticate with default credentials", { error });
        // If auto-login fails, still mark as ready so the app can render
        // The API interceptor will redirect to /login on 401 errors
      }

      setIsAuthReady(true);
    };

    autoLogin();
  }, []);

  return isAuthReady;
}
