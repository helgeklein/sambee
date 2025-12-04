import axios from "axios";
import { logger } from "./logger";

export type AuthMethod = "none" | "password";

interface AuthConfig {
  auth_method: AuthMethod;
}

let authConfigCache: AuthConfig | null = null;

/**
 * Get authentication configuration from backend
 */
export async function getAuthConfig(): Promise<AuthConfig> {
  if (authConfigCache) {
    return authConfigCache;
  }

  try {
    const baseURL = import.meta.env.VITE_API_URL || "/api";
    const response = await axios.get<AuthConfig>(`${baseURL}/auth/config`);
    authConfigCache = response.data;
    logger.info(`Auth configuration loaded: ${authConfigCache.auth_method}`);
    return authConfigCache;
  } catch (error) {
    logger.error("Failed to load auth configuration", { error });
    // Default to password auth if we can't reach the backend
    return { auth_method: "password" };
  }
}

/**
 * Check if authentication is required
 */
export async function isAuthRequired(): Promise<boolean> {
  const config = await getAuthConfig();
  return config.auth_method !== "none";
}

/**
 * Clear cached auth configuration (useful for testing or when config changes)
 */
export function clearAuthConfigCache(): void {
  authConfigCache = null;
}
