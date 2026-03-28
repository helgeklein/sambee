import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/utils/test-utils";
import { FileBrowserSettings } from "../FileBrowserSettings";

const { setIncludeDotDirectoriesMock } = vi.hoisted(() => ({
  setIncludeDotDirectoriesMock: vi.fn(),
}));

vi.mock("../FileBrowser/preferences", () => ({
  useQuickNavIncludeDotDirectoriesPreference: () => [false, setIncludeDotDirectoriesMock],
}));

describe("FileBrowserSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the quick navigation settings group", () => {
    render(<FileBrowserSettings />);

    expect(screen.getByText("File Browser")).toBeInTheDocument();
    expect(screen.getByText("Quick navigation")).toBeInTheDocument();
    expect(screen.getByText("Choose how quick navigation discovers folders in the file browser.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include dot directories in quick nav" })).toBeInTheDocument();
  });

  it("updates the dot-directory preference", async () => {
    const user = userEvent.setup();
    render(<FileBrowserSettings />);

    await user.click(screen.getByRole("checkbox", { name: "Include dot directories in quick nav" }));

    expect(setIncludeDotDirectoriesMock).toHaveBeenCalledWith(true);
  });
});
