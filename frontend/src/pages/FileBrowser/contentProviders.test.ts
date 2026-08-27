import { describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import { FileType } from "../../types";
import {
  beginViewerTextEdit,
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
    extractLocalArchive: vi.fn(),
    prepareArchiveOperation: vi.fn(),
    executeArchiveExtraction: vi.fn(),
    decideArchiveExtraction: vi.fn(),
    cancelArchiveOperation: vi.fn(),
    getPdfBlob: vi.fn(),
    listArchiveDirectory: vi.fn(),
    listDirectory: vi.fn(),
    saveTextFile: vi.fn(),
  },
}));

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
    vi.mocked(api.extractLocalArchive).mockResolvedValueOnce({
      files_extracted: 2,
      directories_created: 1,
      extracted_bytes: 10,
      files_skipped: 1,
    });

    const execution = getContentProvider(localArchiveLocation).startExtraction(localArchiveLocation, "archives/one");

    await expect(execution.result).resolves.toEqual({
      status: "completed",
      filesSkipped: 1,
    });

    expect(api.extractLocalArchive).toHaveBeenCalledWith("local-drive:c", "archives/one.zip", "archives/one", expect.any(AbortSignal));
  });

  it("cancels a direct-local ZIP extraction through its execution handle", async () => {
    const localArchiveLocation = virtualLocation("zip", "local-drive:c", physicalLocation("local-drive:c", "archives/one.zip"), "");
    vi.mocked(api.extractLocalArchive).mockImplementationOnce(
      (_connectionId, _archivePath, _destinationPath, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Request aborted", "AbortError")), { once: true });
        }) as never
    );

    const execution = getContentProvider(localArchiveLocation).startExtraction(localArchiveLocation, "archives/one");
    await execution.cancel();

    await expect(execution.result).resolves.toEqual({ status: "cancelled" });
  });

  it("preserves a server collision decision and resumes the same extraction operation", async () => {
    vi.mocked(api.prepareArchiveOperation).mockResolvedValueOnce({ id: "extract-1" } as never);
    vi.mocked(api.executeArchiveExtraction)
      .mockResolvedValueOnce({
        phase: "awaiting_user_decision",
        pending_decision_json: JSON.stringify({
          conflicts: [{ member_path: "docs/readme.txt", target_path: "output/docs/readme.txt" }],
        }),
      } as never)
      .mockResolvedValueOnce({ phase: "completed", checkpoint_json: JSON.stringify({ files_skipped: 2 }) } as never);
    vi.mocked(api.decideArchiveExtraction).mockResolvedValueOnce({ phase: "streaming" } as never);

    const execution = getContentProvider(archiveLocation).startExtraction(archiveLocation, "output");

    await expect(execution.result).resolves.toEqual({
      status: "awaiting-decision",
      conflicts: [{ memberPath: "docs/readme.txt", targetPath: "output/docs/readme.txt", isDirectory: undefined }],
    });
    await expect(execution.decide("replace_older")).resolves.toEqual({ status: "completed", filesSkipped: 2 });

    expect(api.decideArchiveExtraction).toHaveBeenCalledWith("extract-1", "replace_older", undefined, undefined);
    expect(api.executeArchiveExtraction).toHaveBeenNthCalledWith(2, "extract-1");
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
