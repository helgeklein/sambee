import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "./api";
import { SambeeSmbBackend } from "./storageBackends";

vi.mock("./api", () => ({
  default: {
    acquireEditLock: vi.fn(),
    getArchiveMember: vi.fn(),
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
});
