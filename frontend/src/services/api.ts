import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";
import type {
  AdminUser,
  AdminUserCreateInput,
  AdminUserCreateResult,
  AdminUserPasswordResetResult,
  AdminUserUpdateInput,
  AdvancedSystemSettings,
  AdvancedSystemSettingsUpdate,
  AuthToken,
  Connection,
  ConnectionCreate,
  ConnectionVisibilityOption,
  CurrentUserSettings,
  CurrentUserSettingsUpdate,
  DirectoryListing,
  DirectorySearchResult,
  EditLockInfo,
  EditLockStatus,
  FileInfo,
  User,
} from "../types";
import { FileType } from "../types";
import { isAdminUser } from "../utils/userAccess";
import { isBackendConnectivityError, markBackendAvailable, markBackendUnavailable } from "./backendAvailability";
import { getBaseUrl, getBrowseSegment, isLocalDrive } from "./backendRouter";
import { COMPANION_BASE_URL } from "./companion";
import { logger } from "./logger";

export interface DirectorySearchOptions {
  includeDotDirectories?: boolean;
  signal?: AbortSignal;
}

const CONNECTIONS_API_BASE = "/connections";
const LOCAL_DRIVE_EDIT_LOCKS_UNSUPPORTED_MESSAGE = "Edit locks are not supported for local drives";
const DIRECTORY_LIST_REQUEST_TIMEOUT_MS = 40_000;

function normalizeUser(user: User): User {
  return {
    ...user,
    is_admin: isAdminUser(user),
  };
}

class ApiService {
  private api: AxiosInstance;
  /** Separate axios instance for companion requests (no Bearer interceptor). */
  private companionApi: AxiosInstance;
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
          config.headers["Authorization"] = `Bearer ${token}`;
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
        markBackendAvailable();
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

        if (isBackendConnectivityError(error)) {
          markBackendUnavailable(error.message);
        } else if (error.response?.status) {
          markBackendAvailable();
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

    // Companion axios instance — no Bearer token interceptor.
    // Auth headers are added per-request via buildCompanionHeaders().
    this.companionApi = axios.create({
      baseURL: COMPANION_BASE_URL,
      timeout: 10_000,
    });
  }

  // ── Routing helpers ─────────────────────────────────────────────────────

  /**
   * Build HMAC auth headers for companion requests.
   *
   * Uses Web Crypto API for HMAC-SHA256(secret, timestamp).
   */
  private async buildCompanionHeaders(): Promise<Record<string, string>> {
    const secret = localStorage.getItem("companion_secret");
    if (!secret) {
      throw new Error("Not paired with companion");
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(timestamp);

    const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
    const hmac = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return {
      "X-Companion-Secret": hmac,
      "X-Companion-Timestamp": timestamp,
    };
  }

  /**
   * Build HMAC auth as URL query parameters for companion viewer URLs.
   *
   * Used for `<img src>` / `<iframe>` contexts where headers can't be set.
   * Returns a query string fragment: `hmac=...&ts=...&origin=...`
   */
  private async buildCompanionQueryAuth(): Promise<string> {
    const secret = localStorage.getItem("companion_secret");
    if (!secret) {
      throw new Error("Not paired with companion");
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(timestamp);

    const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
    const hmac = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const origin = encodeURIComponent(window.location.origin);
    return `hmac=${hmac}&ts=${timestamp}&origin=${origin}`;
  }

  /**
   * Get the correct axios instance and extra config for a connection.
   *
   * For local drives: returns the companion instance + HMAC headers.
   * For server connections: returns the main instance (Bearer via interceptor).
   */
  private async getClientConfig(connectionId: string): Promise<{ client: AxiosInstance; extraConfig: AxiosRequestConfig }> {
    if (isLocalDrive(connectionId)) {
      const headers = await this.buildCompanionHeaders();
      return { client: this.companionApi, extraConfig: { headers } };
    }
    return { client: this.api, extraConfig: {} };
  }

  private assertEditLocksSupported(connectionId: string): void {
    if (isLocalDrive(connectionId)) {
      throw new Error(LOCAL_DRIVE_EDIT_LOCKS_UNSUPPORTED_MESSAGE);
    }
  }

  supportsEditLocks(connectionId: string): boolean {
    return !isLocalDrive(connectionId);
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
    return normalizeUser(response.data);
  }

  async getCurrentUserSettings(): Promise<CurrentUserSettings> {
    const response = await this.api.get<CurrentUserSettings>("/auth/me/settings");
    return response.data;
  }

  async updateCurrentUserSettings(payload: CurrentUserSettingsUpdate): Promise<CurrentUserSettings> {
    const response = await this.api.put<CurrentUserSettings>("/auth/me/settings", payload);
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

  // Connection endpoints
  async getConnections(): Promise<Connection[]> {
    const response = await this.api.get<Connection[]>(CONNECTIONS_API_BASE);
    return response.data;
  }

  async createConnection(connection: ConnectionCreate): Promise<Connection> {
    const response = await this.api.post<Connection>(CONNECTIONS_API_BASE, connection);
    return response.data;
  }

  async getConnectionVisibilityOptions(): Promise<ConnectionVisibilityOption[]> {
    const response = await this.api.get<ConnectionVisibilityOption[]>(`${CONNECTIONS_API_BASE}/visibility-options`);
    return response.data;
  }

  async updateConnection(connectionId: string, connection: Partial<ConnectionCreate>): Promise<Connection> {
    const response = await this.api.put<Connection>(`${CONNECTIONS_API_BASE}/${connectionId}`, connection);
    return response.data;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.api.delete(`${CONNECTIONS_API_BASE}/${connectionId}`);
  }

  async testConnection(connectionId: string): Promise<{ status: string; message: string }> {
    const response = await this.api.post(`${CONNECTIONS_API_BASE}/${connectionId}/test`);
    return response.data;
  }

  async testConnectionConfig(connection: ConnectionCreate): Promise<{ status: string; message: string }> {
    const response = await this.api.post(`${CONNECTIONS_API_BASE}/test-config`, connection);
    return response.data;
  }

  async getUsers(): Promise<AdminUser[]> {
    const response = await this.api.get<AdminUser[]>("/admin/users");
    return response.data;
  }

  async createUser(user: AdminUserCreateInput): Promise<AdminUserCreateResult> {
    const response = await this.api.post<AdminUserCreateResult>("/admin/users", user);
    return response.data;
  }

  async updateUser(userId: string, user: AdminUserUpdateInput): Promise<AdminUser> {
    const response = await this.api.patch<AdminUser>(`/admin/users/${userId}`, user);
    return response.data;
  }

  async resetUserPassword(userId: string): Promise<AdminUserPasswordResetResult> {
    const response = await this.api.post<AdminUserPasswordResetResult>(`/admin/users/${userId}/reset-password`);
    return response.data;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.api.delete(`/admin/users/${userId}`);
  }

  async getAdvancedSettings(): Promise<AdvancedSystemSettings> {
    const response = await this.api.get<AdvancedSystemSettings>("/admin/settings/advanced");
    return response.data;
  }

  async updateAdvancedSettings(payload: AdvancedSystemSettingsUpdate): Promise<AdvancedSystemSettings> {
    const response = await this.api.put<AdvancedSystemSettings>("/admin/settings/advanced", payload);
    return response.data;
  }

  // Browse endpoints
  async listDirectory(
    connectionId: string,
    path: string = "",
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<DirectoryListing> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.get<DirectoryListing>(`/browse/${segment}/list`, {
      ...extraConfig,
      params: { path },
      timeout: options?.timeoutMs ?? DIRECTORY_LIST_REQUEST_TIMEOUT_MS,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    return response.data;
  }

  async getFileInfo(connectionId: string, path: string): Promise<FileInfo> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.get<FileInfo>(`/browse/${segment}/info`, {
      ...extraConfig,
      params: { path },
    });
    return response.data;
  }

  /**
   * Search for directories across an entire connection.
   * Returns matching directory paths from the server-side cache.
   */
  async searchDirectories(connectionId: string, query: string, options?: DirectorySearchOptions): Promise<DirectorySearchResult> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.get<DirectorySearchResult>(`/browse/${segment}/directories`, {
      ...extraConfig,
      params: {
        q: query,
        include_dot_directories: options?.includeDotDirectories ?? false,
      },
      signal: options?.signal,
    });
    return response.data;
  }

  /**
   * Delete a file or directory.
   */
  async deleteItem(connectionId: string, path: string): Promise<void> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    await client.delete(`/browse/${segment}/item`, {
      ...extraConfig,
      params: { path },
    });
  }

  /**
   * Rename a file or directory.
   *
   * Returns the updated FileInfo for the renamed item.
   */
  async renameItem(connectionId: string, path: string, newName: string): Promise<FileInfo> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.post<FileInfo>(
      `/browse/${segment}/rename`,
      {
        path,
        new_name: newName,
      },
      extraConfig
    );
    return response.data;
  }

  /**
   * Create a new file or directory.
   *
   * Returns the FileInfo for the newly created item.
   */
  async createItem(connectionId: string, parentPath: string, name: string, type: "file" | "directory"): Promise<FileInfo> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.post<FileInfo>(
      `/browse/${segment}/create`,
      {
        parent_path: parentPath,
        name,
        type,
      },
      extraConfig
    );
    return response.data;
  }

  /**
   * Copy a file or directory to a new location.
   *
   * When ``destConnectionId`` is provided and differs from ``connectionId``,
   * a cross-connection copy is performed. For same-backend transfers (both
   * SMB or both local), the backend handles it natively. For cross-backend
   * transfers (SMB ↔ local), the browser mediates: download from source,
   * upload to destination.
   */
  async copyItem(connectionId: string, sourcePath: string, destPath: string, destConnectionId?: string, overwrite = false): Promise<void> {
    if (destConnectionId && this.isCrossBackendTransfer(connectionId, destConnectionId)) {
      await this.crossBackendCopy(connectionId, sourcePath, destConnectionId, destPath, overwrite);
      return;
    }
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    await client.post(
      `/browse/${segment}/copy`,
      {
        source_path: sourcePath,
        dest_path: destPath,
        dest_connection_id: destConnectionId,
        overwrite,
      },
      extraConfig
    );
  }

  /**
   * Move a file or directory to a new location.
   *
   * When ``destConnectionId`` is provided and differs from ``connectionId``,
   * a cross-connection move is performed (copy + delete source).
   * For cross-backend transfers (SMB ↔ local), the browser mediates.
   */
  async moveItem(connectionId: string, sourcePath: string, destPath: string, destConnectionId?: string, overwrite = false): Promise<void> {
    if (destConnectionId && this.isCrossBackendTransfer(connectionId, destConnectionId)) {
      await this.crossBackendCopy(connectionId, sourcePath, destConnectionId, destPath, overwrite);
      await this.deleteItem(connectionId, sourcePath);
      return;
    }
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    await client.post(
      `/browse/${segment}/move`,
      {
        source_path: sourcePath,
        dest_path: destPath,
        dest_connection_id: destConnectionId,
        overwrite,
      },
      extraConfig
    );
  }

  // ── Cross-backend transfer helpers ──────────────────────────────────────

  /**
   * Check whether source and destination are on different backend types
   * (one local, one SMB). Same-type transfers are handled natively by
   * each backend.
   */
  private isCrossBackendTransfer(sourceConnectionId: string, destConnectionId: string): boolean {
    return isLocalDrive(sourceConnectionId) !== isLocalDrive(destConnectionId);
  }

  /**
   * Download a file's raw bytes from any backend (companion or server).
   * Returns the data as a `Blob`.
   */
  private async downloadFileBlob(connectionId: string, path: string): Promise<Blob> {
    const baseUrl = getBaseUrl(connectionId);
    const segment = getBrowseSegment(connectionId);
    const url = `${baseUrl}/viewer/${segment}/download?path=${encodeURIComponent(path)}`;

    const headers: Record<string, string> = {};
    if (isLocalDrive(connectionId)) {
      Object.assign(headers, await this.buildCompanionHeaders());
    } else {
      const token = localStorage.getItem("access_token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}): ${response.statusText}`);
    }

    return response.blob();
  }

  /**
   * Upload a `Blob` to a destination path on any backend.
   *
   * Uses multipart form data with a single `file` field, matching both
   * the Python backend and the companion upload endpoints.
   */
  private async uploadFileBlob(connectionId: string, destPath: string, blob: Blob, filename: string): Promise<void> {
    const baseUrl = getBaseUrl(connectionId);
    const segment = getBrowseSegment(connectionId);
    const url = `${baseUrl}/browse/${segment}/upload?path=${encodeURIComponent(destPath)}`;

    const formData = new FormData();
    formData.append("file", blob, filename);

    const headers: Record<string, string> = {};
    if (isLocalDrive(connectionId)) {
      Object.assign(headers, await this.buildCompanionHeaders());
    } else {
      const token = localStorage.getItem("access_token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Upload failed (${response.status}): ${text}`);
    }
  }

  /**
   * Browser-mediated cross-backend copy.
   *
   * Downloads each file from the source backend and uploads it to the
   * destination backend. For directories, recursively lists the source
   * and processes all contained files.
   */
  private async crossBackendCopy(
    sourceConnectionId: string,
    sourcePath: string,
    destConnectionId: string,
    destPath: string,
    overwrite: boolean
  ): Promise<void> {
    // Determine whether the source is a file or directory
    const info = await this.getFileInfo(sourceConnectionId, sourcePath);

    if (info.type === FileType.FILE) {
      // Check for existing file on the destination before uploading
      if (!overwrite) {
        try {
          await this.getFileInfo(destConnectionId, destPath);
          // If we get here, the dest exists — throw a 409-like error
          throw Object.assign(new Error("Destination already exists"), {
            response: { status: 409, data: { detail: `Destination already exists: ${destPath}` } },
            isAxiosError: true,
          });
        } catch (e: unknown) {
          // 404 = dest doesn't exist, which is what we want
          const err = e as { response?: { status?: number } };
          if (err.response?.status !== 404) throw e;
        }
      }

      const blob = await this.downloadFileBlob(sourceConnectionId, sourcePath);
      const filename = sourcePath.split("/").pop() ?? sourcePath;
      await this.uploadFileBlob(destConnectionId, destPath, blob, filename);
    } else {
      // Directory — recursively process contents
      await this.crossBackendCopyDirectory(sourceConnectionId, sourcePath, destConnectionId, destPath, overwrite);
    }
  }

  /**
   * Recursively copy a directory across backends.
   *
   * Creates the target directory, then lists the source and processes
   * each child (files are downloaded/uploaded, subdirectories recurse).
   */
  private async crossBackendCopyDirectory(
    sourceConnectionId: string,
    sourceDirPath: string,
    destConnectionId: string,
    destDirPath: string,
    overwrite: boolean
  ): Promise<void> {
    // Create the destination directory
    const destDirName = destDirPath.split("/").pop() ?? destDirPath;
    const destParent = destDirPath.includes("/") ? destDirPath.substring(0, destDirPath.lastIndexOf("/")) : "";
    await this.createItem(destConnectionId, destParent, destDirName, "directory");

    // List the source directory
    const listing = await this.listDirectory(sourceConnectionId, sourceDirPath);

    for (const item of listing.items) {
      const childSourcePath = item.path;
      const childDestPath = destDirPath ? `${destDirPath}/${item.name}` : item.name;

      if (item.type === FileType.DIRECTORY) {
        await this.crossBackendCopyDirectory(sourceConnectionId, childSourcePath, destConnectionId, childDestPath, overwrite);
      } else {
        const blob = await this.downloadFileBlob(sourceConnectionId, childSourcePath);
        await this.uploadFileBlob(destConnectionId, childDestPath, blob, item.name);
      }
    }
  }

  // Viewer endpoints

  /**
   * Build a direct URL for viewing a file.
   *
   * For companion connections, embeds HMAC auth in query params since
   * these URLs may be used in `<img src>` / `<iframe>` where headers can't be set.
   * Async because companion HMAC computation uses the Web Crypto API.
   */
  async getViewUrl(connectionId: string, path: string): Promise<string> {
    const baseUrl = getBaseUrl(connectionId);
    const segment = getBrowseSegment(connectionId);
    if (isLocalDrive(connectionId)) {
      const authParams = await this.buildCompanionQueryAuth();
      return `${baseUrl}/viewer/${segment}/file?path=${encodeURIComponent(path)}&${authParams}`;
    }
    const token = localStorage.getItem("access_token");
    return `${baseUrl}/viewer/${segment}/file?path=${encodeURIComponent(path)}&token=${token}`;
  }

  async getDownloadUrl(connectionId: string, path: string): Promise<string> {
    const baseUrl = getBaseUrl(connectionId);
    const segment = getBrowseSegment(connectionId);
    if (isLocalDrive(connectionId)) {
      const authParams = await this.buildCompanionQueryAuth();
      return `${baseUrl}/viewer/${segment}/download?path=${encodeURIComponent(path)}&${authParams}`;
    }
    const token = localStorage.getItem("access_token");
    return `${baseUrl}/viewer/${segment}/download?path=${encodeURIComponent(path)}&token=${token}`;
  }

  async getFileBlob(connectionId: string, path: string, options: { signal?: AbortSignal } = {}): Promise<Blob> {
    try {
      const segment = getBrowseSegment(connectionId);
      const { client, extraConfig } = await this.getClientConfig(connectionId);
      const response = await client.get<ArrayBuffer>(`/viewer/${segment}/file`, {
        ...extraConfig,
        params: { path },
        responseType: "arraybuffer",
        signal: options.signal,
      });

      const contentType = response.headers["content-type"] ?? "application/octet-stream";
      const data = response.data instanceof ArrayBuffer ? response.data : new ArrayBuffer(0);
      return new Blob([data], { type: contentType });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (typeof error.response?.data === "string") {
          try {
            const json = JSON.parse(error.response.data);
            throw {
              ...error,
              response: {
                ...error.response,
                data: json,
              },
            };
          } catch {
            // Ignore parsing failures and continue to the ArrayBuffer branch.
          }
        }
      }

      if (axios.isAxiosError(error) && error.response?.data instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        const text = decoder.decode(error.response.data);
        try {
          const json = JSON.parse(text);
          const newError = {
            ...error,
            response: {
              ...error.response,
              data: json,
            },
          };
          throw newError;
        } catch (parseError) {
          if (parseError instanceof SyntaxError) {
            throw error;
          }
          throw parseError;
        }
      }

      throw error;
    }
  }

  async downloadFile(connectionId: string, path: string, filename: string): Promise<void> {
    const baseUrl = getBaseUrl(connectionId);
    const segment = getBrowseSegment(connectionId);
    const url = `${baseUrl}/viewer/${segment}/download?path=${encodeURIComponent(path)}`;

    const headers: Record<string, string> = {};
    if (isLocalDrive(connectionId)) {
      const companionHeaders = await this.buildCompanionHeaders();
      Object.assign(headers, companionHeaders);
    } else {
      const token = localStorage.getItem("access_token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });

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
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.get(`/viewer/${segment}/file`, {
      ...extraConfig,
      params: { path },
      responseType: "text",
    });
    return response.data;
  }

  async saveTextFile(
    connectionId: string,
    path: string,
    content: string,
    options: { filename?: string; mimeType?: string } = {}
  ): Promise<void> {
    const filename = options.filename ?? path.split("/").pop() ?? path;
    const mimeType = options.mimeType ?? "text/plain;charset=utf-8";
    const blob = new Blob([content], { type: mimeType });
    await this.uploadFileBlob(connectionId, path, blob, filename);
  }

  async acquireEditLock(connectionId: string, path: string, sessionId: string): Promise<EditLockInfo> {
    this.assertEditLocksSupported(connectionId);

    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.post<EditLockInfo>(
      `/companion/${segment}/lock`,
      {
        companion_session: sessionId,
      },
      {
        ...extraConfig,
        params: { path },
      }
    );

    return response.data;
  }

  async heartbeatEditLock(connectionId: string, path: string): Promise<void> {
    this.assertEditLocksSupported(connectionId);

    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    await client.post(`/companion/${segment}/lock/heartbeat`, undefined, {
      ...extraConfig,
      params: { path },
    });
  }

  async releaseEditLock(connectionId: string, path: string): Promise<void> {
    this.assertEditLocksSupported(connectionId);

    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    await client.delete(`/companion/${segment}/lock`, {
      ...extraConfig,
      params: { path },
    });
  }

  async getEditLockStatus(connectionId: string, path: string): Promise<EditLockStatus> {
    if (isLocalDrive(connectionId)) {
      return { locked: false };
    }

    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.get<EditLockStatus>(`/companion/${segment}/lock-status`, {
      ...extraConfig,
      params: { path },
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

      const segment = getBrowseSegment(connectionId);
      const { client, extraConfig } = await this.getClientConfig(connectionId);

      // Companion serves raw files without resizing (no pyvips)
      if (isLocalDrive(connectionId)) {
        delete params["viewport_width"];
        delete params["viewport_height"];
        delete params["no_resizing"];
      }

      const response = await client.get<ArrayBuffer>(`/viewer/${segment}/file`, {
        ...extraConfig,
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
      const segment = getBrowseSegment(connectionId);
      const { client, extraConfig } = await this.getClientConfig(connectionId);
      const response = await client.get<ArrayBuffer>(`/viewer/${segment}/file`, {
        ...extraConfig,
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
   * Open a local-drive file directly with the system default application.
   *
   * This is a companion-only operation (Phase 3a "direct local open"):
   * no download, no edit lock, no upload — the file is already on disk.
   */
  async openLocalFile(connectionId: string, path: string): Promise<void> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    await client.post(`/browse/${segment}/open`, { path }, extraConfig);
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
export { LOCAL_DRIVE_EDIT_LOCKS_UNSUPPORTED_MESSAGE };

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
