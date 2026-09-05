import { afterEach, describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import { browserHistoryService } from "../../services/browserHistoryService";
import {
  createContentItem,
  executeTransfer,
  getCreateContainerAvailability,
  getCreateContentItemAvailability,
  getNativeOpenAvailability,
  getTransferAvailability,
  openContentInNativeApp,
  startCreateContainer,
} from "./contentOperations";
import { physicalItemHandle, physicalLocation, virtualItemHandle, virtualLocation } from "./contentProviders";

vi.mock("../../services/api", () => ({
  default: {
    cancelArchiveOperation: vi.fn(),
    copyItem: vi.fn(),
    createItem: vi.fn(),
    executeArchiveCreation: vi.fn(),
    getFileInfo: vi.fn(),
    getCompanionUri: vi.fn(),
    openLocalFile: vi.fn(),
    prepareArchiveOperation: vi.fn(),
    recordRecentFile: vi.fn(),
    removeRecentFile: vi.fn(),
    transferAcrossBackends: vi.fn(),
  },
}));

const environment = {
  isCompanionPaired: true,
  storageRegistry: {} as never,
  archiveOperations: {} as never,
  history: browserHistoryService,
};

describe("content operations", () => {
  const physicalSource = physicalItemHandle("source", "report.txt");
  const archiveDestination = virtualLocation("zip", "destination", physicalLocation("destination", "files.zip"), "inside");

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects virtual transfer and container destinations before invoking physical transport", async () => {
    expect(getTransferAvailability({ kind: "copy", source: physicalSource, destination: archiveDestination }, environment)).toEqual({
      available: false,
      reason: "unsupported-destination",
    });
    expect(getCreateContainerAvailability({ sources: [physicalSource], destination: archiveDestination }, environment)).toEqual({
      available: false,
      reason: "unsupported-destination",
    });

    await expect(executeTransfer({ kind: "copy", source: physicalSource, destination: archiveDestination }, environment)).rejects.toThrow(
      "unsupported-destination"
    );
    expect(api.copyItem).not.toHaveBeenCalled();
  });

  it("rejects virtual locations before invoking item creation transport", async () => {
    expect(getCreateContentItemAvailability(archiveDestination, environment)).toEqual({
      available: false,
      reason: "unsupported-destination",
    });

    await expect(createContentItem(archiveDestination, "notes.txt", "file", environment)).rejects.toThrow("unsupported-destination");
    expect(api.createItem).not.toHaveBeenCalled();
  });

  it("rejects virtual items before invoking native launch transport", async () => {
    const archiveItem = virtualItemHandle(archiveDestination, "report.txt");

    expect(getNativeOpenAvailability(archiveItem, environment)).toEqual({ available: false, reason: "unsupported-source" });
    await expect(openContentInNativeApp({ item: archiveItem, themeJson: "{}" }, environment)).rejects.toThrow("unsupported-source");
    expect(api.openLocalFile).not.toHaveBeenCalled();
    expect(api.getCompanionUri).not.toHaveBeenCalled();
  });

  it("delegates same-backend transfers to the resolved storage adapter", async () => {
    const copyWithinBackend = vi.fn().mockResolvedValue({ status: "completed" });
    const resolvedTarget = {
      target: { kind: "smb", connectionId: "source" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const storageRegistry = {
      resolveItem: vi.fn(() => ({ target: resolvedTarget.target, path: "report.txt", resolvedTarget })),
      resolveDirectory: vi.fn(() => ({ target: resolvedTarget.target, path: "output", resolvedTarget })),
      getCapabilities: vi.fn(() => ({ writable: true })),
      getBackend: vi.fn(() => ({ copyWithinBackend })),
    };

    await executeTransfer({ kind: "copy", source: physicalSource, destination: physicalLocation("source", "output") }, {
      ...environment,
      storageRegistry,
    } as never);

    expect(copyWithinBackend).toHaveBeenCalledWith(expect.objectContaining({ targetName: undefined, targetResolutionPolicy: "ask" }));
    expect(api.copyItem).not.toHaveBeenCalled();
  });

  it("allows and dispatches a writable same-provider move", async () => {
    const sourceResolvedTarget = {
      target: { kind: "smb", connectionId: "source" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const destinationResolvedTarget = {
      target: { kind: "smb", connectionId: "destination" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const moveWithinBackend = vi.fn().mockResolvedValue({ status: "completed" });
    const storageRegistry = {
      resolveItem: vi.fn(() => ({ target: sourceResolvedTarget.target, path: "report.txt", resolvedTarget: sourceResolvedTarget })),
      resolveDirectory: vi.fn(() => ({
        target: destinationResolvedTarget.target,
        path: "output",
        resolvedTarget: destinationResolvedTarget,
      })),
      getCapabilities: vi.fn(() => ({ writable: true })),
      getBackend: vi.fn(() => ({ moveWithinBackend })),
    };

    expect(
      getTransferAvailability({ kind: "move", source: physicalSource, destination: physicalLocation("destination", "output") }, {
        ...environment,
        storageRegistry,
      } as never)
    ).toEqual({ available: true });

    await executeTransfer({ kind: "move", source: physicalSource, destination: physicalLocation("destination", "output") }, {
      ...environment,
      storageRegistry,
    } as never);

    expect(moveWithinBackend).toHaveBeenCalledWith(expect.objectContaining({ targetName: undefined, targetResolutionPolicy: "ask" }));
  });

  it("relays a cross-backend move without letting storage adapters delete the source", async () => {
    const sourceResolvedTarget = {
      target: { kind: "local", driveId: "c" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const destinationResolvedTarget = {
      target: { kind: "smb", connectionId: "destination" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const sourceBackend = {
      getInfo: vi.fn().mockResolvedValue({ type: "file" }),
      read: vi.fn().mockResolvedValue(new Blob(["report"])),
      remove: vi.fn().mockResolvedValue({ status: "completed" }),
    };
    const destinationBackend = { writeFile: vi.fn().mockResolvedValue({ status: "completed" }) };
    const storageRegistry = {
      resolveItem: vi.fn(() => ({ target: sourceResolvedTarget.target, path: "report.txt", resolvedTarget: sourceResolvedTarget })),
      resolveDirectory: vi.fn(() => ({
        target: destinationResolvedTarget.target,
        path: "output",
        resolvedTarget: destinationResolvedTarget,
      })),
      getCapabilities: vi.fn(() => ({ writable: true })),
      getBackend: vi.fn((target: { kind: string }) => (target.kind === "local" ? sourceBackend : destinationBackend)),
    };

    vi.mocked(api.transferAcrossBackends).mockResolvedValue({
      status: "completed_with_source_retained",
      replaced: false,
      effects: { source: "unchanged", destination: "mutated" },
      error: { code: "source_delete_failed", detail: "source retained" },
    });
    await expect(
      executeTransfer(
        { kind: "move", source: physicalItemHandle("local-drive:c", "report.txt"), destination: physicalLocation("destination", "output") },
        { ...environment, storageRegistry } as never
      )
    ).resolves.toMatchObject({ status: "completed_with_source_retained", effects: { source: "unchanged", destination: "mutated" } });

    expect(api.transferAcrossBackends).toHaveBeenCalledWith(
      "move",
      "local-drive:c",
      "report.txt",
      "destination",
      "output/report.txt",
      "ask"
    );
    expect(sourceBackend.read).not.toHaveBeenCalled();
    expect(destinationBackend.writeFile).not.toHaveBeenCalled();
    expect(sourceBackend.remove).not.toHaveBeenCalled();
  });

  it("relays a cross-backend copy through the transfer coordinator", async () => {
    const sourceResolvedTarget = {
      target: { kind: "smb", connectionId: "source" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const destinationResolvedTarget = {
      target: { kind: "local", driveId: "c" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const storageRegistry = {
      resolveItem: vi.fn(() => ({ target: sourceResolvedTarget.target, path: "report.txt", resolvedTarget: sourceResolvedTarget })),
      resolveDirectory: vi.fn(() => ({
        target: destinationResolvedTarget.target,
        path: "output",
        resolvedTarget: destinationResolvedTarget,
      })),
      getCapabilities: vi.fn(() => ({ writable: true })),
      getBackend: vi.fn(),
    };
    vi.mocked(api.transferAcrossBackends).mockResolvedValue({
      status: "completed",
      replaced: false,
      effects: { source: "unchanged", destination: "mutated" },
    });
    await expect(
      executeTransfer(
        { kind: "copy", source: physicalItemHandle("source", "report.txt"), destination: physicalLocation("local-drive:c", "output") },
        { ...environment, storageRegistry } as never
      )
    ).resolves.toMatchObject({ status: "completed", effects: { source: "unchanged", destination: "mutated" } });
    expect(storageRegistry.getBackend).not.toHaveBeenCalled();
    expect(api.transferAcrossBackends).toHaveBeenCalledWith("copy", "source", "report.txt", "local-drive:c", "output/report.txt", "ask");
  });

  it("relays a copy between different local drives", async () => {
    const sourceResolvedTarget = {
      target: { kind: "local", driveId: "c" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const destinationResolvedTarget = {
      target: { kind: "local", driveId: "d" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const storageRegistry = {
      resolveItem: vi.fn(() => ({ target: sourceResolvedTarget.target, path: "report.txt", resolvedTarget: sourceResolvedTarget })),
      resolveDirectory: vi.fn(() => ({
        target: destinationResolvedTarget.target,
        path: "output",
        resolvedTarget: destinationResolvedTarget,
      })),
      getCapabilities: vi.fn(() => ({ writable: true })),
      getBackend: vi.fn(),
    };
    vi.mocked(api.transferAcrossBackends).mockResolvedValue({
      status: "completed",
      replaced: false,
      effects: { source: "unchanged", destination: "mutated" },
    });

    await expect(
      executeTransfer(
        {
          kind: "copy",
          source: physicalItemHandle("local-drive:c", "report.txt"),
          destination: physicalLocation("local-drive:d", "output"),
        },
        { ...environment, storageRegistry } as never
      )
    ).resolves.toMatchObject({ status: "completed" });

    expect(storageRegistry.getBackend).not.toHaveBeenCalled();
    expect(api.transferAcrossBackends).toHaveBeenCalledWith(
      "copy",
      "local-drive:c",
      "report.txt",
      "local-drive:d",
      "output/report.txt",
      "ask"
    );
  });

  it("rejects container sources from different connections before starting an operation", async () => {
    const secondSource = physicalItemHandle("other-source", "other-report.txt");
    const destination = physicalLocation("destination", "output");

    expect(getCreateContainerAvailability({ sources: [physicalSource, secondSource], destination }, environment)).toEqual({
      available: false,
      reason: "mixed-source-connections",
    });

    const execution = startCreateContainer({ sources: [physicalSource, secondSource], destination, name: "archive.zip" }, environment);
    await expect(execution.result).rejects.toThrow("mixed-source-connections");
    expect(api.prepareArchiveOperation).not.toHaveBeenCalled();
  });

  it("delegates container creation failures to the archive coordinator", async () => {
    const resolvedTarget = {
      target: { kind: "smb", connectionId: "source" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const storageRegistry = {
      resolveItem: vi.fn(() => ({ target: resolvedTarget.target, path: "report.txt", resolvedTarget })),
      resolveDirectory: vi.fn(() => ({ target: resolvedTarget.target, path: "output", resolvedTarget })),
      getCapabilities: vi.fn(() => ({ readable: true, writable: true })),
    };
    const archiveOperations = {
      start: vi.fn(() => ({
        result: Promise.resolve({
          status: "failed" as const,
          effects: { source: "unchanged" as const, destination: "unchanged" as const },
          error: { code: "transport" as const, detail: "archive transport failed" },
        }),
        cancel: vi.fn(),
        isCancellationRequested: () => false,
      })),
    };

    const execution = startCreateContainer(
      { sources: [physicalSource], destination: physicalLocation("destination", "output"), name: "archive.zip" },
      { ...environment, storageRegistry, archiveOperations } as never
    );

    await expect(execution.result).rejects.toThrow("Container creation failed");
    expect(archiveOperations.start).toHaveBeenCalledWith(expect.objectContaining({ name: "archive.zip" }));
  });

  it("removes permanently invalid recent records when local native launch fails", async () => {
    const nativeLaunchError = { response: { data: { code: "recent_file_native_launch_failed" } } };
    const resolvedTarget = {
      target: { kind: "local", driveId: "c" },
      connection: null,
      capabilitySnapshot: { capabilityRevision: 1 },
    };
    const storageRegistry = {
      resolveItem: vi.fn(() => ({ target: resolvedTarget.target, path: "Documents/report.txt", resolvedTarget })),
      getCapabilities: vi.fn(() => ({ canOpenInNativeApp: true })),
      getBackend: vi.fn(() => ({ openInNativeApp: vi.fn().mockRejectedValue(nativeLaunchError) })),
    };
    vi.mocked(api.removeRecentFile).mockResolvedValue(undefined);

    await expect(
      openContentInNativeApp(
        {
          item: physicalItemHandle("local-drive:c", "Documents/report.txt"),
          recentRecordId: "recent-1",
          themeJson: "{}",
          assumeLocalTargetResolved: true,
        },
        { ...environment, storageRegistry } as never
      )
    ).rejects.toEqual(nativeLaunchError);

    expect(api.removeRecentFile).toHaveBeenCalledWith("recent-1");
  });
});
