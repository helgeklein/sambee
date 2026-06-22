import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadCurrentUserSettingsMock, patchCurrentUserSettingsMock } = vi.hoisted(() => ({
  loadCurrentUserSettingsMock: vi.fn(),
  patchCurrentUserSettingsMock: vi.fn(),
}));

vi.mock("../../../services/userSettingsSync", () => ({
  loadCurrentUserSettings: loadCurrentUserSettingsMock,
  patchCurrentUserSettings: patchCurrentUserSettingsMock,
}));

import { getPreferredViewerId, getViewerAssociationKeys, setPreferredViewerId } from "../viewerPreferences";

describe("viewerPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns MIME-based associations before extension fallback", async () => {
    loadCurrentUserSettingsMock.mockResolvedValue({
      browser: {
        viewer_associations: {
          "mime:application/pdf": "pdf",
          "ext:.pdf": "markdown",
        },
      },
    });

    await expect(getPreferredViewerId("report.pdf", "application/pdf")).resolves.toBe("pdf");
  });

  it("falls back to the extension when MIME is generic", async () => {
    loadCurrentUserSettingsMock.mockResolvedValue({
      browser: {
        viewer_associations: {
          "ext:.md": "markdown",
        },
      },
    });

    await expect(getPreferredViewerId("notes.md", "application/octet-stream")).resolves.toBe("markdown");
  });

  it("ignores invalid stored viewer identifiers", async () => {
    loadCurrentUserSettingsMock.mockResolvedValue({
      browser: {
        viewer_associations: {
          "mime:application/pdf": "spreadsheet",
        },
      },
    });

    await expect(getPreferredViewerId("report.pdf", "application/pdf")).resolves.toBeNull();
  });

  it("stores both MIME and extension associations when available", async () => {
    loadCurrentUserSettingsMock.mockResolvedValue({
      browser: {
        viewer_associations: {
          "mime:text/plain": "markdown",
        },
      },
    });
    patchCurrentUserSettingsMock.mockResolvedValue(null);

    await setPreferredViewerId("report.pdf", "application/pdf", "pdf");

    expect(patchCurrentUserSettingsMock).toHaveBeenCalledWith({
      browser: {
        viewer_associations: {
          "mime:text/plain": "markdown",
          "mime:application/pdf": "pdf",
          "ext:.pdf": "pdf",
        },
      },
    });
  });

  it("builds MIME-first association keys", () => {
    expect(getViewerAssociationKeys("report.pdf", "application/pdf")).toEqual(["mime:application/pdf", "ext:.pdf"]);
    expect(getViewerAssociationKeys("notes.md", "application/octet-stream")).toEqual(["ext:.md"]);
  });
});
