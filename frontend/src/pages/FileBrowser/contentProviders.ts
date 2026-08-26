import api from "../../services/api";
import type { ArchiveEntryInfo, FileEntry } from "../../types";
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
  invalidatePdfDerivative(item: ContentItemHandle, screenProfile?: PdfScreenProfile): Promise<void>;
}

export interface VirtualContentProvider extends ContentProvider {
  readonly sourceExtensions: readonly string[];
}

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
  invalidatePdfDerivative(item, screenProfile) {
    if (item.kind !== "physical") {
      throw new Error("Physical provider requires a physical item");
    }
    return api.invalidatePdfDerivative(item.location.connectionId, item.path, screenProfile);
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
  invalidatePdfDerivative(item, screenProfile) {
    if (item.kind !== "virtual" || item.location.providerId !== "zip") {
      throw new Error("ZIP provider cannot invalidate a different virtual content type");
    }
    return api.invalidateArchiveMemberPdfDerivative(item.location.connectionId, item.location.source.path, item.path, screenProfile);
  },
};

const providers = new Map<string, ContentProvider>([
  [physicalContentProvider.id, physicalContentProvider],
  [zipContentProvider.id, zipContentProvider],
]);

export function getContentProvider(location: ContentLocation): ContentProvider {
  const providerId = location.kind === "physical" ? "physical" : location.providerId;
  const provider = providers.get(providerId);
  if (!provider) {
    throw new Error(`No content provider registered for ${providerId}`);
  }
  return provider;
}

export function getContentCapabilities(location: ContentLocation): ContentCapabilities {
  return getContentProvider(location).getCapabilities(location);
}

export function getVirtualContentProvider(location: VirtualLocation): VirtualContentProvider {
  const provider = getContentProvider(location);
  if (!("read" in provider)) {
    throw new Error(`Content provider ${location.providerId} cannot read virtual items`);
  }
  return provider;
}

export function getVirtualContentProviderIdForFilename(filename: string): VirtualContentProviderId | null {
  const normalizedFilename = filename.toLowerCase();
  for (const provider of providers.values()) {
    if ("sourceExtensions" in provider && provider.sourceExtensions.some((extension) => normalizedFilename.endsWith(extension))) {
      return provider.id;
    }
  }
  return null;
}

export function readVirtualContent(
  source: VirtualItemHandle,
  path = source.path,
  options?: { download?: boolean; signal?: AbortSignal }
): Promise<Blob> {
  return readContent(virtualItemHandle(source.location, path), { kind: "raw" }, options);
}

export function readContent(item: ContentItemHandle, request: ContentReadRequest, options?: ContentReadOptions): Promise<Blob> {
  return getContentProvider(item.location).read(item, request, options);
}

export function readViewerContent(
  connectionId: string,
  path: string,
  request: ContentReadRequest,
  options?: ContentReadOptions & { virtualSource?: VirtualItemHandle }
): Promise<Blob> {
  const item = options?.virtualSource ? virtualItemHandle(options.virtualSource.location, path) : physicalItemHandle(connectionId, path);
  return readContent(item, request, options);
}

export function invalidateViewerPdfDerivative(
  connectionId: string,
  path: string,
  screenProfile?: PdfScreenProfile,
  virtualSource?: VirtualItemHandle
): Promise<void> {
  const item = virtualSource ? virtualItemHandle(virtualSource.location, path) : physicalItemHandle(connectionId, path);
  return getContentProvider(item.location).invalidatePdfDerivative(item, screenProfile);
}

export function getEntryPath(location: PhysicalLocation, entry: FileEntry): string {
  return entry.path || (location.path ? `${location.path}/${entry.name}` : entry.name);
}

export function isDirectory(item: BrowserItem): boolean {
  return item.entry.type === FileType.DIRECTORY;
}
