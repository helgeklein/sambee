import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/utils/test-utils";
import { TextEditorSettings } from "../TextEditorSettings";

const { commitMock } = vi.hoisted(() => ({
  commitMock: vi.fn(),
}));

vi.mock("../../services/userSettingsStore", () => ({
  useCurrentUserSetting: (field: string) => ({
    confirmedValue: field === "text_editor.max_file_size_bytes" ? 52428800 : "browser",
    pending: false,
    error: null,
    commit: commitMock,
    clearError: vi.fn(),
  }),
}));

describe("TextEditorSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitMock.mockResolvedValue(undefined);
  });

  it("renders the text editor limits settings group", () => {
    render(<TextEditorSettings />);

    expect(screen.getByText("Text Editor")).toBeInTheDocument();
    expect(screen.getByText("Limits")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Maximum rich editor file size (MB)" })).toBeInTheDocument();
  });

  it("updates the max file size preference in megabytes", async () => {
    const user = userEvent.setup();
    render(<TextEditorSettings />);

    const input = screen.getByRole("textbox", { name: "Maximum rich editor file size (MB)" });
    await user.clear(input);
    await user.type(input, "8");

    await user.tab();

    expect(commitMock).toHaveBeenLastCalledWith(8388608);
  });

  it("rejects non-numeric input", async () => {
    const user = userEvent.setup();
    render(<TextEditorSettings />);

    const input = screen.getByRole("textbox", { name: "Maximum rich editor file size (MB)" });
    await user.clear(input);
    await user.type(input, "8MB");

    expect(input).toHaveValue("8");
  });
});
