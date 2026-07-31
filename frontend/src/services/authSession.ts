import axios, { type AxiosError } from "axios";
import type { AuthToken } from "../types";

export type AuthSessionState =
  | "idle"
  | "active"
  | "refreshing"
  | "transiently-unavailable"
  | "reauthentication-required"
  | "refresh-uncertain";

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.MODE === "test" ? "http://localhost:3000/api" : "/api");
const REFRESH_SAFETY_MARGIN_MS = 5 * 60_000;
const REFRESH_JITTER_RATIO = 0.05;
const REFRESH_RETRY_DELAY_MS = 30_000;
const MAX_REFRESH_DELAY_MS = 2_147_483_647;

export class AuthSessionError extends Error {
  constructor(
    readonly code: "unauthenticated" | "reauthentication-required" | "refresh-uncertain" | "transient",
    message: string
  ) {
    super(message);
  }
}

export class AuthSessionManager {
  private accessToken: string | null = null;
  private expiresAt: number | null = null;
  private renewable = false;
  private userId: string | null = null;
  private refreshPromise: Promise<AuthToken> | null = null;
  private refreshTimer: number | null = null;
  private state: AuthSessionState = "idle";
  private bootstrapPromise: Promise<AuthSessionState> | null = null;
  private bootstrapComplete = false;
  private refreshAt: number | null = null;
  private refreshGeneration: number | null = null;
  private readonly refreshChannel: BroadcastChannel | null;
  private readonly refreshClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true });

  constructor() {
    this.refreshChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("sambee-oidc-refresh");
    this.refreshChannel?.addEventListener("message", this.handleRefreshMessage);
    window.addEventListener("visibilitychange", this.refreshAfterReturn);
    window.addEventListener("focus", this.refreshAfterReturn);
    window.addEventListener("online", this.refreshAfterReturn);
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getState(): AuthSessionState {
    return this.state;
  }

  getUserId(): string | null {
    return this.userId;
  }

  isBootstrapComplete(): boolean {
    return this.bootstrapComplete;
  }

  hasUsableAccessToken(): boolean {
    return this.accessToken !== null && (this.expiresAt === null || this.expiresAt > Date.now());
  }

  setAuthenticated(response: AuthToken, renewable: boolean): void {
    this.accessToken = response.access_token;
    this.renewable = renewable;
    this.userId = response.user_id ?? null;
    this.expiresAt = response.access_token_expires_at ? Date.parse(response.access_token_expires_at) : null;
    this.refreshGeneration = response.oidc_refresh_generation ?? this.refreshGeneration;
    this.refreshAt = this.expiresAt === null ? null : Date.now() + Math.max(0, (this.expiresAt - Date.now()) / 2);
    this.state = "active";
    this.scheduleRefresh();
  }

  clear(): void {
    this.accessToken = null;
    this.expiresAt = null;
    this.renewable = false;
    this.userId = null;
    this.refreshAt = null;
    this.refreshGeneration = null;
    this.state = "idle";
    this.clearRefreshTimer();
  }

  async bootstrap(): Promise<AuthSessionState> {
    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }
    this.bootstrapPromise = (async () => {
      if (!this.accessToken) {
        try {
          await this.requestRefresh();
        } catch {
          // A bootstrap attempt must settle before protected routes make decisions.
        }
      }
      this.bootstrapComplete = true;
      return this.state;
    })();
    return this.bootstrapPromise;
  }

  async requestRefresh(): Promise<AuthToken> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async refreshIfNeeded(): Promise<void> {
    if (!this.renewable || this.expiresAt === null || this.state === "refresh-uncertain") {
      return;
    }
    if (this.expiresAt - Date.now() <= REFRESH_SAFETY_MARGIN_MS) {
      await this.requestRefresh();
    }
  }

  async logout(): Promise<void> {
    try {
      await this.refreshClient.post("/auth/oidc/logout");
    } catch {
      // The local state must still be cleared if the server session already expired.
    } finally {
      this.clear();
    }
  }

  private async performRefresh(): Promise<AuthToken> {
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      return navigator.locks.request("sambee-oidc-refresh", { mode: "exclusive" }, () => this.performRefreshRequest());
    }
    return this.performRefreshRequest();
  }

  private async performRefreshRequest(): Promise<AuthToken> {
    this.state = "refreshing";
    try {
      const response = await this.refreshClient.post<AuthToken>("/auth/oidc/refresh", undefined, {
        headers: this.refreshGeneration === null ? undefined : { "X-Sambee-OIDC-Refresh-Generation": this.refreshGeneration.toString() },
      });
      this.setAuthenticated(response.data, true);
      this.refreshChannel?.postMessage({ type: "completed", generation: this.refreshGeneration });
      return response.data;
    } catch (error) {
      const response = (error as AxiosError<{ detail?: { code?: string } }>).response;
      const code = response?.data?.detail?.code;
      if (response?.status === 401 && code === "oidc_refresh_uncertain") {
        this.state = "refresh-uncertain";
        throw new AuthSessionError("refresh-uncertain", "The OIDC refresh result is uncertain.");
      }
      if (response?.status === 401) {
        this.clear();
        this.state = "reauthentication-required";
        throw new AuthSessionError("reauthentication-required", "OIDC sign-in is required.");
      }
      if (!response || response.status === 429 || response.status >= 500) {
        this.state = "transiently-unavailable";
        this.scheduleRefresh(REFRESH_RETRY_DELAY_MS);
        throw new AuthSessionError("transient", "The authentication service is unavailable.");
      }
      this.state = "idle";
      throw new AuthSessionError("unauthenticated", "No renewable OIDC session is available.");
    }
  }

  private scheduleRefresh(delayOverride?: number): void {
    this.clearRefreshTimer();
    if (!this.renewable || this.expiresAt === null || this.state === "refresh-uncertain" || document.visibilityState !== "visible") {
      return;
    }
    const remaining = this.expiresAt - Date.now();
    const jitter = Math.floor(remaining * REFRESH_JITTER_RATIO * (Math.random() - 0.5) * 2);
    const nextRefreshAt = this.refreshAt ?? Date.now() + remaining / 2;
    const delay = delayOverride ?? Math.max(0, Math.min(MAX_REFRESH_DELAY_MS, Math.floor(nextRefreshAt - Date.now() + jitter)));
    this.refreshTimer = window.setTimeout(() => {
      void this.requestRefresh().catch(() => undefined);
    }, delay);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private refreshAfterReturn = (): void => {
    if (document.visibilityState !== "visible") {
      this.clearRefreshTimer();
      return;
    }
    if (this.renewable && this.refreshAt !== null && this.refreshAt <= Date.now()) {
      void this.requestRefresh().catch(() => undefined);
      return;
    }
    this.scheduleRefresh();
  };

  private handleRefreshMessage = (event: MessageEvent<{ type?: string; generation?: number }>): void => {
    if (event.data?.type !== "completed" || !this.renewable || this.expiresAt === null) {
      return;
    }
    if (typeof event.data.generation === "number") {
      this.refreshGeneration = Math.max(this.refreshGeneration ?? 0, event.data.generation);
    }
    this.refreshAt = Math.max(this.refreshAt ?? 0, Date.now() + REFRESH_SAFETY_MARGIN_MS);
    this.scheduleRefresh();
  };
}

export const authSession = new AuthSessionManager();
