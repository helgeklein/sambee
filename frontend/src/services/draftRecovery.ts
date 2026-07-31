import { authSession } from "./authSession";

const DRAFT_PREFIX = "sambee_oidc_draft";
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type DraftEditorType = "markdown" | "text";

export interface DraftSnapshot {
  baseline: string;
  baselineHash: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export type DraftSaveResult = { saved: true } | { saved: false; reason: "no-user" | "too-large" | "storage-unavailable" };

interface RegisteredDraft {
  snapshot: () => void;
}

const registeredDrafts = new Set<RegisteredDraft>();

function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function hashBaseline(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function key(connectionId: string, path: string, editorType: DraftEditorType): string | null {
  const userId = authSession.getUserId();
  return userId ? `${DRAFT_PREFIX}:${userId}:${connectionId}:${editorType}:${encodeURIComponent(normalizePath(path))}` : null;
}

export function saveDraft(
  connectionId: string,
  path: string,
  editorType: DraftEditorType,
  baseline: string,
  content: string
): DraftSaveResult {
  if (new Blob([content]).size > MAX_DRAFT_BYTES) {
    return { saved: false, reason: "too-large" };
  }
  const storageKey = key(connectionId, path, editorType);
  if (!storageKey) {
    return { saved: false, reason: "no-user" };
  }
  const current = loadDraft(connectionId, path, editorType);
  const snapshot: DraftSnapshot = {
    baseline,
    baselineHash: hashBaseline(baseline),
    content,
    createdAt: current?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
    return { saved: true };
  } catch {
    return { saved: false, reason: "storage-unavailable" };
  }
}

export function loadDraft(connectionId: string, path: string, editorType: DraftEditorType): DraftSnapshot | null {
  const storageKey = key(connectionId, path, editorType);
  if (!storageKey) {
    return null;
  }
  try {
    const value = sessionStorage.getItem(storageKey);
    if (!value) {
      return null;
    }
    const parsed = JSON.parse(value) as Partial<DraftSnapshot>;
    if (typeof parsed.baseline !== "string" || typeof parsed.content !== "string" || typeof parsed.updatedAt !== "number") {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    if (Date.now() - parsed.updatedAt > DRAFT_MAX_AGE_MS) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    return {
      baseline: parsed.baseline,
      baselineHash: typeof parsed.baselineHash === "string" ? parsed.baselineHash : hashBaseline(parsed.baseline),
      content: parsed.content,
      createdAt: parsed.createdAt ?? parsed.updatedAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function clearDraft(connectionId: string, path: string, editorType: DraftEditorType): void {
  const storageKey = key(connectionId, path, editorType);
  if (storageKey) {
    sessionStorage.removeItem(storageKey);
  }
}

export function registerDraftSnapshot(snapshot: () => void): () => void {
  const registered = { snapshot };
  registeredDrafts.add(registered);
  return () => registeredDrafts.delete(registered);
}

export function snapshotRegisteredDrafts(): void {
  for (const registered of registeredDrafts) {
    registered.snapshot();
  }
}

export function clearCurrentUserDrafts(): void {
  const userId = authSession.getUserId();
  if (!userId) {
    return;
  }
  const prefix = `${DRAFT_PREFIX}:${userId}:`;
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const storageKey = sessionStorage.key(index);
    if (storageKey?.startsWith(prefix)) {
      sessionStorage.removeItem(storageKey);
    }
  }
}
