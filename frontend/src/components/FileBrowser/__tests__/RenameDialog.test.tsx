/**
 * RenameDialog Component Tests
 *
 * Verifies:
 * - Renders with pre-filled item name
 * - Client-side validation (empty, same name, invalid chars, dot names, trailing)
 * - onConfirm/onClose callbacks fire correctly
 * - Buttons are disabled during isRenaming
 * - API error display
 * - Does not render when open is false
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileType } from "../../../types";
import RenameDialog from "../RenameDialog";
import { RENAME_DIALOG_STRINGS } from "../renameDialogStrings";

describe("RenameDialog", () => {
  const defaultProps = {
    open: true,
    itemName: "readme.txt",
    itemType: FileType.FILE,
    isRenaming: false,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    apiError: null as string | null,
  };

  it("renders with file title and pre-filled name", async () => {
    render(<RenameDialog {...defaultProps} />);

    expect(screen.getByText(RENAME_DIALOG_STRINGS.TITLE_FILE)).toBeInTheDocument();

    await waitFor(() => {
      const input = screen.getByLabelText(RENAME_DIALOG_STRINGS.INPUT_LABEL);
      expect(input).toHaveValue("readme.txt");
    });
  });

  it("renders directory title when itemType is DIRECTORY", () => {
    render(<RenameDialog {...defaultProps} itemName="Photos" itemType={FileType.DIRECTORY} />);

    expect(screen.getByText(RENAME_DIALOG_STRINGS.TITLE_DIRECTORY)).toBeInTheDocument();
  });

  it("calls onConfirm with trimmed new name when Rename is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<RenameDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(RENAME_DIALOG_STRINGS.INPUT_LABEL);
    // Wait for the dialog transition to complete (onEntered auto-focuses and selects)
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, "new-name.txt");
    await user.click(screen.getByRole("button", { name: RENAME_DIALOG_STRINGS.BUTTON_RENAME }));

    expect(onConfirm).toHaveBeenCalledWith("new-name.txt");
  });

  it("calls onClose when Cancel is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RenameDialog {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: RENAME_DIALOG_STRINGS.BUTTON_CANCEL }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits on Enter key press", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<RenameDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(RENAME_DIALOG_STRINGS.INPUT_LABEL);
    await user.clear(input);
    await user.type(input, "new-name.txt");
    await user.keyboard("{Enter}");

    expect(onConfirm).toHaveBeenCalledWith("new-name.txt");
  });

  it("validates empty name", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<RenameDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(RENAME_DIALOG_STRINGS.INPUT_LABEL);
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: RENAME_DIALOG_STRINGS.BUTTON_RENAME }));

    expect(screen.getByText(RENAME_DIALOG_STRINGS.VALIDATION_EMPTY)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("validates unchanged name", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<RenameDialog {...defaultProps} onConfirm={onConfirm} />);

    // Name is already "readme.txt" — click Rename without changing it
    await user.click(screen.getByRole("button", { name: RENAME_DIALOG_STRINGS.BUTTON_RENAME }));

    expect(screen.getByText(RENAME_DIALOG_STRINGS.VALIDATION_SAME)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("validates invalid characters", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<RenameDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(RENAME_DIALOG_STRINGS.INPUT_LABEL);
    await user.clear(input);
    await user.type(input, "file/name.txt");
    await user.click(screen.getByRole("button", { name: RENAME_DIALOG_STRINGS.BUTTON_RENAME }));

    expect(screen.getByText(RENAME_DIALOG_STRINGS.VALIDATION_INVALID_CHARS)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("validates dot names", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<RenameDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(RENAME_DIALOG_STRINGS.INPUT_LABEL);
    await user.clear(input);
    await user.type(input, "..");
    await user.click(screen.getByRole("button", { name: RENAME_DIALOG_STRINGS.BUTTON_RENAME }));

    expect(screen.getByText(RENAME_DIALOG_STRINGS.VALIDATION_DOT_NAMES)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables buttons when isRenaming is true", () => {
    render(<RenameDialog {...defaultProps} isRenaming={true} />);

    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /renaming/i })).toBeDisabled();
  });

  it("shows 'Renaming…' text when isRenaming", () => {
    render(<RenameDialog {...defaultProps} isRenaming={true} />);

    expect(screen.getByText(RENAME_DIALOG_STRINGS.BUTTON_RENAMING)).toBeInTheDocument();
  });

  it("displays API error only in the alert, not in helper text", () => {
    render(<RenameDialog {...defaultProps} apiError="An item named 'readme.txt' already exists" />);

    expect(screen.getByRole("alert")).toHaveTextContent("An item named 'readme.txt' already exists");
    // API errors must not be duplicated in the TextField helper text
    const input = screen.getByLabelText(RENAME_DIALOG_STRINGS.INPUT_LABEL);
    expect(input.closest(".MuiFormControl-root")?.querySelector(".MuiFormHelperText-root")).toBeNull();
  });

  it("does not render when open is false", () => {
    render(<RenameDialog {...defaultProps} open={false} />);

    expect(screen.queryByText(RENAME_DIALOG_STRINGS.TITLE_FILE)).not.toBeInTheDocument();
  });

  it("focuses the input field when dialog opens", async () => {
    render(<RenameDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText(RENAME_DIALOG_STRINGS.INPUT_LABEL)).toHaveFocus();
    });
  });
});
