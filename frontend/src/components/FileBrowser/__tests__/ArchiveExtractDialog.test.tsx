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
  archiveName: "project.zip",
  initialDestinationName: "project",
  open: true,
  isExtracting: false,
  error: null as string | null,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
};

describe("ArchiveExtractDialog", () => {
  it("prefills the provider-supplied destination name", () => {
    render(<ArchiveExtractDialog {...defaultProps} />);

    expect(screen.getByLabelText("fileBrowser.archive.destinationLabel")).toHaveValue("project");
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

  it("replaces the form with an active progress view while extraction is pending", () => {
    const onCancelExtraction = vi.fn();
    render(<ArchiveExtractDialog {...defaultProps} isExtracting={true} onCancelExtraction={onCancelExtraction} />);

    expect(screen.queryByLabelText("fileBrowser.archive.destinationLabel")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "fileBrowser.archive.buttonCancelExtraction" })).toBeEnabled();
  });

  it("shows determinate direct-local extraction progress", () => {
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        progressSummary={{
          filesExtracted: 2,
          directoriesCreated: 1,
          extractedBytes: 12,
          totalMembers: 6,
          totalBytes: 24,
          filesSkipped: 0,
          filesReplaced: 0,
          partialMembers: 0,
        }}
      />
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("fileBrowser.archive.progressCurrentItem: project.zip")).toBeInTheDocument();
  });

  it("offers retry and ignore for a failed member while keeping cancellation available", async () => {
    const user = userEvent.setup();
    const onMemberErrorDecision = vi.fn();
    const onCancelExtraction = vi.fn();
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        memberError={{
          memberPath: "docs/readme.txt",
          targetPath: "output/docs/readme.txt",
          message: "Disk full",
          partialOutput: true,
        }}
        onMemberErrorDecision={onMemberErrorDecision}
        onCancelExtraction={onCancelExtraction}
      />
    );

    expect(screen.getByText(/Disk full/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonRetryMemberError" }));
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonIgnoreMemberError" }));
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonCancelExtraction" }));

    expect(onMemberErrorDecision).toHaveBeenNthCalledWith(1, "retry");
    expect(onMemberErrorDecision).toHaveBeenNthCalledWith(2, "ignore");
    expect(onCancelExtraction).toHaveBeenCalledOnce();
  });

  it("keeps collision decisions inside the active extraction dialog", async () => {
    const user = userEvent.setup();
    const onConflictDecision = vi.fn();
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[{ member_path: "docs/readme.txt", target_path: "output/docs/readme.txt" }]}
        allowedConflictActions={["skip_all"]}
        onConflictDecision={onConflictDecision}
      />
    );

    expect(screen.getByText("docs/readme.txt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonSkipAll" }));

    expect(onConflictDecision).toHaveBeenCalledWith("skip_all");
  });
});
