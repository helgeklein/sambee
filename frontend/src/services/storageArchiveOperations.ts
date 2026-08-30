import {
  abortForegroundLocalArchiveRequest,
  beginForegroundLocalArchiveRequest,
  clearForegroundArchiveOperation,
  clearForegroundLocalArchiveRequest,
  hasForegroundArchiveWork,
  loadForegroundArchiveOperation,
  requestForegroundArchiveCancellation,
  storeForegroundArchiveOperation,
} from "./foregroundArchiveOperation";
import type {
  ArchiveCreationOperations,
  StorageArchiveCreateRequest,
  StorageBackendRegistry,
  StorageOperationExecution,
  StorageOperationResult,
  StorageRecoveryHandle,
  StorageTarget,
} from "./storageContracts";

const ARCHIVE_RECOVERY_TTL_MS = 24 * 60 * 60_000;

function cancelledResult(): StorageOperationResult {
  return {
    status: "cancelled",
    effects: { source: "unknown", destination: "unknown" },
    error: { code: "cancelled", detail: null },
  };
}

function archiveCreationOperations(registry: StorageBackendRegistry, target: StorageTarget): ArchiveCreationOperations {
  const operations = registry.getBackend(target).archiveCreation;
  if (!operations) {
    throw new Error("Archive creation is unavailable for this storage target");
  }
  return operations;
}

function targetForRecovery(handle: StorageRecoveryHandle): StorageTarget {
  return handle.backendKind === "smb" ? { kind: "smb", connectionId: "" } : { kind: "local", driveId: "" };
}

export class StorageArchiveOperationCoordinator {
  constructor(private readonly registry: StorageBackendRegistry) {}

  start(request: StorageArchiveCreateRequest): StorageOperationExecution {
    const sourceTarget = request.sources[0]!.target;
    const destinationTarget = request.destination.target;
    const isLocalOnly = sourceTarget.kind === "local" && destinationTarget.kind === "local";
    const serverTarget = sourceTarget.kind === "smb" ? sourceTarget : destinationTarget;
    const localTarget = sourceTarget.kind === "local" ? sourceTarget : destinationTarget;
    let preparation: Awaited<ReturnType<NonNullable<ArchiveCreationOperations["prepareCreate"]>>> | null = null;
    let localSignal: AbortSignal | null = null;
    let cancellationRequested = false;
    let backendCancellationSucceeded = false;
    let retainForegroundOperation = false;
    let resolveRecovery: (value: StorageRecoveryHandle | null) => void = () => undefined;
    const recoveryReady = new Promise<StorageRecoveryHandle | null>((resolve) => {
      resolveRecovery = resolve;
    });

    const cancelPreparedOperation = async (): Promise<StorageOperationResult> => {
      if (!preparation || backendCancellationSucceeded) {
        return cancelledResult();
      }
      const serverOperations = archiveCreationOperations(this.registry, serverTarget);
      if (!serverOperations.cancel) {
        throw new Error("Archive cancellation is unavailable for this storage target");
      }
      const result = await serverOperations.cancel(preparation.recovery);
      backendCancellationSucceeded = true;
      return result;
    };

    const result = (async (): Promise<StorageOperationResult> => {
      try {
        if (isLocalOnly) {
          const localOperations = archiveCreationOperations(this.registry, localTarget);
          if (!localOperations.createLocally) {
            throw new Error("Local archive creation is unavailable");
          }
          resolveRecovery(null);
          localSignal = beginForegroundLocalArchiveRequest();
          if (cancellationRequested) {
            abortForegroundLocalArchiveRequest();
            return cancelledResult();
          }
          return await localOperations.createLocally(request, localSignal);
        }

        const serverOperations = archiveCreationOperations(this.registry, serverTarget);
        if (!serverOperations.prepareCreate) {
          throw new Error("Server archive preparation is unavailable");
        }
        preparation = await serverOperations.prepareCreate(request);
        storeForegroundArchiveOperation(preparation.recovery);
        resolveRecovery(preparation.recovery);
        if (cancellationRequested) {
          await cancelPreparedOperation();
          return cancelledResult();
        }

        if (sourceTarget.kind === "local") {
          const localOperations = archiveCreationOperations(this.registry, localTarget);
          if (!localOperations.createLocalSourceToSmb) {
            throw new Error("Local-to-SMB archive creation is unavailable");
          }
          return await localOperations.createLocalSourceToSmb(request, preparation);
        }
        if (destinationTarget.kind === "local") {
          const localOperations = archiveCreationOperations(this.registry, localTarget);
          if (!localOperations.createSmbSourceToLocal) {
            throw new Error("SMB-to-local archive creation is unavailable");
          }
          return await localOperations.createSmbSourceToLocal(request, preparation);
        }
        if (!serverOperations.executePreparedCreate) {
          throw new Error("Server archive execution is unavailable");
        }
        return await serverOperations.executePreparedCreate(preparation);
      } catch (error) {
        if (preparation && !backendCancellationSucceeded) {
          try {
            await cancelPreparedOperation();
          } catch {
            retainForegroundOperation = true;
          }
        }
        throw error;
      } finally {
        resolveRecovery(null);
        if (preparation && !retainForegroundOperation) {
          clearForegroundArchiveOperation(preparation.recovery.opaqueOperationId);
        }
        if (localSignal) {
          clearForegroundLocalArchiveRequest(localSignal);
        }
      }
    })();

    return {
      result,
      recoveryReady,
      async cancel() {
        cancellationRequested = true;
        if (preparation) {
          return cancelPreparedOperation();
        }
        if (localSignal) {
          abortForegroundLocalArchiveRequest();
        }
        return cancelledResult();
      },
      isCancellationRequested: () => cancellationRequested,
    };
  }

  async recoverInterrupted(): Promise<boolean> {
    const interruptedOperation = loadForegroundArchiveOperation();
    if (!interruptedOperation) {
      return false;
    }
    const recovery: StorageRecoveryHandle = interruptedOperation.recovery ?? {
      schemaVersion: 1,
      contractVersion: "v2",
      backendKind: "smb",
      opaqueOperationId: interruptedOperation.operationId,
      expiresAt: interruptedOperation.startedAt + ARCHIVE_RECOVERY_TTL_MS,
    };
    try {
      const operations = archiveCreationOperations(this.registry, targetForRecovery(recovery));
      if (!operations.cancel) {
        return true;
      }
      await operations.cancel(recovery);
      clearForegroundArchiveOperation(recovery.opaqueOperationId);
    } catch {
      // Keep the marker so a later reload can retry cancellation.
    }
    return true;
  }

  cancelOnPageHide(): void {
    const activeOperation = loadForegroundArchiveOperation();
    if (activeOperation) {
      requestForegroundArchiveCancellation(activeOperation.operationId);
    }
    abortForegroundLocalArchiveRequest();
  }

  hasForegroundWork(): boolean {
    return hasForegroundArchiveWork();
  }
}
