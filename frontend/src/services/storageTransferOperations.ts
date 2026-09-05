import api from "./api";
import type { ContentTransferResult, TargetResolutionPolicy } from "./storageContracts";

/** Owns browser-to-provider transfer relay transport outside the UI layer. */
export function transferAcrossStorageBackends(
  kind: "copy" | "move",
  sourceConnectionId: string,
  sourcePath: string,
  destinationConnectionId: string,
  destinationPath: string,
  targetResolutionPolicy: TargetResolutionPolicy
): Promise<ContentTransferResult> {
  return api.transferAcrossBackends(kind, sourceConnectionId, sourcePath, destinationConnectionId, destinationPath, targetResolutionPolicy);
}
