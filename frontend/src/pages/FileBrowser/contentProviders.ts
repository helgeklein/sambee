import { createContext, useContext } from "react";
import api from "../../services/api";
import { isLocalAbortError } from "../../services/backendAvailability";
import { isLocalDrive } from "../../services/backendRouter";
import {
  abortForegroundLocalArchiveRequest,
  beginForegroundLocalArchiveRequest,
  clearForegroundArchiveOperation,
  clearForegroundLocalArchiveRequest,
  storeForegroundArchiveOperation,
} from "../../services/foregroundArchiveOperation";
import type {
  ResolvedStorageDirectoryLocation,
  StorageBackendRegistry,
  StorageEditSession,
  StorageReadRequest,
} from "../../services/storageContracts";
import type { ArchiveEntryInfo, ArchiveExtractionDecisionAction, ArchiveOperation, FileEntry } from "../../types";
import { FileType } from "../../types";

export type VirtualContentProviderId = "zip" | (string & {});

export interface PhysicalLocation {
  kind: "physical";
  connectionId: string;
  path: string;
}

export interface VirtualLocation {
  kind: "virtual";
  providerId: VirtualContentProviderId;
  connectionId: string;
  source: PhysicalLocation;
  path: string;
}

export type ContentLocation = PhysicalLocation | VirtualLocation;

export interface PhysicalItemHandle {
  kind: "physical";
  location: PhysicalLocation;
  path: string;
}

export interface VirtualItemHandle {
  kind: "virtual";
  location: VirtualLocation;
  path: string;
}

export type ContentItemHandle = PhysicalItemHandle | VirtualItemHandle;

export interface PdfScreenProfile {
  width: number;
  height: number;
  zoomPercent: number;
}

export type ContentReadRequest =
  | { kind: "raw" }
  | { kind: "text" }
  | { kind: "image"; viewportWidth?: number; viewportHeight?: number; noResizing?: boolean }
  | { kind: "pdf"; variant?: "normalized"; screenProfile?: PdfScreenProfile };

export interface ContentReadOptions {
  download?: boolean;
  signal?: AbortSignal;
}

export interface ContentTextWriteOptions {
  mimeType?: string;
}

export interface ContentEditSession {
  heartbeat(): Promise<void>;
  /** Writes the editor content, recreating the target when it was deleted during the edit session. */
  writeText(content: string, options?: ContentTextWriteOptions): Promise<void>;
  release(): Promise<void>;
}

export type ContentEditStartResult =
  | { kind: "acquired"; session: ContentEditSession }
  | { kind: "read-only" }
  | { kind: "unsupported" }
  | { kind: "unavailable" };

export interface BrowserItem {
  key: string;
  entry: FileEntry;
  handle: ContentItemHandle;
}

export interface ContentCapabilities {
  browse: boolean;
  read: boolean;
  download: boolean;
  extract: boolean;
  mutate: boolean;
  openInNativeApp: boolean;
}

export interface ArchiveExtractionConflict {
  memberPath: string;
  targetPath: string;
  isDirectory?: boolean;
}

export type ArchiveExtractionOutcome =
  | { status: "completed"; filesSkipped: number }
  | { status: "cancelled" }
  | { status: "awaiting-decision"; conflicts: ArchiveExtractionConflict[] };

export interface ArchiveExtractionExecution {
  result: Promise<ArchiveExtractionOutcome>;
  cancel(): Promise<void>;
  decide(action: ArchiveExtractionDecisionAction, memberPath?: string, targetPath?: string): Promise<ArchiveExtractionOutcome>;
  isCancellationRequested(): boolean;
}

export interface ProviderListResult {
  items: BrowserItem[];
  total: number;
  nextCursor: string | null;
}

export interface ContentProvider {
  readonly id: "physical" | VirtualContentProviderId;
  list(location: ContentLocation, options?: { cursor?: string; pageSize?: number; signal?: AbortSignal }): Promise<ProviderListResult>;
  getCapabilities(location: ContentLocation): ContentCapabilities;
  read(item: ContentItemHandle, request: ContentReadRequest, options?: ContentReadOptions): Promise<Blob>;
  beginEdit(item: ContentItemHandle): Promise<ContentEditStartResult>;
  invalidatePdfDerivative(item: ContentItemHandle, screenProfile?: PdfScreenProfile): Promise<void>;
  startExtraction(location: VirtualLocation, destinationPath: string): ArchiveExtractionExecution;
}

export interface VirtualContentProvider extends ContentProvider {
  readonly sourceExtensions: readonly string[];
}

export interface ContentProviderRegistry {
  get(location: ContentLocation): ContentProvider;
  getCapabilities(location: ContentLocation): ContentCapabilities;
  getVirtualProviderIdForFilename(filename: string): VirtualContentProviderId | null;
}

export const ContentProviderRegistryContext = createContext<ContentProviderRegistry | null>(null);

const PHYSICAL_CAPABILITIES: ContentCapabilities = {
  browse: true,
  read: true,
  download: true,
  extract: false,
  mutate: true,
  openInNativeApp: true,
};

const VIRTUAL_READ_ONLY_CAPABILITIES: ContentCapabilities = {
  browse: true,
  read: true,
  download: true,
  extract: true,
  mutate: false,
  openInNativeApp: false,
};

export function physicalLocation(connectionId: string, path: string): PhysicalLocation {
  return { kind: "physical", connectionId, path };
}

export function virtualLocation(
  providerId: VirtualContentProviderId,
  connectionId: string,
  source: PhysicalLocation,
  path: string
): VirtualLocation {
  return { kind: "virtual", providerId, connectionId, source, path };
}

export function physicalItem(location: PhysicalLocation, entry: FileEntry): BrowserItem {
  const path = entry.path;
  return {
    key: `physical\u0001${location.connectionId}\u0001${path}`,
    entry,
    handle: { kind: "physical", location, path },
  };
}

export function virtualItem(location: VirtualLocation, entry: FileEntry): BrowserItem {
  return {
    key: `virtual\u0001${location.providerId}\u0001${location.connectionId}\u0001${location.source.path}\u0001${entry.path}`,
    entry,
    handle: { kind: "virtual", location, path: entry.path },
  };
}

export function virtualItemHandle(location: VirtualLocation, path: string): VirtualItemHandle {
  return { kind: "virtual", location, path };
}

export function physicalItemHandle(connectionId: string, path: string): PhysicalItemHandle {
  return { kind: "physical", location: physicalLocation(connectionId, ""), path };
}

export function isPhysicalItem(item: BrowserItem): item is BrowserItem & { handle: PhysicalItemHandle } {
  return item.handle.kind === "physical";
}

export function isVirtualItem(item: BrowserItem): item is BrowserItem & { handle: VirtualItemHandle } {
  return item.handle.kind === "virtual";
}

function toArchiveEntry(entry: ArchiveEntryInfo): FileEntry {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
    size: entry.size ?? undefined,
    modified_at: entry.modified_at ?? undefined,
    is_readable: entry.state === "readable",
    is_hidden: entry.is_hidden,
    archive_entry_state: entry.state,
  };
}

function getSkippedMemberCount(operation: ArchiveOperation): number {
  try {
    const checkpoint: unknown = JSON.parse(operation.checkpoint_json);
    if (typeof checkpoint !== "object" || checkpoint === null || !("files_skipped" in checkpoint)) {
      return 0;
    }
    const filesSkipped = checkpoint.files_skipped;
    return typeof filesSkipped === "number" && Number.isSafeInteger(filesSkipped) && filesSkipped > 0 ? filesSkipped : 0;
  } catch {
    return 0;
  }
}

function pendingConflicts(operation: ArchiveOperation): ArchiveExtractionConflict[] {
  try {
    const pending: unknown = JSON.parse(operation.pending_decision_json ?? "{}");
    if (typeof pending !== "object" || pending === null || !("conflicts" in pending) || !Array.isArray(pending.conflicts)) {
      throw new Error("Archive extraction conflict details are invalid");
    }
    return pending.conflicts.map((conflict) => {
      if (
        typeof conflict !== "object" ||
        conflict === null ||
        typeof conflict.member_path !== "string" ||
        typeof conflict.target_path !== "string" ||
        ("is_directory" in conflict && typeof conflict.is_directory !== "boolean")
      ) {
        throw new Error("Archive extraction conflict details are invalid");
      }
      return {
        memberPath: conflict.member_path,
        targetPath: conflict.target_path,
        isDirectory: conflict.is_directory,
      };
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error("Archive extraction conflict details are invalid");
  }
}

function toExtractionOutcome(operation: ArchiveOperation): ArchiveExtractionOutcome {
  if (operation.phase === "completed") {
    return { status: "completed", filesSkipped: getSkippedMemberCount(operation) };
  }
  if (operation.phase === "cancelled") {
    return { status: "cancelled" };
  }
  if (operation.phase === "awaiting_user_decision") {
    return { status: "awaiting-decision", conflicts: pendingConflicts(operation) };
  }
  throw new Error("Archive extraction did not reach a terminal state");
}

function unsupportedArchiveExtraction(): ArchiveExtractionExecution {
  return {
    result: Promise.reject(new Error("Physical content cannot be extracted")),
    cancel: async () => undefined,
    decide: async () => {
      throw new Error("Physical content cannot be extracted");
    },
    isCancellationRequested: () => false,
  };
}

function startZipArchiveExtraction(location: VirtualLocation, destinationPath: string): ArchiveExtractionExecution {
  if (location.providerId !== "zip") {
    return {
      result: Promise.reject(new Error("Archive extraction is unavailable for this content provider")),
      cancel: async () => undefined,
      decide: async () => {
        throw new Error("Archive extraction is unavailable for this content provider");
      },
      isCancellationRequested: () => false,
    };
  }

  let operationId: string | null = null;
  let localSignal: AbortSignal | null = null;
  let awaitingDecision = false;
  let cancellationRequested = false;

  const finishServerOutcome = (outcome: ArchiveExtractionOutcome): ArchiveExtractionOutcome => {
    awaitingDecision = outcome.status === "awaiting-decision";
    if (!awaitingDecision && operationId) {
      clearForegroundArchiveOperation(operationId);
    }
    return outcome;
  };

  const executeServerOperation = async (): Promise<ArchiveExtractionOutcome> => {
    if (!operationId) {
      throw new Error("Archive extraction operation is unavailable");
    }
    return finishServerOutcome(toExtractionOutcome(await api.executeArchiveExtraction(operationId)));
  };

  const result = (async (): Promise<ArchiveExtractionOutcome> => {
    if (isLocalDrive(location.connectionId)) {
      localSignal = beginForegroundLocalArchiveRequest();
      try {
        const localResult = await api.extractLocalArchive(location.connectionId, location.source.path, destinationPath, localSignal);
        return { status: "completed", filesSkipped: localResult.files_skipped };
      } catch (error) {
        if (cancellationRequested && isLocalAbortError(error)) {
          return { status: "cancelled" };
        }
        throw error;
      } finally {
        clearForegroundLocalArchiveRequest(localSignal);
      }
    }

    try {
      const operation = await api.prepareArchiveOperation({
        kind: "extract",
        source_connection_id: location.connectionId,
        source_path: location.source.path,
        destination_connection_id: location.connectionId,
        destination_path: destinationPath,
      });
      operationId = operation.id;
      storeForegroundArchiveOperation(operationId);
      if (cancellationRequested) {
        await api.cancelArchiveOperation(operationId);
        clearForegroundArchiveOperation(operationId);
        return { status: "cancelled" };
      }
      return await executeServerOperation();
    } catch (error) {
      if (operationId && !cancellationRequested) {
        try {
          await api.cancelArchiveOperation(operationId);
          clearForegroundArchiveOperation(operationId);
        } catch {
          // Retain the marker so the page-reload recovery path can retry cancellation.
        }
      }
      throw error;
    }
  })();

  return {
    result,
    async cancel() {
      cancellationRequested = true;
      if (localSignal) {
        abortForegroundLocalArchiveRequest();
        return;
      }
      if (!operationId) {
        return;
      }
      if (awaitingDecision) {
        await api.decideArchiveExtraction(operationId, "cancel");
        clearForegroundArchiveOperation(operationId);
        return;
      }
      await api.cancelArchiveOperation(operationId);
    },
    async decide(action, memberPath, targetPath) {
      if (!operationId || !awaitingDecision) {
        throw new Error("Archive extraction is not awaiting a collision decision");
      }
      const operation = await api.decideArchiveExtraction(operationId, action, memberPath, targetPath);
      if (operation.phase === "cancelled") {
        return finishServerOutcome({ status: "cancelled" });
      }
      if (operation.phase !== "streaming") {
        throw new Error("Archive extraction did not resume after the collision decision");
      }
      awaitingDecision = false;
      return executeServerOperation();
    },
    isCancellationRequested: () => cancellationRequested,
  };
}

const physicalContentProvider: ContentProvider = {
  id: "physical",
  async list(location, options) {
    if (location.kind !== "physical") {
      throw new Error("Physical provider requires a physical location");
    }
    const listing = await api.listDirectory(location.connectionId, location.path, { signal: options?.signal });
    return {
      items: listing.items.map((entry) => physicalItem(location, entry)),
      total: listing.total,
      nextCursor: null,
    };
  },
  getCapabilities: () => PHYSICAL_CAPABILITIES,
  read(item, request, options) {
    if (item.kind !== "physical") {
      throw new Error("Physical provider requires a physical item");
    }

    if (options?.download || request.kind === "raw") {
      return api.getOriginalFileBlob(item.location.connectionId, item.path, { signal: options?.signal });
    }

    if (request.kind === "text") {
      return api.getFileContent(item.location.connectionId, item.path).then((content) => new Blob([content], { type: "text/plain" }));
    }

    if (request.kind === "image") {
      return api.getImageBlob(item.location.connectionId, item.path, {
        signal: options?.signal,
        viewportWidth: request.viewportWidth,
        viewportHeight: request.viewportHeight,
        no_resizing: request.noResizing,
      });
    }

    return api.getPdfBlob(item.location.connectionId, item.path, {
      signal: options?.signal,
      pdfVariant: request.variant,
      screenProfile: request.screenProfile,
    });
  },
  async beginEdit(item) {
    if (item.kind !== "physical") {
      throw new Error("Physical provider requires a physical item");
    }
    if (!api.supportsEditLocks(item.location.connectionId)) return { kind: "unsupported" };
    const lockInfo = await api.acquireEditLock(item.location.connectionId, item.path);
    if (!lockInfo.lock_capability || !lockInfo.operation_id) throw new Error("Edit lock context is incomplete");
    let released = false;
    return {
      kind: "acquired",
      session: {
        heartbeat: () => api.heartbeatEditLock(item.location.connectionId, item.path, lockInfo),
        writeText: (content, options) =>
          api.writeTextWithEditLock(
            item.location.connectionId,
            item.path,
            content,
            { lock_id: lockInfo.lock_id, lock_capability: lockInfo.lock_capability, operation_id: lockInfo.operation_id },
            { mimeType: options?.mimeType }
          ),
        release: async () => {
          if (released) return;
          released = true;
          await api.releaseEditLock(item.location.connectionId, item.path, lockInfo);
        },
      },
    };
  },
  invalidatePdfDerivative(item, screenProfile) {
    if (item.kind !== "physical") {
      throw new Error("Physical provider requires a physical item");
    }
    return api.invalidatePdfDerivative(item.location.connectionId, item.path, screenProfile);
  },
  startExtraction() {
    return unsupportedArchiveExtraction();
  },
};

const zipContentProvider: VirtualContentProvider = {
  id: "zip",
  sourceExtensions: [".zip"],
  async list(location, options) {
    if (location.kind !== "virtual" || location.providerId !== "zip") {
      throw new Error("ZIP provider requires a ZIP virtual location");
    }
    const listing = await api.listArchiveDirectory(location.connectionId, location.source.path, location.path, {
      cursor: options?.cursor,
      pageSize: options?.pageSize,
      signal: options?.signal,
    });
    return {
      items: listing.items.map((entry) => virtualItem(location, toArchiveEntry(entry))),
      total: listing.total,
      nextCursor: listing.next_cursor ?? null,
    };
  },
  getCapabilities: () => VIRTUAL_READ_ONLY_CAPABILITIES,
  read(item, request, options) {
    if (item.kind !== "virtual" || item.location.providerId !== "zip") {
      throw new Error("ZIP provider cannot read a different virtual content type");
    }
    return api.getArchiveMember(item.location.connectionId, item.location.source.path, item.path, {
      download: options?.download,
      request,
      signal: options?.signal,
    });
  },
  async beginEdit() {
    return { kind: "unsupported" };
  },
  invalidatePdfDerivative(item, screenProfile) {
    if (item.kind !== "virtual" || item.location.providerId !== "zip") {
      throw new Error("ZIP provider cannot invalidate a different virtual content type");
    }
    return api.invalidateArchiveMemberPdfDerivative(item.location.connectionId, item.location.source.path, item.path, screenProfile);
  },
  startExtraction(location, destinationPath) {
    return startZipArchiveExtraction(location, destinationPath);
  },
};

const providers = new Map<string, ContentProvider>([
  [physicalContentProvider.id, physicalContentProvider],
  [zipContentProvider.id, zipContentProvider],
]);

function isVirtualContentProvider(provider: ContentProvider): provider is VirtualContentProvider {
  return "sourceExtensions" in provider && Array.isArray(provider.sourceExtensions);
}

function storageReadRequest(request: ContentReadRequest): StorageReadRequest {
  return request;
}

function toContentEditSession(session: StorageEditSession): ContentEditSession {
  return session;
}

function storageCapabilities(location: PhysicalLocation, registry: StorageBackendRegistry): ContentCapabilities {
  try {
    const target = registry.resolveDirectory(location);
    const capabilities = registry.getCapabilities(target.resolvedTarget);
    return {
      browse: capabilities.canList,
      read: capabilities.readable,
      download: capabilities.readable,
      extract: false,
      mutate: capabilities.writable,
      openInNativeApp: capabilities.canOpenInNativeApp,
    };
  } catch {
    return { browse: false, read: false, download: false, extract: false, mutate: false, openInNativeApp: false };
  }
}

export function createStorageBackedContentProviderRegistry(registry: StorageBackendRegistry): ContentProviderRegistry {
  const physical: ContentProvider = {
    id: "physical",
    async list(location, options) {
      if (location.kind !== "physical") throw new Error("Physical provider requires a physical location");
      let resolved: ResolvedStorageDirectoryLocation;
      try {
        resolved = registry.resolveDirectory(location);
      } catch {
        // Direct local routes can load before Companion detection has refreshed its drive catalog.
        const listing = await api.listDirectory(location.connectionId, location.path, { signal: options?.signal });
        return { items: listing.items.map((entry) => physicalItem(location, entry)), total: listing.total, nextCursor: null };
      }
      const listing = await registry.getBackend(resolved.target).list(resolved, options);
      return { items: listing.items.map((entry) => physicalItem(location, entry)), total: listing.total, nextCursor: null };
    },
    getCapabilities: (location) => (location.kind === "physical" ? storageCapabilities(location, registry) : PHYSICAL_CAPABILITIES),
    async read(item, request, options) {
      if (item.kind !== "physical") throw new Error("Physical provider requires a physical item");
      const resolved = registry.resolveItem({ connectionId: item.location.connectionId, path: item.path });
      return registry.getBackend(resolved.target).read(resolved, storageReadRequest(request), options);
    },
    async beginEdit(item) {
      if (item.kind !== "physical") throw new Error("Physical provider requires a physical item");
      const resolved = registry.resolveItem({ connectionId: item.location.connectionId, path: item.path });
      const editing = registry.getBackend(resolved.target).editing;
      if (!editing) return { kind: "unsupported" };
      const result = await editing.begin(resolved);
      return result.kind === "acquired" ? { kind: "acquired", session: toContentEditSession(result.session) } : result;
    },
    async invalidatePdfDerivative(item, screenProfile) {
      if (item.kind !== "physical") throw new Error("Physical provider requires a physical item");
      const resolved = registry.resolveItem({ connectionId: item.location.connectionId, path: item.path });
      await registry.getBackend(resolved.target).invalidatePdfDerivative(resolved, screenProfile);
    },
    startExtraction() {
      return unsupportedArchiveExtraction();
    },
  };
  const zip: VirtualContentProvider = {
    id: "zip",
    sourceExtensions: [".zip"],
    async list(location, options) {
      if (location.kind !== "virtual" || location.providerId !== "zip") throw new Error("ZIP provider requires a ZIP virtual location");
      const source = registry.resolveItem({ connectionId: location.source.connectionId, path: location.source.path });
      const archive = registry.getBackend(source.target).archive;
      if (!archive) throw new Error("Archive browsing is unavailable for this location");
      const listing = await archive.listDirectory(source, location.path, options);
      return {
        items: listing.items.map((entry) => virtualItem(location, toArchiveEntry(entry))),
        total: listing.total,
        nextCursor: listing.next_cursor ?? null,
      };
    },
    getCapabilities: (location) => {
      if (location.kind !== "virtual" || location.providerId !== "zip") {
        return VIRTUAL_READ_ONLY_CAPABILITIES;
      }
      try {
        const source = registry.resolveItem({ connectionId: location.source.connectionId, path: location.source.path });
        const capabilities = registry.getCapabilities(source.resolvedTarget);
        return { ...VIRTUAL_READ_ONLY_CAPABILITIES, extract: capabilities.canReadArchive && capabilities.writable };
      } catch {
        return { ...VIRTUAL_READ_ONLY_CAPABILITIES, extract: false };
      }
    },
    async read(item, request, options) {
      if (item.kind !== "virtual" || item.location.providerId !== "zip")
        throw new Error("ZIP provider cannot read a different virtual content type");
      const source = registry.resolveItem({ connectionId: item.location.source.connectionId, path: item.location.source.path });
      const archive = registry.getBackend(source.target).archive;
      if (!archive) throw new Error("Archive reading is unavailable for this location");
      return archive.readMember(source, item.path, storageReadRequest(request), options);
    },
    async beginEdit() {
      return { kind: "unsupported" };
    },
    async invalidatePdfDerivative(item, screenProfile) {
      if (item.kind !== "virtual" || item.location.providerId !== "zip")
        throw new Error("ZIP provider cannot invalidate a different virtual content type");
      const source = registry.resolveItem({ connectionId: item.location.source.connectionId, path: item.location.source.path });
      await registry.getBackend(source.target).archive?.invalidateMemberPdfDerivative(source, item.path, screenProfile);
    },
    startExtraction(location, destinationPath) {
      return startZipArchiveExtraction(location, destinationPath);
    },
  };
  return createContentProviderRegistry([physical, zip]);
}

export function createContentProviderRegistry(providerEntries: Iterable<ContentProvider> = providers.values()): ContentProviderRegistry {
  const registry = new Map(Array.from(providerEntries, (provider) => [provider.id, provider]));
  const get = (location: ContentLocation): ContentProvider => {
    const providerId = location.kind === "physical" ? "physical" : location.providerId;
    const provider = registry.get(providerId);
    if (!provider) {
      throw new Error(`No content provider registered for ${providerId}`);
    }
    return provider;
  };
  return {
    get,
    getCapabilities: (location) => get(location).getCapabilities(location),
    getVirtualProviderIdForFilename: (filename) => {
      const normalizedFilename = filename.toLowerCase();
      for (const provider of registry.values()) {
        if (isVirtualContentProvider(provider) && provider.sourceExtensions.some((extension) => normalizedFilename.endsWith(extension))) {
          return provider.id;
        }
      }
      return null;
    },
  };
}

const defaultProviderRegistry = createContentProviderRegistry();

export function useContentProviderRegistry(): ContentProviderRegistry {
  return useContext(ContentProviderRegistryContext) ?? defaultProviderRegistry;
}

export function getContentProvider(location: ContentLocation): ContentProvider {
  return defaultProviderRegistry.get(location);
}

export function getContentCapabilities(location: ContentLocation): ContentCapabilities {
  return defaultProviderRegistry.getCapabilities(location);
}

export function getVirtualContentProvider(location: VirtualLocation): VirtualContentProvider {
  const provider = getContentProvider(location);
  if (!isVirtualContentProvider(provider)) {
    throw new Error(`Content provider ${location.providerId} cannot read virtual items`);
  }
  return provider;
}

export function getVirtualContentProviderIdForFilename(filename: string): VirtualContentProviderId | null {
  return defaultProviderRegistry.getVirtualProviderIdForFilename(filename);
}

export function readVirtualContent(
  source: VirtualItemHandle,
  path = source.path,
  options?: { download?: boolean; signal?: AbortSignal },
  registry: ContentProviderRegistry = defaultProviderRegistry
): Promise<Blob> {
  return readContent(virtualItemHandle(source.location, path), { kind: "raw" }, options, registry);
}

export function readContent(
  item: ContentItemHandle,
  request: ContentReadRequest,
  options?: ContentReadOptions,
  registry: ContentProviderRegistry = defaultProviderRegistry
): Promise<Blob> {
  return registry.get(item.location).read(item, request, options);
}

export function readViewerContent(
  connectionId: string,
  path: string,
  request: ContentReadRequest,
  options?: ContentReadOptions & { virtualSource?: VirtualItemHandle },
  registry: ContentProviderRegistry = defaultProviderRegistry
): Promise<Blob> {
  const item = options?.virtualSource ? virtualItemHandle(options.virtualSource.location, path) : physicalItemHandle(connectionId, path);
  return readContent(item, request, options, registry);
}

export async function beginViewerTextEdit(
  connectionId: string,
  path: string,
  registry: ContentProviderRegistry = defaultProviderRegistry
): Promise<ContentEditStartResult> {
  const item = physicalItemHandle(connectionId, path);
  return registry.get(item.location).beginEdit(item);
}

export function invalidateViewerPdfDerivative(
  connectionId: string,
  path: string,
  screenProfile?: PdfScreenProfile,
  virtualSource?: VirtualItemHandle,
  registry: ContentProviderRegistry = defaultProviderRegistry
): Promise<void> {
  const item = virtualSource ? virtualItemHandle(virtualSource.location, path) : physicalItemHandle(connectionId, path);
  return registry.get(item.location).invalidatePdfDerivative(item, screenProfile);
}

export function getEntryPath(location: PhysicalLocation, entry: FileEntry): string {
  return entry.path || (location.path ? `${location.path}/${entry.name}` : entry.name);
}

export function isDirectory(item: BrowserItem): boolean {
  return item.entry.type === FileType.DIRECTORY;
}
