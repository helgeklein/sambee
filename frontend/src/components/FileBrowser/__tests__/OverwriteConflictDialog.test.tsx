import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type ConflictInfo, FileType } from "../../../types";
import OverwriteConflictDialog from "../OverwriteConflictDialog";
import { OVERWRITE_CONFLICT_STRINGS as S } from "../overwriteConflictStrings";

const conflict: ConflictInfo = {
  incoming_file: {
    name: "report.txt",
    path: "source/report.txt",
    type: FileType.FILE,
    size: 1024,
    modified_at: "2025-01-01T12:00:00Z",
    is_readable: true,
    is_hidden: false,
  },
  existing_file: {
    name: "report.txt",
    path: "target/report.txt",
    type: FileType.FILE,
    size: 2048,
    modified_at: "2025-01-02T12:00:00Z",
    is_readable: true,
    is_hidden: false,
  },
};

describe("OverwriteConflictDialog", () => {
  const defaultProps = {
    open: true,
    conflict,
    allowedActions: ["skip", "overwrite", "overwrite-older", "rename"] as const,
    onResolve: vi.fn(),
    onCancel: vi.fn(),
  };

  it("shows the target directory in the description and source path in metadata", () => {
    render(<OverwriteConflictDialog {...defaultProps} />);

    expect(screen.getByRole("heading", { name: S.TITLE })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: S.LABEL_TARGET_NAME })).toHaveValue("report.txt");
    expect(screen.queryByRole("textbox", { name: S.LABEL_SOURCE_PATH })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: S.LABEL_TARGET_DIRECTORY })).not.toBeInTheDocument();
    expect(screen.getByTestId("overwrite-conflict-target-directory")).toHaveTextContent("target");
    expect(screen.getByTestId("overwrite-conflict-target-directory").tagName).toBe("CODE");
    expect(screen.getByTestId("overwrite-conflict-target-directory")).toHaveStyle({ whiteSpace: "nowrap" });
    const sourcePath = screen.getByTestId("overwrite-conflict-source-path");
    expect(sourcePath).toHaveTextContent("source/report.txt");
    expect(within(sourcePath).getByText("source/report.txt").tagName).toBe("CODE");
    const metadata = screen.getByRole("region", { name: S.METADATA_LABEL });
    const modified = within(metadata).getByText(S.LABEL_MODIFIED);
    const sourcePathLabel = within(metadata).getByText(S.LABEL_SOURCE_PATH);
    expect(modified.compareDocumentPosition(sourcePathLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const comparisonHeaders = screen.getByTestId("overwrite-conflict-desktop-comparison-headers");
    expect(within(comparisonHeaders).getByText(S.LABEL_INCOMING)).toBeInTheDocument();
    expect(within(comparisonHeaders).getByText(S.LABEL_EXISTING)).toBeInTheDocument();
    expect(screen.getByTestId("responsive-form-dialog-desktop-actions")).toBeInTheDocument();
  });

  it("shows owner-supplied connection-qualified source and target paths", () => {
    render(
      <OverwriteConflictDialog
        {...defaultProps}
        sourcePath="Source connection:/archive.zip/source/report.txt"
        targetDirectoryPath="Target connection:/destination"
      />
    );

    expect(screen.getByTestId("overwrite-conflict-target-directory")).toHaveTextContent("Target connection:/destination");
    expect(screen.getByTestId("overwrite-conflict-source-path")).toHaveTextContent("Source connection:/archive.zip/source/report.txt");
  });

  it("preserves long target and path values without creating additional fields", () => {
    const sourceName = `source-${"a".repeat(240)}.txt`;
    const targetName = `target-${"b".repeat(240)}.txt`;
    const targetDirectory = Array.from({ length: 20 }, (_, index) => `directory-${index}`).join("/");
    const longNameConflict: ConflictInfo = {
      incoming_file: { ...conflict.incoming_file, name: sourceName, path: `source/${sourceName}` },
      existing_file: { ...conflict.existing_file, name: targetName, path: `${targetDirectory}/${targetName}` },
    };

    render(<OverwriteConflictDialog {...defaultProps} conflict={longNameConflict} />);

    const targetInput = screen.getByRole("textbox", { name: S.LABEL_TARGET_NAME }) as HTMLInputElement;
    const sourcePath = screen.getByTestId("overwrite-conflict-source-path");
    const targetDirectoryCode = screen.getByTestId("overwrite-conflict-target-directory");

    expect(targetInput).toHaveValue(targetName);
    expect(sourcePath).toHaveTextContent(`source/${sourceName}`);
    expect(within(sourcePath).getByText(`source/${sourceName}`)).toHaveStyle({ overflow: "hidden", whiteSpace: "nowrap" });
    expect(targetDirectoryCode).toHaveTextContent(targetDirectory);
    expect(targetDirectoryCode).toHaveStyle({ whiteSpace: "nowrap" });
    expect(targetInput).toHaveAttribute("readonly");
    targetInput.setSelectionRange(0, targetInput.value.length);
    expect(targetInput.selectionEnd).toBe(targetInput.value.length);
  });

  it("aligns the source path with the source metadata column", () => {
    render(<OverwriteConflictDialog {...defaultProps} />);

    const sourcePath = within(screen.getByTestId("overwrite-conflict-source-path")).getByText("source/report.txt");
    expect(sourcePath).toHaveStyle({ marginLeft: "0px" });
    expect(screen.getByText(S.LABEL_SOURCE_PATH)).toHaveStyle({ alignSelf: "center" });
  });

  it("keeps the description path on the surrounding text baseline", () => {
    render(<OverwriteConflictDialog {...defaultProps} />);

    const targetDirectory = screen.getByTestId("overwrite-conflict-target-directory");
    expect(targetDirectory).toHaveStyle({ whiteSpace: "nowrap" });
  });

  it("focuses Skip and submits the selected bulk resolution", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<OverwriteConflictDialog {...defaultProps} onResolve={onResolve} progress={{ current: 2, total: 3, conflictsSoFar: 1 }} />);

    const skipRadio = screen.getByRole("radio", { name: S.BUTTON_SKIP });
    await waitFor(() => expect(skipRadio).toHaveFocus());
    await user.click(screen.getByRole("radio", { name: S.BUTTON_OVERWRITE }));
    await user.click(screen.getByRole("checkbox", { name: S.APPLY_TO_ALL }));
    await user.click(screen.getByRole("button", { name: S.BUTTON_CONTINUE }));

    expect(onResolve).toHaveBeenCalledWith({ resolution: "overwrite", applyToAll: true, targetName: undefined });
  });

  it("submits the focused safe resolution when Enter is pressed", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<OverwriteConflictDialog {...defaultProps} onResolve={onResolve} />);

    await waitFor(() => expect(screen.getByRole("radio", { name: S.BUTTON_SKIP })).toHaveFocus());
    await user.keyboard("{Enter}");

    expect(onResolve).toHaveBeenCalledWith({ resolution: "skip", applyToAll: false, targetName: undefined });
  });

  it("resets radio selection and keyboard focus for the next conflict", async () => {
    const user = userEvent.setup();
    const nextConflict: ConflictInfo = {
      incoming_file: { ...conflict.incoming_file, path: "source/next-report.txt" },
      existing_file: { ...conflict.existing_file, path: "target/next-report.txt" },
    };
    const { rerender } = render(<OverwriteConflictDialog {...defaultProps} />);

    await waitFor(() => expect(screen.getByRole("radio", { name: S.BUTTON_SKIP })).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: S.BUTTON_OVERWRITE })).toBeChecked();

    rerender(<OverwriteConflictDialog {...defaultProps} conflict={nextConflict} />);

    const skipRadio = screen.getByRole("radio", { name: S.BUTTON_SKIP });
    await waitFor(() => {
      expect(skipRadio).toBeChecked();
      expect(skipRadio).toHaveFocus();
    });
    await user.keyboard("{ArrowDown}");

    const overwriteRadio = screen.getByRole("radio", { name: S.BUTTON_OVERWRITE });
    expect(overwriteRadio).toBeChecked();
    expect(overwriteRadio).toHaveFocus();
  });

  it("focuses the safe resolution after the next conflict's pending state clears", async () => {
    const nextConflict: ConflictInfo = {
      incoming_file: { ...conflict.incoming_file, path: "source/pending-report.txt" },
      existing_file: { ...conflict.existing_file, path: "target/pending-report.txt" },
    };
    const { rerender } = render(<OverwriteConflictDialog {...defaultProps} />);

    rerender(<OverwriteConflictDialog {...defaultProps} conflict={nextConflict} isSubmitting />);
    expect(screen.getByRole("radio", { name: S.BUTTON_SKIP })).toBeChecked();

    rerender(<OverwriteConflictDialog {...defaultProps} conflict={nextConflict} isSubmitting={false} />);

    await waitFor(() => expect(screen.getByRole("radio", { name: S.BUTTON_SKIP })).toHaveFocus());
  });

  it("reserves the bulk-choice slot when a resolution cannot apply to all", async () => {
    const user = userEvent.setup();
    render(<OverwriteConflictDialog {...defaultProps} progress={{ current: 1, total: 3, conflictsSoFar: 1 }} />);

    const bulkChoiceSlot = screen.getByTestId("overwrite-conflict-apply-all-slot");
    expect(bulkChoiceSlot).toHaveStyle({ visibility: "visible" });

    await user.click(screen.getByRole("radio", { name: S.BUTTON_OVERWRITE_ONLY_OLDER }));

    expect(bulkChoiceSlot).toHaveStyle({ visibility: "hidden" });
    expect(screen.queryByRole("checkbox", { name: S.APPLY_TO_ALL })).not.toBeInTheDocument();
  });

  it("clears bulk scope when the resolution changes", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<OverwriteConflictDialog {...defaultProps} onResolve={onResolve} progress={{ current: 2, total: 3, conflictsSoFar: 1 }} />);

    await user.click(screen.getByRole("radio", { name: S.BUTTON_OVERWRITE }));
    const checkbox = screen.getByRole("checkbox", { name: S.APPLY_TO_ALL });
    await user.click(checkbox);
    await user.click(screen.getByRole("radio", { name: S.BUTTON_SKIP }));

    expect(checkbox).not.toBeChecked();
  });

  it("edits the existing Target name field in place for Rename", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<OverwriteConflictDialog {...defaultProps} onResolve={onResolve} />);

    const targetName = screen.getByRole("textbox", { name: S.LABEL_TARGET_NAME });
    expect(targetName.closest(".MuiFormControl-root")?.querySelector(".MuiFormHelperText-root")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: S.BUTTON_RENAME }));

    expect(targetName).toHaveValue("report (copy).txt");
    expect(targetName).not.toHaveAttribute("readonly");
    expect(targetName.closest(".MuiFormControl-root")?.querySelector(".MuiFormHelperText-root")).toBeInTheDocument();
    await user.clear(targetName);
    await user.type(targetName, "renamed.txt");
    await user.click(screen.getByRole("button", { name: S.BUTTON_CONTINUE }));

    expect(onResolve).toHaveBeenCalledWith({ resolution: "rename", applyToAll: false, targetName: "renamed.txt" });
  });

  it("submits Overwrite only older without showing a bulk checkbox", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<OverwriteConflictDialog {...defaultProps} onResolve={onResolve} progress={{ current: 1, total: 3, conflictsSoFar: 1 }} />);

    await user.click(screen.getByRole("radio", { name: S.BUTTON_OVERWRITE_ONLY_OLDER }));

    expect(screen.queryByRole("checkbox", { name: S.APPLY_TO_ALL })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: S.BUTTON_CONTINUE }));

    expect(onResolve).toHaveBeenCalledWith({ resolution: "overwrite-older", applyToAll: false, targetName: undefined });
  });

  it("renders only owner-supported resolution choices", () => {
    render(<OverwriteConflictDialog {...defaultProps} allowedActions={["skip", "overwrite"]} />);

    expect(screen.getByRole("radio", { name: S.BUTTON_SKIP })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: S.BUTTON_OVERWRITE })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: S.BUTTON_OVERWRITE_ONLY_OLDER })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: S.BUTTON_RENAME })).not.toBeInTheDocument();
  });

  it("disables continuation when the owner supplies no resolution choices", () => {
    render(<OverwriteConflictDialog {...defaultProps} allowedActions={[]} />);

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: S.BUTTON_CONTINUE })).toBeDisabled();
  });

  it("explains and focuses the no-resolution state", async () => {
    render(<OverwriteConflictDialog {...defaultProps} allowedActions={[]} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(S.ERROR_NO_RESOLUTION_AVAILABLE);
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("resets the selected resolution when owner capabilities change", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OverwriteConflictDialog {...defaultProps} allowedActions={["skip", "overwrite"]} />);

    await user.click(screen.getByRole("radio", { name: S.BUTTON_OVERWRITE }));
    rerender(<OverwriteConflictDialog {...defaultProps} allowedActions={["skip"]} />);

    await waitFor(() => expect(screen.getByRole("radio", { name: S.BUTTON_SKIP })).toBeChecked());
    expect(screen.queryByRole("radio", { name: S.BUTTON_OVERWRITE })).not.toBeInTheDocument();
  });

  it("omits file metadata for directory conflicts", () => {
    const directoryConflict: ConflictInfo = {
      incoming_file: { ...conflict.incoming_file, type: FileType.DIRECTORY, size: undefined, modified_at: undefined },
      existing_file: { ...conflict.existing_file, type: FileType.DIRECTORY, size: undefined, modified_at: undefined },
    };
    render(<OverwriteConflictDialog {...defaultProps} conflict={directoryConflict} allowedActions={["skip", "rename"]} />);

    expect(screen.queryByText(S.LABEL_SIZE)).not.toBeInTheDocument();
    expect(screen.queryByText(S.LABEL_MODIFIED)).not.toBeInTheDocument();
    expect(screen.queryByTestId("overwrite-conflict-desktop-comparison-headers")).not.toBeInTheDocument();
  });

  it("focuses and selects Target name when Rename is the only available action", async () => {
    render(<OverwriteConflictDialog {...defaultProps} allowedActions={["rename"]} />);

    const targetName = screen.getByRole("textbox", { name: S.LABEL_TARGET_NAME }) as HTMLInputElement;
    await waitFor(() => expect(targetName).toHaveFocus());
    expect(targetName.selectionStart).toBe(0);
    expect(targetName.selectionEnd).toBe(targetName.value.length);
  });

  it("focuses an owner-level error after a failed decision", async () => {
    render(<OverwriteConflictDialog {...defaultProps} error="Unable to save this decision." />);

    const alert = screen.getByRole("alert");
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("cancels the operation on Escape", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<OverwriteConflictDialog {...defaultProps} onCancel={onCancel} />);

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
