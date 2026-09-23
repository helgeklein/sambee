import type { CrossBackendTransferOptions } from "./api";
import api from "./api";
import type { ContentTransferResult, TargetResolutionPolicy } from "./storageContracts";

/** Owns browser-to-provider transfer relay transport outside the UI layer. */
export function transferAcrossStorageBackends(
  kind: "copy" | "move",
  sourceConnectionId: string,
  sourcePath: string,
  destinationConnectionId: string,
  destinationPath: string,
  targetResolutionPolicy: TargetResolutionPolicy,
  options?: CrossBackendTransferOptions
): Promise<ContentTransferResult> {
  if (options) {
    return api.transferAcrossBackends(
      kind,
      sourceConnectionId,
      sourcePath,
      destinationConnectionId,
      destinationPath,
      targetResolutionPolicy,
      options
    );
  }
  return api.transferAcrossBackends(kind, sourceConnectionId, sourcePath, destinationConnectionId, destinationPath, targetResolutionPolicy);
}

export function publishBrowserFile(
  file: File,
  connectionId: string,
  path: string,
  policy: TargetResolutionPolicy,
  options: CrossBackendTransferOptions
): Promise<ContentTransferResult> {
  return api.publishBrowserFile(file, connectionId, path, policy, options);
}

export function downloadPhysicalFile(connectionId: string, path: string, name: string): Promise<void> {
  return api.downloadFile(connectionId, path, name);
}

export function downloadPhysicalSelection(connectionId: string, paths: string[], signal: AbortSignal): Promise<void> {
  return api.downloadSelectionArchive(connectionId, paths, signal);
}

export function downloadZipSelection(connectionId: string, archivePath: string, paths: string[], signal: AbortSignal): Promise<void> {
  return api.downloadZipSelectionArchive(connectionId, archivePath, paths, signal);
}

export function saveVirtualDownload(blob: Blob, name: string): void {
  api.saveDownloadBlob(blob, name);
}
