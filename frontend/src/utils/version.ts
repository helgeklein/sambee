/**
 * Version and build information utilities
 */

export interface VersionInfo {
  version: string;
  build_time: string;
  git_commit: string;
}

/**
 * Fetch version information from the backend
 */
export async function fetchVersionInfo(): Promise<VersionInfo | null> {
  try {
    // Use absolute URL for tests (required by MSW), relative for production
    const baseURL = import.meta.env.VITE_API_URL || (import.meta.env.MODE === "test" ? "http://localhost:3000/api" : "/api");
    const response = await fetch(`${baseURL}/version`);
    if (!response.ok) {
      console.warn("Failed to fetch version info:", response.statusText);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn("Error fetching version info:", error);
    return null;
  }
}

/**
 * Format build time for display
 */
export function formatBuildTime(buildTime: string): string {
  if (buildTime === "unknown") {
    return "Unknown";
  }

  try {
    const date = new Date(buildTime);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return buildTime;
  }
}
