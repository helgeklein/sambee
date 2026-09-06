import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArchiveExtractDialog } from "../ArchiveExtractDialog";
import { OVERWRITE_CONFLICT_STRINGS as S } from "../overwriteConflictStrings";

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

const conflict = {
  source: { path: "docs/readme.txt", size: 1024, modifiedAt: "2025-01-01T12:00:00Z" },
  target: { path: "output/docs/readme.txt", size: 2048, modifiedAt: "2025-01-02T12:00:00Z" },
  isDirectory: false,
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

  it("focuses Extract and uses code formatting when the destination is fixed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ArchiveExtractDialog {...defaultProps} requiresDestinationName={false} destinationLabel="Demo:/Test" onConfirm={onConfirm} />);

    const destination = screen.getByLabelText("fileBrowser.archive.destinationLabel");
    expect(destination).toHaveValue("Demo:/Test");
    expect(destination).toHaveAttribute("readonly");
    expect(destination).not.toHaveAttribute("wrap");
    expect(screen.queryByText("fileBrowser.archive.destinationLabel")).not.toBeInTheDocument();
    expect(screen.getByTestId("archive-extract-prompt-name").tagName).toBe("CODE");
    const extractButton = screen.getByRole("button", { name: "fileBrowser.archive.buttonExtract" });
    await waitFor(() => expect(extractButton).toHaveFocus());
    await user.keyboard("{Enter}");

    expect(onConfirm).toHaveBeenCalledWith("");
  });

  it("rejects traversal destination paths", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ArchiveExtractDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.clear(screen.getByLabelText("fileBrowser.archive.destinationLabel"));
    await user.type(screen.getByLabelText("fileBrowser.archive.destinationLabel"), "../outside");
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonExtract" }));

    expect(await screen.findByText("fileBrowser.archive.validationDestinationUnsafe")).toBeInTheDocument();
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

  it("offers direct retry and skip actions for a member error", async () => {
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
    expect(screen.getByRole("heading", { name: "fileBrowser.archive.memberErrorTitle" })).toBeInTheDocument();
    expect(screen.getByText("fileBrowser.archive.memberErrorPrompt")).toBeInTheDocument();
    expect(screen.getByText("fileBrowser.archive.memberErrorPartialOutputNote")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "fileBrowser.archive.buttonRetryMemberError" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonIgnoreMemberError" }));
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonCancelExtraction" }));

    expect(onMemberErrorDecision).toHaveBeenCalledWith("ignore");
    expect(onCancelExtraction).toHaveBeenCalledOnce();
  });

  it("retains direct member-error recovery actions after a failed decision", async () => {
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

    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonIgnoreMemberError" }));
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
    expect(screen.getByRole("button", { name: "fileBrowser.archive.buttonIgnoreMemberError" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "fileBrowser.archive.buttonRetryMemberError" })).toBeEnabled();
  });

  it("uses the shared overwrite dialog and maps bulk skip to the archive protocol", async () => {
    const user = userEvent.setup();
    const onConflictDecision = vi.fn();
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[conflict]}
        allowedConflictActions={["skip", "skip_all", "replace", "replace_all", "rename"]}
        onConflictDecision={onConflictDecision}
      />
    );

    expect(screen.getByRole("heading", { name: S.TITLE })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: S.LABEL_TARGET_NAME })).toHaveValue("readme.txt");
    expect(screen.getByTestId("overwrite-conflict-source-path")).toHaveTextContent("docs");
    expect(screen.getByTestId("overwrite-conflict-target-path")).toHaveTextContent("output/docs");
    await user.click(screen.getByRole("checkbox", { name: S.APPLY_TO_ALL }));
    await user.click(screen.getByRole("button", { name: S.BUTTON_CONTINUE }));

    expect(onConflictDecision).toHaveBeenCalledWith("skip_all", "docs/readme.txt", undefined);
  });

  it("continues the safe collision resolution with Enter", async () => {
    const onConflictDecision = vi.fn();
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[conflict]}
        allowedConflictActions={["skip", "rename"]}
        onConflictDecision={onConflictDecision}
      />
    );

    await waitFor(() => expect(screen.getByRole("button", { name: S.BUTTON_CONTINUE })).toBeEnabled());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    expect(onConflictDecision).toHaveBeenCalledWith("skip", "docs/readme.txt", undefined);
  });

  it("maps Rename to an archive-relative target path", async () => {
    const user = userEvent.setup();
    const onConflictDecision = vi.fn();
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[conflict]}
        allowedConflictActions={["rename"]}
        onConflictDecision={onConflictDecision}
      />
    );

    await user.click(screen.getByRole("radio", { name: S.BUTTON_RENAME }));
    const targetName = screen.getByRole("textbox", { name: S.LABEL_TARGET_NAME });
    await user.clear(targetName);
    await user.type(targetName, "renamed.txt");
    await user.click(screen.getByRole("button", { name: S.BUTTON_CONTINUE }));

    expect(onConflictDecision).toHaveBeenCalledWith("rename", "docs/readme.txt", "docs/renamed.txt");
  });

  it("resets resolution and Target name when the current conflict changes", async () => {
    const user = userEvent.setup();
    const firstConflict = conflict;
    const { rerender } = render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[firstConflict]}
        allowedConflictActions={["skip", "rename"]}
        onConflictDecision={vi.fn()}
      />
    );

    await user.click(screen.getByRole("radio", { name: S.BUTTON_RENAME }));
    const targetName = screen.getByRole("textbox", { name: S.LABEL_TARGET_NAME });
    await user.clear(targetName);
    await user.type(targetName, "custom-name.txt");

    rerender(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[
          {
            ...conflict,
            source: { ...conflict.source, path: "notes/readme.txt" },
            target: { ...conflict.target, path: "output/notes/readme.txt" },
          },
        ]}
        allowedConflictActions={["skip", "rename"]}
        onConflictDecision={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByRole("radio", { name: S.BUTTON_SKIP })).toBeChecked());
    expect(screen.getByRole("textbox", { name: S.LABEL_TARGET_NAME })).toHaveValue("readme.txt");
  });

  it("does not show a bulk checkbox when only a bulk archive action is allowed", async () => {
    const user = userEvent.setup();
    const onConflictDecision = vi.fn();
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[conflict]}
        allowedConflictActions={["skip_all"]}
        onConflictDecision={onConflictDecision}
      />
    );

    expect(screen.queryByRole("checkbox", { name: S.APPLY_TO_ALL })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: S.BUTTON_CONTINUE }));

    expect(onConflictDecision).toHaveBeenCalledWith("skip_all", "docs/readme.txt", undefined);
  });

  it("keeps the phone actions reachable for collision decisions", () => {
    mockMobileMode(true);
    render(
      <ArchiveExtractDialog
        {...defaultProps}
        isExtracting={true}
        conflicts={[conflict]}
        allowedConflictActions={["skip", "rename"]}
        onConflictDecision={vi.fn()}
        onCancelExtraction={vi.fn()}
      />
    );

    const actions = screen.getByTestId("responsive-form-dialog-mobile-actions");
    expect(within(actions).getByRole("button", { name: S.CANCEL_OPERATION("extract") })).toBeEnabled();
    expect(within(actions).getByRole("button", { name: S.BUTTON_CONTINUE })).toBeEnabled();
  });

  it("shows only the current conflict from a large collision payload", () => {
    mockMobileMode(false);
    const conflicts = Array.from({ length: 1000 }, (_, index) => ({
      source: { path: `member-${index}.txt`, size: null, modifiedAt: null },
      target: { path: `output/member-${index}.txt`, size: null, modifiedAt: null },
      isDirectory: false,
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

    expect(screen.getByTestId("overwrite-conflict-source-path")).toHaveTextContent("/");
    expect(screen.queryByDisplayValue("member-999.txt")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("responsive-form-dialog-desktop-actions")).getAllByRole("button")).toHaveLength(2);
  });
});
