import { describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import { FileType } from "../../types";
import { getArchiveExtractionAvailability, startArchiveExtraction } from "./contentOperations";
import {
  beginViewerTextEdit,
  createContentProviderRegistry,
  createStorageBackedContentProviderRegistry,
  getContentCapabilities,
  getContentProvider,
  getVirtualContentProviderIdForFilename,
  invalidateViewerPdfDerivative,
  physicalLocation,
  readContent,
  readViewerContent,
  readVirtualContent,
  virtualItem,
  virtualItemHandle,
  virtualLocation,
} from "./contentProviders";

vi.mock("../../services/api", () => ({
  default: {
    getArchiveMember: vi.fn(),
    getFileBlob: vi.fn(),
    getOriginalFileBlob: vi.fn(),
    getImageBlob: vi.fn(),
    invalidateArchiveMemberPdfDerivative: vi.fn(),
    invalidatePdfDerivative: vi.fn(),
    startLocalArchiveExtraction: vi.fn(),
    getLocalArchiveExtraction: vi.fn(),
    cancelLocalArchiveExtraction: vi.fn(),
    waitForLocalArchiveExecution: vi.fn(),
    decideLocalArchiveExecution: vi.fn(),
    cancelLocalArchiveExecutionWithRevisionRetry: vi.fn(),
    extractLocalArchiveToSmb: vi.fn(),
    extractSmbArchiveToLocal: vi.fn(),
    prepareArchiveOperation: vi.fn(),
    getArchiveCompanionSession: vi.fn(),
    executeArchiveExtraction: vi.fn(),
    decideArchiveExtraction: vi.fn(),
    cancelArchiveOperation: vi.fn(),
    getPdfBlob: vi.fn(),
    listArchiveDirectory: vi.fn(),
    listDirectory: vi.fn(),
    saveTextFile: vi.fn(),
  },
}));

function localArchiveProgress(completedMembers = 0, skippedMembers = 0, totalMembers?: number, totalBytes?: number) {
  return { completedMembers, skippedMembers, failedMembers: 0, partialMembers: 0, totalMembers, totalBytes };
}

describe("content providers", () => {
  const archiveLocation = virtualLocation("zip", "conn-1", physicalLocation("conn-1", "archives/one.zip"), "images");

  it("gives physical and virtual locations distinct capability profiles", () => {
    expect(getContentCapabilities(physicalLocation("conn-1", "photos")).mutate).toBe(true);
    expect(getContentCapabilities(archiveLocation)).toMatchObject({
      browse: true,
      read: true,
      download: true,
      extract: true,
      mutate: false,
      openInNativeApp: false,
    });
  });

  it("selects ZIP providers by source filename and lists normalized virtual entries", async () => {
    vi.mocked(api.listArchiveDirectory).mockResolvedValueOnce({
      archive: { path: "archives/one.zip", size: 1 },
      path: "images",
      items: [{ name: "blocked.png", path: "images/blocked.png", type: FileType.FILE, state: "blocked", is_hidden: false }],
      total: 1,
      page_size: 100,
    });

    expect(getVirtualContentProviderIdForFilename("one.zip")).toBe("zip");
    expect(getVirtualContentProviderIdForFilename("one.img")).toBeNull();

    const listing = await getContentProvider(archiveLocation).list(archiveLocation, { pageSize: 100 });

    expect(api.listArchiveDirectory).toHaveBeenCalledWith("conn-1", "archives/one.zip", "images", {
      cursor: undefined,
      pageSize: 100,
      signal: undefined,
    });
    expect(listing.items[0]).toMatchObject({
      entry: { path: "images/blocked.png", is_readable: false, archive_entry_state: "blocked" },
      handle: { kind: "virtual", path: "images/blocked.png" },
    });
  });

  it("preserves the next cursor from storage-backed ZIP listings", async () => {
    const listDirectory = vi.fn().mockResolvedValue({
      archive: { path: "archives/one.zip", size: 1 },
      path: "images",
      items: [],
      total: 2,
      next_cursor: "page-2",
    });
    const resolvedTarget = { target: { kind: "smb", connectionId: "conn-1" } };
    const registry = {
      resolveItem: vi.fn(() => ({ ...resolvedTarget, path: "archives/one.zip", resolvedTarget })),
      getBackend: vi.fn(() => ({ archive: { listDirectory } })),
    };

    const listing = await createStorageBackedContentProviderRegistry(registry as never)
      .get(archiveLocation)
      .list(archiveLocation, { cursor: "page-1" });

    expect(listing.nextCursor).toBe("page-2");
    expect(listDirectory).toHaveBeenCalledWith(expect.anything(), "images", { cursor: "page-1" });
  });

  it("uses source identity in virtual item keys", () => {
    const entry = {
      name: "same.png",
      path: "images/same.png",
      type: FileType.FILE,
      is_readable: true,
      is_hidden: false,
    };
    const otherArchiveLocation = virtualLocation("zip", "conn-1", physicalLocation("conn-1", "archives/two.zip"), "images");

    expect(virtualItem(archiveLocation, entry).key).not.toBe(virtualItem(otherArchiveLocation, entry).key);
  });

  it("reads a virtual item through its provider rather than a physical path", async () => {
    const blob = new Blob(["image"]);
    vi.mocked(api.getArchiveMember).mockResolvedValueOnce(blob);

    await expect(readContent(virtualItemHandle(archiveLocation, "images/photo.png"), { kind: "image", viewportWidth: 800 })).resolves.toBe(
      blob
    );
    expect(api.getArchiveMember).toHaveBeenCalledWith("conn-1", "archives/one.zip", "images/photo.png", {
      download: undefined,
      request: { kind: "image", viewportWidth: 800 },
      signal: undefined,
    });
  });

  it("extracts a local ZIP through its content provider", async () => {
    const localArchiveLocation = virtualLocation("zip", "local-drive:c", physicalLocation("local-drive:c", "archives/one.zip"), "");
    vi.mocked(api.startLocalArchiveExtraction).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "streaming",
      revision: 1,
      progress: localArchiveProgress(),
      cancellation_requested: false,
    });
    vi.mocked(api.waitForLocalArchiveExecution).mockImplementationOnce(async (_connectionId, _executionId, onUpdate) => {
      onUpdate?.({
        execution_id: "local-extract-1",
        phase: "streaming",
        revision: 1,
        progress: localArchiveProgress(2, 0, 3, 10),
        cancellation_requested: false,
        files_extracted: 1,
        directories_created: 1,
        extracted_bytes: 5,
        files_skipped: 0,
      });
      const completed = {
        execution_id: "local-extract-1",
        phase: "completed" as const,
        revision: 2,
        progress: localArchiveProgress(3, 1, 3, 10),
        cancellation_requested: false,
        files_extracted: 2,
        directories_created: 1,
        extracted_bytes: 10,
        files_skipped: 1,
      };
      onUpdate?.(completed);
      return completed;
    });

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: localArchiveLocation,
      destination: physicalLocation("local-drive:c", "archives/one"),
    });
    const onProgress = vi.fn();
    execution.onProgress(onProgress);

    await expect(execution.result).resolves.toEqual({
      status: "completed",
      filesSkipped: 1,
      summary: {
        filesExtracted: 2,
        directoriesCreated: 1,
        extractedBytes: 10,
        totalMembers: 3,
        totalBytes: 10,
        filesSkipped: 1,
        filesReplaced: 0,
        partialMembers: 0,
      },
    });

    expect(api.startLocalArchiveExtraction).toHaveBeenCalledWith("local-drive:c", "archives/one.zip", "archives/one");
    expect(api.waitForLocalArchiveExecution).toHaveBeenCalledWith("local-drive:c", "local-extract-1", expect.any(Function));
    expect(onProgress).toHaveBeenCalledWith({
      filesExtracted: 1,
      directoriesCreated: 1,
      extractedBytes: 5,
      totalMembers: 3,
      totalBytes: 10,
      filesSkipped: 0,
      filesReplaced: 0,
      partialMembers: 0,
    });
  });

  it("starts archive extraction through the provider-neutral operation coordinator", async () => {
    vi.mocked(api.prepareArchiveOperation).mockResolvedValueOnce({ id: "extract-1" } as never);
    vi.mocked(api.executeArchiveExtraction).mockResolvedValueOnce({
      phase: "completed",
      checkpoint_json: JSON.stringify({}),
    } as never);
    const destination = physicalLocation("conn-1", "archives/one");

    expect(getArchiveExtractionAvailability(createContentProviderRegistry(), archiveLocation, destination)).toEqual({ available: true });
    await expect(
      startArchiveExtraction(createContentProviderRegistry(), {
        source: archiveLocation,
        destination,
      }).result
    ).resolves.toMatchObject({ status: "completed" });
    vi.clearAllMocks();
  });

  it("resumes a paused direct-local extraction through the Companion decision endpoint", async () => {
    const localArchiveLocation = virtualLocation("zip", "local-drive:c", physicalLocation("local-drive:c", "archives/one.zip"), "");
    vi.mocked(api.startLocalArchiveExtraction).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "streaming",
      revision: 1,
      progress: localArchiveProgress(),
      cancellation_requested: false,
    });
    vi.mocked(api.waitForLocalArchiveExecution)
      .mockResolvedValueOnce({
        execution_id: "local-extract-1",
        phase: "awaiting_user_decision",
        revision: 2,
        progress: localArchiveProgress(),
        cancellation_requested: false,
        pendingDecision: {
          kind: "existing_files",
          conflicts: [{ member_path: "source.txt", target_path: "renamed.txt", is_directory: false }],
          allowed_actions: ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
        },
      })
      .mockResolvedValueOnce({
        execution_id: "local-extract-1",
        phase: "completed",
        revision: 4,
        progress: localArchiveProgress(1),
        cancellation_requested: false,
        files_extracted: 1,
        directories_created: 0,
        extracted_bytes: 5,
        files_skipped: 0,
      });
    vi.mocked(api.decideLocalArchiveExecution).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "streaming",
      revision: 3,
      progress: localArchiveProgress(),
      cancellation_requested: false,
    });

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: localArchiveLocation,
      destination: physicalLocation("local-drive:c", "archives/one"),
    });

    await expect(execution.result).resolves.toMatchObject({
      status: "awaiting-decision",
      conflicts: [{ memberPath: "source.txt", targetPath: "archives/one/renamed.txt", isDirectory: false }],
      allowedActions: ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
    });
    await expect(execution.decide("replace_older", "source.txt")).resolves.toMatchObject({
      status: "completed",
      summary: { filesExtracted: 1 },
    });
    expect(api.decideLocalArchiveExecution).toHaveBeenCalledWith("local-drive:c", "local-extract-1", 2, "source.txt", "replace_older");
  });

  it("retries a paused direct-local member error through the Companion decision endpoint", async () => {
    const localArchiveLocation = virtualLocation("zip", "local-drive:c", physicalLocation("local-drive:c", "archives/one.zip"), "");
    vi.mocked(api.startLocalArchiveExtraction).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "streaming",
      revision: 1,
      progress: localArchiveProgress(),
      cancellation_requested: false,
    });
    vi.mocked(api.waitForLocalArchiveExecution)
      .mockResolvedValueOnce({
        execution_id: "local-extract-1",
        phase: "awaiting_user_decision",
        revision: 2,
        progress: { ...localArchiveProgress(), partialMembers: 1 },
        cancellation_requested: false,
        pendingDecision: {
          kind: "member_error",
          member_path: "source.txt",
          target_path: "archives/one/source.txt",
          message: "archive member integrity check failed",
          partial_output: true,
          allowed_actions: ["retry", "ignore"],
        },
      })
      .mockResolvedValueOnce({
        execution_id: "local-extract-1",
        phase: "completed",
        revision: 4,
        progress: localArchiveProgress(1),
        cancellation_requested: false,
        files_extracted: 1,
        directories_created: 0,
        extracted_bytes: 5,
        files_skipped: 0,
      });
    vi.mocked(api.decideLocalArchiveExecution).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "streaming",
      revision: 3,
      progress: { ...localArchiveProgress(), partialMembers: 1 },
      cancellation_requested: false,
    });

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: localArchiveLocation,
      destination: physicalLocation("local-drive:c", "archives/one"),
    });

    await expect(execution.result).resolves.toMatchObject({
      status: "awaiting-member-error",
      error: {
        memberPath: "source.txt",
        targetPath: "archives/one/source.txt",
        partialOutput: true,
      },
    });
    await expect(execution.decide("retry", "source.txt")).resolves.toMatchObject({
      status: "completed",
      summary: { filesExtracted: 1 },
    });
    expect(api.decideLocalArchiveExecution).toHaveBeenCalledWith("local-drive:c", "local-extract-1", 2, "source.txt", "retry");
  });

  it("cancels a direct-local ZIP extraction through its execution handle", async () => {
    const localArchiveLocation = virtualLocation("zip", "local-drive:c", physicalLocation("local-drive:c", "archives/one.zip"), "");
    vi.mocked(api.startLocalArchiveExtraction).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "streaming",
      revision: 1,
      progress: localArchiveProgress(),
      cancellation_requested: false,
    });
    vi.mocked(api.cancelLocalArchiveExecutionWithRevisionRetry).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "streaming",
      revision: 2,
      progress: localArchiveProgress(),
      cancellation_requested: true,
    });
    vi.mocked(api.waitForLocalArchiveExecution).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "cancelled",
      revision: 3,
      progress: localArchiveProgress(),
      cancellation_requested: true,
    });

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: localArchiveLocation,
      destination: physicalLocation("local-drive:c", "archives/one"),
    });
    await execution.cancel();

    await expect(execution.result).resolves.toEqual({ status: "interrupted" });
    expect(api.cancelLocalArchiveExecutionWithRevisionRetry).toHaveBeenCalledWith("local-drive:c", "local-extract-1", 1);
  });

  it("uses the shared direct-local cancellation helper after a progress revision race", async () => {
    const localArchiveLocation = virtualLocation("zip", "local-drive:c", physicalLocation("local-drive:c", "archives/one.zip"), "");
    vi.mocked(api.startLocalArchiveExtraction).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "streaming",
      revision: 1,
      progress: localArchiveProgress(),
      cancellation_requested: false,
    });
    vi.mocked(api.cancelLocalArchiveExecutionWithRevisionRetry).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "streaming",
      revision: 3,
      progress: localArchiveProgress(),
      cancellation_requested: true,
    });
    vi.mocked(api.waitForLocalArchiveExecution).mockResolvedValueOnce({
      execution_id: "local-extract-1",
      phase: "cancelled",
      revision: 4,
      progress: localArchiveProgress(),
      cancellation_requested: true,
    });

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: localArchiveLocation,
      destination: physicalLocation("local-drive:c", "archives/one"),
    });
    await execution.cancel();

    await expect(execution.result).resolves.toEqual({ status: "interrupted" });
    expect(api.cancelLocalArchiveExecutionWithRevisionRetry).toHaveBeenCalledWith("local-drive:c", "local-extract-1", 1);
  });

  it("routes a local archive to an SMB destination through the Companion", async () => {
    const localArchiveLocation = virtualLocation("zip", "local-drive:c", physicalLocation("local-drive:c", "archives/one.zip"), "");
    vi.mocked(api.prepareArchiveOperation).mockResolvedValueOnce({ id: "extract-1" } as never);
    vi.mocked(api.getArchiveCompanionSession).mockResolvedValueOnce({ token: "session-token" } as never);
    vi.mocked(api.extractLocalArchiveToSmb).mockResolvedValueOnce({ files_skipped: 0 } as never);

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: localArchiveLocation,
      destination: physicalLocation("conn-1", "output"),
    });

    await expect(execution.result).resolves.toMatchObject({
      status: "completed",
      filesSkipped: 0,
      summary: { filesSkipped: 0, filesReplaced: 0, partialMembers: 0 },
    });
    expect(api.extractLocalArchiveToSmb).toHaveBeenCalledWith("local-drive:c", "archives/one.zip", "extract-1", "session-token");
  });

  it("resumes a paused local-to-SMB extraction through the Companion", async () => {
    const localArchiveLocation = virtualLocation("zip", "local-drive:c", physicalLocation("local-drive:c", "archives/one.zip"), "");
    vi.mocked(api.prepareArchiveOperation).mockResolvedValueOnce({ id: "extract-1" } as never);
    vi.mocked(api.getArchiveCompanionSession).mockResolvedValue({ token: "session-token" } as never);
    vi.mocked(api.extractLocalArchiveToSmb)
      .mockResolvedValueOnce({
        files_extracted: 0,
        directories_created: 1,
        extracted_bytes: 0,
        files_skipped: 0,
        phase: "awaiting_user_decision",
        checkpoint_json: JSON.stringify({
          version: 2,
          manifest: [],
          source_snapshot: { size: 0, modified_at: null },
          member_outcomes: {},
          decisions: { collision_actions: {}, rename_targets: {}, ignored_members: [], retry_members: [] },
          pending_decision: null,
          delivery_ids: {},
        }),
        pending_decision_json: JSON.stringify({
          allowed_actions: ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
          conflicts: [{ member_path: "readme.txt", target_path: "output/readme.txt", is_directory: false }],
        }),
      } as never)
      .mockResolvedValueOnce({ files_extracted: 1, directories_created: 1, extracted_bytes: 5, files_skipped: 0 } as never);
    vi.mocked(api.decideArchiveExtraction).mockResolvedValueOnce({ phase: "streaming" } as never);

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: localArchiveLocation,
      destination: physicalLocation("conn-1", "output"),
    });

    await expect(execution.result).resolves.toMatchObject({ status: "awaiting-decision" });
    await expect(execution.decide("skip_all")).resolves.toMatchObject({ status: "completed", summary: { filesExtracted: 1 } });
    expect(vi.mocked(api.extractLocalArchiveToSmb).mock.calls.slice(-2)).toEqual([
      ["local-drive:c", "archives/one.zip", "extract-1", "session-token"],
      ["local-drive:c", "archives/one.zip", "extract-1", "session-token"],
    ]);
    expect(api.executeArchiveExtraction).not.toHaveBeenCalled();
  });

  it("routes an SMB archive to a local destination through the Companion", async () => {
    vi.mocked(api.prepareArchiveOperation).mockResolvedValueOnce({ id: "extract-1" } as never);
    vi.mocked(api.getArchiveCompanionSession).mockResolvedValueOnce({ token: "session-token" } as never);
    vi.mocked(api.extractSmbArchiveToLocal).mockResolvedValueOnce({ files_skipped: 0 } as never);

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: archiveLocation,
      destination: physicalLocation("local-drive:c", "output"),
    });

    await expect(execution.result).resolves.toMatchObject({
      status: "completed",
      filesSkipped: 0,
      summary: { filesSkipped: 0, filesReplaced: 0, partialMembers: 0 },
    });
    expect(api.extractSmbArchiveToLocal).toHaveBeenCalledWith("local-drive:c", "output", "extract-1", "session-token");
  });

  it("resumes a paused SMB-to-local extraction through the Companion", async () => {
    vi.mocked(api.prepareArchiveOperation).mockResolvedValueOnce({ id: "extract-1" } as never);
    vi.mocked(api.getArchiveCompanionSession).mockResolvedValue({ token: "session-token" } as never);
    vi.mocked(api.extractSmbArchiveToLocal)
      .mockResolvedValueOnce({
        files_extracted: 0,
        directories_created: 1,
        extracted_bytes: 0,
        files_skipped: 0,
        phase: "awaiting_user_decision",
        checkpoint_json: JSON.stringify({
          version: 2,
          manifest: [],
          source_snapshot: { size: 0, modified_at: null },
          member_outcomes: {},
          decisions: { collision_actions: {}, rename_targets: {}, ignored_members: [], retry_members: [] },
          pending_decision: null,
          delivery_ids: {},
        }),
        pending_decision_json: JSON.stringify({
          allowed_actions: ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
          conflicts: [{ member_path: "readme.txt", target_path: "output/readme.txt", is_directory: false }],
        }),
      } as never)
      .mockResolvedValueOnce({ files_extracted: 1, directories_created: 1, extracted_bytes: 5, files_skipped: 0 } as never);
    vi.mocked(api.decideArchiveExtraction).mockResolvedValueOnce({ phase: "streaming" } as never);

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: archiveLocation,
      destination: physicalLocation("local-drive:c", "output"),
    });

    await expect(execution.result).resolves.toMatchObject({ status: "awaiting-decision" });
    await expect(execution.decide("skip_all")).resolves.toMatchObject({ status: "completed", summary: { filesExtracted: 1 } });
    expect(vi.mocked(api.extractSmbArchiveToLocal).mock.calls.slice(-2)).toEqual([
      ["local-drive:c", "output", "extract-1", "session-token"],
      ["local-drive:c", "output", "extract-1", "session-token"],
    ]);
    expect(api.executeArchiveExtraction).not.toHaveBeenCalled();
  });

  it("rejects unsupported cross-connection archive extraction pairs", async () => {
    vi.clearAllMocks();
    const localArchiveLocation = virtualLocation("zip", "local-drive:c", physicalLocation("local-drive:c", "archives/one.zip"), "");
    const otherSmbArchiveLocation = virtualLocation("zip", "conn-1", physicalLocation("conn-1", "archives/one.zip"), "");

    await expect(
      startArchiveExtraction(createContentProviderRegistry(), {
        source: localArchiveLocation,
        destination: physicalLocation("local-drive:d", "output"),
      }).result
    ).rejects.toThrow("between local drives");
    await expect(
      startArchiveExtraction(createContentProviderRegistry(), {
        source: otherSmbArchiveLocation,
        destination: physicalLocation("conn-2", "output"),
      }).result
    ).rejects.toThrow("between SMB connections");
    expect(api.prepareArchiveOperation).not.toHaveBeenCalled();
  });

  it("preserves a server collision decision and resumes the same extraction operation", async () => {
    vi.mocked(api.prepareArchiveOperation).mockResolvedValueOnce({ id: "extract-1" } as never);
    vi.mocked(api.executeArchiveExtraction)
      .mockResolvedValueOnce({
        phase: "awaiting_user_decision",
        pending_decision_json: JSON.stringify({
          allowed_actions: ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
          conflicts: [{ member_path: "docs/readme.txt", target_path: "output/docs/readme.txt" }],
        }),
      } as never)
      .mockResolvedValueOnce({
        phase: "awaiting_user_decision",
        pending_decision_json: JSON.stringify({
          allowed_actions: ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
          conflicts: [{ member_path: "images/cover.png", target_path: "output/images/cover.png" }],
        }),
      } as never)
      .mockResolvedValueOnce({ phase: "completed", checkpoint_json: JSON.stringify({ files_skipped: 2 }) } as never);
    vi.mocked(api.decideArchiveExtraction)
      .mockResolvedValueOnce({ phase: "streaming" } as never)
      .mockResolvedValueOnce({ phase: "streaming" } as never);

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: archiveLocation,
      destination: physicalLocation("conn-1", "output"),
    });

    await expect(execution.result).resolves.toEqual({
      status: "awaiting-decision",
      allowedActions: ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
      conflicts: [{ memberPath: "docs/readme.txt", targetPath: "output/docs/readme.txt", isDirectory: undefined }],
    });
    await expect(execution.decide("skip", "docs/readme.txt")).resolves.toEqual({
      status: "awaiting-decision",
      allowedActions: ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"],
      conflicts: [{ memberPath: "images/cover.png", targetPath: "output/images/cover.png", isDirectory: undefined }],
    });
    await expect(execution.decide("replace_older", "images/cover.png")).resolves.toMatchObject({
      status: "completed",
      filesSkipped: 2,
      summary: { filesSkipped: 2, filesReplaced: 0, partialMembers: 0 },
    });

    expect(api.decideArchiveExtraction).toHaveBeenNthCalledWith(1, "extract-1", "skip", "docs/readme.txt", undefined);
    expect(api.decideArchiveExtraction).toHaveBeenNthCalledWith(2, "extract-1", "replace_older", undefined, undefined);
    expect(api.executeArchiveExtraction).toHaveBeenNthCalledWith(3, "extract-1");
  });

  it("preserves a retryable member error and resumes after an ignore decision", async () => {
    vi.mocked(api.prepareArchiveOperation).mockResolvedValueOnce({ id: "extract-1" } as never);
    vi.mocked(api.executeArchiveExtraction)
      .mockResolvedValueOnce({
        phase: "awaiting_user_decision",
        pending_decision_json: JSON.stringify({
          kind: "member_error",
          member_path: "docs/readme.txt",
          target_path: "output/docs/readme.txt",
          message: "Disk full",
          partial_output: true,
          allowed_actions: ["retry", "ignore"],
        }),
      } as never)
      .mockResolvedValueOnce({ phase: "completed", checkpoint_json: JSON.stringify({ files_skipped: 1 }) } as never);
    vi.mocked(api.decideArchiveExtraction).mockResolvedValueOnce({ phase: "streaming" } as never);

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: archiveLocation,
      destination: physicalLocation("conn-1", "output"),
    });

    await expect(execution.result).resolves.toEqual({
      status: "awaiting-member-error",
      error: {
        memberPath: "docs/readme.txt",
        targetPath: "output/docs/readme.txt",
        message: "Disk full",
        partialOutput: true,
      },
    });
    await expect(execution.decide("ignore", "docs/readme.txt")).resolves.toMatchObject({
      status: "completed",
      filesSkipped: 1,
      summary: { filesSkipped: 1, filesReplaced: 0, partialMembers: 0 },
    });

    expect(api.decideArchiveExtraction).toHaveBeenCalledWith("extract-1", "ignore", "docs/readme.txt", undefined);
  });

  it("reports durable partial member outcomes in a terminal extraction summary", async () => {
    vi.mocked(api.prepareArchiveOperation).mockResolvedValueOnce({ id: "extract-1" } as never);
    vi.mocked(api.executeArchiveExtraction).mockResolvedValueOnce({
      phase: "completed",
      checkpoint_json: JSON.stringify({ member_outcomes: { "docs/readme.txt": { status: "partial" } } }),
    } as never);

    const execution = startArchiveExtraction(createContentProviderRegistry(), {
      source: archiveLocation,
      destination: physicalLocation("conn-1", "output"),
    });

    await expect(execution.result).resolves.toMatchObject({ status: "completed", summary: { partialMembers: 1 } });
  });

  it("reads physical raw content from the original-byte endpoint", async () => {
    const blob = new Blob(["original"]);
    vi.mocked(api.getOriginalFileBlob).mockResolvedValueOnce(blob);

    await expect(
      readContent({ kind: "physical", location: physicalLocation("conn-1", "photos"), path: "photos/photo.jxl" }, { kind: "raw" })
    ).resolves.toBe(blob);

    expect(api.getOriginalFileBlob).toHaveBeenCalledWith("conn-1", "photos/photo.jxl", { signal: undefined });
    expect(api.getFileBlob).not.toHaveBeenCalled();
  });

  it("reuses a virtual source for another member in the same provider", async () => {
    const blob = new Blob(["document"]);
    vi.mocked(api.getArchiveMember).mockResolvedValueOnce(blob);

    await expect(
      readVirtualContent(virtualItemHandle(archiveLocation, "images/photo.png"), "docs/readme.md", { download: true })
    ).resolves.toBe(blob);
    expect(api.getArchiveMember).toHaveBeenCalledWith("conn-1", "archives/one.zip", "docs/readme.md", {
      download: true,
      request: { kind: "raw" },
      signal: undefined,
    });
  });

  it("uses the same image request for physical and virtual viewer sources", async () => {
    const physicalBlob = new Blob(["physical"]);
    const archiveBlob = new Blob(["archive"]);
    vi.mocked(api.getImageBlob).mockResolvedValueOnce(physicalBlob);
    vi.mocked(api.getArchiveMember).mockResolvedValueOnce(archiveBlob);
    const request = { kind: "image", viewportWidth: 1280, viewportHeight: 720 } as const;

    await expect(readViewerContent("conn-1", "photos/photo.jxl", request)).resolves.toBe(physicalBlob);
    await expect(
      readViewerContent("conn-1", "images/photo.jxl", request, { virtualSource: virtualItemHandle(archiveLocation, "images/photo.jxl") })
    ).resolves.toBe(archiveBlob);

    expect(api.getImageBlob).toHaveBeenCalledWith("conn-1", "photos/photo.jxl", {
      signal: undefined,
      viewportWidth: 1280,
      viewportHeight: 720,
      no_resizing: undefined,
    });
    expect(api.getArchiveMember).toHaveBeenCalledWith("conn-1", "archives/one.zip", "images/photo.jxl", {
      download: undefined,
      request,
      signal: undefined,
    });
  });

  it("starts physical viewer editing through the resolved storage backend", async () => {
    const target = { kind: "smb" as const, connectionId: "conn-1" };
    const source = {
      target,
      path: "/docs/readme.md",
      resolvedTarget: { target, connection: null, capabilitySnapshot: {} as never },
    };
    const session = { heartbeat: vi.fn(), writeText: vi.fn(), release: vi.fn() };
    const begin = vi.fn().mockResolvedValue({ kind: "acquired", session });
    const registry = {
      resolveItem: vi.fn(() => source),
      getBackend: vi.fn(() => ({ editing: { begin } })),
    };

    const result = await beginViewerTextEdit("conn-1", "/docs/readme.md", createStorageBackedContentProviderRegistry(registry as never));

    expect(registry.resolveItem).toHaveBeenCalledWith({ connectionId: "conn-1", path: "/docs/readme.md" });
    expect(begin).toHaveBeenCalledWith(source);
    expect(result).toEqual({ kind: "acquired", session });
  });

  it("invalidates physical and virtual PDF derivatives through their providers", async () => {
    const screenProfile = { width: 1280, height: 720, zoomPercent: 200 };

    await invalidateViewerPdfDerivative("conn-1", "docs/physical.pdf", screenProfile);
    await invalidateViewerPdfDerivative("conn-1", "docs/inside.pdf", screenProfile, virtualItemHandle(archiveLocation, "docs/inside.pdf"));

    expect(api.invalidatePdfDerivative).toHaveBeenCalledWith("conn-1", "docs/physical.pdf", screenProfile);
    expect(api.invalidateArchiveMemberPdfDerivative).toHaveBeenCalledWith("conn-1", "archives/one.zip", "docs/inside.pdf", screenProfile);
  });
});
