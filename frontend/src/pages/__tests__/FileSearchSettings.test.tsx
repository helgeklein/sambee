import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/utils/test-utils";
import type { FileSearchSettingsRead } from "../../types";
import { FileSearchSettings } from "../FileSearchSettings";

const { publishRecentFilesChangedMock } = vi.hoisted(() => ({
  publishRecentFilesChangedMock: vi.fn(),
}));

vi.mock("../../services/api", () => ({
  default: {
    getFileSearchSettings: vi.fn(),
    updateFileSearchSettings: vi.fn(),
  },
}));

vi.mock("../../services/recentFilesSync", () => ({
  publishRecentFilesChanged: publishRecentFilesChangedMock,
}));

import api from "../../services/api";

const systemOverride: FileSearchSettingsRead = {
  settings: {
    retention_limit: 50,
    result_limit: 10,
    excluded_categories: ["images", "temporary_backup"],
    excluded_extensions: [],
  },
  source: "database",
};

describe("FileSearchSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getFileSearchSettings).mockResolvedValue(systemOverride);
    vi.mocked(api.updateFileSearchSettings).mockResolvedValue(systemOverride);
  });

  it("validates values locally and saves normalized extensions added to the list", async () => {
    const user = userEvent.setup();
    render(<FileSearchSettings />);

    const retentionLimit = await screen.findByLabelText("Recent files to retain");
    await user.clear(retentionLimit);
    await user.type(retentionLimit, "501");

    expect(screen.getByText("Enter a whole number from 0 to 500.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await user.clear(retentionLimit);
    await user.type(retentionLimit, "25");
    const extensionInput = screen.getByLabelText("Add excluded extension");
    await user.type(extensionInput, "bak");
    expect(screen.getByText("Will be saved as .bak.")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await user.type(extensionInput, ".TMP");
    await user.click(screen.getByRole("button", { name: "Add extension" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(api.updateFileSearchSettings).toHaveBeenCalledWith({
        settings: {
          ...systemOverride.settings,
          retention_limit: 25,
          excluded_extensions: [".bak", ".tmp"],
        },
      });
    });
    expect(publishRecentFilesChangedMock).toHaveBeenCalledOnce();
  });

  it("groups category exclusions and omits the policy-source message", async () => {
    render(<FileSearchSettings />);

    const categoryGroup = await screen.findByRole("group", { name: "Exclude file categories" });
    expect(categoryGroup).toContainElement(screen.getByRole("checkbox", { name: "Exclude images" }));
    expect(categoryGroup).toContainElement(screen.getByRole("checkbox", { name: "Exclude temporary and backup files" }));
    expect(screen.getByText("Excluded files are omitted from File Search results and history.")).toBeInTheDocument();
    expect(screen.queryByText("Using built-in defaults.")).not.toBeInTheDocument();
    expect(screen.queryByText("Using the system override.")).not.toBeInTheDocument();
  });

  it("removes an extension from the list and rejects invalid literal entries", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getFileSearchSettings).mockResolvedValue({
      ...systemOverride,
      settings: { ...systemOverride.settings, excluded_extensions: [".bak"] },
    });
    render(<FileSearchSettings />);

    const extensionInput = await screen.findByLabelText("Add excluded extension");
    await user.type(extensionInput, "*.tmp");
    await user.click(screen.getByRole("button", { name: "Add extension" }));
    expect(screen.getByText("Use literal extensions up to 255 characters; glob patterns and paths are not allowed.")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Remove .bak"));
    expect(screen.queryByText(".bak")).not.toBeInTheDocument();
  });

  it("does not render a reset action", async () => {
    render(<FileSearchSettings />);

    await screen.findByLabelText("Recent files to retain");

    expect(screen.queryByRole("button", { name: "Reset to default" })).not.toBeInTheDocument();
  });
});
