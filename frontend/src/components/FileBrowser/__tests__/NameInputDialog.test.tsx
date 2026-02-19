/**
 * NameInputDialog Component Tests
 *
 * Tests the shared base dialog component used by both
 * RenameDialog and CreateItemDialog.
 *
 * Verifies:
 * - Renders with correct title, labels, and initial value
 * - Input field auto-focuses on open
 * - Client-side validation (base + extra)
 * - Submit via button click and Enter key
 * - Cancel via button click
 * - Disabled state during submission
 * - API error display in Alert (not in helper text)
 * - Does not render when open is false
 * - Clears validation error on typing
 * - Trims whitespace before confirming
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NameInputDialog from "../NameInputDialog";
import { NAME_DIALOG_STRINGS } from "../nameDialogStrings";

const defaultProps = {
  open: true,
  title: "Test Dialog",
  inputLabel: "Name",
  initialValue: "",
  submitLabel: "Submit",
  submittingLabel: "Submitting…",
  isSubmitting: false,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  apiError: null as string | null,
};

describe("NameInputDialog", () => {
  // ── Rendering ──────────────────────────────────────────────────────────

  it("renders with the provided title", () => {
    render(<NameInputDialog {...defaultProps} title="New directory" />);
    expect(screen.getByText("New directory")).toBeInTheDocument();
  });

  it("renders with the provided input label", () => {
    render(<NameInputDialog {...defaultProps} inputLabel="Folder name" />);
    expect(screen.getByLabelText("Folder name")).toBeInTheDocument();
  });

  it("renders with initial value pre-filled", async () => {
    render(<NameInputDialog {...defaultProps} initialValue="readme.txt" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("readme.txt");
    });
  });

  it("renders the submit button with the provided label", () => {
    render(<NameInputDialog {...defaultProps} submitLabel="Create" />);
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("renders Cancel button", () => {
    render(<NameInputDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: NAME_DIALOG_STRINGS.BUTTON_CANCEL })).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<NameInputDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Test Dialog")).not.toBeInTheDocument();
  });

  // ── Focus ──────────────────────────────────────────────────────────────

  it("focuses the input field when dialog opens", async () => {
    render(<NameInputDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveFocus();
    });
  });

  // ── Submit ─────────────────────────────────────────────────────────────

  it("calls onConfirm with trimmed name when submit button is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText("Name");
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "  new-folder  ");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onConfirm).toHaveBeenCalledWith("new-folder");
  });

  it("calls onConfirm when Enter is pressed", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText("Name");
    await user.type(input, "my-file.txt");
    await user.keyboard("{Enter}");

    expect(onConfirm).toHaveBeenCalledWith("my-file.txt");
  });

  it("does not submit on Enter when isSubmitting is true", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} isSubmitting={true} onConfirm={onConfirm} initialValue="test" />);

    await user.keyboard("{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  // ── Cancel ─────────────────────────────────────────────────────────────

  it("calls onClose when Cancel is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: NAME_DIALOG_STRINGS.BUTTON_CANCEL }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Base validation ────────────────────────────────────────────────────

  it("shows validation error for empty name", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByText(NAME_DIALOG_STRINGS.VALIDATION_EMPTY)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows validation error for invalid characters", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText("Name");
    await user.type(input, "file/name");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByText(NAME_DIALOG_STRINGS.VALIDATION_INVALID_CHARS)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows validation error for dot names", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText("Name");
    await user.type(input, "..");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByText(NAME_DIALOG_STRINGS.VALIDATION_DOT_NAMES)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows validation error for trailing period", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByLabelText("Name");
    await user.type(input, "myfile.");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByText(NAME_DIALOG_STRINGS.VALIDATION_TRAILING)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // ── Extra validation ───────────────────────────────────────────────────

  it("runs extraValidate and shows its error", async () => {
    const onConfirm = vi.fn();
    const extraValidate = (name: string) => (name === "taken" ? "That name is taken" : null);
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} onConfirm={onConfirm} extraValidate={extraValidate} />);

    const input = screen.getByLabelText("Name");
    await user.type(input, "taken");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByText("That name is taken")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("passes when extraValidate returns null", async () => {
    const onConfirm = vi.fn();
    const extraValidate = () => null;
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} onConfirm={onConfirm} extraValidate={extraValidate} />);

    const input = screen.getByLabelText("Name");
    await user.type(input, "valid-name");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onConfirm).toHaveBeenCalledWith("valid-name");
  });

  // ── Validation error clearing ──────────────────────────────────────────

  it("clears validation error when user types", async () => {
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} />);

    // Trigger empty validation error
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByText(NAME_DIALOG_STRINGS.VALIDATION_EMPTY)).toBeInTheDocument();

    // Type something — error should clear
    const input = screen.getByLabelText("Name");
    await user.type(input, "a");

    expect(screen.queryByText(NAME_DIALOG_STRINGS.VALIDATION_EMPTY)).not.toBeInTheDocument();
  });

  // ── Submitting state ───────────────────────────────────────────────────

  it("disables buttons when isSubmitting is true", () => {
    render(<NameInputDialog {...defaultProps} isSubmitting={true} />);

    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /submitting/i })).toBeDisabled();
  });

  it("shows submitting label when isSubmitting is true", () => {
    render(<NameInputDialog {...defaultProps} isSubmitting={true} />);
    expect(screen.getByText("Submitting…")).toBeInTheDocument();
  });

  it("disables the input when isSubmitting is true", () => {
    render(<NameInputDialog {...defaultProps} isSubmitting={true} />);
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });

  // ── API error display ──────────────────────────────────────────────────

  it("displays API error in an Alert", () => {
    render(<NameInputDialog {...defaultProps} apiError="Item already exists" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Item already exists");
  });

  it("does not show API error in helper text", () => {
    render(<NameInputDialog {...defaultProps} apiError="Item already exists" />);

    const input = screen.getByLabelText("Name");
    expect(input.closest(".MuiFormControl-root")?.querySelector(".MuiFormHelperText-root")).toBeNull();
  });

  it("shows validation error when submitting with empty name despite API error", async () => {
    const user = userEvent.setup();
    render(<NameInputDialog {...defaultProps} apiError="Item already exists" />);

    // Clear the input and submit via Enter (button may be pointer-events:none)
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.keyboard("{Enter}");

    // Validation helper text is shown
    expect(screen.getByText(NAME_DIALOG_STRINGS.VALIDATION_EMPTY)).toBeInTheDocument();
  });

  // ── Reset on re-open ──────────────────────────────────────────────────

  it("resets value and validation error when dialog reopens", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<NameInputDialog {...defaultProps} initialValue="original" />);

    // Change the value
    const input = screen.getByLabelText("Name");
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, "modified");

    // Close and reopen
    rerender(<NameInputDialog {...defaultProps} initialValue="original" open={false} />);
    rerender(<NameInputDialog {...defaultProps} initialValue="original" open={true} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("original");
    });
  });
});
