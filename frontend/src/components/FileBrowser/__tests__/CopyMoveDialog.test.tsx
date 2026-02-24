/**
 * CopyMoveDialog Component Tests
 *
 * Verifies:
 * - Renders correct title for copy vs move mode
 * - Displays file list and truncation for large selections
 * - Shows editable destination path
 * - Confirm calls onConfirm with edited destination
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

function createFile(name: string, type: FileType = FileType.FILE): FileEntry {
  return { name, path: name, type, size: 100, modified_at: "2025-01-01T00:00:00", is_readable: true, is_hidden: false };
}

const CONNECTION_ID = "conn-1";
const DEST_CONNECTION_ID = "conn-1";
const SOURCE_PATH = "docs";
const DEST_PATH = "backup";

const defaultProps = {
  open: true,
  mode: "copy" as const,
  files: [createFile("readme.txt"), createFile("notes.md")],
  sourceConnectionId: CONNECTION_ID,
  sourcePath: SOURCE_PATH,
  destConnectionId: DEST_CONNECTION_ID,
  destConnectionName: "My Server",
  destPath: DEST_PATH,
  isSameConnection: true,
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

  it("shows single-item prompt for one file", () => {
    const props = { ...defaultProps, files: [createFile("readme.txt")] };
    render(<CopyMoveDialog {...props} mode="copy" />);
    expect(screen.getByText(S.PROMPT_COPY_SINGLE)).toBeInTheDocument();
  });

  it("shows multi-item prompt for multiple files", () => {
    render(<CopyMoveDialog {...defaultProps} mode="copy" />);
    expect(screen.getByText(S.PROMPT_COPY_MULTI(2))).toBeInTheDocument();
  });

  it("shows move single-item prompt", () => {
    const props = { ...defaultProps, mode: "move" as const, files: [createFile("readme.txt")] };
    render(<CopyMoveDialog {...props} />);
    expect(screen.getByText(S.PROMPT_MOVE_SINGLE)).toBeInTheDocument();
  });

  it("displays file names in the list", () => {
    render(<CopyMoveDialog {...defaultProps} />);
    expect(screen.getByText("readme.txt")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
  });

  it("shows trailing slash for directories", () => {
    const props = {
      ...defaultProps,
      files: [createFile("Photos", FileType.DIRECTORY)],
    };
    render(<CopyMoveDialog {...props} />);
    expect(screen.getByText("Photos/")).toBeInTheDocument();
  });

  it("truncates long file lists with count", () => {
    const files = Array.from({ length: 12 }, (_, i) => createFile(`file-${i}.txt`));
    render(<CopyMoveDialog {...defaultProps} files={files} />);
    // First 8 should be visible, then "…and 4 more"
    expect(screen.getByText("file-0.txt")).toBeInTheDocument();
    expect(screen.getByText("file-7.txt")).toBeInTheDocument();
    expect(screen.getByText(/…and 4 more/)).toBeInTheDocument();
    expect(screen.queryByText("file-8.txt")).not.toBeInTheDocument();
  });

  it("shows editable destination path pre-filled from props", () => {
    render(<CopyMoveDialog {...defaultProps} />);
    const input = screen.getByLabelText(S.LABEL_DESTINATION) as HTMLInputElement;
    expect(input.value).toBe(DEST_PATH);
  });

  it("shows destination connection name", () => {
    render(<CopyMoveDialog {...defaultProps} />);
    expect(screen.getByText(/My Server/)).toBeInTheDocument();
  });

  it("calls onConfirm with edited destination path", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CopyMoveDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(S.LABEL_DESTINATION);
    await user.clear(input);
    await user.type(input, "new-dest");
    await user.click(screen.getByRole("button", { name: S.BUTTON_COPY }));

    expect(onConfirm).toHaveBeenCalledWith("new-dest");
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<CopyMoveDialog {...defaultProps} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: S.BUTTON_CANCEL }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("confirms on Enter in the text field", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CopyMoveDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(S.LABEL_DESTINATION);
    await user.click(input);
    await user.keyboard("{Enter}");

    expect(onConfirm).toHaveBeenCalledWith(DEST_PATH);
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

  it("shows cross-connection warning when connections differ", () => {
    render(<CopyMoveDialog {...defaultProps} isSameConnection={false} />);
    expect(screen.getByText(S.WARN_CROSS_CONNECTION)).toBeInTheDocument();
  });

  it("disables confirm when connections differ", () => {
    render(<CopyMoveDialog {...defaultProps} isSameConnection={false} />);
    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeDisabled();
  });

  it("shows same-directory warning when source equals dest", () => {
    render(<CopyMoveDialog {...defaultProps} destPath={SOURCE_PATH} />);
    expect(screen.getByText(S.WARN_SAME_DIRECTORY)).toBeInTheDocument();
  });

  it("disables confirm when source equals dest directory", () => {
    render(<CopyMoveDialog {...defaultProps} destPath={SOURCE_PATH} />);
    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeDisabled();
  });

  it("shows error message when error prop is set", () => {
    render(<CopyMoveDialog {...defaultProps} error="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("disables confirm when destination is empty", async () => {
    const user = userEvent.setup();
    render(<CopyMoveDialog {...defaultProps} />);

    const input = screen.getByLabelText(S.LABEL_DESTINATION);
    await user.clear(input);

    expect(screen.getByRole("button", { name: S.BUTTON_COPY })).toBeDisabled();
  });

  it("shows Move button label in move mode", () => {
    render(<CopyMoveDialog {...defaultProps} mode="move" />);
    expect(screen.getByRole("button", { name: S.BUTTON_MOVE })).toBeInTheDocument();
  });

  it("does not render when not open", () => {
    render(<CopyMoveDialog {...defaultProps} open={false} />);
    expect(screen.queryByText(S.TITLE_COPY)).not.toBeInTheDocument();
  });
});
