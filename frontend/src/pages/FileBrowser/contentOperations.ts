import type { BrowserHistoryService } from "../../services/browserHistoryService";
import { logger } from "../../services/logger";
import { publishRecentFilesChanged } from "../../services/recentFilesSync";
import type { StorageArchiveOperationCoordinator } from "../../services/storageArchiveOperations";
import type { StorageBackendRegistry } from "../../services/storageContracts";
import { FileType, isApiError } from "../../types";
import type { ContentItemHandle, ContentLocation, PhysicalItemHandle, PhysicalLocation } from "./contentProviders";
import { physicalItemHandle, physicalLocation } from "./contentProviders";

export type ContentOperationReason =
  | "empty-selection"
  | "mixed-source-connections"
  | "unsupported-source"
  | "unsupported-destination"
  | "read-only"
  | "companion-unavailable";

export interface ContentOperationAvailability {
  available: boolean;
  reason?: ContentOperationReason;
}

export interface ContentOperationEnvironment {
  isCompanionPaired: boolean;
  storageRegistry: StorageBackendRegistry;
  history: BrowserHistoryService;
}

export interface ArchiveContentOperationEnvironment extends ContentOperationEnvironment {
  archiveOperations: StorageArchiveOperationCoordinator;
}

export interface ContentOperationProgress {
  current: number;
  total: number;
}

export interface TransferRequest {
  kind: "copy" | "move";
  source: ContentItemHandle;
  destination: ContentLocation;
  targetName?: string;
  overwrite?: boolean;
}

export interface CreateContainerRequest {
  sources: readonly ContentItemHandle[];
  destination: ContentLocation;
  name: string;
}

export interface ContentOperationExecution {
  result: Promise<void>;
  cancel(): Promise<void>;
  isCancellationRequested(): boolean;
}

export interface NativeOpenRequest {
  item: ContentItemHandle;
  forcePicker?: boolean;
  recentRecordId?: string;
  themeJson: string;
  assumeLocalTargetResolved?: boolean;
}

export interface NativeOpenResult {
  companionUri: string | null;
  resolvedDirectory: PhysicalLocation | null;
}

const PERMANENT_RECENT_NATIVE_OPEN_FAILURE_CODES = new Set([
  "recent_file_target_missing",
  "recent_file_target_not_file",
  "recent_file_native_launch_failed",
]);

function isPhysicalLocation(location: ContentLocation): location is PhysicalLocation {
  return location.kind === "physical";
}

function isPhysicalItem(item: ContentItemHandle): item is PhysicalItemHandle {
  return item.kind === "physical";
}

function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

async function transferAcrossBackends(
  request: TransferRequest,
  source: import("../../services/storageContracts").ResolvedStorageItemLocation,
  destination: import("../../services/storageContracts").ResolvedStorageDirectoryLocation,
  environment: ContentOperationEnvironment
): Promise<void> {
  const registry = environment.storageRegistry;
  const sourceBackend = registry.getBackend(source.target);
  const destinationBackend = registry.getBackend(destination.target);
  const sourceInfo = await sourceBackend.getInfo(source);
  const name = request.targetName ?? source.path.split("/").pop() ?? "";

  if (sourceInfo.type === FileType.FILE) {
    const content = await sourceBackend.read(source, { kind: "raw" });
    const result = await destinationBackend.writeFile(destination, { name, content, overwrite: request.overwrite ?? false });
    if (result.status !== "completed") throw new Error(`Content transfer failed: ${result.status}`);
  } else {
    const createResult = await destinationBackend.create(destination, { name, kind: "directory" });
    if (createResult.status !== "completed") throw new Error(`Content transfer failed: ${createResult.status}`);
    const childDestination = { ...destination, path: joinPath(destination.path, name) };
    const listing = await sourceBackend.list({ ...source, path: source.path });
    for (const child of listing.items) {
      await transferAcrossBackends({ ...request, kind: "copy" }, { ...source, path: child.path }, childDestination, environment);
    }
  }

  if (request.kind === "move") {
    const result = await sourceBackend.remove(source);
    if (result.status !== "completed") throw new Error(`Content move failed while removing source: ${result.status}`);
  }
}

function unavailable(reason: ContentOperationReason): ContentOperationAvailability {
  return { available: false, reason };
}

function canWriteLocation(location: ContentLocation, environment: ContentOperationEnvironment): ContentOperationAvailability {
  if (!isPhysicalLocation(location)) {
    return unavailable("unsupported-destination");
  }
  try {
    const resolved = environment.storageRegistry.resolveDirectory(location);
    return environment.storageRegistry.getCapabilities(resolved.resolvedTarget).writable ? { available: true } : unavailable("read-only");
  } catch {
    return unavailable("unsupported-destination");
  }
}

function canWriteItem(item: PhysicalItemHandle, environment: ContentOperationEnvironment): ContentOperationAvailability {
  try {
    const resolved = environment.storageRegistry.resolveItem({ connectionId: item.location.connectionId, path: item.path });
    return environment.storageRegistry.getCapabilities(resolved.resolvedTarget).writable ? { available: true } : unavailable("read-only");
  } catch {
    return unavailable("unsupported-source");
  }
}

function recordNativeOpenAttempt(item: PhysicalItemHandle, history: BrowserHistoryService): void {
  const { connectionId } = item.location;
  const record = () =>
    Promise.resolve()
      .then(() => history.recordRecentFile(connectionId, item.path))
      .then(() => publishRecentFilesChanged());
  void record().catch((error: unknown) => logger.warn("Failed to record recent file", { connectionId, path: item.path, error }, "browser"));
}

function getOperationErrorCode(error: unknown): string | null {
  if (!isApiError(error)) {
    return null;
  }
  const code = error.response?.data?.code;
  return typeof code === "string" ? code : null;
}

async function removePermanentRecentNativeOpenFailure(recordId: string, error: unknown, history: BrowserHistoryService): Promise<void> {
  const errorCode = getOperationErrorCode(error);
  if (!errorCode || !PERMANENT_RECENT_NATIVE_OPEN_FAILURE_CODES.has(errorCode)) {
    return;
  }
  try {
    await history.removeRecentFile(recordId);
    publishRecentFilesChanged();
  } catch (removeError: unknown) {
    logger.warn("Failed to remove stale recent file", { recordId, error: removeError }, "browser");
  }
}

export function getCreateContentItemAvailability(
  location: ContentLocation,
  environment: ContentOperationEnvironment
): ContentOperationAvailability {
  return canWriteLocation(location, environment);
}

export function getNativeOpenAvailability(item: ContentItemHandle, environment: ContentOperationEnvironment): ContentOperationAvailability {
  if (!isPhysicalItem(item)) {
    return unavailable("unsupported-source");
  }
  try {
    const resolved = environment.storageRegistry.resolveItem({ connectionId: item.location.connectionId, path: item.path });
    return environment.storageRegistry.getCapabilities(resolved.resolvedTarget).canOpenInNativeApp
      ? { available: true }
      : unavailable("read-only");
  } catch {
    return unavailable("unsupported-source");
  }
}

export async function openContentInNativeApp(
  request: NativeOpenRequest,
  environment: ContentOperationEnvironment
): Promise<NativeOpenResult> {
  const availability = getNativeOpenAvailability(request.item, environment);
  if (!availability.available || !isPhysicalItem(request.item)) {
    throw new Error(`Native app opening is unavailable: ${availability.reason ?? "unsupported"}`);
  }

  try {
    let resolved = environment.storageRegistry.resolveItem({ connectionId: request.item.location.connectionId, path: request.item.path });
    let targetItem = request.item;
    const backend = environment.storageRegistry.getBackend(resolved.target);
    if (backend.resolveActivation && !request.assumeLocalTargetResolved) {
      const activation = await backend.resolveActivation(resolved);
      if (activation.type === FileType.DIRECTORY) {
        return { companionUri: null, resolvedDirectory: physicalLocation(activation.connectionId, activation.path) };
      }
      targetItem = physicalItemHandle(activation.connectionId, activation.path);
      resolved = environment.storageRegistry.resolveItem({ connectionId: activation.connectionId, path: activation.path });
    }
    recordNativeOpenAttempt(targetItem, environment.history);
    const launch = await environment.storageRegistry.getBackend(resolved.target).openInNativeApp?.(resolved, {
      forcePicker: request.forcePicker ?? false,
      themeJson: request.themeJson,
    });
    if (!launch || launch.kind === "unavailable" || launch.kind === "failed") {
      throw new Error("Native app launch failed");
    }
    return { companionUri: launch.kind === "browser-launch" ? launch.uri : null, resolvedDirectory: null };
  } catch (error) {
    if (request.recentRecordId) {
      await removePermanentRecentNativeOpenFailure(request.recentRecordId, error, environment.history);
    }
    throw error;
  }
}

export function getTransferAvailability(
  request: Pick<TransferRequest, "kind" | "source" | "destination">,
  environment: ContentOperationEnvironment
): ContentOperationAvailability {
  if (!isPhysicalItem(request.source)) {
    return unavailable("unsupported-source");
  }
  const destinationAvailability = canWriteLocation(request.destination, environment);
  if (!destinationAvailability.available) {
    return destinationAvailability;
  }
  if (request.kind === "move") {
    const sourceAvailability = canWriteItem(request.source, environment);
    if (!sourceAvailability.available) {
      return sourceAvailability;
    }
  }
  return { available: true };
}

export async function executeTransfer(request: TransferRequest, environment: ContentOperationEnvironment): Promise<void> {
  const availability = getTransferAvailability(request, environment);
  if (!availability.available || !isPhysicalItem(request.source) || !isPhysicalLocation(request.destination)) {
    throw new Error(`Content transfer is unavailable: ${availability.reason ?? "unsupported"}`);
  }

  const source = environment.storageRegistry.resolveItem({
    connectionId: request.source.location.connectionId,
    path: request.source.path,
  });
  const destination = environment.storageRegistry.resolveDirectory(request.destination);
  if (source.target.kind === destination.target.kind) {
    const backend = environment.storageRegistry.getBackend(source.target);
    const transfer = { source, destination, targetName: request.targetName, overwrite: request.overwrite ?? false };
    const result = request.kind === "copy" ? await backend.copyWithinBackend(transfer) : await backend.moveWithinBackend(transfer);
    if (result.status !== "completed") throw new Error(`Content transfer failed: ${result.status}`);
    return;
  }
  await transferAcrossBackends(request, source, destination, environment);
}

export function areSameContentLocations(left: ContentLocation, right: ContentLocation): boolean {
  if (left.kind !== right.kind || left.connectionId !== right.connectionId) {
    return false;
  }
  if (left.kind === "physical" && right.kind === "physical") {
    return left.path === right.path;
  }
  return (
    left.kind === "virtual" &&
    right.kind === "virtual" &&
    left.providerId === right.providerId &&
    left.source.path === right.source.path &&
    left.path === right.path
  );
}

export function getCreateContainerAvailability(
  request: Pick<CreateContainerRequest, "sources" | "destination">,
  environment: ContentOperationEnvironment
): ContentOperationAvailability {
  if (request.sources.length === 0) {
    return unavailable("empty-selection");
  }
  if (!request.sources.every(isPhysicalItem)) {
    return unavailable("unsupported-source");
  }
  const sourceConnectionId = request.sources[0]!.location.connectionId;
  if (!request.sources.every((source) => source.location.connectionId === sourceConnectionId)) {
    return unavailable("mixed-source-connections");
  }
  const destinationAvailability = canWriteLocation(request.destination, environment);
  if (!destinationAvailability.available) {
    return destinationAvailability;
  }
  try {
    const sourceLocations = request.sources.map((source) =>
      environment.storageRegistry.resolveItem({ connectionId: source.location.connectionId, path: source.path })
    );
    const destination = environment.storageRegistry.resolveDirectory(request.destination);
    const includesLocal = sourceLocations.some((source) => source.target.kind === "local") || destination.target.kind === "local";
    if (includesLocal && !environment.isCompanionPaired) {
      return unavailable("companion-unavailable");
    }
    if (sourceLocations.some((source) => !environment.storageRegistry.getCapabilities(source.resolvedTarget).readable)) {
      return unavailable("unsupported-source");
    }
    return { available: true };
  } catch {
    return unavailable("unsupported-source");
  }
}

export function startCreateContainer(
  request: CreateContainerRequest,
  environment: ArchiveContentOperationEnvironment
): ContentOperationExecution {
  const availability = getCreateContainerAvailability(request, environment);
  if (!availability.available || !isPhysicalLocation(request.destination) || !request.sources.every(isPhysicalItem)) {
    return {
      result: Promise.reject(new Error(`Container creation is unavailable: ${availability.reason ?? "unsupported"}`)),
      cancel: async () => undefined,
      isCancellationRequested: () => false,
    };
  }

  const execution = environment.archiveOperations.start({
    sources: request.sources.map((source) =>
      environment.storageRegistry.resolveItem({ connectionId: source.location.connectionId, path: source.path })
    ),
    destination: environment.storageRegistry.resolveDirectory(request.destination),
    name: request.name,
  });
  return {
    result: execution.result.then((result) => {
      if (result.status === "completed") return;
      throw new Error(result.status === "cancelled" ? "Container creation was cancelled" : "Container creation failed");
    }),
    async cancel() {
      await execution.cancel();
    },
    isCancellationRequested: execution.isCancellationRequested,
  };
}

export function isPartialContainerOutputError(error: unknown): boolean {
  return isApiError(error) && error.response?.data?.code === "local_archive_creation_partial";
}

export async function recoverInterruptedContainerCreation(archiveOperations: StorageArchiveOperationCoordinator): Promise<boolean> {
  return archiveOperations.recoverInterrupted();
}

export function cancelForegroundContainerCreationOnPageHide(archiveOperations: StorageArchiveOperationCoordinator): void {
  archiveOperations.cancelOnPageHide();
}

export function hasForegroundContainerCreationWork(archiveOperations: StorageArchiveOperationCoordinator): boolean {
  return archiveOperations.hasForegroundWork();
}

export async function deleteContentItems(items: readonly ContentItemHandle[], environment: ContentOperationEnvironment): Promise<void> {
  if (items.length === 0 || !items.every(isPhysicalItem)) {
    throw new Error("Content deletion is unavailable for virtual items");
  }
  for (const item of items) {
    if (!canWriteItem(item, environment).available) {
      throw new Error("Content deletion is unavailable for read-only locations");
    }
    const resolved = environment.storageRegistry.resolveItem({ connectionId: item.location.connectionId, path: item.path });
    const result = await environment.storageRegistry.getBackend(resolved.target).remove(resolved);
    if (result.status !== "completed") throw new Error(`Content deletion failed: ${result.status}`);
  }
}

export async function renameContentItem(item: ContentItemHandle, name: string, environment: ContentOperationEnvironment): Promise<void> {
  if (!isPhysicalItem(item) || !canWriteItem(item, environment).available) {
    throw new Error("Content renaming is unavailable for this item");
  }
  const resolved = environment.storageRegistry.resolveItem({ connectionId: item.location.connectionId, path: item.path });
  const result = await environment.storageRegistry.getBackend(resolved.target).rename(resolved, name);
  if (result.status !== "completed") throw new Error(`Content renaming failed: ${result.status}`);
}

export async function createContentItem(
  location: ContentLocation,
  name: string,
  type: "file" | "directory",
  environment: ContentOperationEnvironment
): Promise<void> {
  const availability = getCreateContentItemAvailability(location, environment);
  if (!availability.available || !isPhysicalLocation(location)) {
    throw new Error(`Content creation is unavailable: ${availability.reason ?? "unsupported"}`);
  }
  const resolved = environment.storageRegistry.resolveDirectory(location);
  const result = await environment.storageRegistry.getBackend(resolved.target).create(resolved, { name, kind: type });
  if (result.status !== "completed") throw new Error(`Content creation failed: ${result.status}`);
}

export function getLocationDisplayName(location: ContentLocation, getConnectionName: (connectionId: string) => string): string {
  const path = location.kind === "physical" ? location.path : [location.source.path, location.path].filter(Boolean).join("/");
  return `${getConnectionName(location.connectionId)}:/${path}`;
}
