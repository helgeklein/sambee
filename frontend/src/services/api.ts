import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";
import type {
  AboutSettings,
  AdminUser,
  AdminUserCreateInput,
  AdminUserCreateResult,
  AdminUserListQuery,
  AdminUserListResponse,
  AdminUserPasswordResetInput,
  AdminUserPasswordResetResult,
  AdminUserUpdateInput,
  AdvancedSystemSettings,
  AdvancedSystemSettingsUpdate,
  ArchiveDirectoryListing,
  ArchiveOperation,
  ArchiveOperationPhase,
  ArchiveOperationPrepare,
  AuthenticationMode,
  AuthenticationModeActivationResponse,
  AuthToken,
  CompanionDownloadMetadata,
  Connection,
  ConnectionCreate,
  ConnectionVisibilityOption,
  CurrentAccount,
  CurrentUserSettings,
  CurrentUserSettingsUpdate,
  DirectoryListing,
  DirectorySearchResult,
  EditLockInfo,
  EditLockStatus,
  FileInfo,
  FileSearchSettingsRead,
  FileSearchSettingsUpdate,
  LocalActivationResolution,
  LocalLinkTargetListing,
  NetworkSettings,
  NetworkSettingsUpdate,
  OidcAdminConfigurationRead,
  OidcBrowserSessionList,
  OidcBrowserSessionRevokeResult,
  OidcConfigurationCandidate,
  OidcFinalizeResponse,
  OidcMappingMutationResponse,
  OidcReviewedPolicy,
  OidcTestedIdentity,
  OidcTestStartResponse,
  PublicSupportReport,
  RecentDirectory,
  RecentDirectorySearchResponse,
  RecentFile,
  RecentFileSearchResponse,
  SmbSettings,
  SmbSettingsUpdate,
  User,
} from "../types";
import { FileType } from "../types";
import { AuthSessionError, authSession } from "./authSession";
import {
  getBackendAvailabilitySnapshot,
  isBackendConnectivityError,
  isLocalAbortError,
  markBackendAvailable,
  markBackendReconnecting,
  markBackendUnavailable,
} from "./backendAvailability";
import { getBaseUrl, getBrowseSegment, isLocalDrive } from "./backendRouter";
import { clearBrowserRecoverySnapshot } from "./browserRecoverySnapshot";
import { COMPANION_BASE_URL } from "./companion";
import { snapshotRegisteredDrafts } from "./draftRecovery";
import { logger } from "./logger";

export interface DirectorySearchOptions {
  includeDotDirectories?: boolean;
  signal?: AbortSignal;
}

const CONNECTIONS_API_BASE = "/connections";
const API_PATH_SUFFIX = "/api";
const LOCAL_DRIVE_EDIT_LOCKS_UNSUPPORTED_MESSAGE = "Edit locks are not supported for local drives";
const DIRECTORY_LIST_REQUEST_TIMEOUT_MS = 40_000;
const LOCAL_LINK_TARGET_REQUEST_TIMEOUT_MS = 15_000;
export const PDF_VIEWER_REQUEST_TIMEOUT_MS = 90_000;
export const OIDC_FINALIZATION_REQUEST_TIMEOUT_MS = 15_000;

let controlledReauthenticationInProgress = false;

export function isControlledReauthenticationInProgress(): boolean {
  return controlledReauthenticationInProgress;
}

function isPublicAuthRequest(url: string): boolean {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    return pathname.endsWith("/auth/token") || pathname.endsWith("/auth/oidc/exchange");
  } catch {
    return false;
  }
}

export function startControlledReauthentication(): void {
  controlledReauthenticationInProgress = true;
  clearBrowserRecoverySnapshot();
  snapshotRegisteredDrafts();
  if (window.location.pathname !== "/login") {
    window.location.assign(`/login?return_path=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
}

function isConfirmedOidcReauthentication(error: AxiosError): boolean {
  const data = error.response?.data as { detail?: { code?: string } } | undefined;
  return data?.detail?.code === "oidc_reauthentication_required";
}

function isViewerBlobRequest(config: AxiosError["config"] | undefined): boolean {
  const method = config?.method?.toLowerCase();
  if (method && method !== "get") {
    return false;
  }

  const rawUrl = config?.url;
  if (!rawUrl) {
    return false;
  }

  try {
    const resolvedUrl = new URL(rawUrl, window.location.origin);
    return /^\/api\/viewer\/[^/]+\/file$/.test(resolvedUrl.pathname) || /^\/viewer\/[^/]+\/file$/.test(resolvedUrl.pathname);
  } catch {
    return false;
  }
}

function normalizeUser(user: User): User {
  return { ...user };
}

function getResponseContentType(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function getCompanionServerUrl(apiBaseUrl: string | undefined): string {
  if (!apiBaseUrl || apiBaseUrl === API_PATH_SUFFIX) {
    return window.location.origin;
  }

  const resolvedUrl = new URL(apiBaseUrl, window.location.origin);
  const normalizedPath = resolvedUrl.pathname.replace(/\/+$/, "");

  if (normalizedPath === API_PATH_SUFFIX) {
    resolvedUrl.pathname = "";
  } else if (normalizedPath.endsWith(API_PATH_SUFFIX)) {
    resolvedUrl.pathname = normalizedPath.slice(0, -API_PATH_SUFFIX.length) || "/";
  }

  resolvedUrl.search = "";
  resolvedUrl.hash = "";

  return resolvedUrl.toString().replace(/\/$/, "");
}

class ApiService {
  private api: AxiosInstance;
  /** Separate axios instance for companion requests (no Bearer interceptor). */
  private companionApi: AxiosInstance;

  constructor() {
    // Use absolute URL for tests (required by MSW), relative for production
    const baseURL = import.meta.env.VITE_API_URL || (import.meta.env.MODE === "test" ? "http://localhost:3000/api" : "/api");
    this.api = axios.create({
      baseURL,
    });

    // Add auth token to requests
    this.api.interceptors.request.use(
      async (config) => {
        const url = config.url ?? "";
        const publicAuthRequest = isPublicAuthRequest(url);
        if (!publicAuthRequest) {
          try {
            await authSession.refreshIfNeeded();
          } catch (error) {
            if (error instanceof AuthSessionError && error.code === "reauthentication-required") {
              startControlledReauthentication();
              return Promise.reject(error);
            }
            if (!(error instanceof AuthSessionError)) {
              return Promise.reject(error);
            }
          }
        }
        const token = authSession.getAccessToken();
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
        const backendSnapshot = getBackendAvailabilitySnapshot();
        const viewerBlobRequest = isViewerBlobRequest(error.config);
        const suppressViewerBlobErrorLog = viewerBlobRequest && isBackendConnectivityError(error);

        if (axios.isCancel(error) || error.code === "ERR_CANCELED" || isLocalAbortError(error)) {
          return Promise.reject(error);
        }

        if (!viewerBlobRequest && isBackendConnectivityError(error)) {
          if (backendSnapshot.status === "unavailable") {
            markBackendUnavailable(error.message);
          } else {
            markBackendReconnecting(error.message);
          }
        } else if (!viewerBlobRequest && error.response?.status) {
          if (error.response.status === 401 && backendSnapshot.recoveryLock) {
            markBackendReconnecting("Authenticated backend session is not ready yet.");
          } else {
            markBackendAvailable();
          }
        }

        const requestId = logger.extractRequestId(error.response?.headers as Record<string, string>);

        // Log the error with context
        if (!suppressViewerBlobErrorLog) {
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
          );
        }
        if (error.response?.status === 401) {
          const confirmedOidcReauthentication = isConfirmedOidcReauthentication(error);
          if (backendSnapshot.recoveryLock && !confirmedOidcReauthentication) {
            logger.warn(
              "Suppressing logout redirect during backend recovery",
              {
                url: error.config?.url,
                requestId,
              },
              "api"
            );
            return Promise.reject(error);
          }

          const config = error.config as (AxiosRequestConfig & { _oidcRetried?: boolean }) | undefined;
          const method = config?.method?.toLowerCase();
          const safeMethod = method === "get" || method === "head" || method === "options";
          const url = config?.url ?? "";
          const publicAuthRequest = isPublicAuthRequest(url);
          if (!publicAuthRequest && confirmedOidcReauthentication) {
            startControlledReauthentication();
            return Promise.reject(error);
          }
          if (safeMethod && !publicAuthRequest && config !== undefined && !config._oidcRetried) {
            const retryConfig = config;
            return authSession.requestRefresh().then(
              () => {
                retryConfig._oidcRetried = true;
                return this.api.request(retryConfig);
              },
              (refreshError: unknown) => {
                if (
                  refreshError instanceof AuthSessionError &&
                  (refreshError.code === "transient" || (refreshError.code === "refresh-uncertain" && authSession.hasUsableAccessToken()))
                ) {
                  return Promise.reject(error);
                }
                startControlledReauthentication();
                return Promise.reject(error);
              }
            );
          }
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
    authSession.setAuthenticated(response.data, false);

    logger.info(
      "Login successful",
      {
        username: response.data.username,
        hasToken: !!response.data.access_token,
        isAdmin: response.data.role === "admin",
      },
      "api"
    );
    return response.data;
  }

  async exchangeOidcGrant(grant: string): Promise<AuthToken> {
    const response = await this.api.post<AuthToken>("/auth/oidc/exchange", { grant });
    authSession.setAuthenticated(response.data, true);
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    logger.debug("Fetching current user info", {}, "api");
    const response = await this.api.get<User>("/auth/me");
    return normalizeUser(response.data);
  }

  async getCurrentAccount(): Promise<CurrentAccount> {
    const response = await this.api.get<CurrentAccount>("/auth/account");
    return normalizeUser(response.data) as CurrentAccount;
  }

  async getOidcBrowserSessions(): Promise<OidcBrowserSessionList> {
    const response = await this.api.get<OidcBrowserSessionList>("/auth/oidc/sessions");
    return response.data;
  }

  async revokeOidcBrowserSession(sessionId: string): Promise<OidcBrowserSessionRevokeResult> {
    const response = await this.api.post<OidcBrowserSessionRevokeResult>(`/auth/oidc/sessions/${sessionId}/revoke`);
    return response.data;
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

  async testConnection(connectionId: string, connection?: Partial<ConnectionCreate>): Promise<{ status: string; message: string }> {
    const response = connection
      ? await this.api.post(`${CONNECTIONS_API_BASE}/${connectionId}/test`, connection)
      : await this.api.post(`${CONNECTIONS_API_BASE}/${connectionId}/test`);
    return response.data;
  }

  async testConnectionConfig(connection: ConnectionCreate): Promise<{ status: string; message: string }> {
    const response = await this.api.post(`${CONNECTIONS_API_BASE}/test-config`, connection);
    return response.data;
  }

  async getUsers(query: AdminUserListQuery = {}): Promise<AdminUserListResponse> {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    for (const role of query.roles ?? []) params.append("role", role);
    for (const state of query.states ?? []) params.append("state", state);
    for (const authentication of query.authentication ?? []) params.append("auth", authentication);
    for (const oidcState of query.oidcStates ?? []) params.append("oidc_state", oidcState);
    for (const roleSource of query.roleSources ?? []) params.append("role_source", roleSource);
    if (query.expiration) params.set("expiration", query.expiration);
    if (query.sort) params.set("sort", query.sort);
    if (query.direction) params.set("direction", query.direction);
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("page_size", String(query.pageSize));

    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const response = await this.api.get<AdminUserListResponse>(`/admin/users${suffix}`);
    return response.data;
  }

  async getOidcConfiguration(): Promise<OidcAdminConfigurationRead> {
    const response = await this.api.get<OidcAdminConfigurationRead>("/admin/auth/oidc");
    return response.data;
  }

  async startOidcTest(candidate: OidcConfigurationCandidate): Promise<OidcTestStartResponse> {
    const response = await this.api.post<OidcTestStartResponse>("/admin/auth/oidc/test", candidate);
    return response.data;
  }

  async getOidcTestResult(flowId: string, reviewedPolicy?: OidcReviewedPolicy): Promise<OidcTestedIdentity> {
    const response = await this.api.post<OidcTestedIdentity>(`/admin/auth/oidc/test-flows/${flowId}/preview`, {
      reviewed_policy: reviewedPolicy,
    });
    return response.data;
  }

  async cancelOidcTestFlow(flowId: string): Promise<void> {
    await this.api.delete(`/admin/auth/oidc/test-flows/${flowId}`);
  }

  async finalizeOidcConfiguration(
    flowId: string,
    reviewedPolicy: OidcReviewedPolicy,
    replacementMappings: Array<{ target_user_id: string; expected_username: string }>,
    expectedIdentityMappingRevision: number | null,
    omittedAccountAcknowledgements: string[]
  ): Promise<OidcFinalizeResponse> {
    const response = await this.api.post<OidcFinalizeResponse>(
      "/admin/auth/oidc/finalize",
      {
        flow_id: flowId,
        reviewed_policy: reviewedPolicy,
        replacement_mappings: replacementMappings,
        expected_identity_mapping_revision: expectedIdentityMappingRevision,
        omitted_account_acknowledgements: omittedAccountAcknowledgements,
      },
      {
        timeout: OIDC_FINALIZATION_REQUEST_TIMEOUT_MS,
      }
    );
    return response.data;
  }

  async setPasswordOnlyAuthentication(
    expectedConfigurationRevision: number,
    expectedActivePasswordlessUserCount: number,
    acknowledgePasswordlessAccountLoss: boolean
  ): Promise<OidcFinalizeResponse> {
    const response = await this.api.post<OidcFinalizeResponse>("/admin/auth/password-only", {
      expected_configuration_revision: expectedConfigurationRevision,
      expected_active_passwordless_user_count: expectedActivePasswordlessUserCount,
      acknowledge_passwordless_account_loss: acknowledgePasswordlessAccountLoss,
    });
    return response.data;
  }

  async activateAuthenticationMode(
    mode: Exclude<AuthenticationMode, "oidc_or_password" | "oidc_only">,
    acknowledgeNoAuthentication = false
  ): Promise<AuthenticationModeActivationResponse> {
    const response = await this.api.post<AuthenticationModeActivationResponse>("/admin/auth/mode", {
      mode,
      acknowledge_no_authentication: acknowledgeNoAuthentication,
    });
    return response.data;
  }

  async putPendingOidcMappings(
    expectedIdentityMappingRevision: number,
    mappings: Array<{ target_user_id: string; expected_username: string }>
  ): Promise<OidcMappingMutationResponse> {
    const response = await this.api.put<OidcMappingMutationResponse>("/admin/auth/oidc/mappings/pending", {
      expected_identity_mapping_revision: expectedIdentityMappingRevision,
      mappings,
    });
    return response.data;
  }

  async cancelPendingOidcMapping(userId: string, expectedIdentityMappingRevision: number): Promise<OidcMappingMutationResponse> {
    const response = await this.api.delete<OidcMappingMutationResponse>(`/admin/auth/oidc/mappings/${userId}/pending`, {
      params: { expected_identity_mapping_revision: expectedIdentityMappingRevision },
    });
    return response.data;
  }

  async changeOidcIdentity(
    userId: string,
    expectedIdentityMappingRevision: number,
    expectedUsername: string
  ): Promise<OidcMappingMutationResponse> {
    const response = await this.api.post<OidcMappingMutationResponse>(`/admin/auth/oidc/mappings/${userId}/change`, {
      expected_identity_mapping_revision: expectedIdentityMappingRevision,
      expected_username: expectedUsername,
    });
    return response.data;
  }

  async moveOidcIdentity(
    identityId: string,
    expectedIdentityMappingRevision: number,
    targetUserId: string
  ): Promise<OidcMappingMutationResponse> {
    const response = await this.api.post<OidcMappingMutationResponse>(`/admin/auth/oidc/mappings/${identityId}/move`, {
      expected_identity_mapping_revision: expectedIdentityMappingRevision,
      target_user_id: targetUserId,
    });
    return response.data;
  }

  async detachOidcIdentity(userId: string, expectedIdentityMappingRevision: number): Promise<OidcMappingMutationResponse> {
    const response = await this.api.delete<OidcMappingMutationResponse>(`/admin/auth/oidc/mappings/${userId}`, {
      params: { expected_identity_mapping_revision: expectedIdentityMappingRevision },
    });
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

  async resetUserPassword(userId: string, payload: AdminUserPasswordResetInput): Promise<AdminUserPasswordResetResult> {
    const response = await this.api.post<AdminUserPasswordResetResult>(`/admin/users/${userId}/reset-password`, payload);
    return response.data;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.api.delete(`/admin/users/${userId}`);
  }

  async getAdvancedSettings(): Promise<AdvancedSystemSettings> {
    const response = await this.api.get<AdvancedSystemSettings>("/admin/settings/advanced");
    return response.data;
  }

  async getAboutSettings(): Promise<AboutSettings> {
    const response = await this.api.get<AboutSettings>("/admin/settings/about");
    return response.data;
  }

  async getPublicSupportReport(): Promise<PublicSupportReport> {
    const response = await this.api.get<PublicSupportReport>("/admin/settings/support-report");
    return response.data;
  }

  async getCompanionDownloads(): Promise<CompanionDownloadMetadata> {
    const response = await this.api.get<CompanionDownloadMetadata>("/companion/downloads");
    return response.data;
  }

  async updateAdvancedSettings(payload: AdvancedSystemSettingsUpdate): Promise<AdvancedSystemSettings> {
    const response = await this.api.put<AdvancedSystemSettings>("/admin/settings/advanced", payload);
    return response.data;
  }

  async getFileSearchSettings(): Promise<FileSearchSettingsRead> {
    const response = await this.api.get<FileSearchSettingsRead>("/admin/settings/file-search");
    return response.data;
  }

  async updateFileSearchSettings(payload: FileSearchSettingsUpdate): Promise<FileSearchSettingsRead> {
    const response = await this.api.put<FileSearchSettingsRead>("/admin/settings/file-search", payload);
    return response.data;
  }

  // Recent-file history is server-owned metadata, including for local-drive files.
  async recordRecentFile(connectionId: string, path: string): Promise<RecentFile | null> {
    const response = await this.api.post<RecentFile | null>("/browse/recent-files", {
      connection_id: connectionId,
      path,
      is_regular_file: true,
    });
    return response.data;
  }

  async searchRecentFiles(query: string, limit: number, signal?: AbortSignal): Promise<RecentFileSearchResponse> {
    const response = await this.api.get<RecentFileSearchResponse>("/browse/recent-files", {
      params: { q: query, limit },
      signal,
    });
    return response.data;
  }

  async validateRecentFileTarget(recordId: string): Promise<FileInfo> {
    const response = await this.api.get<FileInfo>(`/browse/recent-files/${recordId}/target`);
    return response.data;
  }

  async removeRecentFile(recordId: string): Promise<void> {
    await this.api.delete(`/browse/recent-files/${recordId}`);
  }

  async clearRecentFiles(): Promise<number> {
    const response = await this.api.delete<{ deleted_count: number }>("/browse/recent-files");
    return response.data.deleted_count;
  }

  async recordRecentDirectory(connectionId: string, path: string): Promise<RecentDirectory> {
    const response = await this.api.post<RecentDirectory>("/browse/recent-directories", {
      connection_id: connectionId,
      path,
      is_directory: true,
    });
    return response.data;
  }

  async searchRecentDirectories(query: string, limit: number, signal?: AbortSignal): Promise<RecentDirectorySearchResponse> {
    const response = await this.api.get<RecentDirectorySearchResponse>("/browse/recent-directories", {
      params: { q: query, limit },
      signal,
    });
    return response.data;
  }

  async removeRecentDirectory(recordId: string): Promise<void> {
    await this.api.delete(`/browse/recent-directories/${recordId}`);
  }

  async clearRecentDirectories(): Promise<number> {
    const response = await this.api.delete<{ deleted_count: number }>("/browse/recent-directories");
    return response.data.deleted_count;
  }

  async getSmbSettings(): Promise<SmbSettings> {
    const response = await this.api.get<SmbSettings>("/admin/settings/smb");
    return response.data;
  }

  async updateSmbSettings(payload: SmbSettingsUpdate): Promise<SmbSettings> {
    const response = await this.api.put<SmbSettings>("/admin/settings/smb", payload);
    return response.data;
  }

  async getNetworkSettings(): Promise<NetworkSettings> {
    const response = await this.api.get<NetworkSettings>("/admin/settings/network");
    return response.data;
  }

  async updateNetworkSettings(payload: NetworkSettingsUpdate): Promise<NetworkSettings> {
    const response = await this.api.put<NetworkSettings>("/admin/settings/network", payload);
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

  async listArchiveDirectory(
    connectionId: string,
    archivePath: string,
    virtualPath = "",
    options?: { cursor?: string; pageSize?: number; signal?: AbortSignal }
  ): Promise<ArchiveDirectoryListing> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.get<ArchiveDirectoryListing>(`/browse/${segment}/archive/list`, {
      ...extraConfig,
      params: {
        archive_path: archivePath,
        virtual_path: virtualPath,
        cursor: options?.cursor,
        page_size: options?.pageSize,
      },
      signal: options?.signal,
    });
    return response.data;
  }

  async getArchiveMember(
    connectionId: string,
    archivePath: string,
    memberPath: string,
    download = false
  ): Promise<Blob> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.get<Blob>(`/viewer/${segment}/archive/member`, {
      ...extraConfig,
      params: { archive_path: archivePath, member_path: memberPath, download },
      responseType: "blob",
    });
    return response.data;
  }

  async prepareArchiveOperation(payload: ArchiveOperationPrepare): Promise<ArchiveOperation> {
    const response = await this.api.post<ArchiveOperation>("/archive/operations", payload);
    return response.data;
  }

  async getArchiveOperation(operationId: string): Promise<ArchiveOperation> {
    const response = await this.api.get<ArchiveOperation>(`/archive/operations/${operationId}`);
    return response.data;
  }

  async transitionArchiveOperation(
    operationId: string,
    expectedPhase: ArchiveOperationPhase,
    nextPhase: ArchiveOperationPhase
  ): Promise<ArchiveOperation> {
    const response = await this.api.post<ArchiveOperation>(`/archive/operations/${operationId}/phase`, {
      expected_phase: expectedPhase,
      next_phase: nextPhase,
    });
    return response.data;
  }

  async executeArchiveCreation(operationId: string): Promise<ArchiveOperation> {
    const response = await this.api.post<ArchiveOperation>(`/archive/operations/${operationId}/execute-create`);
    return response.data;
  }

  async executeArchiveExtraction(operationId: string): Promise<ArchiveOperation> {
    const response = await this.api.post<ArchiveOperation>(`/archive/operations/${operationId}/execute-extract`);
    return response.data;
  }

  async cancelArchiveOperation(operationId: string): Promise<ArchiveOperation> {
    const response = await this.api.post<ArchiveOperation>(`/archive/operations/${operationId}/cancel`);
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

  /** Resolve a local entry to its canonical drive-relative activation target. */
  async resolveLocalActivation(connectionId: string, path: string): Promise<LocalActivationResolution> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.get<LocalActivationResolution>(`/browse/${segment}/resolve-activation`, {
      ...extraConfig,
      params: { path },
    });
    return response.data;
  }

  /** Resolve display-safe target metadata for link sources in a local directory. */
  async listLocalLinkTargets(connectionId: string, path: string, options?: { signal?: AbortSignal }): Promise<LocalLinkTargetListing> {
    if (!isLocalDrive(connectionId)) {
      throw new Error("Link target metadata is only available for local drives");
    }

    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.get<LocalLinkTargetListing>(`/browse/${segment}/link-targets`, {
      ...extraConfig,
      params: { path },
      timeout: LOCAL_LINK_TARGET_REQUEST_TIMEOUT_MS,
      ...(options?.signal ? { signal: options.signal } : {}),
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
      const token = authSession.getAccessToken();
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
      const token = authSession.getAccessToken();
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
    return `${baseUrl}/viewer/${segment}/file?path=${encodeURIComponent(path)}`;
  }

  async getDownloadUrl(connectionId: string, path: string): Promise<string> {
    const baseUrl = getBaseUrl(connectionId);
    const segment = getBrowseSegment(connectionId);
    if (isLocalDrive(connectionId)) {
      const authParams = await this.buildCompanionQueryAuth();
      return `${baseUrl}/viewer/${segment}/download?path=${encodeURIComponent(path)}&${authParams}`;
    }
    return `${baseUrl}/viewer/${segment}/download?path=${encodeURIComponent(path)}`;
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

      const contentType = getResponseContentType(response.headers["content-type"], "application/octet-stream");
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
      const token = authSession.getAccessToken();
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

  async acquireEditLock(connectionId: string, path: string, _sessionId?: string): Promise<EditLockInfo> {
    this.assertEditLocksSupported(connectionId);

    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.post<EditLockInfo>(`/browse/${segment}/lock`, undefined, {
      ...extraConfig,
      params: { path },
    });

    return response.data;
  }

  async heartbeatEditLock(connectionId: string, path: string, lockInfo: EditLockInfo): Promise<void> {
    this.assertEditLocksSupported(connectionId);

    if (!lockInfo.operation_id || !lockInfo.lock_capability) {
      throw new Error("Edit lock context is incomplete");
    }

    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    await client.post(
      `/browse/${segment}/lock/heartbeat`,
      {
        operation_id: lockInfo.operation_id,
        lock_id: lockInfo.lock_id,
        lock_capability: lockInfo.lock_capability,
      },
      {
        ...extraConfig,
        params: { path },
      }
    );
  }

  async releaseEditLock(connectionId: string, path: string, lockInfo: EditLockInfo): Promise<void> {
    this.assertEditLocksSupported(connectionId);

    if (!lockInfo.operation_id || !lockInfo.lock_capability) {
      throw new Error("Edit lock context is incomplete");
    }

    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    await client.delete(`/browse/${segment}/lock`, {
      ...extraConfig,
      params: { path },
      data: {
        operation_id: lockInfo.operation_id,
        lock_id: lockInfo.lock_id,
        lock_capability: lockInfo.lock_capability,
      },
    });
  }

  async getEditLockStatus(connectionId: string, path: string): Promise<EditLockStatus> {
    if (isLocalDrive(connectionId)) {
      return { locked: false };
    }

    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    const response = await client.get<EditLockStatus>(`/browse/${segment}/lock-status`, {
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

      const contentType = getResponseContentType(response.headers["content-type"], "application/octet-stream");
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
  async getPdfBlob(
    connectionId: string,
    path: string,
    options: {
      signal?: AbortSignal;
      pdfVariant?: "normalized";
      screenProfile?: { width: number; height: number; zoomPercent: number };
    } = {}
  ): Promise<Blob> {
    try {
      const segment = getBrowseSegment(connectionId);
      const { client, extraConfig } = await this.getClientConfig(connectionId);
      const response = await client.get<ArrayBuffer>(`/viewer/${segment}/file`, {
        ...extraConfig,
        params: {
          path,
          ...(options.pdfVariant ? { pdf_variant: options.pdfVariant } : {}),
          ...(options.screenProfile
            ? {
                screen_width: options.screenProfile.width,
                screen_height: options.screenProfile.height,
                screen_zoom_percent: options.screenProfile.zoomPercent,
              }
            : {}),
        },
        responseType: "arraybuffer",
        signal: options.signal,
        timeout: PDF_VIEWER_REQUEST_TIMEOUT_MS,
      });

      const contentType = getResponseContentType(response.headers["content-type"], "application/pdf");
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

  async invalidatePdfDerivative(
    connectionId: string,
    path: string,
    screenProfile?: { width: number; height: number; zoomPercent: number }
  ): Promise<void> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    await client.delete(`/viewer/${segment}/pdf-derivative`, {
      ...extraConfig,
      params: {
        path,
        ...(screenProfile
          ? {
              screen_width: screenProfile.width,
              screen_height: screenProfile.height,
              screen_zoom_percent: screenProfile.zoomPercent,
            }
          : {}),
      },
    });
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
  async getCompanionUri(connectionId: string, path: string, themeJson?: string, options?: { forcePicker?: boolean }): Promise<string> {
    const response = await this.api.post<{ uri_token: string; expires_in: number }>("/companion/uri-token", {
      connection_id: connectionId,
      path,
    });

    const { uri_token } = response.data;
    const serverUrl = encodeURIComponent(getCompanionServerUrl(this.api.defaults.baseURL));
    const encodedPath = encodeURIComponent(path);

    let uri = `sambee://open?server=${serverUrl}&token=${uri_token}&connId=${connectionId}&path=${encodedPath}`;

    if (themeJson) {
      uri += `&theme=${btoa(themeJson)}`;
    }

    if (options?.forcePicker) {
      uri += "&forcePicker=1";
    }

    return uri;
  }

  /**
   * Open a local-drive file directly with the system default application.
   *
   * This is a companion-only operation (Phase 3a "direct local open"):
   * no download, no edit lock, no upload — the file is already on disk.
   */
  async openLocalFile(connectionId: string, path: string, options?: { forcePicker?: boolean }): Promise<void> {
    const segment = getBrowseSegment(connectionId);
    const { client, extraConfig } = await this.getClientConfig(connectionId);
    await client.post(`/browse/${segment}/open`, { path, force_picker: options?.forcePicker ?? false }, extraConfig);
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
    const baseURL = this.api.defaults.baseURL || "/api";
    return `${baseURL}/logs/download/${encodeURIComponent(filename)}`;
  }
}

export const apiService = new ApiService();
export default apiService;
export { LOCAL_DRIVE_EDIT_LOCKS_UNSUPPORTED_MESSAGE };

// Export convenience functions
export const login = (username: string, password: string) => apiService.login(username, password);
export const exchangeOidcGrant = (grant: string) => apiService.exchangeOidcGrant(grant);

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
