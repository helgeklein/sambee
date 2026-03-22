/**
 * CompanionService — HTTP client for the local companion app API.
 *
 * Handles:
 * - Health checks and companion detection
 * - HMAC-SHA256 authentication for companion requests
 * - Pairing protocol (initiate / confirm)
 * - Drive enumeration
 * - Browse operations (list, info)
 *
 * The companion runs on localhost:21549 and uses HMAC-authenticated
 * requests rather than JWT tokens.
 */

import axios, { type AxiosInstance } from "axios";
import { logger } from "./logger";

// ── Constants ────────────────────────────────────────────────────────────────

/** The base URL for the companion's local API server. */
export const COMPANION_BASE_URL = "http://localhost:21549/api";

/** localStorage key prefix for companion pairing secrets. */
const COMPANION_SECRET_KEY = "companion_secret";

/** Timeout in milliseconds for the health-check probe. */
const HEALTH_CHECK_TIMEOUT_MS = 1500;

/**
 * How long to wait for the companion-side approval before failing pairing.
 *
 * This should be close to, but below, the companion's own pairing expiry.
 */
const PAIR_CONFIRM_MAX_WAIT_MS = 110_000;

/** Delay between pairing confirmation retries while waiting on companion approval. */
const PAIR_CONFIRM_RETRY_DELAY_MS = 250;

/** Companion API detail used while local pairing approval is still pending. */
export const COMPANION_PAIR_CONFIRMATION_PENDING_DETAIL = "Waiting for companion confirmation";

// ── Types ────────────────────────────────────────────────────────────────────

/** Companion health-check response. */
export interface CompanionHealthResponse {
  status: string;
  paired: boolean;
}

/** Public pairing status for the current browser origin. */
export interface PairStatusResponse {
  current_origin: string | null;
  current_origin_paired: boolean;
}

/** Authenticated pairing test response. */
export interface PairTestResponse {
  status: string;
  message: string;
  origin: string;
}

export interface CompanionLocalizationPayload {
  language: string;
  regional_locale: string;
  updated_at: string;
}

export interface CompanionLocalizationSyncResponse extends CompanionLocalizationPayload {
  applied: boolean;
  source_origin: string;
}

/** Drive/volume information returned by the companion. */
export interface DriveInfo {
  id: string;
  name: string;
  drive_type: "fixed" | "removable" | "network" | "virtual" | "unknown";
}

/** Pairing initiation response from the companion. */
interface PairInitiateResponse {
  pairing_id: string;
  nonce_companion: string;
}

/** Pairing confirmation response from the companion. */
interface PairConfirmResponse {
  secret: string;
}

interface CompanionApiErrorResponse {
  detail?: string;
}

// ── HMAC Utilities ───────────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256(secret, message) using the Web Crypto API.
 *
 * Returns the hex-encoded digest.
 */
async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute SHA-256 of a hex string, returning hex.
 *
 * Used for pairing code derivation.
 */
async function sha256Hex(hexInput: string): Promise<string> {
  const bytes = new Uint8Array(hexInput.match(/.{1,2}/g)!.map((b) => Number.parseInt(b, 16)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a random 32-byte nonce as a hex string.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Sleep for a short delay while waiting for companion-side confirmation. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Return true when the companion is still waiting for local approval. */
function isWaitingForCompanionConfirmation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const response = (error as { response?: { data?: CompanionApiErrorResponse } }).response;
  return response?.data?.detail === COMPANION_PAIR_CONFIRMATION_PENDING_DETAIL;
}

// ── Secret Persistence ──────────────────────────────────────────────────────

/** Get the stored pairing secret for the companion. */
function getStoredSecret(): string | null {
  return localStorage.getItem(COMPANION_SECRET_KEY);
}

/** Store the pairing secret. */
function storeSecret(secret: string): void {
  localStorage.setItem(COMPANION_SECRET_KEY, secret);
}

/** Remove the stored pairing secret. */
export function clearStoredSecret(): void {
  localStorage.removeItem(COMPANION_SECRET_KEY);
}

/** Check if we have a stored pairing secret. */
export function hasStoredSecret(): boolean {
  return getStoredSecret() !== null;
}

// ── CompanionService ─────────────────────────────────────────────────────────

class CompanionService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: COMPANION_BASE_URL,
      timeout: 10_000,
    });
  }

  // ── Auth Header Construction ─────────────────────────────────────────────

  /**
   * Build the HMAC auth headers required by non-public companion endpoints.
   *
   * Returns an object with `X-Companion-Secret` (HMAC digest) and
   * `X-Companion-Timestamp` headers.
   */
  private async buildAuthHeaders(): Promise<Record<string, string>> {
    const secret = getStoredSecret();
    if (!secret) {
      throw new Error("Not paired with companion — no shared secret available");
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const hmac = await hmacSha256(secret, timestamp);

    return {
      "X-Companion-Secret": hmac,
      "X-Companion-Timestamp": timestamp,
    };
  }

  // ── Health ───────────────────────────────────────────────────────────────

  /**
   * Probe the companion with a short timeout.
   *
   * Returns the health response if reachable, or `null` if the companion
   * is not running or unreachable.
   */
  async checkHealth(): Promise<CompanionHealthResponse | null> {
    try {
      const response = await this.client.get<CompanionHealthResponse>("/health", {
        timeout: HEALTH_CHECK_TIMEOUT_MS,
      });
      return response.data;
    } catch {
      return null;
    }
  }

  // ── Pairing ──────────────────────────────────────────────────────────────

  /**
   * Initiate pairing with the companion.
   *
   * Generates a browser-side nonce, sends it to the companion, receives
   * the companion's nonce, and computes the 6-character pairing code.
   *
   * @returns Object with `pairingId`, `pairingCode`, and the internal
   *          `nonceBrowser` (needed for logging/debugging only).
   */
  async initiatePairing(): Promise<{
    pairingId: string;
    pairingCode: string;
    nonceBrowser: string;
  }> {
    const nonceBrowser = generateNonce();

    const response = await this.client.post<PairInitiateResponse>("/pair/initiate", {
      nonce_browser: nonceBrowser,
    });

    const { pairing_id, nonce_companion } = response.data;

    // Compute code = SHA-256(nonce_browser ‖ nonce_companion), first 6 hex chars uppercased
    const combined = nonceBrowser + nonce_companion;
    const hash = await sha256Hex(combined);
    const pairingCode = hash.slice(0, 6).toUpperCase();

    logger.info("Pairing initiated", { pairingId: pairing_id, pairingCode }, "companion");

    return { pairingId: pairing_id, pairingCode, nonceBrowser };
  }

  /**
   * Confirm a pairing after both sides have verified the code.
   *
   * Receives and stores the shared secret.
   */
  async confirmPairing(pairingId: string): Promise<void> {
    const deadline = Date.now() + PAIR_CONFIRM_MAX_WAIT_MS;

    while (true) {
      try {
        const response = await this.client.post<PairConfirmResponse>("/pair/confirm", {
          pairing_id: pairingId,
        });

        storeSecret(response.data.secret);
        logger.info("Pairing confirmed — secret stored", {}, "companion");
        return;
      } catch (error) {
        if (!isWaitingForCompanionConfirmation(error) || Date.now() >= deadline) {
          throw error;
        }

        await delay(PAIR_CONFIRM_RETRY_DELAY_MS);
      }
    }
  }

  /** Query the companion for the current browser origin's pairing status. */
  async getPairStatus(): Promise<PairStatusResponse> {
    const response = await this.client.get<PairStatusResponse>("/pair/status");
    return response.data;
  }

  /** List all browser origins currently paired with the companion. */
  async listPairings(): Promise<string[]> {
    const response = await this.client.get<string[]>("/pairings");
    return response.data;
  }

  /** Remove a paired browser origin from the companion. */
  async unpairOrigin(origin: string): Promise<void> {
    await this.client.delete("/pairings", {
      params: { origin },
    });
  }

  /** Validate the current browser's authenticated pairing with the companion. */
  async testPairing(): Promise<PairTestResponse> {
    const headers = await this.buildAuthHeaders();
    const response = await this.client.post<PairTestResponse>("/pair/test", undefined, { headers });
    return response.data;
  }

  /** Synchronize the current browser localization to the companion. */
  async syncLocalization(payload: CompanionLocalizationPayload): Promise<CompanionLocalizationSyncResponse> {
    const headers = await this.buildAuthHeaders();
    const response = await this.client.post<CompanionLocalizationSyncResponse>("/localization", payload, { headers });
    return response.data;
  }

  // ── Drives ───────────────────────────────────────────────────────────────

  /**
   * Enumerate all accessible drives/volumes.
   *
   * Requires an active pairing (HMAC auth).
   */
  async getDrives(): Promise<DriveInfo[]> {
    const headers = await this.buildAuthHeaders();
    const response = await this.client.get<DriveInfo[]>("/drives", { headers });
    return response.data;
  }

  // ── Browse ───────────────────────────────────────────────────────────────

  /**
   * List directory contents on a local drive.
   */
  async listDirectory(driveId: string, path = ""): Promise<{ path: string; items: unknown[]; total: number }> {
    const headers = await this.buildAuthHeaders();
    const response = await this.client.get(`/browse/${driveId}/list`, {
      headers,
      params: { path },
    });
    return response.data;
  }

  /**
   * Get file/directory metadata on a local drive.
   */
  async getFileInfo(driveId: string, path = ""): Promise<unknown> {
    const headers = await this.buildAuthHeaders();
    const response = await this.client.get(`/browse/${driveId}/info`, {
      headers,
      params: { path },
    });
    return response.data;
  }
}

export const companionService = new CompanionService();
export default companionService;

// ── WebSocket helpers ────────────────────────────────────────────────────────

/**
 * Build an authenticated WebSocket URL for the companion.
 *
 * The browser WebSocket API does not support custom headers, so HMAC
 * credentials are passed as query parameters on the upgrade request.
 * Returns `null` if no pairing secret is stored.
 */
export async function buildCompanionWsUrl(): Promise<string | null> {
  const secret = getStoredSecret();
  if (!secret) return null;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hmac = await hmacSha256(secret, timestamp);
  const origin = encodeURIComponent(window.location.origin);

  // Derive ws:// URL from the HTTP base URL
  const wsBase = COMPANION_BASE_URL.replace(/^http/, "ws");
  return `${wsBase}/ws?hmac=${hmac}&ts=${timestamp}&origin=${origin}`;
}
