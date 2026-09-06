import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "./api";
import { PreviewUnavailableError } from "./previewPolicy";
import { CompanionLocalBackend, SambeeSmbBackend } from "./storageBackends";

vi.mock("./api", () => ({
  default: {
    acquireEditLock: vi.fn(),
    getArchiveMember: vi.fn(),
    getImageBlob: vi.fn(),
    getPdfBlob: vi.fn(),
    heartbeatEditLock: vi.fn(),
    releaseEditLock: vi.fn(),
    writeTextWithEditLock: vi.fn(),
  },
}));

describe("SambeeSmbBackend archive reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves download intent when reading an archive member", async () => {
    const blob = new Blob(["original"]);
    vi.mocked(api.getArchiveMember).mockResolvedValueOnce(blob);
    const target = { kind: "smb" as const, connectionId: "connection-1" };
    const source = {
      target,
      path: "archives/photos.zip",
      resolvedTarget: { target, connection: null, capabilitySnapshot: {} as never },
    };

    await expect(
      new SambeeSmbBackend().archive?.readMember(source, "images/photo.jpg", { kind: "image" }, { download: true })
    ).resolves.toBe(blob);

    expect(api.getArchiveMember).toHaveBeenCalledWith("connection-1", "archives/photos.zip", "images/photo.jpg", {
      download: true,
      request: { kind: "image" },
      signal: undefined,
    });
  });

  it("binds SMB text writes to the acquired edit lease", async () => {
    const target = { kind: "smb" as const, connectionId: "connection-1" };
    const source = {
      target,
      path: "docs/readme.txt",
      resolvedTarget: {
        target,
        connection: { access_mode: "read_write" },
        capabilitySnapshot: { companion: { status: "unavailable" } },
      },
    };
    vi.mocked(api.acquireEditLock).mockResolvedValueOnce({
      lock_id: "lock-1",
      lock_capability: "capability-1",
      operation_id: "operation-1",
      file_path: "docs/readme.txt",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });

    const session = await new SambeeSmbBackend().editing?.begin(source as never);
    expect(session?.kind).toBe("acquired");
    if (session?.kind !== "acquired") throw new Error("Expected acquired edit session");

    await session.session.heartbeat();
    await session.session.writeText("updated", { mimeType: "text/plain;charset=utf-8" });
    await session.session.release();
    await session.session.release();

    expect(api.heartbeatEditLock).toHaveBeenCalledWith("connection-1", "docs/readme.txt", expect.objectContaining({ lock_id: "lock-1" }));
    expect(api.writeTextWithEditLock).toHaveBeenCalledWith(
      "connection-1",
      "docs/readme.txt",
      "updated",
      { lock_id: "lock-1", lock_capability: "capability-1", operation_id: "operation-1" },
      { mimeType: "text/plain;charset=utf-8" }
    );
    expect(api.releaseEditLock).toHaveBeenCalledTimes(1);
  });

  it("retries an edit-lock release after a transient failure", async () => {
    const target = { kind: "smb" as const, connectionId: "connection-1" };
    const source = {
      target,
      path: "docs/readme.txt",
      resolvedTarget: {
        target,
        connection: { access_mode: "read_write" },
        capabilitySnapshot: { companion: { status: "unavailable" } },
      },
    };
    vi.mocked(api.acquireEditLock).mockResolvedValueOnce({
      lock_id: "lock-1",
      lock_capability: "capability-1",
      operation_id: "operation-1",
      file_path: "docs/readme.txt",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    vi.mocked(api.releaseEditLock).mockRejectedValueOnce(new Error("Temporary network error")).mockResolvedValueOnce(undefined);

    const session = await new SambeeSmbBackend().editing?.begin(source as never);
    if (session?.kind !== "acquired") throw new Error("Expected acquired edit session");

    await expect(session.session.release()).rejects.toThrow("Temporary network error");
    await expect(session.session.release()).resolves.toBeUndefined();

    expect(api.releaseEditLock).toHaveBeenCalledTimes(2);
  });

  it("rejects local archive image conversions without calling the Companion", () => {
    const target = { kind: "local" as const, driveId: "c" };
    const source = {
      target,
      path: "archives/photos.zip",
      resolvedTarget: { target, connection: null, capabilitySnapshot: {} as never },
    };

    expect(() => new CompanionLocalBackend().archive?.readMember(source, "images/photo.jxl", { kind: "image" })).toThrow(
      PreviewUnavailableError
    );
    expect(api.getArchiveMember).not.toHaveBeenCalled();
  });

  it("allows local browser-native archive images as raw previews", async () => {
    const target = { kind: "local" as const, driveId: "c" };
    const source = {
      target,
      path: "archives/photos.zip",
      resolvedTarget: { target, connection: null, capabilitySnapshot: {} as never },
    };
    const blob = new Blob(["png"]);
    vi.mocked(api.getArchiveMember).mockResolvedValueOnce(blob);

    await expect(new CompanionLocalBackend().archive?.readMember(source, "images/photo.png", { kind: "image" })).resolves.toBe(blob);
    expect(api.getArchiveMember).toHaveBeenCalledWith("local-drive:c", "archives/photos.zip", "images/photo.png", {
      download: undefined,
      request: { kind: "image" },
      signal: undefined,
    });
  });

  it("rejects local archive PDF normalization without calling the Companion", () => {
    const target = { kind: "local" as const, driveId: "c" };
    const source = {
      target,
      path: "archives/reports.zip",
      resolvedTarget: { target, connection: null, capabilitySnapshot: {} as never },
    };
    vi.mocked(api.getArchiveMember).mockClear();

    expect(() => new CompanionLocalBackend().archive?.readMember(source, "report.pdf", { kind: "pdf", variant: "normalized" })).toThrow(
      PreviewUnavailableError
    );
    expect(api.getArchiveMember).not.toHaveBeenCalled();
  });
});
