import { describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import { FileType } from "../../types";
import {
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
    getPdfBlob: vi.fn(),
    listArchiveDirectory: vi.fn(),
    listDirectory: vi.fn(),
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

  it("invalidates physical and virtual PDF derivatives through their providers", async () => {
    const screenProfile = { width: 1280, height: 720, zoomPercent: 200 };

    await invalidateViewerPdfDerivative("conn-1", "docs/physical.pdf", screenProfile);
    await invalidateViewerPdfDerivative("conn-1", "docs/inside.pdf", screenProfile, virtualItemHandle(archiveLocation, "docs/inside.pdf"));

    expect(api.invalidatePdfDerivative).toHaveBeenCalledWith("conn-1", "docs/physical.pdf", screenProfile);
    expect(api.invalidateArchiveMemberPdfDerivative).toHaveBeenCalledWith("conn-1", "archives/one.zip", "docs/inside.pdf", screenProfile);
  });
});
