/**
 * CreateItemDialog Component Tests
 *
 * Verifies the Create Item dialog wrapper component:
 * - Renders correct title for file vs directory
 * - Starts with empty input
 * - Uses "Create" / "Creating…" button labels
 * - Passes through API errors
 * - Validates names (via shared NameInputDialog)
 * - Calls onConfirm with the entered name
 * - Calls onClose on Cancel
 * - Disables buttons during isCreating
 * - Does not render when open is false
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileType } from "../../../types";
import CreateItemDialog from "../CreateItemDialog";
import { CREATE_ITEM_DIALOG_STRINGS } from "../createItemDialogStrings";
import { NAME_DIALOG_STRINGS } from "../nameDialogStrings";

const defaultProps = {
  open: true,
  itemType: FileType.DIRECTORY,
  isCreating: false,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  apiError: null as string | null,
};

describe("CreateItemDialog", () => {
  // ── Rendering ──────────────────────────────────────────────────────────

  it("renders with directory title when itemType is DIRECTORY", () => {
    render(<CreateItemDialog {...defaultProps} itemType={FileType.DIRECTORY} />);
    expect(screen.getByText(CREATE_ITEM_DIALOG_STRINGS.TITLE_DIRECTORY)).toBeInTheDocument();
  });

  it("renders with file title when itemType is FILE", () => {
    render(<CreateItemDialog {...defaultProps} itemType={FileType.FILE} />);
    expect(screen.getByText(CREATE_ITEM_DIALOG_STRINGS.TITLE_FILE)).toBeInTheDocument();
  });

  it("renders with empty input field", async () => {
    render(<CreateItemDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL)).toHaveValue("");
    });
  });

  it("renders Create button", () => {
    render(<CreateItemDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATE })).toBeInTheDocument();
  });

  it("renders Cancel button", () => {
    render(<CreateItemDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: NAME_DIALOG_STRINGS.BUTTON_CANCEL })).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<CreateItemDialog {...defaultProps} open={false} />);
    expect(screen.queryByText(CREATE_ITEM_DIALOG_STRINGS.TITLE_DIRECTORY)).not.toBeInTheDocument();
  });

  // ── Focus ──────────────────────────────────────────────────────────────

  it("focuses the input field when dialog opens", async () => {
    render(<CreateItemDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL)).toHaveFocus();
    });
  });

  // ── Submit ─────────────────────────────────────────────────────────────

  it("calls onConfirm with the entered name when Create is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CreateItemDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL);
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "New Folder");
    await user.click(screen.getByRole("button", { name: CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATE }));

    expect(onConfirm).toHaveBeenCalledWith("New Folder");
  });

  it("calls onConfirm on Enter key press", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CreateItemDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL);
    await user.type(input, "my-document.txt");
    await user.keyboard("{Enter}");

    expect(onConfirm).toHaveBeenCalledWith("my-document.txt");
  });

  it("trims whitespace before confirming", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CreateItemDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL);
    await user.type(input, "  spaced-name  ");
    await user.click(screen.getByRole("button", { name: CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATE }));

    expect(onConfirm).toHaveBeenCalledWith("spaced-name");
  });

  // ── Cancel ─────────────────────────────────────────────────────────────

  it("calls onClose when Cancel is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CreateItemDialog {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: NAME_DIALOG_STRINGS.BUTTON_CANCEL }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Validation ─────────────────────────────────────────────────────────

  it("validates empty name", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CreateItemDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATE }));

    expect(screen.getByText(NAME_DIALOG_STRINGS.VALIDATION_EMPTY)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("validates invalid characters", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CreateItemDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL);
    await user.type(input, "bad:name");
    await user.click(screen.getByRole("button", { name: CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATE }));

    expect(screen.getByText(NAME_DIALOG_STRINGS.VALIDATION_INVALID_CHARS)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("validates dot names", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CreateItemDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL);
    await user.type(input, ".");
    await user.click(screen.getByRole("button", { name: CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATE }));

    expect(screen.getByText(NAME_DIALOG_STRINGS.VALIDATION_DOT_NAMES)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("validates trailing period", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CreateItemDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL);
    await user.type(input, "myfile.");
    await user.click(screen.getByRole("button", { name: CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATE }));

    expect(screen.getByText(NAME_DIALOG_STRINGS.VALIDATION_TRAILING)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // ── No "name unchanged" check (unlike rename) ─────────────────────────

  it("does NOT have 'name unchanged' validation (empty initial value)", async () => {
    // Unlike RenameDialog, CreateItemDialog starts empty.
    // Any valid name should be accepted without "unchanged" checks.
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<CreateItemDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL);
    await user.type(input, "valid-name");
    await user.click(screen.getByRole("button", { name: CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATE }));

    expect(onConfirm).toHaveBeenCalledWith("valid-name");
  });

  // ── Creating state ─────────────────────────────────────────────────────

  it("disables buttons when isCreating is true", () => {
    render(<CreateItemDialog {...defaultProps} isCreating={true} />);

    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
  });

  it("shows 'Creating…' text when isCreating", () => {
    render(<CreateItemDialog {...defaultProps} isCreating={true} />);
    expect(screen.getByText(CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATING)).toBeInTheDocument();
  });

  it("disables the input when isCreating is true", () => {
    render(<CreateItemDialog {...defaultProps} isCreating={true} />);
    expect(screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL)).toBeDisabled();
  });

  // ── API error display ──────────────────────────────────────────────────

  it("displays API error in an Alert", () => {
    render(<CreateItemDialog {...defaultProps} apiError="An item named 'folder' already exists" />);

    expect(screen.getByRole("alert")).toHaveTextContent("An item named 'folder' already exists");
  });

  it("does not show API error in the helper text", () => {
    render(<CreateItemDialog {...defaultProps} apiError="Item already exists" />);

    const input = screen.getByLabelText(CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL);
    expect(input.closest(".MuiFormControl-root")?.querySelector(".MuiFormHelperText-root")).toBeNull();
  });
});
