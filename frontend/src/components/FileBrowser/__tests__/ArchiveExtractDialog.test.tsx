import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArchiveExtractDialog } from "../ArchiveExtractDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const defaultProps = {
  archivePath: "backups/project.zip",
  open: true,
  isExtracting: false,
  error: null as string | null,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
};

describe("ArchiveExtractDialog", () => {
  it("prefills a sibling directory named after the archive", () => {
    render(<ArchiveExtractDialog {...defaultProps} />);

    expect(screen.getByLabelText("fileBrowser.archive.destinationLabel")).toHaveValue("backups/project");
  });

  it("rejects traversal destination paths", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ArchiveExtractDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.clear(screen.getByLabelText("fileBrowser.archive.destinationLabel"));
    await user.type(screen.getByLabelText("fileBrowser.archive.destinationLabel"), "../outside");
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonExtract" }));

    expect(screen.getByText("fileBrowser.archive.validationDestinationUnsafe")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("normalizes separators before submitting a destination", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ArchiveExtractDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.clear(screen.getByLabelText("fileBrowser.archive.destinationLabel"));
    await user.type(screen.getByLabelText("fileBrowser.archive.destinationLabel"), "output\\release");
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonExtract" }));

    expect(onConfirm).toHaveBeenCalledWith("output/release");
  });

  it("disables the form while extraction is pending", () => {
    render(<ArchiveExtractDialog {...defaultProps} isExtracting={true} />);

    expect(screen.getByLabelText("fileBrowser.archive.destinationLabel")).toBeDisabled();
    expect(screen.getByRole("button", { name: "fileBrowser.archive.buttonExtracting" })).toBeDisabled();
  });
});
