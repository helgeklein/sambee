import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearForegroundArchiveOperation,
  loadForegroundArchiveOperation,
  storeForegroundArchiveOperation,
} from "./foregroundArchiveOperation";
import { StorageArchiveOperationCoordinator } from "./storageArchiveOperations";
import type { StorageArchiveCreateRequest, StorageBackendRegistry } from "./storageContracts";

const recovery = {
  schemaVersion: 2,
  contractVersion: "v2",
  backendKind: "smb",
  opaqueOperationId: "operation-1",
  expiresAt: Date.now() + 60_000,
} as const;
const completed = { status: "completed", effects: { source: "unchanged", destination: "mutated" } } as const;

function request(sourceKind: "smb" | "local", destinationKind: "smb" | "local"): StorageArchiveCreateRequest {
  const sourceTarget = sourceKind === "smb" ? { kind: "smb" as const, connectionId: "source" } : { kind: "local" as const, driveId: "c" };
  const destinationTarget =
    destinationKind === "smb" ? { kind: "smb" as const, connectionId: "destination" } : { kind: "local" as const, driveId: "d" };
  return {
    sources: [
      {
        target: sourceTarget,
        path: "Documents/report.txt",
        resolvedTarget: { target: sourceTarget, connection: null, capabilitySnapshot: {} as never },
      },
    ],
    destination: {
      target: destinationTarget,
      path: "Archives",
      resolvedTarget: { target: destinationTarget, connection: null, capabilitySnapshot: {} as never },
    },
    name: "backup.zip",
  };
}

function registry(serverOperations: object, localOperations: object): StorageBackendRegistry {
  return {
    resolveDirectory: vi.fn(),
    resolveItem: vi.fn(),
    getCapabilities: vi.fn(),
    getBackend: vi.fn((target) => ({ archiveCreation: target.kind === "smb" ? serverOperations : localOperations })),
  } as never;
}

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

describe("StorageArchiveOperationCoordinator", () => {
  afterEach(() => {
    clearForegroundArchiveOperation();
    vi.clearAllMocks();
  });

  it("prepares, persists recovery, and executes SMB archive creation", async () => {
    const prepareCreate = vi.fn().mockResolvedValue({ recovery });
    const executePreparedCreate = vi.fn().mockResolvedValue(completed);
    const coordinator = new StorageArchiveOperationCoordinator(registry({ prepareCreate, executePreparedCreate }, {}));

    const execution = coordinator.start(request("smb", "smb"));

    await expect(execution.recoveryReady).resolves.toEqual(recovery);
    await expect(execution.result).resolves.toEqual(completed);
    expect(prepareCreate).toHaveBeenCalledOnce();
    expect(executePreparedCreate).toHaveBeenCalledWith({ recovery });
    expect(loadForegroundArchiveOperation()).toBeNull();
  });

  it("bridges local sources to an SMB destination using the prepared server operation", async () => {
    const prepareCreate = vi.fn().mockResolvedValue({ recovery });
    const createLocalSourceToSmb = vi.fn().mockResolvedValue(completed);
    const coordinator = new StorageArchiveOperationCoordinator(registry({ prepareCreate }, { createLocalSourceToSmb }));

    await expect(coordinator.start(request("local", "smb")).result).resolves.toEqual(completed);

    expect(createLocalSourceToSmb).toHaveBeenCalledWith(expect.objectContaining({ name: "backup.zip" }), { recovery });
  });

  it("bridges SMB sources to a local destination using the prepared server operation", async () => {
    const prepareCreate = vi.fn().mockResolvedValue({ recovery });
    const createSmbSourceToLocal = vi.fn().mockResolvedValue(completed);
    const coordinator = new StorageArchiveOperationCoordinator(registry({ prepareCreate }, { createSmbSourceToLocal }));

    await expect(coordinator.start(request("smb", "local")).result).resolves.toEqual(completed);

    expect(createSmbSourceToLocal).toHaveBeenCalledWith(expect.objectContaining({ name: "backup.zip" }), { recovery });
  });

  it("creates local-only archives without persisting a server recovery operation", async () => {
    const createLocally = vi.fn().mockResolvedValue(completed);
    const coordinator = new StorageArchiveOperationCoordinator(registry({}, { createLocally }));

    const execution = coordinator.start(request("local", "local"));

    await expect(execution.recoveryReady).resolves.toBeNull();
    await expect(execution.result).resolves.toEqual(completed);
    expect(createLocally).toHaveBeenCalledOnce();
    expect(loadForegroundArchiveOperation()).toBeNull();
  });

  it("cancels an operation when cancellation is requested before preparation completes", async () => {
    const prepareResult = deferred<{ recovery: typeof recovery }>();
    const prepareCreate = vi.fn(() => prepareResult.promise);
    const cancel = vi.fn().mockResolvedValue({ status: "cancelled", effects: { source: "unknown", destination: "unknown" } });
    const coordinator = new StorageArchiveOperationCoordinator(registry({ prepareCreate, cancel }, {}));

    const execution = coordinator.start(request("smb", "smb"));
    await expect(execution.cancel()).resolves.toMatchObject({ status: "cancelled" });
    prepareResult.resolve({ recovery });

    await expect(execution.result).resolves.toMatchObject({ status: "cancelled" });
    expect(cancel).toHaveBeenCalledWith(recovery);
    expect(loadForegroundArchiveOperation()).toBeNull();
  });

  it("recovers an interrupted server operation and clears its marker after cancellation", async () => {
    const cancel = vi.fn().mockResolvedValue({ status: "cancelled", effects: { source: "unknown", destination: "unknown" } });
    const coordinator = new StorageArchiveOperationCoordinator(registry({ cancel }, {}));
    storeForegroundArchiveOperation(recovery);

    await expect(coordinator.recoverInterrupted()).resolves.toBe(true);

    expect(cancel).toHaveBeenCalledWith(recovery);
    expect(loadForegroundArchiveOperation()).toBeNull();
  });

  it("retains a recovery marker when interrupted-operation cancellation fails", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("unavailable"));
    const coordinator = new StorageArchiveOperationCoordinator(registry({ cancel }, {}));
    storeForegroundArchiveOperation(recovery);

    await expect(coordinator.recoverInterrupted()).resolves.toBe(true);

    expect(cancel).toHaveBeenCalledWith(recovery);
    expect(loadForegroundArchiveOperation()).toMatchObject({ recovery });
  });

  it("aborts in-flight local archive creation on page hide", async () => {
    const localCreation = deferred<typeof completed>();
    let signal: AbortSignal | undefined;
    const createLocally = vi.fn((_request: StorageArchiveCreateRequest, requestSignal?: AbortSignal) => {
      signal = requestSignal;
      return localCreation.promise;
    });
    const coordinator = new StorageArchiveOperationCoordinator(registry({}, { createLocally }));

    const execution = coordinator.start(request("local", "local"));
    await expect(execution.recoveryReady).resolves.toBeNull();
    coordinator.cancelOnPageHide();

    expect(signal?.aborted).toBe(true);
    localCreation.resolve(completed);
    await expect(execution.result).resolves.toEqual(completed);
  });
});
