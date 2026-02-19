import axios, { type AxiosError, type AxiosInstance } from "axios";
import type { AuthToken, Connection, ConnectionCreate, DirectoryListing, DirectorySearchResult, FileInfo, User } from "../types";
import { logger } from "./logger";

class ApiService {
  private api: AxiosInstance;
  private skipRedirectOnce = false;

  constructor() {
    // Use absolute URL for tests (required by MSW), relative for production
    const baseURL = import.meta.env.VITE_API_URL || (import.meta.env.MODE === "test" ? "http://localhost:3000/api" : "/api");
    this.api = axios.create({
      baseURL,
    });

    // Add auth token to requests
    this.api.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem("access_token");
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        // Log API request
        logger.debug(
          `API Request: ${config.method?.toUpperCase()} ${config.url}`,
          {
            method: config.method,
            url: config.url,
          },
          "api"
        );
        return config;
      },
      (error) => {
        logger.error("API request setup failed", { error: error.message }, "api");
        return Promise.reject(error);
      }
    );

    // Handle auth errors and log responses
    this.api.interceptors.response.use(
      (response) => {
        logger.debug(
          `API Response: ${response.config.method?.toUpperCase()} ${response.config.url}`,
          {
            status: response.status,
            statusText: response.statusText,
          },
          "api"
        );
        return response;
      },
      (error: AxiosError) => {
        if (axios.isCancel(error) || error.code === "ERR_CANCELED") {
          return Promise.reject(error);
        }

        const requestId = logger.extractRequestId(error.response?.headers as Record<string, string>);

        // Log the error with context
        logger.error(
          "API request failed",
          {
            method: error.config?.method,
            url: error.config?.url,
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
          },
          "api"
        ); // Redirect to login on any 401 Unauthorized response
        // This includes expired tokens, invalid credentials, etc.
        if (error.response?.status === 401) {
          localStorage.removeItem("access_token");

          // Skip redirect if we're validating token
          if (this.skipRedirectOnce) {
            this.skipRedirectOnce = false;
            logger.debug("Skipping redirect during token validation", {}, "api");
            return Promise.reject(error);
          }

          // Only redirect to login if password auth is enabled
          // If auth_method is "none", 401 shouldn't happen (but if it does, don't redirect)
          import("./authConfig").then(({ isAuthRequired }) => {
            isAuthRequired().then((authRequired) => {
              if (authRequired && window.location.pathname !== "/login") {
                logger.warn(
                  "Authentication failed (401), redirecting to login",
                  {
                    detail: (error.response?.data as { detail?: string })?.detail,
                    requestId,
                  },
                  "api"
                );
                window.location.href = "/login";
              }
            });
          });
        }
        return Promise.reject(error);
      }
    );
  }

  // Auth endpoints
  async login(username: string, password: string): Promise<AuthToken> {
    logger.info("Login attempt", { username }, "api");

    const formData = new FormData();
    formData.append("username", username);
    formData.append("password", password);

    const response = await this.api.post<AuthToken>("/auth/token", formData);
    localStorage.setItem("access_token", response.data.access_token);

    logger.info(
      "Login successful",
      {
        username: response.data.username,
        hasToken: !!response.data.access_token,
        isAdmin: response.data.is_admin,
      },
      "api"
    );
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    logger.debug("Fetching current user info", {}, "api");
    const response = await this.api.get<User>("/auth/me");
    return response.data;
  }

  async validateToken(): Promise<boolean> {
    this.skipRedirectOnce = true;
    try {
      await this.getCurrentUser();
      return true;
    } catch {
      return false;
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.api.post("/auth/change-password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  // Admin endpoints
  async getConnections(): Promise<Connection[]> {
    const response = await this.api.get<Connection[]>("/admin/connections");
    return response.data;
  }

  async createConnection(connection: ConnectionCreate): Promise<Connection> {
    const response = await this.api.post<Connection>("/admin/connections", connection);
    return response.data;
  }

  async updateConnection(connectionId: string, connection: Partial<ConnectionCreate>): Promise<Connection> {
    const response = await this.api.put<Connection>(`/admin/connections/${connectionId}`, connection);
    return response.data;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.api.delete(`/admin/connections/${connectionId}`);
  }

  async testConnection(connectionId: string): Promise<{ status: string; message: string }> {
    const response = await this.api.post(`/admin/connections/${connectionId}/test`);
    return response.data;
  }

  // Browse endpoints
  async listDirectory(connectionId: string, path: string = ""): Promise<DirectoryListing> {
    const response = await this.api.get<DirectoryListing>(`/browse/${connectionId}/list`, {
      params: { path },
    });
    return response.data;
  }

  async getFileInfo(connectionId: string, path: string): Promise<FileInfo> {
    const response = await this.api.get<FileInfo>(`/browse/${connectionId}/info`, {
      params: { path },
    });
    return response.data;
  }

  /**
   * Search for directories across an entire connection.
   * Returns matching directory paths from the server-side cache.
   */
  async searchDirectories(connectionId: string, query: string, signal?: AbortSignal): Promise<DirectorySearchResult> {
    const response = await this.api.get<DirectorySearchResult>(`/browse/${connectionId}/directories`, {
      params: { q: query },
      signal,
    });
    return response.data;
  }

  /**
   * Delete a file or empty directory on the remote share.
   */
  async deleteItem(connectionId: string, path: string): Promise<void> {
    await this.api.delete(`/browse/${connectionId}/item`, {
      params: { path },
    });
  }

  /**
   * Rename a file or directory on the remote share.
   *
   * Returns the updated FileInfo for the renamed item.
   */
  async renameItem(connectionId: string, path: string, newName: string): Promise<FileInfo> {
    const response = await this.api.post<FileInfo>(`/browse/${connectionId}/rename`, {
      path,
      new_name: newName,
    });
    return response.data;
  }

  /**
   * Create a new file or directory on the remote share.
   *
   * Returns the FileInfo for the newly created item.
   */
  async createItem(connectionId: string, parentPath: string, name: string, type: "file" | "directory"): Promise<FileInfo> {
    const response = await this.api.post<FileInfo>(`/browse/${connectionId}/create`, {
      parent_path: parentPath,
      name,
      type,
    });
    return response.data;
  }

  // Viewer endpoints
  getViewUrl(connectionId: string, path: string): string {
    const token = localStorage.getItem("access_token");
    const baseUrl = import.meta.env.VITE_API_URL || "/api";
    return `${baseUrl}/viewer/${connectionId}/file?path=${encodeURIComponent(path)}&token=${token}`;
  }

  getDownloadUrl(connectionId: string, path: string): string {
    const token = localStorage.getItem("access_token");
    const baseUrl = import.meta.env.VITE_API_URL || "/api";
    return `${baseUrl}/viewer/${connectionId}/download?path=${encodeURIComponent(path)}&token=${token}`;
  }

  async downloadFile(connectionId: string, path: string, filename: string): Promise<void> {
    const token = localStorage.getItem("access_token");
    const baseUrl = import.meta.env.VITE_API_URL || "/api";
    const url = `${baseUrl}/viewer/${connectionId}/download?path=${encodeURIComponent(path)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(blobUrl);
  }

  async getFileContent(connectionId: string, path: string): Promise<string> {
    const token = localStorage.getItem("access_token");
    const response = await this.api.get(`/viewer/${connectionId}/file`, {
      params: { path },
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: "text",
    });
    return response.data;
  }

  /**
   * Fetch image as blob with authentication headers.
   * Returns blob data that can be used to create object URLs.
   * Optionally resizes images to fit viewport dimensions.
   */
  async getImageBlob(
    connectionId: string,
    path: string,
    options: { signal?: AbortSignal; viewportWidth?: number; viewportHeight?: number; no_resizing?: boolean } = {}
  ): Promise<Blob> {
    try {
      const params: Record<string, string | number> = { path };

      // Add viewport dimensions if provided (for server-side resizing)
      if (options.viewportWidth) {
        params["viewport_width"] = Math.round(options.viewportWidth * window.devicePixelRatio);
      }
      if (options.viewportHeight) {
        params["viewport_height"] = Math.round(options.viewportHeight * window.devicePixelRatio);
      }
      if (options.no_resizing) {
        params["no_resizing"] = 1;
      }

      const response = await this.api.get<ArrayBuffer>(`/viewer/${connectionId}/file`, {
        params,
        responseType: "arraybuffer",
        signal: options.signal,
      });

      const contentType = response.headers["content-type"] ?? "application/octet-stream";
      const data = response.data instanceof ArrayBuffer ? response.data : new ArrayBuffer(0);
      return new Blob([data], { type: contentType });
    } catch (error) {
      // When responseType is 'arraybuffer', error responses come as ArrayBuffer
      // We need to convert them to JSON to access the detail field
      if (axios.isAxiosError(error)) {
        // Check if data is a string (common when responseType is arraybuffer but error is JSON)
        if (typeof error.response?.data === "string") {
          try {
            const json = JSON.parse(error.response.data);
            // Re-throw with parsed data
            throw {
              ...error,
              response: {
                ...error.response,
                data: json,
              },
            };
          } catch {
            // If parsing fails, continue to next check
          }
        }
      }

      if (axios.isAxiosError(error) && error.response?.data instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        const text = decoder.decode(error.response.data);
        try {
          const json = JSON.parse(text);
          // Create error with parsed JSON data
          const newError = {
            ...error,
            response: {
              ...error.response,
              data: json,
            },
          };
          throw newError;
        } catch (parseError) {
          // If JSON.parse fails, throw original error
          if (parseError instanceof SyntaxError) {
            throw error;
          }
          // If it's not a SyntaxError, it's our thrown newError - re-throw it
          throw parseError;
        }
      }
      throw error;
    }
  }

  /**
   * Fetch PDF as blob with authentication headers.
   * Returns blob data that can be used to create object URLs for react-pdf.
   */
  async getPdfBlob(connectionId: string, path: string, options: { signal?: AbortSignal } = {}): Promise<Blob> {
    try {
      const response = await this.api.get<ArrayBuffer>(`/viewer/${connectionId}/file`, {
        params: { path },
        responseType: "arraybuffer",
        signal: options.signal,
      });

      const contentType = response.headers["content-type"] ?? "application/pdf";
      // response.data is an ArrayBuffer when responseType is 'arraybuffer'
      return new Blob([response.data], { type: contentType });
    } catch (error) {
      // When responseType is 'arraybuffer', error responses come as ArrayBuffer
      // We need to convert them to JSON to access the detail field
      if (axios.isAxiosError(error)) {
        // Check if data is a string (common when responseType is arraybuffer but error is JSON)
        if (typeof error.response?.data === "string") {
          try {
            const json = JSON.parse(error.response.data);
            // Re-throw with parsed data
            throw {
              ...error,
              response: {
                ...error.response,
                data: json,
              },
            };
          } catch {
            // If parsing fails, continue to next check
          }
        }
      }

      if (axios.isAxiosError(error) && error.response?.data instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        const text = decoder.decode(error.response.data);
        try {
          const json = JSON.parse(text);
          // Create error with parsed JSON data
          const newError = {
            ...error,
            response: {
              ...error.response,
              data: json,
            },
          };
          throw newError;
        } catch (parseError) {
          // If JSON.parse fails, throw original error
          if (parseError instanceof SyntaxError) {
            throw error;
          }
          // If it's not a SyntaxError, it's our thrown newError - re-throw it
          throw parseError;
        }
      }
      throw error;
    }
  }

  /**
   * Get frontend logging configuration
   */
  async getLoggingConfig() {
    const response = await this.api.get<{
      logging_enabled: boolean;
      logging_level: string;
      tracing_enabled: boolean;
      tracing_level: string;
      tracing_components: string[];
    }>("/logs/config");
    return response.data;
  }

  /**
   * Send mobile log entries to server
   */
  async sendMobileLogs(batch: {
    session_id: string;
    device_info: Record<string, unknown>;
    logs: Array<{
      timestamp: number;
      level: string;
      message: string;
      context?: Record<string, unknown>;
      component?: string;
    }>;
  }) {
    const response = await this.api.post<{
      status: string;
      filename: string;
      logs_received: number;
    }>("/logs/mobile", batch);
    return response.data;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Companion App
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Request a short-lived URI token and build a sambee:// URI for the companion app.
   *
   * The returned URI encodes the server origin, token, connection, path,
   * and (optionally) the current UI theme so the companion can match it.
   */
  async getCompanionUri(connectionId: string, path: string, themeJson?: string): Promise<string> {
    const response = await this.api.post<{ uri_token: string; expires_in: number }>("/companion/uri-token", {
      connection_id: connectionId,
      path,
    });

    const { uri_token } = response.data;
    const serverUrl = encodeURIComponent(window.location.origin);
    const encodedPath = encodeURIComponent(path);

    let uri = `sambee://open?server=${serverUrl}&token=${uri_token}&connId=${connectionId}&path=${encodedPath}`;

    if (themeJson) {
      uri += `&theme=${btoa(themeJson)}`;
    }

    return uri;
  }

  /**
   * List available mobile log files
   */
  async listMobileLogs() {
    const response = await this.api.get<{
      files: Array<{
        filename: string;
        size: number;
        modified: string;
        session_id: string;
        log_count: number;
      }>;
      total_size: number;
    }>("/logs/list");
    return response.data;
  }

  /**
   * Get download URL for a mobile log file
   */
  getLogDownloadUrl(filename: string): string {
    const token = localStorage.getItem("access_token");
    const baseURL = this.api.defaults.baseURL || "/api";
    return `${baseURL}/logs/download/${encodeURIComponent(filename)}?token=${token}`;
  }
}

export const apiService = new ApiService();
export default apiService;

// Export convenience functions
export const login = (username: string, password: string) => apiService.login(username, password);

export const browseFiles = async (path: string, _token: string) => {
  // For simple browsing, we'll use a default connection
  // This should be updated when connections are properly configured
  try {
    const connections = await apiService.getConnections();
    if (connections.length === 0) {
      return [];
    }
    const listing = await apiService.listDirectory(connections[0]!.id, path);
    return listing.items;
  } catch (err) {
    logger.error("Error browsing files", { error: err }, "api");
    return [];
  }
};
