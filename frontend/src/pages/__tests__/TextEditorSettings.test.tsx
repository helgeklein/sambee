import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/utils/test-utils";
import { TextEditorSettings } from "../TextEditorSettings";

const { setTextEditorMaxFileSizeBytesMock } = vi.hoisted(() => ({
  setTextEditorMaxFileSizeBytesMock: vi.fn(),
}));

vi.mock("../FileBrowser/preferences", () => ({
  useTextEditorMaxFileSizeBytesPreference: () => [52428800, setTextEditorMaxFileSizeBytesMock],
}));

describe("TextEditorSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the text editor limits settings group", () => {
    render(<TextEditorSettings />);

    expect(screen.getByText("Text Editor")).toBeInTheDocument();
    expect(screen.getByText("Limits")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Maximum rich editor file size (MB)" })).toBeInTheDocument();
  });

  it("updates the max file size preference in megabytes", async () => {
    const user = userEvent.setup();
    render(<TextEditorSettings />);

    const input = screen.getByRole("spinbutton", { name: "Maximum rich editor file size (MB)" });
    await user.clear(input);
    await user.type(input, "8");

    expect(setTextEditorMaxFileSizeBytesMock).toHaveBeenLastCalledWith(8388608);
  });
});
