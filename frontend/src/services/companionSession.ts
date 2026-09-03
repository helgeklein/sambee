import type { CompanionDriveDescriptor, CompanionSessionSnapshot } from "./storageContracts";

const COMPANION_SECRET_KEY = "companion_secret";

type Listener = () => void;

async function sign(secret: string, value: string): Promise<string> {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", bytes.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, bytes.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class CompanionSession {
  private revision = 0;
  private snapshot: CompanionSessionSnapshot = { status: "unpaired", revision: 0, drives: [], error: null };
  private readonly listeners = new Set<Listener>();

  getSnapshot(): CompanionSessionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setState(
    status: CompanionSessionSnapshot["status"],
    drives: readonly CompanionDriveDescriptor[] = [],
    error: CompanionSessionSnapshot["error"] = null
  ): void {
    this.revision += 1;
    this.snapshot = { status, drives, error, revision: this.revision };
    for (const listener of this.listeners) listener();
  }

  hasSecret(): boolean {
    return localStorage.getItem(COMPANION_SECRET_KEY) !== null;
  }

  storeSecret(secret: string): void {
    localStorage.setItem(COMPANION_SECRET_KEY, secret);
    this.setState("paired", this.snapshot.drives);
  }

  clearPairing(): void {
    localStorage.removeItem(COMPANION_SECRET_KEY);
    this.setState("unpaired");
  }

  async getSigningHeaders(): Promise<Record<string, string>> {
    const secret = localStorage.getItem(COMPANION_SECRET_KEY);
    if (!secret) throw new Error("Not paired with companion");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    return { "X-Companion-Secret": await sign(secret, timestamp), "X-Companion-Timestamp": timestamp };
  }

  async getSignedQuery(): Promise<string> {
    const headers = await this.getSigningHeaders();
    return `hmac=${headers["X-Companion-Secret"]}&ts=${headers["X-Companion-Timestamp"]}&origin=${encodeURIComponent(window.location.origin)}`;
  }
}

export const companionSession = new CompanionSession();
