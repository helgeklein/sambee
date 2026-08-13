import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/utils/test-utils";
import { FileBrowserSettings } from "../FileBrowserSettings";

const { clearRecentFilesMock, publishRecentFilesChangedMock, setIncludeDotDirectoriesMock } = vi.hoisted(() => ({
  clearRecentFilesMock: vi.fn(),
  publishRecentFilesChangedMock: vi.fn(),
  setIncludeDotDirectoriesMock: vi.fn(),
}));

vi.mock("../FileBrowser/preferences", () => ({
  useQuickNavIncludeDotDirectoriesPreference: () => [false, setIncludeDotDirectoriesMock],
}));

vi.mock("../../services/api", () => ({
  default: {
    clearRecentFiles: clearRecentFilesMock,
  },
}));

vi.mock("../../services/recentFilesSync", () => ({
  publishRecentFilesChanged: publishRecentFilesChangedMock,
}));

describe("FileBrowserSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRecentFilesMock.mockResolvedValue(0);
  });

  it("renders the quick navigation settings group", () => {
    render(<FileBrowserSettings />);

    expect(screen.getByText("File Browser")).toBeInTheDocument();
    expect(screen.getByText("Quick navigation")).toBeInTheDocument();
    expect(screen.queryByText("Choose how quick navigation discovers folders in the file browser.")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include dot directories in quick nav" })).toBeInTheDocument();
  });

  it("updates the dot-directory preference", async () => {
    const user = userEvent.setup();
    render(<FileBrowserSettings />);

    await user.click(screen.getByRole("checkbox", { name: "Include dot directories in quick nav" }));
    expect(setIncludeDotDirectoriesMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(setIncludeDotDirectoriesMock).toHaveBeenCalledWith(true);
  });

  it("cancels clear-history confirmation and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<FileBrowserSettings />);

    const trigger = screen.getByRole("button", { name: "Clear recent files" });
    trigger.focus();
    await user.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "This permanently removes your File Search history from the server without affecting any files or folders."
    );
    expect(dialog).not.toHaveTextContent("This does not affect any files or folders.");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveClass("MuiButton-outlined");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    expect(clearRecentFilesMock).not.toHaveBeenCalled();
  });

  it("shows a pending state, publishes success, and restores trigger focus after clearing history", async () => {
    const user = userEvent.setup();
    let resolveClear: ((deletedCount: number) => void) | undefined;
    clearRecentFilesMock.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveClear = resolve;
        })
    );
    render(<FileBrowserSettings />);

    const trigger = screen.getByRole("button", { name: "Clear recent files" });
    trigger.focus();
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Clear recent files" });
    await user.click(confirm);

    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();

    resolveClear?.(3);

    await waitFor(() => {
      expect(clearRecentFilesMock).toHaveBeenCalledOnce();
      expect(publishRecentFilesChangedMock).toHaveBeenCalledOnce();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("keeps the confirmation open and shows an error when clearing history fails", async () => {
    const user = userEvent.setup();
    clearRecentFilesMock.mockRejectedValueOnce(new Error("network failure"));
    render(<FileBrowserSettings />);

    await user.click(screen.getByRole("button", { name: "Clear recent files" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear recent files" }));

    expect(await screen.findByText("Could not clear recent files. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(publishRecentFilesChangedMock).not.toHaveBeenCalled();
  });
});
