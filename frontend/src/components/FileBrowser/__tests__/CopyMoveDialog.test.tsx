/**
 * CopyMoveDialog Component Tests
 *
 * Verifies:
 * - Renders correct title for copy vs move mode
 * - Displays file list and truncation for large selections
 * - Shows a prominent read-only destination field
 * - Single-item: shows editable file name, confirms with rename
 * - Multi-item: no file name field, confirms without rename
 * - Cancel calls onCancel
 * - Buttons disabled during processing
 * - Progress bar shown during processing
 * - Cross-connection warning shown when connections differ
 * - Same-directory warning shown when source === dest
 * - Error message displayed when present
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../../../types";
import { FileType } from "../../../types";
import CopyMoveDialog from "../CopyMoveDialog";
import { COPY_MOVE_STRINGS as S } from "../copyMoveDialogStrings";

// ============================================================================
// Helpers
// ============================================================================

function createFile(name: string): FileEntry {
  return { name, path: name, type: FileType.FILE, size: 100, modified_at: "2025-01-01T00:00:00", is_readable: true, is_hidden: false };
}

const defaultProps = {
  open: true,
  mode: "copy" as const,
  files: [createFile("readme.txt"), createFile("notes.md")],
  destinationLabel: "My Server:/backup",
  isSameDirectory: false,
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  isProcessing: false,
  progress: undefined,
  error: null,
};

// ============================================================================
// Tests
// ============================================================================

describe("CopyMoveDialog", () => {
  it("renders copy title when mode is copy", () => {
    render(<CopyMoveDialog {...defaultProps} mode="copy" />);
    expect(screen.getByRole("heading", { name: S.TITLE_COPY })).toBeInTheDocument();
  });

  it("renders move title when mode is move", () => {
    render(<CopyMoveDialog {...defaultProps} mode="move" />);
    expect(screen.getByRole("heading", { name: S.TITLE_MOVE })).toBeInTheDocument();
  });

  it("shows single-item copy prompt with destination", () => {
    const props = { ...defaultProps, files: [createFile("readme.txt")] };
    render(<CopyMoveDialog {...props} mode="copy" />);
    const itemName = screen.getByTestId("copy-move-prompt-item-name");
    const destination = screen.getByTestId("copy-move-prompt-destination");
    expect(itemName).toHaveTextContent("readme.txt");
    expect(itemName.tagName).toBe("CODE");
    expect(destination).toHaveTextContent("My Server:/backup");
    expect(destination.tagName).toBe("CODE");
    expect(itemName.parentElement).toHaveTextContent("readme.txt will be copied to My Server:/backup:");
    expect(itemName.parentElement).not.toHaveTextContent('"readme.txt"');
    expect(screen.queryByLabelText(S.LABEL_DESTINATION)).not.toBeInTheDocument();
    expect(screen.queryByTestId("LockOutlinedIcon")).not.toBeInTheDocument();
    expect(screen.getByLabelText(S.LABEL_FILENAME)).toHaveValue("readme.txt");
  });

  it("shows multi-item copy prompt with destination", () => {
    render(<CopyMoveDialog {...defaultProps} mode="copy" />);
    expect(screen.getByText(S.PROMPT_COPY_MULTI(2))).toBeInTheDocument();
    const destination = screen.getByLabelText(S.LABEL_DESTINATION);
    expect(destination).toHaveValue("My Server:/backup");
    expect(screen.queryByText(S.LABEL_DESTINATION)).not.toBeInTheDocument();
    expect(destination).not.toHaveAttribute("wrap");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("shows move single-item prompt with destination", () => {
    const props = { ...defaultProps, mode: "move" as const, files: [createFile("readme.txt")] };
    render(<CopyMoveDialog {...props} />);
    expect(screen.getByTestId("copy-move-prompt-item-name").parentElement).toHaveTextContent(
      "readme.txt will be moved to My Server:/backup:"
    );
    expect(screen.getByTestId("copy-move-prompt-destination")).toHaveTextContent("My Server:/backup");
    expect(screen.queryByLabelText(S.LABEL_DESTINATION)).not.toBeInTheDocument();
  });

  it("shows the provider-provided root destination label", () => {
    render(<CopyMoveDialog {...defaultProps} destinationLabel="My Server:/" />);
    expect(screen.getByText(S.PROMPT_COPY_MULTI(2))).toBeInTheDocument();
    expect(screen.getByLabelText(S.LABEL_DESTINATION)).toHaveValue("My Server:/");
  });

  it("does not show editable destination path field for multi-item", () => {
    render(<CopyMoveDialog {...defaultProps} />);
    expect(screen.queryByLabelText(S.LABEL_FILENAME)).not.toBeInTheDocument();
  });

  it("shows editable file name field for single-item copy", () => {
    const props = { ...defaultProps, files: [createFile("readme.txt")] };
    render(<CopyMoveDialog {...props} />);
    const input = screen.getByLabelText(S.LABEL_FILENAME) as HTMLInputElement;
    expect(input.value).toBe("readme.txt");
  });

  it("calls onConfirm with no rename for multi-item", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CopyMoveDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: S.BUTTON_COPY }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("preserves leading whitespace in a single-item rename", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const props = { ...defaultProps, files: [createFile("readme.txt")], onConfirm };
    render(<CopyMoveDialog {...props} />);

    const input = screen.getByLabelText(S.LABEL_FILENAME);
    await user.clear(input);
    await user.type(input, "  renamed.txt");
    await user.click(screen.getByRole("button", { name: S.BUTTON_COPY }));

    expect(onConfirm).toHaveBeenCalledWith("  renamed.txt");
  });

  it("rejects a single-item rename with trailing whitespace", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const props = { ...defaultProps, files: [createFile("readme.txt")], onConfirm };
    render(<CopyMoveDialog {...props} />);

    const input = screen.getByLabelText(S.LABEL_FILENAME);
    await user.clear(input);
    await user.type(input, "renamed.txt ");

    expect(screen.getByText("Names cannot end in a space or period.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm with no rename when single-item name is unchanged", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const props = { ...defaultProps, files: [createFile("readme.txt")], onConfirm };
    render(<CopyMoveDialog {...props} />);

    await user.click(screen.getByRole("button", { name: S.BUTTON_COPY }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<CopyMoveDialog {...defaultProps} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: S.BUTTON_CANCEL }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("confirms on Enter in the file name field (single-item)", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const props = { ...defaultProps, files: [createFile("readme.txt")], onConfirm };
    render(<CopyMoveDialog {...props} />);

    const input = screen.getByLabelText(S.LABEL_FILENAME);
    await user.click(input);
    await user.keyboard("{Enter}");

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("disables confirm button during processing", () => {
    render(<CopyMoveDialog {...defaultProps} isProcessing={true} progress={{ current: 1, total: 2 }} />);
    const dialog = screen.getByRole("dialog");
    const copyingBtn = within(dialog).getByRole("button", { name: /copying/i });
    expect(copyingBtn).toBeDisabled();
  });

  it("shows progress bar during processing", () => {
    render(<CopyMoveDialog {...defaultProps} isProcessing={true} progress={{ current: 1, total: 3 }} />);
    expect(screen.getByText(S.PROGRESS_COPY(1, 3))).toBeInTheDocument();
    // Both CircularProgress (button spinner) and LinearProgress render as progressbar
    const bars = screen.getAllByRole("progressbar");
    expect(bars.length).toBeGreaterThanOrEqual(1);
  });

  it("shows move progress text during move processing", () => {
    render(<CopyMoveDialog {...defaultProps} mode="move" isProcessing={true} progress={{ current: 2, total: 5 }} />);
    expect(screen.getByText(S.PROGRESS_MOVE(2, 5))).toBeInTheDocument();
  });

  it("enables confirm for distinct locations", () => {
    render(<CopyMoveDialog {...defaultProps} isSameDirectory={false} />);
    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeEnabled();
  });

  it("shows same-directory warning for multi-item when source and destination match", () => {
    render(<CopyMoveDialog {...defaultProps} isSameDirectory />);
    expect(screen.getByText(S.ERROR_SAME_DIRECTORY)).toBeInTheDocument();
    expect(screen.getByTestId("copy-move-destination-error")).toHaveClass("MuiAlert-colorError");
  });

  it("disables confirm for multi-item when source and destination match", () => {
    render(<CopyMoveDialog {...defaultProps} isSameDirectory />);
    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeDisabled();
  });

  it("allows single-item confirm in same directory with different name", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const props = {
      ...defaultProps,
      files: [createFile("readme.txt")],
      isSameDirectory: true,
      onConfirm,
    };
    render(<CopyMoveDialog {...props} />);

    const input = screen.getByLabelText(S.LABEL_FILENAME);
    await user.clear(input);
    await user.type(input, "readme-copy.txt");
    await user.click(screen.getByRole("button", { name: S.BUTTON_COPY }));

    expect(onConfirm).toHaveBeenCalledWith("readme-copy.txt");
  });

  it("suggests a valid copy name for a single item copied to its current directory", async () => {
    const onConfirm = vi.fn();
    const props = {
      ...defaultProps,
      files: [createFile("readme.txt")],
      isSameDirectory: true,
      onConfirm,
    };
    const user = userEvent.setup();
    render(<CopyMoveDialog {...props} />);

    expect(screen.getByLabelText(S.LABEL_FILENAME)).toHaveValue("readme (copy).txt");
    expect(screen.getByLabelText(S.LABEL_FILENAME)).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(S.ERROR_SAME_FILENAME)).not.toBeInTheDocument();
    expect(screen.queryByTestId("copy-move-destination-error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: S.BUTTON_COPY }));
    expect(onConfirm).toHaveBeenCalledWith("readme (copy).txt");
  });

  it("shows a detailed filename error when a same-directory target is changed back to its original name", async () => {
    const user = userEvent.setup();
    const props = {
      ...defaultProps,
      files: [createFile("readme.txt")],
      isSameDirectory: true,
    };
    render(<CopyMoveDialog {...props} />);

    const fileNameInput = screen.getByLabelText(S.LABEL_FILENAME);
    expect(fileNameInput).toHaveValue("readme (copy).txt");
    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeEnabled();

    await user.clear(fileNameInput);
    await user.type(fileNameInput, "readme.txt");

    expect(screen.getByText(S.ERROR_SAME_FILENAME)).toBeInTheDocument();
    expect(fileNameInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeDisabled();
  });

  it("preserves the final extension when suggesting a same-directory copy name", () => {
    const props = {
      ...defaultProps,
      files: [createFile("archive.tar.gz")],
      isSameDirectory: true,
    };
    render(<CopyMoveDialog {...props} />);

    expect(screen.getByLabelText(S.LABEL_FILENAME)).toHaveValue("archive.tar (copy).gz");
  });

  it("requires an explicit new name for a same-directory move", () => {
    const props = {
      ...defaultProps,
      mode: "move" as const,
      files: [createFile("readme.txt")],
      isSameDirectory: true,
    };
    render(<CopyMoveDialog {...props} />);

    expect(screen.getByLabelText(S.LABEL_FILENAME)).toHaveValue("readme.txt");
    expect(screen.getByText(S.ERROR_SAME_FILENAME)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: S.BUTTON_MOVE })).toBeDisabled();
  });

  it("allows operations when provider marks locations as distinct", () => {
    const props = {
      ...defaultProps,
      isSameDirectory: false,
    };
    render(<CopyMoveDialog {...props} />);

    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeEnabled();
    expect(screen.getByTestId("copy-move-destination-error")).not.toBeVisible();
  });

  it("shows error message when error prop is set", () => {
    render(<CopyMoveDialog {...defaultProps} error="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("disables confirm when file name is empty (single-item)", async () => {
    const user = userEvent.setup();
    const props = { ...defaultProps, files: [createFile("readme.txt")] };
    render(<CopyMoveDialog {...props} />);

    const input = screen.getByLabelText(S.LABEL_FILENAME);
    await user.clear(input);

    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeDisabled();
    expect(screen.getByText(S.WARN_EMPTY_FILENAME)).toBeInTheDocument();
  });

  it("shows Move button label in move mode", () => {
    render(<CopyMoveDialog {...defaultProps} mode="move" />);
    expect(screen.getByRole("button", { name: S.BUTTON_MOVE })).toBeInTheDocument();
  });

  it("does not render when not open", () => {
    render(<CopyMoveDialog {...defaultProps} open={false} />);
    expect(screen.queryByText(S.TITLE_COPY)).not.toBeInTheDocument();
  });

  it("shows byte-level transfer progress during processing", () => {
    render(
      <CopyMoveDialog
        {...defaultProps}
        isProcessing={true}
        progress={{ current: 1, total: 2 }}
        transferProgress={{ bytesTransferred: 5242880, totalBytes: 10485760, itemName: "big-file.zip" }}
      />
    );
    expect(screen.getByText(/big-file\.zip/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/10\.0 MB/)).toBeInTheDocument();
  });

  it("shows indeterminate progress when total bytes unknown", () => {
    render(
      <CopyMoveDialog
        {...defaultProps}
        isProcessing={true}
        progress={{ current: 1, total: 2 }}
        transferProgress={{ bytesTransferred: 1024, totalBytes: null, itemName: "unknown-size.dat" }}
      />
    );
    expect(screen.getByText(/unknown-size\.dat/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 KB/)).toBeInTheDocument();
  });
});
