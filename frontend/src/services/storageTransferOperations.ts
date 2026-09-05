import api from "./api";
import { clearForegroundTransferOperation, loadForegroundTransferOperation } from "./foregroundTransferOperation";
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

/** Reconcile the latest backend-owned SMB transfer receipt after a browser reload. */
export async function recoverForegroundStorageTransfer(): Promise<boolean> {
  const transferOperation = loadForegroundTransferOperation();
  if (!transferOperation) {
    return false;
  }
  try {
    const operation = await api.getDurableTransferOperation(transferOperation.destinationConnectionId, transferOperation.operationId);
    if (operation.result) {
      clearForegroundTransferOperation(operation.id);
    }
  } catch {
    // Keep the marker for a later reload if the durable receipt is temporarily unreachable.
  }
  return true;
}
