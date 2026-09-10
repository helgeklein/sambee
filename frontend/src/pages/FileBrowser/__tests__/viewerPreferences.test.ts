import { beforeEach, describe, expect, it, vi } from "vitest";

const { associations, commitMock, refreshMock } = vi.hoisted(() => ({
  associations: { value: {} as Record<string, string> },
  commitMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("../../../services/userSettingsStore", () => ({
  refreshCurrentUserSettings: refreshMock,
  userSettingsStore: {
    getValue: () => ({ confirmedValue: associations.value, commit: commitMock }),
  },
}));

import { getPreferredViewerId, getViewerAssociationKeys, setPreferredViewerId } from "../viewerPreferences";

describe("viewerPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshMock.mockResolvedValue(undefined);
    commitMock.mockResolvedValue(undefined);
    associations.value = {};
  });

  it("returns MIME-based associations before extension fallback", async () => {
    associations.value = { "mime:application/pdf": "pdf", "ext:.pdf": "markdown" };

    await expect(getPreferredViewerId("report.pdf", "application/pdf")).resolves.toBe("pdf");
  });

  it("falls back to the extension when MIME is generic", async () => {
    associations.value = { "ext:.md": "markdown" };

    await expect(getPreferredViewerId("notes.md", "application/octet-stream")).resolves.toBe("markdown");
  });

  it("ignores invalid stored viewer identifiers", async () => {
    associations.value = { "mime:application/pdf": "spreadsheet" };

    await expect(getPreferredViewerId("report.pdf", "application/pdf")).resolves.toBeNull();
  });

  it("commits both MIME and extension associations as one field", async () => {
    associations.value = { "mime:text/plain": "markdown" };

    await setPreferredViewerId("report.pdf", "application/pdf", "pdf");

    expect(commitMock).toHaveBeenCalledWith({
      "mime:text/plain": "markdown",
      "mime:application/pdf": "pdf",
      "ext:.pdf": "pdf",
    });
  });

  it("builds MIME-first association keys", () => {
    expect(getViewerAssociationKeys("report.pdf", "application/pdf")).toEqual(["mime:application/pdf", "ext:.pdf"]);
    expect(getViewerAssociationKeys("notes.md", "application/octet-stream")).toEqual(["ext:.md"]);
  });
});
