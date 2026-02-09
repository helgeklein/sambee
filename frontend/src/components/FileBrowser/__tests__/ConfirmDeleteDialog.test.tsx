/**
 * ConfirmDeleteDialog Component Tests
 *
 * Verifies:
 * - Renders with correct item name and type label
 * - Cancel button receives initial focus
 * - onConfirm/onClose callbacks fire correctly
 * - Buttons are disabled during isDeleting
 * - Uses centralized string constants
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileType } from "../../../types";
import ConfirmDeleteDialog from "../ConfirmDeleteDialog";
import { CONFIRM_DELETE_STRINGS } from "../confirmDeleteDialogStrings";

describe("ConfirmDeleteDialog", () => {
  const defaultProps = {
    open: true,
    itemName: "readme.txt",
    itemType: FileType.FILE,
    isDeleting: false,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };

  it("renders the file name and type", () => {
    render(<ConfirmDeleteDialog {...defaultProps} />);

    expect(screen.getByText(CONFIRM_DELETE_STRINGS.TITLE_FILE)).toBeInTheDocument();
    expect(screen.getByText("readme.txt")).toBeInTheDocument();
  });

  it("renders directory title and prompt when itemType is DIRECTORY", () => {
    render(<ConfirmDeleteDialog {...defaultProps} itemName="Photos" itemType={FileType.DIRECTORY} />);

    expect(screen.getByText(CONFIRM_DELETE_STRINGS.TITLE_DIRECTORY)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(CONFIRM_DELETE_STRINGS.CONFIRM_DIRECTORY))).toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDeleteDialog {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Delete is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDeleteDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables buttons when isDeleting is true", () => {
    render(<ConfirmDeleteDialog {...defaultProps} isDeleting={true} />);

    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /deleting/i })).toBeDisabled();
  });

  it("shows 'Deleting…' text when isDeleting", () => {
    render(<ConfirmDeleteDialog {...defaultProps} isDeleting={true} />);

    expect(screen.getByText("Deleting…")).toBeInTheDocument();
  });

  it("focuses Cancel button when dialog opens", async () => {
    render(<ConfirmDeleteDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });
  });

  it("calls onClose when Enter is pressed on focused Cancel button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDeleteDialog {...defaultProps} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Enter is pressed on focused Delete button", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDeleteDialog {...defaultProps} onConfirm={onConfirm} />);

    screen.getByRole("button", { name: "Delete" }).focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not render when open is false", () => {
    render(<ConfirmDeleteDialog {...defaultProps} open={false} />);

    expect(screen.queryByText(CONFIRM_DELETE_STRINGS.TITLE_FILE)).not.toBeInTheDocument();
  });
});
