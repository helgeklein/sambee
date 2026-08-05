import { render, screen, waitFor } from "@testing-library/react";
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
    onResolve: vi.fn(),
  };

  it("shows conflict metadata in the shared dialog shell", () => {
    render(<OverwriteConflictDialog {...defaultProps} />);

    expect(screen.getByRole("heading", { name: S.TITLE(false) })).toBeInTheDocument();
    expect(screen.getByDisplayValue("report.txt")).toHaveAttribute("readonly");
    expect(screen.getByText(S.LABEL_INCOMING)).toBeInTheDocument();
    expect(screen.getByText(S.LABEL_EXISTING)).toBeInTheDocument();
    expect(screen.getByTestId("responsive-form-dialog-desktop-actions")).toBeInTheDocument();
  });

  it("focuses Skip and resolves the selected batch choice", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<OverwriteConflictDialog {...defaultProps} onResolve={onResolve} progress={{ current: 2, total: 3, conflictsSoFar: 1 }} />);

    const skipButton = screen.getByRole("button", { name: S.BUTTON_SKIP });
    await waitFor(() => expect(skipButton).toHaveFocus());
    await user.click(screen.getByRole("checkbox", { name: S.APPLY_TO_ALL }));
    await user.click(screen.getByRole("button", { name: S.BUTTON_REPLACE }));

    expect(onResolve).toHaveBeenCalledWith("replace", true);
  });

  it("resolves a close request as Skip without applying it to later conflicts", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<OverwriteConflictDialog {...defaultProps} onResolve={onResolve} />);

    await user.keyboard("{Escape}");

    expect(onResolve).toHaveBeenCalledWith("skip", false);
  });
});
