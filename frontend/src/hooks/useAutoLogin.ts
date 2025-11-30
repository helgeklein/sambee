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

      // Auto-login with hardcoded admin credentials for development
      try {
        logger.info("Auto-login: Authenticating with default admin credentials");
        const response = await login("admin", "admin");
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
