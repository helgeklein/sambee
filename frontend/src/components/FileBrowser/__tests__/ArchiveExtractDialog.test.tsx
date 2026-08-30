import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArchiveExtractDialog } from "../ArchiveExtractDialog";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
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

function mockMobileMode(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: isMobile,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe("ArchiveExtractDialog", () => {
  it("prefills the provider-supplied destination name", () => {
    render(<ArchiveExtractDialog {...defaultProps} />);

    expect(screen.getByLabelText("fileBrowser.archive.destinationLabel")).toHaveValue("project");
  });

  it("uses the shared labelled read-only destination field when the destination is fixed", () => {
    render(<ArchiveExtractDialog {...defaultProps} requiresDestinationName={false} destinationLabel="Demo:/Test" />);

    expect(screen.getByLabelText("fileBrowser.archive.destinationLabel")).toHaveValue("Demo:/Test");
    expect(screen.getByLabelText("fileBrowser.archive.destinationLabel")).toHaveAttribute("readonly");
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

  it("cancels active extraction when Escape is pressed", () => {
    const onCancelExtraction = vi.fn();
    render(<ArchiveExtractDialog {...defaultProps} isExtracting={true} onCancelExtraction={onCancelExtraction} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onCancelExtraction).toHaveBeenCalledOnce();
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
    expect(screen.getByText("fileBrowser.archive.progressSourceArchive: project.zip")).toBeInTheDocument();
  });

  it("uses one member-error choice and a single continue action", async () => {
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
    await user.click(screen.getByRole("radio", { name: "fileBrowser.archive.memberErrorChoiceIgnore" }));
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.collisionContinue" }));
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonCancelExtraction" }));

    expect(onMemberErrorDecision).toHaveBeenCalledWith("ignore");
    expect(onCancelExtraction).toHaveBeenCalledOnce();
  });

  it("retains the member-error recovery controls after a failed decision", async () => {
    const user = userEvent.setup();
    const onMemberErrorDecision = vi.fn();
    const memberError = {
      memberPath: "docs/readme.txt",
      targetPath: "output/docs/readme.txt",
      message: "Disk full",
      partialOutput: true,
    };
    const { rerender } = render(
      <ArchiveExtractDialog {...defaultProps} isExtracting={true} memberError={memberError} onMemberErrorDecision={onMemberErrorDecision} />
    );

    await user.click(screen.getByRole("radio", { name: "fileBrowser.archive.memberErrorChoiceIgnore" }));
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.collisionContinue" }));
    rerender(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        error="fileBrowser.archive.extractError"
        memberError={memberError}
        onMemberErrorDecision={onMemberErrorDecision}
      />
    );

    expect(screen.getByText("Disk full")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "fileBrowser.archive.memberErrorChoiceIgnore" })).toBeChecked();
    expect(screen.getByRole("button", { name: "fileBrowser.archive.collisionContinue" })).toBeEnabled();
  });

  it("uses one collision choice and a single continue action", async () => {
    const user = userEvent.setup();
    const onConflictDecision = vi.fn();
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[{ memberPath: "docs/readme.txt", targetPath: "output/docs/readme.txt" }]}
        allowedConflictActions={["skip", "skip_all", "replace", "replace_all", "rename"]}
        onConflictDecision={onConflictDecision}
      />
    );

    expect(screen.getByText("docs/readme.txt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "fileBrowser.archive.buttonSkipAll" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "fileBrowser.archive.collisionApplyRemaining" }));
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.collisionContinue" }));

    expect(onConflictDecision).toHaveBeenCalledWith("skip_all", "docs/readme.txt", undefined);
  });

  it("continues the safe collision resolution with Enter", async () => {
    const onConflictDecision = vi.fn();
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[{ memberPath: "docs/readme.txt", targetPath: "output/docs/readme.txt" }]}
        allowedConflictActions={["skip", "rename"]}
        onConflictDecision={onConflictDecision}
      />
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "fileBrowser.archive.collisionContinue" })).toBeEnabled());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    expect(onConflictDecision).toHaveBeenCalledWith("skip", "docs/readme.txt", undefined);
  });

  it("keeps the phone actions reachable for collision decisions", () => {
    mockMobileMode(true);
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[{ memberPath: "docs/readme.txt", targetPath: "output/docs/readme.txt" }]}
        allowedConflictActions={["skip", "rename"]}
        onConflictDecision={vi.fn()}
        onCancelExtraction={vi.fn()}
      />
    );

    const actions = screen.getByTestId("responsive-form-dialog-mobile-actions");
    expect(within(actions).getByRole("button", { name: "fileBrowser.archive.buttonCancelExtraction" })).toBeEnabled();
    expect(within(actions).getByRole("button", { name: "fileBrowser.archive.collisionContinue" })).toBeEnabled();
  });

  it("shows only the current conflict from a large collision payload", () => {
    mockMobileMode(false);
    const conflicts = Array.from({ length: 1000 }, (_, index) => ({
      memberPath: `member-${index}.txt`,
      targetPath: `output/member-${index}.txt`,
    }));
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={conflicts}
        allowedConflictActions={["skip", "rename"]}
        onConflictDecision={vi.fn()}
        onCancelExtraction={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue("member-0.txt")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("member-999.txt")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("responsive-form-dialog-desktop-actions")).getAllByRole("button")).toHaveLength(2);
  });
});
